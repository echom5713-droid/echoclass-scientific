# EchoClass progress

## Milestone 0 — security cleanup and truthfulness audit

### Plan

1. Inventory the supplied archive without printing secrets or personal data.
2. Copy only the application source and non-runtime assets into the repository.
3. Establish Git exclusions and anonymous synthetic sample data.
4. Align product identity and remove unsupported statistical/product claims.
5. close client rendering, AI-input, metrics, and image-handling baseline risks.
6. Add repeatable tests, run the relevant suite, and record actual results.

### Implementation status

- [x] Source archive inventoried; sensitive values not printed.
- [x] `.env`, runtime databases, WAL/SHM, runtime JSON, and oversized unverified video excluded.
- [x] Package, health endpoint, runtime banner, README, and changelog aligned to `3.0.0-alpha.1`.
- [x] Built-in users and records anonymized and marked as demonstration data.
- [x] Fabricated hotword offsets removed; hard-coded theme summary replaced with computed values.
- [x] User/LLM DOM rendering paths escaped or converted to text insertion.
- [x] Image selection changed to local-only manual measurement with content checks.
- [x] AI input cap, rate limit, common PII redaction, and metadata-only audit detail added.
- [x] Audit, risk register, changelog, README, sample CSV, and baseline tests added.
- [ ] Manual provider-key rotation (repository owner).
- [ ] Material provenance/redistribution decision (repository owner).

### Test record

Final verification on 2026-08-20:

| Command                                                                                             | Actual result                                                                                                   |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `node --check` for server, views, client, storage, security check, and baseline test                | PASS; 6 files parsed successfully                                                                               |
| `npm test`                                                                                          | PASS; 5 tests, 5 passed, 0 failed                                                                               |
| `npm run security-check`                                                                            | PASS; `SECURITY_CHECK_PASS`                                                                                     |
| `npm run smoke-test`                                                                                | PASS; 14 GET checks, 3 role logins, student workspace access, and admin reset flow completed; `SMOKE_TEST_PASS` |
| provider-shaped secret scan of the sanitized tree                                                   | PASS; 0 matches                                                                                                 |
| `git check-ignore` for `.env`, DB/WAL/SHM, runtime JSON, uploads, backups, coverage, dist, and logs | PASS; every checked path matched an explicit rule                                                               |

Node emitted its standard warning that `node:sqlite` is experimental. This is a runtime warning, not a test failure.

## Milestone 1 — TypeScript architecture refactor

### Implementation status

- [x] Verified the exact sanitized baseline commit before modification.
- [x] Created the architecture inventory and migration map before major refactoring.
- [x] Added strict TypeScript, ESLint, Prettier, build, typecheck, development, production, and test commands.
- [x] Added explicit core domain types and separated transport from domain validation.
- [x] Added repository interfaces with SQLite/JSON infrastructure adapters.
- [x] Added Auth, Experiment, Review, Admin, and AI application services.
- [x] Split HTTP routing by responsibility and standardized safe error envelopes with request IDs.
- [x] Centralized role/class authorization and added cross-class denial tests.
- [x] Moved provider HTTP calls and descriptive statistical logic out of views.
- [x] Added structured metadata-safe request logging.
- [x] Added required unit and integration coverage while retaining baseline/security/smoke checks.

### Verification record

Final verification on 2026-08-20:

