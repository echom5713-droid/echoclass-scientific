# EchoClass decision log

This log records decisions visible in the current repository and its Milestone 0–1.2 history. It does not describe planned Milestone 2 capabilities as completed.

## Retain native Node.js and TypeScript

**Decision**

Keep the native Node.js HTTP server and move its application boundaries into strict TypeScript rather than rewriting the product in a web framework.

**Context**

The existing server-rendered routes and browser client already implement the classroom workflow. Milestone 1 needed clearer ownership and dependency direction without a UI or framework migration.

**Alternatives considered**

Continue the JavaScript structure unchanged, or replace it with the previously discussed Next.js/React stack.

**Reason**

Typed route, service, domain, and infrastructure boundaries address the audit findings while preserving working routes and limiting migration risk.

**Trade-offs**

The composition root and HTML view adapter remain project-specific, and the large legacy view/client modules are not automatically decomposed by a framework.

**Current limitations**

The HTML templates and browser client remain sizeable compatibility modules. This decision does not establish production readiness.

## Route handlers depend on application services

**Decision**

HTTP handlers parse transport input and delegate workflows to application services; they do not query SQLite, filter repositories, calculate class summaries, or write application audit events directly.

**Context**

Earlier routes contained business decisions and concrete repository dependencies, making authorization and testing inconsistent.

**Alternatives considered**

Keep route-local orchestration, or expose the storage engine directly to every handler.

**Reason**

Services provide one testable place for authorization, class scoping, audit ownership, validation, and error mapping.

**Trade-offs**

More constructor wiring is required in `src/server.ts`, and small workflows may span more files.

**Current limitations**

The server-rendered view adapter remains in the HTTP response path, although it no longer owns storage or authorization.

## Repository and provider interfaces

**Decision**

Application services depend on repository/provider ports defined in the domain or application layer. SQLite/JSON and DeepSeek implementations stay in infrastructure.

**Context**

EchoClass needs deterministic tests without a live database file or external LLM, while retaining the current SQLite engine and JSON fallback.

**Alternatives considered**

Import concrete storage/provider modules in services, or introduce a generic CRUD repository for all entities.

**Reason**

Focused ports express the operations each workflow needs, allow in-memory test doubles, and enforce dependency direction without hiding domain-specific behavior behind generic CRUD.

**Trade-offs**

Ports and adapters add types and mapping code. The existing JavaScript storage engine still sits behind a TypeScript adapter.

**Current limitations**

The JSON fallback has weaker persistence and authentication guarantees than SQLite; the ports do not imply that both modes are production-equivalent.

## Canonical IDs are server-generated

**Decision**

The server generates database record IDs. An optional `client_submission_id` supports offline idempotency but never becomes the primary key.

**Context**

Accepting a client-supplied primary ID alongside `INSERT OR REPLACE` allowed one actor to replace an existing record.

**Alternatives considered**

Trust browser-generated IDs, reject every offline retry, or keep client IDs after checking for a collision.

**Reason**

Server ownership closes the replacement boundary. Actor/class-scoped idempotency preserves retry behavior while returning the canonical mapping to the browser.

**Trade-offs**

Offline clients must store the returned mapping and cannot predict the canonical ID.

**Current limitations**

The scoped idempotency lookup lacks a database uniqueness constraint for concurrent multi-process writers; that requires an approved schema migration.

## Authenticated identity overrides submitted identity

**Decision**

Student name, class, and group come from the authenticated session. Teacher class is session-scoped; administrators use explicit validated cross-class entry rules.

**Context**

Client identity fields are untrusted and previously could be used to impersonate another student or move a record between classes.

**Alternatives considered**

Accept hidden form values, compare submitted values with the session, or derive identity entirely on the server.

**Reason**

Server derivation removes ambiguity and makes resource-level authorization independent of browser behavior.

**Trade-offs**

Account/class assignment must be correct before student submission, and teachers/admins need explicit role-specific data-entry rules.

