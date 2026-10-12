import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RepositoryCorruptionError } from "../src/domain/repositories.js";
import type {
  AnalysisRun,
  AnalysisRunStateUpdate,
  PersistExperimentCommand,
} from "../src/domain/types.js";
import { runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
import { machineIdentity } from "../src/shared/provenance-contract.js";

type JsonObjectType = PersistExperimentCommand["metadata"];

const CREATED_AT = "2026-08-20T00:00:00.000Z";
const RUN_AT = "2026-08-20T03:00:00.000Z";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  runMigrations(db);
  return db;
}

function seedUser(
  db: DatabaseSync,
  id: string,
  role: "student" | "teacher" = "student",
  name = id,
): void {
  db.prepare(
    `INSERT INTO users(
      id,role,username,password_hash,default_password,name,class_name,group_name,
      status,data_json,created_at,updated_at
    ) VALUES(?,?,?,'scrypt$test',0,?,'Class A','Group A','active','{}',?,NULL)`,
  ).run(id, role, id, name, CREATED_AT);
}

function command(overrides: Partial<PersistExperimentCommand> = {}): PersistExperimentCommand {
  return {
    id: "record-a",
    student_name: "Student A",
    class_name: "Class A",
    group_name: "Group A",
    nh4cl_concentration: 3,
    peel_mass: 100,
    oil_mass: 1,
    distillation_time: 45,
    phase_clarity_score: 4,
    emulsification_level: "light",
    emulsion_concentration: 20,
    ecoli_observation_group: "oil",
    inhibition_zone_diameter: 10,
    colony_growth_score: 3,
    异常标记: false,
    error_source: "",
    note: "2A.7 JSON/identity contract",
    experiment_date: "2026-08-20",
    petri_diameter_mm: 90,
    measurement_method: "manual_direct",
    created_by: "Student A",
    created_by_user_id: "user-a",
    created_at: CREATED_AT,
    synced_from_offline: false,
    ai_diagnosis: "",
    metadata: {},
    ...overrides,
  };
}

function analysisRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: "run-a",
    dataset_hash: "sha256:dataset-a",
    algorithm_version: "algorithm-a",
    configuration: {},
    code_version: "code-a",
    status: "pending",
    results_metadata: {},
    created_at: RUN_AT,
    ...overrides,
  };
}

function seeded(): { db: DatabaseSync; store: SqliteProvenanceStore } {
  const db = database();
  seedUser(db, "user-a", "student", "Student A");
  seedUser(db, "teacher-a", "teacher", "Teacher A");
  const store = new SqliteProvenanceStore(db, { now: () => RUN_AT });
  store.add(command());
  return { db, store };
}

function createRun(store: SqliteProvenanceStore, overrides: Partial<AnalysisRun> = {}): void {
  store.createAnalysisRun(analysisRun(overrides), [
    { record_id: "record-a", input_hash: `sha256:${overrides.id ?? "run-a"}` },
  ]);
}

function asJsonObject(value: unknown): JsonObjectType {
  return value as JsonObjectType;
}

function assertMetadataRejected(value: unknown): void {
  const db = database();
  try {
    seedUser(db, "user-a", "student", "Student A");
    const store = new SqliteProvenanceStore(db, { now: () => RUN_AT });
    assert.throws(() => store.add(command({ metadata: asJsonObject(value) })));
    const count = db.prepare("SELECT COUNT(*) AS count FROM experiment_records").get() as {
      count: number;
    };
    assert.equal(count.count, 0, "invalid metadata must fail atomically");
  } finally {
    db.close();
  }
}

function assertConfigurationRejected(value: unknown): void {
  const { db, store } = seeded();
  try {
    assert.throws(() =>
      createRun(store, {
        configuration: asJsonObject(value),
      }),
    );
    const count = db.prepare("SELECT COUNT(*) AS count FROM analysis_runs").get() as {
      count: number;
    };
    assert.equal(count.count, 0, "invalid configuration must fail atomically");
  } finally {
    db.close();
  }
}

function assertResultsRejected(value: unknown): void {
  const { db, store } = seeded();
  try {
    createRun(store);
    assert.throws(() =>
      store.updateAnalysisRunState("run-a", {
        status: "completed",
        results_metadata: asJsonObject(value),
      }),
    );
    const row = db
      .prepare(
        "SELECT status,results_metadata_json,completed_at FROM analysis_runs WHERE id='run-a'",
      )
      .get() as { status: string; results_metadata_json: string; completed_at: string | null };
    assert.deepEqual(
      { ...row },
      { status: "pending", results_metadata_json: "{}", completed_at: null },
      "invalid results must not advance or mutate the run",
    );
  } finally {
    db.close();
  }
}

function sparseArray(): unknown[] {
  const value = new Array<unknown>(2);
  value[1] = "present";
  return value;
}

