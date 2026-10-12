# Changelog

## 3.0.0-beta.17 — project-guide retrieval

- Recover the original development plan and map implemented/remaining requirements.
- Add first-party Markdown FTS5/BM25 retrieval, exact source/corpus hashes, bounded caching and explicit unsupported/safety/premise responses.
- Add 42 offline questions, current-scope HTTP and actual-client tests; never transmit or audit raw questions.
- Correct stale architecture/README/defence status; scientific algorithms and schema 16 migrations remain unchanged.
- Full generative RAG, independent audit and public release remain pending.

## [3.0.0-beta.14] - 2026-09-05

- Added private record attachments and exact CSV-source retention, with actual reception time, digest/size checks, current ownership/class authorization and explicit archive handling.
- Added Migration 015: immutable evidence metadata, foreign-key targets, scoped retry identity, CSV source matching and bounded retained storage. Migrations 001–014 stay unchanged.
- Added durable no-overwrite file publication, bounded verified downloads and a small attachment page. File publication and SQLite commit have an explicit orphan boundary.
- Replaced unsafe database-copy backup/restore with verified SQLite snapshots plus every referenced object, including archived evidence. Restore only creates a new directory; interrupted restores cannot start the application.
- Added real HTTP, process-restart, concurrent-writer, filesystem-failure and backup-recovery checks; simplified current documentation and added a Chinese code walkthrough. No public deployment or observation-authenticity claim is made.

## [3.0.0-beta.13] - 2026-09-05

- Reject finite mass inputs whose derived yield overflows, in shared validation and canonical persistence. Migration 014 adds SQL guards and stops upgrades with invalid historical values instead of changing submitted evidence. Migrations 001–013 are unchanged.
- Preserve CSV retry tokens separately for each user, class, schema and file hash; changing files no longer silently turns a lost-response retry into a second import. Legacy tokens are retained, and unavailable or damaged storage blocks automatic submission.
- Added nine numeric and seven actual-client regression tests. Independent agent review reproduced both original defects and verified their repairs; this does not claim production or graphical-browser validation.

## [3.0.0-beta.12] - 2026-09-05

- Added fixed UTF-8 CSV v1 template, strict whole-file validation and read-only preview.
- Added Migration 013 with immutable completed batches and deferred row mappings; preserved migrations 001–012 and preflight bytes.
- Reused canonical insertion in one synchronous batch transaction including groups and success audit; added scoped durable retry receipts and fresh session/class checks.
- Added bounded deterministic spreadsheet export, uniform text: display protection and a small `/csv` interface with explicit duplicate-import intent.
- Added fault, raw SQL, auth, durability, process-race and live HTTP tests. No raw-file custody, deployment, independent audit PASS or 2B.2 completion is claimed.

## [3.0.0-beta.11] - 2026-08-24

### Historical legacy-review quarantine

- Added Migration 012 without modifying migrations 001–011; historical `legacy_projection` reviews attached to `canonical_submission` records now receive durable migration-owned unverified classification evidence.
- Preserved immutable review rows and scientific/review snapshot bytes while downgrading affected exact analysis inputs and runs to the established legacy/unverified representation.
- Blocked every new exact effective, omit or none selection for an affected record through the existing unverified-selection evidence mechanism.
- Preserved legitimate `legacy_canonical_snapshot` review history, including old rows without per-review batch evidence, and retained Migration 011 as the prospective write authority.

### Release hygiene

- Recorded the genuine 2A.10 red phase: 15 tests ran against beta.10, 8 guarantees passed and 7 failures reproduced; the final 2A.10 suite passes 15/15.
- Preserved the accepted Migration 011 Git blob and all earlier migration/preflight fingerprints. External schema-v7 inventory, old DeepSeek-key revocation, bundled-asset rights and legacy deployment review remain owner actions.
- Milestone 2B did not start; no production, public-release, performance, coverage or scientific-validation claim is made.

## [3.0.0-beta.10] - 2026-08-24

### Legacy review import authority