**Current limitations**

Class membership is still represented by the current user/session model rather than a normalized enrollment schema.

## Demo credentials require an explicit fixture flag

**Decision**

Fixed demonstration users and records seed only when `ECHOCLASS_SEED_DEMO=1`; the default and `.env.example` keep it disabled.

**Context**

Fixed credentials are useful for disposable demonstrations but unsafe if silently created beside real classroom data.

**Alternatives considered**

Always seed demo accounts, remove demonstration logins entirely, or isolate them behind an explicit environment choice.

**Reason**

The opt-in flag preserves local demonstrations while making the safe real-data default deterministic and testable.

**Trade-offs**

Demo setup has an extra step and existing deployments still require a one-time manual data audit.

**Current limitations**

The flag cannot remove accounts already created by older versions. Owners must keep it disabled in real-data environments.

## Retain SQLite at the current scale

**Decision**

Keep SQLite as the primary persistence implementation for the current single-process, classroom-scale application.

**Context**

The present milestone addresses trust and architecture boundaries, not a database migration. SQLite is already integrated, locally operable, and covered by workflow tests.

**Alternatives considered**

Migrate now to PostgreSQL/Supabase, or rely only on the JSON fallback.

**Reason**

SQLite supports the current local deployment shape with low operational overhead. Repository ports preserve a future migration seam without claiming the migration is free.

**Trade-offs**

Concurrency, distributed deployment, migration tooling, and operational observability are more limited than with a managed database.

**Current limitations**

Experiment observations remain partly in `data_json`; there is no versioned migration system, normalized experiment schema, or append-only review history yet.

## Introduce CI before database redesign

**Decision**

Add a single Node 24 GitHub Actions verification job before Milestone 2 schema work.

**Context**

Milestone 1.1 established security, architecture, integration, smoke, and formatting gates. Schema redesign will need those existing behaviors protected.

**Alternatives considered**

Continue local-only verification, or defer CI until after the schema migration.

**Reason**

Automating the current gate gives future pull requests repeatable feedback before higher-risk persistence changes begin.

**Trade-offs**

The job intentionally repeats builds across some npm scripts and tests one supported Node version instead of a broad matrix.

**Current limitations**

The workflow does not prove deployment readiness, coverage, performance, or scientific validity. A remote PASS cannot be claimed until a real private GitHub Actions run is observed.

## Snapshot analysis inputs instead of relying on live rows

**Decision**

Store an immutable canonical record snapshot and optional effective-review snapshot for every future `analysis_inputs` row, alongside record/review links and hashes.

**Context**

Records may later be edited, a teacher may append a different decision, selection may change, and application code may advance. Live foreign keys alone could identify rows but could not reproduce the values selected at run time.

**Alternatives considered**

Use only live record/review references, implement a general version table for every record mutation, or snapshot only the fields selected for each analysis run.

**Reason**

Input snapshots are the smallest design that preserves the exact selected scientific/review state without introducing a full record-event-sourcing system in Milestone 2A.

**Trade-offs**

Snapshots consume storage and duplicate selected canonical values. Their hashes and serialization format must remain stable in the future analysis workflow.

**Current limitations**

The repository provides persistence foundations only: no algorithm, dataset selection service, canonical hashing specification, Python runtime or reproducibility claim exists yet. Record edits outside analysis snapshots still lack general version history.

## Make provenance ordering and projection database-owned

**Decision**

Assign every review a monotonic database sequence and update the effective-review pointer/projection from an `AFTER INSERT` trigger. Reject update, deletion, replacement and upsert paths for reviews, their order rows and analysis inputs.

**Context**

Client-supplied timestamps can tie or be misleading, and application-only projection updates can be bypassed by another infrastructure caller.

**Alternatives considered**

Order by timestamp plus random ID, keep the application transaction as the only control, or replace the projection with an expensive history query everywhere.

**Reason**

