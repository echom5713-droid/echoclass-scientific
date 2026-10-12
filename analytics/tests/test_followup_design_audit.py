"""The separate checker must reconstruct decisions, not only reconcile totals."""
import copy
import os
from pathlib import Path
import subprocess
import sys

import pytest

from experiments.audit_followup_design import AuditError, audit_study
from experiments.followup_design import run_study


@pytest.fixture(scope="module")
def report():
    return run_study()


def test_independent_audit_replays_all_noise_batches_and_decisions(report):
    checked = audit_study(report)
    assert checked["status"] == "PASS"
    assert checked["design_rows_checked"] == 27
    assert checked["conditional_cells_checked"] == 54
    assert checked["independent_noise_batches_replayed"] == 18
    assert checked["classifications_checked"] == 540_000
    assert checked["candidate_predictions_checked"] == 17
    assert checked["remaining_alias_predictions_checked"] == 17
    assert checked["max_analytic_probability_difference"] < 1e-12


def test_independent_audit_rejects_wrong_selected_location(report):
    damaged = copy.deepcopy(report)
    damaged["design"]["selected_concentration"] = .5
    with pytest.raises(AuditError, match="selected concentration"):
        audit_study(damaged)


def test_independent_audit_rejects_internally_consistent_wrong_error_counts(report):
    damaged = copy.deepcopy(report)
    row = damaged["results"][18]  # Selected point, sigma=1, one replicate.
    cell = row["q"]
    cell["error_count"] += 1
    cell["error_rate"] = cell["error_count"] / cell["trials"]
    cell["assigned_f"] += 1
    cell["assigned_q"] -= 1
    cell["signed_discrepancy"] = cell["error_rate"] - row["analytic_conditional_error"]
    row["equal_prior_error_rate"] = (cell["error_rate"] + row["f"]["error_rate"]) / 2
    row["equal_prior_signed_discrepancy"] = row["equal_prior_error_rate"] - row["analytic_conditional_error"]
    with pytest.raises(AuditError, match="reconstructed error count"):
        audit_study(damaged)


def test_independent_audit_rejects_changed_protocol(report):
    damaged = copy.deepcopy(report)
    damaged["configuration"]["noise_standard_deviations"][0] = 2
    with pytest.raises(AuditError, match="configuration.noise_standard_deviations"):
        audit_study(damaged)


def test_independent_audit_rejects_changed_remaining_alias(report):
    damaged = copy.deepcopy(report)
    damaged["remaining_alias"]["grid_predictions"][1]["g_mean"] += .01
    with pytest.raises(AuditError, match="remaining alias prediction.g_mean"):
        audit_study(damaged)


def test_independent_audit_rejects_malformed_source_digest(report):
    damaged = copy.deepcopy(report)
    damaged["identity"]["study_code_hash"] = "sha256:not-a-digest"
    with pytest.raises(AuditError, match="identity digest syntax"):
        audit_study(damaged)


def test_independent_audit_rejects_runtime_fingerprint_mismatch(report):
    damaged = copy.deepcopy(report)
    damaged["identity"]["runtime"]["numpy_version"] = "999.0.0"
    with pytest.raises(AuditError, match="runtime fingerprint self-consistency"):
        audit_study(damaged)


@pytest.mark.parametrize("payload", ['{"schema":1,"schema":2}', '{"value":NaN}', '{"value":Infinity}'])
def test_audit_cli_rejects_ambiguous_or_nonfinite_json(tmp_path, payload):
    path = tmp_path / "invalid.json"
    path.write_text(payload, encoding="utf-8")
    result = subprocess.run([sys.executable, "-m", "experiments.audit_followup_design", str(path)],
                            check=False, text=True, capture_output=True,
                            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])})
    assert result.returncode == 1
    assert result.stdout == ""
    assert "no successful cross-check was accepted" in result.stderr