function rawRun(db: DatabaseSync, values: Partial<AnalysisRun> = {}): void {
  const value = analysisRun(values);
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_by_user_id,created_at,completed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    value.id,
    value.dataset_hash,
    value.algorithm_version,
    JSON.stringify(value.configuration),
    value.code_version,
    value.status,
    JSON.stringify(value.results_metadata),
    value.created_by_user_id ?? null,
    value.created_at,
    value.completed_at ?? null,
  );
}

function exactRecordSnapshot(
  db: DatabaseSync,
  store: SqliteProvenanceStore,
  id: string,
): Record<string, unknown> {
  createRun(store, { id: `snapshot-${id}` });
  const row = db
    .prepare("SELECT record_snapshot_json FROM analysis_inputs WHERE analysis_run_id=?")
    .get(`snapshot-${id}`) as { record_snapshot_json: string };
  return JSON.parse(row.record_snapshot_json) as Record<string, unknown>;
}

function dropTableTriggers(db: DatabaseSync, table: string): void {
  const triggers = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name=?")
    .all(table) as unknown as Array<{ name: string }>;
  for (const trigger of triggers) {
    const quoted = trigger.name.replaceAll('"', '""');
    db.exec(`DROP TRIGGER "${quoted}"`);
  }
}

function cloneRecord(db: DatabaseSync, id: string, clientSubmissionId: string | null = null): void {
  const columns = db.prepare("PRAGMA table_info(experiment_records)").all() as unknown as Array<{
    name: string;
  }>;
  const parameters: Array<string | null> = [];
  const quotedColumns = columns.map(({ name }) => `"${name.replaceAll('"', '""')}"`);
  const selections = columns.map(({ name }) => {
    if (name === "id") {
      parameters.push(id);
      return "?";
    }
    if (name === "client_submission_id") {
      parameters.push(clientSubmissionId);
      return "?";
    }
    if (name === "idempotency_scope_class_id")
      return clientSubmissionId === null ? "NULL" : "class_id";
    if (name === "synced_from_offline") return clientSubmissionId === null ? "0" : "1";
    return `"${name.replaceAll('"', '""')}"`;
  });
  parameters.push("record-a");
  db.prepare(
    `INSERT INTO experiment_records(${quotedColumns.join(",")})
     SELECT ${selections.join(",")} FROM experiment_records WHERE id=?`,
  ).run(...parameters);
}

