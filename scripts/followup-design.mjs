import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalHash, parseStrictJson } from "../dist/src/domain/scientific/canonical.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const configurationPath = "analytics/experiments/followup-design-v1.config.json";
const configurationBytes = readFileSync(path.join(root, configurationPath));
const configuration = parseStrictJson(configurationBytes.toString("utf8"));
const timeout = 120_000;
const sources = [
  configurationPath,
  "analytics/experiments/followup_design.py",
  "scripts/followup-design.mjs",
];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 10000;
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const same = (left, right) => canonicalHash(left) === canonicalHash(right);
const close = (left, right, tolerance = 1e-12) =>
  finite(left) && Math.abs(left - right) <= tolerance;
const nonemptyString = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 1024;

function requireValid(condition) {
  if (!condition) throw new Error("Invalid follow-up study output");
}

function keys(value, expected) {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value));
  requireValid(same(Object.keys(value).sort(), [...expected].sort()));
}

function sourceHash() {
  const hash = createHash("sha256");
  for (const relative of [...sources].sort()) {
    for (const bytes of [Buffer.from(relative), readFileSync(path.join(root, relative))]) {
      const length = Buffer.alloc(8);
      length.writeBigUInt64BE(BigInt(bytes.length));
      hash.update(length).update(bytes);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function expectedPrediction(x) {
  const q = 6 + 4 * x - x * x;
  const f = q - x * (x - 1) * (x - 3) * (x - 4);
  return { concentration: x, q_mean: q, f_mean: f, absolute_gap: Math.abs(q - f) };
}

// Composite Simpson integration provides a separate bounded validation of the
// Python erfc calculation. The study's risk values come from Python, not this.
function normalTailForValidation(z) {
  const intervals = 4096;
  const step = (12 - z) / intervals;
  const density = (x) => Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
  let sum = density(z) + density(12);
  for (let i = 1; i < intervals; i++) sum += (i % 2 === 0 ? 2 : 4) * density(z + i * step);
  return (sum * step) / 3;
}

function validateIdentity(identity) {
  keys(identity, [
    "study_code_hash",
    "configuration_file_hash",
    "runtime_fingerprint",
    "runtime",
    "runtime_scope",
  ]);
  requireValid(identity.study_code_hash === sourceHash());
  requireValid(identity.configuration_file_hash === sha256(configurationBytes));
  requireValid(
    identity.runtime_scope ===
      "Numerical Python process only; Node validates and formats output without drawing samples.",
  );
  const runtime = identity.runtime;
  keys(runtime, ["python", "numpy_version", "platform", "byteorder"]);
  keys(runtime.python, ["implementation", "version", "build", "compiler"]);
  requireValid(
    [
      runtime.python.implementation,
      runtime.python.version,
      runtime.python.compiler,
      runtime.numpy_version,
    ].every(nonemptyString),
  );
  requireValid(
    Array.isArray(runtime.python.build) &&
      runtime.python.build.length === 2 &&
      runtime.python.build.every(nonemptyString),
  );
  keys(runtime.platform, ["system", "release", "machine", "libc"]);
  requireValid(
    [runtime.platform.system, runtime.platform.release, runtime.platform.machine].every(
      nonemptyString,
    ),
  );
  requireValid(
    Array.isArray(runtime.platform.libc) &&
      runtime.platform.libc.length === 2 &&
      runtime.platform.libc.every((value) => typeof value === "string" && value.length <= 1024),
  );
  requireValid(["little", "big"].includes(runtime.byteorder));
  requireValid(identity.runtime_fingerprint === sha256(Buffer.from(sortedJson(runtime), "utf8")));
}

function validateOutput(result) {
  keys(result, [
    "schema",
    "configuration",
    "identity",
    "design",
    "simulation",
    "results",
    "remaining_alias",
  ]);
  requireValid(
    result.schema === "echoclass.followup-design.v1" && same(result.configuration, configuration),
  );
  validateIdentity(result.identity);
  const design = result.design;
  keys(design, [
    "candidate_predictions",
    "selected_concentration",
    "selected_gap",
    "maximizers",
    "selection_before_sampling",
    "choices",
  ]);
  const predictions = configuration.candidate_grid.map(expectedPrediction);
  requireValid(same(design.candidate_predictions, predictions));
  const gap = Math.max(...predictions.map((point) => point.absolute_gap));
  const maxima = predictions
    .filter((point) => point.absolute_gap === gap)
    .map((point) => point.concentration)
    .sort((a, b) => a - b);
  requireValid(design.selected_concentration === maxima[0] && design.selected_gap === gap);
  requireValid(same(design.maximizers, maxima) && design.selection_before_sampling === true);
  const choices = configuration.designs.map((choice) => ({
    id: choice.id,
    ...expectedPrediction(choice.concentration),
  }));
  requireValid(same(design.choices, choices));
  requireValid(
    same(result.simulation, {
      conditional_cell_count: 54,
      trials_per_cell: 10000,
      paired_noise_batch_count: 18,
      independent_trial_mean_draw_count: 180000,
      independent_record_draw_count: 540000,
      design_trial_evaluations: 540000,
    }),
  );
  requireValid(Array.isArray(result.results) && result.results.length === 27);
  let rowIndex = 0;
  for (const choice of choices) {
    for (const [noiseIndex, sigma] of configuration.noise_standard_deviations.entries()) {
      for (const [replicationIndex, n] of configuration.replicate_counts.entries()) {
        const row = result.results[rowIndex++];
        keys(row, [
          "design_id",
          "concentration",
          "noise_sd",
          "replicates",
          "analytic_conditional_error",
          "q",
          "f",
          "equal_prior_error_rate",
          "equal_prior_signed_discrepancy",
        ]);
        requireValid(
          row.design_id === choice.id &&
            row.concentration === choice.concentration &&
            row.noise_sd === sigma &&
            row.replicates === n,
        );
        const analytic = normalTailForValidation(
          (choice.absolute_gap * Math.sqrt(n)) / (2 * sigma),
        );
        requireValid(
          row.analytic_conditional_error >= 0 &&
            row.analytic_conditional_error <= 0.5 &&
            close(row.analytic_conditional_error, analytic, 1e-11),
        );
        for (const [truthIndex, truth] of ["q", "f"].entries()) {
          const cell = row[truth];
          keys(cell, [
            "seed_entropy",
            "trials",
            "error_count",
            "error_rate",
            "tie_count",
            "assigned_q",
            "assigned_f",
            "signed_discrepancy",
          ]);
          requireValid(same(cell.seed_entropy, [2101, truthIndex, noiseIndex, replicationIndex]));
          requireValid(
            cell.trials === 10000 &&
              [cell.error_count, cell.tie_count, cell.assigned_q, cell.assigned_f].every(count),
          );
          requireValid(cell.assigned_q + cell.assigned_f === cell.trials);
          requireValid(cell.error_count === (truth === "q" ? cell.assigned_f : cell.assigned_q));
          requireValid(close(cell.error_rate, cell.error_count / cell.trials));
          requireValid(
            close(cell.signed_discrepancy, cell.error_rate - row.analytic_conditional_error),
          );
          if (choice.absolute_gap === 0) {
            requireValid(
              cell.tie_count === 10000 && cell.assigned_q === 5000 && cell.assigned_f === 5000,
            );
          }
        }
        requireValid(close(row.equal_prior_error_rate, (row.q.error_rate + row.f.error_rate) / 2));
        requireValid(
          close(
            row.equal_prior_signed_discrepancy,
            row.equal_prior_error_rate - row.analytic_conditional_error,
          ),
        );
      }
    }
  }
  const remaining = result.remaining_alias;
  keys(remaining, ["formula", "agreement_concentrations", "grid_predictions"]);
  requireValid(
    remaining.formula === configuration.remaining_alias_formula &&
      same(remaining.agreement_concentrations, [0, 1, 2, 3, 4]),
  );
  requireValid(
    same(
      remaining.grid_predictions,
      configuration.candidate_grid.map((x) => {
        const q = 6 + 4 * x - x * x;
        const g = q - x * (x - 1) * (x - 2) * (x - 3) * (x - 4);
        return { concentration: x, q_mean: q, g_mean: g, absolute_gap: Math.abs(q - g) };
      }),
    ),
  );
  return result;
}

/** Validate complete nested output and identities; this does not replay the RNG. */
export function validateFollowupDesign(result) {
  try {
    return validateOutput(result);
  } catch {
    throw new Error("Invalid follow-up study output");
  }
}

export function runFollowupDesign({
  python = process.env.ECHOCLASS_PYTHON || "python3",
  timeoutMs = timeout,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > timeout) {
    throw new Error("Follow-up timeout must be between 1 and 120000 milliseconds.");
  }
  const output = spawnSync(python, ["-m", "experiments.followup_design"], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 2 * 1024 * 1024,
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
  if (output.error?.code === "ETIMEDOUT")
    throw new Error("Follow-up study exceeded its time limit; no partial result was accepted.");
  if (output.error || output.status !== 0)
    throw new Error(
      "Follow-up study failed; verify the locked Python environment and run npm run build.",
    );
  try {
    return validateFollowupDesign(parseStrictJson(output.stdout));
  } catch {
    throw new Error("Follow-up study returned an invalid result; no result was accepted.");
  }
}

export function formatFollowupDesign(study) {
  return [
    "EchoClass | Which measurement separates two specified explanations?",
    "Known q/f responses; known Gaussian sigma; 10000 trials per truth/noise/replication cell.",
    "The same known sigma applies at every location; measurement cost is not modeled.",
    "The three designs share noise within each cell; these comparisons are paired.",
    "Design | x | sigma | n | Analytic error per truth | q error | f error | Equal-prior error",
    ...study.results.map(
      (row) =>
        `${row.design_id} | ${row.concentration} | ${row.noise_sd} | ${row.replicates} | ${row.analytic_conditional_error.toPrecision(7)} | ${row.q.error_rate.toFixed(4)} | ${row.f.error_rate.toFixed(4)} | ${row.equal_prior_error_rate.toFixed(4)}`,
    ),
    "",
    "Equal-prior error averages two conditional rates; it assumes no measured prevalence.",
    "Zero observed simulation errors do not imply zero analytical risk.",
    "Selected x=2 separates only the specified pair; another g still agrees with q at all five points.",
    "This is a synthetic discrimination study, not discovery, optimum validation, or a production change.",
    `Study source: ${study.identity.study_code_hash}`,
    "Use JSON for all error counts, seeds, design predictions, runtime identity, and limitations.",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node scripts/followup-design.mjs [--json|--text]\nDefault: JSON. Fixed synthetic design; 120-second time limit. Run npm run build first.",
    );
  } else if (args.length > 1 || (args.length === 1 && !["--json", "--text"].includes(args[0]))) {
    console.error("Usage: node scripts/followup-design.mjs [--json|--text]");
    process.exitCode = 1;
  } else {
    try {
      const result = runFollowupDesign();
      console.log(
        args[0] === "--text" ? formatFollowupDesign(result) : JSON.stringify(result, null, 2),
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
