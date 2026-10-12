# Milestone 2A.1 result

## Status

PASS, subject to the exact commit containing this report completing the private GitHub Actions gate. The immutable run ID, commit SHA and conclusion are recorded in the delivery report and private Actions history because a CI run cannot exist before its commit.

## Independent audit findings addressed

The corrective work covers every reproduced defect: migration-ledger gaps, fabricated legacy defaults, truthy string booleans, replaceable reviews, ambiguous review ties, stale direct-insert projections, cross-record analysis links, mutable/corrupt analysis snapshots, partial JSON import, orphan-producing updates, stale yield, physical deletion, null-actor idempotency and silently discarded measurement provenance.

The genuine red phase ran 15 adversarial tests before implementation: 14 failed and 1 passed. The previously passing case was then strengthened to exercise the normal application connection setting rather than assuming recursive triggers were already enabled. The final focused suite contains 22 executable tests.

## Migration ledger hardening

Migrations `001` and `002` retain their accepted identities. `003-provenance-integrity-hardening` migrates valid version-2 data forward. The runner accepts only an exact ordered prefix of unique known migration versions/names. Database triggers reject update, deletion and replacement of applied ledger rows, and migration rollback behavior remains atomic.

## Legacy data safety

Migration 002 performs strict read-only scientific preflight before destructive DDL. Findings identify record ID, field and reason without printing the rejected value. Missing, non-finite, out-of-range and incorrectly typed observations abort conversion; boolean parsing is explicit. Migration 003 separately audits databases that already recorded version 2 and stops for manual remediation rather than inventing replacement observations.

## JSON import atomicity

Optional JSON-to-SQLite startup seeding is treated as one import snapshot. Users and records are read and validated, imported inside one transaction, count-verified and recorded in immutable `storage_imports`. A later invalid record rolls back every earlier write. Repeated startup consults the marker, while a non-empty SQLite database remains authoritative.

## Review immutability and consistency

Review update, deletion, replacement and duplicate-ID upsert paths are database-rejected. `review_event_order` allocates a monotonic insertion sequence without changing public review IDs. The review `AFTER INSERT` trigger owns the effective pointer, status, note, reviewer and timestamp projection. Equal timestamps and direct infrastructure inserts therefore cannot make history and the canonical projection diverge.

## Analysis provenance integrity

Database triggers enforce that a linked review belongs to the same canonical record. Analysis inputs are append-only, require the `echoclass.analysis-input.v1` schema marker and valid JSON, and reject replacement. Repository reads validate required snapshot structure and throw `RepositoryCorruptionError` rather than fabricating `{}`. Production canonical serialization/hashing remains intentionally unresolved.

## Record update and deletion semantics

`UpdateExperimentCommand` explicitly excludes identity, creator, client submission, creation, original submission, review and effective-pointer fields. The SQLite update validates the merged record, creates any class/group references and writes the record in one transaction, recalculating yield from current masses. The immutable submission snapshot remains unchanged. Ordinary deletion now archives with `status=deleted`; normal lists hide the row and an explicitly scoped infrastructure method can retrieve it for audit.

## Idempotency and measurement provenance

Canonical SQLite rows with `client_submission_id` require a non-null authenticated creator. Unresolved legacy tokens move to explicitly labelled metadata and do not receive a false durable-scope claim. JSON mode remains weaker. Experiment date, optional Petri-dish diameter and measurement method now pass through the command, validation, normalized columns, submission snapshot and analysis snapshot.

## Node runtime decision

Package engines, `.nvmrc`, Docker and GitHub Actions select Node.js 24. EchoClass does not suppress the `node:sqlite` warning and does not claim Stability 2, production readiness or deployment readiness.

## Local verification

Run on 2026-08-21 after advancing all current version surfaces to `3.0.0-beta.2`:

| Command                                                  | Actual result                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm ci`                                                 | PASS; 94 packages installed, 95 audited, 0 vulnerabilities reported by npm |
| `npm run lint`                                           | PASS; 0 errors                                                             |
| `npm run typecheck`                                      | PASS; 0 TypeScript errors                                                  |
| `npm run build`                                          | PASS                                                                       |
| `npm test`                                               | PASS; 60 tests, 60 passed, 0 failed                                        |
| `node --test dist/tests/provenance-hardening.test.js`    | PASS; 22 tests, 22 passed, 0 failed                                        |
| `npm run test:integration`                               | PASS; 12 tests, 12 passed, 0 failed                                        |
| `npm run smoke-test`                                     | PASS; `SMOKE_TEST_PASS`                                                    |
| `npm run security-check`                                 | PASS; `SECURITY_CHECK_PASS` and 12/12 integration tests                    |
| `npm run format:check`                                   | PASS                                                                       |
| `node --test dist/tests/architecture-boundaries.test.js` | PASS; 4 tests, 4 passed, 0 failed                                          |
| `git diff --check`                                       | PASS                                                                       |

No coverage, performance, production-readiness or scientific-validity figure is claimed.

## Remaining limitations and manual actions

- Production canonical snapshot serialization/hashing and analysis execution remain unimplemented.
- JSON runtime mode does not provide SQLite-equivalent constraints, concurrency, migration or review-history guarantees.
- General scientific edit history beyond immutable original/analysis snapshots is not implemented.
- The owner must revoke and rotate the previously exposed DeepSeek key; this remains unresolved until the owner explicitly confirms it.
- The owner must verify bundled asset provenance, consent and redistribution rights.
- The owner must audit older deployment data for legacy demo accounts.
- Public release remains blocked. Milestone 2B must begin only after an independent re-audit.

## Version

`3.0.0-beta.2`
