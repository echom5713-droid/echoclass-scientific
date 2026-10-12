# Milestone 2A design: normalized data and provenance

This design is based on the `3.0.0-alpha.3` persistence implementation at commit `c94797ea066d1a0d0d4ee9b148bddf11ff6ccb1d`. It deliberately keeps SQLite and the existing HTTP/application/domain/infrastructure dependency direction.

## Current Persistence Model

`src/infrastructure/database/storage.js` opens `data/citrus.db` through `node:sqlite`, enables WAL, foreign keys and a busy timeout, then creates schema inline. The SQLite tables are:

- `migrations(version, name, applied_at)`: two marker rows (`1` and `212`) are inserted, but migration behavior is mostly ad-hoc `PRAGMA table_info` checks and `ALTER TABLE` calls.
- `classes`: string ID, unique name, optional teacher ID and timestamps. No foreign key protects `teacher_id`.
- `users`: string ID, unique username, role, password hash, default-password flag, display name, class/group names, status, timestamps and a duplicate `data_json` copy.
- `records`: string ID plus class, creator, student, concentration, yield and creation time columns; the authoritative application record is read back from `data_json`.
- `sessions`: session hash and user foreign key, role, client metadata, expiry and revocation.
- `login_attempts`: rate-limit state keyed by an application-computed key.
- `audit_logs`: append-style metadata audit rows with JSON detail.
- `resources` and `ai_questions`: legacy supporting tables not used as scientific provenance in this milestone.

Existing indexes cover user role/class, record class/time and class/concentration, session user/expiry, and audit time/class.

The JSON compatibility path uses ignored `records.json` and `users.json`, in-memory sessions, atomic file replacement, and no database constraints. SQLite may seed from these files only when its corresponding table is empty. Demo users/records are supplied only when `ECHOCLASS_SEED_DEMO=1`.

`ExperimentRepository` currently reads all records from `data_json`; client-submission lookup filters them in application memory. SQLite update and delete load the complete dataset and rewrite the `records` table. `ReviewRepository.updateReview` overwrites four review projection fields inside the same record JSON. There is no review history or analysis-run persistence.

## Observed Problems

- Inline schema setup is not a deterministic, independently testable migration chain. A failed ad-hoc alteration is not represented as one atomic version.
- `records.data_json` is authoritative even for validated, filterable and calculated fields already partly duplicated in columns.
- Offline idempotency is encoded in JSON metadata and has no database uniqueness constraint.
- Review decisions overwrite previous decisions; only the latest projection survives.
- Creator, class and group relationships are stored as labels rather than protected record foreign keys.
- Record update/delete rewrite every record and widen the failure/locking surface.
- There is no durable representation of an analysis run, its exact inputs, the effective review decision, or a canonical input snapshot.
- The JSON fallback cannot provide SQLite transaction, constraint, migration or concurrency guarantees.

## Target Schema

The migration chain retains existing operational tables and introduces:

- `schema_migrations`: stable migration version, unique name and applied timestamp.
- `groups`: stable group ID, class foreign key and class-scoped unique name.
- `experiment_records`: normalized identity, ownership, class/group, lifecycle, all scientific fields used by current validation/diagnostics/analytics/review, calculated yield, current review projection, canonical submission snapshot and extension metadata.
- `record_reviews`: immutable human or explicitly marked legacy-projection decisions.
- `analysis_runs`: future run identity, dataset hash, algorithm/configuration/code versions, lifecycle status and result metadata only.
- `analysis_inputs`: ordered exact record snapshot, durable review-binding mode/omission reason, plus optional exact effective-review snapshot/hash for each run input.

Normalized experiment columns are justified by current behavior:

- identity/authorization/filtering: `id`, `created_by_user_id`, `class_id`, `group_id`, `student_name`, `status`, `created_at`, `updated_at`;
- offline identity: `client_submission_id`, `synced_from_offline`;
- workflow type: `experiment_type`, fixed initially to the current NH4Cl/citrus-oil workflow rather than pretending heterogeneous experiments exist;
- scientific validation/calculation/grouping: concentration, peel/oil mass, distillation time, clarity score, emulsification level/concentration, E. coli observation group, inhibition-zone diameter, colony-growth score, anomaly flag and error source;
- derived/server state: `yield_percent`, current review projection and AI diagnosis;
- provenance/extension: `submission_kind`, `submitted_json`, `metadata_json`.

`metadata_json` is non-authoritative and retains only optional extension metadata or legacy keys not represented by typed columns. Reads no longer reconstruct core values from `data_json`.

## Migration Strategy

