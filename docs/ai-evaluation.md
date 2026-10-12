# Grounded assistance evaluation

Two separate offline suites exist; their totals must not become a model accuracy figure.

| Suite                    | Data and execution                               | Measures                                                                                   |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `npm run eval:grounded`  | 25 synthetic evidence cases; real Python fixture | Source pointers/hashes, arithmetic expectations, invalid model-order/command rejection     |
| `npm run eval:retrieval` | 42 developer-authored questions; real FTS5/BM25  | Behavior/source IDs, required points, listed forbidden phrases, exact source/answer hashes |

`data/evaluation/retrieval-v1.json` gives every question expected_sources, required_points, forbidden_claims and expected_behavior. It contains 24 document questions (including scope/PII), six outside-corpus questions, four safety probes, four injection probes and four premise/overclaim probes. The script emits per-case outcomes, actual source IDs and answer hashes, exiting nonzero on failure.

First execution: 41/42. An English IQR question missed lexical coverage. The English first-party review explanation was clarified; the unchanged question then passed. The resulting 42/42 is development regression evidence, not a held-out result. Required/forbidden phrase assertions do not establish semantic entailment or count every possible unsupported claim.

No live model, actual API key, real student data, independent human rubric, scientific efficacy, coverage percentage, performance benchmark or user benefit was measured. First-party source correctness still needs independent review. The original grounded-vs-ungrounded model comparison remains absent; no score is supplied.

Whole-project gate and exact private Git/CI evidence belong to the beta.17 result/delivery record. Historical stage documents retain their original counts.
