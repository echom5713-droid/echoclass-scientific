# Development guide

**Version:** `3.0.0-beta.22` (review candidate)

EchoClass is an early-stage scientific data platform for chemistry laboratory classes. The current Node.js application supports role-based classroom workflows, SQLite-backed records, teacher review, deterministic data-quality checks, descriptive summaries, an optional DeepSeek explanation proxy, and manual image-assisted inhibition-zone measurement.

This repository is not a Next.js, Supabase, automated computer-vision, or confirmed process-optimisation system. The included dataset is synthetic demonstration data. Its small sample size supports workflow testing and descriptive comparison only.

## Current status

The application follows data from collection to review and preserved evidence. Teachers/admins can validate a fixed CSV, preview errors without writing data, import the whole batch in one transaction and recover the original receipt after a failed response. The [CSV contract](csv-interchange-v1.md) defines the exact fields and limits; the [corrective review](milestone-2b-1-correction-result.md) records two real failures and their repairs.

Records can have private PNG, JPEG or PDF attachments. An existing CSV batch can retain its matching original file. Access follows the current account, record ownership and class; archived evidence remains available to authorized teachers/admins. Files have server-generated keys, a byte digest and actual reception time. [The evidence contract](milestone-2b-2-plan.md) explains the file/database failure boundary and the SQLite-plus-attachments backup and restore commands. A later upload does not establish earlier custody or validate the experiment itself.

The underlying data model provides:

- canonical records with server-owned identity and calculated values, domain validation and scoped offline retries;
- append-only teacher review events and an effective review projection;
- immutable original submissions and sealed analysis input/review snapshots;
- explicit legacy/unverified classifications where historical evidence cannot support exact claims;
- additive SQLite migrations, database constraints, transaction tests and a complete CI gate;
- separate application, domain, HTTP and storage responsibilities without a frontend or microservice rewrite.

SQLite schema is 17. Released migrations 001–016 remain unchanged; migration 017 adds credential-change session revocation and invalidates pre-existing sessions once. Users must sign in again after this upgrade. Scientific analysis provides a sealed Node → Python → SQLite report workflow. The new bounded evidence-card assistant explains completed reports with exact citations; it is not open-domain or literature RAG. Independent implementation audits remain pending. Manual deployment and historical-data actions remain open in [the risk register](risk-register.md).

## Scientific analysis

Use Python 3.12.13 on Linux with a local filesystem. Install the isolated environment before starting the application:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r analytics/requirements.lock
export ECHOCLASS_PYTHON="$PWD/.venv/bin/python"
npm run build
npm run test:python
npm start
```

Teachers/admins can open `/scientific-analysis`. A new request seals all active class candidates and their current review decisions atomically; only teacher-included records enter the calculation. Reports distinguish the best observed group mean from an exploratory model candidate. Bootstrap intervals assume independent records, which the database does not establish. The older `/report` is still a descriptive report, not this sealed analysis.

The application supervises one private Python worker. Its inherited filesystem lock prevents a second process from recovering a live task; no external queue service is used. A 30-second cooperative calculation budget and at most two durable attempts bound execution. Missing Python dependencies leave scientific creation unavailable while existing records and reports remain readable. Set `ECHOCLASS_SCIENTIFIC_ENABLED=0` to disable execution explicitly. The combined Node/Python container is documented in [the scientific deployment guide](scientific-deployment.md). Its dedicated CI exercises the real worker, mounted state and restart/reproduction path; inspect the exact commit result before claiming container acceptance. Existing bind-mounted deployments require explicit data migration review before adopting the new named volumes.

`npm run scientific:demo` computes the clearly marked synthetic fixture through the same Python methods and Node result validator, without classroom writes. Read-only reproduction of a completed report uses its original sealed inputs even after later corrections/reviews. Exact comparison requires the same code/environment; a permitted different-environment comparison is labeled numerical rather than exact.

The fixed [method comparison](method-study.md) runs with `npm run scientific:study -- --text`. Five synthetic scenarios compare simple baselines and the production quadratic, including identical observed datasets with incompatible unseen response shapes. This study does not change the report algorithm or automatically select a model.

The separate [follow-up design](followup-design.md) runs with `npm run scientific:design -- --text`. It compares new locations and independent replication for discriminating two fully specified responses under known Gaussian noise. Its CLI and independent audit are included in the scientific image; `/engineering#next-measurement` exposes the theoretical calculation through a local, account-free explorer. These new simulations are separate from classroom records and the production worker.

