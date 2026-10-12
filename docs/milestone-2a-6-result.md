# Milestone 2A.6 Result

## Status

PASS locally at `3.0.0-beta.7`. Milestone 2B has not started. Exact-commit private CI evidence belongs to the final delivery report after the single corrective commit is pushed and observed.

## Initial red phase

The new executable `analysis-input-sealing` suite first ran against the beta.6 implementation with 13 grouped tests: 1 existing archive-selection guarantee passed and 12 tests failed. The failures reproduced missing input sealing, post-creation appends in every run state, mutable terminal results/time, forged `none` review projection, permissive SQL timestamps/control characters, invalid canonical record identity/time/metadata, fail-open metadata reads, and unauthoritative human review identity/chronology.

After implementation the suite contains 19 grouped adversarial tests and passes 19/19. It additionally verifies persistence-generated review identity/time, Migration 008 historical sealing/downgrade/classification, malformed-metadata migration failure, review-ID controls, combined later edit/review/archive stability, and atomic import chronology rollback.

## Analysis input sealing and terminal state

Migration 008 adds `analysis_runs.inputs_sealed`. Ordinary creation writes an unsealed pending run, inserts the complete ordered input set, and sets the one-way seal inside one `BEGIN IMMEDIATE` transaction. Analysis inputs require a pending unsealed run. A run cannot leave pending until sealed, and raw SQL cannot clear the seal.

The first transition to `completed` or `failed` atomically stores the trusted completion time and final object-shaped result metadata. Later terminal mutation is rejected; an exact same-terminal repeat is a no-op at the repository boundary.

## Review and record provenance boundary

Ordinary human review uses `AppendReviewCommand`, which contains intent and actor linkage but no durable event ID, event timestamp, or provenance-kind override. SQLite persistence generates the ID and obtains both event timestamps from its injected trusted clock. Human review requires a real enabled teacher/admin user, a label equal to that user's username or name, a supported decision, canonical timestamps, and non-regressing record/event chronology. Explicit historical import remains a separate path.

Startup import validates user lifecycle times, record creation/update order, review-to-record order, review decision time, and monotonic review sequence before its write transaction. Any invalid supplied chain leaves no users, records, reviews, or import marker.

Canonical experiment persistence validates printable bounded IDs, canonical creation time, non-empty creator label, client-submission identity and object-shaped metadata. Record metadata reads now throw `RepositoryCorruptionError` for invalid or non-object JSON rather than returning `{}`.

## Snapshot binding and active selection

New v1 analysis inputs require an active durable record. Effective and omit modes must carry the exact durable review projection; none mode must have no effective event and empty reviewer/note/time projection with only automated `normal` or `review` status. Later record edits, reviews and archival do not invalidate the immutable historical snapshot.

## Migration 008 preflight and historical handling

Migration 008 inspects record/run/review/input identities, record metadata, run JSON/state/time, review linkage/order/time and v1 review binding before installing new contracts. Definite malformed metadata, invalid identities, invalid state/time, broken human reviewer linkage or impossible chronology fail with entity IDs and fields.

Existing run input sets are sealed. Existing offset timestamps matching the supported historical offset form are recorded in `provenance_boundary_classifications`; immutable source values are not rewritten. Invalid or forged historical effective/omit/none binding is reclassified to the explicit legacy snapshot representation rather than retained as exact v1.

Historical `analysis_inputs` rows have no insertion timestamp. Migration 008 therefore cannot prove whether an old input was appended after terminal completion; it seals the observed set and reports this limitation instead of inventing chronology.

## Verification results

- `npm ci`: 95 packages audited, 0 vulnerabilities.
- Main suite: 154/154 passing.
- Integration suite: 14/14 passing.
- Architecture boundary suite: 4/4 passing.
- Existing temporal suite: 15/15 passing.
- Existing analysis-selection/run-integrity suite: 19/19 passing.
- New 2A.6 adversarial suite: 19/19 passing.
- Smoke test: `SMOKE_TEST_PASS`.
- Security check: `SECURITY_CHECK_PASS`, including 14/14 protected workflow tests.
- Lint, typecheck, build, format check and `git diff --check`: passing.
- Coverage was not run; no coverage claim is made.

## Remaining limitations and manual blockers

- Historical post-terminal input-append chronology is unrecoverable because old input rows have no insertion timestamp.
- No cross-language canonical hash/serialization contract or analysis executor is claimed.
- JSON compatibility mode remains weaker than authoritative SQLite for constraints and concurrency.
- The old DeepSeek key revocation remains an unconfirmed owner action.
- Bundled asset rights/consent and the legacy deployed demo-account audit remain owner actions.
- This result does not claim public-release, production, performance, coverage, or scientific-validation readiness.

## Suggested commit

`fix: seal analysis inputs and provenance boundaries`