| Command                    | Actual result                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`             | PASS; 0 errors                                                                                                                         |
| `npm run typecheck`        | PASS; strict TypeScript check completed with 0 errors                                                                                  |
| `npm run build`            | PASS; production output emitted to ignored `dist/`                                                                                     |
| `npm test`                 | PASS; 10 tests, 10 passed, 0 failed                                                                                                    |
| `npm run test:integration` | PASS; 3 tests, 3 passed, 0 failed                                                                                                      |
| `npm run smoke-test`       | PASS; 14 GET checks, 3 role logins, student workspace, and admin password reset; `SMOKE_TEST_PASS`                                     |
| `npm run security-check`   | PASS; `SECURITY_CHECK_PASS`                                                                                                            |
| `npm run format:check`     | PASS; all checked files use the configured formatter                                                                                   |
| boundary/secret audit      | PASS; provider fetch only in the LLM adapter, SQL only in database infrastructure, 0 explicit TypeScript `any`, 0 provider-key matches |

Node emitted its standard warning that `node:sqlite` is experimental; the warning is not a test failure.

Milestone 2 has not been started.

## Milestone 1.1C — trust-boundary closure and release hygiene

### Implementation status

- [x] Inspected the real repository, branch, baseline commits, working diff, and absent remote without rewriting history.
- [x] Closed server-owned record ID, identity, yield, timestamp, review, and protected-field boundaries.
- [x] Added actor/class-scoped offline idempotency and browser-visible canonical ID mappings.
- [x] Preserved existing credentials during passwordless import and rejected fixed demo credentials for operational users.
- [x] Replaced fixed operational password reset with a generated one-time temporary credential.
- [x] Restricted fixed demo users/records to explicit `ECHOCLASS_SEED_DEMO=1` isolation.
- [x] Restored browser camelCase password-change compatibility.
- [x] Protected public data/metrics/provider metadata and retained server-side role/class authorization.
- [x] Enforced and tested dependency direction; legacy views remain rendering compatibility code only.
- [x] Aligned package, lockfile, runtime, tests, README, and changelog to `3.0.0-alpha.2`.
- [x] Confirmed that Milestone 2 has not started.

### Verification record

Final verification on 2026-08-20:

| Command                                                  | Actual result                                                                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                 | PASS; 94 packages installed, 95 audited, npm reported 0 vulnerabilities; no dependency version/content change beyond the intentional root package version |
| `npm run lint`                                           | PASS; 0 errors                                                                                                                                            |
| `npm run typecheck`                                      | PASS; 0 TypeScript errors                                                                                                                                 |
| `npm run build`                                          | PASS; ignored `dist/` output generated                                                                                                                    |
| `npm test`                                               | PASS; 29 tests, 29 passed, 0 failed                                                                                                                       |
| `npm run test:integration`                               | PASS; 11 tests, 11 passed, 0 failed                                                                                                                       |
| `npm run smoke-test`                                     | PASS; isolated disposable JSON runtime; 14 GET checks, three role logins, workspace access, generated reset; `SMOKE_TEST_PASS`                            |
| `npm run security-check`                                 | PASS; `SECURITY_CHECK_PASS` plus 11/11 integration tests                                                                                                  |
| `npm run format:check`                                   | PASS; all matched files formatted                                                                                                                         |
| `node --test dist/tests/architecture-boundaries.test.js` | PASS; 4 tests, 4 passed, 0 failed                                                                                                                         |
| `git diff --check`                                       | PASS; no whitespace errors                                                                                                                                |

No coverage tool was run and no coverage figure is claimed.

### Remaining limitations and public-release blockers

- Normalized experiment schema, append-only review history, Python analytics, reproducible analysis runs, grounded AI/RAG, durable uploaded-file evidence, CI, and automatic computer vision remain unimplemented.
- Temporary-password change is not yet enforced server-side; offline idempotency does not yet have a database uniqueness constraint.
- Public release remains blocked pending owner confirmation of DeepSeek key revocation and verification of bundled image/video/GLB provenance and redistribution rights.
- Existing deployment data directories require a manual demo-account audit before real-data use.

Milestone 2 has not been started. The next proposed activity is an early CI and private GitHub baseline, subject to explicit owner authorization.

## Milestone 1.2 — private GitHub baseline and continuous integration

### Implementation status

- [x] Preserved the real repository history and renamed the default branch to `main`.
- [x] Created and pushed the existing private GitHub repository without secrets or runtime/private data.
- [x] Added a least-privilege Node 24 GitHub Actions verification workflow.
- [x] Observed a successful real Actions run for the accepted Milestone 1.2 baseline.
- [x] Advanced genuine current version surfaces to `3.0.0-alpha.3`.

## Milestone 2A — normalized database and append-only review provenance

### Implementation status

- [x] Reverse-engineered and documented the actual SQLite and explicit JSON compatibility models before implementation.
- [x] Added ordered atomic SQLite migrations with `schema_migrations`, once-only startup behavior, and loud rollback on failure.
- [x] Migrated core experiment/provenance concepts to normalized typed columns while retaining only submitted/extension metadata as JSON.
- [x] Added database-level creator/class-scoped offline idempotency, direct SQL update/delete, foreign keys, constraints, and query-driven indexes.
- [x] Added immutable review events, authorized history retrieval, effective-state lookup, and a transactional compatibility projection.
- [x] Added analysis-run/input persistence foundations with immutable record/review snapshots and no fabricated analysis runs or results.
- [x] Preserved class/user authorization, API compatibility, SQLite as the primary engine, and the existing UI/framework.
- [x] Advanced genuine current version surfaces to `3.0.0-beta.1` only after the implementation gate passed.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

### Local verification record

Final verification on 2026-08-20:

| Command                                                  | Actual result                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                 | PASS; 94 packages installed, 95 audited, npm reported 0 vulnerabilities                                                               |
| `npm run lint`                                           | PASS; 0 errors                                                                                                                        |
| `npm run typecheck`                                      | PASS; 0 TypeScript errors                                                                                                             |
| `npm run build`                                          | PASS; ignored `dist/` output generated                                                                                                |
| `npm test`                                               | PASS; 38 tests, 38 passed, 0 failed                                                                                                   |
| `npm run test:integration`                               | PASS; 12 tests, 12 passed, 0 failed                                                                                                   |
| explicit migration/database test                         | PASS; 9 tests, 9 passed, 0 failed                                                                                                     |
| `npm run smoke-test`                                     | PASS; isolated disposable JSON runtime; public pages, 14 GET checks, three role logins, workspace access and generated reset verified |
| `npm run security-check`                                 | PASS; `SECURITY_CHECK_PASS` plus 12/12 integration tests                                                                              |
| `npm run format:check`                                   | PASS; all matched files formatted                                                                                                     |
| `node --test dist/tests/architecture-boundaries.test.js` | PASS; 4 tests, 4 passed, 0 failed                                                                                                     |
| `git diff --check`                                       | PASS; no whitespace errors                                                                                                            |

No coverage tool, performance benchmark, scientific validation study, Python analytics, or fabricated analysis result was run or claimed.

## Milestone 2A.1 — scientific provenance integrity hardening

### Implementation status

- [x] Audited the accepted Milestone 2A commit directly and recorded a genuine failing adversarial phase before implementation.
- [x] Enforced an exact-prefix, append-only migration ledger and strict read-only legacy preflight; added migration 003 without renaming migrations 001/002.
- [x] Made JSON-to-SQLite startup import atomic, verified and durably marked, with existing SQLite data authoritative.
- [x] Moved review event ordering, effective pointer and compatibility projection to database triggers and blocked review mutation/replacement paths.
- [x] Enforced analysis record/review ownership, snapshot schema/JSON validity and immutable input rows; repository reads now report corruption explicitly.
- [x] Added allow-listed atomic record updates with merged validation/yield recalculation, immutable original submissions and soft archival.
- [x] Prevented canonical offline-idempotency tokens without a creator and preserved unresolved legacy tokens as explicitly limited metadata.
- [x] Persisted experiment date, Petri-dish diameter and measurement method through transport, canonical storage and snapshots.
- [x] Aligned supported runtime surfaces on Node.js 24 without claiming deployment or `node:sqlite` production readiness.
- [x] Completed the full local verification gate and advanced current version surfaces to `3.0.0-beta.2`.
- Exact-commit private CI is necessarily observed after this documentation is committed; its run ID and conclusion belong to the delivery report and private Actions history.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

## Milestone 2A.2 — migration immutability and end-to-end provenance closure

### Implementation status

- [x] Recorded genuine red phases: the initial closure suite failed 22/22, the new HTTP measurement test failed, and six final-review behaviors subsequently failed before correction (29 adversarial reproductions in total).
- [x] Restored migration 002 byte-for-byte to its accepted release and froze migrations 001–003 with executable source fingerprints.
- [x] Moved strict version-2 legacy preflight outside historical DDL while keeping it in the same migration transaction; added all new DDL in migration 004.
- [x] Closed measurement provenance through HTTP, application, validation, canonical/submitted persistence, reads and snapshots.
- [x] Added an explicit validated canonical persistence boundary with server-recomputed yield and protected human-review state.
- [x] Made empty-target JSON import scientifically preflighted, all-or-nothing, count-verified, review-provenance-aware and restart-safe while retaining nonempty SQLite authority.
- [x] Enforced effective-review projection, semantic snapshot v1, original-submission/idempotency, and analysis-run identity invariants at the database boundary.
- [x] Bound effective reviews to analysis inputs by default and retained authorized archived audit access.
- [x] Advanced current version surfaces to `3.0.0-beta.3` only after the implementation tests passed.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

The final local release-gate counts and exact private GitHub Actions evidence are recorded in the delivery report after the corrective commit. No coverage, performance, production-readiness or scientific-validation claim is made.

## Milestone 2A.3 — independent-audit provenance semantics repair

### Implementation status

- [x] Recorded a genuine 13-test red phase with 0 passed and 13 failed before implementation.
- [x] Added explicit truthful browser measurement state and removed diameter-based calibrated inference.
- [x] Removed unrestricted alternate submitted snapshots and enforced canonical submission agreement.
- [x] Completed atomic JSON import provenance preflight and explicit legacy-unknown attribution.
- [x] Added cross-object review/event validation, fail-closed reads, projection repair, and legacy reclassification.
- [x] Persisted review binding/omission semantics and enforced creator/idempotency provenance.
- [x] Froze migrations 001–004 plus the extracted version-2 preflight and added migration 005 only.
- [x] Advanced current version surfaces to `3.0.0-beta.4` after the full local gate passed.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

Final local counts: 101/101 main tests, 14/14 integration tests, 4/4 architecture-boundary tests, and 13/13 independent-audit repair tests. Exact private CI evidence belongs to the delivery report after the one corrective commit is pushed and observed.

## Milestone 2A.4 — temporal analysis binding and provenance contract closure

### Implementation status

- [x] Recorded a genuine 15-scenario red phase: 2 existing guarantees passed and 13 audit failures reproduced.
- [x] Preserved point-in-time review events for old analysis runs while requiring current-effective binding for new inputs.
- [x] Reclassified historical inputs with run/event timestamps and monotonic event order.
- [x] Restored the complete SQLite v1 structural/scientific contract in migration 006.
- [x] Made application review modes authoritative and completed review/creator import provenance preflight.
- [x] Detected definite historical submitted/canonical contradictions and marked ambiguous history unverifiable.
- [x] Invalidated browser calibration on dish/image/read-state changes through an executable state module.
- [x] Preserved migrations 001–005 and the frozen version-2 preflight fingerprints and manifest binding.
- [x] Advanced current version surfaces to `3.0.0-beta.5` after the full local gate passed.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

Final local counts: 116/116 main tests, 14/14 integration tests, 4/4 architecture-boundary tests, and 15/15 temporal-analysis adversarial tests. Exact private CI evidence belongs to the delivery report after the one corrective commit is pushed and observed.

## Milestone 2A.5 — analysis selection authority and run-state integrity closure

### Implementation status

- [x] Recorded a genuine red phase: all 14 executable adversarial groups failed against beta.5.
- [x] Added `CreateAnalysisRunCommand` and an injected trusted clock; ordinary runs always start pending.
- [x] Enforced run identities, JSON-object payloads, timestamps, creator references and terminal-safe state transitions at repository and SQLite boundaries.
- [x] Made every required v1 snapshot key fail closed and aligned TypeScript/SQLite timestamp, creator, offline and AI-field validation.
- [x] Required exact durable-record agreement at selection while preserving immutable snapshots after later edits.
- [x] Added strict calendar-valid JSON-import timestamps and explicit provenance-kind validation.
- [x] Added Migration 007 preflight with ID-bearing failure for definite corruption and legacy downgrade for historically unverifiable rows.
- [x] Preserved migrations 001–006, the frozen version-2 preflight fingerprints and executable manifest binding.
- [x] Advanced current version surfaces to `3.0.0-beta.6` after the main suite reached 135/135.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

Exact private CI evidence belongs to the delivery report after the one corrective commit is pushed and observed.

## Milestone 2A.6 — analysis input sealing and provenance boundary closure

### Implementation status

- [x] Recorded a genuine red phase: the new suite produced 12 failures and 1 pre-existing pass before implementation.
- [x] Added one-way `inputs_sealed` state; creation inserts ordered inputs and seals in one transaction.
- [x] Blocked input appends for sealed, running, completed and failed runs and required sealing before execution.
- [x] Froze first-terminal status, completion time and result metadata at repository and SQLite boundaries.
- [x] Required exact review projection in effective/omit/none modes and downgraded forged historical none bindings.
- [x] Replaced ordinary persisted-review input with `AppendReviewCommand`; persistence owns human event ID and time.
- [x] Enforced canonical millisecond UTC new-write timestamps, printable bounded identities, object metadata and import chronology.
- [x] Made malformed record metadata reads fail closed and limited new analysis selection to active records.
- [x] Added Migration 008 only and preserved accepted fingerprints for migrations 001–007 and the version-2 preflight.
- [x] Advanced current version surfaces to `3.0.0-beta.7` after the main suite reached 154/154 on a clean build output.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

Exact private CI evidence belongs to the delivery report after the single corrective commit is pushed and observed.

## Milestone 2A.7 — sealed dataset completeness and historical provenance compatibility

### Implementation status

- [x] Verified the beta.7 baseline commit, clean worktree, exact private `origin/main`, and exact successful GitHub Actions run before implementation.
- [x] Recorded a genuine red phase: 66 tests ran, 11 existing guarantees passed, and 55 failures reproduced.
- [x] Added Migration 009 only; migrations 001–008 and the frozen version-2 preflight retain accepted fingerprints.
- [x] Required non-empty dense record-unique analysis selections and atomic rollback for failed input completeness.
- [x] Enforced exact none/omit/effective projections, minimum chronology for all review provenance kinds, monotonic record versions, and archived-selection classification.
- [x] Added recursive lossless JSON validation plus shared machine-identity and Unicode blank-text contracts.
- [x] Classified invalid legacy calendars, incomplete datasets, unverifiable review/version history, and made the classification ledger append-only.
- [x] Preserved legitimate point-in-time inputs and post-Migration-008 historical reviews after reviewer rename, disablement, or role change.
- [x] Advanced version surfaces to `3.0.0-beta.8`; Milestone 2B did not start.
- [ ] Owner attestation for all durable database/deployment/backup locations and whether any schema-v7 database exists.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

The final local gate counts and exact private CI evidence are recorded in the Milestone 2A.7 result/delivery report. No general schema-v7 upgrade, public-release, production, coverage, performance, or scientific-validation claim is made.

## Milestone 2A.8 — canonical attribution, deletion and audit-ledger authority closure

### Implementation status

- [x] Verified the beta.8 baseline commit, clean worktree, exact private `origin/main`, and exact successful GitHub Actions run before implementation.
- [x] Recorded a genuine red phase: 30 tests ran, 8 existing guarantees passed, and 22 failures reproduced.
- [x] Added Migration 010 only; migrations 001–009 and the frozen version-2 preflight retain accepted fingerprints.
- [x] Added direct database guards against physical deletion of active/archived records and analysis runs while preserving monotonic soft archival and offline-token ownership.
- [x] Required authoritative canonical creator identity and the complete online/offline provenance truth table at repository and raw-SQL boundaries.
- [x] Separated an infrastructure-only legacy import path with truthful origin labels and a durable all-or-nothing batch/completion-marker contract.
- [x] Audited released classification rows, classified visible historical ambiguity without rewriting evidence, and sealed the classification ledger against ordinary runtime writes.
- [x] Preserved the executable schema-v7 stop behavior and advanced current version surfaces to `3.0.0-beta.9`; Milestone 2B did not start.
- [ ] Owner attestation for all durable database/deployment/backup locations and whether any schema-v7 database exists.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

### Verification record

Final local verification on 2026-08-22:

| Command                                                  | Actual result                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm ci`                                                 | PASS; 94 packages installed, 95 audited, npm reported 0 vulnerabilities |
| `npm run lint`                                           | PASS; 0 errors                                                          |
| `npm run typecheck`                                      | PASS; 0 TypeScript errors                                               |
| `npm run build`                                          | PASS; ignored `dist/` output generated                                  |
| `npm test`                                               | PASS; 321 tests, 321 passed, 0 failed                                   |
| `npm run test:integration`                               | PASS; 14 tests, 14 passed, 0 failed                                     |
| `npm run smoke-test`                                     | PASS; `SMOKE_TEST_PASS`                                                 |
| `npm run security-check`                                 | PASS; `SECURITY_CHECK_PASS` plus 14/14 protected runtime workflow tests |
| `npm run format:check`                                   | PASS; all matched files formatted                                       |
| `node --test dist/tests/architecture-boundaries.test.js` | PASS; 4 tests, 4 passed, 0 failed                                       |
| Milestone 2A.4 adversarial suite                         | PASS; 15 tests, 15 passed, 0 failed                                     |
| Milestone 2A.5 adversarial suite                         | PASS; 19 tests, 19 passed, 0 failed                                     |
| Milestone 2A.6 adversarial suite                         | PASS; 19 tests, 19 passed, 0 failed                                     |
| Milestone 2A.7 adversarial suites                        | PASS; 96 tests, 96 passed, 0 failed                                     |
| Milestone 2A.8 adversarial suite                         | PASS; 70 tests, 70 passed, 0 failed                                     |
| `git diff --check`                                       | PASS; no whitespace errors                                              |

