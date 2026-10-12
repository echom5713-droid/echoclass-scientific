"""Hand-calculable synthetic observations, not evidence of classroom outcomes."""
import copy
from fractions import Fraction
import json
import math
from pathlib import Path
import subprocess

import numpy as np
import pytest
from scipy import stats
from pydantic import ValidationError

from echoclass_analytics.analysis import _fit, _group, _regression, analyze
from echoclass_analytics.models import ProtocolError, RecordSnapshot, parse_envelope, strict_json_loads, strict_timestamp

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests/fixtures/scientific/synthetic-envelope.json"


def fixture():
    return json.loads(FIXTURE.read_text())


def selected(groups, status="included"):
    source = fixture()
    template = json.loads(source["canonical_inputs"][0]["canonical_json"])
    inputs = []
    for concentration, values in groups.items():
        for value in values:
            item = copy.deepcopy(template)
            ordinal = len(inputs)
            record, review = item["record_snapshot"], item["review_snapshot"]
            record.update(id=f"synthetic-{ordinal:03}", nh4cl_concentration=concentration,
                          oil_mass=value, yield_percent=value, effective_review_id=f"synthetic-review-{ordinal}", review_status=status)
            review.update(id=record["effective_review_id"], record_id=record["id"], status=status)
            inputs.append(item)
    execution = json.loads(source["execution_canonical_json"])
    result = subprocess.run(["node", "tests/fixtures/scientific/reseal.mjs"], cwd=ROOT,
                            input=json.dumps({"inputs": inputs, "execution": execution}), text=True,
                            capture_output=True, check=True)
    return json.loads(result.stdout)


def test_full_canonical_fixture_is_deterministic_and_explicitly_exploratory():
    a = analyze(fixture())
    assert a == analyze(fixture())
    assert a["selection"]["included_count"] == 20
    assert a["best_tested"]["concentrations"] == [1, 3]
    assert a["candidate"]["concentration"] == pytest.approx(2)
    assert a["candidate"]["predicted_yield"] == pytest.approx(10)
    assert "record_independence_unverified" in a["limitations"]
    assert a["regression"]["residual_df"] == 1
    assert a["regression"]["loocv"]["rmse"]["value"] == pytest.approx(0, abs=1e-12)


def test_group_statistics_and_iqr_have_hand_calculable_values():
    g = _group(0, list("abcde"), np.array([1., 2., 3., 4., 8.]), np.random.default_rng(12), lambda: None)
    expected = {"mean": 3.6, "median": 3, "min": 1, "max": 8, "sd": math.sqrt(7.3),
                "q1": 2, "q3": 4, "iqr": 2, "mad": 1, "mad_normal": 1 / 0.6744897501960817}
    for key, value in expected.items():
        assert g["statistics"][key]["value"] == pytest.approx(value)
    assert g["iqr_flags"] == {"record_ids": ["e"], "reason": None}
    assert g["n"] == 5  # A flag never silently excludes an observation.


def test_batched_percentile_bootstrap_matches_scipy_reference():
    values = np.array([1., 2., 3., 4., 8.])
    g = _group(0, list("abcde"), values, np.random.Generator(np.random.PCG64(98)), lambda: None)
    reference = stats.bootstrap((values,), np.mean, n_resamples=10000, batch=256,
                                confidence_level=.95, method="percentile", rng=np.random.Generator(np.random.PCG64(98)))
    assert g["ci"]["lower"] == pytest.approx(reference.confidence_interval.low)
    assert g["ci"]["upper"] == pytest.approx(reference.confidence_interval.high)


@pytest.mark.parametrize("values,sd_reason,ci_reason", [([], "no_approved_records", "no_approved_records"),
    ([2.], "insufficient_replicates", "insufficient_replicates"), ([2.,2.,2.,2.], None, "degenerate_empirical_distribution")])
