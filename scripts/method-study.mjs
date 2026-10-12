import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalHash, parseStrictJson } from "../dist/src/domain/scientific/canonical.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const timeout = 120_000;
const configuration = parseStrictJson(
  readFileSync(path.join(root, "analytics/experiments/method-study-v1.config.json"), "utf8"),
);
const models = ["constant", "linear", "quadratic"];
const digest = /^sha256:[a-f0-9]{64}$/;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const metric = (value) => value === null || (finite(value) && value >= 0);
const same = (left, right) => canonicalHash(left) === canonicalHash(right);

function requireStudy(condition) {
  if (!condition) throw new Error("Invalid method-study output");
}

/** Reject incomplete output before treating a child process as a study result. */
export function validateMethodStudy(result) {
  requireStudy(result?.schema === "echoclass.method-study.v1" && result.trial_count === 60);
  requireStudy(same(result.configuration, configuration));
  requireStudy(
    digest.test(result.identity?.study_code_hash) &&
      digest.test(result.identity?.configuration_file_hash),
  );
  requireStudy(
    digest.test(result.identity?.production_python?.code_version) &&
      digest.test(result.identity?.production_node_code_version),
  );
  requireStudy(
    Array.isArray(result.scenarios) && result.scenarios.length === configuration.scenarios.length,
  );
  result.scenarios.forEach((scenario, scenarioIndex) => {
    requireStudy(scenario?.id === configuration.scenarios[scenarioIndex].id);
    requireStudy(
      Array.isArray(scenario.trials) && scenario.trials.length === configuration.seeds.length,
    );
    for (const [trialIndex, trial] of scenario.trials.entries()) {
      requireStudy(trial?.seed === configuration.seeds[trialIndex]);
      for (const field of ["dataset_hash", "execution_fingerprint", "scientific_result_hash"])
        requireStudy(digest.test(trial[field]));
      requireStudy(
        Array.isArray(trial.input_hashes) &&
          trial.input_hashes.length === 20 &&
          trial.input_hashes.every((value) => digest.test(value)),
      );
      requireStudy(Array.isArray(trial.observations) && trial.observations.length === 4);
      requireStudy(Array.isArray(trial.group_means) && trial.group_means.length === 4);
      trial.observations.forEach((group, groupIndex) => {
        requireStudy(group.concentration === configuration.concentrations[groupIndex]);
        requireStudy(
          Array.isArray(group.yields) &&
            group.yields.length === 5 &&
            group.yields.every((value) => finite(value) && value >= 0 && value <= 20),
        );
        requireStudy(
          trial.group_means[groupIndex].concentration === group.concentration &&
            finite(trial.group_means[groupIndex].mean),
        );
      });
      requireStudy(same(Object.keys(trial.models).sort(), [...models].sort()));
      for (const name of models) {
        const model = trial.models[name];
        requireStudy(
          typeof model.available === "boolean" &&
            (model.available
              ? model.failure_reason === null
              : typeof model.failure_reason === "string"),
        );
        const expectedCoefficients =
          name === "quadratic" ? ["a", "b", "c"] : ["intercept", "slope"];
        requireStudy(
          model.available
            ? same(Object.keys(model.coefficients).sort(), expectedCoefficients) &&
                Object.values(model.coefficients).every(finite)
            : model.coefficients === null,
        );
        requireStudy(typeof model.loco.available === "boolean" && metric(model.loco.rmse));
        requireStudy(
          Array.isArray(model.loco.folds) &&
            model.loco.folds.length === (model.loco.available ? 4 : 0),
        );
        requireStudy(
          model.loco.available
            ? finite(model.loco.rmse) && model.loco.failure_reason === null
            : model.loco.rmse === null && typeof model.loco.failure_reason === "string",
        );
        model.loco.folds.forEach((fold, foldIndex) => {
          requireStudy(fold.held_out_concentration === configuration.concentrations[foldIndex]);
          requireStudy(
            same(
              fold.training_concentrations,
              configuration.concentrations.filter((x) => x !== fold.held_out_concentration),
            ),
          );
          requireStudy([fold.observed_mean, fold.predicted_mean, fold.residual].every(finite));
          requireStudy(fold.extrapolation === (foldIndex === 0 || foldIndex === 3));
        });
        requireStudy(metric(model.unseen_grid.rmse));
        requireStudy(
          Array.isArray(model.unseen_grid.points) &&
            model.unseen_grid.points.length ===
              (model.available ? configuration.unseen_grid.length : 0),
        );
        requireStudy(
          model.available ? finite(model.unseen_grid.rmse) : model.unseen_grid.rmse === null,
        );
        model.unseen_grid.points.forEach((point, pointIndex) => {
          requireStudy(point.concentration === configuration.unseen_grid[pointIndex]);
          requireStudy([point.truth, point.predicted, point.residual].every(finite));
        });
      }
      const candidate = trial.quadratic_candidate;
      requireStudy(typeof candidate.available === "boolean");
      if (candidate.available) {
        requireStudy(
          [
            candidate.concentration,
            candidate.predicted_yield,
            candidate.true_yield_at_candidate,
            candidate.true_regret,
          ].every(finite),
        );
        requireStudy(
          candidate.concentration >= 0 && candidate.concentration <= 4 && candidate.reason === null,
        );
      } else {
        requireStudy(
          candidate.concentration === null &&
            candidate.predicted_yield === null &&
            candidate.true_yield_at_candidate === null &&
            candidate.true_regret === null &&
            typeof candidate.reason === "string",
        );
      }
    }
    for (const name of models) {
      const summary = scenario.summary.models[name];
      requireStudy(
        summary.fit_failed_trials ===
          scenario.trials.filter((trial) => !trial.models[name].available).length,
      );
      for (const key of ["loco", "unseen_grid"]) {
        const summaryMetric = summary[key];
        const available = scenario.trials.filter((trial) => trial.models[name][key].rmse !== null);
        requireStudy(
          summaryMetric.available_trials === available.length &&
            summaryMetric.failed_trials === scenario.trials.length - available.length,
        );
        requireStudy(
          summaryMetric.point_count ===
            available.length * (key === "loco" ? 4 : configuration.unseen_grid.length),
        );
        for (const field of [
          "pooled_rmse",
          "mean_trial_rmse",
          "trial_rmse_min",
          "trial_rmse_median",
          "trial_rmse_max",
        ]) {
          requireStudy(
            metric(summaryMetric[field]) &&
              (available.length ? summaryMetric[field] !== null : summaryMetric[field] === null),
          );
        }
        if (key === "loco")
          for (const field of ["endpoint_extrapolation", "interior_interpolation"]) {
            requireStudy(
              summaryMetric[field].point_count === available.length * 2 &&
                metric(summaryMetric[field].pooled_rmse),
            );
          }
      }
    }
    const summaryCandidate = scenario.summary.quadratic_candidate;
    const available = scenario.trials.filter((trial) => trial.quadratic_candidate.available).length;
    const reasons = {};
    for (const trial of scenario.trials)
      if (!trial.quadratic_candidate.available) {
        const reason = trial.quadratic_candidate.reason;
        reasons[reason] = (reasons[reason] || 0) + 1;
      }
    requireStudy(
      summaryCandidate.available_trials === available &&
        summaryCandidate.withheld_trials === 12 - available,
    );
    requireStudy(
      summaryCandidate.withheld_fraction === (12 - available) / 12 &&
        same(summaryCandidate.withheld_reasons, reasons),
    );
    requireStudy(
      available
        ? finite(summaryCandidate.mean_true_regret_when_available)
        : summaryCandidate.mean_true_regret_when_available === null,
    );
  });
  return result;
}

