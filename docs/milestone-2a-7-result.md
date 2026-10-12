# Milestone 2A.7 Result

## Status

PARTIAL: the beta.8 implementation and local verification pass, but the owner/deployment compatibility attestation is still open. Milestone 2B has not started.

This status does not claim a general schema-v7 upgrade, public release, production readiness, performance, coverage, or scientific validation.

## Verified delivery baseline

- Reviewed beta.7 `HEAD`: `c265aa22ffa1c1a12557af5d14a332a0b966e1d3`.
- The initial worktree was clean and private `origin/main` matched that exact SHA.
- Exact baseline GitHub Actions run: `32553440861`, conclusion `success`.
- Migration 008 remains byte-for-byte unchanged with accepted Git blob `672479686b7e1c8a815b7599f45229a1de83534a`.
- Migrations 001–008 and the frozen version-2 preflight retain their accepted fingerprints.
- No tracked runtime database or schema-v7 database was found in the inspected repository/local runtime scope.
- Whether Migration 008 was applied to any durable database, and whether an external durable schema-v7 database or copy exists, cannot be established from repository evidence.

## Compatibility decision

The supported beta.8 boundary is:

1. a fresh database applying migrations 001 through 009; or
2. an existing database whose `schema_migrations` ledger already records the accepted Migration 008.

The known ignored local `data/citrus.db` uses the earlier `migrations` ledger (maximum legacy version 212), not the normalized Milestone 2A ledger. Its source was opened read-only and backed up into a temporary system-directory copy. That copy reached schema version 9 with zero `foreign_key_check` findings; the temporary copy was removed. This is one rehearsal, not a declaration that the source is disposable or that every external database is compatible.

The executable schema-v7 fixtures prove that a valid historical review followed by reviewer rename, disablement, or role change stops inside immutable Migration 008, rolls back to version 7, never invokes the sentinel next migration, preserves record/review/user rows, and creates no alias. Migration 009 cannot repair a database it never reaches. A separate positive fixture proves that when Migration 008 was already applied, Migration 009 preserves the immutable event, effective projection, exact v1 input, reviewer ownership, and records the missing historical account-state limitation.

Owner attestation over every deployment, backup, and copied data directory remains required. If any durable schema-v7 database exists, it must not be upgraded until a separately reviewed copy-based compatibility mechanism is authorized.

## Initial red phase

The two new executable suites first ran 66 tests against the beta.7 behavior: 11 existing guarantees passed and 55 tests failed. Those failures reproduced empty/sparse/gapped/duplicate dataset acceptance, forged review projection, chronology/version-time gaps, lossy JSON, TypeScript/SQLite identity and blank-text disagreement, archived-selection and invalid-calendar classification defects, and mutable classification evidence.

The final 2A.7 suites contain 96 tests and pass 96/96.

## Migration 009 and sealed datasets

Migration 009 is `009-sealed-dataset-and-historical-provenance-closure`. Ordinary run creation rejects empty and sparse arrays and duplicate record selections, persists ordinals exactly from zero through `N-1`, and inserts/seals in one transaction.

The database seal transition requires a non-empty set, minimum ordinal zero, maximum ordinal `COUNT(*) - 1`, distinct ordinal count equal to row count, and distinct record count equal to row count. A failed raw completeness attempt rolls back the run and inputs. Historical empty, gapped, non-zero-start, or duplicate-record sealed sets become `legacy_incomplete` and cannot retain an exact reproducibility claim.

## Review projection and chronology

Effective, omit, and none modes now match every durable review-projection field. Effective binds the exact current event; omit requires that current event plus a Unicode-nonblank reason while omitting its snapshot; none requires no effective event, no review snapshot/reason, and exact normal/review compatibility fields.

All review provenance kinds require event time at or after record creation, decision time at or after event creation, non-regressing sequence boundaries, and a projection version strictly after record/event/decision evidence. Any legacy review timestamp or sequence classified as unverified blocks new exact selection and new review events for that record. Human review still requires a real enabled teacher/admin and trusted persistence-generated identity/time.

