"""Test the study's methodological claims, not a preferred model ranking."""
import copy
import json
import math
import os
from pathlib import Path
import subprocess
import sys

import pytest

from echoclass_analytics.analysis import analyze
from echoclass_analytics.identity import get_identity
from experiments.method_study import (
    aggregate_metric, baseline_folds, bridge, evaluate_trial, fit_baseline,
    generate_observations, load_config, run_study, synthetic_inputs, truth,
    truth_maximum,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def study():
    return run_study()


def test_declared_design_is_small_fixed_and_disjoint():
    config = load_config()
    assert len(config["scenarios"]) == 5
    assert config["seeds"] == list(range(1201, 1213))
    assert config["replicates_per_concentration"] == 5
    assert set(config["concentrations"]).isdisjoint(config["unseen_grid"])
    assert all(0 < point < 4 for point in config["unseen_grid"])
    assert 2 in config["unseen_grid"]


def test_alias_is_exact_at_observed_points_and_differs_at_candidate():
    for value in (0, 1, 3, 4):
        assert truth("quadratic_quiet", value) == truth("aliased_quartic", value)
    assert truth("quadratic_quiet", 2) == 10
    assert truth("aliased_quartic", 2) == 6
    for scenario in load_config()["scenarios"]:
        maximum = truth_maximum(scenario["id"])
        for value in maximum["concentrations"] or [0, 2, 4]:
            assert truth(scenario["id"], value) == pytest.approx(maximum["yield"])
    for value in [i / 100 for i in range(401)]:
        q = truth("quadratic_quiet", value)
        assert truth("aliased_quartic", value) == pytest.approx(q - value * (value - 1) * (value - 3) * (value - 4))


def test_observation_generation_pairs_noise_without_reselection():
    config = load_config()
    quadratic, alias = config["scenarios"][2], config["scenarios"][4]
    first = generate_observations(quadratic, 1201, config)
    assert first == generate_observations(quadratic, 1201, config)
    assert first == generate_observations(alias, 1201, config)
    assert first != generate_observations(quadratic, 1202, config)
    assert synthetic_inputs(first, 1201) == synthetic_inputs(generate_observations(alias, 1201, config), 1201)


@pytest.mark.parametrize("model", ["constant", "linear"])
def test_held_out_mean_cannot_leak_into_baseline_prediction(model):
    x, y = [0, 1, 3, 4], [6, 9, 9, 6]
    original = baseline_folds(model, x, y)
    for held_out in range(4):
        changed = list(y)
        changed[held_out] = 500
        altered = baseline_folds(model, x, changed)
        assert altered[held_out]["predicted_mean"] == original[held_out]["predicted_mean"]
        assert altered[held_out]["residual"] != original[held_out]["residual"]
        assert x[held_out] not in altered[held_out]["training_concentrations"]
    assert [fold["extrapolation"] for fold in original] == [True, False, False, True]


def test_constant_and_linear_use_equal_concentration_weight():
    # Mean of the three training means is 7, not the four-mean value 7.5.
    fold = baseline_folds("constant", [0, 1, 3, 4], [6, 9, 9, 6])[1]
    assert fold["predicted_mean"] == 7
    assert fit_baseline("constant", [0, 1, 3, 4], [6, 9, 9, 6]) == {"intercept": 7.5, "slope": 0}
    assert fit_baseline("linear", [0, 1, 3, 4], [6, 6.75, 8.25, 9]) == {"intercept": 6, "slope": .75}


def test_noiseless_quadratic_and_actual_production_fold_isolation():
    config = load_config()
    scenario = {**config["scenarios"][2], "noise_sd": 0}
    observations = generate_observations(scenario, 1201, config)
    changed = copy.deepcopy(observations)
    changed[0]["yields"] = [12] * 5
    envelopes = bridge("seal", {"datasets": [synthetic_inputs(values, 1201) for values in (observations, changed)], "identity": get_identity()})["envelopes"]
    results = [analyze(envelope) for envelope in envelopes]
    # The production quadratic learns from the remaining 1,3,4 means only.
    original = results[0]["regression"]["loocv"]["folds"][0]
    altered = results[1]["regression"]["loocv"]["folds"][0]
    assert original["predicted_mean"] == pytest.approx(6)
    assert altered["predicted_mean"] == original["predicted_mean"]
    trial = evaluate_trial(scenario, 1201, observations, envelopes[0], results[0], config)
    assert trial["models"]["quadratic"]["loco"]["rmse"] == pytest.approx(0, abs=1e-12)
    assert trial["models"]["quadratic"]["unseen_grid"]["rmse"] == pytest.approx(0, abs=1e-12)
    assert trial["quadratic_candidate"]["concentration"] == pytest.approx(2)
    assert trial["quadratic_candidate"]["true_regret"] == pytest.approx(0, abs=1e-12)
    assert len(bridge("verify", [{"envelope": e, "result": r} for e, r in zip(envelopes, results, strict=True)])) == 2


def test_aggregation_does_not_confuse_pooled_rmse_with_mean_rmse():
    trials = [{"models": {"constant": {"unseen_grid": {"rmse": error, "points": [{"residual": error}]}}}} for error in (1, 3)]
    summary = aggregate_metric(trials, "constant", "unseen_grid")
    assert summary["pooled_rmse"] == math.sqrt(5)
    assert summary["mean_trial_rmse"] == 2
    assert summary["point_count"] == 2
    assert summary["trial_rmse_min"] == 1 and summary["trial_rmse_max"] == 3


def test_all_scenarios_seeds_folds_and_grid_points_are_retained(study):
    assert study["trial_count"] == 60
    for scenario in study["scenarios"]:
        assert [trial["seed"] for trial in scenario["trials"]] == study["configuration"]["seeds"]
        for trial in scenario["trials"]:
            assert len(trial["input_hashes"]) == 20
            for model in trial["models"].values():
                assert len(model["loco"]["folds"]) == 4
                assert [point["concentration"] for point in model["unseen_grid"]["points"]] == study["configuration"]["unseen_grid"]
        for model in scenario["summary"]["models"].values():
            assert model["loco"]["point_count"] == 48
            assert model["loco"]["endpoint_extrapolation"]["point_count"] == 24
            assert model["loco"]["interior_interpolation"]["point_count"] == 24
            assert model["unseen_grid"]["point_count"] == 156


def test_same_sealed_data_cannot_resolve_the_alias(study):
    quadratic, alias = study["scenarios"][2], study["scenarios"][4]
    for q, a in zip(quadratic["trials"], alias["trials"], strict=True):
        assert q["observations"] == a["observations"]
        assert q["dataset_hash"] == a["dataset_hash"]
        assert q["scientific_result_hash"] == a["scientific_result_hash"]
        for name in ("constant", "linear", "quadratic"):
            assert q["models"][name]["loco"] == a["models"][name]["loco"]
            assert [point["predicted"] for point in q["models"][name]["unseen_grid"]["points"]] == [point["predicted"] for point in a["models"][name]["unseen_grid"]["points"]]
        assert q["quadratic_candidate"]["concentration"] == a["quadratic_candidate"]["concentration"]
        assert a["quadratic_candidate"]["true_regret"] > 3.9
        assert q["quadratic_candidate"]["true_regret"] < .01


def test_candidate_withholding_is_separate_from_fit_or_prediction_failure(study):
    linear = study["scenarios"][1]
    candidate = linear["summary"]["quadratic_candidate"]
    assert candidate["withheld_trials"] == 12
    assert candidate["mean_true_regret_when_available"] is None
    assert sum(candidate["withheld_reasons"].values()) == candidate["withheld_trials"]
    assert linear["summary"]["models"]["quadratic"]["fit_failed_trials"] == 0
    assert linear["summary"]["models"]["quadratic"]["unseen_grid"]["available_trials"] == 12


def test_study_reproduces_exact_output_within_the_same_environment(study):
    assert run_study() == study
    assert study["identity"]["production_python"] == get_identity()
    json.dumps(study, allow_nan=False)


def test_node_output_gate_rejects_partial_and_inconsistent_studies(study):
    validator = """
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { validateMethodStudy, runMethodStudy } from './scripts/method-study.mjs';
      const original = JSON.parse(fs.readFileSync(0, 'utf8'));
      assert.equal(validateMethodStudy(original), original);
      const mutations = [
        value => { value.scenarios = [null, null, null, null, null]; },
        value => { value.scenarios[0].trials.pop(); },
        value => { value.scenarios[0].trials[0].models.linear.loco.folds.pop(); },
        value => { value.scenarios[0].trials[0].models.constant.unseen_grid.points[0].predicted = Infinity; },
        value => { value.scenarios[0].trials[0].models.quadratic.unseen_grid.points[0].concentration = 0; },
        value => { value.scenarios[0].summary.models.quadratic.loco.failed_trials = 1; },
        value => { value.scenarios[0].summary.quadratic_candidate.withheld_trials = 0; },
        value => { value.configuration.seeds[0] = 3; },
      ];
      for (const mutate of mutations) {
        const value = structuredClone(original);
        mutate(value);
        assert.throws(() => validateMethodStudy(value));
      }
      for (const timeoutMs of [0, 120001, 1.5, NaN]) assert.throws(() => runMethodStudy({timeoutMs}));
    """
    subprocess.run(["node", "--input-type=module", "--eval", validator], cwd=ROOT,
                   input=json.dumps(study), text=True, capture_output=True, check=True)


@pytest.mark.parametrize("runner", [["node", "scripts/method-study.mjs"], [sys.executable, "-m", "experiments.method_study"]])
def test_cli_rejects_unrecognized_tuning_flags(runner):
    result = subprocess.run([*runner, "--seed", "3"], cwd=ROOT, capture_output=True, text=True,
                            env={**os.environ, "PYTHONPATH": str(ROOT / "analytics")})
    assert result.returncode != 0
    assert not result.stdout.strip()
    assert "Usage:" in result.stderr or "unrecognized arguments" in result.stderr
