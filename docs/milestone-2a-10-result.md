# Milestone 2A.10 Result

## Status

PARTIAL: the beta.11 repository implementation and complete local verification gate pass, but owner/deployment attestations remain open. Milestone 2B has not started.

This status does not claim a general schema-v7 upgrade, public release, production readiness, performance, coverage, or scientific validation.

## Verified delivery baseline

- Reviewed beta.10 `HEAD`: `82735557d1bd51e5d872bc527b77a5b806c51c89`.
- The initial worktree was clean and private `origin/main` matched that exact SHA.
- Exact baseline GitHub Actions run: `32682132706`, conclusion `success`.
- Migration 011 remains byte-for-byte unchanged with accepted Git blob `91fb979d434a493759e3ef21bbde0369938a539e`.
- Migrations 001–011 and the frozen version-2 preflight retain their accepted contents and executable fingerprint controls.
- Repository and inspected local runtime evidence does not establish whether any durable schema-v7 database, deployment copy, or backup exists elsewhere. That inventory remains `UNKNOWN` pending owner attestation.

## Initial red phase

The first complete Milestone 2A.10 suite ran 15 tests against beta.10: 8 existing guarantees passed and 7 tests failed. The fixture created a schema-10 canonical submission, inserted a legacy projection through the released beta.9 raw-SQL path, migrated through schema 11, and demonstrated that the review remained effective and entered a new `echoclass.analysis-input.v1` exact run.

The final Milestone 2A.10 suite passes 15/15.

## Definite historical quarantine

Migration 012 scans immutable reviews joined to their records. Only `legacy_projection` on `canonical_submission` is treated as a definite provenance inconsistency. Each offending review receives migration-owned `legacy_review_authority_unverified` evidence containing its exact review ID, record ID, and the reason the combination cannot truthfully originate under the supported provenance model.

Review events, submitted JSON, scientific fields, and record/review snapshot JSON are not updated or deleted.

## Analysis evidence downgrade

Migration 012 detects exact v1 inputs whose `review_id` directly names an offending review or whose record snapshot names it as the effective review, including omit-mode inputs. It preserves snapshot bytes, changes only the input's exactness representation to the established legacy schema and binding mode, and marks the containing exact run `legacy_unverified`. Durable input/run classifications record the reason.

Future effective, omit, and none selections fail closed through the existing `%unverified` classification mechanism at repository and SQLite boundaries. No second competing selection-authority mechanism was added.

## Classification-ledger authority

Migration 012 verifies required schema-11 tables, columns, guards, and foreign-key integrity. Inside the migration transaction it drops only the Migration 010 classification insert seal, appends its classifications, performs the authorized analysis downgrade with the existing immutability guards temporarily controlled, and reinstalls all seals before completion. Ordinary runtime insert, update, delete, and replacement paths remain blocked.

## Legitimate historical preservation

`legacy_canonical_snapshot` + `legacy_projection` remains readable and is not quarantined merely because an old schema lacked durable per-review batch evidence. Migration 012 does not compare event time with import completion time and does not infer insertion chronology that the released schema did not preserve.

Migration 011 remains the prospective write authority: canonical targets, calls outside an active import transaction, and post-completion legacy writes remain rejected; legitimate pre-completion legacy import and post-completion authorized human review remain valid.

## Verification results

- Runtime: Node.js `v24.14.1`; npm `11.11.0`.
- `npm ci`: 94 packages installed, 95 audited, npm reported 0 vulnerabilities.
- Lint, strict TypeScript typecheck, build, formatting, and `git diff --check`: passing.
- Main suite: 351/351 passing.
- Integration suite: 14/14 passing.
- Architecture boundary suite: 4/4 passing.
- Milestone 2A.1 provenance-hardening suite: 22/22 passing.
- Milestone 2A.2 provenance-closure suite: 29/29 passing.
- Milestone 2A.3 independent-audit suite: 13/13 passing.
- Milestone 2A.4 temporal suite: 15/15 passing.
- Milestone 2A.5 analysis-selection/run-integrity suite: 19/19 passing.
- Milestone 2A.6 analysis-input-sealing suite: 19/19 passing.
- Milestone 2A.7 adversarial suites: 96/96 passing.
- Milestone 2A.8 adversarial suite: 70/70 passing.
- Milestone 2A.9 adversarial suite: 15/15 passing.
- Milestone 2A.10 adversarial suite: 15/15 passing.
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
- Historical insertion time for legitimate legacy reviews remains unreconstructible when older schemas did not retain per-review batch evidence.
- No complete append-only record-version ledger, cross-language canonical hash contract, analysis executor, or Milestone 2B feature is claimed.

## Suggested commit

`fix: quarantine invalid historical legacy reviews`