function rawOmittedInput(
  db: DatabaseSync,
  store: SqliteProvenanceStore,
  runId: string,
  reason: string,
  inputHash = "sha256:omitted",
): void {
  const record = exactRecordSnapshot(db, store, runId);
  rawRun(db, { id: runId });
  db.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,
      record_snapshot_json,review_snapshot_json,snapshot_schema,
      review_binding_mode,review_omission_reason
    ) VALUES(?,0,'record-a',NULL,?,?,NULL,'echoclass.analysis-input.v1','omit',?)`,
  ).run(runId, inputHash, JSON.stringify(record), reason);
}

function appendEffectiveReview(store: SqliteProvenanceStore): void {
  const reviewed = store.appendReview({
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "accepted",
    reviewed_by: "Teacher A",
  });
  assert.ok(reviewed);
}

test("undefined nested experiment metadata is rejected without persistence", () => {
  assertMetadataRejected({ nested: { silentlyLost: undefined } });
});

for (const [name, value] of [
  ["NaN", Number.NaN],
  ["positive Infinity", Number.POSITIVE_INFINITY],
  ["negative Infinity", Number.NEGATIVE_INFINITY],
] as const) {
  test(`${name} is rejected recursively in experiment metadata`, () => {
    assertMetadataRejected({ nested: { value } });
  });

  test(`${name} is rejected recursively in analysis configuration`, () => {
    assertConfigurationRejected({ nested: { value } });
  });

  test(`${name} is rejected recursively in analysis results`, () => {
    assertResultsRejected({ nested: { value } });
  });
}

test("sparse arrays are rejected in experiment metadata", () => {
  assertMetadataRejected({ values: sparseArray() });
});

test("sparse arrays are rejected in analysis configuration", () => {
  assertConfigurationRejected({ values: sparseArray() });
});

test("sparse arrays are rejected in analysis results", () => {
  assertResultsRejected({ values: sparseArray() });
});

test("negative zero is rejected because JSON serialization changes it", () => {
  assertMetadataRejected({ nested: -0 });
  assertConfigurationRejected({ nested: -0 });
  assertResultsRejected({ nested: -0 });
});

test("lossy function, symbol and symbol-keyed metadata are rejected", () => {
  assertMetadataRejected({ lost: () => "value" });
  assertMetadataRejected({ lost: Symbol("value") });
  const symbolKeyed = { retained: true } as Record<PropertyKey, unknown>;
  symbolKeyed[Symbol("lost-key")] = "lost-value";
  assertMetadataRejected(symbolKeyed);
});

test("non-plain and serialization-transforming objects are rejected", () => {
  assertConfigurationRejected({ date: new Date(CREATED_AT) });
  assertResultsRejected({ map: new Map([["key", "value"]]) });
  assertMetadataRejected({ changing: { value: 1, toJSON: () => ({ value: 2 }) } });
  const hidden = {};
  Object.defineProperty(hidden, "lost", { value: "hidden", enumerable: false });
  assertMetadataRejected(hidden);
});

test("cyclic values and BigInt are rejected atomically", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assertMetadataRejected(cyclic);
  assertConfigurationRejected({ value: 1n });
});

test("dense recursive JSON values persist and round-trip without semantic changes", () => {
  const db = database();
  try {
    seedUser(db, "user-a", "student", "Student A");
    const store = new SqliteProvenanceStore(db, { now: () => RUN_AT });
    const metadata = {
      nested: [null, true, "text", 1.5, { deeper: [false, 2] }],
    };
    store.add(command({ metadata: asJsonObject(metadata) }));
    assert.deepEqual(store.findById("record-a")?.metadata, metadata);

    const configuration = { stages: [{ name: "prepare", enabled: true }], alpha: 0.05 };
    const results = { groups: [{ name: "A", values: [1, 2, 3] }], complete: true };
    createRun(store, { configuration: asJsonObject(configuration) });
    store.updateAnalysisRunState("run-a", {
      status: "completed",
      results_metadata: asJsonObject(results),
    });
    assert.deepEqual(store.findAnalysisRun("run-a")?.configuration, configuration);
    assert.deepEqual(store.findAnalysisRun("run-a")?.results_metadata, results);
  } finally {
    db.close();
  }
});

for (const [column, storedColumn] of [["record metadata", "metadata_json"]] as const) {
  test(`database reads fail closed on recursively invalid ${column}`, () => {
    const { db, store } = seeded();
    try {
      dropTableTriggers(db, "experiment_records");
      db.prepare(`UPDATE experiment_records SET ${storedColumn}=? WHERE id='record-a'`).run(
        '{"nested":1e400}',
      );
      assert.throws(() => store.findById("record-a"), RepositoryCorruptionError);
    } finally {
      db.close();
    }
  });
}

for (const column of ["configuration_json", "results_metadata_json"] as const) {
  test(`analysis reads fail closed on recursively invalid ${column}`, () => {
    const { db, store } = seeded();
    try {
      createRun(store);
      dropTableTriggers(db, "analysis_runs");
      db.prepare(`UPDATE analysis_runs SET ${column}=? WHERE id='run-a'`).run('{"nested":1e400}');
      assert.throws(() => store.findAnalysisRun("run-a"), RepositoryCorruptionError);
    } finally {
      db.close();
    }
  });
}

for (const [name, identity] of [
  ["NUL", "\u0000"],
  ["embedded NUL", "A\u0000B"],
  ["NBSP", "\u00a0"],
  ["Unicode NEL whitespace", "\u0085"],
  ["non-ASCII printable text", "é"],
  ["embedded ASCII space", "run id"],
] as const) {
  test(`${name} is rejected by the TypeScript machine-identifier contract`, () => {
    assert.throws(() => machineIdentity(identity, "test identity"));
  });

  test(`${name} is rejected by the SQLite machine-identifier contract`, () => {
    const db = database();
    try {
      assert.throws(() => rawRun(db, { id: identity }));
    } finally {
      db.close();
    }
  });
}

for (const field of ["id", "dataset_hash", "algorithm_version", "code_version"] as const) {
  test(`SQLite rejects NBSP-only analysis ${field}`, () => {
    const db = database();
    try {
      assert.throws(() => rawRun(db, { [field]: "\u00a0" }));
    } finally {
      db.close();
    }
  });
}

test("SQLite rejects NBSP-only record and client-submission identifiers", () => {
  const { db } = seeded();
  try {
    assert.throws(() => cloneRecord(db, "\u00a0"));
    assert.throws(() => cloneRecord(db, "record-offline", "\u00a0"));
  } finally {
    db.close();
  }
});

test("SQLite rejects an NBSP-only review identifier", () => {
  const { db } = seeded();
  try {
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO record_reviews(
            id,record_id,reviewer_user_id,reviewer_label,decision,reason,
            decided_at,created_at,provenance_kind
          ) VALUES(?,'record-a','teacher-a','Teacher A','included','accepted',?,?, 'human')`,
        )
        .run("\u00a0", RUN_AT, RUN_AT),
    );
  } finally {
    db.close();
  }
});