def test_small_and_degenerate_groups_do_not_invent_uncertainty(values, sd_reason, ci_reason):
    g = _group(0, [str(i) for i in range(len(values))], np.array(values), np.random.default_rng(1), lambda: None)
    assert g["statistics"]["sd"]["reason"] == sd_reason
    assert g["ci"]["reason"] == ci_reason
    assert g["ci"]["lower"] is None and g["ci"]["upper"] is None
    if len(values) == 4:
        assert g["statistics"]["mad"]["value"] == 0
        assert g["iqr_flags"]["reason"] == "zero_iqr"


def test_exact_decimal_tie_is_not_broken_by_float_summation():
    result = analyze(selected({0: [.1, .2], 1: [.15, .15]}))
    assert result["best_tested"]["concentrations"] == [0, 1]
    assert result["best_tested"]["mean"] == .15


def test_exact_equal_group_means_are_constant_for_regression_too():
    result = analyze(selected({0: [.1, .2], 1: [.15, .15], 3: [.15, .15], 4: [.15, .15]}))
    assert result["best_tested"]["concentrations"] == [0, 1, 3, 4]
    assert [group["statistics"]["mean"]["value"] for group in result["groups"]] == [.15] * 4
    assert result["regression"]["training_r_squared"] == {"value": None, "reason": "constant_response"}
    assert result["regression"]["training_rmse"]["value"] == 0
    assert result["regression"]["loocv"]["rmse"]["value"] == 0
    assert result["candidate"]["reason"] == "not_concave"


@pytest.mark.parametrize("scale", [1e-300, 1., 1e300])
def test_iqr_fence_equality_is_not_an_outlier_but_next_decimal_is(scale):
    # Q1=5s, Q3=7s; the strict upper fence is exactly 10s.
    values = np.array([3., 5., 6., 7., 10.]) * scale
    at_fence = _group(0, list("abcde"), values, np.random.default_rng(1), lambda: None)
    assert at_fence["iqr_flags"] == {"record_ids": [], "reason": None}
    values[-1] = np.nextafter(values[-1], np.inf)
    above_fence = _group(0, list("abcde"), values, np.random.default_rng(1), lambda: None)
    assert above_fence["iqr_flags"] == {"record_ids": ["e"], "reason": None}


def test_iqr_lower_fence_and_fractional_quartiles_remain_strict():
    values = np.array([1., 4., 5., 6., 8.])
    result = _group(0, list("abcde"), values, np.random.default_rng(1), lambda: None)
    assert result["iqr_flags"]["record_ids"] == []  # lower fence = 4 - 1.5 * 2 = 1
    values[0] = np.nextafter(1., 0.)
    result = _group(0, list("abcde"), values, np.random.default_rng(1), lambda: None)
    assert result["iqr_flags"]["record_ids"] == ["a"]
    # Linear Q3 uses a quarter of the last gap, even below one ULP at baseline.
    result = _group(0, list("abcd"), np.array([1., 1., 1., np.nextafter(1., np.inf)]), np.random.default_rng(1), lambda: None)
    assert result["statistics"]["iqr"]["value"] == 5e-17
    assert result["iqr_flags"] == {"record_ids": ["d"], "reason": None}


def test_valid_envelope_iqr_boundary_is_not_flagged():
    result = analyze(selected({0: [3, 5, 6, 7, 10]}))
    assert result["groups"][0]["iqr_flags"] == {"record_ids": [], "reason": None}
    assert result["groups"][0]["statistics"]["iqr"]["value"] == 2


def test_exact_quartiles_preserve_order_with_minimum_and_median():
    result = analyze(selected({0: [.01, .01, .01, .29]}))
    statistics = result["groups"][0]["statistics"]
    values = [statistics[name]["value"] for name in ("min", "q1", "median", "q3", "max")]
    assert values == sorted(values)
    assert values[:3] == [.01] * 3


