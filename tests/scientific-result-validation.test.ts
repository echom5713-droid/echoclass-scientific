import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "../src/shared/json-safe.js";
import {
  canonicalHash,
  canonicalize,
  hashCanonicalBytes,
} from "../src/domain/scientific/canonical.js";
import { scientificSettings, type ScientificEnvelope } from "../src/domain/scientific/contract.js";
import { validateScientificResult } from "../src/domain/scientific/result-validation.js";

const concentrations = [0, 1, 3, 4];
const statisticNames = [
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
];
const missing = (reason: string) => ({ value: null, reason });
const measured = (value: number) => ({ value, reason: null });
const digest = `sha256:${"1".repeat(64)}`;

function fixture(approved = false): { envelope: ScientificEnvelope; result: JsonObject } {
  const statuses = approved
    ? ["included", "included", "included", "included"]
    : ["normal", "review", "excluded", "review"];
  const yields = [4, 7, 7, 4];
  const inputs = concentrations.map((concentration, ordinal) => {
    const id = `synthetic-record-${ordinal}`;
    const status = statuses[ordinal]!;
    const hasReview = approved || ordinal === 2 || ordinal === 3;
    const review = hasReview
      ? {
          id: `synthetic-review-${ordinal}`,
          record_id: id,
          status,
          note: "Synthetic fixture",
          reviewed_by: "Synthetic teacher",
          reviewer_user_id: "synthetic-teacher",
          created_at: "2026-09-05T00:00:00.000Z",
          reviewed_at: "2026-09-05T00:00:00.000Z",
          provenance_kind: "human",
          event_sequence: ordinal + 1,
        }
      : null;
    const snapshot = {
      id,
      student_name: "Synthetic student",
      class_id: "synthetic-class",
      class_name: "Synthetic class",
      group_name: "",
      nh4cl_concentration: concentration,
      peel_mass: 100,
      oil_mass: yields[ordinal],
      yield_percent: yields[ordinal],
      distillation_time: 30,
      phase_clarity_score: 3,
      emulsification_level: "无",
      emulsion_concentration: 1,
      ecoli_observation_group: "实验组",
      inhibition_zone_diameter: 0,
      colony_growth_score: 0,
      error_source: "",
      note: "Synthetic fixture",
      status: "active",
      created_at: "2026-09-05T00:00:00.000Z",
      updated_at: "2026-09-05T00:00:00.000Z",
      created_by: "Synthetic teacher",
      created_by_user_id: "synthetic-teacher",
      synced_from_offline: false,
      异常标记: false,
      review_status: status,
      review_note: review?.note ?? "",
      reviewed_by: review?.reviewed_by ?? "",
      reviewed_at: review?.reviewed_at ?? "",
      ai_diagnosis: "",
      measurement_method: "not_recorded",
      metadata: { synthetic: true },
      ...(review ? { effective_review_id: review.id } : {}),
    };
    const input = {
      schema: "echoclass.scientific-input.v1",
      snapshot_schema: "echoclass.analysis-input.v1",
      record_snapshot: snapshot,
      review_snapshot: review,
      review_binding_mode: hasReview ? "effective" : "none",
      review_omission_reason: null,
    };
    const canonical_json = canonicalize(input);
    return { input_hash: hashCanonicalBytes(canonical_json), canonical_json };
  });
  const dataset = {
    schema: "echoclass.scientific-dataset.v1",
    class_id: "synthetic-class",
    entries: inputs.map((input, ordinal) => ({
      ordinal,
      record_id: `synthetic-record-${ordinal}`,
      input_hash: input.input_hash,
    })),
  };
  const dataset_canonical_json = canonicalize(dataset);
  const dataset_hash = hashCanonicalBytes(dataset_canonical_json);
  const settings = scientificSettings();
  const configuration = {
    ...settings,
    seed_hex: canonicalHash({
      schema: "echoclass.scientific-seed.v1",
      dataset_hash,
      settings_without_seed: settings,
    }).slice(7, 39),
  };
  const execution = {
    schema: "echoclass.scientific-execution.v1",
    dataset_hash,
    configuration,
    algorithm_version: "echoclass.yield-analysis.v1",
    code_version: digest,
    node_code_version: digest,
    environment_fingerprint: digest,
  };
  const execution_canonical_json = canonicalize(execution);
  const execution_fingerprint = hashCanonicalBytes(execution_canonical_json);
  const envelope: ScientificEnvelope = {
    schema: "echoclass.scientific-envelope.v1",
    canonical_inputs: inputs,
    dataset_hash,
    dataset_canonical_json,
    execution_fingerprint,
    execution_canonical_json,
  };
  const result: JsonObject = {
    schema: "echoclass.scientific-result.v1",
    dataset_hash,
    execution_fingerprint,
    algorithm_version: "echoclass.yield-analysis.v1",
    configuration,
    selection: {
      candidate_count: 4,
      included_count: approved ? 4 : 0,
      excluded_count: approved ? 0 : 4,
      records: inputs.map((input, ordinal) => {
        const parsed = JSON.parse(input.canonical_json) as { review_binding_mode: string };
        return {
          ordinal,
          record_id: `synthetic-record-${ordinal}`,
          review_binding_mode: parsed.review_binding_mode,
          review_status: statuses[ordinal]!,
          included: approved,
          reason: approved ? null : ordinal === 2 ? "review_excluded" : "not_approved",
        };
      }),
    },
    groups: concentrations.map((concentration, ordinal) => ({
      concentration,
      n: approved ? 1 : 0,
      record_ids: approved ? [`synthetic-record-${ordinal}`] : [],
      statistics: Object.fromEntries(
        statisticNames.map((name) => [
          name,
          !approved
            ? missing("no_approved_records")
            : name === "sd"
              ? missing("insufficient_replicates")
              : measured(["iqr", "mad", "mad_normal"].includes(name) ? 0 : yields[ordinal]!),
        ]),
      ),
      ci: {
        confidence_level: 0.95,
        method: "percentile",
        resamples: 10000,
        lower: null,
        upper: null,
        reason: approved ? "insufficient_replicates" : "no_approved_records",
      },
      iqr_flags: {
        record_ids: [],
        reason: approved ? "insufficient_replicates" : "no_approved_records",
      },
    })),
    regression: {
      available: approved,
      reason: approved ? null : "insufficient_groups",
      n_groups: approved ? 4 : 0,
      residual_df: approved ? 1 : null,
      coefficients: approved ? { a: -1, b: 4, c: 4 } : null,
      rank: approved ? 3 : null,
      condition_number: approved ? 2 : null,
      saturated: false,
      training_r_squared: approved ? measured(1) : missing("insufficient_groups"),
      training_rmse: approved ? measured(0) : missing("insufficient_groups"),
      loocv: {
        available: approved,
        reason: approved ? null : "insufficient_groups",
        rmse: approved ? measured(0) : missing("insufficient_groups"),
        folds: approved
          ? concentrations.map((concentration, index) => ({
              held_out_concentration: concentration,
              observed_mean: yields[index]!,
              predicted_mean: yields[index]!,
              residual: 0,
              extrapolation: concentration === 0 || concentration === 4,
              vertex: 2,
              vertex_reason: null,
            }))
          : [],
      },
    },
    best_tested: {
      concentrations: approved ? [1, 3] : [],
      mean: approved ? 7 : null,
      reason: approved ? null : "no_approved_records",
    },
    candidate: {
      concentration: approved ? 2 : null,
      predicted_yield: approved ? 8 : null,
      leave_one_out_vertex_range: approved ? [2, 2] : null,
      reason: approved ? null : "insufficient_groups",
    },
    limitations: [
      "exploratory_analysis",
      "record_independence_unverified",
      "bootstrap_assumes_independent_records",
      "four_concentration_model",
      "candidate_requires_new_experiment",
    ],
  };
  return { envelope, result };
}

