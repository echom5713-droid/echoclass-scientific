# Milestone 2A.8 Result

## Status

PARTIAL: the beta.9 repository implementation and complete local verification gate pass, but owner/deployment attestations remain open. Milestone 2B has not started.

This status does not claim a general schema-v7 upgrade, public release, production readiness, performance, coverage, or scientific validation.

## Verified delivery baseline

- Reviewed beta.8 `HEAD`: `71602d86e0b11bce337db1cbb266b92ce683af1c`.
- The initial worktree was clean and private `origin/main` matched that exact SHA.
- Exact baseline GitHub Actions run: `32559773886`, conclusion `success`.
- Migration 009 remains byte-for-byte unchanged with accepted Git blob `6528a8d26aa8c86fe67937d823cdb9f4bb77c600`.
- Migrations 001–009 and the frozen version-2 preflight retain their accepted fingerprints.
- Repository and inspected local runtime evidence does not establish whether any durable schema-v7 database, deployment copy, or backup exists elsewhere. That inventory remains `UNKNOWN` pending owner attestation.

## Initial red phase

The first new Milestone 2A.8 suite ran 30 tests against beta.8: 8 existing guarantees passed and 22 tests failed. Those failures reproduced physical record/run deletion, offline-token release, creator-label forgery, missing creator authority, inconsistent online/offline provenance, absence of a durable import boundary, and runtime classification-ledger insertion.

The final Milestone 2A.8 suite contains 70 tests and passes 70/70.

## Physical-deletion authority

Migration 010 installs direct `BEFORE DELETE` guards for every experiment record and analysis run, including unreferenced active and archived rows. Review and analysis-input deletion guards remain unchanged. A failed physical deletion cannot release an offline idempotency token.

The ordinary repository delete remains a monotonic soft lifecycle transition to `status='deleted'` with a strictly advanced `updated_at`. Explicitly scoped infrastructure audit reads retain the immutable scientific record, submission snapshot, reviews, and analysis links.

## Canonical attribution and offline provenance

`PersistExperimentCommand` is the ordinary authoritative path and requires `created_by_user_id`. A canonical insertion must reference an existing account and its creator label must match that account's current username or name. Raw SQL and repository writes enforce the same rule.

Online insertion requires `synced_from_offline=false` with no client submission token or idempotency class scope. Offline insertion requires `synced_from_offline=true`, a client submission token, an authoritative creator, and immutable initial class scope equal to the record class. Creator, origin, token, class scope, submission kind, submission snapshot, and creation evidence are immutable after insertion.

## Legacy import authority

Legacy import uses a concrete infrastructure-only `importExperiment` capability that is absent from the ordinary application repository interface. It preserves unresolved or historical creator labels without comparing them with later account names and records the explicit legacy submission origin.

Migration 010 adds `legacy_import_batches` and immutable `storage_import_id` row binding. The startup importer opens the fixed `json-startup-v1` batch only for an empty authoritative database and commits imported users, records, reviews, the batch, and its matching `storage_imports` completion marker in one transaction. Any failure rolls back the whole import; a completed or post-hoc batch cannot authorize later imports.

The released pre-Migration-010 completion marker did not bind individual rows and did not record database insertion time. Migration 010 therefore conservatively treats surviving rows as potential imported members and never infers membership from `created_at` or `updated_at`, which are event/version clocks rather than insertion clocks.

## Migration 010 preflight and historical classification

Before installing the new contracts, Migration 010 verifies that its physical-delete and authority guards are absent, runs foreign-key consistency checks, audits canonical creator/offline contradictions, validates storage-import evidence, and validates every released provenance-classification row against canonical timestamps, migration identity, taxonomy, target entity, field, reason, and reconstructible semantics.

Definite corruption fails closed with exact entity or classification identifiers and fields. Definite historical offline contradictions are truthfully classified as unverified and any affected exact analysis run is downgraded without rewriting immutable submissions or creator evidence. Historical account label/state disagreement is treated as ambiguity, not proof of corruption, because current account state cannot establish past identity.

Migration 010 preserves genuine Migration 008/009 classifications, including temporal-offset, version-collision, review-chronology, sequence-reversal, and incomplete-dataset evidence, while rejecting well-shaped rows whose durable semantics do not support their claim. It also independently seals canonical creator/origin evidence and released storage-import markers.

## Migration-authoritative classification ledger

Migration 010 may append its own classifications inside its migration transaction, then installs an unconditional runtime insertion seal. Ordinary `INSERT`, `INSERT OR IGNORE`, `INSERT OR REPLACE`, explicit-ID insertion, `UPDATE`, and `DELETE` all fail. A future migration may append classifications only by explicitly removing and reinstalling the seal inside that migration's transaction.

The seal cannot prove the absence of a sophisticated pre-Migration-010 forged row that exactly mimics every released migration contract and whose current durable semantics match the claimed classification. The earlier schema did not preserve insertion authority or insertion time, so this historical uncertainty is disclosed rather than inferred away.

## Compatibility boundary

The supported beta.9 upgrade boundary remains:

1. a fresh database applying migrations 001 through 010; or
2. an existing database whose `schema_migrations` ledger already records the accepted Migration 008.

Executable fixtures retain the known schema-v7 stop behavior: a valid historical review followed by reviewer rename, disablement, or role change can stop inside immutable Migration 008. Migration 010 cannot repair a database it never reaches. If any durable schema-v7 database exists, it must not be upgraded until the owner authorizes a separately reviewed copy-based compatibility path.

## Verification results

- Runtime: Node.js `v24.14.1`; npm `11.11.0`.
- `npm ci`: 94 packages installed, 95 audited, npm reported 0 vulnerabilities.
- Lint, strict TypeScript typecheck, build, formatting, and `git diff --check`: passing.
- Main suite: 321/321 passing.
- Integration suite: 14/14 passing.
- Architecture boundary suite: 4/4 passing.
- Milestone 2A.4 temporal suite: 15/15 passing.
- Milestone 2A.5 analysis-selection/run-integrity suite: 19/19 passing.
- Milestone 2A.6 analysis-input-sealing suite: 19/19 passing.
- Milestone 2A.7 adversarial suites: 96/96 passing.
- Milestone 2A.8 adversarial suite: 70/70 passing.
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
- Pre-Migration-010 physical deletion and perfectly contract-mimicking forged classification evidence cannot be reconstructed after the fact.
- No complete append-only record-version ledger, cross-language canonical hash contract, analysis executor, or Milestone 2B feature is claimed.

## Suggested commit

`fix: close deletion attribution and audit-ledger authority`
