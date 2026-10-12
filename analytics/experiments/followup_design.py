"""Fixed follow-up for two known response functions, not a production model.

The grid decision precedes all simulation. Fresh Gaussian replicate arrays are
paired across designs only; original observations and production code are unused.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import platform
import sys
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).with_name("followup-design-v1.config.json")
SOURCES = (
    "analytics/experiments/followup-design-v1.config.json",
    "analytics/experiments/followup_design.py",
    "scripts/followup-design.mjs",
)
TRUTHS = ("q", "f")


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate configuration key")
        result[key] = value
    return result


def _reject_constant(_: str) -> None:
    raise ValueError("Non-finite configuration value")


def load_config() -> dict[str, Any]:
    config = json.loads(CONFIG.read_text(encoding="utf-8"),
                        object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)
    expected = {
        "schema": "echoclass.followup-design-config.v1",
        "original_concentrations": [0, 1, 3, 4],
        "candidate_grid": [i / 4 for i in range(17)],
        "designs": [{"id": "repeat_original", "concentration": 1},
                    {"id": "off_center", "concentration": .5},
                    {"id": "max_separation", "concentration": 2}],
        "noise_standard_deviations": [1, 2, 4],
        "replicate_counts": [1, 3, 5],
        "trials_per_truth_noise_replication": 10000,
    }
    if any(config.get(key) != value for key, value in expected.items()):
        raise ValueError("Unexpected fixed follow-up configuration")
    if config["rng"]["base_seed"] != 2101 or [h["id"] for h in config["hypotheses"]] != list(TRUTHS):
        raise ValueError("Unexpected fixed follow-up seed or hypotheses")
    return config


def response(hypothesis: str, x: float) -> float:
    q = 6 + 4 * x - x * x
    if hypothesis == "q":
        return q
    if hypothesis == "f":
        return q - x * (x - 1) * (x - 3) * (x - 4)
    if hypothesis == "g":
        return q - x * (x - 1) * (x - 2) * (x - 3) * (x - 4)
    raise ValueError("Unknown specified response")


def prediction(x: float) -> dict[str, float]:
    q, f = response("q", x), response("f", x)
    return {"concentration": x, "q_mean": q, "f_mean": f, "absolute_gap": abs(q - f)}


def select_design(grid: list[float]) -> dict[str, Any]:
    """Uses specified functions alone, with no observation or RNG argument."""
    if not grid or any(not math.isfinite(x) for x in grid) or len(set(grid)) != len(grid):
        raise ValueError("Design grid requires distinct finite concentrations")
    candidates = [prediction(x) for x in grid]
    maximum = max(item["absolute_gap"] for item in candidates)
    maximizers = sorted(item["concentration"] for item in candidates if item["absolute_gap"] == maximum)
    return {"candidate_predictions": candidates, "selected_concentration": maximizers[0],
            "selected_gap": maximum, "maximizers": maximizers, "selection_before_sampling": True}


def analytic_error(gap: float, sigma: float, replicates: int) -> float:
    if not math.isfinite(gap) or gap < 0 or not math.isfinite(sigma) or sigma <= 0:
        raise ValueError("Finite gap and positive noise standard deviation required")
    if type(replicates) is not int or replicates < 1:
        raise ValueError("Positive integer replication required")
    return .5 * math.erfc(gap * math.sqrt(replicates) / (2 * sigma * math.sqrt(2)))


def classify(means: np.ndarray, q_mean: float, f_mean: float) -> tuple[np.ndarray, np.ndarray]:
    """Return assignments (0=q, 1=f) and exact ties; never accept a truth label."""
    values = np.asarray(means, dtype=float)
    if values.ndim != 1 or not np.isfinite(values).all() or not all(map(math.isfinite, (q_mean, f_mean))):
        raise ValueError("Classifier requires finite one-dimensional means and predictions")
    q_distance, f_distance = np.abs(values - q_mean), np.abs(values - f_mean)
    ties = q_distance == f_distance
    assignments = np.where(ties, np.arange(len(values)) % 2, (f_distance < q_distance).astype(int))
    return assignments, ties


def seed_entropy(truth_index: int, noise_index: int, replication_index: int) -> list[int]:
    return [2101, truth_index, noise_index, replication_index]


def noise_replicates(entropy: list[int], trials: int, replicates: int) -> np.ndarray:
    return np.random.Generator(np.random.PCG64(np.random.SeedSequence(entropy))).standard_normal((trials, replicates))


def source_hash() -> str:
    digest = hashlib.sha256()
    for relative in sorted(SOURCES):
        source = ROOT / relative
        if source.is_symlink() or not source.is_file():
            raise ValueError("Follow-up sources must be regular files")
        for value in (relative.encode("utf-8"), source.read_bytes()):
            digest.update(len(value).to_bytes(8, "big"))
            digest.update(value)
    return "sha256:" + digest.hexdigest()


def identity() -> dict[str, Any]:
    runtime = {
        "python": {"implementation": platform.python_implementation(), "version": platform.python_version(),
                   "build": list(platform.python_build()), "compiler": platform.python_compiler()},
        "numpy_version": np.__version__,
        "platform": {"system": platform.system(), "release": platform.release(),
                     "machine": platform.machine(), "libc": list(platform.libc_ver())},
        "byteorder": sys.byteorder,
    }
    encoded = json.dumps(runtime, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return {"study_code_hash": source_hash(),
            "configuration_file_hash": "sha256:" + hashlib.sha256(CONFIG.read_bytes()).hexdigest(),
            "runtime_fingerprint": "sha256:" + hashlib.sha256(encoded).hexdigest(),
            "runtime": runtime,
            "runtime_scope": "Numerical Python process only; Node validates and formats output without drawing samples."}


def run_study() -> dict[str, Any]:
    config = load_config()
    # Freeze the design before allocating any random generator or observations.
    design = select_design(config["candidate_grid"])
    if design["selected_concentration"] != config["designs"][2]["concentration"]:
        raise ValueError("Declared selected concentration does not match the fixed criterion")
    design["choices"] = [{"id": item["id"], **prediction(item["concentration"])} for item in config["designs"]]
    trials = config["trials_per_truth_noise_replication"]
    conditional = {}
    for truth_index, truth in enumerate(TRUTHS):
        for noise_index, sigma in enumerate(config["noise_standard_deviations"]):
            for replication_index, n in enumerate(config["replicate_counts"]):
                entropy = seed_entropy(truth_index, noise_index, replication_index)
                errors = noise_replicates(entropy, trials, n).mean(axis=1) * sigma
                for choice in design["choices"]:
                    means = response(truth, choice["concentration"]) + errors
                    assignments, ties = classify(means, choice["q_mean"], choice["f_mean"])
                    count = int(np.count_nonzero(assignments != truth_index))
                    analytic = analytic_error(choice["absolute_gap"], sigma, n)
                    conditional[(choice["id"], sigma, n, truth)] = {
                        "seed_entropy": entropy, "trials": trials,
                        "error_count": count, "error_rate": count / trials,
                        "tie_count": int(np.count_nonzero(ties)),
                        "assigned_q": int(np.count_nonzero(assignments == 0)),
                        "assigned_f": int(np.count_nonzero(assignments == 1)),
                        "signed_discrepancy": count / trials - analytic,
                    }
    results = []
    for choice in design["choices"]:
        for sigma in config["noise_standard_deviations"]:
            for n in config["replicate_counts"]:
                q = conditional[(choice["id"], sigma, n, "q")]
                f = conditional[(choice["id"], sigma, n, "f")]
                analytic = analytic_error(choice["absolute_gap"], sigma, n)
                equal_prior = (q["error_rate"] + f["error_rate"]) / 2
                results.append({"design_id": choice["id"], "concentration": choice["concentration"],
                                "noise_sd": sigma, "replicates": n, "analytic_conditional_error": analytic,
                                "q": q, "f": f, "equal_prior_error_rate": equal_prior,
                                "equal_prior_signed_discrepancy": equal_prior - analytic})
    return {
        "schema": "echoclass.followup-design.v1", "configuration": config, "identity": identity(),
        "design": design,
        "simulation": {"conditional_cell_count": 54, "trials_per_cell": trials,
                       "paired_noise_batch_count": 18, "independent_trial_mean_draw_count": 180000,
                       "independent_record_draw_count": 540000, "design_trial_evaluations": 540000},
        "results": results,
        "remaining_alias": {
            "formula": config["remaining_alias_formula"], "agreement_concentrations": [0, 1, 2, 3, 4],
            "grid_predictions": [{"concentration": x, "q_mean": response("q", x), "g_mean": response("g", x),
                                  "absolute_gap": abs(response("q", x) - response("g", x))} for x in config["candidate_grid"]],
        },
    }


if __name__ == "__main__":
    try:
        if len(sys.argv) != 1:
            raise ValueError("The fixed follow-up module accepts no tuning arguments")
        print(json.dumps(run_study(), allow_nan=False, separators=(",", ":")))
    except Exception:
        print("Fixed follow-up study failed; no partial result was accepted.", file=sys.stderr)
        raise SystemExit(1) from None
