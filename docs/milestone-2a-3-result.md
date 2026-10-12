# Milestone 2A.3 Result

## Status

PASS locally for the independent-audit provenance-semantics repair at `3.0.0-beta.4`. Milestone 2B has not started. Private exact-commit CI evidence is recorded in the delivery report after the corrective commit is pushed and observed.

## Genuine red phase

Before implementation, `node --test dist/tests/independent-audit-repair.test.js` ran 13 executable tests and reported 0 passed / 13 failed. The failures reproduced browser measurement misclassification, alternate submitted-snapshot mismatch, incomplete JSON import provenance, mutable creator labels, nullable idempotency scope, discarded omission reasons, fabricated review snapshots, inconsistent repository reads, forged compatibility projections, mislabeled historical v1 analysis input, and the missing frozen preflight artifact/fingerprint.

## Repairs

- Browser transport now defaults ordinary entry to `manual_direct`. It records explicit local-image state and permits `manual_local_image_calibrated` only after a valid image and completed circle measurement; reset, removal, invalid image, and subsequent manual editing clear calibrated provenance.
- The unrestricted `submitted_values` persistence field was removed. Canonical submission snapshots are produced from the independently validated canonical command, and migration 005 enforces submitted/scientific/measurement agreement on insert.
- Empty-target JSON import preflights bounded non-empty user, record, review, and client-submission identifiers; duplicate IDs; timestamps; creator attribution; and all scientific content before its transaction. Unknown historical creators receive an explicit `legacy-unknown` label plus metadata.
- Analysis review snapshots are cross-validated against their record snapshot and every represented immutable `record_reviews` / `review_event_order` field. Database writes reject fabricated content and repository reads fail closed on inconsistent historical content.
- Migration 005 deterministically repairs effective review projections from the latest immutable event and marks repaired records in metadata. Semantically inconsistent historical v1 inputs are reclassified as legacy.
- `analysis_inputs` now persists `effective`, `omit`, `none`, or migration-only `legacy_unspecified` binding mode plus an omission reason where required.
- Original creator user ID and label are immutable. Client submission tokens require a creator and an existing non-null initial class scope, which remains immutable after later class correction.
- The version-2 preflight is a dedicated frozen historical artifact attached to migration 002. Migrations 001–004 and that artifact have executable accepted-fingerprint coverage; the runner is migration-agnostic.

## Migration 005 behavior

Migration `005-independent-audit-provenance-repair` runs atomically after released migration 004. It repairs review projections from immutable event order, establishes any valid missing idempotency scope or fails with record IDs when scope cannot be established, rebuilds `analysis_inputs` with durable binding fields, reclassifies ambiguous historical rows, and installs the stronger provenance triggers. It does not edit or reinterpret migrations 001–004.

## Final local verification

| Command                        | Actual result                                                       |
| ------------------------------ | ------------------------------------------------------------------- |
| `npm ci`                       | PASS; 94 packages installed, 95 audited, 0 vulnerabilities reported |
| `npm run lint`                 | PASS; 0 errors                                                      |
| `npm run typecheck`            | PASS; 0 TypeScript errors                                           |
| `npm run build`                | PASS                                                                |
| `npm test`                     | PASS; 101 tests, 101 passed, 0 failed                               |
| `npm run test:integration`     | PASS; 14 tests, 14 passed, 0 failed                                 |
| `npm run smoke-test`           | PASS; `SMOKE_TEST_PASS`                                             |
| `npm run security-check`       | PASS; `SECURITY_CHECK_PASS` and 14/14 integration tests             |
| `npm run format:check`         | PASS                                                                |
| architecture-boundary test     | PASS; 4/4                                                           |
| independent-audit repair suite | PASS; 13/13                                                         |
| `git diff --check`             | PASS                                                                |

No coverage tool, benchmark, scientific validation study, or public-release assessment was run or claimed.

## Remaining limitations and manual blockers

- Owner confirmation of old DeepSeek API key revocation remains open; no real key is stored, printed, copied, or migrated by this work.
- Bundled asset provenance, consent, and redistribution rights remain an owner public-release blocker.
- Existing deployments still require an owner audit for legacy/demo accounts and data.
- JSON fallback remains less durable than authoritative SQLite, cross-language canonical snapshot hashing is not yet specified, and `node:sqlite` / deployment production readiness has not been independently established.
- Milestone 2B, Python analytics, RAG, computer vision, UI redesign, and framework/database migration are outside this result.
