# Milestone 2A.4 Result

## Status

PASS locally for temporal analysis binding and provenance contract closure at `3.0.0-beta.5`. Milestone 2B has not started. Exact-commit private CI evidence is recorded in the delivery report after the corrective commit is pushed and observed.

## Genuine red phase

Before implementation, the executable 2A.4 suite ran 15 mandatory scenarios: 2 existing guarantees passed and 13 audit failures reproduced. The failures covered later-review invalidation of old runs, incorrect historical temporal classification, incomplete SQLite v1 structure enforcement, stale-review insertion, non-authoritative application review modes, incomplete JSON review provenance, false unresolved-creator metadata, undetected historical submission contradiction, and retained image calibration after measurement-context changes.

The two pre-existing passing guarantees were exact omission-reason persistence for an existing review and the released migration/preflight manifest binding already present at the base commit.

## Point-in-time review binding

- Creation in `effective` mode binds only the record's current latest review event.
- Reads validate the exact immutable `record_reviews` / `review_event_order` event named by stored `review_id`, not a later effective projection.
- Explicit `effective`, `omit`, and `none` intent is authoritative. Effective and omit reject unreviewed records; none rejects reviewed records; caller review IDs cannot contradict the selected mode.
- Later review events do not invalidate earlier analysis runs.

## Migration 006 behavior

Migration `006-temporal-analysis-contract-closure` is the only new migration. It:

- reclassifies historical analysis inputs with run creation time, immutable event time and monotonic event sequence;
- preserves plausible old-event point-in-time v1 bindings even when later events exist;
- downgrades forged or temporally impossible inputs to `legacy_unspecified`;
- restores complete database structural/scientific v1 validation and separately enforces current-effective insertion/binding semantics;
- scans historical canonical submissions, fails closed with record ID/field for definite uncorrected contradictions, and marks ambiguous correction histories `submission_agreement_unverifiable`;
- leaves released migrations 001–005 and the frozen version-2 preflight byte-for-byte unchanged.

## Import and measurement provenance

- JSON import strictly validates review IDs, supplied reviewer IDs and ISO timestamps before its transaction. A supplied unresolved reviewer is rejected rather than silently discarded.
- Creator metadata distinguishes `derived_from_imported_user`, `explicit_legacy_unknown`, and `unresolved_creator_reference`.
- Browser calibration state is executable and explicit. Dish-diameter changes invalidate the old calibrated circle; replacement/removal, invalid image, stale asynchronous read and FileReader failure immediately clear calibrated provenance.

## Final local verification

| Command                             | Actual result                                                       |
| ----------------------------------- | ------------------------------------------------------------------- |
| `npm ci`                            | PASS; 94 packages installed, 95 audited, 0 vulnerabilities reported |
| `npm run lint`                      | PASS; 0 errors                                                      |
| `npm run typecheck`                 | PASS; 0 TypeScript errors                                           |
| `npm run build`                     | PASS                                                                |
| `npm test`                          | PASS; 116 tests, 116 passed, 0 failed                               |
| `npm run test:integration`          | PASS; 14 tests, 14 passed, 0 failed                                 |
| `npm run smoke-test`                | PASS; `SMOKE_TEST_PASS`                                             |
| `npm run security-check`            | PASS; `SECURITY_CHECK_PASS` and 14/14 integration tests             |
| `npm run format:check`              | PASS                                                                |
| architecture-boundary test          | PASS; 4/4                                                           |
| temporal-analysis adversarial suite | PASS; 15/15                                                         |
| `git diff --check`                  | PASS                                                                |

No coverage tool, benchmark, scientific validation study, production-readiness assessment, or public-release assessment was run or claimed.

## Remaining limitations and manual blockers

- Owner confirmation of old DeepSeek API key revocation remains open; no real key is stored, printed, copied, or migrated by this work.
- Bundled asset provenance, consent and redistribution rights remain an owner public-release blocker.
- Existing deployments still require an owner audit for legacy/demo accounts and data.
- Historical scientific corrections made before durable correction history cannot always be distinguished from old submission corruption; such ambiguous rows are marked unverifiable.
- JSON fallback remains less durable than authoritative SQLite, cross-language canonical hashing is not specified, and `node:sqlite` / deployment production readiness has not been independently established.
- Milestone 2B, Python analytics, RAG, computer vision, UI redesign and framework/database migration are outside this result.
