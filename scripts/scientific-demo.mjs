import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateScientificResult } from "../dist/src/domain/scientific/result-validation.js";
import { canonicalHash, parseStrictJson } from "../dist/src/domain/scientific/canonical.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = path.join(root, "tests/fixtures/scientific/synthetic-envelope.json");
const timeout = 30_000;

/** Read-only calculation of the committed fixture, never a classroom database. */
export function runSyntheticDemo({ python = process.env.ECHOCLASS_PYTHON || "python3", timeoutMs = timeout } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > timeout) {
    throw new Error("Synthetic demo timeout must be between 1 and 30000 milliseconds.");
  }
  const output = spawnSync(python, ["-m", "echoclass_analytics.reproduce", fixture], {
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
  if (output.error?.code === "ETIMEDOUT") {
    throw new Error("Synthetic demo exceeded its time limit; no result was accepted.");
  }
  if (output.error || output.status !== 0) {
    throw new Error("Synthetic demo failed; verify the Python environment and fixture. See docs/reproducible-case.md.");
  }
  try {
    const response = parseStrictJson(output.stdout);
    const envelope = parseStrictJson(readFileSync(fixture, "utf8"));
    const result = validateScientificResult(response.result, envelope);
    return {
      label: "synthetic_demo — not real experimental observations",
      dataset_hash: result.dataset_hash,
      scientific_result_hash: canonicalHash(result),
      selection: {
        candidate_count: result.selection.candidate_count,
        included_count: result.selection.included_count,
        excluded_count: result.selection.excluded_count,
      },
      groups: result.groups.map((group) => ({
        concentration: group.concentration,
        n: group.n,
        mean: group.statistics.mean,
        sd: group.statistics.sd,
        ci: group.ci,
      })),
      best_tested: result.best_tested,
      candidate: result.candidate,
      limitations: result.limitations,
      observed_identity: response.identity,
      identity_note: "Fixture identity is synthetic; this is an offline demonstration, not a production exact-reproduction claim.",
    };
  } catch {
    throw new Error("Synthetic demo returned an invalid result; no result was accepted.");
  }
}

export function formatSyntheticDemo(summary) {
  const number = (value) => value === null ? "unavailable" : Number(value.toPrecision(8)).toString();
  const best = summary.best_tested;
  const candidate = summary.candidate;
  return [
    "EchoClass | A synthetic citrus-oil yield case",
    "Synthetic values and review events; no real experimental observations.",
    "",
    `Teacher-included fixture records: ${summary.selection.included_count}/${summary.selection.candidate_count}`,
    "NH4Cl (%) | included n | mean yield (%)",
    ...summary.groups.map((group) => `${group.concentration} | ${group.n} | ${number(group.mean.value)}`),
    "",
    best.concentrations.length
      ? `Best tested: ${best.concentrations.map((value) => `${number(value)}%`).join(" and ")}${best.concentrations.length > 1 ? " (tie)" : ""}; mean yield ${number(best.mean)}%.`
      : `Best tested: unavailable (${best.reason}).`,
    candidate.concentration !== null
      ? `Model candidate: ${number(candidate.concentration)}% NH4Cl; predicted yield ${number(candidate.predicted_yield)}%.`
      : `Model candidate: unavailable (${candidate.reason}).`,
    "The candidate is a model suggestion for a new experiment, not an established optimum.",
    "Bootstrap intervals assume independent records; this fixture does not establish independence.",
    "",
    `Dataset: ${summary.dataset_hash}`,
    `Scientific result: ${summary.scientific_result_hash}`,
    summary.identity_note,
    "Use the default JSON output for full numerical precision and the observed runtime identity.",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run scientific:demo -- [--json|--text]\nDefault: JSON. Read-only synthetic fixture; 30-second time limit.");
  } else if (args.length > 1 || (args.length === 1 && !["--text", "--json"].includes(args[0]))) {
    console.error("Usage: npm run scientific:demo -- [--json|--text]");
    process.exitCode = 1;
  } else {
    try {
      const summary = runSyntheticDemo();
      console.log(args[0] === "--text" ? formatSyntheticDemo(summary) : JSON.stringify(summary, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
