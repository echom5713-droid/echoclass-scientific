# Engineering notes

EchoClass uses citrus-extraction records as a concrete setting for a data-provenance problem: after a correction or a new review, can an earlier result still be explained?

The repository contains a classroom application and a newer sealed scientific workflow. They share records, but the older descriptive report is not a sealed scientific run. The [synthetic case](reproducible-case.md) is the quickest way to inspect the newer calculation.

## Choices that matter

| Choice                                               | Reason                                                                          | Cost or boundary                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Keep the original submission and append reviews      | A correction should not erase the evidence behind an earlier decision           | More database constraints and history than a CRUD table                           |
| Seal selected inputs before analysis                 | Reproduction must not depend on today's mutable classroom records               | Snapshot and review-binding validation are part of the storage contract           |
| Use SQLite transactions and a local Python worker    | The current workload does not justify a distributed queue or additional service | Local filesystem and single-executor assumptions need deployment review           |
| Fit concentration-group means with equal weights     | The protocol treats each tested concentration as one fitting unit               | This differs from fitting all records; four groups provide limited model evidence |
| Separate best tested from model candidate            | A fitted peak at an unmeasured concentration is a hypothesis                    | It needs a new experiment before any optimum claim                                |
| Use exact evidence cards and extractive guide search | Values and source locations remain inspectable                                  | This does not provide free-form literature reasoning                              |

## A retry bug, and what changed

The older student browser client kept a single `citrus_offline_records` queue. It retried on shared pages, including pages outside the student form. A draft could survive logout and be sent under a different account. The first online request also lacked a stable retry ID, because the ID was created only after failure. A lost response could therefore lead to a second insertion. A server validation rejection was incorrectly displayed as a saved offline draft.

The beta.18 correction uses a local outbox scoped to the rendered student identity. It persists the intent ID before the first request. A guarded server endpoint checks the expected account/class context and uses the existing SQLite idempotent sync path. Validation and authentication failures are handled separately from an unknown transport outcome. The historical unscoped queue is retained for manual recovery; it is not silently reassigned or deleted.

The database field `synced_from_offline` has a historical name. On this corrected student path it identifies the durable browser-outbox channel, including a first request that succeeds while online. It must not be interpreted as proof that a network outage occurred. Direct administrative record creation and the explicitly weaker JSON adapter retain their separate contracts.

Regression tests execute the actual browser client and a real HTTP server. They cover account changes, retry identity, lost responses and rejected input. These tests address demonstrated failures; they do not certify every possible browser or deployment condition.

## Other corrections retained in this version

- An empty or fully excluded descriptive report previously displayed a winning concentration. It now displays no winner. Exact ties remain ties; a sample standard deviation needs at least two records.
- A teacher could explicitly include a flagged record while the summary claimed it was excluded. Counts and prose now follow the effective inclusion decision.
- Logged-in users viewing synthetic classroom pages could receive live classroom SVG updates. Both chart requests now retain demo context.

These are display, transport and isolation corrections. The released migrations and Python scientific algorithms were not changed for beta.18.

## Reading the visual design

The entry pages use paper-toned surfaces, dark green text and a small citrus-coloured accent. A simple result figure replaces the earlier promotional hero at `/`; the older classroom entry remains at `/classroom`. The figure is a fixed illustration of the documented synthetic fixture, never a live classroom query. Its table and text description provide the same information without relying on colour.

The design borrows from a laboratory notebook: compact labels, ruled sections and a figure with an explicit caption. The pages use local CSS, system fonts and an original SVG illustration, without adding stock imagery or an external font dependency.

## Development and tool assistance

EchoClass has been developed with substantial AI assistance, including code changes, tests, debugging, documentation and interface work. In beta.18, AI agents performed targeted audits and implementation, while the project owner set the project purpose and requested a more personal, explainable presentation. The code, tests and notes therefore include AI-generated contributions; individual authorship should be described accordingly.

Automated results and commit history document what ran and what changed. They are not a substitute for independent review. Before presenting the work, the owner should be able to run the case, trace a submission through the code, explain one failing regression, and challenge the statistical assumptions. Personal application statements and claims of individual contribution require the owner's own accurate account.

## Remaining work