The exact corrective commit and exact-commit private CI evidence are reported in the delivery response after the single commit is pushed and observed. No general schema-v7 upgrade, public-release, production, coverage, performance, or scientific-validation claim is made.

## Milestone 2A.9 — legacy review import authority seal

### Implementation status

- [x] Verified the reviewed beta.9 baseline commit, clean worktree, exact private `origin/main`, accepted Migration 010 blob and successful exact-commit GitHub Actions run before implementation.
- [x] Recorded a genuine red phase: 15 tests ran, 8 existing guarantees passed, and 7 authority failures reproduced.
- [x] Added Migration 011 only; migrations 001–010 and the frozen version-2 preflight retain their accepted contents and executable fingerprint controls.
- [x] Required the infrastructure legacy-review capability to run inside an explicit transaction against a `legacy_canonical_snapshot` record tied to an active import batch with no durable completion marker.
- [x] Added a prospective SQLite guard that rejects forged raw `legacy_projection` rows for ordinary canonical records, missing import authority, and completed imports.
- [x] Preserved previously stored historical review evidence and kept review insertion time distinct from historical event time.
- [x] Updated current version surfaces to `3.0.0-beta.10`; Milestone 2B did not start.
- [ ] Owner attestation for all durable database/deployment/backup locations and whether any schema-v7 database exists.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

