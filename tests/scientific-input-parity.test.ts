import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateExperiment } from "../src/domain/experiments/validation.js";
import type { ExperimentRecord } from "../src/domain/types.js";
import {
  validateRecordSnapshotV1,
  validateRecordSnapshotV1Strict,
  validateScientificRecordSnapshot,
} from "../src/infrastructure/database/analysis-snapshot-v1.js";
import { csvBytes, csvFixture, syntheticCells } from "./csv-test-helpers.js";

const envelope = JSON.parse(
  readFileSync("tests/fixtures/scientific/synthetic-envelope.json", "utf8"),
) as { canonical_inputs: Array<{ canonical_json: string }> };
const baseline = (
  JSON.parse(envelope.canonical_inputs[0]!.canonical_json) as { record_snapshot: ExperimentRecord }
).record_snapshot;

test("released snapshot validators preserve their historical year-zero and whitespace acceptance", () => {
  for (const validator of [validateRecordSnapshotV1, validateRecordSnapshotV1Strict]) {
    for (const patch of [
      { experiment_date: "0000-01-01" },
      { student_name: "\u0085" },
      { class_name: "\u001c" },
      { created_by: "\u0085" },
    ]) {
      const snapshot = { ...baseline, ...patch };
      assert.doesNotThrow(() => validator(snapshot), JSON.stringify(patch));
      assert.deepEqual(validator(snapshot), snapshot);
    }
    // JavaScript trim rejected these before the cross-language alignment.
    assert.throws(() => validator({ ...baseline, created_by: "\ufeff" }), /record snapshot/);
    assert.throws(() => validator({ ...baseline, student_name: " \t" }), /record snapshot/);
  }
});

test("new analysis capture rolls back unsupported legacy values while preserving rows and old seals", () => {
  for (const [field, value] of [
    ["experiment_date", "0000-01-01"],
    ["student_name", "\u0085"],
  ] as const) {
    const fixture = csvFixture();
    try {
      fixture.submit(csvBytes([syntheticCells, syntheticCells]));
      const records = fixture.store.findAll();
      assert.equal(records.length, 2);
      const selections = records.map((record, ordinal) => ({
        record_id: record.id,
        input_hash: `synthetic-input-${ordinal}`,
      }));
      const command = (id: string) => ({
        id,
        dataset_hash: "synthetic-dataset",
        algorithm_version: "none",
        code_version: "synthetic-test",
        configuration: {},
      });
      fixture.store.createAnalysisRun(command("previous-valid-run"), selections);
      const previousInputs = fixture.store.listAnalysisInputs("previous-valid-run");
      // Model a value already admitted by a previous release, without changing its old seal.
      fixture.db
        .prepare(`UPDATE experiment_records SET ${field}=?, updated_at=? WHERE id=?`)
        .run(value, "2030-01-01T00:00:00.000Z", records[1]!.id);
      const stored = fixture.store.findById(records[1]!.id);
      const before = fixture.db.prepare("SELECT * FROM analysis_runs ORDER BY id").all();
      assert.throws(
        () => fixture.store.createAnalysisRun(command("rejected-new-run"), selections),
        /record snapshot scientific fields are invalid/,
      );
      assert.deepEqual(fixture.db.prepare("SELECT * FROM analysis_runs ORDER BY id").all(), before);
      assert.equal(
        fixture.db
          .prepare(
            "SELECT count(*) n FROM analysis_inputs WHERE analysis_run_id='rejected-new-run'",
          )
          .get()!.n,
        0,
      );
      assert.deepEqual(fixture.store.listAnalysisInputs("previous-valid-run"), previousInputs);
      assert.deepEqual(fixture.store.findById(records[1]!.id), stored);
    } finally {
      fixture.db.close();
    }
  }
});

interface Case {
  label: string;
  field: string;
  value: string;
  accepted: boolean;
}

