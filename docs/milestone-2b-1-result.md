# Milestone 2B.1 implementation result

Date: 2026-09-05. Version: `3.0.0-beta.12`. Accepted parent baseline: `728ac2fc11a629b7566f11989fa4df2d17307585` / beta.11. This is the implementation record, not an independent audit PASS. Milestone 2A remains accepted; 2B.2 is NOT STARTED.

## Implemented scope

- Fixed 18-column UTF-8 CSV v1, locked mature parser/stringifier, exact headers, lexical/domain validation, byte/row/buffer limits and capped logical-row errors.
- Zero-write preview, current teacher/admin authority, bounded raw HTTP bodies, origin guard, repeated-header/query rejection, no-store and per-actor rate limits; JSON mode returns 503.
- One synchronous canonical batch transaction, including class-local groups, immutable submitted snapshots, mappings, final completion facts and one success audit. CSV imports do not use offline IDs or startup legacy imports.
- Migration 013 `csv_interchange`: two STRICT tables, deferred batch FK, contiguous mapping/ownership seal, immutable/replace guards and stable uploader/class/token uniqueness.
- Durable replay after lost response/reopen and archival, with current permissions and moved-record protection. All diagnostics use one pre-import active class cohort by stable ID.
- Bounded deterministic spreadsheet export, explicit scalar columns and binary record-ID ordering, real source links, visible text: protection and unchanged stored text.
- Minimal `/csv` page, teacher/admin links, raw ArrayBuffer submission, user-isolated token recovery, explicit new-import warning and text-only preview rendering. Current account is rechecked before page actions.

The exact file and API contract, evidence limits and synthetic fixture warning are in [CSV interchange v1](csv-interchange-v1.md).

## Actual local evidence

Node `v24.19.0`, npm `11.9.0`, Linux scratch execution; fixtures use synthetic users/data and temporary SQLite databases. No production data or provider calls are involved.

| Gate                                                   | Result                                           |
| ------------------------------------------------------ | ------------------------------------------------ |
| npm ci --no-audit --no-fund                            | PASS; locked dependencies installed.             |
| npm run lint                                           | PASS.                                            |
| npm run typecheck                                      | PASS.                                            |
| npm run build                                          | PASS.                                            |
| npm test                                               | PASS, 378/378 including 27 new CSV tests.        |
| npm run test:integration                               | PASS, 21/21 including 7 new live HTTP CSV tests. |
| npm run smoke-test                                     | PASS.                                            |
| npm run security-check                                 | PASS, including integration execution.           |
| npm run format:check                                   | PASS.                                            |
| node --test dist/tests/architecture-boundaries.test.js | PASS, 4/4 in the separate gate.                  |
| git diff --check                                       | PASS.                                            |

Targeted failures exercise record insertion after two prior rows, third mapping insertion, final batch insertion, success audit insertion and actual deferred-FK COMMIT failure. Every failure verifies records/groups/mappings/batches/audit equality to the pre-attempt snapshot, a closed transaction and successful retry with the same token. Two independent child processes synchronize at a start barrier and compete on a real WAL database: one batch, one audit, identical receipt IDs and total one added record. A separate busy-lock fixture verifies 503 and clean retry.

Other tests cover exact 1 MiB and 500-record boundaries, a 501st row, quote expansion beyond the export byte budget, 5001 export records, row-error truncation, malformed UTF-8/headers/quotes, current auth changes after parsing but before the commit transaction, repeated HTTP headers, chunked overflow, legacy/offline misattribution, raw SQL replacement/seal attacks, class renaming, reclassification and archive replay. A test removes the completion trigger inside a rolled-back fixture and demonstrates that a false row_count is then accepted: FK and uniqueness alone do not establish completeness. This is the minimal missing-guard reproduction; no historical 2A protection was disabled in the application.

The first broad regression run exposed stale current-version assertions and a synthetic legacy fixture that did not follow the existing startup-import authority. Those were corrected; historical hash assertions, classifications and guards were not weakened. The first formatting check exposed two ZIP worktree CRLF variants (`.github/workflows/ci.yml`, `docker-compose.yml`); these were restored to the verified remote commit bytes without changing their Git blobs.

## Migration evidence

There are 13 frozen artifacts numbered 001–012 when `002-legacy-preflight.ts` is included. Their working bytes were compared to the authenticated baseline Git blobs and all are unchanged. The external manifest records each SHA-256. Migration 012 remains `c7db6b4f7b3b9078247043a69b37e4afaa93e3731480a5d4c16490c457fda404`. Only registry/current-schema assertions advance to 13. Fresh migrations, schema12 upgrade, idempotent rerun, mid-migration rollback and foreign_key_check are exercised.

## Git and delivery evidence boundary

The private `echom5713-droid/echoclass` main branch and push permission were verified through the authenticated GitHub connection. This environment lacks native Git HTTPS credentials. A verified local shallow checkout was materialized from authenticated baseline commit/tree/blob identities, preserving the actual baseline commit and its existing parent; no replacement baseline commit or fabricated full history was created. Publishing uses authenticated Git Data APIs with the real baseline parent and a non-force main update. Local and remote tree/commit identity are checked before archive creation.

The final SHA, private origin/main equality, exact-SHA CI run/conclusion, clean ZIP digest and per-file migration evidence belong in the post-commit delivery manifest. They are not backfilled into this commit, avoiding a self-referencing commit loop. A remote gate is not PASS until that exact new SHA's workflow completes successfully.

## Remaining limitations and OPEN actions

- No live browser automation or Excel/LibreOffice execution was performed; the actual HTTP workflow and page/script contracts were tested. This is not universal spreadsheet safety certification.
- Raw CSV files and diagnostic cohorts are not retained. Hashes do not prove historical file custody or observation authenticity. Display CSV is not sealed Python analysis input or a round-trip template.
- Manual blockers remain OPEN: old DeepSeek key revoke/rotate; bundled-image/video/GLB copyright, consent and redistribution decisions; historical deployed demo accounts/data review; external durable schema-v7 database/backup/copy inventory and any separately authorized upgrade path. The existing risk register remains authoritative and unchanged.
- No deployment or public release; repository remains private. Independent ChatGPT audit: PENDING. Milestone 2B.2: NOT STARTED.