The Migration 011 guard is prospective: it prevents new unauthorized legacy-projection events and does not reinterpret or rewrite historical rows.

### Verification record

Final local verification on 2026-08-24:

| Command                                                  | Actual result                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm ci`                                                 | PASS; 94 packages installed, 95 audited, npm reported 0 vulnerabilities |
| `npm run lint`                                           | PASS; 0 errors                                                          |
| `npm run typecheck`                                      | PASS; 0 TypeScript errors                                               |
| `npm run build`                                          | PASS; ignored `dist/` output generated                                  |
| `npm test`                                               | PASS; 336 tests, 336 passed, 0 failed                                   |
| `npm run test:integration`                               | PASS; 14 tests, 14 passed, 0 failed                                     |
| `npm run smoke-test`                                     | PASS; `SMOKE_TEST_PASS`                                                 |
| `npm run security-check`                                 | PASS; `SECURITY_CHECK_PASS` plus 14/14 protected runtime workflow tests |
| `npm run format:check`                                   | PASS; all matched files formatted                                       |
| `node --test dist/tests/architecture-boundaries.test.js` | PASS; 4 tests, 4 passed, 0 failed                                       |
| Milestone 2A.4 adversarial suite                         | PASS; 15 tests, 15 passed, 0 failed                                     |
| Milestone 2A.5 adversarial suite                         | PASS; 19 tests, 19 passed, 0 failed                                     |
| Milestone 2A.6 adversarial suite                         | PASS; 19 tests, 19 passed, 0 failed                                     |
| Milestone 2A.7 adversarial suites                        | PASS; 96 tests, 96 passed, 0 failed                                     |
| Milestone 2A.8 adversarial suite                         | PASS; 70 tests, 70 passed, 0 failed                                     |
| Milestone 2A.9 adversarial suite                         | PASS; 15 tests, 15 passed, 0 failed                                     |
| `git diff --check`                                       | PASS; no whitespace errors                                              |

The exact corrective commit and exact-commit private CI evidence are reported in the delivery response after the single commit is pushed and observed. No general schema-v7 upgrade, public-release, production, coverage, performance, or scientific-validation claim is made.

## Milestone 2A.10 — historical legacy-review quarantine and final provenance closure

### Implementation status

- [x] Verified the reviewed beta.10 baseline, clean worktree, exact private `origin/main`, successful exact-commit CI and accepted Migration 011 blob before implementation.
- [x] Recorded a genuine 15-test red phase: 8 existing guarantees passed and 7 historical-quarantine failures reproduced.
- [x] Added Migration 012 only; migrations 001–011 and the frozen version-2 preflight retain accepted contents and executable fingerprint controls.
- [x] Classified every historical `canonical_submission` + `legacy_projection` contradiction with exact review/record evidence without rewriting the immutable event.
- [x] Downgraded affected direct and omit-mode exact analysis inputs and their runs while preserving record/review snapshot bytes.
- [x] Reused existing unverified-selection evidence to block future exact effective, omit and none selections.
- [x] Preserved legitimate legacy snapshot reviews, including historical rows without per-review batch evidence, and retained Migration 011 prospective authority.
- [x] Updated current version surfaces to `3.0.0-beta.11`; Milestone 2B did not start.
- [ ] Owner attestation for all durable database/deployment/backup locations and whether any schema-v7 database exists.
- [ ] Owner confirmation of old DeepSeek key revocation.
- [ ] Owner confirmation of bundled asset provenance/consent/redistribution rights.
- [ ] Owner audit of legacy deployment data for old demo accounts.

Migration 012 does not infer review insertion time or quarantine legitimate legacy snapshots merely because older schemas did not preserve per-review batch evidence.

### Verification record

Final local verification on 2026-08-24:

| Command                                                  | Actual result                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm ci`                                                 | PASS; 94 packages installed, 95 audited, npm reported 0 vulnerabilities |
| `npm run lint`                                           | PASS; 0 errors                                                          |
| `npm run typecheck`                                      | PASS; 0 TypeScript errors                                               |
| `npm run build`                                          | PASS; ignored `dist/` output generated                                  |
| `npm test`                                               | PASS; 351 tests, 351 passed, 0 failed                                   |
| `npm run test:integration`                               | PASS; 14 tests, 14 passed, 0 failed                                     |
| `npm run smoke-test`                                     | PASS; `SMOKE_TEST_PASS`                                                 |
| `npm run security-check`                                 | PASS; `SECURITY_CHECK_PASS` plus 14/14 protected runtime workflow tests |
| `npm run format:check`                                   | PASS; all matched files formatted                                       |
| `node --test dist/tests/architecture-boundaries.test.js` | PASS; 4 tests, 4 passed, 0 failed                                       |
| Milestone 2A.1 adversarial suite                         | PASS; 22 tests, 22 passed, 0 failed                                     |
| Milestone 2A.2 adversarial suite                         | PASS; 29 tests, 29 passed, 0 failed                                     |
| Milestone 2A.3 adversarial suite                         | PASS; 13 tests, 13 passed, 0 failed                                     |
| Milestone 2A.4 adversarial suite                         | PASS; 15 tests, 15 passed, 0 failed                                     |
| Milestone 2A.5 adversarial suite                         | PASS; 19 tests, 19 passed, 0 failed                                     |
| Milestone 2A.6 adversarial suite                         | PASS; 19 tests, 19 passed, 0 failed                                     |
| Milestone 2A.7 adversarial suites                        | PASS; 96 tests, 96 passed, 0 failed                                     |
| Milestone 2A.8 adversarial suite                         | PASS; 70 tests, 70 passed, 0 failed                                     |
| Milestone 2A.9 adversarial suite                         | PASS; 15 tests, 15 passed, 0 failed                                     |
| Milestone 2A.10 adversarial suite                        | PASS; 15 tests, 15 passed, 0 failed                                     |
| `git diff --check`                                       | PASS; no whitespace errors                                              |

