# Milestone 2A.9 Result

## Status

PARTIAL: the beta.10 repository implementation and complete local verification gate pass, but owner/deployment attestations remain open. Milestone 2B has not started.

This status does not claim a general schema-v7 upgrade, public release, production readiness, performance, coverage, or scientific validation.

## Verified delivery baseline

- Reviewed beta.9 `HEAD`: `30ff79c3dbf62e72d667c6baa76384e4f50a4e36`.
- The initial worktree was clean and private `origin/main` matched that exact SHA.
- Exact baseline GitHub Actions run: `32567757826`, conclusion `success`.
- Migration 010 remains byte-for-byte unchanged with accepted Git blob `438cdba4620b51eb9baf8c6e7f7f4a7fe7e90e65`.
- Migrations 001–010 and the frozen version-2 preflight retain their accepted contents and executable fingerprint controls.
- Repository and inspected local runtime evidence does not establish whether any durable schema-v7 database, deployment copy, or backup exists elsewhere. That inventory remains `UNKNOWN` pending owner attestation.

## Initial red phase

The first new Milestone 2A.9 suite ran 15 tests against beta.9: 8 existing guarantees passed and 7 tests failed. The failures reproduced repository acceptance of a legacy review for an ordinary canonical record both outside and inside a transaction, raw SQL acceptance on a canonical record, and raw post-completion insertion that became effective and changed the record review projection.

The final Milestone 2A.9 suite passes 15/15.

## Repository legacy-review authority

When the Migration 010 schema is present, the infrastructure-only `importReview` capability now requires an active database transaction, an existing `legacy_canonical_snapshot` target with a non-null `storage_import_id`, a matching `legacy_import_batches` row, and no matching `storage_imports` completion marker. Ordinary canonical targets, unbound targets, calls outside a transaction, mismatched batches, and completed batches fail closed.

The ordinary `ReviewRepository` and application services do not expose the legacy import capability. Authorized human review continues through the existing trusted review path.

## Database legacy-review authority

Migration 011 adds a prospective `BEFORE INSERT` guard for `record_reviews` rows whose provenance kind is `legacy_projection`. A new row is accepted only when its target is a legacy canonical snapshot bound to a matching open import batch without a completion marker. Canonical records and completed imports cannot receive a new legacy projection through raw SQL.

Migration 011 validates its required Migration 010 schema, unexpected trigger state, and foreign-key consistency before installing the guard. No released migration was edited.

## Historical evidence preservation

Migration 011 does not update or delete existing immutable review rows. Previously stored `legacy_projection` evidence remains readable even when the older schema could not preserve durable per-review batch authority.

The guard is prospective. Event time is not treated as insertion time, and Migration 011 does not infer that a historical review was inserted after import completion merely from its scientific or review timestamp.

## Atomic import and human-review compatibility

The startup import still commits imported users, records, legacy reviews, the import batch, and the durable completion marker in one transaction. A failure rolls all of them back. A legitimate legacy review is accepted before the marker is written, while repository and raw legacy-review attempts after completion fail.

The existing human review path remains unchanged: an authorized human review may be appended after import completion and retains the existing reviewer identity, role, trusted-clock, status, and chronology constraints.

## Verification results

- Runtime: Node.js `v24.14.1`; npm `11.11.0`.
- `npm ci`: 94 packages installed, 95 audited, npm reported 0 vulnerabilities.
- Lint, strict TypeScript typecheck, build, formatting, and `git diff --check`: passing.
- Main suite: 336/336 passing.
- Integration suite: 14/14 passing.
- Architecture boundary suite: 4/4 passing.
- Milestone 2A.4 temporal suite: 15/15 passing.
- Milestone 2A.5 analysis-selection/run-integrity suite: 19/19 passing.
- Milestone 2A.6 analysis-input-sealing suite: 19/19 passing.
- Milestone 2A.7 adversarial suites: 96/96 passing.
- Milestone 2A.8 adversarial suite: 70/70 passing.
- Milestone 2A.9 adversarial suite: 15/15 passing.
- Smoke test: `SMOKE_TEST_PASS`.
- Security check: `SECURITY_CHECK_PASS`, including 14/14 protected runtime workflow tests.
- Coverage was not run; no coverage claim is made.

Exact corrective commit SHA and exact private GitHub Actions run are reported in the delivery response after the single commit is pushed and observed; they are intentionally not self-referential content in that commit.

## Remaining limitations and manual blockers

- External durable schema-v7 database, deployment, backup, and copied-data inventory remains unknown pending explicit owner attestation.
- The old DeepSeek API key revocation remains an unconfirmed manual owner action. No key is committed, printed, copied, migrated, or placed in CI.
- Bundled asset provenance, consent, and redistribution rights remain unconfirmed owner actions.
- Legacy deployed demo-account audit remains an owner action.
- The local JSON compatibility adapter remains weaker than authoritative SQLite.
- Pre-Migration-011 legacy-review insertion authority cannot always be reconstructed because older schemas did not preserve insertion time or durable per-review batch membership.
- No complete append-only record-version ledger, cross-language canonical hash contract, analysis executor, or Milestone 2B feature is claimed.

## Suggested commit

`fix: bind legacy reviews to active import batches`