Migrations are ordered code modules under `src/infrastructure/database/migrations/`. The runner creates `schema_migrations`, validates applied version/name pairs, applies each pending migration in `BEGIN IMMEDIATE`, records it only after success, and rolls back on any error.

Migration 1 establishes the accepted legacy operational schema for a fresh database. Migration 2 creates the normalized/provenance tables, copies each legacy `records` row, preserves available values and extension metadata, creates an explicitly marked legacy review event only when a non-default review projection exists, verifies record counts, then removes the obsolete `records` table. Existing `migrations` marker rows remain historical evidence but no longer control startup.

For creator attribution, migration resolves legacy `created_by` against user ID or username. Unresolvable legacy attribution remains null and is marked in metadata; no placeholder person is fabricated. Class and non-empty group labels receive deterministic IDs. Legacy review events keep the available reviewer label and decision; missing reviewer IDs or decision timestamps remain null, while `created_at` records when the legacy projection was captured.

## Backward-Compatibility Strategy

Domain/API `ExperimentRecord` fields remain available, including class/group labels and the current review projection. The storage adapter maps normalized joins back to that shape. Existing creation, listing, sync, analytics and review endpoints remain unchanged.

New fields such as normalized IDs may be present internally without requiring existing browser consumers to send them. The JSON adapter remains a clearly limited compatibility/demo mode and keeps the current API behavior, but it is not described as authoritative scientific provenance storage.

## Transaction Boundaries

- One migration and its `schema_migrations` row are one SQLite transaction.
- Canonical record insertion, deterministic class/group creation and the submission/provenance snapshot are one transaction.
- Appending a review event and updating the current review projection are one transaction; a failure leaves neither half committed.
- Creating an analysis run and all of its ordered input snapshots is one transaction.
- Reads are not wrapped in unnecessary transactions.

SQLite transaction helpers always roll back and rethrow. They do not accept a partially applied migration or multi-row provenance operation.

## Index Strategy

- `experiment_records(class_id, created_at DESC)`: authorized class listing and summaries.
- `experiment_records(created_by_user_id, created_at DESC)`: creator-scoped provenance lookup.
- unique partial index on `(created_by_user_id, class_id, client_submission_id)` where the client ID is non-null: durable actor/class offline idempotency.
- `experiment_records(class_id, nh4cl_concentration)`: current grouped analytics access pattern.
- `record_reviews(record_id, created_at DESC, id DESC)`: full history and effective latest decision.
- `record_reviews(reviewer_user_id, created_at DESC)`: reviewer audit access.
- `analysis_inputs(analysis_run_id, ordinal)`: exact ordered run input retrieval (also protected by its primary key).
- `analysis_inputs(record_id)`: provenance lookup from a scientific record to consuming runs.

Indexes are intentionally limited to observed or explicitly required provenance access paths. No performance claim is made; tests may use `EXPLAIN QUERY PLAN` only to prove an intended index is selectable.

## Idempotency Strategy

The correct ownership scope is the authenticated user ID plus normalized class ID plus `client_submission_id`. The application still checks for an existing mapping to return a friendly canonical response, while the partial unique index resolves races at the persistence boundary. Another user may legitimately reuse the same client ID without collision. The database primary key remains server-generated and unrelated to the offline token.

## Review-History Strategy

Every new review action inserts one `record_reviews` row. Existing rows are never updated, deleted, replaced or upserted. A database trigger allocates a monotonic `review_event_order.event_sequence` and updates the record's effective-review pointer and compatibility projection in the same statement transaction. History and effective-state retrieval use this insertion order rather than client-supplied timestamps.

The service retains role/class authorization. Students cannot call the review workflow, teachers remain class-scoped, and administrators retain current cross-class behavior. Ordinary deletion is a soft archival transition (`status=deleted`), so canonical observations, review history and analysis links remain available for audit while disappearing from normal listings.

Legacy review state is not presented as richer history than exists. A migrated row uses `provenance_kind=legacy_projection`, nullable reviewer linkage/decision time, the available reviewer label/reason, and the migration capture time.

## Analysis-Provenance Strategy

Milestone 2A provides storage foundations only. It creates no runs and computes no statistics. A future caller supplies run identity, dataset hash, algorithm/configuration/code versions and an ordered input set. The repository stores each record's canonical snapshot, optional effective-review snapshot and input hash with the run atomically.

`results_metadata_json` is reserved for future result references/metadata; it is empty unless a future analysis workflow explicitly writes it. The table does not mean reproducible analytics is implemented.

## Snapshot / Reproducibility Decision

Analysis inputs use immutable canonical snapshots rather than relying only on mutable live rows. Each snapshot contains the normalized scientific values, ownership/class/group IDs, server-derived yield, record timestamps and lifecycle state that a future analysis selected. The effective review event, if any, is linked by ID and copied into a review snapshot. `input_hash` and the run-level dataset hash allow later integrity checks; `code_version`, `algorithm_version` and canonical configuration JSON identify execution context.