The exact corrective commit and exact-commit private CI evidence are reported in the delivery response after the single commit is pushed and observed. No general schema-v7 upgrade, public-release, production, coverage, performance, or scientific-validation claim is made.

## Milestone 2B.1 — validated, atomic and auditable CSV interchange

- [x] Implemented one fixed CSV experiment schema, strict preview, canonical batch transaction and immutable completion/source mappings in schema 13.
- [x] Added current authority checks, scoped durable retries, bounded deterministic spreadsheet export and a minimal `/csv` page.
- [x] Local unit/architecture tests 378/378 and integration tests 21/21 pass; record/map/seal/audit/COMMIT rollback, separate-process race and disk-reopen receipt tests pass.
- [x] Frozen migrations 001–012 plus 002 preflight verified byte-for-byte against the accepted parent.
- [ ] Independent ChatGPT adversarial audit remains PENDING.
- [ ] Manual key, asset-rights/consent, historic deployment and external schema-v7 inventory blockers remain OPEN.

The [implementation result](milestone-2b-1-result.md) and [CSV contract](csv-interchange-v1.md) record the actual scope. Final private Git SHA, exact-SHA CI and clean ZIP evidence are in the post-commit delivery manifest. This is one 2B.1 implementation gate; 2B.2 has not started.

## Milestone 2B.1 — independent review corrections

