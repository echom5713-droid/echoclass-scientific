"""Bounded independent check of the fixed two-hypothesis follow-up design.

The checker imports neither the generator nor the production analysis. It
reconstructs every fixed Gaussian draw, classifies through a signed midpoint
rule, and checks the analytic normal-tail risk separately. Matching counts
support this specified simulation, not an unknown physical response family.
Identity syntax is checked; this is not a cryptographic provenance certificate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from typing import Any

import numpy as np

TOLERANCE = 1e-12
HASH = re.compile(r"sha256:[0-9a-f]{64}\Z")
GRID = [index / 4 for index in range(17)]
TRIALS = 10_000
SIGMAS = [1, 2, 4]
REPLICATES = [1, 3, 5]
LOCATIONS = [("repeat_original", 1), ("off_center", .5), ("max_separation", 2)]


# Independent copy of the fixed version-one protocol; never loaded from a report.
EXPECTED_CONFIG = {'schema': 'echoclass.followup-design-config.v1',
 'design_status': 'Fixed synthetic design specified before simulation; no outcome-based selection or seed search. '
                  'Not independently preregistered.',
 'response_unit': 'yield percentage points',
 'hypotheses': [{'id': 'q', 'formula': '6 + 4*x - x*x'}, {'id': 'f', 'formula': 'q(x) - x*(x-1)*(x-3)*(x-4)'}],
 'original_concentrations': [0, 1, 3, 4],
 'candidate_grid': [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4],
 'selection_rule': 'Maximize absolute difference of the two fully specified noiseless responses over the fixed '
                   'grid before drawing any new data; break equal maxima by the smaller concentration.',
 'designs': [{'id': 'repeat_original', 'concentration': 1},
             {'id': 'off_center', 'concentration': 0.5},
             {'id': 'max_separation', 'concentration': 2}],
 'noise_standard_deviations': [1, 2, 4],
 'replicate_counts': [1, 3, 5],
 'trials_per_truth_noise_replication': 10000,
 'rng': {'generator': 'numpy.random.Generator(PCG64(SeedSequence(entropy)))',
         'base_seed': 2101,
         'entropy_order': ['base_seed', 'truth_index', 'noise_index', 'replication_index'],
         'draw_order': 'One standard_normal((10000, n)) array per entropy tuple, C order; mean(axis=1) then '
                       'multiply by sigma.',
         'pairing': 'Fresh independent draws across the 18 truth/noise/replication cells. Within each cell, reuse '
                    'the same standard-normal replicate array for all three design choices. Trials across designs '
                    'are paired, not independent.'},
 'observation_model': 'Independent Gaussian errors with known common standard deviation within a cell. No '
                      'rounding, clipping, truncation, rejection sampling, or reuse of original four-point '
                      'observations.',
 'decision_rule': 'Choose the fully specified response whose predicted mean is nearest to the new replicate mean. '
                  'Exact distance ties choose q on even zero-based trial indices and f on odd indices. The tie '
                  'rule does not use truth.',
 'analytic_error': 'For either truth: Phi(-abs(q(x)-f(x))*sqrt(n)/(2*sigma)); at equal predictions the balanced '
                   'tie rule has conditional error 0.5 over the 10000 trial indices.',
 'aggregation': 'Report conditional errors under each truth separately. Their arithmetic mean is the error under '
                'an explicitly equal prior on q and f. Monte Carlo minus analytic error is a descriptive '
                'discrepancy, not a confidence interval or acceptance threshold.',
 'remaining_alias_formula': 'g(x) = q(x) - x*(x-1)*(x-2)*(x-3)*(x-4)',
 'limitations': ['Both response functions and the Gaussian noise standard deviation are assumed known; they are '
                 'not estimated from four observations.',
                 'This is a fixed binary discrimination calculation, not adaptive discovery, general optimal '
                 'experimental design, optimum validation, or a chemical mechanism.',
                 'Gaussian draws may leave a physically feasible yield range. No clipping is performed because it '
                 'would change the declared analytical model.',
                 'The prior is used only to label the average of the two conditional error rates. No population '
                 'prevalence is inferred.',
                 'A fifth noiseless point separates q from f but does not identify an arbitrary response: the '
                 'constructed g still agrees with q at all five concentrations.',
                 'This standalone study reads no classroom database, calls no production worker, fits no model, '
                 'and does not modify the production candidate rule.',
                 'Exact random-number replay depends on the recorded Python, NumPy, and platform environment. '
                 'Source identity is not independent certification.']}


class AuditError(ValueError):
    """The report disagrees with this fixed-design reconstruction."""


def require(condition: bool, label: str) -> None:
    if not condition:
        raise AuditError(label)


def close(actual: Any, expected: float, label: str) -> None:
    require(type(actual) in (int, float) and math.isfinite(actual), f"{label}: non-finite number")
    require(math.isclose(actual, expected, rel_tol=TOLERANCE, abs_tol=TOLERANCE), f"{label}: numerical mismatch")


def integer(actual: Any, expected: int, label: str) -> None:
    require(type(actual) is int and actual == expected, f"{label}: integer mismatch")


def keys(actual: Any, expected: set[str], label: str) -> None:
    require(type(actual) is dict and set(actual) == expected, f"{label}: field set")


def values(x: float) -> tuple[float, float]:
    """Symmetric polynomial expressions, separate from the generator's helpers."""
    t = x - 2
    return 10 - t * t, 6 + 4 * t * t - t**4


