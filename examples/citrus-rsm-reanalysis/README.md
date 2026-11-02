# Citrus-oil response surface: a reproducibility case study

This source package contains an AI-assisted numerical reanalysis associated with the writing sample _How precise is the optimum?_ The input is a 17-run Box–Behnken response-surface table from an **unpublished collaborative experimental study**. It is not raw instrument data and the scripts do not produce new laboratory measurements.

> **RELEASE STATUS:** Published source package. On 2 November 2026, the repository owner confirmed that the team had approved public release of the included data and derived results. This records that confirmation, not independent verification of rights. No new open-source or open-data licence is granted.

Public package: https://github.com/echom5713-droid/echoclass-scientific/tree/main/examples/citrus-rsm-reanalysis

This is a separate 17-run experimental-table reanalysis. It is not the repository's original 20-observation synthetic EchoClass demonstration.

## Research question

Can the summary fit statistics be reproduced from the reported table? Do added interactions help internal prediction? Does the many-decimal mathematical optimum provide more useful operating guidance than a practical recipe near the response-surface maximum?

## Quick start

Requires Python 3.11+. The release was rechecked with Python 3.12.14 and the pinned requirements below: all 11 tests passed, the full analysis ran, and all three figures regenerated. These are numerical consistency checks, not a laboratory audit. From this folder:

```bash
python -m pip install -r requirements.txt
python analyse.py
python -m unittest discover -s tests -v
python plot_results.py
```

The scripts write deterministic outputs to `results/` and regenerate the figures in `figures/`. All **11 numerical consistency tests** passed in the release check. They check internal calculations, not whether the measurements were correctly collected.

## Contents

- `data/citrus_bbd.csv` — 17 reported experimental conditions and yields, cross-checked with source Table 3 and Chinese experimental record 8.
- `analyse.py` — coded response-surface fitting, nested model comparison, PRESS / leave-one-record-out checks, rank-aware whole-setting holdouts, stationary-point calculations and sensitivity analysis.
- `tests/test_analysis.py` — numerical checks including a statsmodels comparison.
- `plot_results.py` — regenerates the three figures used in the writing sample. Generated PNG and NPZ files are not committed, preserving this repository's text-only source boundary. Running `analyse.py` recreates the NPZ intermediate; `plot_results.py` recreates `figures/`.
- `results/analysis.json` and companion CSV files — example outputs; running the scripts regenerates them.

## Scientific boundaries

The five centre measurements provide local replication; most other experimental settings have only one observation. Grouped holdout results can be non-identifiable. Leave-one-record-out scores are not external test-set results. Rounding perturbations test presentation precision, not laboratory uncertainty. Source documents disagree about one practical liquid-to-solid ratio; the script evaluates both without silently reconciling them.

## Attribution and AI assistance

The underlying experimental work was collaborative. Yujie Ma contributed to literature review, experimental planning, single-factor studies and data organisation. The subsequent reanalysis, scripts, figures and report drafting received **substantial generative-AI assistance**, including analysis implementation and checking. This is not independently validated author-only statistical analysis. No individual is represented as having independently performed steps they have not actually verified.

Before using this package in an application: confirm the author's understanding of the code and mathematical conclusions, and check Cambridge's application policy for this particular work-sample submission. Public release is not a finding of admissions-policy compliance. No open-source licence has been chosen; that is a publication decision for the rights holders.