def test_corrected_roundoff_reports_pass_node_result_validation():
    cases = [
        {0: [3, 5, 6, 7, 10]},
        {0: [.1, .2], 1: [.15, .15], 3: [.15, .15], 4: [.15, .15]},
        {0: [.01, .01, .01, .29]},
        {0: [1., 1., 1., np.nextafter(1., np.inf)]},
    ]
    envelopes = [selected(groups) for groups in cases]
    payload = [{"envelope": envelope, "result": analyze(envelope)} for envelope in envelopes]
    validator = """
        import fs from 'node:fs';
        import { validateScientificResult } from './dist/src/domain/scientific/result-validation.js';
        for (const { envelope, result } of JSON.parse(fs.readFileSync(0, 'utf8'))) {
            validateScientificResult(result, envelope);
        }
    """
    subprocess.run(["node", "--input-type=module", "--eval", validator], cwd=ROOT,
                   input=json.dumps(payload), text=True, capture_output=True, check=True)


@pytest.mark.parametrize("baseline", [1e-300, 1., 1e100, 1e300])
def test_one_ulp_response_difference_is_not_a_constant_or_bad_fit(baseline):
    x = np.array([0., 1., 3., 4.])
    y = np.array([baseline, baseline, baseline, np.nextafter(baseline, np.inf)])
    fit, reason = _fit(x, y)
    assert reason is None and fit is not None
    # The sole contrast is [0,0,0,1]. Its projection residual has SSE=1/10,
    # while SST=3/4, independently giving R² = 1 - (1/10)/(3/4) = 13/15.
    assert fit.r_squared["value"] == pytest.approx(13 / 15, abs=1e-14)
    assert fit.r_squared["reason"] is None
    assert fit.coefficients["a"] > 0
    assert fit.rmse["value"] > 0
    # Centering does not replace the original-response concavity threshold.
    assert fit.vertex() == (None, "not_concave")


def test_exact_unequal_group_means_survive_identical_float_displays():
    x = np.array([0., 1., 3., 4.])
    exact = [Fraction(1)] * 3 + [Fraction(1) + Fraction(1, 10**20)]
    fit, reason = _fit(x, np.array([float(value) for value in exact]), exact)
    assert reason is None and fit is not None
    assert fit.r_squared["value"] == pytest.approx(13 / 15, abs=1e-14)
    assert fit.rmse["value"] == pytest.approx(1e-20 / math.sqrt(40), rel=1e-14, abs=0)


def test_response_centering_does_not_promote_tiny_concavity_to_candidate():
    x = np.array([0., 1., 3., 4.])
    exact = [Fraction(1) + Fraction(4 - (int(value) - 2)**2, 10**20) for value in x]
    fit, reason = _fit(x, np.ones(4), exact)
    assert reason is None and fit is not None
    assert fit.r_squared["value"] == pytest.approx(1)
    assert fit.coefficients["a"] == pytest.approx(-1e-20, rel=1e-14, abs=0)
    assert fit.vertex() == (None, "not_concave")


def test_meaningful_unequal_groups_keep_their_signal():
    result = analyze(selected({0: [.15], 1: [.15], 3: [.15], 4: [.16]}))
    assert result["best_tested"]["concentrations"] == [4]
    assert result["regression"]["training_r_squared"]["value"] == pytest.approx(13 / 15, abs=1e-14)
    assert result["regression"]["training_rmse"]["value"] == pytest.approx(.01 / math.sqrt(40))


def test_excluded_and_unapproved_rows_stay_in_manifest_not_primary_statistics():
    for status in ("excluded", "review"):
        result = analyze(selected({0: [1, 2], 4: [3]}, status))
        assert result["selection"]["candidate_count"] == 3
        assert result["selection"]["included_count"] == 0
        assert all(group["n"] == 0 for group in result["groups"])
        assert result["best_tested"]["mean"] is None
        assert result["candidate"]["concentration"] is None


@pytest.mark.parametrize("groups,reason", [({0:[2],1:[2],3:[2],4:[2]}, "not_concave"),
    ({0:[1],1:[2],3:[10],4:[17]}, "not_concave"), ({0:[1],1:[4],3:[4]}, "insufficient_groups")])
def test_flat_convex_and_saturated_data_do_not_create_a_candidate(groups, reason):
    result = analyze(selected(groups))
    assert result["candidate"]["concentration"] is None
    assert result["candidate"]["reason"] == reason
    if len(groups) == 3:
        assert result["regression"]["saturated"] is True
        assert result["regression"]["loocv"]["available"] is False