Beta.13 fixes two independently reproduced P2 defects: finite inputs producing a nonfinite yield, and a lost-response retry becoming a new import after another file preview. Migration 014 is additive; all released migrations remain unchanged. The independent reviewer reran 36 CSV/numeric tests and the original UI exploit; seven new actual-client tests cover retry recovery. See [the corrective result](milestone-2b-1-correction-result.md). Full gate and exact-commit CI evidence accompany the delivery. Durable evidence implementation starts only after those checks succeed.

## Milestone 2B.2 — durable evidence and recovery

Beta.14 adds private record attachments, matching CSV originals, immutable metadata, current-scope download/archive rules and verified SQLite-plus-evidence backup/restore. Migration 015 is additive. The independently reviewed design and concrete failure boundaries are in [the contract](milestone-2b-2-plan.md); actual implementation and targeted checks are in [the result](milestone-2b-2-result.md). Full-project and exact-commit CI evidence accompany the delivery. The next stage consumes sealed inputs in Python; this stage does not claim analysis execution.

## Milestone 3 and bounded Milestone 4 — status recovery

Beta.15 implemented the sealed Python analysis/reproduction pipeline; beta.16 added report evidence cards and optional constrained ordering. Their design/results are recorded in milestone-3-plan.md, milestone-3-result.md, milestone-4-plan.md and milestone-4-result.md. Independent post-implementation audits remain pending. Earlier milestone statements above describe their historical state, not missing current functionality.

## Milestone 4 continuation — project-guide retrieval

2026-09-05: recovered the original development plan. The next bounded implementation is first-party Markdown chunks, FTS5/BM25 search, exact citations, explicit refusals, no raw-question persistence or provider transmission, 42 offline evaluation cases, current-scope HTTP/client tests and corrected project/defence documentation. See development-plan-status.md, retrieval-v1.md and milestone-4-retrieval-result.md. Historical migrations and scientific methods remain frozen. Full-project checks and private CI follow the implementation; independent review and all four owner release blockers remain pending.

Initial beta.17 author-side gate: Node 566/566; HTTP 31/31; Python 63 plus five subtests; evidence evaluation 25/25; retrieval evaluation 42/42; clean install/lint/type/build/format/smoke/security/pip checks PASS. Remote commit/CI and archive verification are recorded in the delivery manifest after observation. Independent review remains pending.

A separate corrective commit moves the bundled corpus outside Docker runtime volumes. Correction checks: Node 567/567; HTTP 31/31; packaging/retrieval/client 9/9; retrieval evaluation 42/42; build/lint/format/smoke PASS. Initial beta.17 CI passed, but final acceptance uses the correction commit’s own run.

## Milestones 5–6 — engineering entry and submission recovery

2026-10-04, beta.18: added an English project entry and `/engineering`, a paper/green/citrus visual treatment, a shorter repository reading route and a runnable 20-record synthetic case. The earlier classroom entry remains at `/classroom`. The scientific demo now has readable output and a hard process timeout.

Targeted review reproduced and repaired three problems: empty/tied/teacher-reviewed descriptive output, authenticated demo-chart isolation, and account-unscoped browser recovery with late retry identifiers. Student submission intent is now persisted before transport and checked against current account/class context. Legacy unscoped drafts remain available for manual export. No released migration or Python scientific algorithm changed.

Local checks: Node 596/596, HTTP 38/38, Python 63 plus five subtests, evidence evaluation 25/25 and retrieval evaluation 42/42. Lint, typecheck, build, format, smoke completion and security checks passed. Headless Chromium checks of `/` and `/engineering` at widths 1440, 390 and 320 verified no page overflow, no script exceptions and the keyboard skip link; screenshots were inspected. An initial narrow-screen code-block overflow was corrected. This is a focused visual check, not full accessibility certification.

An obsolete source-string test failed after the outbox replacement; it was replaced with the new module boundary assertion and strengthened behavioral receipt checks. Targeted AI-assisted review is recorded in engineering-notes.md; independent statistical/security acceptance and owner release blockers remain pending. Exact Git/CI and archive evidence are recorded after the remote commit is observed.

A follow-up outbox review reproduced a missed-observation error that the initial beta.18 green CI did not cover: browser key enumeration could select an older confirmed receipt instead of a second equal-valued pending observation. The correction preserves a tab's exact active token, restores unresolved intent before historical receipts, refuses ambiguous pending matches and reports mixed background outcomes accurately. Four additional browser regressions failed before the fix and pass after it; the reviewer's two original before-/after-server-commit failure reproductions also pass. The implementation history retains the initial and corrective commits separately.

## Scientific numeric and input-boundary correction — beta.19

