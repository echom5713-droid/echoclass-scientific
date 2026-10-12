# EchoClass: preserving the evidence behind a scientific result

[中文](application-project-brief.zh.md) · [Source and instructions](../README.md)

**Project appendix draft · 3.0.0-beta.25 · synthetic demonstrations**

EchoClass is a Node.js/TypeScript, SQLite and Python project built around chemistry laboratory records. Its central question is practical: after a measurement is corrected or a teacher changes a review decision, can an earlier calculation still be explained and reproduced?

The system preserves original submissions, appends review events and seals the exact inputs used by a scientific report. A supervised local Python worker computes descriptive statistics, bootstrap mean intervals and an exploratory concentration-response fit. The report distinguishes the best measured conditions from an unmeasured model candidate.

## One example, and its limit

The reproducible fixture contains 20 invented records at four ammonium-chloride concentrations. The 1% and 3% groups tie at a mean oil yield of 9%. A quadratic fitted to the group means suggests a candidate near 2%, where the fixture has no measurements.

A deliberately constructed second response agrees at all four observed concentrations but behaves differently between them. Identical observed inputs and model results therefore coexist with different known unseen responses. The fixed method study compares constant, linear and quadratic fits across five synthetic scenarios and twelve seeds; it retains the counterexample alongside favourable cases.

The follow-up study then chooses a new concentration before simulating its response. Under two fully specified hypotheses, known independent Gaussian noise with SD 2 percentage points, three repeats, and equal priors and error costs, measuring at 2% has a theoretical classification error of approximately 4.16%. Repeating an old point has 50% error because the two predictions coincide. This is a restricted hypothesis-discrimination calculation, not evidence that the true chemical optimum has been found.

## Engineering evidence worth discussing

| Decision or correction                                       | Evidence                                                                                                         | What it demonstrates                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Preserve the inputs behind a report                          | [Scientific service](../src/application/scientific-service.ts), sealed snapshots and restart/reproduction checks | Provenance and transaction design; a digest does not prove a measurement is true                      |
| Preserve a submission's retry identity before transport      | [Outbox implementation](../public/offline-submission.js), lost-response and equal-valued-observation regressions | Equal values can represent distinct observations; retries must preserve intent                        |
| Restrict temporary-password sessions and revoke old sessions | [Credential boundary](credential-session-boundary.md), migration 017 and real HTTP tests                         | An interface prompt is insufficient; permission and credential changes need storage-level enforcement |
| Keep explanations tied to inspectable evidence               | [Evidence assistant](milestone-4-plan.md) and local document retrieval                                           | The bounded assistant cites saved values/excerpts; optional model assistance only reorders cards      |

The public reading pages default to English and offer Chinese switching. Both languages use the same numeric tables, equations and interactive calculation. The older classroom workflow remains Chinese in this version.

## A short demonstration

1. Open `/` and inspect the tied measured means and unmeasured candidate; switch between EN and 中文.
2. Open `/engineering#next-measurement`. Compare 1% with 2%, then vary noise and replication. Explain the assumptions before interpreting the probability.
3. Run `npm run scientific:demo -- --text`, then inspect the sealed-input and review path in the code. Run the method and follow-up studies using the commands in the README.
4. Explain one reproduced failure and its regression test, rather than using the total test count as an impact claim.

## Development tools and evidence

AI tools contributed to implementation, tests, debugging, documentation and interface work. The [development notes](engineering-notes.md#development-and-tool-assistance) record this assistance. Source references and executed checks document the system’s behavior; individual contribution is assessed from work actually performed.

The bilingual `/walkthrough` page and [evidence-trail command](project-trace.en.md) connect a specific observation to its review, saved input digest and actual worker group mean. A detached-copy exercise demonstrates a digest mismatch without writing records or reports.

No real classroom benefit, extraction efficacy, antimicrobial result, independent human acceptance or large-scale computing proficiency is established by this project. Statistical and security review remain open. This scientific source export excludes unverified legacy media and private runtime data; the [public-snapshot note](public-snapshot.md) records its scope. Historical deployment and independent acceptance remain separate.

## Presenting the project in either language

The public project pages, account pages and scientific, explanation, CSV and attachment workflows default to English and offer Chinese switching. A reading aid built from cited structured fields explains the report in English. The original explanation and source values remain inspectable; displayed evidence hashes refer to that canonical content. Changing language also preserves the same saved retry identifier, so a display preference cannot silently create another analysis, import or upload. Older classroom pages remain Chinese.

This provides one concrete design decision to discuss: a translated presentation should not overwrite evidence whose identity is already defined by its original bytes. See the [presentation boundary](operation-language.md) and its tests.