The beta.24 [evidence trail](project-trace.en.md) provides a shorter source-reading route in English and Chinese. `/walkthrough` follows one labeled invented observation and review; `npm run project:trace -- --text` checks every fixture input and calculates the actual worker result. Its altered-copy exercise demonstrates an input-byte mismatch without a database write. A dated log of predictions, observed outputs and code changes supports recording work actually performed. The public page and command are learning and inspection aids, not evidence of an individual's authorship or an independent audit.

A [follow-up numerical review](scientific-roundoff-review.md) corrects two floating-point boundary failures in beta.19. Beta.20 adds a fixed [method study](method-study.md) and [scientific container checks](scientific-deployment.md). The study retains cases where simpler models perform better and a counterexample where the existing candidate rule cannot identify the correct response shape. Container acceptance is recorded against the actual remote workflow; independent statistical/security acceptance, held-out retrieval evaluation and owner release decisions remain unfinished. The [risk register](risk-register.md) records the credential, asset and historical-data blockers. No real-world efficacy or usage claim follows from this demonstration.

## Follow-up: equal values can be different observations

A targeted review of the first beta.18 implementation found another recovery error. It selected the last matching entry returned by browser storage, but storage enumeration is not a chronology. After a second equal-valued observation failed, a retry could display the first observation's confirmed receipt and leave the second pending.

The correction pins the exact active intent in the tab session, restores unresolved matching intent before consulting old receipts, and stops when several unresolved matches cannot be distinguished. An explicit next observation creates its own identifier, including across tabs. Background recovery reports confirmed and unresolved counts rather than allowing its last successful request to imply that the whole queue succeeded. Both a response lost after persistence and a request failing before persistence were reproduced and rechecked by a separate reviewing agent. This is a targeted AI-assisted review; the initial green test run had not covered this case.

## From a counterexample to a new measurement

Beta.21 keeps a small scientific reasoning loop visible: the observed points cannot separate two fixed curves; choose a new location from their predictions before simulating any outcome; derive the decision error under stated assumptions; compare the derivation with a fixed reproducible simulation; then retain a third curve that still aliases the expanded design. The [follow-up report](followup-design.md) records the distinction between this known-hypothesis calculation and the production worker.

The engineering page uses a generated normal-tail lookup for seventeen locations, three noise levels and three repeat counts. The browser performs no Monte Carlo experiment, fetches no private data, and stores no state. Its initial example remains readable without scripts. The local table generator and regression tests make the displayed probabilities inspectable. This is an explanation interface, not a laboratory experiment planner.

The study, audit, figure and interface were implemented and reviewed with AI assistance. Separate numerical reconstruction reduces shared implementation assumptions but is not independent human statistical acceptance. Owner understanding must still be demonstrated by reproducing and explaining the calculation.

## Account access is a server boundary

The earlier temporary-password prompt left the account with ordinary permissions, and changing a password did not invalidate older sessions. Beta.22 restricts the session before protected route dispatch, then checks the live session and expected credential during the narrow password write. A new SQLite trigger revokes sessions in the same statement as credential/scope changes. A stale verified login or user-import snapshot cannot reinstate an older credential. The [credential note](credential-session-boundary.md) records the rollback and JSON-mode limits.

The change also affects older tests: a disabled account, a demo account without explicit opt-in, or a token retired by a scope change is now unauthenticated. Updated CSV, evidence and scientific HTTP checks retain the distinction between an invalid old token and a freshly authenticated account with insufficient permission. They also check that a fresh session after a class rename can still use the stable historical batch scope. Historical scientific input and review evidence are retained.

## English-first reading, with Chinese alongside

The project introduction, engineering notebook and account pages now default to English. A strict `en`/`zh` query choice and a separate preference cookie provide Chinese switching without requiring JavaScript. Scientific formulas, lookup probabilities and plotted geometry are shared; only fixed display copy changes language. Submitted records, source excerpts and account names are never translated. The older classroom workflow remains Chinese in this version.

The [application project brief](application-project-brief.en.md) and its Chinese counterpart organize the work around the scientific question, concrete corrections and inspectable evidence. They retain synthetic-data labels and AI-assistance disclosure. Personal contribution still requires the owner's accurate account; a polished interface cannot establish authorship, experiment validity or classroom benefit.