def test_loocv_predictions_match_independent_lagrange_interpolation_in_original_units():
    x, y = [0.,1.,3.,4.], [1.,3.,4.,2.]
    result = analyze(selected({int(a): [b] for a, b in zip(x, y)}))
    expected = []
    for omitted in range(4):
        keep = [i for i in range(4) if i != omitted]
        predicted = sum(y[i] * math.prod((x[omitted] - x[j]) / (x[i] - x[j]) for j in keep if j != i) for i in keep)
        expected.append(y[omitted] - predicted)
        fold = result["regression"]["loocv"]["folds"][omitted]
        assert fold["predicted_mean"] == pytest.approx(predicted)
        assert fold["extrapolation"] is (omitted in (0, 3))
    assert result["regression"]["loocv"]["rmse"]["value"] == pytest.approx(math.sqrt(sum(r*r for r in expected)/4))


def test_rank_failure_and_finite_overflow_are_explicit():
    fit, reason = _fit(np.array([0.,0.,1.]), np.array([1.,2.,3.]))
    assert fit is None and reason == "insufficient_groups"
    g = _group(0, ["a","b"], np.array([0., np.finfo(float).max]), np.random.default_rng(1), lambda: None)
    json.dumps(g, allow_nan=False)
    assert g["statistics"]["mean"]["value"] == np.finfo(float).max / 2
    fit, reason = _fit(np.array([0.,1.,3.,4.]), np.array([0.,np.finfo(float).max,np.finfo(float).max,0.]))
    assert fit is None and reason == "numeric_unavailable"


def test_cancellation_is_not_converted_into_a_successful_partial_report():
    calls = 0
    def check():
        nonlocal calls
        calls += 1
        if calls == 8:
            raise TimeoutError("synthetic cancellation")
    with pytest.raises(TimeoutError):
        analyze(fixture(), check)


@pytest.mark.parametrize("payload", ['{"x":1,"x":2}', '{"a":{"x":1,"\\u0078":2}}',
    '{"x":NaN}', '{"x":1e999}', '{"x":"\\ud800"}', '\ufeff{}'])
def test_strict_json_rejects_ambiguous_nonfinite_or_invalid_unicode(payload):
    with pytest.raises(ProtocolError): strict_json_loads(payload)


def test_one_changed_input_byte_fails_before_computation():
    data = fixture()
    data["canonical_inputs"][0]["canonical_json"] += " "
    with pytest.raises(ProtocolError, match="validation") as caught: analyze(data)
    assert caught.value.code == "HASH_MISMATCH"


def test_zero_year_timestamp_is_rejected_and_leap_day_checked():
    assert not strict_timestamp("0000-02-29T00:00:00.000Z")
    assert not strict_timestamp("2025-02-29T00:00:00.000Z")
    assert strict_timestamp("2024-02-29T00:00:00.000Z")


@pytest.mark.parametrize("value", ["\ufeff", " \t\r\n\ufeff", "\ufeff\u0085", "\u001c\u001d\ufeff\u001e\u001f", "\u2003\ufeff\u3000"])
def test_required_snapshot_text_rejects_combined_node_python_blank_characters(value):
    record = json.loads(fixture()["canonical_inputs"][0]["canonical_json"])["record_snapshot"]
    with pytest.raises(ValidationError, match="Missing required text"):
        RecordSnapshot.model_validate(record | {"student_name": value})


@pytest.mark.parametrize("field", ["student_name", "class_name", "emulsification_level", "ecoli_observation_group", "created_by"])
def test_required_text_union_predicate_preserves_nonblank_snapshot_value(field):
    record = json.loads(fixture()["canonical_inputs"][0]["canonical_json"])["record_snapshot"]
    with pytest.raises(ValidationError, match="Missing required text"):
        RecordSnapshot.model_validate(record | {field: "\ufeff\u0085"})
    value = "\ufeff actual text \u0085"
    validated = RecordSnapshot.model_validate(record | {field: value})
    assert getattr(validated, field) == value