test("SQLite rejects an NBSP-only analysis input hash", () => {
  const { db, store } = seeded();
  try {
    const record = exactRecordSnapshot(db, store, "input-hash");
    rawRun(db, { id: "raw-input-run" });
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO analysis_inputs(
            analysis_run_id,ordinal,record_id,review_id,input_hash,
            record_snapshot_json,review_snapshot_json,snapshot_schema,
            review_binding_mode,review_omission_reason
          ) VALUES('raw-input-run',0,'record-a',NULL,?,?,NULL,
            'echoclass.analysis-input.v1','none',NULL)`,
        )
        .run("\u00a0", JSON.stringify(record)),
    );
  } finally {
    db.close();
  }
});

test("visible ASCII machine-identifier boundary characters are accepted consistently", () => {
  assert.equal(machineIdentity("!visible~", "test identity"), "!visible~");
  const { db, store } = seeded();
  try {
    cloneRecord(db, "!record~", "!client:._-~");
    const record = exactRecordSnapshot(db, store, "visible-ascii");
    rawRun(db, {
      id: "!run~",
      dataset_hash: "!hash:~",
      algorithm_version: "!algorithm/~",
      code_version: "!code+~",
    });
    db.prepare(
      `INSERT INTO analysis_inputs(
        analysis_run_id,ordinal,record_id,review_id,input_hash,
        record_snapshot_json,review_snapshot_json,snapshot_schema,
        review_binding_mode,review_omission_reason
      ) VALUES('!run~',0,'record-a',NULL,?,?,NULL,
        'echoclass.analysis-input.v1','none',NULL)`,
    ).run("!input:~", JSON.stringify(record));
  } finally {
    db.close();
  }
});

test("effective binding reads reject any non-null omission reason", () => {
  const { db, store } = seeded();
  try {
    appendEffectiveReview(store);
    createRun(store, { id: "effective-reason-corruption" });
    dropTableTriggers(db, "analysis_inputs");
    db.exec(
      "UPDATE analysis_inputs SET review_omission_reason='' WHERE analysis_run_id='effective-reason-corruption'",
    );
    assert.throws(
      () => store.listAnalysisInputs("effective-reason-corruption"),
      RepositoryCorruptionError,
    );
  } finally {
    db.close();
  }
});

for (const [name, id, reason] of [
  ["NUL", "nul", "\u0000"],
  ["NBSP", "nbsp", "\u00a0"],
  ["mixed Unicode whitespace", "mixed", "\t\u0085\u00a0\u2003\u3000\ufeff"],
] as const) {
  test(`${name}-only omission reason is rejected at the TypeScript boundary`, () => {
    const { db, store } = seeded();
    try {
      appendEffectiveReview(store);
      assert.throws(() =>
        store.createAnalysisRun(analysisRun(), [
          {
            record_id: "record-a",
            input_hash: "sha256:omit",
            review_mode: "omit",
            review_omission_reason: reason,
          },
        ]),
      );
    } finally {
      db.close();
    }
  });

  test(`${name}-only omission reason is rejected at the SQLite boundary`, () => {
    const { db, store } = seeded();
    try {
      appendEffectiveReview(store);
      assert.throws(() => rawOmittedInput(db, store, `raw-omit-${id}`, reason));
    } finally {
      db.close();
    }
  });
}

test("omission-reason reads fail closed on Unicode-whitespace-only corruption", () => {
  const { db, store } = seeded();
  try {
    appendEffectiveReview(store);
    store.createAnalysisRun(analysisRun(), [
      {
        record_id: "record-a",
        input_hash: "sha256:omit",
        review_mode: "omit",
        review_omission_reason: "documented sensitivity analysis",
      },
    ]);
    dropTableTriggers(db, "analysis_inputs");
    db.prepare(
      "UPDATE analysis_inputs SET review_omission_reason=? WHERE analysis_run_id='run-a'",
    ).run("\u00a0");
    assert.throws(() => store.listAnalysisInputs("run-a"), RepositoryCorruptionError);
  } finally {
    db.close();
  }
});

test("nonblank Unicode omission reasons remain valid", () => {
  const { db, store } = seeded();
  try {
    appendEffectiveReview(store);
    store.createAnalysisRun(analysisRun(), [
      {
        record_id: "record-a",
        input_hash: "sha256:omit",
        review_mode: "omit",
        review_omission_reason: "为敏感性分析省略教师结论",
      },
    ]);
    assert.equal(
      store.listAnalysisInputs("run-a")[0]?.review_omission_reason,
      "为敏感性分析省略教师结论",
    );
  } finally {
    db.close();
  }
});

// Compile-time guard: terminal updates continue to use the public typed command shape.
const _analysisRunStateUpdateContract: AnalysisRunStateUpdate = {
  status: "completed",
  results_metadata: {},
};
void _analysisRunStateUpdateContract;
