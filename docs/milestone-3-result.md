# Milestone 3 — scientific-analysis review candidate

Date: 2026-09-05. Version: `3.0.0-beta.15`; SQLite schema 16.

Local checks passed: Node 530/530, HTTP integration 29/29, Python 63/63 with five additional passing subtests, clean npm installation, lint/typecheck/build/format/smoke/security, and the four architecture-boundary tests. The security gate passed after updating its stale beta.14 version assertion. Sixteen released migration files (001–015 plus the 002 preflight) match beta.14 byte-for-byte. This is not a deployment approval or an independent post-implementation audit certificate. The exact commit, CI and delivered archive are recorded separately after those actions succeed.

## Implemented boundary

- Atomic complete-cohort selection, current account/class authorization, actual JCS/SHA-256 sealing and durable per-request replay. Migration 016 registers only new pending, empty-result, exact/sealed runs; migrations 001–015 remain unchanged.
- Pure Python/Pydantic/pandas/NumPy/SciPy/statsmodels analysis of canonical sealed bytes: approved-only inclusion, descriptive statistics, IQR flags, percentile bootstrap, equal-weight concentration-mean quadratic fitting, concentration-group LOOCV, exact-decimal best-tested ties and conservative exploratory candidates.
- A supervised private FastAPI worker, measured code/environment identity, shared inherited filesystem lock, a real one-calculation Future, cooperative deadline, bounded two-attempt recovery and terminal CAS persistence.
- Teacher/admin report, durable browser intent, current authorization after asynchronous reproduction, exact or explicitly numerical read-only comparison. A labeled offline synthetic demonstration uses the same calculation and Node result validator.
- Schema 15/16 database-plus-evidence backup compatibility; the actual ledger version must match the manifest. Python environments, operating-system locks and credentials are not backup evidence.

## Faults found during implementation

1. Parent-death logging could throw on a closed pipe before terminating the worker. Termination now executes in `finally`; an actual supervisor-kill test verifies the worker stops.
2. A new task could arrive between an empty queue check and that pump's Promise cleanup, losing its wakeup. A retained wake request and drain loop close this gap; a targeted test exercises that event ordering.
3. The report client originally disabled even existing-token replay while Python was unavailable. Replay now remains available for a preserved intent; it does not reseal current data.
4. Python's date helper accepted year zero. Its range now matches the valid snapshot timestamp boundary, with leap-day/year-zero regression checks.

The first full Node run had seven failures caused by old assertions that the latest schema was still 15 (523/530 passed). Those assertions now expect 16; historical-prefix tests and frozen migration sources were not relaxed. A numerical test's initial expectation that positive half-range MAD must overflow was also corrected: that quantity is representable; the overflow check now uses unrepresentable original-unit regression coefficients.

## Evidence and remaining checks

Targeted checks include real SQLite rollback and raw SQL attempts, real Node HTTP → Python → SQLite completion/replay/reproduction/restart, actual worker cancellation/timeout/busy/parent-death behavior, strict cross-language canonical input validation, hand-calculable statistics and independent Lagrange fold predictions, and the actual browser script's intent recovery.

Before declaring this milestone finally accepted, review the final full gate log and exact-SHA CI, and obtain a fresh independent implementation audit. Design review preceded implementation, but authors' tests and root-agent self-review must not be presented as a separate implementation audit. Graphical browser QA, production deployment, real power-loss testing, other operating systems and other filesystems are not claimed.

The four owner release blockers remain OPEN: old provider-key rotation, asset rights/consent, historical deployment demo accounts/data, and external schema-v7 database/backups inventory. Grounded retrieval/citations/evaluation is still a subsequent milestone; it is not implemented by this statistical report.
