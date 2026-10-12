"""Deterministic exploratory yield analysis of verified immutable inputs."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
import json
import math
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm

from . import ALGORITHM_VERSION
from .models import AnalysisEnvelope, ProtocolError, VerifiedEnvelope, verify_envelope

CONCENTRATIONS = (0, 1, 3, 4)
LIMITATIONS = [
    "exploratory_analysis",
    "record_independence_unverified",
    "bootstrap_assumes_independent_records",
    "four_concentration_model",
    "candidate_requires_new_experiment",
]
STATISTICS = ("mean", "median", "min", "max", "sd", "q1", "q3", "iqr", "mad", "mad_normal")


def _metric(value: float | None = None, reason: str | None = None) -> dict[str, Any]:
    if value is None:
        return {"value": None, "reason": reason or "numeric_unavailable"}
    if not math.isfinite(float(value)):
        return {"value": None, "reason": "numeric_unavailable"}
    return {"value": 0.0 if value == 0 else float(value), "reason": None}


def _scale(values: np.ndarray) -> float:
    maximum = float(np.max(np.abs(values)))
    return maximum if maximum else 1.0


def _rescale(value: float, scale: float) -> float:
    with np.errstate(over="ignore", invalid="ignore"):
        return float(np.float64(value) * np.float64(scale))


def _decimal_values(values: np.ndarray) -> list[Fraction]:
    """Use the sealed decimal-number interpretation, also used for best-tested ties."""
    return [Fraction(Decimal(str(float(value)))) for value in values]


def _quartile(ordered: list[Fraction], numerator: int) -> Fraction:
    """Exact linear quartile: index (n - 1) * numerator / 4."""
    index, remainder = divmod((len(ordered) - 1) * numerator, 4)
    return ordered[index] if not remainder else ordered[index] + (ordered[index + 1] - ordered[index]) * Fraction(remainder, 4)


def _group(concentration: int, record_ids: list[str], values: np.ndarray, rng: np.random.Generator, check: Callable[[], None]) -> dict[str, Any]:
    check()
    n = len(values)
    result: dict[str, Any] = {
        "concentration": concentration,
        "n": n,
        "record_ids": record_ids,
        "statistics": {name: _metric(reason="no_approved_records") for name in STATISTICS},
        "ci": {"confidence_level": 0.95, "method": "percentile", "resamples": 10000, "lower": None, "upper": None, "reason": "no_approved_records"},
        "iqr_flags": {"record_ids": [], "reason": "no_approved_records"},
    }
    if not n:
        check()
        return result
    scale = _scale(values)
    normalized = values / scale
    normalized_stats = {
        "mad": float(stats.median_abs_deviation(normalized, scale=1.0)),
        "mad_normal": float(stats.median_abs_deviation(normalized, scale="normal")),
    }
    for name, value in normalized_stats.items():
        result["statistics"][name] = _metric(_rescale(value, scale))
    # Exact decimal summaries prevent a rescale round trip from changing a tie
    # or placing a boundary observation outside its strict Tukey fence.
    exact_values = _decimal_values(values)
    ordered = sorted(exact_values)
    exact_q1, exact_q3 = _quartile(ordered, 1), _quartile(ordered, 3)
    exact_iqr = exact_q3 - exact_q1
    exact_summaries = {
        "mean": sum(exact_values, Fraction()) / n,
        "min": ordered[0], "max": ordered[-1], "median": _quartile(ordered, 2),
        "q1": exact_q1, "q3": exact_q3, "iqr": exact_iqr,
    }
    for name, value in exact_summaries.items():
        result["statistics"][name] = _metric(float(value))
    if exact_iqr and result["statistics"]["iqr"]["value"] == 0:
        result["statistics"]["iqr"] = _metric(reason="numeric_unavailable")
    result["statistics"]["sd"] = _metric(_rescale(float(np.std(normalized, ddof=1)), scale)) if n >= 2 else _metric(reason="insufficient_replicates")
    if n < 4:
        result["iqr_flags"]["reason"] = "insufficient_replicates"
    elif exact_iqr == 0:
        result["iqr_flags"]["reason"] = "zero_iqr"
    elif result["statistics"]["iqr"]["value"] is None:
        result["iqr_flags"]["reason"] = "numeric_unavailable"
    else:
        lower, upper = exact_q1 - Fraction(3, 2) * exact_iqr, exact_q3 + Fraction(3, 2) * exact_iqr
        result["iqr_flags"] = {"record_ids": [record_ids[index] for index, value in enumerate(exact_values) if value < lower or value > upper], "reason": None}
    if n < 2:
        result["ci"]["reason"] = "insufficient_replicates"
    elif np.all(normalized == normalized[0]):
        result["ci"]["reason"] = "degenerate_empirical_distribution"
    else:
        draws: list[np.ndarray] = []
        for start in range(0, 10000, 256):
            check()
            count = min(256, 10000 - start)
            indices = rng.integers(0, n, size=(count, n), dtype=np.int64, endpoint=False)
            draws.append(np.mean(normalized[indices], axis=1))
            check()
        low, high = np.quantile(np.concatenate(draws), [0.025, 0.975], method="linear")
        lower, upper = _rescale(float(low), scale), _rescale(float(high), scale)
        if math.isfinite(lower) and math.isfinite(upper):
            result["ci"].update(lower=lower, upper=upper, reason=None)
        else:
            result["ci"]["reason"] = "numeric_unavailable"
    check()
    return result


@dataclass(frozen=True)
class _Fit:
    coefficients: dict[str, float]
    beta: np.ndarray
    center: float
    x_scale: float
    y_scale: float
    response_offset: float
    response_scale: float
    response_beta: np.ndarray
    rank: int
    condition: float
    predictions: np.ndarray
    r_squared: dict[str, Any]
    rmse: dict[str, Any]

    def predict(self, x: float) -> float:
        z = (x - self.center) / self.x_scale
        return self.response_offset + _rescale(float(self.response_beta[0] * z * z + self.response_beta[1] * z + self.response_beta[2]), self.response_scale)

    def vertex(self) -> tuple[float | None, str | None]:
        margin = 64 * np.finfo(np.float64).eps * self.condition * max(1.0, float(np.max(np.abs(self.beta))))
        if float(self.beta[0]) >= -margin:
            return None, "not_concave"
        value = self.center + (-float(self.beta[1]) / (2 * float(self.beta[0]))) * self.x_scale
        if not math.isfinite(value):
            return None, "numeric_unavailable"
        if not 0 < value < 4:
            return None, "vertex_outside_range"
        return value, None


def _fit(x: np.ndarray, y: np.ndarray, exact_y: list[Fraction] | None = None) -> tuple[_Fit | None, str | None]:
    if len(x) < 3 or len(np.unique(x)) < 3:
        return None, "insufficient_groups"
    center = float(np.mean(x))
    x_scale = float(np.max(np.abs(x - center)))
    y_scale = _scale(y)
    exact_y = _decimal_values(y) if exact_y is None else exact_y
    exact_offset = sum(exact_y, Fraction()) / len(exact_y)
    deviations = [value - exact_offset for value in exact_y]
    exact_response_scale = max(abs(value) for value in deviations)
    response_offset = float(exact_offset)
    response_scale = float(exact_response_scale)
    if exact_response_scale and response_scale == 0:
        return None, "numeric_unavailable"
    # An affine change of response preserves intercept OLS. Center before
    # conversion to float so a large common baseline cannot erase real signal.
    normalized_y = np.asarray([float(value / exact_response_scale) for value in deviations], dtype=np.float64) if exact_response_scale else np.zeros(len(y))
    z = (x - center) / x_scale
    design = np.column_stack([z * z, z, np.ones(len(z))])
    try:
        singular_values = np.linalg.svd(design, compute_uv=False)
        eps = np.finfo(np.float64).eps
        rank = int(np.count_nonzero(singular_values > max(design.shape) * eps * singular_values[0]))
        if rank != 3:
            return None, "rank_deficient"
        condition = float(singular_values[0] / singular_values[-1])
        if condition * eps > math.sqrt(eps):
            return None, "ill_conditioned"
        # Explicit intercept column; each observed concentration mean has equal weight.
        fitted = sm.OLS(normalized_y, design, hasconst=True).fit(method="pinv")
        response_beta = np.asarray(fitted.params, dtype=np.float64)
        predictions = np.asarray(design @ response_beta, dtype=np.float64)
        error = normalized_y - predictions
        sse = float(np.dot(error, error))
        centered = normalized_y - float(np.mean(normalized_y))
        sst = float(np.dot(centered, centered))
        r_squared = _metric(reason="constant_response") if not exact_response_scale else _metric(1 - sse / sst)
        rmse = _metric(_rescale(math.sqrt(float(np.mean(error * error))), response_scale))
        # Retain the original-response-scale concavity margin: response
        # centering must not promote negligible curvature into a candidate.
        beta = response_beta * float(exact_response_scale / Fraction.from_float(y_scale))
        beta[2] += float(exact_offset / Fraction.from_float(y_scale))
        # Transform only after fitting; suppress unrepresentable coefficients.
        with np.errstate(over="ignore", invalid="ignore"):
            a = float(response_beta[0] / x_scale**2 * response_scale)
            b = float((response_beta[1] / x_scale - 2 * center * response_beta[0] / x_scale**2) * response_scale)
            c = response_offset + float((response_beta[2] - response_beta[1] * center / x_scale + response_beta[0] * center**2 / x_scale**2) * response_scale)
        if not all(math.isfinite(value) for value in (a, b, c, condition)) or not np.all(np.isfinite(beta)):
            return None, "numeric_unavailable"
        return _Fit({"a": a, "b": b, "c": c}, beta, center, x_scale, y_scale, response_offset, response_scale, response_beta, rank, condition, predictions, r_squared, rmse), None
    except (np.linalg.LinAlgError, ValueError, FloatingPointError, OverflowError):
        return None, "numeric_unavailable"


def _regression(groups: list[dict[str, Any]], check: Callable[[], None], exact_means: dict[int, Fraction] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    populated = [group for group in groups if group["statistics"]["mean"]["value"] is not None]
    x = np.asarray([group["concentration"] for group in populated], dtype=np.float64)
    y = np.asarray([group["statistics"]["mean"]["value"] for group in populated], dtype=np.float64)
    exact_y = [exact_means[group["concentration"]] for group in populated] if exact_means is not None else _decimal_values(y)
    fitted, reason = _fit(x, y, exact_y)
    result: dict[str, Any] = {
        "available": False, "reason": reason, "n_groups": len(x), "residual_df": None,
        "coefficients": None, "rank": None, "condition_number": None, "saturated": False,
        "training_r_squared": _metric(reason=reason), "training_rmse": _metric(reason=reason),
        "loocv": {"available": False, "reason": "insufficient_groups", "rmse": _metric(reason="insufficient_groups"), "folds": []},
    }
    candidate: dict[str, Any] = {"concentration": None, "predicted_yield": None, "leave_one_out_vertex_range": None, "reason": reason or "insufficient_groups"}
    if fitted is None:
        return result, candidate
    result.update(available=True, reason=None, residual_df=len(x) - 3, coefficients=fitted.coefficients, rank=fitted.rank, condition_number=fitted.condition, saturated=len(x) == 3, training_r_squared=fitted.r_squared, training_rmse=fitted.rmse)
    if len(x) != 4:
        return result, candidate
    folds: list[dict[str, Any]] = []
    for index, concentration in enumerate(x):
        check()
        mask = np.arange(len(x)) != index
        fold, _ = _fit(x[mask], y[mask], [value for keep, value in zip(mask, exact_y, strict=True) if keep])
        if fold is None:
            result["loocv"].update(reason="fold_failure", rmse=_metric(reason="fold_failure"))
            candidate["reason"] = "fold_unstable"
            return result, candidate
        predicted = fold.predict(float(concentration))
        residual = float(y[index]) - predicted
        if not math.isfinite(predicted) or not math.isfinite(residual):
            result["loocv"].update(reason="fold_failure", rmse=_metric(reason="fold_failure"))
            candidate["reason"] = "fold_unstable"
            return result, candidate
        vertex, vertex_reason = fold.vertex()
        folds.append({"held_out_concentration": float(concentration), "observed_mean": float(y[index]), "predicted_mean": predicted, "residual": residual, "extrapolation": bool(concentration < np.min(x[mask]) or concentration > np.max(x[mask])), "vertex": vertex, "vertex_reason": vertex_reason})
        check()
    residuals = np.asarray([fold["residual"] for fold in folds], dtype=np.float64)
    residual_scale = _scale(residuals)
    rmse = _metric(_rescale(math.sqrt(float(np.mean((residuals / residual_scale) ** 2))), residual_scale))
    if rmse["value"] is None:
        result["loocv"].update(reason="fold_failure", rmse=_metric(reason="fold_failure"))
        candidate["reason"] = "fold_unstable"
        return result, candidate
    result["loocv"] = {"available": True, "reason": None, "rmse": rmse, "folds": folds}
    vertex, vertex_reason = fitted.vertex()
    if vertex is None:
        candidate["reason"] = vertex_reason
    elif any(fold["vertex"] is None for fold in folds):
        candidate["reason"] = "fold_unstable"
    else:
        predicted = fitted.predict(vertex)
        if not math.isfinite(predicted):
            candidate["reason"] = "numeric_unavailable"
        else:
            vertices = [fold["vertex"] for fold in folds]
            candidate.update(concentration=vertex, predicted_yield=predicted, leave_one_out_vertex_range=[min(vertices), max(vertices)], reason=None)
    return result, candidate


def _output(value: Any) -> Any:
    """Normalize only new results, never input snapshots or their byte hashes."""
    if isinstance(value, dict):
        return {key: _output(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_output(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ProtocolError("INVALID_OUTPUT")
        return 0.0 if value == 0 else value
    return value


def analyze(envelope: AnalysisEnvelope | dict[str, Any], check_budget: Callable[[], None] | None = None) -> dict[str, Any]:
    check = check_budget if check_budget is not None else lambda: None
    check()
    verified: VerifiedEnvelope = verify_envelope(envelope)
    selection: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for ordinal, item in enumerate(verified.inputs):
        record, review = item.record_snapshot, item.review_snapshot
        included = item.review_binding_mode == "effective" and review is not None and review.status == "included"
        reason = None if included else "review_excluded" if review is not None and review.status == "excluded" else "not_approved"
        selection.append({"ordinal": ordinal, "record_id": record.id, "review_binding_mode": item.review_binding_mode, "review_status": record.review_status, "included": included, "reason": reason})
        if included:
            rows.append({"record_id": record.id, "concentration": record.nh4cl_concentration, "yield_percent": record.yield_percent})
    frame = pd.DataFrame(rows, columns=["record_id", "concentration", "yield_percent"]).astype({"record_id": "string", "concentration": "float64", "yield_percent": "float64"})
    streams = np.random.SeedSequence(int(verified.execution.configuration.seed_hex, 16)).spawn(4)
    groups: list[dict[str, Any]] = []
    exact_means: dict[int, Fraction] = {}
    for concentration, stream in zip(CONCENTRATIONS, streams, strict=True):
        group = frame.loc[frame["concentration"] == concentration]
        values = group["yield_percent"].to_numpy(dtype=np.float64)
        ids = group["record_id"].tolist()
        groups.append(_group(concentration, ids, values, np.random.Generator(np.random.PCG64(stream)), check))
        if len(values):
            exact_means[concentration] = sum(_decimal_values(values), Fraction()) / len(values)
    regression, candidate = _regression(groups, check, exact_means)
    best_tested: dict[str, Any] = {"concentrations": [], "mean": None, "reason": "no_approved_records"}
    if exact_means:
        best = max(exact_means.values())
        best_tested = {"concentrations": [concentration for concentration, mean in exact_means.items() if mean == best], "mean": float(best), "reason": None}
    result = _output({
        "schema": "echoclass.scientific-result.v1",
        "dataset_hash": verified.envelope.dataset_hash,
        "execution_fingerprint": verified.envelope.execution_fingerprint,
        "algorithm_version": ALGORITHM_VERSION,
        "configuration": verified.execution.configuration.model_dump(),
        "selection": {"candidate_count": len(selection), "included_count": len(rows), "excluded_count": len(selection) - len(rows), "records": selection},
        "groups": groups, "regression": regression, "best_tested": best_tested,
        "candidate": candidate, "limitations": list(LIMITATIONS),
    })
    json.dumps(result, allow_nan=False)
    check()
    return result
