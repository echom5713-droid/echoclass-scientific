"""An independent checker must reject plausible report corruption and leakage."""
import copy

import pytest

from experiments.audit_method_study import AuditError, audit_study
from experiments.method_study import run_study


@pytest.fixture(scope="module")
def report():
    return run_study()


def test_independent_audit_recomputes_every_prediction(report):
    checked = audit_study(report)
    assert checked["trials_checked"] == 60
    assert checked["loco_folds_checked"] == 720
    assert checked["unseen_predictions_checked"] == 2340
    assert checked["alias_pairs_checked"] == 12
    assert checked["max_prediction_difference"] < 1e-10


def test_independent_audit_rejects_changed_prediction(report):
    damaged = copy.deepcopy(report)
    damaged["scenarios"][0]["trials"][0]["models"]["quadratic"]["unseen_grid"]["points"][0]["predicted"] += .01
    with pytest.raises(AuditError, match="grid prediction"):
        audit_study(damaged)


def test_independent_audit_rejects_held_out_concentration_in_training(report):
    damaged = copy.deepcopy(report)
    damaged["scenarios"][0]["trials"][0]["models"]["linear"]["loco"]["folds"][0]["training_concentrations"] = [0, 1, 3]
    with pytest.raises(AuditError, match="training isolation"):
        audit_study(damaged)
