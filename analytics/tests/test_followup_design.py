"""Check the declared discrimination experiment and its process boundary."""
import copy
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest

from experiments import followup_design as study_module
from experiments.followup_design import (
    analytic_error, classify, load_config, noise_replicates, response, run_study,
    seed_entropy, select_design,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def study():
    return run_study()


def test_fixed_design_identifies_gap_before_any_random_sampling(monkeypatch):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Design selection must not draw data")
    monkeypatch.setattr(np.random, "Generator", forbidden)
    design = select_design(load_config()["candidate_grid"])
    assert design["selected_concentration"] == 2
    assert design["selected_gap"] == 4
    assert design["maximizers"] == [2]
    assert len(design["candidate_predictions"]) == 17
    assert select_design([4, 3, 1, 0])["selected_concentration"] == 0


def test_polynomial_alias_and_fifth_point_limit():
    for x in (0, 1, 3, 4):
        assert response("q", x) == response("f", x)
    assert response("q", 2) == 10 and response("f", 2) == 6
    assert response("q", .5) == 7.75 and response("f", .5) == 9.9375
    for x in (0, 1, 2, 3, 4):
        assert response("q", x) == response("g", x)
    assert response("q", .5) != response("g", .5)
    # Independent expanded polynomial forms agree on the entire fixed grid.
    for x in load_config()["candidate_grid"]:
        t = x - 2
        assert response("q", x) == 10 - t * t
        assert response("f", x) == 6 + 4 * t * t - t**4


def test_analytical_error_has_correct_normal_tail_and_replication_scaling():
    assert analytic_error(0, 1, 5) == .5
    assert analytic_error(2, 1, 1) == pytest.approx(.15865525393145707, abs=1e-15)
    assert analytic_error(2, 1, 4) == pytest.approx(.02275013194817921, abs=1e-15)
    assert analytic_error(4, 1, 5) == pytest.approx(3.872108215522044e-6, rel=1e-12)
    assert analytic_error(2, 2, 4) == analytic_error(2, 1, 1)
    assert analytic_error(4, 4, 5) > analytic_error(4, 1, 5)


@pytest.mark.parametrize("args", [(-1, 1, 1), (1, 0, 1), (1, math.inf, 1), (math.nan, 1, 1), (1, 1, 0), (1, 1, True), (1, 1, 1.5)])
def test_analytic_error_rejects_invalid_experiments(args):
    with pytest.raises(ValueError):
        analytic_error(*args)


def test_classifier_checks_both_orientations_and_balances_ties_without_truth():
    assignments, ties = classify(np.array([5, 8, 11, 8]), 10, 6)
    assert assignments.tolist() == [1, 1, 0, 1]
    assert ties.tolist() == [False, True, False, True]
    assignments, _ = classify(np.array([7, 11, 8, 10]), 7.75, 9.9375)
    assert assignments.tolist() == [0, 1, 0, 1]
    assignments, ties = classify(np.array([-100, 9, 100, 9]), 9, 9)
    assert assignments.tolist() == [0, 1, 0, 1]
    assert ties.all()
    with pytest.raises(ValueError):
        classify(np.array([math.nan]), 9, 9)


def test_fixed_seeds_replay_and_cells_are_separate():
    all_entropies = [seed_entropy(t, s, n) for t in range(2) for s in range(3) for n in range(3)]
    assert len({tuple(entropy) for entropy in all_entropies}) == 18
    first = noise_replicates(all_entropies[0], 100, 3)
    assert np.array_equal(first, noise_replicates(all_entropies[0], 100, 3))
    assert not np.array_equal(first, noise_replicates(all_entropies[1], 100, 3))


def test_study_selects_first_reads_only_own_sources_and_pairs_designs(monkeypatch):
    real_select, real_draws = study_module.select_design, study_module.noise_replicates
    real_read_bytes, real_read_text = Path.read_bytes, Path.read_text
    allowed = {ROOT / relative for relative in study_module.SOURCES}
    events, entropies, reads = [], [], []

    def select(grid):
        events.append("select")
        return real_select(grid)

    def draw(entropy, trials, replicates):
        assert events[0] == "select"
        events.append("draw")
        entropies.append(tuple(entropy))
        return real_draws(entropy, trials, replicates)

    def read_bytes(path):
        assert path in allowed, f"Unexpected study input: {path}"
        reads.append(path)
        return real_read_bytes(path)

    def read_text(path, *args, **kwargs):
        assert path in allowed, f"Unexpected study input: {path}"
        reads.append(path)
        return real_read_text(path, *args, **kwargs)

    monkeypatch.setattr(study_module, "select_design", select)
    monkeypatch.setattr(study_module, "noise_replicates", draw)
    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    monkeypatch.setattr(Path, "read_text", read_text)
    report = run_study()
    assert len(entropies) == len(set(entropies)) == 18
    assert set(reads) == allowed
    assert len(report["results"]) == 27


def test_every_error_count_and_pairing_identity_is_retained(study):
    assert len(study["results"]) == 27
    for row in study["results"]:
        for truth in ("q", "f"):
            cell = row[truth]
            assert cell["trials"] == 10000
            assert cell["assigned_q"] + cell["assigned_f"] == cell["trials"]
            assert cell["error_count"] == cell["assigned_f" if truth == "q" else "assigned_q"]
            assert cell["error_rate"] == cell["error_count"] / cell["trials"]
            assert cell["signed_discrepancy"] == cell["error_rate"] - row["analytic_conditional_error"]
        assert row["equal_prior_error_rate"] == (row["q"]["error_rate"] + row["f"]["error_rate"]) / 2
        if row["design_id"] == "repeat_original":
            assert row["analytic_conditional_error"] == .5
            for truth in ("q", "f"):
                assert row[truth]["tie_count"] == 10000
                assert row[truth]["error_count"] == 5000
    for i in range(9):
        for truth in ("q", "f"):
            assert study["results"][i][truth]["seed_entropy"] == study["results"][i + 9][truth]["seed_entropy"] == study["results"][i + 18][truth]["seed_entropy"]


def test_source_and_runtime_identity_and_same_host_replay(study):
    assert run_study() == study
    runtime = json.dumps(study["identity"]["runtime"], sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    assert study["identity"]["runtime_fingerprint"] == "sha256:" + hashlib.sha256(runtime.encode()).hexdigest()
    assert study["identity"]["runtime"]["numpy_version"] == np.__version__


def _validate_with_node(payload):
    return subprocess.run(["node", "--input-type=module", "-e", """
import { readFileSync } from 'node:fs';
import { parseStrictJson } from './dist/src/domain/scientific/canonical.js';
import { validateFollowupDesign } from './scripts/followup-design.mjs';
try { validateFollowupDesign(parseStrictJson(readFileSync(0, 'utf8'))); process.stdout.write('accepted'); }
catch { process.stdout.write('rejected'); }
"""], input=payload, cwd=ROOT, text=True, capture_output=True, timeout=30, check=True).stdout


def test_node_boundary_accepts_complete_result_and_rejects_nested_corruption(study):
    assert _validate_with_node(json.dumps(study)) == "accepted"
    cases = []

    def altered(change):
        item = copy.deepcopy(study)
        change(item)
        cases.append(item)

    altered(lambda s: s["results"].__setitem__(0, None))
    altered(lambda s: s["results"].pop())
    altered(lambda s: s["results"][0]["q"].__setitem__("error_count", -1))
    altered(lambda s: s["results"][0]["q"].__setitem__("assigned_q", 4999))
    altered(lambda s: s["results"][0]["q"].__setitem__("tie_count", 0))
    altered(lambda s: s["results"][0]["q"].__setitem__("seed_entropy", [2101, 1, 0, 0]))
    altered(lambda s: s["results"][9].__setitem__("analytic_conditional_error", .49))
    altered(lambda s: s["results"][9].__setitem__("equal_prior_error_rate", .9))
    altered(lambda s: s["design"].__setitem__("selection_before_sampling", False))
    altered(lambda s: s["design"]["candidate_predictions"][0].__setitem__("absolute_gap", 3))
    altered(lambda s: s["remaining_alias"]["grid_predictions"][2].__setitem__("g_mean", 7.75))
    altered(lambda s: s["identity"].__setitem__("runtime_fingerprint", "sha256:" + "0" * 64))
    altered(lambda s: s["identity"]["runtime"]["python"].pop("compiler"))
    altered(lambda s: s["identity"].__setitem__("study_code_hash", "sha256:" + "0" * 64))
    for payload in cases:
        assert _validate_with_node(json.dumps(payload)) == "rejected"
    valid = json.dumps(study)
    assert _validate_with_node(valid.replace('"trials": 10000', '"trials": 10000, "trials": 10000', 1)) == "rejected"
    assert _validate_with_node(valid.replace('"error_rate": 0.5', '"error_rate": NaN', 1)) == "rejected"


def test_wrapper_rejects_partial_output_and_hides_child_stderr(tmp_path):
    worker = tmp_path / "fake-python"
    worker.write_text(f"#!{sys.executable}\nimport sys\nsys.stderr.write('PRIVATE_CHILD_DIAGNOSTIC')\nsys.stdout.write('{{\"schema\":\"echoclass.followup-design.v1\"}}')\n", encoding="utf-8")
    worker.chmod(0o700)
    result = subprocess.run(["node", "--input-type=module", "-e", """
import { runFollowupDesign } from './scripts/followup-design.mjs';
try { runFollowupDesign({python: process.argv[1]}); process.stdout.write('accepted'); }
catch (error) { process.stdout.write(error.message); }
""", str(worker)], cwd=ROOT, text=True, capture_output=True, timeout=30, check=True)
    assert "no result was accepted" in result.stdout
    assert "PRIVATE_CHILD_DIAGNOSTIC" not in result.stdout + result.stderr


def test_wrapper_enforces_time_and_output_limits(tmp_path):
    for body, expected in [
        ("import time\ntime.sleep(2)\n", "exceeded its time limit"),
        ("print('x' * (3 * 1024 * 1024))\n", "Follow-up study failed"),
    ]:
        worker = tmp_path / "fake-python"
        worker.write_text(f"#!{sys.executable}\n{body}", encoding="utf-8")
        worker.chmod(0o700)
        timeout_ms = 20 if "time.sleep" in body else 5000
        result = subprocess.run(["node", "--input-type=module", "-e", """
import { runFollowupDesign } from './scripts/followup-design.mjs';
try { runFollowupDesign({python: process.argv[1], timeoutMs: Number(process.argv[2])}); process.stdout.write('accepted'); }
catch (error) { process.stdout.write(error.message); }
""", str(worker), str(timeout_ms)], cwd=ROOT, text=True, capture_output=True, timeout=10, check=True)
        assert expected in result.stdout
        assert len(result.stdout + result.stderr) < 200


def test_cli_rejects_tuning_arguments_and_supports_text():
    result = subprocess.run(["node", "scripts/followup-design.mjs", "--seed=9"], cwd=ROOT, text=True, capture_output=True, timeout=30)
    assert result.returncode == 1 and "Usage:" in result.stderr
    result = subprocess.run(["node", "--input-type=module", "-e", """
import { runFollowupDesign, formatFollowupDesign } from './scripts/followup-design.mjs';
for (const timeoutMs of [0, -1, 120001, 1.5]) {
  try { runFollowupDesign({timeoutMs}); process.exit(1); } catch {}
}
console.log(formatFollowupDesign(runFollowupDesign({python: process.argv[1]})));
""", sys.executable], cwd=ROOT, text=True, capture_output=True, timeout=30, check=True)
    assert "Zero observed simulation errors do not imply zero analytical risk." in result.stdout
    assert "not discovery, optimum validation" in result.stdout