2026-10-04: a separate targeted review reproduced two P2 numerical errors despite the prior green gate. `[3,5,6,7,10]` incorrectly flagged its upper-fence observation; four exactly equal decimal group means produced R² = −8.5. Exact decimal order statistics and a coherent centred-response OLS fit correct those cases without an epsilon fence or a clipped R². Tests retain nearby unequal values and extreme scales. See [the review record](scientific-roundoff-review.md) and updated scientific protocol.

Node/Python text and date validation now agrees for prospective records and newly sealed inputs. Released-migration dependencies retain their historical snapshot rules through an explicit compatibility profile. Regression checks verify those old acceptance rules and atomic rollback of a rejected new seal while preserving existing records and earlier inputs. No migration file or stored historical report was rewritten.

Integrated local gate: Node 606/606; HTTP 38/38; Python 88 plus five subtests; evidence evaluation 25/25; document retrieval 42/42; lint/typecheck/build/format/smoke/security checks pass. Actual Chromium student-form verification confirms two equal-valued observations remain distinct after the second fails before reaching the server and is retried with its original token. The scientific fixture's rounded conclusions are unchanged, but its result hash and Python code identity change. Exact remote CI and archive observations follow in the delivery record.

## Method comparison and scientific packaging — beta.20

2026-10-04: the fixed method study compares constant, linear and production quadratic fits across five synthetic scenarios and twelve paired seeds. The central counterexample uses two generating responses that agree at all four measured concentrations but disagree between them. Its twelve paired observed datasets and production results have identical hashes; their known unseen prediction errors differ. All scenarios, baselines, trial-level outputs and unavailable candidates remain visible. This is a designed simulation, not literature reproduction, independent statistical acceptance or evidence of chemical efficacy.

The separate audit command reconstructs the random observations and numerical predictions without importing the generator's fitting helpers. It checks 60 runs, 720 concentration-level validation folds and 2,340 grid predictions, with a maximum observed prediction difference below 3e-14. Tampered predictions and a leaked held-out concentration are rejected. Review also found that the first CLI wrapper accepted a structurally partial report; nested output checks and malformed-output regressions now reject it. Eighteen Python tests were added across the generator/boundary and independent numerical checker. Production Python analysis files, the dependency lock and all released migrations are unchanged from beta.19.

The combined Node/Python image uses digest-pinned official bases, locked packages, a non-root user and a read-only root filesystem. A separate workflow builds the actual image, executes the synthetic study, exercises the real supervised HTTP calculation and retrieval, then restarts and reproduces the saved run. Compose supplies an init parent because the worker rejects a PID 1 Node supervisor. The guide explicitly addresses old bind-mounted data versus the new named volumes. Local source-path acceptance is recorded separately from the remote container result; only an observed successful workflow establishes container acceptance for this commit.

Local integrated checks: Node 606/606, HTTP 38/38, Python 106 plus five subtests, evidence evaluation 25/25 and retrieval evaluation 42/42. Lint, typecheck, build, format, smoke and runtime security checks pass. Three existing source assertions initially failed because they expected the previous version literal, unpinned Node image and bind-mount-only syntax; these were updated for the actual version, digest-pinned Node stage and both supported mount forms, preserving the corpus-isolation assertion. The real container acceptance is an additional gate, not a substitute for these checks.

The README, scientific report, two generated figures, English project pages and Chinese walkthrough present the question and negative findings. Browser checks at 1440, 390 and 320 pixels found no horizontal overflow or page errors. A course-context note maps concrete evidence to the published DIS themes and explicitly leaves large-scale/HPC proficiency and literature reproduction unclaimed. Exact remote Git/CI, image and archive identities are recorded after observation in the delivery record. Owner release blockers and independent statistical/security acceptance remain open.

## Follow-up measurement design — beta.21

2026-10-04: a fixed two-hypothesis experiment follows the observational-alias counterexample. Seventeen possible concentrations are scored by the absolute difference between two fully specified curves before any new response is generated. The selected 2% concentration is compared with an old point and an off-centre point under three known Gaussian noise levels and three independent replicate counts. The report preserves 54 conditional cells, 27 equal-prior summaries and 540,000 paired classification decisions. It is a separate mathematical study, not a production-model change or a real chemical experiment.

A separate checker reconstructs all 18 random batches and all classification counts using a signed-midpoint rule and alternative polynomial expressions. It checks analytic probabilities, configuration, design predictions and the fifth-point counterexample without importing the generator. Twenty-nine focused Python tests cover this study and audit, including complete output validation, altered identities, invalid JSON, subprocess bounds and internally consistent fabricated counts. An initial integrated run found three CLI-audit tests depended on the author's inherited PYTHONPATH; the tests now explicitly supply the module path and are rerun through the normal npm command. This correction does not alter the study output or production environment.

The engineering page adds a local interactive comparison with a generated 153-value normal-tail table, an accessible range input and native selects. Independent numerical integration checks the probabilities. The default remains readable without JavaScript; tiny nonzero probabilities are never formatted as zero. No account, request to a model provider, classroom query or browser storage is involved. Six new Node tests and focused Chromium checks at 1440, 390 and 320 pixels cover behavior, keyboard input, script-disabled fallback, CSP errors and overflow. The static two-panel figure and Chinese walkthrough expose the same calculation and its assumptions.

The full local gate passes Node 612/612, HTTP 38/38 and Python 135 plus five subtests, with evidence 25/25, retrieval 42/42, lint, typecheck, formatting, smoke and security checks passing. Exact-head CI results are recorded after completion. Both standard and actual-container workflows now run the new study and audit. Source and plotting checks retain the previous production analysis, locked scientific dependencies and released migrations unchanged. A separate authentication correction is next: temporary passwords currently receive ordinary sessions, and changing a password must invalidate older sessions rather than merely clearing a flag. Independent human acceptance and owner release conditions remain open.

## Credential/session correction and bilingual application materials — beta.22