See [the scientific contract](scientific-protocol.md), [design and limitations](milestone-3-plan.md), and [the project explanation](project-walkthrough-zh.md). Backup/restore accepts complete schema 15, 16 and 17 bundles and verifies the manifest against the actual database ledger; an older restored database upgrades through the current additive migrations only on normal application startup. Backup scope remains SQLite plus evidence, not Python environments or secrets.

For orientation, read [the architecture](architecture.md), [the progress record](progress.md), or [the Chinese code walkthrough](project-walkthrough-zh.md).

## Evidence-linked report explanations

Open a completed scientific report and follow **读懂这份报告**. Select one of nine supported topics; every explanation includes inspectable saved values or a versioned first-party method card. Scientific report hashes, evidence hashes and an explanation hash distinguish the data from the presentation. Existing reports remain usable even when the Python worker is unavailable. Explanations never modify scientific results.

The default path is fully local and deterministic. An optional DeepSeek model can only reorder all the retrieved cards; it cannot write answer prose, change numbers, invent citations or omit caveats. Unsupported/free-form commands are rejected rather than guessed. This is deliberately a bounded evidence assistant, not semantic retrieval, literature search, or validated free-form AI reasoning. Existing general AI chat and class summaries are legacy features and do **not** gain these citation guarantees.

External reordering requires both `ECHOCLASS_GROUNDED_AI_ENABLED=1` and a dedicated `ECHOCLASS_GROUNDED_AI_KEY`, then an explicit checkbox on each page. Never reuse the unresolved old provider key. The fixed endpoint receives only a topic and static card IDs/titles, not experiment values, report identifiers, names, notes or files. `ECHOCLASS_GROUNDED_AI_MODEL` defaults to `deepseek-v4-flash`; only that model and `deepseek-v4-pro` are accepted. Invalid, truncated, oversized or timed-out outputs fall back to local ordering. No live provider call or model-quality claim is part of the current verification.

The **查阅项目资料** form adds local SQLite FTS5/BM25 search over 20 versioned first-party guide sections. It returns exact excerpts with document/chunk IDs, hashes, corpus identity and explicit unsupported/safety/premise states. Questions are bounded, supported PII patterns are redacted, no raw questions are audited, and this endpoint never calls a model. It uses the same current report permissions and shared per-user limit as evidence cards. `npm run eval:retrieval` runs 42 developer-authored regression questions; this is not a held-out or human-rated evaluation. See [retrieval scope](retrieval-v1.md), [the recovered roadmap](development-plan-status.md) and [evaluation](ai-evaluation.md).

Run `npm run eval:grounded` in the locked Python/Node environment for the offline synthetic evidence/rejection benchmark. It checks deterministic source mappings and forged output rejection, not live-model quality, user benefit or scientific efficacy. See [scope and security design](milestone-4-plan.md).

## Technology stack

- Node.js 24 (the supported runtime for this beta)
- strict TypeScript application/domain/HTTP layers with existing server-rendered HTML templates
- `node:sqlite` with versioned migrations; explicit JSON compatibility/demo mode has weaker guarantees
- scrypt password hashing, server-side sessions, RBAC, class scoping, origin checks, and security headers
- TypeScript, ESLint, Prettier, and `tsx` development tooling

## Quick start

```bash
npm ci
npm run build
npm start
```

Open `http://localhost:3000`. Public project/engineering reading pages and account pages default to English with a Chinese switch. The older classroom workflow remains Chinese. The application creates ignored local runtime data on first start.

