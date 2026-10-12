import type { JsonObject } from "../../shared/json-safe.js";
import { canonicalHash, canonicalize, hashCanonicalBytes, parseStrictJson } from "./canonical.js";
import { scientificSettings, type ScientificEnvelope } from "./contract.js";

const CONCENTRATIONS = [0, 1, 3, 4] as const;
const STATISTICS = [
  "mean",
  "median",
  "min",
  "max",
  "sd",
  "q1",
  "q3",
  "iqr",
  "mad",
  "mad_normal",
] as const;
const LIMITATIONS = [
  "exploratory_analysis",
  "record_independence_unverified",
  "bootstrap_assumes_independent_records",
  "four_concentration_model",
  "candidate_requires_new_experiment",
];
const FIT_REASONS = [
  "insufficient_groups",
  "rank_deficient",
  "ill_conditioned",
  "numeric_unavailable",
];
const VERTEX_REASONS = ["not_concave", "vertex_outside_range", "numeric_unavailable"];

function invalid(field: string): never {
  // Only schema paths, never observations or worker-supplied text, enter errors.
  throw new Error(`Invalid scientific result: ${field}`);
}

function object(value: unknown, field: string, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const result = value as Record<string, unknown>;
  if (
    keys &&
    (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)))
  )
    invalid(field);
  return result;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function count(value: unknown, field: string): number {
  const result = number(value, field);
  if (!Number.isSafeInteger(result) || result < 0 || result > 500) invalid(field);
  return result;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function same(value: unknown, expected: unknown, field: string): void {
  if (canonicalize(value) !== canonicalize(expected)) invalid(field);
}

function reason(value: unknown, allowed: readonly string[], field: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(field);
}

function metric(
  value: unknown,
  field: string,
  allowed: readonly string[],
  nonnegative = false,
): number | null {
  const item = object(value, field, ["value", "reason"]);
  if (item.value === null) {
    reason(item.reason, allowed, `${field}.reason`);
    return null;
  }
  const result = number(item.value, `${field}.value`);
  if (item.reason !== null || (nonnegative && result < 0)) invalid(field);
  return result;
}

function canonicalObject(text: string, hash: string, field: string): Record<string, unknown> {
  if (!/^sha256:[a-f0-9]{64}$/.test(hash) || hashCanonicalBytes(text) !== hash) invalid(field);
  const result = object(parseStrictJson(text), field);
  if (canonicalize(result) !== text) invalid(field);
  return result;
}

interface SelectedRecord {
  ordinal: number;
  record_id: string;
  review_binding_mode: "effective" | "none";
  review_status: string;
  included: boolean;
  reason: string | null;
  concentration: number;
}

function selectedRecords(envelope: ScientificEnvelope): SelectedRecord[] {
  const dataset = canonicalObject(
    envelope.dataset_canonical_json,
    envelope.dataset_hash,
    "envelope.dataset",
  );
  const entries = array(dataset.entries, "envelope.dataset.entries");
  if (
    entries.length < 1 ||
    entries.length > 500 ||
    entries.length !== envelope.canonical_inputs.length
  )
    invalid("envelope.dataset.entries");
  const seen = new Set<string>();
  return entries.map((raw, ordinal) => {
    const entry = object(raw, "envelope.dataset.entry", ["ordinal", "record_id", "input_hash"]);
    const source = envelope.canonical_inputs[ordinal]!;
    if (
      entry.ordinal !== ordinal ||
      typeof entry.record_id !== "string" ||
      !entry.record_id ||
      seen.has(entry.record_id) ||
      entry.input_hash !== source.input_hash
    )
      invalid("envelope.dataset.entry");
    seen.add(entry.record_id);
    const input = canonicalObject(source.canonical_json, source.input_hash, "envelope.input");
    const snapshot = object(input.record_snapshot, "envelope.record_snapshot");
    if (
      snapshot.id !== entry.record_id ||
      snapshot.class_id !== dataset.class_id ||
      typeof snapshot.review_status !== "string" ||
      !["normal", "review", "included", "excluded"].includes(snapshot.review_status) ||
      !CONCENTRATIONS.includes(snapshot.nh4cl_concentration as (typeof CONCENTRATIONS)[number])
    )
      invalid("envelope.record_snapshot");
    const mode = input.review_binding_mode;
    if (mode !== "effective" && mode !== "none") invalid("envelope.review_binding_mode");
    let included = false;
    let excluded = false;
    if (mode === "effective") {
      const review = object(input.review_snapshot, "envelope.review_snapshot");
      if (review.record_id !== entry.record_id || review.status !== snapshot.review_status)
        invalid("envelope.review_snapshot");
      included = review.status === "included";
      excluded = review.status === "excluded";
    } else if (input.review_snapshot !== null) invalid("envelope.review_snapshot");
    return {
      ordinal,
      record_id: entry.record_id,
      review_binding_mode: mode,
      review_status: snapshot.review_status,
      included,
      reason: included ? null : excluded ? "review_excluded" : "not_approved",
      concentration: snapshot.nh4cl_concentration as number,
    };
  });
}

interface CheckedGroup {
  concentration: number;
  n: number;
  mean: number | null;
}

function validateGroup(
  raw: unknown,
  concentration: number,
  records: SelectedRecord[],
): CheckedGroup {
  const field = `groups[${concentration}]`;
  const group = object(raw, field, [
    "concentration",
    "n",
    "record_ids",
    "statistics",
    "ci",
    "iqr_flags",
  ]);
  const ids = records
    .filter((record) => record.included && record.concentration === concentration)
    .map((record) => record.record_id);
  if (group.concentration !== concentration || count(group.n, `${field}.n`) !== ids.length)
    invalid(field);
  same(group.record_ids, ids, `${field}.record_ids`);
  const n = ids.length;
  const statistics = object(group.statistics, `${field}.statistics`, STATISTICS);
  const values = new Map<string, number | null>();
  for (const name of STATISTICS) {
    const value = metric(
      statistics[name],
      `${field}.statistics.${name}`,
      ["no_approved_records", "insufficient_replicates", "numeric_unavailable"],
      true,
    );
    if ((n === 0 || (name === "sd" && n === 1)) && value !== null)
      invalid(`${field}.statistics.${name}`);
    const item = object(statistics[name], `${field}.statistics.${name}`);
    if (n === 0 && item.reason !== "no_approved_records") invalid(`${field}.statistics.${name}`);
    if (n === 1 && name === "sd" && item.reason !== "insufficient_replicates")
      invalid(`${field}.statistics.sd`);
    if (
      n > 0 &&
      !(n === 1 && name === "sd") &&
      value === null &&
      item.reason !== "numeric_unavailable"
    )
      invalid(`${field}.statistics.${name}`);
    values.set(name, value);
  }
  // Relations among returned order statistics are structural checks, not a second algorithm.
  const ordered = ["min", "q1", "median", "q3", "max"].map((name) => values.get(name));
  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    if (
      left !== null &&
      left !== undefined &&
      right !== null &&
      right !== undefined &&
      left > right
    )
      invalid(`${field}.statistics.order`);
  }
  const ci = object(group.ci, `${field}.ci`, [
    "confidence_level",
    "method",
    "resamples",
    "lower",
    "upper",
    "reason",
  ]);
  if (ci.confidence_level !== 0.95 || ci.method !== "percentile" || ci.resamples !== 10000)
    invalid(`${field}.ci`);
  if (ci.lower === null || ci.upper === null) {
    if (ci.lower !== null || ci.upper !== null) invalid(`${field}.ci`);
    reason(
      ci.reason,
      [
        "no_approved_records",
        "insufficient_replicates",
        "degenerate_empirical_distribution",
        "numeric_unavailable",
      ],
      `${field}.ci.reason`,
    );
    if (n === 0 && ci.reason !== "no_approved_records") invalid(`${field}.ci.reason`);
    if (n === 1 && ci.reason !== "insufficient_replicates") invalid(`${field}.ci.reason`);
    if (
      n > 1 &&
      !["degenerate_empirical_distribution", "numeric_unavailable"].includes(String(ci.reason))
    )
      invalid(`${field}.ci.reason`);
  } else {
    const lower = number(ci.lower, `${field}.ci.lower`);
    const upper = number(ci.upper, `${field}.ci.upper`);
    if (n < 2 || lower < 0 || lower > upper || ci.reason !== null) invalid(`${field}.ci`);
  }
  if (
    n > 1 &&
    values.get("min") !== null &&
    values.get("min") === values.get("max") &&
    (ci.lower !== null || ci.reason !== "degenerate_empirical_distribution")
  )
    invalid(`${field}.ci`);

  const flags = object(group.iqr_flags, `${field}.iqr_flags`, ["record_ids", "reason"]);
  const flagIds = array(flags.record_ids, `${field}.iqr_flags.record_ids`);
  if (
    flagIds.some((id) => typeof id !== "string" || !ids.includes(id)) ||
    new Set(flagIds).size !== flagIds.length
  )
    invalid(`${field}.iqr_flags.record_ids`);
  same(
    flagIds,
    ids.filter((id) => flagIds.includes(id)),
    `${field}.iqr_flags.order`,
  );
  if (flags.reason !== null) {
    reason(
      flags.reason,
      ["no_approved_records", "insufficient_replicates", "zero_iqr", "numeric_unavailable"],
      `${field}.iqr_flags.reason`,
    );
    if (flagIds.length !== 0) invalid(`${field}.iqr_flags`);
  }
  const iqr = values.get("iqr");
  if (
    (n === 0 && flags.reason !== "no_approved_records") ||
    (n > 0 && n < 4 && flags.reason !== "insufficient_replicates") ||
    (n >= 4 && iqr === 0 && flags.reason !== "zero_iqr") ||
    (n >= 4 && iqr === null && flags.reason !== "numeric_unavailable") ||
    (n >= 4 &&
      typeof iqr === "number" &&
      iqr > 0 &&
      flags.reason !== null &&
      flags.reason !== "numeric_unavailable")
  )
    invalid(`${field}.iqr_flags.reason`);
  return { concentration, n, mean: values.get("mean")! };
}

