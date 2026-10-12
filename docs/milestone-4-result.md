# Milestone 4 — bounded evidence-card review candidate

2026-09-05; `3.0.0-beta.16`; SQLite schema remains 16. The user requested continued private development after the beta.15 handoff. Neither that stage nor this one has a fresh independent post-implementation audit certificate.

## Implemented

Nine explicit report topics retrieve exact saved fields and first-party method cards. Each displayed block carries citations with inspectable values and hashes. Evidence and explanation hashes are separate from the scientific result hash. Only completed, currently authorized scientific reports can be explained; worker availability is not required. No new migration or scientific-calculation change was made.

The optional model is a constrained card reranker, not a free-form answer writer. It receives only fixed topic/card metadata through a dedicated, explicitly enabled credential and fixed HTTPS endpoint. Every original card must survive exactly once. Invalid JSON, additional claims, omissions, duplicates, truncation, bad MIME/UTF-8, oversized bodies and upstream failures yield the deterministic local ordering. A deadline includes body reading; two physical operation slots remain owned until actual completion, even when a test transport ignores abort. No real provider credentials or live calls were used for verification.

The page defaults to local explanation, renders all content as text and discards invalidated replies. Current account and captured-record class authorization is rechecked after the model/audit awaits and next to HTTP serialization. Audit detail retains only topic, mode, fallback reason and hashes, not experiment values or generated prose. Existing general AI chat and classroom summaries remain separate legacy features without these citation guarantees.

## Local verification

- Node tests: 556/556, including 26 new grounded evidence/service/provider/client tests.
- HTTP integration: 30/30, including a nested real grounded-report workflow within the Python/SQLite lifecycle test.
- Python: 63/63 plus five passing subtests; clean locked Python 3.12.13 environment and `pip check`.
- Offline evidence evaluation: 25/25, nine topic mappings, two hand-calculable synthetic checks, eight malformed model orders and six unsupported commands. This is a contract benchmark, not live-model accuracy.
- Clean npm installation, lint, typecheck, build, format, smoke, security and four architecture-boundary tests pass. Repeated execution overlaps these totals and is not additive coverage.
- The first full Node run was 555/556 because one runtime-version regex still expected beta.15; the correction is preserved in this stage's diff. No failing behavioral assertion was removed.
- Migrations 001–016 and the 002 preflight (17 files) and the Python analytical package remain unchanged relative to beta.15. Current data modification, later review/archival and restart leave old report explanation evidence unchanged in the real HTTP test.

The exact Git commit, CI result and source archive verification belong in the delivery record after those steps succeed, not as predicted IDs here.

## Deliberate limits and next work

This is a bounded, evidence-linked report assistant. It does not implement literature ingestion, vector/semantic retrieval, free-form question understanding or generated claim entailment. No evidence establishes that optional model ordering is better than the default. Unsupported requests fail explicitly instead of being interpreted speculatively. Fixed first-party method cards document implementation behavior; they are not external validation of the experiment.

Independent security/statistical implementation review, graphical browser QA and live-provider evaluation are still pending. No production deployment or public release took place. The existing Node-only Docker image is not a verified scientific runtime. The four owner release blockers remain OPEN: old provider key revocation/rotation, asset rights/consent, historical deployment demo accounts/data, and external schema-v7 databases/backups with a separately reviewed upgrade path.

Before extending to free-form grounded generation, separately evaluate evidence selection, claim support, citation correctness, abstention, adversarial source content and privacy. Before application use, personally reproduce and explain the key workflows in `docs/project-walkthrough-zh.md`; do not present synthetic fixtures as real experiments or AI-assisted implementation as unassisted authorship.