Insertion order is unambiguous, while the trigger makes direct SQL insertion and repository insertion obey the same invariant.

**Trade-offs and limitations**

The companion order table and triggers add schema complexity. SQLite still is not a distributed event store, and migrated legacy rows can preserve only the order available at migration time.

## Archive canonical observations instead of deleting them

**Decision**

Ordinary record deletion is a soft lifecycle transition. Normal queries hide archived rows; explicitly scoped audit reads retain them.

**Context**

Physical deletion could erase a scientific observation before review or analysis foreign keys existed to block it.

**Reason**

Preserving the canonical row, immutable submission snapshot and links is safer than making provenance depend on whether a later relationship happened to exist.

**Trade-offs and limitations**

Storage is not reclaimed and future retention/erasure policy needs an explicit privileged workflow. This is not a claim that every legal deletion request can always be refused.

## Treat JSON startup data as one import snapshot

**Decision**

When an empty SQLite database is initialized from JSON compatibility files, read and validate the complete snapshot, import it in one transaction, verify counts and write an immutable durable marker. Existing SQLite content remains authoritative.

**Context**

Per-row startup import could leave a partially accepted database after a malformed later row and could silently retry or skip without durable evidence.

**Trade-offs and limitations**

One invalid row blocks the entire import and requires operator repair. Continuing to run explicitly in JSON mode still lacks SQLite-equivalent constraints and concurrency guarantees.

## Support Node.js 24 only for the current beta

**Decision**

Align `engines`, `.nvmrc`, Docker and GitHub Actions on Node.js 24.

**Context**

The authoritative adapter uses `node:sqlite`. Its API/runtime maturity and behavior must not be implied to be portable across an untested broad Node range.

**Trade-offs and limitations**

This narrows supported runtimes and does not make `node:sqlite` or the application production-ready. Deployment readiness still requires an independent operational assessment.

## Freeze released migration sources and evolve transactional preconditions

**Decision**

Treat migrations 001–003 as immutable fingerprinted release artifacts. Restore migration 002 to its first released bytes, run its strict legacy preflight as a version-keyed runner hook inside the same transaction, and put all new DDL in migration 004.

**Reason**

A deployed migration ledger cannot prove which later-mutated source produced an existing schema. Fingerprints prevent silent rewrites, while an in-transaction precondition can safely reject newly understood bad legacy input without redefining the historical transformation.

**Trade-offs and limitations**

Runner and migration source must be reviewed together, and migration 004 carries additional triggers/complexity. There is no automatic down migration.

## Separate automated quality state from human review projection

**Decision**

Allow only automated initial `normal`/`review` state without an event. Require `included`/`excluded` and reviewer/note/time projection to match the latest monotonic append-only review event exactly.

**Reason**

Compatibility projection is useful to existing views, but it must never be an alternate path for manufacturing approval. The database enforces the same rule for repository and raw SQL callers.

## Make snapshot v1 executable and bind effective review by default

**Decision**

Validate record and review snapshots semantically at write and read boundaries, preserve incomplete historical rows as an explicit legacy schema, and automatically snapshot a record's effective review unless the selection explicitly requests omission with a reason.

**Current limitations**

Canonical cross-language serialization/hashing and analysis execution remain future work; record edits outside analysis inputs are not a complete version history.

## Freeze the version-2 preflight and bind audit semantics in migration 005

**Decision**

Treat migrations 001–004 and the extracted version-2 preflight as fingerprinted historical artifacts. Keep the runner generic, attach the frozen preflight to migration 002, and place every new table rebuild, trigger replacement, projection repair, and provenance constraint in migration 005.

**Reason**

A migration ledger version is trustworthy only when both transformation and precondition semantics are immutable. Analysis inputs must also state whether a review was effectively bound, deliberately omitted with a reason, absent at selection, or inherited ambiguously from legacy data.

**Trade-offs and limitations**