// Invoke the actual strict Python snapshot model, not a second handwritten validator.
function pythonAcceptance(cases: Case[]): boolean[] {
  const result = spawnSync(
    process.env.ECHOCLASS_PYTHON || "python3",
    [
      "-c",
      `import json, sys
from echoclass_analytics.models import RecordSnapshot
answers = []
for record in json.load(sys.stdin):
    try:
        model = RecordSnapshot.model_validate(record)
        # Validation must preserve the supplied text rather than normalizing it.
        assert all(getattr(model, key) == value for key, value in record.items() if isinstance(value, str))
        answers.append(True)
    except ValueError:
        answers.append(False)
print(json.dumps(answers))`,
    ],
    {
      input: JSON.stringify(cases.map((item) => ({ ...baseline, [item.field]: item.value }))),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: path.resolve("analytics"),
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  assert.equal(result.status, 0, `strict Python snapshot checker failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as boolean[];
}

function verify(cases: Case[]): void {
  const python = pythonAcceptance(cases);
  for (const [index, item] of cases.entries()) {
    assert.equal(python[index], item.accepted, `${item.label}: Python acceptance`);
    const snapshot = { ...baseline, [item.field]: item.value };
    const original = structuredClone(snapshot);
    if (item.accepted)
      assert.doesNotThrow(() => validateScientificRecordSnapshot(snapshot), item.label);
    else
      assert.throws(
        () => validateScientificRecordSnapshot(snapshot),
        /record snapshot/,
        item.label,
      );
    if (item.field !== "created_by") {
      assert.equal(
        validateExperiment(snapshot).some((finding) => finding.field === item.field),
        !item.accepted,
        `${item.label}: prospective validation`,
      );
    }
    assert.deepEqual(snapshot, original, `${item.label}: original data stays unchanged`);
  }
}

test("Node and strict Python reject year zero and invalid dates while preserving supported years", () => {
  const invalid = ["0000-01-01", "0000-02-29", "1900-02-29", "2026-02-29", "2026-04-31"];
  const valid = [
    "0001-01-01",
    "0004-02-29",
    "1600-02-29",
    "2000-02-29",
    "2024-02-29",
    "9999-12-31",
  ];
  verify([
    ...invalid.map((value) => ({ label: value, field: "experiment_date", value, accepted: false })),
    ...valid.map((value) => ({ label: value, field: "experiment_date", value, accepted: true })),
  ]);
});

test("Node and strict Python reject whitespace-only scientific labels including Python-only whitespace", () => {
  const fields = [
    "student_name",
    "class_name",
    "emulsification_level",
    "ecoli_observation_group",
    "created_by",
  ];
  const blanks = [
    "\u0085",
    "",
    " \t\r\n",
    "\u001c",
    "\u001d",
    "\u001e",
    "\u001f",
    "\u0085 \u001c\u3000",
  ];
  verify(
    fields.flatMap((field) =>
      blanks.map((value) => ({
        label: `${field}=${JSON.stringify(value)}`,
        field,
        value,
        accepted: false,
      })),
    ),
  );
});

test("nonblank Unicode and embedded whitespace remain accepted and byte-preserved across languages", () => {
  const fields = [
    "student_name",
    "class_name",
    "emulsification_level",
    "ecoli_observation_group",
    "created_by",
  ];
  const values = [
    "王 小明",
    "é",
    "e\u0301",
    "化学🧪",
    "甲\u0085乙",
    "\u0085甲\u001c",
    "\ufeff甲\ufeff",
  ];
  verify(
    fields.flatMap((field) =>
      values.map((value) => ({
        label: `${field}=${JSON.stringify(value)}`,
        field,
        value,
        accepted: true,
      })),
    ),
  );
});

test("Node and strict Python reject FEFF-only and mixed-runtime whitespace without rewriting values", () => {
  const fields = [
    "student_name",
    "class_name",
    "emulsification_level",
    "ecoli_observation_group",
    "created_by",
  ];
  verify(
    fields.flatMap((field) =>
      ["\ufeff", "\ufeff\u0085\u001c"].map((value) => ({
        label: `${field}=${JSON.stringify(value)}`,
        field,
        value,
        accepted: false,
      })),
    ),
  );
});