## Record version-time authority

Every provenance-bearing scientific, measurement, class/group, lifecycle, metadata, offline, note, AI, or review-projection change requires a canonical `updated_at` strictly greater than the prior version. Timestamp-only writes cannot move the clock backward or off grammar, so a caller cannot launder a stale value change through a regressed clock. Authoritative application updates use an injected monotonic clock.

Migration 009 detects pre-version-9 same-timestamp value collisions across durable records and historical v1 snapshots, downgrades every affected exact input, records the limitation, and blocks the record from seeding a new exact dataset. Legitimate earlier point-in-time snapshots remain readable after later strictly versioned edit, review, and archive operations.

## Recursive JSON and shared text contracts

One recursive JSON-safe validator covers experiment metadata, analysis configuration, and terminal result metadata. It allows JSON primitives, finite numbers, dense arrays, and plain objects. It rejects undefined, non-finite numbers, negative zero, BigInt, functions, symbols/symbol keys, accessors, non-plain or serialization-transforming objects, cycles, sparse arrays, and any lossy serialization. Reads fail closed on malformed or non-object JSON.

Current TypeScript and SQLite boundaries share a one-to-256-byte visible-ASCII machine-identifier grammar for record/review/run/input IDs, hashes, versions, and client submission IDs. NUL, NBSP, other non-ASCII text, controls, spaces, and overlong values fail. Human omission reasons use a shared Unicode blank-text policy; NBSP-only, NUL-containing, and other Unicode-whitespace-only values fail.

## Historical classification and ledger

- Explicitly deleted snapshots and active snapshots whose claimed run time is after durable archive are downgraded; a legitimate active selection archived later remains exact.
- Historical offset timestamps are validated by Gregorian components, clock ranges, and offset bounds. Valid ledger-classified offsets remain readable; calendar-invalid offsets become unverified and cannot seed current authoritative review/analysis claims.
- The rebuilt classification ledger stores migration version/name, entity type/ID, field, classification, observed evidence, reason, and canonical classification time.
- Ledger `UPDATE`, `DELETE`, duplicate insert, negative-ID sentinel, and `INSERT OR REPLACE` paths are rejected even when recursive triggers are disabled.

## Verification results

- Runtime: Node.js 24.
- `npm ci`: completed with zero reported vulnerabilities.
- Main suite: 251/251 passing.
- Integration suite: 14/14 passing.
- Architecture boundary suite: 4/4 passing.
- Milestone 2A.4 temporal suite: 15/15 passing.
- Milestone 2A.5 analysis-selection/run-integrity suite: 19/19 passing.
- Milestone 2A.6 analysis-input-sealing suite: 19/19 passing.
- Milestone 2A.7 suites: 96/96 passing.
- Smoke test: `SMOKE_TEST_PASS`.
- Security check: `SECURITY_CHECK_PASS`, including 14/14 protected runtime workflow tests.
- Lint, typecheck, build, format check, and `git diff --check`: passing.
- Coverage was not run; no coverage claim is made.

Exact corrective commit SHA and exact private GitHub Actions run are reported in the delivery response after the single commit is pushed and observed; they are intentionally not self-referential content in that commit.

## Remaining limitations and manual blockers

- External durable schema-v7/Migration-008 deployment state remains unconfirmed by the owner.
- The old DeepSeek API key revocation remains an unconfirmed manual owner action. No key is committed, printed, copied, migrated, or placed in CI.
- Bundled asset provenance, consent, and redistribution rights remain unconfirmed owner actions.
- Legacy deployed demo-account audit remains an owner action.
- The local JSON compatibility mode remains weaker than authoritative SQLite.
- Old analysis inputs still lack insertion timestamps, so historical post-terminal append timing cannot be reconstructed.
- No complete append-only record-version ledger, cross-language canonical hash contract, or analysis executor is claimed.

## Suggested commit

`fix: enforce complete sealed datasets and historical provenance`