function validateRegression(
  raw: unknown,
  groups: CheckedGroup[],
): {
  available: boolean;
  loocvAvailable: boolean;
  vertices: number[];
  a: number | null;
} {
  const fit = object(raw, "regression", [
    "available",
    "reason",
    "n_groups",
    "residual_df",
    "coefficients",
    "rank",
    "condition_number",
    "saturated",
    "training_r_squared",
    "training_rmse",
    "loocv",
  ]);
  const available = boolean(fit.available, "regression.available");
  const n = groups.filter((group) => group.mean !== null).length;
  if (count(fit.n_groups, "regression.n_groups") !== n) invalid("regression.n_groups");
  const saturated = boolean(fit.saturated, "regression.saturated");
  let a: number | null = null;
  if (available) {
    if (
      n < 3 ||
      fit.reason !== null ||
      fit.rank !== 3 ||
      fit.residual_df !== n - 3 ||
      saturated !== (n === 3)
    )
      invalid("regression");
    if (number(fit.condition_number, "regression.condition_number") <= 0)
      invalid("regression.condition_number");
    const coefficients = object(fit.coefficients, "regression.coefficients", ["a", "b", "c"]);
    a = number(coefficients.a, "regression.coefficients.a");
    number(coefficients.b, "regression.coefficients.b");
    number(coefficients.c, "regression.coefficients.c");
  } else {
    reason(fit.reason, FIT_REASONS, "regression.reason");
    if (
      fit.coefficients !== null ||
      fit.rank !== null ||
      fit.condition_number !== null ||
      fit.residual_df !== null ||
      saturated
    )
      invalid("regression");
    if (n < 3 && fit.reason !== "insufficient_groups") invalid("regression.reason");
  }
  const rSquared = metric(fit.training_r_squared, "regression.training_r_squared", [
    ...FIT_REASONS,
    "constant_response",
  ]);
  const rmse = metric(fit.training_rmse, "regression.training_rmse", FIT_REASONS, true);
  if ((!available && (rSquared !== null || rmse !== null)) || (rSquared !== null && rSquared > 1))
    invalid("regression.training_metrics");
  if (
    !available &&
    (object(fit.training_r_squared, "regression.training_r_squared").reason !== fit.reason ||
      object(fit.training_rmse, "regression.training_rmse").reason !== fit.reason)
  )
    invalid("regression.training_metrics.reason");
  if (available) {
    if (rSquared === null)
      reason(
        object(fit.training_r_squared, "regression.training_r_squared").reason,
        ["constant_response", "numeric_unavailable"],
        "regression.training_r_squared.reason",
      );
    if (
      rmse === null &&
      object(fit.training_rmse, "regression.training_rmse").reason !== "numeric_unavailable"
    )
      invalid("regression.training_rmse.reason");
  }
  const loocv = object(fit.loocv, "regression.loocv", ["available", "reason", "rmse", "folds"]);
  const loocvAvailable = boolean(loocv.available, "regression.loocv.available");
  const cvRmse = metric(
    loocv.rmse,
    "regression.loocv.rmse",
    ["insufficient_groups", "fold_failure", "numeric_unavailable"],
    true,
  );
  const folds = array(loocv.folds, "regression.loocv.folds");
  const vertices: number[] = [];
  if (!loocvAvailable) {
    reason(loocv.reason, ["insufficient_groups", "fold_failure"], "regression.loocv.reason");
    if (cvRmse !== null || folds.length !== 0 || (n < 4 && loocv.reason !== "insufficient_groups"))
      invalid("regression.loocv");
    if (object(loocv.rmse, "regression.loocv.rmse").reason !== loocv.reason)
      invalid("regression.loocv.rmse.reason");
    return { available, loocvAvailable, vertices, a };
  }
  if (!available || n !== 4 || loocv.reason !== null || cvRmse === null || folds.length !== 4)
    invalid("regression.loocv");
  folds.forEach((rawFold, index) => {
    const field = `regression.loocv.folds[${index}]`;
    const fold = object(rawFold, field, [
      "held_out_concentration",
      "observed_mean",
      "predicted_mean",
      "residual",
      "extrapolation",
      "vertex",
      "vertex_reason",
    ]);
    const group = groups[index]!;
    if (
      fold.held_out_concentration !== group.concentration ||
      fold.observed_mean !== group.mean ||
      fold.extrapolation !== (index === 0 || index === 3)
    )
      invalid(field);
    number(fold.observed_mean, `${field}.observed_mean`);
    number(fold.predicted_mean, `${field}.predicted_mean`);
    number(fold.residual, `${field}.residual`);
    if (fold.vertex === null) reason(fold.vertex_reason, VERTEX_REASONS, `${field}.vertex_reason`);
    else {
      const vertex = number(fold.vertex, `${field}.vertex`);
      if (vertex <= 0 || vertex >= 4 || fold.vertex_reason !== null) invalid(`${field}.vertex`);
      vertices.push(vertex);
    }
  });
  return { available, loocvAvailable, vertices, a };
}