2026-10-05: the owner requested continued work from the stalled architecture-review conversation and confirmed that the final presentation must support study-abroad project materials, switch between English and Chinese and use English as the primary language. Recovery compared the saved beta.20 archive with the actual private PR and restored the newer beta.21 head before making changes.

Temporary-password sessions now have a server/domain restriction before protected classroom access. Changing the credential uses a live-session and expected-hash guard, clears the cookie and requires a new sign-in. Additive migration 017 invalidates pre-upgrade sessions once and revokes live sessions on credential, role, username, class, group or status changes. Revocation failure rolls back the credential write. Guarded session insertion rejects a previously verified stale user snapshot; guarded account imports cannot restore superseded credentials. JSON mode rechecks live security state but retains its documented weaker guarantees. Backup/restore now accepts schemas 15, 16 and 17 without rewriting older backup ledgers during restoration.

The project and engineering pages, dynamic follow-up explanation, three role-login pages and password page now default to English with Chinese switching. A separate cookie retains language; appending it cannot overwrite a session or logout cookie. The two scientific presentations share tables, equations, SVG geometry and numeric lookup data. The static default and native account forms work without JavaScript. The original classroom workflow remains Chinese. An English application appendix and matching Chinese draft explain the scientific question, demonstrable corrections and contribution/claim boundaries without inventing personal authorship or real outcomes.

The locked Python 3.12.13 environment passes 135 tests plus five subtests. Node passes 630/630 and HTTP passes 46/46; evidence and retrieval regressions retain 25/25 and 42/42. Earlier integrated runs exposed outdated schema/version assertions, authorization expectations that assumed retired sessions remained active, and a response mock lacking the standard header-read method. Those checks were corrected while retaining released-migration fingerprints, fresh-session class permissions and historical scientific evidence. Production analytics, the scientific lock and released migrations 001–016 are unchanged. Remote CI, final source/archive identity and focused browser acceptance are recorded after observation in the delivery record. This is AI-assisted developer verification; independent human acceptance and owner release conditions remain open.

## Bilingual evidence workflows — beta.23

2026-10-05: continued private development toward the owner’s English-primary, English/Chinese study-abroad project presentation. Scientific analysis, report explanations, CSV and record/batch attachment pages now share the saved language choice. Native locale links retain the class, report or attachment target; invalid/duplicate parameters are rejected and API contracts remain strict.

The fixed interface catalog localizes controls, dynamic states, confirmations and known validation messages. A separate English reading aid uses the same cited report fields and fixed method explanations. The released evidence builder, canonical text, source values, citation IDs and evidence/answer hashes remain unchanged and inspectable. Retrieval excerpts retain their original language. User records, notes, filenames and receipt JSON bypass the interface catalog. Unknown server diagnostics retain their original detail under an English heading/code.

New English-to-Chinese reload regressions retain the same analysis request, CSV batch and upload receipt after interrupted responses. A real headless Chromium review covered 30 layouts at 1440, 390 and 320 pixels, all nine report topics, 80 identical numeric table cells across languages, exact original CSV attachment and successful locale replay for CSV/evidence. It found and corrected long-hash wrapping on small screens. Final browser review observed no page overflow or script/CSP exceptions.

Observed local checks: Node 649/649; real HTTP workflows 46/46; locked Python 3.12.13: 135 tests plus five subtests; grounded evidence 25/25 and retrieval 42/42; build, typecheck, lint, formatting, security and smoke checks pass. Baseline/security release identity checks were updated to beta.23. Scientific calculations, dependency locks, released migrations and canonical evidence generation were not modified. Exact private Git/CI and container identities are recorded after remote observation in the delivery record.

The English and Chinese application appendices now include the concrete decision to separate translated presentation from canonical evidence. Older classroom views, independent human statistical/security acceptance and owner release conditions remain pending. No personal authorship or real classroom benefit is inferred from synthetic checks.

## Bilingual evidence trail and source-reading guide — beta.24

2026-10-05: the public `/walkthrough` page follows a selected invented record through its bound review, sealed input and actual worker group mean. It shares the English-default language preference, preserves source identifiers, digests and commands across languages, and uses native disclosures without requiring JavaScript. It reads no classroom store or model response and explicitly identifies synthetic review actors/events.

The read-only `project:trace` command checks all twenty canonical input byte digests, their ordered manifest and bound review identities, then runs the existing offline Python calculation and requires the same dataset identity. It changes a detached copy's oil mass and derived yield while keeping the saved digest, observes rejection by the input-byte check, and verifies the untouched original. This exercise demonstrates a digest mismatch rather than database isolation or independent measurement truth. Tests also reject a wrongly bound review even after its input, dataset and execution digests are recomputed consistently.

English and Chinese source-reading guides connect each question to code and meaningful checks, and describe a dated log of work actually performed. The technical appendix replaces its internal application reminder with a factual development-tool note. AI assistance remains recorded in the development notes; the materials do not assert personal implementation or supply a personal statement.

Observed local verification: Node 654/654; HTTP 46/46; build/typecheck, lint, formatting, smoke and runtime security checks pass. Five new trace tests cover actual worker agreement, no fixture writes, altered seals, semantic review binding, bilingual page/fixture agreement and strict CLI options. Focused real Chromium checks cover 18 public-page layouts plus the 30 data-workflow layouts, native keyboard disclosure and script-disabled language switching, with no remaining overflow or page/CSP exceptions. The workflow check retains nine topics, 80 identical numeric cells and successful original CSV/attachment locale replay.

The first complete run exposed an escaped old-version expectation and an attachment fixture startup timeout. The version assertion was updated, and both full suites passed in a serialized rerun without weakening the startup check. The browser harness initially attempted a second context under single-process Chromium; a separate browser launch now verifies the script-disabled path. Production analytics, scientific fixtures, method studies, canonical evidence generation, locked dependency versions and released migrations are unchanged. Current-head remote CI and actual-image trace/restart acceptance are recorded separately after observation. Older classroom localization, independent human acceptance and owner release conditions remain open.