New v1 inputs cannot use `legacy_unspecified`; effective snapshots are cross-checked against immutable events and the record projection. Historical inconsistencies are reclassified rather than silently retained as v1. Canonical cross-language hashing remains future work.

## Preserve point-in-time analysis binding in migration 006

**Decision**

Require new effective analysis inputs to bind the current latest review at insertion, but validate later reads against the exact immutable event stored by `review_id`. Use run creation time, event time and monotonic event sequence to classify historical bindings.

**Reason**

“Effective at selection time” is a temporal statement, not a permanent claim that the event remains the current projection. Comparing an old run with a later effective review corrupts reproducibility, while allowing a new run to select an already superseded event misstates its provenance.

**Trade-offs and limitations**

Migration 006 can prove definite temporal contradictions and preserve plausible historical bindings. Where old submitted/canonical disagreement could also represent an undocumented correction, the record is marked `submission_agreement_unverifiable`; the missing complete correction history cannot be reconstructed.

## Make analysis selection time and run state authoritative in migration 007

**Decision**

Accept only identity/configuration fields through `CreateAnalysisRunCommand`; use an injected repository clock and always insert an ordinary run as `pending`. Enforce the run state machine, terminal timestamps, JSON objects, immutable creator/identity, complete snapshot field presence and exact durable-record agreement with Migration 007 triggers.

**Reason**

A caller-supplied time cannot prove that a review or record version existed at selection, and an internally valid forged snapshot is not evidence of the durable classroom record. The repository and SQLite boundaries therefore independently enforce selection time and exact current content.

**Trade-offs and limitations**

Migration 007 can fail definite corruption by ID. If a later durable record edit makes historical equality impossible to reconstruct, it downgrades the input to explicit legacy instead of claiming exact v1. Metadata is compared as a semantic JSON object at migration preflight and as the repository-produced canonical JSON representation at new SQLite insertion. Cross-language canonical hashing and a general append-only record-version history remain future work.

## Seal analysis inputs and authoritative provenance in migration 008

**Decision**

Create every ordinary run as pending and unsealed, insert its complete ordered input set, then set a one-way durable seal in the same transaction. Require the seal before leaving pending. Freeze status, completion time and results metadata at the first terminal transition. Ordinary human review callers submit `AppendReviewCommand`; persistence generates event IDs and timestamps from injected trusted capabilities.

**Reason**

An append-only input table is insufficient if rows may still be appended after execution starts. Likewise, append-only review rows are not authoritative if callers can manufacture human identity or event time. Repository and SQLite enforcement are both required because import and operational tooling can bypass HTTP.

**Trade-offs and limitations**

Migration 008 seals existing runs even though historical input rows have no insertion timestamp, so whether an old input was appended after terminal transition is not reconstructible. This limitation is reported rather than inferred. Supported historical offset timestamps are recorded in `provenance_boundary_classifications` without rewriting immutable evidence. Cross-language canonical hashes and a general record-version ledger remain future work.

## Close sealed-dataset and historical-provenance boundaries in migration 009

**Decision**

Require every new exact run to seal a non-empty, dense, record-unique ordered input set in the same transaction that inserts it. Treat `exact`, `legacy_incomplete`, and `legacy_unverified` as durable immutable run classifications. Revalidate historical review projection, chronology, archive timing, recursive JSON, identifier/text contracts, and record-version evidence before installing current guards.

Use a versioned append-only classification ledger for evidence that cannot be reconstructed. Preserve immutable scientific/review snapshots and downgrade only the reproducibility claim. Valid historical offset timestamps remain readable only when ledger-classified; invalid calendar values are unverified. Historical reviewer ownership is preserved without treating current account role, status, or name as evidence about the past.

**Reason**

A one-way seal is not a completeness proof when an empty, gapped, sparse, or duplicate dataset can be sealed. Likewise, an immutable snapshot is not exact evidence when its review projection, chronology, archive state, JSON representation, or record version time is contradictory. Repository and SQLite enforcement must share the same explicit contracts.

