"""Independent numerical cross-check of the fixed sixty-trial method study.

This module imports no study-generator or production-analysis helpers. It fits
ordinary, unscaled Vandermonde systems with NumPy lstsq, independently checks
the declared synthetic observations, and recomputes folds and summaries.
The bounded study has concentrations in [0, 4] and yields in [0, 20]. Absolute
and relative tolerances are both 1e-10: they accommodate different float64 OLS
routes without rounding the report or extending this check to extreme inputs.
Hash syntax and paired equality are checked, not cryptographic authenticity.
"""
from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
import json
import math
from pathlib import Path
import re
import statistics
import sys
from typing import Any

import numpy as np

X = [0, 1, 3, 4]
GRID = [x / 4 for x in range(1, 16) if x / 4 not in X]
SEEDS = list(range(1201, 1213))
MODELS = ("constant", "linear", "quadratic")
SCENARIOS = ("constant", "linear", "quadratic_quiet", "quadratic_noisy", "aliased_quartic")
NOISE = (.4, .4, .1, 1., .1)
TOLERANCE = 1e-10
HASH = re.compile(r"sha256:[0-9a-f]{64}\Z")


class AuditError(ValueError):
    """The report disagrees with this bounded numerical cross-check."""


def require(condition: bool, label: str) -> None:
    if not condition:
        raise AuditError(label)


def close(actual: Any, expected: float, label: str) -> None:
    require(type(actual) in (int, float) and math.isfinite(actual), f"{label}: non-finite number")
    require(math.isclose(actual, expected, rel_tol=TOLERANCE, abs_tol=TOLERANCE), f"{label}: numerical mismatch")


def rms(values: list[float]) -> float:
    return math.sqrt(math.fsum(value * value for value in values) / len(values))


def response(scenario: str, x: float) -> float:
    if scenario == "constant":
        return 8.
    if scenario == "linear":
        return 6 + .75 * x
    quadratic = 6 + x * (4 - x)
    return quadratic - x * (x - 1) * (x - 3) * (x - 4) if scenario == "aliased_quartic" else quadratic


def fit(x: list[int], y: list[float], degree: int) -> np.ndarray:
    matrix = np.vander(np.asarray(x, dtype=float), N=degree + 1, increasing=True)
    coefficients, _, rank, _ = np.linalg.lstsq(matrix, np.asarray(y), rcond=None)
    require(rank == degree + 1, "independent fit: rank deficiency")
    return coefficients


def predict(coefficients: np.ndarray, x: float) -> float:
    return math.fsum(float(value) * x**power for power, value in enumerate(coefficients))


def vertex(coefficients: np.ndarray, x: list[int], y: list[float]) -> tuple[float | None, str | None]:
    """Apply the documented original-response-scale concavity margin independently."""
    c, b, a = coefficients
    center = math.fsum(x) / len(x)
    scale = max(abs(value - center) for value in x)
    y_scale = max(abs(value) for value in y) or 1.
    z = (np.asarray(x) - center) / scale
    condition = np.linalg.cond(np.column_stack([z * z, z, np.ones(len(z))]))
    normalized = [a * scale**2 / y_scale, (2 * a * center + b) * scale / y_scale,
                  predict(coefficients, center) / y_scale]
    margin = 64 * np.finfo(float).eps * condition * max(1., *map(abs, normalized))
    if normalized[0] >= -margin:
        return None, "not_concave"
    value = -float(b) / (2 * float(a))
    return (value, None) if 0 < value < 4 else (None, "vertex_outside_range")


def check_summary(summary: dict[str, Any], errors: list[list[float]], label: str) -> None:
    pooled = [value for trial in errors for value in trial]
    trial_errors = [rms(trial) for trial in errors]
    require(summary["available_trials"] == 12 and summary["failed_trials"] == 0, f"{label}: availability counts")
    require(summary["point_count"] == len(pooled), f"{label}: point count")
    for key, expected in {"pooled_rmse": rms(pooled), "mean_trial_rmse": statistics.mean(trial_errors),
                          "trial_rmse_min": min(trial_errors), "trial_rmse_median": statistics.median(trial_errors),
                          "trial_rmse_max": max(trial_errors)}.items():
        close(summary[key], expected, f"{label}.{key}")


