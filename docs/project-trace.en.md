# Trace one result

[中文](project-trace.zh.md) · [Reproducible case](reproducible-case.md)

The public `/walkthrough` page follows one invented record through its review, sealed input and actual worker result. It defaults to English and offers Chinese switching. Native disclosure controls work without JavaScript; it reads no accounts, classroom records or model responses.

## Run the trail

Use Node.js 24 and the pinned Python 3.12.13 environment in the [README](../README.md). From the repository root:

```sh
npm run project:trace -- --text
npm run project:trace -- --text --lang zh
npm run project:trace -- --json
```

The command checks every one of the twenty canonical inputs against its saved digest, then checks the ordered dataset manifest, bound review identity and execution fingerprint. It invokes the existing supervised offline demo, validates the actual Python result and requires it to belong to the same dataset. JSON retains original IDs, exact digests, calculation configuration and observed runtime identity. Text is a reading aid.

The record `synthetic-005` contains 100 g peel, 8.8 g oil and 1% NH₄Cl. Its 8.8% yield is one observation. The five 1% observations have mean yield 9%; the 3% group ties. The quadratic proposes an unmeasured concentration near 2%. Neither the tie nor that candidate is a real chemical finding.

All review events and actors are invented. `provenance_kind: human` names the fixture's event category; it is not evidence of independent human review. The fixture execution identity is also synthetic. The observed worker identity is reported separately, and this offline reading is not a production exact-reproduction claim.

## Change a detached copy

The command copies the envelope in memory, changes the selected oil mass and derived yield from 8.8 to 9.8, and leaves the saved input digest alone. The input-byte check rejects this copy. It then rechecks the untouched original. No fixture file, classroom store, record, review or report is written.

This exercise demonstrates a digest mismatch; it does not exercise a database correction, measure security against a writer who can replace every digest, or establish measurement truth. Stored snapshot isolation, authorization and restart reproduction have their own [HTTP/database/worker tests](../tests/integration/scientific-workflows.test.ts).

## Read the code beside the result

| Question                                 | Source to inspect                                                                                                 | Check to perform                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| What makes a retry the same observation? | [Browser outbox](../public/offline-submission.js)                                                                 | Follow the saved intent identifier; equal values do not establish equal intent     |
| Which review selected this input?        | [Scientific service](../src/application/scientific-service.ts)                                                    | Match record ID, effective review ID and bound review snapshot                     |
| Which bytes does the input digest bind?  | [Canonical representation](../src/domain/scientific/canonical.ts) · [trace command](../scripts/project-trace.mjs) | Compare the detached-copy digest with the saved original                           |
| Where does 9% come from?                 | [Python methods](../analytics/echoclass_analytics)                                                                | Inspect the five included observations and the worker group summary                |
| Why is 2% still unmeasured?              | [Method study](method-study.md) · [follow-up design](followup-design.md)                                          | Substitute 2 into the competing response curves and explain the design assumptions |

## A record of work you actually perform

Keep a separate dated engineering log when working through this route. Record the command you ran, what you predicted, what you observed, and any change with its diff and verification. A useful entry might examine one of the [roundoff regressions](scientific-roundoff-review.md), or deliberately break and restore retry identity in an isolated checkout.

Reading this guide or repeating its wording does not establish that you authored the implementation. Record design choices, code changes, experiments and review separately, with the tools used for each. The [development notes](engineering-notes.md#development-and-tool-assistance) retain the AI assistance used in this project. This guide supplies technical learning tasks and project evidence; it does not supply a personal statement.