- Added Migration 011 without modifying migrations 001–010; new `legacy_projection` rows now require a legacy snapshot record linked to a matching still-open durable import batch.
- Made the infrastructure-only `importReview` path require an active transaction, an existing legacy target, a non-null immutable import reference and no completed marker.
- Preserved the ordinary authorized human-review path after import completion and retained every existing immutable historical review without inferring an insertion time or per-review batch link that the old schema did not store.

### Release hygiene

- Recorded the genuine 2A.9 red phase: 15 tests ran against beta.9, 8 guarantees passed and 7 failures reproduced; the final 2A.9 suite passes 15/15.
- Preserved the accepted Migration 010 Git blob and all earlier migration/preflight fingerprints. External schema-v7 inventory, old DeepSeek-key revocation, bundled-asset rights and legacy deployment review remain owner actions.
- Milestone 2B did not start; no production, public-release, performance, coverage or scientific-validation claim is made.

## [3.0.0-beta.9] - 2026-08-22

### Attribution, deletion and ledger authority

- Added Migration 010 without modifying migrations 001–009; direct deletion of experiment records and analysis runs now fails while repository deletion remains monotonic soft archival.
- Required new canonical rows to name an existing creator account with a matching current label and to satisfy the complete online/offline token, actor and immutable class-scope truth table at both repository and raw-SQL boundaries.
- Split startup legacy import from ordinary canonical creation. An open durable batch, imported records and reviews, and its completion marker now commit or roll back together; imported creator labels remain historical evidence rather than being compared with later account names.
- Audited visible schema-9 ambiguity without rewriting immutable submissions, classified definite offline contradictions as unverified, downgraded affected historical exact runs, and sealed the classification ledger against every ordinary runtime write form.

### Release hygiene

- Recorded the genuine 2A.8 red phase: 30 tests ran against beta.8, 8 guarantees passed and 22 failures reproduced before implementation; the final 2A.8 suite contains 70 passing tests.
- Because the released storage-import marker did not identify member rows or record insertion time, Migration 010 conservatively treats surviving rows as potential imported members rather than inferring history from scientific event timestamps.
- Preserved the accepted Migration 009 Git blob and the documented schema-v7 stop fixture. External durable-database inventory, old DeepSeek-key revocation, bundled-asset rights and legacy deployment review remain owner actions.
- Milestone 2B did not start; no production, public-release, performance, coverage or scientific-validation claim is made.

## [3.0.0-beta.8] - 2026-08-22

### Sealed dataset completeness and historical provenance

- Added Migration 009 without changing migrations 001–008; new exact runs require a non-empty dense record-unique input set and the seal remains atomic and one-way.
- Revalidated historical none/omit/effective projections, minimum review chronology, archived-at-selection claims, record-version timestamp collisions, and real Gregorian legacy offsets; unverifiable evidence is explicitly classified or downgraded instead of rewritten.
- Added one recursive lossless JSON-safe validator plus matching TypeScript/SQLite machine-identity and Unicode blank-text policies.
- Made the versioned provenance-classification ledger append-only and resistant to update, delete, and replacement paths.
- Preserved legitimate point-in-time snapshots and historical reviewer ownership after later account rename, disablement, or role drift when Migration 008 was already applied.

### Release hygiene

- Recorded the genuine 2A.7 red phase: 66 tests ran, 11 pre-existing guarantees passed and 55 failures reproduced before implementation; the final two 2A.7 suites contain 96 passing tests.
- Documented that beta.8 supports fresh databases and databases that already record immutable Migration 008. A durable schema-v7 database may still require a separately approved compatibility process.
- Milestone 2B did not start. Old DeepSeek-key revocation, bundled-asset rights, legacy deployment review, and external durable-database attestation remain owner actions.

## [3.0.0-beta.7] - 2026-08-22

### Analysis input sealing and provenance boundary

