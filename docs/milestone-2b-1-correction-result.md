# CSV corrective review — beta.13

Date: 2026-09-05. Parent: `ead1c4e61203caed9a4742af73aa64f9c49c2256` (beta.12). This continues Milestone 2B.1; the original implementation result remains a historical record.

An independent agent review ran the original 27 CSV tests successfully, then reproduced two defects those tests missed:

1. `peel_mass_g=1e-308`, `oil_mass_g=1` passed individual finite/range checks but produced an infinite yield. SQLite accepted it and a later whole-class export failed. Shared validation now rejects the derived overflow. Canonical insertion/correction add defense in depth, and Migration 014 guards direct SQL writes. Nine regression cases include actual import zero-write behavior, migration rollback, valid tiny measurements and recovery with verified corrected values.
2. A successful upload whose response was lost could be followed by previewing another file. The single browser cache entry then forgot the first token; retrying the first file created another observation. Entries now belong to each user/class/schema/file hash. Seven tests execute the actual client against SQLite, covering lost responses, file/class changes, reload, old token migration, explicit new imports and failed/damaged storage. The independent auditor reran the original reproducer and observed the same token and batch, with zero additions on retry.

The independent reviewer also checked the final numeric changes and reran 36 CSV/numeric tests. No further reproducible permission, transaction or seal bypass was found in that scope. This is an independent agent code review, not a claim that a human or a different named model performed the audit. Full-project and exact-commit CI evidence are recorded with the delivery after those gates finish.

## Upgrade boundary

Migrations 001–013 and the legacy preflight remain byte-for-byte unchanged. Migration 014 fails preflight if old rows contain nonfinite stored or derived yields and reports record IDs without scientific values. It does not guess corrected masses, delete observations or rewrite immutable submitted JSON. Preserve a backup, establish the real measurement, use the existing reviewed correction path under the preceding schema, then retry the upgrade. The regression test demonstrates this with synthetic data; no external database repair was performed.

## What this case explains

Input validation must cover the calculation, not just each operand. Likewise, a database idempotency key only prevents duplicates when the client retains it across the actual retry path. A server-side race test cannot establish that a browser preserves the same identity after another preview. These are concrete reasons for testing failure sequences as well as successful endpoints.

No graphical browser, Excel/LibreOffice or production deployment was exercised. The four owner actions remain OPEN: revoke/rotate the old DeepSeek key; establish image/video/GLB rights and consent; review historical deployment accounts/data; inventory external schema-v7 databases/backups and review their upgrade path. No public release or deployment is included.
