# EchoClass Scientific

Citrus-extraction records, review decisions and the inputs used for a calculation.

[English](README.md) · [中文](README.zh.md)

**3.0.0-beta.25 · scientific software prototype** — Node.js 24, TypeScript, SQLite and Python 3.12.13.

A corrected observation should not silently change the meaning of an earlier report. EchoClass preserves original submissions, appends review events and seals the input used for each scientific calculation. The public snapshot includes synthetic data and original code-generated figures. It contains no experimental photographs, lecture video, binary molecular model or classroom database.

## One result to inspect

The committed [fixture](tests/fixtures/scientific/synthetic-envelope.json) contains twenty invented observations at 0%, 1%, 3% and 4% NH₄Cl. The 1% and 3% groups both have mean yield 9%. The quadratic fitted to group means proposes a point near 2%, where the fixture has no measurement.

Another response curve agrees at all four measured concentrations and disagrees between them. The [method comparison](docs/method-study.md) retains that counterexample, compares simpler baselines and reports all fixed trials. Reproducing a calculation does not identify an unmeasured optimum.

![Two specified synthetic responses agree at the measured points and disagree between them](docs/figures/observational-alias.svg)

The [follow-up design](docs/followup-design.md) chooses a new concentration before generating its response, states the noise and decision assumptions, and checks the theoretical error against a reproducible simulation. Its interactive reading is available at `/engineering#next-measurement`.

## Reproduce the example

Use Node.js 24 and Python 3.12.13 on Linux. The scientific worker's supported production contract uses a local Linux filesystem; the project has not been certified on Windows or other architectures.

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r analytics/requirements.lock
export ECHOCLASS_PYTHON="$PWD/.venv/bin/python"
npm run project:trace -- --text
```

The trace verifies the twenty input digests, the ordered dataset manifest, review bindings and execution fingerprint, then runs the actual Python calculation. It changes a detached in-memory copy while retaining its saved digest, observes rejection and rechecks the untouched original. It writes no classroom record, review, report or fixture file. JSON output includes exact identifiers, settings, digests and observed runtime identity.

```sh
npm run project:trace -- --json
npm run project:trace -- --text --lang zh
npm run scientific:study -- --text
npm run scientific:design -- --text
npm start
```

Open `http://localhost:3000` for the project, `/engineering` for the calculation and design notes, and `/walkthrough` to follow one observation through the code. These pages default to English and offer Chinese switching. Native reading/disclosure controls work without JavaScript. Scientific, explanation, CSV and attachment views use the same language preference; original data, citations and saved retry identifiers retain their identity.

## Read the code beside the result

| Question                                                  | Source                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Which observations and review events were selected?       | [Scientific service](src/application/scientific-service.ts)                                                                                     |
| Which bytes does a digest bind?                           | [Canonical representation](src/domain/scientific/canonical.ts) · [evidence-trail command](scripts/project-trace.mjs)                            |
| How are statistics and reproduction calculated?           | [Python package](analytics/echoclass_analytics) · [method contract](docs/scientific-protocol.md)                                                |
| What happens after a lost response or credential change?  | [Submission outbox](public/offline-submission.js) · [credential boundary](docs/credential-session-boundary.md)                                  |
| Where are stored reports and restart reproduction tested? | [HTTP/database/worker tests](tests/integration/scientific-workflows.test.ts) · [container workflow](.github/workflows/scientific-container.yml) |

The [English reading guide](docs/project-trace.en.md) has a [Chinese counterpart](docs/project-trace.zh.md). The [architecture](docs/architecture.md) explains the domain, service, port and adapter boundaries. Optional report-card assistance can reorder fixed cards; the scientific calculations and reading route require no model provider.

## Verify the source

```sh
npm run publication:check
npm run lint
npm run typecheck
npm test
npm run test:python
npm run test:integration
npm run eval:grounded
npm run eval:retrieval
npm run smoke-test
npm run security-check
npm run format:check
```

The [CI workflow](.github/workflows/ci.yml) runs these checks. The [actual-image workflow](.github/workflows/scientific-container.yml) additionally runs the worker, source-reading command and restart reproduction inside the non-root combined Node/Python image. Test/evaluation fixtures are developer-authored regression cases, not a held-out accuracy study or independent human acceptance.

## Scope and development

This is a small-data scientific prototype. It does not establish parallel speedup, large-scale throughput, a validated extraction optimum, antimicrobial efficacy or classroom benefit. Bootstrap intervals assume independent observations; software provenance cannot establish that independence. The older classroom compatibility workflow remains partly Chinese and uses a separate synthetic dataset.

The [public-snapshot note](docs/public-snapshot.md) records included/excluded content and the separation from private historical deployments. The [scientific project context](docs/course-context.md) explains its connection to data management, research software and further HPC study. Source visibility is separate from production acceptance.

AI tools contributed to implementation, tests, debugging, documentation and interface work. The [development record](docs/engineering-notes.md#development-and-tool-assistance) describes this assistance. This repository starts with a curated source snapshot; the linked code, tests and runnable examples document the implementation and its verification.