Fixed demonstration accounts are not seeded by default. To create the isolated local demo fixture, set `ECHOCLASS_SEED_DEMO=1` in a disposable local environment before first start. Never enable this flag for real classroom or public deployments.

The isolated demo fixture contains:

| Role          | Username     | Password |
| ------------- | ------------ | -------- |
| Student       | `student001` | `123456` |
| Teacher       | `teacher001` | `123456` |
| Administrator | `admin`      | `123456` |

These accounts are for disposable local demonstrations only. They must not coexist with real classroom data. Existing deployment data directories created by an earlier version must be inspected manually for demo accounts.

## Optional AI provider

Copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY` locally. Never commit `.env`.

If no provider key is configured, EchoClass returns a clearly labelled local fallback explanation. AI output is supplementary and must not decide whether a record is excluded.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:integration
npm run security-check
npm run smoke-test
npm run format:check
node --test dist/tests/architecture-boundaries.test.js
```

No accuracy, coverage, performance, or user-count claim is made unless it is produced by an actual command or dataset calculation.

## Data handling

- `data/sample/nh4cl_yield.csv` is anonymous synthetic demonstration data.
- Runtime databases and JSON account/record files are ignored.
- Images selected for local manual measurement stay in the browser. Saving a record attachment is a separate explicit upload and does not attest that it was used for an earlier calibration.
- The source archive contained sensitive runtime material; it is not part of this sanitized repository.

## Known limitations

- Migration 012 quarantines the definite `canonical_submission` + `legacy_projection` contradiction, but it does not infer insertion time or quarantine legitimate legacy snapshots merely because old schemas retained no per-review batch evidence.
- Migration 010 cannot recover provenance that was physically deleted before beta.9 and cannot prove the absence of a sophisticated pre-010 forged ledger row that exactly mimics all released migration contracts.
- The external durable schema-v7 database/backup inventory is unknown; the immutable Migration 008 stop behavior remains unchanged.
- Extension and original-submission metadata remain JSON by design; authoritative core/scientific fields are normalized.
- The JSON compatibility adapter does not provide SQLite-equivalent migration, constraint, transaction, concurrency, or review-provenance guarantees.
- Temporary-password sessions are restricted until a successful password change and fresh sign-in. Credential/scope changes revoke older sessions; see [the implemented boundary and its limits](credential-session-boundary.md). Independent security acceptance is still pending.
- SQLite offline idempotency is protected by a creator/class/client-ID partial unique constraint; explicit JSON mode remains weaker.
- The sealed Python pipeline provides reproducible exploratory analysis; older descriptive pages remain separate. MAD z-score flags and bootstrap optimum intervals from the initial plan are not implemented. Group-mean regression and concentration-level LOOCV are explicit protocol choices.
- Report evidence cards and project-document FTS5/BM25 retrieval have offline evaluation. Free-form model answer generation, external literature ingestion, human-rated model evaluation and independent statistical/security acceptance remain pending.
- Attachment signatures screen supported formats but are not full file parsers, malware scanners or proof of scientific truth. CSV source matching uses strict UTF-8 plus the original receipt digest/length; CSV has no universal magic signature.
- Evidence storage requires a local filesystem with hard links, no-follow file opening and directory sync; validation here uses Linux. Physical cleanup of orphaned files and automatic computer vision are not implemented.
- The backup contract covers SQLite and evidence, including archived evidence. Practice answers and deployment settings are separate; incomplete restores cannot start.
- Remote CI success is reported only from an observed run for the exact commit.
- The HTML template module remains large because the existing UI was deliberately preserved; it now receives prepared data and imports domain analytics through a typed facade.
- The SQLite/JSON engine remains JavaScript behind typed repository adapters and should be converted internally in a later focused storage migration.
- Node.js 24 alignment does not make `node:sqlite` or this application production-ready; an independent deployment assessment is still required.

## Security notice

MANUAL ACTION REQUIRED:

Revoke and rotate the previously exposed DeepSeek API key.

MANUAL ACTION REQUIRED:

Verify provenance, consent, and redistribution rights for bundled image, video, and GLB assets before any public release.