- Added Migration 008 without changing migrations 001–007; ordinary run creation now seals its observed ordered input set before execution and freezes first-terminal outputs.
- Added persistence-owned human review identity/time, exact effective/omit/none projections, active-record selection, canonical new-write timestamps, bounded identities, and fail-closed metadata reads.
- Classified supported historical offsets and downgraded forged historical review bindings without rewriting immutable snapshots.

### Release hygiene

- Recorded the genuine 2A.6 red phase: 13 grouped tests ran, one existing guarantee passed and 12 failures reproduced; its final adversarial suite passed 19/19.
- Preserved accepted fingerprints for migrations 001–007 and the frozen version-2 preflight. Milestone 2B did not start and owner blockers remained open.

## [3.0.0-beta.6] - 2026-08-22

### Analysis selection and run integrity

- Added Migration 007 without changing migrations 001–006; its preflight reports definite run/input corruption by ID and downgrades historically unverifiable v1 inputs to explicit legacy.
- Added a caller-writable `CreateAnalysisRunCommand` and injected trusted clock so ordinary runs always start pending with server-owned timestamps and empty result metadata.
- Enforced terminal-safe analysis state transitions, immutable creator/identity, strict JSON objects, valid timestamps and fail-closed repository reads at both TypeScript and SQLite boundaries.
- Made every required v1 snapshot key fail closed and required exact durable-record identity, scientific, measurement, lifecycle, creator, review, offline, AI and metadata agreement in the selection transaction.
- Added strict calendar-valid JSON-import timestamps and explicit review provenance-kind validation; invalid values fail atomically and unknown provenance is never upgraded to human.

### Release hygiene

- Recorded a genuine 14/14 failing grouped red phase before implementation and expanded the final 2A.5 adversarial suite to 19/19 passing cases.
- Preserved accepted fingerprints for migrations 001–006 and the frozen version-2 preflight. Milestone 2B did not start, and the owner security/release blockers remain open.

## [3.0.0-beta.5] - 2026-08-22

### Temporal analysis and import provenance

- Added migration 006 without changing released migrations 001–005; valid historical analysis inputs remain bound to the review event effective at selection time, while temporally impossible or forged rows become explicit legacy inputs.
- Restored the complete database-level v1 structural/scientific snapshot contract and combined it with exact-event, binding-mode, and current-effective insertion checks.
- Made application review-mode intent authoritative and changed repository reads to validate the exact stored immutable review event instead of the later current projection.
- Strengthened JSON review/creator/timestamp preflight and added truthful unresolved-reference metadata with atomic rollback.
- Scanned historical canonical submissions for definite contradictions, failing closed where correction was impossible and marking ambiguous histories as unverifiable rather than claiming agreement.
- Added executable browser measurement state that invalidates calibration on dish-diameter change, image replacement/removal, invalid content, stale reads, or FileReader failure.

### Release hygiene

- Recorded the genuine 2A.4 red phase: 15 tests ran, 2 existing guarantees passed and 13 audit failures reproduced before implementation.
- Preserved fingerprints for migrations 001–005 and the frozen version-2 preflight, retained executable manifest-binding coverage, and did not start Milestone 2B.

## [3.0.0-beta.4] - 2026-08-22

### Independent-audit provenance repair

- Added migration 005 without changing released migrations 001–004, and froze the version-2 legacy preflight as a fingerprinted historical artifact.
- Made browser measurement provenance explicit: default/manual/reset paths remain `manual_direct`, while calibrated provenance requires a valid loaded image and a completed circle measurement.
- Removed the alternate unrestricted submission snapshot, enforced canonical submitted/scientific agreement, and strengthened atomic JSON import provenance preflight.
- Bound analysis review snapshots field-for-field to immutable review events and record projections, persisted explicit review-binding modes and omission reasons, and reclassified inconsistent historical v1 inputs as legacy.
- Deterministically repaired compatibility projections from immutable review events with audit metadata, froze creator labels, and required durable non-null offline idempotency scope.

### Release hygiene