This is the smallest mechanism that survives later record edits, later reviews, exclusion changes and application code changes without adding a general record-versioning subsystem. Editing a record outside an analysis run is still not a full append-only history in Milestone 2A.

## Rollback / Failure Strategy

- Migration errors roll back the current version and leave it absent from `schema_migrations`; startup fails rather than silently accepting an unknown schema.
- Malformed or non-object legacy record JSON aborts conversion and leaves the authoritative legacy table intact rather than manufacturing scientific defaults.
- Legacy migration verifies source and target counts before dropping the old table.
- Database constraint conflicts are mapped to repository/application conflict errors without SQLite details.
- Review projection failure rolls back the appended event.
- Analysis input failure rolls back the run and all prior inputs.
- Backups remain an owner-controlled operational action; this milestone does not silently copy or commit runtime databases.

SQLite DDL rollback behavior is exercised with an injected failing migration. No automatic down-migration is provided because a lossy rollback could destroy scientific provenance; restoration uses a verified backup and the prior application version.

## Known Limitations

- SQLite remains a single-file database and is not claimed to provide distributed PostgreSQL behavior.
- The JSON fallback retains compatibility but not SQLite provenance, transaction, constraint, migration or concurrency guarantees.
- Legacy creator/reviewer attribution may be incomplete because the old schema stored labels and only the latest review projection.
- Record edits outside analysis snapshots are not versioned generally.
- Analysis algorithms, run orchestration, CSV interchange, durable evidence files, Python, RAG and computer vision are outside Milestone 2A.
- Temporary-password enforcement, old demo-account audits, prior DeepSeek-key rotation and bundled-asset provenance remain separate open risks.

## Milestone 2A.1 corrective integrity addendum

Milestone 2A.1 preserves migrations `001` and `002` and adds migration `003-provenance-integrity-hardening`. The runner accepts only an exact ordered prefix of the known migration list and protects its ledger from update, deletion and replacement. Migration 2 now performs strict read-only legacy preflight before DDL; migration 3 audits databases that already recorded version 2 and stops with record IDs and field names when impossible manufactured observations require manual repair.

SQLite startup imports the optional JSON snapshot exactly once inside one transaction and records its disposition in `storage_imports`. A malformed or partially invalid snapshot rolls back all imported users and records. Existing SQLite data remains authoritative.

Canonical record updates use an explicit allow-list, validate the merged scientific record, recalculate yield, create class/group references in the same transaction and leave the immutable original submission snapshot unchanged. Canonical IDs, creator attribution, offline-idempotency scope and provenance fields cannot be changed by the update command. Legacy unscoped client tokens are retained only as explicitly unresolved metadata; they do not receive a false durable idempotency guarantee.

Analysis inputs now carry an explicit snapshot schema. Database triggers enforce record/review ownership, valid JSON and append-only rows. Repository reads validate the complete snapshot shape and surface an explicit corruption error instead of returning a cast empty object. Production canonical serialization and hashing remain future work and are not claimed here.

## Milestone 2A.2 corrective closure addendum

Released migration sources are historical artifacts: migrations 001–007 plus the dedicated version-2 preflight are frozen by accepted fingerprints, and the generic runner invokes migration-owned preflight inside the same transaction. Migration 008 alone carries the analysis-input sealing and provenance-boundary repairs.

The authoritative create boundary accepts a server persistence command rather than a full `ExperimentRecord`. It validates science, recomputes yield, separates submitted from canonical values and forbids caller-created human review state. JSON import applies an equally strict legacy boundary, makes nonempty SQLite authoritative before JSON parsing, and commits users, records, review provenance, verified counts and the durable marker atomically.

Migration 004 makes original submission/idempotency facts immutable, migration 005 persists binding semantics, and migration 006 distinguishes current-effective insertion from immutable point-in-time reads. Migration 007 makes ordinary run time/state server-owned and requires exact durable-record agreement in the selection transaction. Migration 008 seals ordered inputs, freezes terminal results, and enforces canonical new-write time, printable identity, metadata, human-review identity/chronology and exact projection rules at SQLite boundaries. Automated `normal`/`review` quality classification is not a human decision; human `included`/`excluded` state requires an authoritative event.

Snapshot v1 is now a semantic contract rather than a label. Invalid v1 reads surface repository corruption, new invalid rows fail at the database boundary, and incomplete legacy snapshots remain explicitly legacy. This closure does not add analysis execution, canonical cross-language hashing, general record versioning, Python, uploads, RAG or computer vision.