/** Run one committed study specification. Never read a classroom database. */
export function runMethodStudy({
  python = process.env.ECHOCLASS_PYTHON || "python3",
  timeoutMs = timeout,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > timeout) {
    throw new Error("Method-study timeout must be between 1 and 120000 milliseconds.");
  }
  const output = spawnSync(python, ["-m", "experiments.method_study"], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      PYTHONPATH: path.join(root, "analytics"),
      PYTHONDONTWRITEBYTECODE: "1",
      OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      MKL_NUM_THREADS: "1",
      NUMEXPR_NUM_THREADS: "1",
    },
  });
  if (output.error?.code === "ETIMEDOUT") {
    throw new Error("Method study exceeded its time limit; no partial result was accepted.");
  }
  if (output.error || output.status !== 0) {
    throw new Error(
      "Method study failed; verify the locked Python environment and run npm run build.",
    );
  }
  try {
    return validateMethodStudy(parseStrictJson(output.stdout));
  } catch {
    throw new Error("Method study returned an invalid result; no result was accepted.");
  }
}

export function formatMethodStudy(study) {
  const number = (value) => (value === null ? "unavailable" : value.toFixed(4));
  return [
    "EchoClass | Four concentrations cannot identify every response curve",
    "Fixed synthetic stress tests; 12 paired seeds per scenario, 5 records per concentration.",
    "RMSE unit: yield percentage points. Lower is better for this declared target only.",
    "LOCO predicts noisy held-out means; unseen-grid error uses unrounded noiseless truth.",
    "",
    "Scenario | Method | LOCO pooled RMSE | Unseen-grid pooled RMSE",
    ...study.scenarios.flatMap((scenario) =>
      Object.entries(scenario.summary.models).map(
        ([model, metrics]) =>
          `${scenario.id} | ${model} | ${number(metrics.loco.pooled_rmse)} | ${number(metrics.unseen_grid.pooled_rmse)}`,
      ),
    ),
    "",
    ...study.scenarios.map(
      (scenario) =>
        `${scenario.id}: quadratic candidate withheld ${scenario.summary.quadratic_candidate.withheld_trials}/12; mean true regret when available ${number(scenario.summary.quadratic_candidate.mean_true_regret_when_available)}.`,
    ),
    "",
    "The aliased quartic and low-noise quadratic have identical sealed observations and cross-validation.",
    "Their unseen shapes differ. These designed simulations select no model and validate no real optimum.",
    `Study source: ${study.identity.study_code_hash}`,
    "Use JSON output for every observation, fold, prediction, input/result hash, and limitation.",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: npm run scientific:study -- [--json|--text]\nDefault: JSON. Fixed synthetic study; 120-second time limit. Run npm run build first.",
    );
  } else if (args.length > 1 || (args.length === 1 && !["--json", "--text"].includes(args[0]))) {
    console.error("Usage: npm run scientific:study -- [--json|--text]");
    process.exitCode = 1;
  } else {
    try {
      const result = runMethodStudy();
      console.log(
        args[0] === "--text" ? formatMethodStudy(result) : JSON.stringify(result, null, 2),
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