**Trade-offs and limitations**

Migration 009 cannot execute for a schema-v7 database that immutable Migration 008 rejects first after reviewer-account drift. Beta.8 therefore supports fresh databases and databases already recording Migration 008; broader compatibility requires owner inventory and a separately reviewed path. A complete append-only record-version ledger and cross-language canonical analysis hashes remain future work.

## Separate canonical attribution, legacy import and migration-owned classifications in migration 010

**Decision**

Keep `ExperimentRepository.add` as the authoritative application write path. Require it to identify an existing creator whose current username or name matches the stored label and to satisfy the complete online/offline token and immutable class-scope contract. Give startup JSON conversion a separate infrastructure-only `importExperiment` capability backed by a durable batch; the batch, users, legacy-labelled records, reviews and completion marker are one transaction.

Reject physical deletion of experiment records and analysis runs directly at the database boundary. Treat provenance-boundary classifications as migration-owned evidence: Migration 010 audits the released ledger, appends its own truthful limitations and installs a write seal that a future migration must explicitly remove and reinstall inside its transaction.

**Reason**

Caller-controlled labels or metadata cannot establish scientific attribution or import authority. A soft-delete policy is not durable if raw SQL can erase an unreferenced row and release its offline token. An append-only ledger is also not authoritative when normal runtime code can append a forged `%unverified` claim. These boundaries require database-verifiable origins and direct guards in addition to TypeScript interfaces.

**Trade-offs and limitations**

Historical legacy creator labels are preserved without comparing them with a later account name, so missing account-state snapshots remain explicit limitations rather than inferred corruption. Migration 010 cannot recover rows physically deleted before beta.9, cannot prove the absence of a sophisticated pre-010 forged classification that exactly mimics every released contract, and cannot repair a schema-v7 database rejected by immutable Migration 008. External durable-database inventory remains an owner attestation.

## Bind every new legacy review to the active import batch in migration 011

**Decision**

Keep `importReview` as an infrastructure-only startup-import capability. When schema 10 is present, require an active transaction and a target `legacy_canonical_snapshot` record whose immutable `storage_import_id` resolves to a matching `legacy_import_batches` row with no completed `storage_imports` marker. Add a direct database `BEFORE INSERT` guard for every new `legacy_projection` event. Leave `ReviewRepository` and ordinary application services limited to authorized human review.

**Reason**

A durable record batch link does not protect review provenance if a canonical record can skip the repository check or raw SQL can append a legacy event after completion and make it effective. The review event itself must be accepted only while its imported target's batch is still open.

**Trade-offs and limitations**

The rule is prospective. Released schemas did not retain review insertion time or a per-review batch reference, so Migration 011 preserves existing immutable reviews and does not infer whether a historical event was inserted before or after completion from its scientific/event timestamps. The schema-v7 compatibility boundary and all owner attestations remain unchanged.

## Quarantine definite historical legacy-review authority contradictions in migration 012

**Decision**

Treat an existing `legacy_projection` review on a `canonical_submission` record as definite unverified provenance. Migration 012 appends `legacy_review_authority_unverified` evidence while the classification insert seal is temporarily open inside the migration transaction. It preserves the review and snapshot bytes, downgrades affected exact inputs to the established legacy representation, marks their exact runs `legacy_unverified`, and reinstalls the migration-only seal.

Keep Migration 011 unchanged as the prospective authority. Do not quarantine `legacy_canonical_snapshot` reviews merely because old schemas lack per-review batch membership or insertion time.

**Reason**

The supported import model creates legacy review events only for legacy snapshot records. A canonical submission therefore cannot truthfully originate a legacy projection, and an exact analysis must not treat that contradiction as authoritative provenance. Existing unverified-selection and analysis-downgrade mechanisms already express the required loss of exactness without inventing a competing state model.

**Trade-offs and limitations**

