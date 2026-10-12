# Milestone 2A independent audit

## Scope and baseline

The direct-code audit examined commit `fa0fd1bb39ec5c3d665eced16ea1b9eccfa04072` (`3.0.0-beta.1`). It did not assess CSV interchange, uploaded evidence, Python analytics, RAG, computer vision or a framework migration.

## Reproduced findings

The corrective suite was added before implementation. Its first execution contained 15 adversarial tests: 14 failed and one passed. The pass reflected the existing `UPDATE`/`DELETE` review triggers when recursive triggers were explicitly enabled; replacement was still unsafe on a normal connection. Reproduced failures were:

1. a migration ledger with version 2 but no version 1 was accepted;
2. syntactically valid but incomplete legacy JSON became zero/empty observations;
3. the legacy string `"false"` became true;
4. normal connections did not guarantee replacement-trigger behavior;
5. equal review timestamps allowed effective lookup and projection to disagree;
6. direct review inserts left the projection stale;
7. raw SQL could link a record to another record's review;
8. analysis inputs allowed mutation and deletion;
9. corrupt snapshots were returned as cast empty objects;
10. JSON startup import committed records one at a time;
11. failed broad updates could leave class/group rows;
12. mass correction left derived yield stale;
13. ordinary deletion physically removed canonical data;
14. a client submission token could be stored without an authenticated creator;
15. experiment date and petri calibration fields were discarded.

The red-phase command was `node --test dist/tests/provenance-hardening.test.js`. It reported 15 tests, 1 pass and 14 failures. No source-regex-only result is used as evidence for these database behaviors.

## Corrective design

Migration 003 advances existing version-2 databases without renumbering migrations 001 or 002. It introduces review event ordering, a database-maintained effective pointer, immutable/versioned analysis inputs, cross-record review-link enforcement, measurement provenance columns, authenticated idempotency guards and a durable startup-import ledger.

The migration runner now requires the applied ledger to be an exact ordered prefix and protects ledger rows from update/delete/replacement. Migration 002 performs a read-only strict preflight for databases that have not yet migrated. Migration 003 independently detects impossible values already present in version-2 legacy rows and reports record IDs plus invalid fields for owner repair; it does not invent replacements.

## Boundaries and retained limitations

- Existing records, reviews, runs, inputs, IDs, timestamps and snapshots are preserved when valid.
- Unresolved legacy offline tokens are retained as explicitly unscoped metadata and do not receive a false uniqueness guarantee.
- Original submission snapshots remain immutable while current corrected columns may change through a restricted command.
- Analysis snapshot serialization is versioned, but canonical cross-language hashing remains unresolved.
- JSON compatibility mode remains weaker than authoritative SQLite mode.
- `node:sqlite` remains behind infrastructure and is not claimed as a Stability 2 production dependency.

## Milestone 2A.2 closure

The follow-up direct-code re-audit reproduced 23 additional adversarial failures: 22/22 in the closure suite plus one HTTP/database measurement round trip. Milestone 2A.2 restores migration 002 to its accepted release content, freezes migrations 001–003 by fingerprint, and puts the evolved version-2 precondition in the transactional runner instead of rewriting historical DDL.

Migration 004 and the hardened repository/import boundaries close end-to-end measurement, canonical yield/science validation, JSON-import atomicity, review-projection, semantic snapshot, effective-review binding, immutable original submission/idempotency, archived audit, and analysis-run identity findings. Remaining production and public-release limitations are recorded in [the Milestone 2A.2 result](milestone-2a-2-result.md).
