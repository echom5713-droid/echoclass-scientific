"""Fixed synthetic stress tests; not a new production scientific algorithm.

All quadratic results pass the existing canonical input and output boundaries.
The independent baselines use the same concentration-mean target and weighting.
No observed study outcome changes the configuration, fitted model, or seeds.
"""
from __future__ import annotations

import argparse
import copy
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
from typing import Any

import numpy as np

from echoclass_analytics.analysis import analyze
from echoclass_analytics.identity import get_identity
from echoclass_analytics.models import ProtocolError, strict_json_loads

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).with_name("method-study-v1.config.json")
BRIDGE = Path(__file__).with_name("seal-study-input.mjs")
FIXTURE = ROOT / "tests/fixtures/scientific/synthetic-envelope.json"
MODELS = ("constant", "linear", "quadratic")
STUDY_SOURCES = (
    "analytics/experiments/__init__.py",
    "analytics/experiments/method-study-v1.config.json",
    "analytics/experiments/method_study.py",
    "analytics/experiments/seal-study-input.mjs",
    "scripts/method-study.mjs",
)


def load_config() -> dict[str, Any]:
    return strict_json_loads(CONFIG.read_bytes())


def file_hash(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def study_source_hash() -> str:
    """Framed UTF-8 path and bytes, sorted by path; no timestamps or Git claims."""
    digest = hashlib.sha256()
    for relative in sorted(STUDY_SOURCES):
        for value in (relative.encode("utf-8"), (ROOT / relative).read_bytes()):
            digest.update(len(value).to_bytes(8, "big"))
            digest.update(value)
    return "sha256:" + digest.hexdigest()


def truth(scenario: str, concentration: float) -> float:
    x = concentration
    if scenario == "constant":
        return 8.0
    if scenario == "linear":
        return 6 + .75 * x
    if scenario in ("quadratic_quiet", "quadratic_noisy"):
        return 6 + 4 * x - x * x
    if scenario == "aliased_quartic":
        z = x - 2
        return 6 + 4 * z * z - z**4
    raise ValueError("Unknown fixed study scenario")


def truth_maximum(scenario: str) -> dict[str, Any]:
    """Analytic maximum on the closed study domain [0, 4], not a grid maximum."""
    if scenario == "constant":
        return {"yield": 8.0, "concentrations": None, "domain": [0, 4], "location": "entire_domain"}
    if scenario == "linear":
        return {"yield": 9.0, "concentrations": [4.0], "domain": [0, 4], "location": "endpoint"}
    if scenario in ("quadratic_quiet", "quadratic_noisy"):
        return {"yield": 10.0, "concentrations": [2.0], "domain": [0, 4], "location": "interior"}
    if scenario == "aliased_quartic":
        return {"yield": 10.0, "concentrations": [2 - math.sqrt(2), 2 + math.sqrt(2)], "domain": [0, 4], "location": "interior"}
    raise ValueError("Unknown fixed study scenario")


def generate_observations(scenario: dict[str, Any], seed: int, config: dict[str, Any]) -> list[dict[str, Any]]:
    generator = np.random.Generator(np.random.PCG64(seed))
    bound = math.sqrt(3) * scenario["noise_sd"]
    groups = []
    for x in config["concentrations"]:
        errors = generator.uniform(-bound, bound, size=config["replicates_per_concentration"])
        values = [float(Decimal(str(truth(scenario["id"], x) + float(error))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) for error in errors]
        # Failing a fixed design is visible. Never repair or resample observations.
        if not all(0 <= value <= 20 for value in values):
            raise ValueError("Fixed study generated observations outside the scientific contract")
        groups.append({"concentration": x, "yields": values})
    return groups


def synthetic_inputs(groups: list[dict[str, Any]], seed: int) -> list[dict[str, Any]]:
    template = strict_json_loads(strict_json_loads(FIXTURE.read_bytes())["canonical_inputs"][0]["canonical_json"])
    inputs = []
    for group in groups:
        for value in group["yields"]:
            item = copy.deepcopy(template)
            ordinal = len(inputs)
            record, review = item["record_snapshot"], item["review_snapshot"]
            identifier = f"study-{seed}-{ordinal:03d}"
            review_id = f"review-{identifier}"
            # Scenario truth is deliberately absent: alias pairs are the exact
            # same observed dataset. A model must never receive oracle truth.
            record.update(id=identifier, nh4cl_concentration=group["concentration"],
                          oil_mass=value, yield_percent=value, effective_review_id=review_id,
                          student_name="Synthetic record", metadata={"synthetic_method_study": True},
                          note="Designed simulation; not a real observation")
            review.update(id=review_id, record_id=identifier, event_sequence=ordinal + 1)
            inputs.append(item)
    return inputs


def bridge(operation: str, payload: Any) -> Any:
    output = subprocess.run(["node", str(BRIDGE), operation], input=json.dumps(payload, allow_nan=False),
                            cwd=ROOT, text=True, capture_output=True, timeout=30, check=True)
    return strict_json_loads(output.stdout)


def fit_baseline(model: str, x: list[float], y: list[float]) -> dict[str, float]:
    if len(x) != len(y) or not x or len(set(x)) != len(x):
        raise ValueError("Baseline requires distinct concentration means")
    mean_y = math.fsum(y) / len(y)
    if model == "constant":
        return {"intercept": mean_y, "slope": 0.0}
    if model != "linear" or len(x) < 2:
        raise ValueError("Unsupported or unidentifiable baseline")
    mean_x = math.fsum(x) / len(x)
    denominator = math.fsum((value - mean_x)**2 for value in x)
    slope = math.fsum((xx - mean_x) * (yy - mean_y) for xx, yy in zip(x, y, strict=True)) / denominator
    return {"intercept": mean_y - slope * mean_x, "slope": slope}


def baseline_predict(coefficients: dict[str, float], x: float) -> float:
    return coefficients["intercept"] + coefficients["slope"] * x


def baseline_folds(model: str, x: list[float], y: list[float]) -> list[dict[str, Any]]:
    folds = []
    for held_out, concentration in enumerate(x):
        training_x = [value for index, value in enumerate(x) if index != held_out]
        training_y = [value for index, value in enumerate(y) if index != held_out]
        coefficients = fit_baseline(model, training_x, training_y)
        predicted = baseline_predict(coefficients, concentration)
        folds.append({"held_out_concentration": concentration, "training_concentrations": training_x,
                      "observed_mean": y[held_out], "predicted_mean": predicted,
                      "residual": y[held_out] - predicted,
                      "extrapolation": concentration < min(training_x) or concentration > max(training_x)})
    return folds


def rmse(residuals: list[float]) -> float | None:
    return math.sqrt(math.fsum(value * value for value in residuals) / len(residuals)) if residuals else None


def evaluate_trial(scenario: dict[str, Any], seed: int, observations: list[dict[str, Any]],
                   envelope: dict[str, Any], result: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    x = [group["concentration"] for group in result["groups"]]
    y = [group["statistics"]["mean"]["value"] for group in result["groups"]]
    models = {}
    for model in MODELS:
        if model == "quadratic":
            regression = result["regression"]
            available, reason = regression["available"], regression["reason"]
            coefficients = regression["coefficients"]
            folds = [{**fold, "training_concentrations": [value for value in x if value != fold["held_out_concentration"]]} for fold in regression["loocv"]["folds"]]
            loco_available = regression["loocv"]["available"]
            loco_reason = regression["loocv"]["reason"]
            predict = lambda value: coefficients["a"] * value * value + coefficients["b"] * value + coefficients["c"]
        else:
            available, reason = True, None
            coefficients = fit_baseline(model, x, y)
            folds = baseline_folds(model, x, y)
            loco_available, loco_reason = True, None
            predict = lambda value: baseline_predict(coefficients, value)
        grid = []
        if available:
            for value in config["unseen_grid"]:
                predicted, actual = predict(value), truth(scenario["id"], value)
                grid.append({"concentration": value, "truth": actual, "predicted": predicted, "residual": actual - predicted})
        models[model] = {"available": available, "failure_reason": reason, "coefficients": coefficients,
                         "loco": {"available": loco_available, "failure_reason": loco_reason,
                                  "rmse": rmse([fold["residual"] for fold in folds]) if loco_available else None, "folds": folds},
                         "unseen_grid": {"rmse": rmse([point["residual"] for point in grid]), "points": grid}}
    candidate = copy.deepcopy(result["candidate"])
    concentration = candidate["concentration"]
    candidate["available"] = concentration is not None
    candidate["true_yield_at_candidate"] = truth(scenario["id"], concentration) if concentration is not None else None
    candidate["true_maximum_on_domain"] = truth_maximum(scenario["id"])
    candidate["true_regret"] = candidate["true_maximum_on_domain"]["yield"] - candidate["true_yield_at_candidate"] if concentration is not None else None
    return {"seed": seed, "observations": observations, "dataset_hash": envelope["dataset_hash"],
            "execution_fingerprint": envelope["execution_fingerprint"],
            "bootstrap_seed_hex": result["configuration"]["seed_hex"],
            "input_hashes": [item["input_hash"] for item in envelope["canonical_inputs"]],
            "group_means": [{"concentration": xx, "mean": yy} for xx, yy in zip(x, y, strict=True)],
            "models": models, "quadratic_candidate": candidate}


def aggregate_metric(trials: list[dict[str, Any]], model: str, metric: str) -> dict[str, Any]:
    details = [trial["models"][model][metric] for trial in trials]
    available = [detail for detail in details if detail["rmse"] is not None]
    points_key = "folds" if metric == "loco" else "points"
    residuals = [point["residual"] for detail in available for point in detail[points_key]]
    trial_errors = [detail["rmse"] for detail in available]
    result = {"available_trials": len(available), "failed_trials": len(trials) - len(available),
              "point_count": len(residuals), "pooled_rmse": rmse(residuals),
              "mean_trial_rmse": statistics.mean(trial_errors) if trial_errors else None,
              "trial_rmse_min": min(trial_errors) if trial_errors else None,
              "trial_rmse_median": statistics.median(trial_errors) if trial_errors else None,
              "trial_rmse_max": max(trial_errors) if trial_errors else None}
    if metric == "loco":
        for label, extrapolation in (("endpoint_extrapolation", True), ("interior_interpolation", False)):
            selected = [fold["residual"] for detail in available for fold in detail["folds"] if fold["extrapolation"] == extrapolation]
            result[label] = {"point_count": len(selected), "pooled_rmse": rmse(selected)}
    return result


def summarize(trials: list[dict[str, Any]]) -> dict[str, Any]:
    candidates = [trial["quadratic_candidate"] for trial in trials]
    reasons: dict[str, int] = {}
    for candidate in candidates:
        if not candidate["available"]:
            reason = candidate["reason"]
            reasons[reason] = reasons.get(reason, 0) + 1
    available = [candidate for candidate in candidates if candidate["available"]]
    return {"models": {model: {"fit_failed_trials": sum(not trial["models"][model]["available"] for trial in trials),
                               "loco": aggregate_metric(trials, model, "loco"),
                               "unseen_grid": aggregate_metric(trials, model, "unseen_grid")} for model in MODELS},
            "quadratic_candidate": {"available_trials": len(available), "withheld_trials": len(trials) - len(available),
                                    "withheld_fraction": (len(trials) - len(available)) / len(trials), "withheld_reasons": reasons,
                                    "mean_true_regret_when_available": statistics.mean(candidate["true_regret"] for candidate in available) if available else None}}


def run_study() -> dict[str, Any]:
    config = load_config()
    identity = get_identity()
    design = [(scenario, seed, generate_observations(scenario, seed, config)) for scenario in config["scenarios"] for seed in config["seeds"]]
    sealed = bridge("seal", {"datasets": [synthetic_inputs(groups, seed) for _, seed, groups in design], "identity": identity})
    envelopes = sealed["envelopes"]
    results = [analyze(envelope) for envelope in envelopes]
    hashes = bridge("verify", [{"envelope": envelope, "result": result} for envelope, result in zip(envelopes, results, strict=True)])
    scenarios = []
    offset = 0
    for scenario in config["scenarios"]:
        trials = []
        for _ in config["seeds"]:
            declared_scenario, seed, groups = design[offset]
            trial = evaluate_trial(declared_scenario, seed, groups, envelopes[offset], results[offset], config)
            trial["scientific_result_hash"] = hashes[offset]
            trials.append(trial)
            offset += 1
        scenarios.append({"id": scenario["id"], "label": scenario["label"], "summary": summarize(trials), "trials": trials})
    return {"schema": "echoclass.method-study.v1", "label": "Designed synthetic stress tests; not real experiments or scientific validation",
            "configuration": config,
            "identity": {"study_code_hash": study_source_hash(), "configuration_file_hash": file_hash(CONFIG),
                         "template_file_hash": file_hash(FIXTURE), "study_source_files": list(STUDY_SOURCES),
                         "study_hash_encoding": "SHA-256 of sorted relative UTF-8 paths and exact bytes, each framed by uint64be byte length",
                         "production_python": identity, "production_node_code_version": sealed["node_code_version"]},
            "trial_count": len(design), "scenarios": scenarios}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the fixed synthetic method-comparison study; no database or model calls")
    parser.parse_args()  # No flags can silently change the fixed experiment.
    try:
        result = run_study()
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
        return 0
    except (OSError, ValueError, ProtocolError, subprocess.SubprocessError):
        print("Method study failed; verify the locked Python environment and run npm run build. No partial result was accepted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