/** Validate a worker report against the sealed request; this does not recalculate statistics. */
export function validateScientificResult(value: unknown, envelope: ScientificEnvelope): JsonObject {
  // This new output boundary alone permits -0 -> 0. Canonicalization rejects unsupported
  // values, non-finite numbers, accessors, sparse arrays, cycles and invalid Unicode first.
  let normalized: unknown;
  try {
    normalized = parseStrictJson(canonicalize(value));
  } catch {
    invalid("JSON");
  }
  const result = object(normalized, "result", [
    "schema",
    "dataset_hash",
    "execution_fingerprint",
    "algorithm_version",
    "configuration",
    "selection",
    "groups",
    "regression",
    "best_tested",
    "candidate",
    "limitations",
  ]);
  const execution = canonicalObject(
    envelope.execution_canonical_json,
    envelope.execution_fingerprint,
    "envelope.execution",
  );
  if (
    envelope.schema !== "echoclass.scientific-envelope.v1" ||
    execution.schema !== "echoclass.scientific-execution.v1" ||
    execution.dataset_hash !== envelope.dataset_hash ||
    result.schema !== "echoclass.scientific-result.v1" ||
    result.dataset_hash !== envelope.dataset_hash ||
    result.execution_fingerprint !== envelope.execution_fingerprint ||
    result.algorithm_version !== "echoclass.yield-analysis.v1" ||
    result.algorithm_version !== execution.algorithm_version
  )
    invalid("identity");
  same(result.configuration, execution.configuration, "configuration");
  const settings = scientificSettings();
  const seed = canonicalHash({
    schema: "echoclass.scientific-seed.v1",
    dataset_hash: envelope.dataset_hash,
    settings_without_seed: settings,
  }).slice(7, 39);
  same(result.configuration, { ...settings, seed_hex: seed }, "configuration.settings");
  const records = selectedRecords(envelope);
  const included = records.filter((record) => record.included).length;
  const selection = object(result.selection, "selection", [
    "candidate_count",
    "included_count",
    "excluded_count",
    "records",
  ]);
  if (
    count(selection.candidate_count, "selection.candidate_count") !== records.length ||
    count(selection.included_count, "selection.included_count") !== included ||
    count(selection.excluded_count, "selection.excluded_count") !== records.length - included
  )
    invalid("selection.counts");
  same(
    selection.records,
    records.map((record) => ({
      ordinal: record.ordinal,
      record_id: record.record_id,
      review_binding_mode: record.review_binding_mode,
      review_status: record.review_status,
      included: record.included,
      reason: record.reason,
    })),
    "selection.records",
  );
  const rawGroups = array(result.groups, "groups");
  if (rawGroups.length !== 4) invalid("groups");
  const groups = CONCENTRATIONS.map((concentration, index) =>
    validateGroup(rawGroups[index], concentration, records),
  );
  const regression = validateRegression(result.regression, groups);
  const best = object(result.best_tested, "best_tested", ["concentrations", "mean", "reason"]);
  const bestConcentrations = array(best.concentrations, "best_tested.concentrations");
  if (best.mean === null) {
    reason(best.reason, ["no_approved_records", "numeric_unavailable"], "best_tested.reason");
    if (
      bestConcentrations.length !== 0 ||
      (included === 0 && best.reason !== "no_approved_records")
    )
      invalid("best_tested");
  } else {
    if (
      number(best.mean, "best_tested.mean") < 0 ||
      included === 0 ||
      best.reason !== null ||
      bestConcentrations.length === 0
    )
      invalid("best_tested");
    const populated = groups.filter((group) => group.n > 0).map((group) => group.concentration);
    if (
      bestConcentrations.some(
        (concentration) => typeof concentration !== "number" || !populated.includes(concentration),
      )
    )
      invalid("best_tested.concentrations");
    same(
      bestConcentrations,
      populated.filter((concentration) => bestConcentrations.includes(concentration)),
      "best_tested.concentrations",
    );
  }
  const candidate = object(result.candidate, "candidate", [
    "concentration",
    "predicted_yield",
    "leave_one_out_vertex_range",
    "reason",
  ]);
  if (
    candidate.concentration === null ||
    candidate.predicted_yield === null ||
    candidate.leave_one_out_vertex_range === null
  ) {
    if (
      candidate.concentration !== null ||
      candidate.predicted_yield !== null ||
      candidate.leave_one_out_vertex_range !== null
    )
      invalid("candidate");
    reason(
      candidate.reason,
      [...FIT_REASONS, ...VERTEX_REASONS, "fold_unstable"],
      "candidate.reason",
    );
  } else {
    const concentration = number(candidate.concentration, "candidate.concentration");
    number(candidate.predicted_yield, "candidate.predicted_yield");
    const range = array(
      candidate.leave_one_out_vertex_range,
      "candidate.leave_one_out_vertex_range",
    );
    if (
      candidate.reason !== null ||
      !regression.available ||
      !regression.loocvAvailable ||
      regression.vertices.length !== 4 ||
      regression.a === null ||
      regression.a >= 0 ||
      concentration <= 0 ||
      concentration >= 4
    )
      invalid("candidate");
    same(
      range,
      [Math.min(...regression.vertices), Math.max(...regression.vertices)],
      "candidate.leave_one_out_vertex_range",
    );
  }
  same(result.limitations, LIMITATIONS, "limitations");
  return result as JsonObject;
}
