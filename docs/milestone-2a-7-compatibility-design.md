# Milestone 2A.7 Migration Compatibility Design

## Purpose and decision status

This document records the compatibility gate that was established before Migration 009 implementation and remains applicable to beta.8 delivery. It does not authorize Milestone 2B, alter any released migration, or classify an unknown external database as disposable.

The repository and known local runtime scope contain no evidence of a schema-v7 database. That finding is narrower than an owner/deployment attestation: databases, copies or backups outside the inspected repository and local runtime path remain unknown. Until the owner confirms that no durable schema-v7 database exists, a general schema-v7-to-beta.8 upgrade claim is blocked.

## Verified beta.7 delivery baseline

The following delivery evidence was verified for the Milestone 2A.6 review baseline:

- Version: `3.0.0-beta.7`.
- Local `HEAD`: `c265aa22ffa1c1a12557af5d14a332a0b966e1d3`.
- Private `origin/main`: `c265aa22ffa1c1a12557af5d14a332a0b966e1d3`.
- Commit: `fix: seal analysis inputs and provenance boundaries`.
- Exact-commit GitHub Actions run: `32553440861`.
- GitHub Actions conclusion: `success` for the exact SHA above.
- The worktree was clean when this compatibility design was started.

GitHub contains the private source baseline and CI evidence. No repository or GitHub deployment evidence was found that identifies an operational database or establishes its schema version. CI databases are disposable test fixtures and are not evidence about an owner's durable deployment.

## Released Migration 008

Migration 008 has already been committed and pushed. It is therefore an immutable released artifact.

- Source: `src/infrastructure/database/migrations/008-analysis-input-sealing-and-provenance-boundary.ts`.
- Accepted Git blob fingerprint: `672479686b7e1c8a815b7599f45229a1de83534a`.

Migration 008 must not be edited, reformatted, renamed, regenerated, moved or amended. The accepted fingerprint must be added to the migration immutability regression alongside migrations 001–007 and the frozen version-2 preflight.

## Known local runtime database facts

The ignored local runtime path contains `data/citrus.db` and its WAL/SHM companions. Only schema metadata was inspected; no user, account, session, classroom or scientific row values were read or printed.

The database has the earlier `migrations` ledger and legacy tables. Its legacy ledger contains two entries and has maximum version `212`. It does not contain the normalized `schema_migrations` table used by Milestone 2A, so it is not a schema-v7 database and does not record Migration 008.

This local database is excluded from Git. Its presence must not be interpreted as permission to delete, replace, migrate or declare it disposable. Its operational value and any required backup or conversion remain owner decisions. Direct upgrade of this legacy ledger is outside the supported beta.8 boundary described below.

No tracked runtime database was found, and no schema-v7 database was found in the inspected repository/local runtime scope. This does not prove that no schema-v7 database, backup, copied data directory or external deployment exists elsewhere.

## Compatibility defect in Migration 008

Migration 008 revalidates a historical human review against the reviewer's current user row. Its preflight requires the current account to retain a teacher/admin role, an active/demo status and a username or display name matching the immutable historical reviewer label.

Those current account properties are not evidence of the account state at the historical event time. A valid review can therefore be rejected after a later reviewer rename, disablement or role change.

The generic migration runner applies pending migrations in version order inside separate transactions. A database whose ledger ends at version 7 must execute Migration 008 before Migration 009. If Migration 008 rejects the historical review, its transaction rolls back, the ledger remains at version 7 and Migration 009 is never reached. Migration 009 cannot repair this failure from behind Migration 008.

The strict reviewer checks on new human review insertion remain appropriate. The defect is historical upgrade inference, not current review authorization.

## Supported beta upgrade boundary

After successful implementation and local verification of Migration 009, beta.8 supports only:

1. A newly created, disposable database applying the complete released migration sequence.
2. An existing database whose `schema_migrations` ledger already records the accepted Migration 008 and whose Migration 008 transaction therefore completed previously.

The following are not covered by that support statement:

- a durable database whose `schema_migrations` ledger ends at version 7 or earlier;
- the local legacy database using the separate `migrations` ledger;
- an external database, backup or deployment whose schema version has not been inspected;
- any upgrade that temporarily renames, re-enables or changes a reviewer account;
- any upgrade that creates alias users, rewrites immutable reviews, changes Migration 008 or silently changes generic migration-runner semantics.

Migration 009 has been implemented within that boundary. If the owner confirms that no durable schema-v7 database or copy exists, the external compatibility gate can be closed for the known deployment inventory. If a durable schema-v7 database exists or may need preservation, that database must not be upgraded until a separately reviewed compatibility mechanism is authorized.

## Executable schema-v7 reviewer-drift fixture

Before any schema-v7 compatibility decision is claimed, an executable fixture must demonstrate the current failure without changing released artifacts. The fixture must:

1. Create a disposable SQLite database and apply the exact frozen migrations through version 7.
2. Create a valid record and a valid human review while the reviewer is an enabled teacher/admin and the immutable reviewer label matches the account at event time.
3. Capture the record and review rows before account drift.
4. Exercise independent variants for:
   - changing both the username and display name after the review;
   - disabling the reviewer after the review;
   - changing the reviewer to a currently unauthorized role after the review.
5. Run the normal migration list containing the immutable Migration 008 and a sentinel Migration 009 step.
6. Assert that Migration 008 reports the exact affected review ID and the historical-reviewer boundary finding.
7. Assert that the sentinel Migration 009 step is never called.
8. Assert that `schema_migrations` still ends at version 7.
9. Assert that the Migration 008 schema objects and classification rows were rolled back.
10. Assert that the captured record and review rows remain byte-for-byte unchanged.
11. Assert that no alias user was created and that the account was not renamed, re-enabled or assigned a different role by the migration process.

A separate positive fixture for future migration logic must start from a database that successfully applied Migration 008 before the reviewer account changed. After a rename, disablement or role change, Migration 009 must complete without comparing historical evidence to current username, name, role or status. It must preserve `reviewer_user_id`, immutable event fields, record projection and any exact v1 analysis binding. It must also record truthfully that schemas through version 8 did not snapshot historical authorization state.

The negative schema-v7 fixture documents the compatibility barrier; it is not a workaround. No test may make the fixture pass by mutating the reviewer or review evidence.

## Compatibility design if a durable schema-v7 database exists

There is no safe repair available solely inside Migration 009 because it cannot execute before Migration 008. Under the current constraints there is also no unused migration position between versions 7 and 8.

If a durable schema-v7 database is identified, the required next artifact is a separately approved compatibility proposal and a copy-based executable migration rehearsal. It must define a distinct, auditable migration identity and ledger semantics; preserve immutable review events and reviewer ownership; classify the missing historical account-state snapshot honestly; verify row counts, foreign keys and rollback; and require a recoverable owner-approved backup before touching the source database.

That proposal may require an explicit compatibility path outside the current generic sequence. It must not be implemented implicitly, presented as the original Migration 008, or inferred from current user-account state.

## Owner attestation required

Repository and CI inspection cannot answer whether an operational or archived schema-v7 database exists outside the known workspace. Before claiming that the compatibility gate is cleared, the owner must explicitly confirm all applicable deployment and backup locations and one of the following:

- no durable schema-v7 database or copy has ever been retained; or
- every durable database already records the accepted Migration 008; or
- a durable schema-v7 database exists and requires the separate compatibility process described above.

Migration 008 application to any durable/non-disposable database is currently unconfirmed. Absence of external schema-v7 data is also unconfirmed. These unknowns must remain visible in the Milestone 2A.7 result and must not be marked resolved from repository evidence alone.
