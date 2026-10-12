# Numerical corrections after the project-entry review

The beta.18 presentation work prompted a separate, bounded review of the Python calculations. The existing method tests passed, but two ordinary inputs exposed incorrect output. Beta.19 retains those counterexamples as regressions. This was AI-assisted review of a defined scope, not independent acceptance of the whole scientific system.

## A point exactly on the IQR fence

For yields `[3, 5, 6, 7, 10]`, linear quartiles are Q1=5 and Q3=7. The upper Tukey fence is `7 + 1.5 × (7−5) = 10`. A strict outlier rule must not flag the final value.

The previous implementation divided by a scale before calculating quartiles. Floating-point subtraction made its normalised upper fence slightly smaller than the final value, which was then flagged. Teacher inclusion did not change, but the quality flag was wrong.

The correction calculates ordered summaries and fences as exact fractions of the sealed decimal values. It converts displayed statistics to float64 once and compares the observations strictly against the exact fences. There is no epsilon that could hide a point just outside the fence. Tests cover equality, the next representable value on either side, fractional quartiles and small/large scales. A nonzero IQR that cannot be represented remains explicitly unavailable.

## Equal means and a spurious R²

Consider four concentration groups:

```text
0%: 0.10, 0.20
1%: 0.15, 0.15
3%: 0.15, 0.15
4%: 0.15, 0.15
```

Their exact decimal means are all 0.15. The earlier implementation correctly retained the best-tested tie, but its separately computed float means differed by one unit in the last place. Regression treated that rounding difference as response variation and returned training R² = −8.5.

The correction uses the same exact group means for summaries, ties and regression. Before each intercept OLS fit, it centres those exact means and scales their deviations, then converts to float64. Coefficients, predictions and diagnostics come from that one fit. Exactly constant responses receive an unavailable R² with `constant_response`; negative results are not simply clipped. Small nonzero differences are retained, while the existing conservative concavity rule is unchanged.

The counterexample now has four displayed means of 0.15, unavailable R², zero training/leave-one-out RMSE and no concave candidate. Tests also check the corrected reports through the Node result validator.

## Node and Python must agree on valid input

The review also found that Node accepted the date `0000-01-01` and required labels containing only U+0085, while Python rejected them. Python accepted U+FEFF-only labels that Node already rejected. The common contract now permits years 0001–9999 and requires text that is nonblank under the union of the two runtimes' whitespace rules. Validation preserves the original text; it does not rewrite names or historical snapshots.

Prospective record validation and newly sealed scientific snapshots reject those invalid cases. The released migrations also depend on the old snapshot validators, so their historical text/date acceptance is explicitly preserved. Old stored inputs remain readable under that contract; unsupported inputs still fail the existing Python boundary if dispatched. Existing incompatible records need explicit correction/review. The update does not silently repair old data, rewrite saved inputs, or change released migrations.

## Reproduction consequences

These are calculation and validation changes. The Python package code digest changes, and numerical result bytes can change even when a rounded conclusion stays the same. The standard synthetic case still ties 1% and 3% and suggests a candidate near 2% with predicted yield near 10%; its scientific-result hash changes from `sha256:4ab4c553bf70ab563c9b00f7c7d9c5bc29398b92d5eb11a30651829752efd81b` to `sha256:6cca959179406e4d1a803d9c0f62448f70829a71286f8c5002e89d2d674b9f48` in the verified local environment.

Saved reports are not recalculated or rewritten. Their original code/environment identity remains part of their history. A corrected implementation is not evidence that an earlier result was produced by the corrected code. The [protocol](scientific-protocol.md) records the numerical policy; the [case](reproducible-case.md) provides the running example.