def fifth_point_alias(x: float) -> float:
    return values(x)[0] - math.prod(x - root for root in range(5))


def normal_error(gap: float, sigma: float, n: int) -> float:
    return math.erfc(gap * math.sqrt(n) / (math.sqrt(8) * sigma)) / 2


def fixed(actual: Any, expected: Any, label: str) -> None:
    """Check the complete fixed protocol without accepting bools as numbers."""
    if type(expected) is dict:
        keys(actual, set(expected), label)
        for key, value in expected.items():
            fixed(actual[key], value, f"{label}.{key}")
    elif type(expected) is list:
        require(type(actual) is list and len(actual) == len(expected), f"{label}: list length")
        for index, value in enumerate(expected):
            fixed(actual[index], value, f"{label}[{index}]")
    elif type(expected) is int:
        integer(actual, expected, label)
    elif type(expected) is float:
        require(type(actual) in (int, float) and actual == expected, f"{label}: fixed number")
    else:
        require(type(actual) is type(expected) and actual == expected, f"{label}: fixed value")


def identity(record: Any) -> None:
    keys(record, {"study_code_hash", "configuration_file_hash", "runtime_fingerprint", "runtime", "runtime_scope"}, "identity")
    for field in ("study_code_hash", "configuration_file_hash", "runtime_fingerprint"):
        require(type(record[field]) is str and HASH.fullmatch(record[field]) is not None, "identity digest syntax")
    fixed(record["runtime_scope"], "Numerical Python process only; Node validates and formats output without drawing samples.", "runtime scope")
    runtime = record["runtime"]
    keys(runtime, {"python", "numpy_version", "platform", "byteorder"}, "runtime")
    keys(runtime["python"], {"implementation", "version", "build", "compiler"}, "Python identity")
    keys(runtime["platform"], {"system", "release", "machine", "libc"}, "platform identity")
    for value in [runtime["numpy_version"], *[runtime["python"][key] for key in ("implementation", "version", "compiler")],
                  *[runtime["platform"][key] for key in ("system", "release", "machine")]]:
        require(type(value) is str and 0 < len(value) <= 4096, "runtime identity text")
    for pair in (runtime["python"]["build"], runtime["platform"]["libc"]):
        require(type(pair) is list and len(pair) == 2 and all(type(value) is str and len(value) <= 4096 for value in pair), "runtime identity pair")
    require(runtime["byteorder"] in ("little", "big"), "runtime byte order")
    encoded = json.dumps(runtime, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    require(record["runtime_fingerprint"] == "sha256:" + hashlib.sha256(encoded).hexdigest(), "runtime fingerprint self-consistency")


def prediction(point: Any, x: float, label: str, alias: bool = False) -> None:
    second = "g_mean" if alias else "f_mean"
    keys(point, {"concentration", "q_mean", second, "absolute_gap"}, label)
    q, f = values(x)
    if alias:
        f = fifth_point_alias(x)
    for key, expected in {"concentration": x, "q_mean": q, second: f, "absolute_gap": abs(q - f)}.items():
        close(point[key], expected, f"{label}.{key}")


def audit_study(report: dict[str, Any]) -> dict[str, Any]:
    keys(report, {"schema", "configuration", "identity", "design", "simulation", "results", "remaining_alias"}, "report")
    fixed(report["schema"], "echoclass.followup-design.v1", "report schema")
    fixed(report["configuration"], EXPECTED_CONFIG, "configuration")
    identity(report["identity"])
    design = report["design"]
    keys(design, {"candidate_predictions", "selected_concentration", "selected_gap", "maximizers", "selection_before_sampling", "choices"}, "design")
    require(type(design["candidate_predictions"]) is list and len(design["candidate_predictions"]) == len(GRID), "candidate grid count")
    for point, x in zip(design["candidate_predictions"], GRID, strict=True):
        prediction(point, x, "candidate prediction")
    # Independent global proof: u=(x-2)^2 lies in [0,4]. Signed gap is
    # u^2-5u+4, with endpoint values 4 and 0 and minimum -9/4 at u=5/2.
    # Thus the unique largest absolute gap is 4, at x=2, also on this grid.
    close(design["selected_concentration"], 2, "selected concentration")
    close(design["selected_gap"], 4, "selected gap")
    fixed(design["maximizers"], [2], "maximizers")
    require(design["selection_before_sampling"] is True, "selection order declaration")
    require(type(design["choices"]) is list and len(design["choices"]) == 3, "design choices count")
    for choice, (name, x) in zip(design["choices"], LOCATIONS, strict=True):
        keys(choice, {"id", "concentration", "q_mean", "f_mean", "absolute_gap"}, "design choice")
        fixed(choice["id"], name, "design choice identity")
        prediction({key: value for key, value in choice.items() if key != "id"}, x, "design choice prediction")
    fixed(report["simulation"], {"conditional_cell_count": 54, "trials_per_cell": TRIALS,
                                "paired_noise_batch_count": 18, "independent_trial_mean_draw_count": 180_000,
                                "independent_record_draw_count": 540_000, "design_trial_evaluations": 540_000}, "simulation counts")
    rows = report["results"]
    require(type(rows) is list and len(rows) == 27, "result row count")
    standard_means = {}
    for truth_index in range(2):
        for sigma_index in range(3):
            for replication_index, n in enumerate(REPLICATES):
                entropy = [2101, truth_index, sigma_index, replication_index]
                rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence(entropy)))
                draws = rng.standard_normal((TRIALS, n))
                standard_means[(truth_index, sigma_index, replication_index)] = draws.mean(axis=1)
    rows_checked = classifications_checked = 0
    max_analytic_difference = 0.
    tie_assignments = np.arange(TRIALS) % 2
    for design_index, (name, x) in enumerate(LOCATIONS):
        q, f = values(x)
        midpoint = (q + f) / 2
        for sigma_index, sigma in enumerate(SIGMAS):
            for replication_index, n in enumerate(REPLICATES):
                row = rows[design_index * 9 + sigma_index * 3 + replication_index]
                rows_checked += 1
                keys(row, {"design_id", "concentration", "noise_sd", "replicates", "analytic_conditional_error",
                           "q", "f", "equal_prior_error_rate", "equal_prior_signed_discrepancy"}, "result row")
                fixed(row["design_id"], name, "result design order")
                close(row["concentration"], x, "result concentration")
                close(row["noise_sd"], sigma, "result noise")
                integer(row["replicates"], n, "result replicates")
                analytic = normal_error(abs(q - f), sigma, n)
                close(row["analytic_conditional_error"], analytic, "analytic conditional risk")
                max_analytic_difference = max(max_analytic_difference, abs(row["analytic_conditional_error"] - analytic))
                rates = []
                for truth_index, truth in enumerate(("q", "f")):
                    cell = row[truth]
                    keys(cell, {"seed_entropy", "trials", "error_count", "error_rate", "tie_count",
                                "assigned_q", "assigned_f", "signed_discrepancy"}, "conditional result")
                    fixed(cell["seed_entropy"], [2101, truth_index, sigma_index, replication_index], "seed entropy")
                    integer(cell["trials"], TRIALS, "conditional trials")
                    means = (q if truth_index == 0 else f) + sigma * standard_means[(truth_index, sigma_index, replication_index)]
                    signed = (means - midpoint) * (q - f)
                    ties = signed == 0
                    # Distinct midpoint route, not the generator's two distances.
                    assignments = np.where(ties, tie_assignments, np.where(signed > 0, 0, 1))
                    errors = int(np.count_nonzero(assignments != truth_index))
                    integer(cell["error_count"], errors, "reconstructed error count")
                    integer(cell["tie_count"], int(np.count_nonzero(ties)), "reconstructed tie count")
                    integer(cell["assigned_q"], int(np.count_nonzero(assignments == 0)), "reconstructed q assignments")
                    integer(cell["assigned_f"], int(np.count_nonzero(assignments == 1)), "reconstructed f assignments")
                    rate = errors / TRIALS
                    close(cell["error_rate"], rate, "conditional error rate")
                    close(cell["signed_discrepancy"], rate - analytic, "conditional signed discrepancy")
                    rates.append(rate)
                    classifications_checked += TRIALS
                equal_prior_rate = math.fsum(rates) / 2
                close(row["equal_prior_error_rate"], equal_prior_rate, "equal-prior error rate")
                close(row["equal_prior_signed_discrepancy"], equal_prior_rate - analytic, "equal-prior signed discrepancy")
    remaining = report["remaining_alias"]
    keys(remaining, {"formula", "agreement_concentrations", "grid_predictions"}, "remaining alias")
    fixed(remaining["formula"], EXPECTED_CONFIG["remaining_alias_formula"], "remaining alias formula")
    fixed(remaining["agreement_concentrations"], list(range(5)), "remaining alias agreement")
    require(type(remaining["grid_predictions"]) is list and len(remaining["grid_predictions"]) == 17, "remaining alias grid count")
    for point, x in zip(remaining["grid_predictions"], GRID, strict=True):
        prediction(point, x, "remaining alias prediction", alias=True)
    return {"status": "PASS", "scope": "Independent fixed two-hypothesis simulation cross-check; not physical validation or source provenance certification",
            "design_rows_checked": rows_checked, "conditional_cells_checked": 2 * rows_checked,
            "independent_noise_batches_replayed": len(standard_means), "classifications_checked": classifications_checked,
            "candidate_predictions_checked": len(GRID), "remaining_alias_predictions_checked": len(GRID),
            "absolute_tolerance": TOLERANCE, "relative_tolerance": TOLERANCE,
            "max_analytic_probability_difference": max_analytic_difference}


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def reject_nonfinite(token: str) -> None:
    raise AuditError("non-finite JSON token")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("study_json", type=Path)
    args = parser.parse_args()
    try:
        require(args.study_json.stat().st_size <= 16 * 1024 * 1024, "study JSON exceeds 16 MiB")
        report = json.loads(args.study_json.read_text(encoding="utf-8"), object_pairs_hook=unique_object,
                            parse_constant=reject_nonfinite)
        print(json.dumps(audit_study(report), allow_nan=False, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError, IndexError, ArithmeticError, RecursionError):
        print("Follow-up design audit failed; no successful cross-check was accepted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