- Recorded a genuine 13/13 failing independent-audit red phase before implementation and retained the old-key, bundled-asset-rights, and legacy-account owner actions as unresolved blockers.
- No Milestone 2B, Python analytics, RAG, public-readiness claim, coverage claim, or scientific-validation claim is included.

## [3.0.0-beta.3] - 2026-08-21

### End-to-end provenance closure

- Restored released migration 002 byte-for-byte, froze migrations 001–003 with accepted source fingerprints, moved strict version-2 preflight into the transactional migration runner, and added migration 004 for all new DDL.
- Preserved experiment date, Petri diameter and measurement method through HTTP, trusted commands, canonical storage, original submissions, reads and analysis snapshots; calibrated local-image measurements now require a valid dish diameter.
- Replaced broad authoritative insertion with a validated persistence command that recomputes yield and rejects invalid science or forged human-review state.
- Made JSON-to-SQLite import authoritative, preflighted, all-or-nothing, count-verified and restart-safe, including explicit legacy review provenance and strict boolean/derived-value handling.
- Enforced effective-review, immutable original-submission/idempotency, semantic analysis snapshot v1 and analysis-run identity invariants at the SQLite boundary.
- Added effective-review-by-default analysis binding and authorized audit lookup for archived records.

### Release hygiene

- Added a 28-test Milestone 2A.2 closure suite plus HTTP/database measurement and archived-review integration coverage; 29 adversarial behaviors were observed failing across the recorded red phases.
- Retained public release blockers: owner confirmation of old DeepSeek-key revocation, bundled-asset provenance/consent, and legacy deployment/demo-account review.

## [3.0.0-beta.2] - 2026-08-21

### Provenance integrity hardening

- Added strict legacy scientific-data preflight, an exact-prefix append-only migration ledger, and migration 003 without renaming or replacing the accepted migrations.
- Made optional JSON startup import atomic, verified, durable and once-only while keeping existing SQLite content authoritative.
- Made review order/effective projection database-owned, blocked review and analysis-input mutation paths, enforced record/review linkage, and added versioned validated snapshots with explicit corruption errors.
- Replaced unrestricted record patching and physical deletion with allow-listed transactional correction, server-recalculated yield, immutable original submissions and soft archival.
- Persisted experiment date, Petri-dish diameter and measurement method, and prevented canonical offline idempotency without a known creator.

### Runtime and release hygiene

- Aligned `engines`, `.nvmrc`, Docker and CI on Node.js 24 without claiming `node:sqlite` or deployment production readiness.
- Added adversarial provenance tests and updated the model, design, decision, risk, defence and independent-audit documentation.
- Retained prior DeepSeek-key revocation, legacy demo-account review and bundled-asset provenance as unresolved manual release blockers.

## [3.0.0-beta.1] - 2026-08-20

### Normalized scientific persistence

- Added ordered, atomic SQLite migrations with recorded versions, safe startup failure, and realistic legacy-data conversion tests.
- Moved authoritative experiment identity, ownership, lifecycle, scientific observations, derived yield, and review projection into typed columns; retained JSON only for submitted/extension metadata.
- Added direct targeted SQL update/delete, verified foreign keys and constraints, actor/class-scoped database idempotency, and indexes tied to current queries.

### Review and analysis provenance

- Added immutable append-only review events, effective-review lookup, authorized history retrieval, and a transactional compatibility projection.
- Added empty-by-default analysis run/input foundations with exact canonical record and effective-review snapshots; no analysis algorithm or fabricated result is included.
- Documented the schema, legacy limitations, snapshot decision, transactions, index trade-offs, JSON fallback policy, and public-release blockers.

## [3.0.0-alpha.3] - 2026-08-20

### Continuous integration and ownership

- Added a least-privilege GitHub Actions workflow for pushes and pull requests targeting `main`.
- Runs install, lint, typecheck, build, unit, integration, smoke, runtime-security, formatting, and architecture-boundary checks on Node.js 24 without provider credentials or private runtime data.
- Added engineering decision and defence notes that document the implemented architecture, security boundaries, tests, trade-offs, and current limitations.
- Renamed the local default branch from `master` to `main` without rewriting history.