Migration 012 cannot reconstruct review insertion time and does not attempt to determine whether a legitimate imported review predated a later completion marker. It changes only the exactness classification of affected analysis evidence; immutable review events, submitted snapshots, scientific fields, and record/review snapshot JSON remain unchanged. The schema-v7 compatibility boundary and all owner attestations remain open.

## 2026-09-05 — 2B.1 atomic CSV interchange

Decision: use one fixed experiment CSV schema, raw UTF-8 HTTP bodies, a synchronous SQLite batch repository and two immutable completion tables. Reject entire invalid files rather than retaining partial observations. Reuse canonical insertion inside one BEGIN IMMEDIATE, including group resolution and the success audit. Seal mappings before completion with a deferred FK, then freeze both relations.

Use uploader + stable class ID + explicit attempt token for idempotency. Raw hash includes original BOM/line endings and binds only received bytes; it is not stored-file custody or scientific validation. Use the existing deterministic diagnostics against one fixed pre-import class cohort. Keep human review and analysis snapshots separate.

Choose a single spreadsheet display export with visible text: protection and deterministic byte output, not a new canonical analysis format. Add only a small standalone page and links to existing teacher/admin views. No generic transaction framework, storage fallback, deployment, public release, evidence storage or Python integration is introduced. The existing manual risk register remains open.

## 2026-09-05 — CSV audit corrections

Check finiteness after the established yield calculation as well as on its operands. Add prospective SQL guards in Migration 014 and fail preflight on existing bad values without inventing measurements or altering submitted snapshots.

Keep browser retry identities per user/class/schema/raw hash instead of one slot. Preserve legacy attempts and require explicit duplicate-import intent to replace a damaged cache. Server uniqueness remains necessary, but it cannot compensate for a client silently replacing its token. Independent reproduction and final recheck are described in the corrective result.

## 2026-09-05 — private evidence and paired recovery

Use one immutable object per upload and one SQLite metadata row with exactly one record/batch foreign-key target. Avoid content deduplication and online deletion: neither is needed for a small classroom workflow, and both would complicate the file/database failure boundary. Publish and sync bytes before the short metadata transaction; allow a reported orphan when the later commit is uncertain.

Recheck current authority after asynchronous file reads and immediately before response headers. Evidence permissions are narrower than ordinary classroom record lists. CSV source linkage reuses the original receipt authority, and a re-upload records its actual reception time. Signature screening does not prove file safety or observation truth.

Back up a consistent SQLite snapshot and its complete immutable object set, including archived files. Sync copied content before completing the manifest. Restore into an exclusively created directory and block startup until its progress marker is removed after verification. Keep the old live-main-file copy fallback removed. This local protocol is explainable and testable without a distributed transaction or storage platform.

## 2026-09-05 — extractive project-guide retrieval (beta.17)

The recovered plan requires FTS/BM25 sources and 30–50 evaluation questions. Implement a 20-section first-party Markdown corpus, read-only in-memory SQLite index and 42 development regression cases. Return exact excerpts; do not label this generated reasoning or full RAG. This avoids making unverifiable new claims while exposing source-selection failures. A rebuilt index needs no classroom schema migration. The cache stores only terms from returned public excerpts; questions are not persisted or transmitted. Trade-off: lexical retrieval misses paraphrases, safety classification is incomplete, and the resulting development set is not independent evaluation. Existing report calculations are untouched. Next decisions concern independent source relevance review, usefulness of generated claims, and the engineering/demo stage.

## 2026-09-05 — separate bundled corpus from runtime volume

The initial beta.17 commit placed the guide under data/knowledge. Existing Docker compose mounts /app/data; an older runtime directory could mask a newly built guide and prevent startup. Move authoritative source to resources/knowledge, outside runtime mounts, and exercise the built adapter in a clean checkout without a data directory. Keep the discovery and correction as separate real commits. Corpus identity changes because the source path is part of its content-addressed manifest.
