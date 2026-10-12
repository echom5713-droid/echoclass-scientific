# One citrus-oil yield case

This small case makes one distinction easy to inspect: the best tested concentration can differ from a model's suggestion for the next experiment. It uses **20 synthetic records and synthetic teacher review events**, committed in [synthetic-envelope.json](../tests/fixtures/scientific/synthetic-envelope.json). It contains no classroom observations or evidence of improved yield.

The older classroom demo pages use a separate demonstration dataset. Their descriptive summaries should not be compared with the numerical values in this sealed case.

## Run it locally

Use Node.js 24 and Python 3.12.13 on Linux. From the repository root:

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r analytics/requirements.lock
.venv/bin/python -m pip check
export ECHOCLASS_PYTHON="$PWD/.venv/bin/python"
npm run scientific:demo -- --text
```

Check `python3.12 --version` before creating the environment: the command name alone does not guarantee the patch version. The demo builds the Node validator, starts a local Python subprocess, verifies the returned scientific result and prints a summary. It reads the committed fixture without opening a classroom database, starting the web app or calling an AI provider. Execution has a 30-second limit; a timed-out or invalid response produces no accepted result.

The default output is JSON with group statistics, bootstrap intervals, a scientific-result hash and the observed runtime identity. To save clean JSON after building:

```sh
npm run build
node scripts/scientific-demo.mjs --json > synthetic-demo.json
```

The JSON contains unrounded numerical values. The text display rounds to eight significant figures for readability. `npm run test:python` checks the methods; `node --test tests/scientific-demo.test.mjs` checks this command after building, including timeout and invalid-output handling.

## Inspect the inputs

Each record has 100 g of peel, so the oil mass in grams equals its yield as a percentage. The five yields at each concentration are deliberately regular:

| NH₄Cl concentration (%) | Synthetic yield values (%) | Included records | Mean yield (%) |
| ----------------------- | -------------------------- | ---------------- | -------------- |
| 0                       | 5.8, 5.9, 6.0, 6.1, 6.2    | 5                | 6              |
| 1                       | 8.8, 8.9, 9.0, 9.1, 9.2    | 5                | 9              |
| 3                       | 8.8, 8.9, 9.0, 9.1, 9.2    | 5                | 9              |
| 4                       | 5.8, 5.9, 6.0, 6.1, 6.2    | 5                | 6              |

All 20 fixture records have an effective `included` review. In the application, a teacher's inclusion decision makes a record eligible for this analysis. It is not proof that the measurement is accurate or that repeated records are independent experimental replicates. The review events here are synthetic fixtures, not decisions made by a real teacher.

The sealed input includes more than the two plotted columns: record identity, the captured measurement, review status and its corresponding review event. Input hashes bind those bytes; the dataset hash binds the ordered set. A later live edit does not silently change this saved calculation.

## Read the answer carefully

The **best tested concentrations are 1% and 3%, tied at a mean yield of 9%**. There is no unique winner among the observed groups. The protocol compares exact decimal means for this ranking so a floating-point summation artifact cannot break the tie.

The quadratic fitted to the four group means is approximately `yield = −concentration² + 4 × concentration + 6`. Its vertex suggests **2% NH₄Cl and a predicted yield of 10%**. There are no 2% records in the fixture. This is an exploratory candidate for another experiment; the software has not established an experimental optimum.

The model gives equal weight to the four concentration means. Leaving each concentration out in turn tests how that fit changes, not how well it generalises to an independent experiment. This deliberately regular fixture gives near-zero leave-one-concentration-out error. That is useful for checking the calculation and says nothing about predictive accuracy on real laboratory data. The vertex range from those fits measures sensitivity; it is not a confidence interval.

The group bootstrap uses 10,000 resamples, a dataset-derived seed and PCG64. Its intervals describe resampling under an independent-record assumption. Correlated repeats, a shared extraction batch or systematic measurement error are not resolved by storing more rows or computing a narrower interval.

## What can be reproduced

The fixture's dataset hash is:

```text
sha256:9b018c0f431876df548b57ce42479b4a3c2ca4ca774a66c8d6e64425821bc49a
```

The command prints the scientific-result hash calculated by Node after validation. It also prints the Python code and environment identity actually observed during the run. The fixture deliberately contains placeholder code/environment digests, so this command demonstrates a verified calculation on sealed synthetic inputs; it does **not** claim to reproduce a historical production environment exactly. The current platform and numerical backend can affect full-precision numerical output.

For a saved application report, exact reproduction additionally requires the report's recorded code and environment identities to match. A permitted comparison in another environment is labelled numerical reproduction. A content hash helps detect changed bytes; it cannot certify the truth of a measurement or replace statistical review.

Follow the implementation in [the scientific protocol](scientific-protocol.md), [Python analysis](../analytics/echoclass_analytics/analysis.py), [Node result validation](../src/domain/scientific/result-validation.ts) and [the hand-calculable method tests](../analytics/tests/test_analysis_core.py). Independent scientific acceptance remains pending.