### Release hygiene

- Preserved `3.0.0-alpha.2` as the historical Milestone 1.1C closure and advanced current version surfaces to `3.0.0-alpha.3`.
- Kept prior DeepSeek-key revocation and bundled-asset provenance as open manual release blockers.
- No CI badge or remote-success claim is included until a real private GitHub Actions run is observed.

## [3.0.0-alpha.2] - 2026-08-20

### Trust boundaries and authorization

- Made canonical experiment IDs, timestamps, calculated yield, creator identity, class scope, and initial review state server-owned.
- Added strict scientific transport parsing and explicit rejection of protected review/audit fields.
- Replaced record `INSERT OR REPLACE` behavior with insert-only creation and safe `CONFLICT` mapping.
- Added actor/class-scoped offline idempotency and canonical server-ID mappings for the browser.
- Isolated public demonstration analytics from private classroom repositories and protected operational metrics.

### Credentials and runtime safety

- Preserved existing password hashes when imports omit a password and required explicit temporary credentials for new users.
- Replaced the fixed operational password-reset path with a generated one-time temporary credential.
- Restricted fixed demo credentials and seeded demo records to the explicit `ECHOCLASS_SEED_DEMO=1` fixture.
- Made smoke verification use disposable ignored runtime data and updated security checks to execute built runtime modules.

### Architecture, tests, and documentation

- Added practice, class-summary, and operations application services plus an automated dependency-direction gate.
- Removed dead legacy HTTP/security modules after migrating runtime consumers.
- Added Milestone 1.1 closure, progress, risk, release-hygiene, strict parsing, ID collision, password, public/private, and operational endpoint regressions.
- Aligned package, lockfile, runtime health/banner, tests, README, and changelog at `3.0.0-alpha.2`.

## Unreleased — Milestone 1

### Architecture

- Replaced the monolithic JavaScript server entry point with a strict TypeScript composition root and focused HTTP route modules.
- Added explicit domain types, authorization policies, experiment validation/diagnostics, application services, repository interfaces, and infrastructure adapters.
- Moved SQLite/JSON storage under infrastructure and isolated the DeepSeek HTTP request in a provider adapter.
- Moved descriptive scientific/statistical functions out of the view template module.
- Standardized JSON errors with stable codes and request IDs, and added metadata-safe structured request logging.

### Tooling and tests

- Added TypeScript build/typecheck, ESLint, Prettier, `tsx` development, and compiled production commands.
- Added unit coverage for domain validation, authorization, mocked repository service behavior, safe AI handling, and error mapping.
- Added integration coverage for all three role logins, record creation/retrieval, student/teacher cross-class denial, and provider-unavailable fallback.
- Preserved the Milestone 0 baseline, security, and smoke checks.

## 3.0.0-alpha.1 - 2026-08-20

### Security and data hygiene

- Removed the source archive's `.env`, runtime SQLite/WAL/SHM files, local record/account JSON, and oversized preview video from the sanitized repository.
- Expanded Git exclusions for secrets, runtime data, uploads, backups, coverage, build output, caches, and logs.
- Escaped dynamic user and AI text before HTML rendering.
- Kept selected images browser-local and added size, extension, MIME, and magic-byte checks for manual measurement.
- Added AI input length/rate limits and common PII redaction.
- Removed absolute database paths from public metrics.

### Truthfulness

- Unified the package, health endpoint, runtime banner, README, and changelog at `3.0.0-alpha.1`.
- Removed constant inflation from hotword counts.
- Replaced digital-twin and automatic-optimum claims with measurement visualisation and descriptive/exploratory language.
- Replaced hard-coded theme statistics with values calculated from loaded records.
- Anonymized built-in demonstration users and records.
- Removed unverified DOC/DOCX source materials that contained unresolved metadata/provenance; linked the anonymous synthetic CSV instead.

### Documentation and tests

- Added the Milestone 0 audit, progress log, risk register, synthetic sample CSV, and baseline invariant tests.