def audit_study(report: dict[str, Any]) -> dict[str, Any]:
    require(report["schema"] == "echoclass.method-study.v1" and report["trial_count"] == 60, "study header")
    config = report["configuration"]
    require(config["concentrations"] == X and config["seeds"] == SEEDS and config["unseen_grid"] == GRID,
            "fixed design coordinates/seeds")
    require(config["models"] == list(MODELS) and config["replicates_per_concentration"] == 5, "fixed design models/replicates")
    require([scenario["id"] for scenario in config["scenarios"]] == list(SCENARIOS), "configuration scenarios")
    require([scenario["noise_sd"] for scenario in config["scenarios"]] == list(NOISE), "configuration noise")
    require([scenario["id"] for scenario in report["scenarios"]] == list(SCENARIOS), "report scenarios")
    max_difference = 0.
    folds_checked = points_checked = trials_checked = 0
    for scenario_index, scenario in enumerate(report["scenarios"]):
        require([trial["seed"] for trial in scenario["trials"]] == SEEDS, "trial seeds/counts")
        all_errors: dict[str, dict[str, list[list[float]]]] = {model: {"loco": [], "unseen_grid": []} for model in MODELS}
        regrets: list[float] = []
        reasons: Counter[str] = Counter()
        for trial in scenario["trials"]:
            trials_checked += 1
            for key in ("dataset_hash", "execution_fingerprint", "scientific_result_hash"):
                require(isinstance(trial[key], str) and HASH.fullmatch(trial[key]) is not None, "identity digest syntax")
            require(len(trial["input_hashes"]) == 20 and all(isinstance(value, str) and HASH.fullmatch(value) for value in trial["input_hashes"]), "input digest syntax/count")
            require([group["concentration"] for group in trial["observations"]] == X, "observation concentrations")
            require([group["concentration"] for group in trial["group_means"]] == X, "mean concentrations")
            rng = np.random.Generator(np.random.PCG64(trial["seed"]))
            bound = math.sqrt(3) * NOISE[scenario_index]
            means = []
            for index, group in enumerate(trial["observations"]):
                require(len(group["yields"]) == 5, "replicate count")
                noise = rng.uniform(-bound, bound, size=5)
                for observed, error in zip(group["yields"], noise, strict=True):
                    expected = float(Decimal(str(response(scenario["id"], X[index]) + float(error))).quantize(Decimal(".01"), rounding=ROUND_HALF_UP))
                    require(type(observed) in (int, float) and math.isfinite(observed) and observed == expected, "declared synthetic observations")
                mean = float(sum((Fraction(Decimal(str(value))) for value in group["yields"]), Fraction()) / 5)
                require(trial["group_means"][index]["mean"] == mean, "exact decimal group mean")
                means.append(mean)
            require(set(trial["models"]) == set(MODELS), "model set")
            quadratic_vertices = []
            for degree, name in enumerate(MODELS):
                model = trial["models"][name]
                require(model["available"] is True and model["failure_reason"] is None, "fixed-design fit availability")
                require(model["loco"]["available"] is True and model["loco"]["failure_reason"] is None, "fixed-design fold availability")
                coefficients = fit(X, means, degree)
                expected_coefficients = {"a": coefficients[2], "b": coefficients[1], "c": coefficients[0]} if degree == 2 else {"intercept": coefficients[0], "slope": coefficients[1] if degree else 0.}
                require(set(model["coefficients"]) == set(expected_coefficients), "coefficient keys")
                for key, expected in expected_coefficients.items():
                    close(model["coefficients"][key], float(expected), "fit coefficient")
                require(len(model["loco"]["folds"]) == 4, "fold count")
                errors = []
                for held_out, fold in enumerate(model["loco"]["folds"]):
                    folds_checked += 1
                    train_x = X[:held_out] + X[held_out + 1:]
                    train_y = means[:held_out] + means[held_out + 1:]
                    require(fold["held_out_concentration"] == X[held_out] and fold["training_concentrations"] == train_x, "held-out training isolation")
                    require(fold["extrapolation"] is (held_out in (0, 3)), "fold extrapolation flag")
                    fold_coefficients = fit(train_x, train_y, degree)
                    predicted = predict(fold_coefficients, X[held_out])
                    close(fold["observed_mean"], means[held_out], "fold observed mean")
                    close(fold["predicted_mean"], predicted, "fold prediction")
                    max_difference = max(max_difference, abs(fold["predicted_mean"] - predicted))
                    error = means[held_out] - predicted
                    close(fold["residual"], error, "fold residual")
                    errors.append(error)
                    if degree == 2:
                        value, reason = vertex(fold_coefficients, train_x, train_y)
                        require(fold["vertex_reason"] == reason, "fold vertex reason")
                        close(fold["vertex"], value, "fold vertex") if value is not None else require(fold["vertex"] is None, "unavailable fold vertex")
                        quadratic_vertices.append(value)
                close(model["loco"]["rmse"], rms(errors), "trial LOCO RMSE")
                all_errors[name]["loco"].append(errors)
                require([point["concentration"] for point in model["unseen_grid"]["points"]] == GRID, "unseen grid coordinates/count")
                grid_errors = []
                for point in model["unseen_grid"]["points"]:
                    points_checked += 1
                    predicted = predict(coefficients, point["concentration"])
                    actual = response(scenario["id"], point["concentration"])
                    close(point["predicted"], predicted, "grid prediction")
                    max_difference = max(max_difference, abs(point["predicted"] - predicted))
                    close(point["truth"], actual, "grid truth")
                    close(point["residual"], actual - predicted, "grid residual")
                    grid_errors.append(actual - predicted)
                close(model["unseen_grid"]["rmse"], rms(grid_errors), "trial grid RMSE")
                all_errors[name]["unseen_grid"].append(grid_errors)
            candidate = trial["quadratic_candidate"]
            value, reason = vertex(coefficients, X, means)
            if value is not None and any(item is None for item in quadratic_vertices):
                value, reason = None, "fold_unstable"
            require(candidate["available"] is (value is not None) and candidate["reason"] == reason, "candidate availability/reason")
            maximum = 8. if scenario_index == 0 else 9. if scenario_index == 1 else 10.
            close(candidate["true_maximum_on_domain"]["yield"], maximum, "true maximum")
            require(candidate["true_maximum_on_domain"]["domain"] == [0, 4], "maximum domain")
            locations = None if scenario_index == 0 else [4.] if scenario_index == 1 else [2 - math.sqrt(2), 2 + math.sqrt(2)] if scenario_index == 4 else [2.]
            location_type = "entire_domain" if scenario_index == 0 else "endpoint" if scenario_index == 1 else "interior"
            require(candidate["true_maximum_on_domain"]["location"] == location_type, "maximum location type")
            reported_locations = candidate["true_maximum_on_domain"]["concentrations"]
            if locations is None:
                require(reported_locations is None, "constant response maximum locations")
            else:
                require(len(reported_locations) == len(locations), "maximum location count")
                for actual_location, expected in zip(reported_locations, locations, strict=True):
                    close(actual_location, expected, "maximum location")
            if value is None:
                require(all(candidate[field] is None for field in ("concentration", "predicted_yield", "leave_one_out_vertex_range", "true_yield_at_candidate", "true_regret")), "withheld candidate values")
                reasons[reason] += 1
            else:
                actual = response(scenario["id"], value)
                for key, expected in {"concentration": value, "predicted_yield": predict(coefficients, value), "true_yield_at_candidate": actual, "true_regret": maximum - actual}.items():
                    close(candidate[key], expected, f"candidate {key}")
                require(len(candidate["leave_one_out_vertex_range"]) == 2, "candidate vertex range")
                for actual_bound, expected in zip(candidate["leave_one_out_vertex_range"], [min(quadratic_vertices), max(quadratic_vertices)], strict=True):
                    close(actual_bound, expected, "candidate sensitivity bound")
                regrets.append(maximum - actual)
        for name in MODELS:
            summary = scenario["summary"]["models"][name]
            require(summary["fit_failed_trials"] == 0, "fit failure count")
            for metric in ("loco", "unseen_grid"):
                check_summary(summary[metric], all_errors[name][metric], metric)
            for label, indices in (("endpoint_extrapolation", [0, 3]), ("interior_interpolation", [1, 2])):
                subset = [errors[index] for errors in all_errors[name]["loco"] for index in indices]
                require(summary["loco"][label]["point_count"] == 24, "subset point count")
                close(summary["loco"][label]["pooled_rmse"], rms(subset), "subset RMSE")
        summary = scenario["summary"]["quadratic_candidate"]
        require(summary["available_trials"] == len(regrets) and summary["withheld_trials"] == 12 - len(regrets), "candidate counts")
        require(summary["withheld_reasons"] == dict(reasons), "candidate reason counts")
        close(summary["withheld_fraction"], (12 - len(regrets)) / 12, "withheld fraction")
        close(summary["mean_true_regret_when_available"], statistics.mean(regrets), "conditional regret") if regrets else require(summary["mean_true_regret_when_available"] is None, "unavailable conditional regret")
    quiet, alias = report["scenarios"][2], report["scenarios"][4]
    for first, second in zip(quiet["trials"], alias["trials"], strict=True):
        for field in ("seed", "observations", "group_means", "input_hashes", "dataset_hash", "execution_fingerprint", "bootstrap_seed_hex", "scientific_result_hash"):
            require(first[field] == second[field], f"alias pair {field}")
        for model in MODELS:
            require(first["models"][model]["loco"] == second["models"][model]["loco"], "alias LOCO identity")
    return {"status": "PASS", "scope": "Independent fixed-study numerical cross-check; not statistical certification or hash authenticity verification",
            "trials_checked": trials_checked, "loco_folds_checked": folds_checked, "unseen_predictions_checked": points_checked,
            "alias_pairs_checked": 12, "absolute_tolerance": TOLERANCE, "relative_tolerance": TOLERANCE,
            "max_prediction_difference": max_difference}


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
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
        result = audit_study(json.loads(args.study_json.read_text(encoding="utf-8"),
                                       object_pairs_hook=unique_object, parse_constant=reject_nonfinite))
        print(json.dumps(result, allow_nan=False, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError, IndexError, ArithmeticError):
        print("Method-study audit failed; no successful cross-check was accepted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