function at(result: JsonObject, ...path: Array<string | number>): JsonObject {
  let value: unknown = result;
  for (const key of path) value = (value as Record<string | number, unknown>)[key];
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

test("complete unavailable report preserves all sealed candidates, review decisions and four groups", () => {
  const { envelope, result } = fixture();
  assert.deepEqual(validateScientificResult(result, envelope), result);
});

test("complete fitted report validates explicit metrics, folds, ties and interior candidate", () => {
  const { envelope, result } = fixture(true);
  assert.deepEqual(validateScientificResult(result, envelope), result);
});

test("output negative zero normalizes without changing input objects or the legacy JSON contract", () => {
  const { envelope, result } = fixture(true);
  at(result, "regression", "training_rmse").value = -0;
  const normalized = validateScientificResult(result, envelope);
  assert.equal(Object.is(at(normalized, "regression", "training_rmse").value, -0), false);
  assert.equal(Object.is(at(result, "regression", "training_rmse").value, -0), true);
});

test("unknown or missing fields at every result branch are rejected", () => {
  for (const path of [
    [],
    ["selection"],
    ["selection", "records", 0],
    ["groups", 0],
    ["groups", 0, "statistics"],
    ["groups", 0, "statistics", "mean"],
    ["groups", 0, "ci"],
    ["groups", 0, "iqr_flags"],
    ["regression"],
    ["regression", "coefficients"],
    ["regression", "loocv"],
    ["regression", "loocv", "folds", 0],
    ["best_tested"],
    ["candidate"],
  ] as Array<Array<string | number>>) {
    const f = fixture(true);
    at(f.result, ...path).unexpected = "worker payload";
    assert.throws(
      () => validateScientificResult(f.result, f.envelope),
      /Invalid scientific result/,
    );
    delete at(f.result, ...path).unexpected;
    delete at(f.result, ...path)[Object.keys(at(f.result, ...path))[0]!];
    assert.throws(
      () => validateScientificResult(f.result, f.envelope),
      /Invalid scientific result/,
    );
  }
});

test("nonfinite and coerced numbers, booleans and null-reason contradictions are rejected", () => {
  for (const value of [NaN, Infinity, -Infinity, "7", true, null]) {
    const f = fixture(true);
    at(f.result, "groups", 0, "statistics", "mean").value = value;
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
  for (const value of [1, "true", null]) {
    const f = fixture(true);
    at(f.result, "regression").available = value;
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
  for (const value of [null, "", "raw traceback"]) {
    const f = fixture();
    at(f.result, "groups", 0, "statistics", "mean").reason = value;
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
  const f = fixture(true);
  at(f.result, "groups", 0, "statistics", "mean").reason = "numeric_unavailable";
  assert.throws(() => validateScientificResult(f.result, f.envelope));
});

test("scientific identity, frozen settings and sealed input bytes cannot be changed", () => {
  for (const field of ["schema", "dataset_hash", "execution_fingerprint", "algorithm_version"]) {
    const f = fixture();
    f.result[field] = "changed";
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
  for (const field of ["seed_hex", "bootstrap_resamples", "selection_policy"]) {
    const f = fixture();
    at(f.result, "configuration")[field] = "changed";
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
  for (const field of ["dataset_canonical_json", "execution_canonical_json"] as const) {
    const f = fixture();
    f.envelope[field] += " ";
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
  const f = fixture();
  f.envelope.canonical_inputs[0]!.canonical_json =
    f.envelope.canonical_inputs[0]!.canonical_json.replace(
      '"yield_percent":4',
      '"yield_percent":5',
    );
  assert.throws(() => validateScientificResult(f.result, f.envelope));
});

test("selection requires exact candidate order, strict counts and approved-only decisions", () => {
  const mutations: Array<(result: JsonObject) => void> = [
    (result) => {
      at(result, "selection").candidate_count = 3;
    },
    (result) => {
      at(result, "selection").included_count = "0";
    },
    (result) => {
      at(result, "selection").excluded_count = -1;
    },
    (result) => {
      at(result, "selection", "records", 0).included = true;
    },
    (result) => {
      at(result, "selection", "records", 2).reason = "not_approved";
    },
    (result) => {
      at(result, "selection", "records", 0).review_binding_mode = "effective";
    },
    (result) => {
      at(result, "selection", "records", 0).record_id = "synthetic-record-1";
    },
    (result) => {
      (at(result, "selection").records as unknown[]).reverse();
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.result);
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
});

test("groups cannot omit or duplicate approved membership or move IDs across concentrations", () => {
  const mutations: Array<(result: JsonObject) => void> = [
    (result) => {
      at(result, "groups", 0).n = 2;
    },
    (result) => {
      at(result, "groups", 0).record_ids = [];
    },
    (result) => {
      at(result, "groups", 0).record_ids = ["synthetic-record-1"];
    },
    (result) => {
      at(result, "groups", 0).record_ids = ["synthetic-record-0", "synthetic-record-0"];
    },
    (result) => {
      (result.groups as unknown[]).reverse();
    },
    (result) => {
      at(result, "groups", 0, "iqr_flags").record_ids = ["synthetic-record-0"];
    },
  ];
  for (const mutate of mutations) {
    const f = fixture(true);
    mutate(f.result);
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
});

test("small-group statistic and CI availability cannot manufacture observations", () => {
  const f = fixture();
  at(f.result, "groups", 0, "statistics").mean = measured(0);
  assert.throws(() => validateScientificResult(f.result, f.envelope));
  const g = fixture(true);
  at(g.result, "groups", 0, "statistics").sd = measured(0);
  assert.throws(() => validateScientificResult(g.result, g.envelope));
  const h = fixture(true);
  Object.assign(at(h.result, "groups", 0, "ci"), { lower: 4, upper: 4, reason: null });
  assert.throws(() => validateScientificResult(h.result, h.envelope));
});

test("regression shape and all four folds must agree with available concentration means", () => {
  const mutations: Array<(result: JsonObject) => void> = [
    (result) => {
      at(result, "regression").n_groups = 3;
    },
    (result) => {
      at(result, "regression").rank = 2;
    },
    (result) => {
      at(result, "regression").residual_df = 0;
    },
    (result) => {
      at(result, "regression").saturated = true;
    },
    (result) => {
      at(result, "regression", "training_rmse").value = -1;
    },
    (result) => {
      (at(result, "regression", "loocv").folds as unknown[]).pop();
    },
    (result) => {
      at(result, "regression", "loocv", "folds", 0).extrapolation = false;
    },
    (result) => {
      at(result, "regression", "loocv", "folds", 0).observed_mean = 3;
    },
    (result) => {
      at(result, "regression", "loocv", "folds", 0).vertex = null;
    },
  ];
  for (const mutate of mutations) {
    const f = fixture(true);
    mutate(f.result);
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
});

test("candidate nullability, concavity and vertex sensitivity range are mandatory", () => {
  const mutations: Array<(result: JsonObject) => void> = [
    (result) => {
      at(result, "candidate").predicted_yield = null;
    },
    (result) => {
      at(result, "candidate").concentration = 4;
    },
    (result) => {
      at(result, "candidate").leave_one_out_vertex_range = [1, 3];
    },
    (result) => {
      at(result, "regression", "coefficients").a = 1;
    },
    (result) => {
      at(result, "regression", "loocv", "folds", 0).vertex = 0;
    },
    (result) => {
      at(result, "best_tested").concentrations = [3, 1];
    },
    (result) => {
      at(result, "best_tested").mean = null;
    },
    (result) => {
      (result.limitations as unknown[]).reverse();
    },
  ];
  for (const mutate of mutations) {
    const f = fixture(true);
    mutate(f.result);
    assert.throws(() => validateScientificResult(f.result, f.envelope));
  }
});

test("objects cannot hide executable accessors, sparse arrays or unsupported JSON values", () => {
  const f = fixture();
  let read = false;
  Object.defineProperty(f.result, "extra", {
    enumerable: true,
    get() {
      read = true;
      return 1;
    },
  });
  assert.throws(() => validateScientificResult(f.result, f.envelope));
  assert.equal(read, false);
  const g = fixture();
  Reflect.deleteProperty(g.result.groups as unknown[], "0");
  assert.throws(() => validateScientificResult(g.result, g.envelope));
  const h = fixture();
  at(h.result, "candidate").reason = "\ud800";
  assert.throws(() => validateScientificResult(h.result, h.envelope));
});
