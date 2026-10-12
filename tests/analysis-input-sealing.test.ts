import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  AnalysisRun,
  ExperimentRecord,
  PersistExperimentCommand,
} from "../src/domain/types.js";
import { RepositoryCorruptionError } from "../src/domain/repositories.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function seedUser(db: DatabaseSync, id: string, role = "student", name = id): void {
  db.prepare(
    `INSERT INTO users(
      id,role,username,password_hash,default_password,name,class_name,group_name,
      status,data_json,created_at,updated_at
    ) VALUES(?,?,?,'scrypt$test',0,?,'Class A','Group A','active','{}',?,NULL)`,
  ).run(id, role, id, name, "2026-08-20T00:00:00.000Z");
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
    note: "2A.6",
    experiment_date: "2026-08-20",
    petri_diameter_mm: 90,
    measurement_method: "manual_direct",
    created_by: "Student A",
    created_by_user_id: "user-a",
    created_at: "2026-08-20T00:00:00.000Z",
    synced_from_offline: false,
    ai_diagnosis: "",
    metadata: {},
    ...overrides,
  };
}

function run(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: "run-a",
    dataset_hash: "sha256:dataset-a",
    algorithm_version: "algorithm-a",
    configuration: {},
    code_version: "code-a",
    status: "pending",
    results_metadata: {},
    created_at: "2026-08-20T03:00:00.000Z",
    ...overrides,
  };
}

function seeded(now = "2026-08-20T03:00:00.000Z") {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a", "student", "Student A");
  seedUser(db, "teacher-a", "teacher", "Teacher A");
  const store = new SqliteProvenanceStore(db, { now: () => now });
  store.add(command());
  return { db, store };
}

function createInputRun(store: SqliteProvenanceStore, id = "run-a"): void {
  store.createAnalysisRun(run({ id }), [{ record_id: "record-a", input_hash: `sha256:${id}` }]);
}

function prepareLateInput(store: SqliteProvenanceStore): void {
  store.add(
    command({
      id: "record-b",
      student_name: "Student B",
      created_by: "Student A",
      created_by_user_id: "user-a",
    }),
  );
  store.createAnalysisRun(run({ id: "late-source" }), [
    { record_id: "record-b", input_hash: "sha256:late-source" },
  ]);
}

function cloneInput(db: DatabaseSync, runId: string): void {
  db.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,
      record_snapshot_json,review_snapshot_json,snapshot_schema,
      review_binding_mode,review_omission_reason
    ) SELECT ?,1,record_id,review_id,input_hash||'-late',
      record_snapshot_json,review_snapshot_json,snapshot_schema,
      review_binding_mode,review_omission_reason
      FROM analysis_inputs WHERE analysis_run_id='late-source' AND ordinal=0`,
  ).run(runId);
}

test("ordinary run creation seals its complete input set atomically", () => {
  const { db, store } = seeded();
  createInputRun(store);
  const row = db.prepare("SELECT inputs_sealed FROM analysis_runs WHERE id='run-a'").get() as {
    inputs_sealed: number;
  };
  assert.equal(row.inputs_sealed, 1);
  assert.throws(() => db.exec("UPDATE analysis_runs SET inputs_sealed=0 WHERE id='run-a'"));
  db.close();
});

for (const status of ["running", "completed", "failed"] as const) {
  test(`${status} run rejects post-creation analysis inputs`, () => {
    const { db, store } = seeded("2026-08-20T04:00:00.000Z");
    createInputRun(store);
    prepareLateInput(store);
    store.updateAnalysisRunState("run-a", { status, results_metadata: { status } });
    assert.throws(() => cloneInput(db, "run-a"));
    db.close();
  });
}

test("sealed pending run rejects post-creation analysis inputs", () => {
  const { db, store } = seeded();
  createInputRun(store);
  prepareLateInput(store);
  assert.throws(() => cloneInput(db, "run-a"));
  db.close();
});

test("terminal analysis results and completion time freeze on first terminal transition", () => {
  const { db, store } = seeded("2026-08-20T04:00:00.000Z");
  createInputRun(store);
  store.updateAnalysisRunState("run-a", {
    status: "completed",
    results_metadata: { result: "first" },
  });
  assert.equal(
    store.updateAnalysisRunState("run-a", {
      status: "completed",
      results_metadata: { result: "first" },
    })?.status,
    "completed",
  );
  assert.throws(() =>
    store.updateAnalysisRunState("run-a", {
      status: "completed",
      results_metadata: { result: "replacement" },
    }),
  );
  assert.throws(() =>
    db.exec(`UPDATE analysis_runs SET completed_at='2026-08-20T05:00:00.000Z' WHERE id='run-a'`),
  );
  assert.throws(() =>
    db.exec(`UPDATE analysis_runs SET results_metadata_json='{"result":"raw"}' WHERE id='run-a'`),
  );
  db.close();
});

test("none binding cannot carry forged review projection fields", () => {
  const { db, store } = seeded();
  createInputRun(store, "snapshot");
  const source = db
    .prepare("SELECT record_snapshot_json FROM analysis_inputs WHERE analysis_run_id='snapshot'")
    .get() as { record_snapshot_json: string };
  const snapshot = JSON.parse(source.record_snapshot_json) as Record<string, unknown>;
  Object.assign(snapshot, {
    review_status: "normal",
    review_note: "forged note",
    reviewed_by: "admin",
    reviewed_at: "2026-08-20T02:00:00.000Z",
  });
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_at
    ) VALUES('forged-none','sha256:forged','algorithm-a','{}','code-a','pending','{}',
      '2026-08-20T03:00:00.000Z')`,
  ).run();
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO analysis_inputs(
        analysis_run_id,ordinal,record_id,input_hash,record_snapshot_json,
        snapshot_schema,review_binding_mode
      ) VALUES('forged-none',0,'record-a','sha256:forged',?,
        'echoclass.analysis-input.v1','none')`,
      )
      .run(JSON.stringify(snapshot)),
  );
  db.close();
});

test("SQLite uses the exact canonical millisecond UTC timestamp grammar", () => {
  const { db } = seeded();
  for (const [id, timestamp] of [
    ["fraction", "2026-08-20T03:00:00.1234Z"],
    ["lower-z", "2026-08-20T03:00:00.123z"],
    ["space", "2026-08-20 03:00:00.123Z"],
    ["year-zero", "0000-08-20T03:00:00.123Z"],
  ] as const) {
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO analysis_runs(
          id,dataset_hash,algorithm_version,configuration_json,code_version,status,
          results_metadata_json,created_at
        ) VALUES(?,?,'algorithm-a','{}','code-a','pending','{}',?)`,
        )
        .run(id, `sha256:${id}`, timestamp),
    );
  }
  db.close();
});

test("SQLite rejects control characters in run and input identities", () => {
  for (const control of ["\n", "\t", "\u0001", "\u007f"]) {
    const { db, store } = seeded();
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO analysis_runs(
          id,dataset_hash,algorithm_version,configuration_json,code_version,status,
          results_metadata_json,created_at
        ) VALUES(?,?,'algorithm-a','{}','code-a','pending','{}',
          '2026-08-20T03:00:00.000Z')`,
        )
        .run(`run${control}id`, `sha256:${control}hash`),
    );
    assert.throws(() =>
      store.createAnalysisRun(run({ id: `typed${control}run` }), [
        { record_id: "record-a", input_hash: `sha256:${control}input` },
      ]),
    );
    db.close();
  }
});

test("canonical record creation rejects invalid identity, time, and object metadata atomically", () => {
  for (const invalid of [
    command({ id: "" }),
    command({ id: "record\ninvalid" }),
    command({ id: "record-time", created_at: "0000-01-01T00:00:00.000Z" }),
    command({ id: "record-array", metadata: [] as never }),
    command({ id: "record-null", metadata: null as never }),
  ]) {
    const { db, store } = seeded();
    assert.throws(() => store.add(invalid));
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM experiment_records WHERE id=?").get(invalid.id) as {
          count: number;
        }
      ).count,
      0,
    );
    db.close();
  }
});

test("corrupt stored record metadata fails closed instead of becoming an empty object", () => {
  const { db, store } = seeded();
  db.exec("DROP TRIGGER experiment_records_008_update_guard");
  db.exec("DROP TRIGGER experiment_records_009_version_time");
  db.exec("UPDATE experiment_records SET metadata_json='[]' WHERE id='record-a'");
  assert.throws(() => store.findById("record-a"), RepositoryCorruptionError);
  db.close();
});

test("archived records cannot be selected but existing snapshots remain readable", () => {
  const { db, store } = seeded();
  createInputRun(store, "historical");
  new SqliteProvenanceStore(db, { now: () => "2026-08-20T04:00:00.000Z" }).update("record-a", {
    note: "later correction",
  });
  new SqliteProvenanceStore(db, { now: () => "2026-08-20T05:00:00.000Z" }).appendReview({
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "later review",
    reviewed_by: "Teacher A",
  });
  assert.equal(
    new SqliteProvenanceStore(db, { now: () => "2026-08-20T06:00:00.000Z" }).delete("record-a"),
    true,
  );
  assert.throws(() =>
    store.createAnalysisRun(run({ id: "after-archive" }), [
      { record_id: "record-a", input_hash: "sha256:archive" },
    ]),
  );
  const snapshot = store.listAnalysisInputs("historical")[0]?.record_snapshot as ExperimentRecord;
  assert.equal(snapshot.id, "record-a");
  assert.equal(snapshot.status, "active");
  db.close();
});

test("raw human review requires a real reviewer and valid chronology", () => {
  for (const values of [
    [null, "Unknown", "2026-08-20T02:00:00.000Z"],
    ["teacher-a", "Not Teacher A", "2026-08-20T02:00:00.000Z"],
    ["teacher-a", "Teacher A", "2026-08-19T23:59:59.999Z"],
    ["teacher-a", "Teacher A", "2026-08-20T02:00:00.1234Z"],
  ] as const) {
    const { db } = seeded();
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO record_reviews(
          id,record_id,reviewer_user_id,reviewer_label,decision,reason,
          decided_at,created_at,provenance_kind
        ) VALUES('review-raw','record-a',?,?,'included','raw',?,?,'human')`,
        )
        .run(values[0], values[1], values[2], values[2]),
    );
    db.close();
  }
});

test("SQLite rejects control characters in review event identities", () => {
  for (const control of ["\n", "\t", "\u0001", "\u007f"]) {
    const { db } = seeded();
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO record_reviews(
            id,record_id,reviewer_user_id,reviewer_label,decision,reason,
            decided_at,created_at,provenance_kind
          ) VALUES(?,'record-a','teacher-a','Teacher A','included','invalid',
            '2026-08-20T02:00:00.000Z','2026-08-20T02:00:00.000Z','human')`,
        )
        .run(`review${control}id`),
    );
    db.close();
  }
});

test("authoritative review intent receives a server ID and trusted timestamp", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a", "student", "Student A");
  seedUser(db, "teacher-a", "teacher", "Teacher A");
  const store = new SqliteProvenanceStore(
    db,
    { now: () => "2026-08-20T02:00:00.000Z" },
    { random: () => "server-id", hashSession: (value) => value },
  );
  store.add(command());
  store.appendReview({
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "trusted",
    reviewed_by: "Teacher A",
  });
  assert.deepEqual(store.listReviewHistory("record-a")[0], {
    id: "review-server-id",
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "trusted",
    reviewed_by: "Teacher A",
    reviewed_at: "2026-08-20T02:00:00.000Z",
    created_at: "2026-08-20T02:00:00.000Z",
    provenance_kind: "human",
    event_sequence: 1,
  });
  db.close();
});

test("Migration 008 downgrades forged none snapshots and seals historical runs", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a", "student", "Student A");
  const store = new SqliteProvenanceStore(db, { now: () => "2026-08-20T03:00:00.000Z" });
  store.add(command());
  createInputRun(store);
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.exec(
    `UPDATE analysis_inputs SET record_snapshot_json=json_set(
      record_snapshot_json,'$.review_note','forged','$.reviewed_by','admin',
      '$.reviewed_at','2026-08-20T02:00:00.000Z')`,
  );
  runMigrations(db);
  const row = db
    .prepare(
      `SELECT ai.snapshot_schema,ai.review_binding_mode,ar.inputs_sealed
       FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id`,
    )
    .get();
  assert.deepEqual(
    { ...row },
    {
      snapshot_schema: "echoclass.analysis-input.legacy",
      review_binding_mode: "legacy_unspecified",
      inputs_sealed: 1,
    },
  );
  db.close();
});

test("Migration 008 fails closed on malformed record metadata", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a", "student", "Student A");
  const store = new SqliteProvenanceStore(db);
  store.add(command());
  db.exec("UPDATE experiment_records SET metadata_json='[]' WHERE id='record-a'");
  assert.throws(() => runMigrations(db), /record:record-a:metadata_json/);
  assert.equal(
    (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number })
      .version,
    7,
  );
  db.close();
});

test("Migration 008 explicitly classifies a historical offset timestamp", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a", "student", "Student A");
  const store = new SqliteProvenanceStore(db);
  store.add(command());
  db.exec("DROP TRIGGER experiment_original_provenance_guard");
  db.exec(
    `UPDATE experiment_records SET
      created_at='2026-08-20T08:00:00.000+08:00',
      updated_at='2026-08-20T08:00:00.000+08:00'
     WHERE id='record-a'`,
  );
  runMigrations(db);
  const rows = db
    .prepare(
      `SELECT field_name,classification FROM provenance_boundary_classifications
       WHERE entity_type='record' AND entity_id='record-a' ORDER BY field_name`,
    )
    .all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      { field_name: "created_at", classification: "legacy_offset_timestamp" },
      { field_name: "updated_at", classification: "legacy_offset_timestamp" },
    ],
  );
  db.close();
});

test("invalid imported review chronology rolls back users records reviews and marker", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-2a6-chronology-"));
  try {
    const users = [
      {
        id: "user-a",
        role: "student",
        username: "user-a",
        passwordHash: "scrypt$test",
        defaultPassword: false,
        name: "Student A",
        class_name: "Class A",
        group_name: "Group A",
        status: "active",
        created_at: "2026-08-20T00:00:00.000Z",
      },
      {
        id: "teacher-a",
        role: "teacher",
        username: "teacher-a",
        passwordHash: "scrypt$test",
        defaultPassword: false,
        name: "Teacher A",
        class_name: "Class A",
        group_name: "",
        status: "active",
        created_at: "2026-08-20T00:00:00.000Z",
      },
    ];
    const imported = {
      ...command({ created_at: "2026-08-20T02:00:00.000Z" }),
      yield_percent: 1,
      updated_at: "2026-08-20T02:00:00.000Z",
      review_status: "normal",
      review_note: "",
      reviewed_at: "",
      reviewed_by: "",
      review_history: [
        {
          id: "review-before-record",
          reviewer_user_id: "teacher-a",
          status: "included",
          note: "invalid",
          reviewed_by: "Teacher A",
          reviewed_at: "2026-08-20T01:00:00.000Z",
          created_at: "2026-08-20T01:00:00.000Z",
          provenance_kind: "human",
        },
      ],
    };
    await writeFile(path.join(directory, "users.json"), JSON.stringify(users), "utf8");
    await writeFile(path.join(directory, "records.json"), JSON.stringify([imported]), "utf8");
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import { ensureData } from './dist/src/infrastructure/database/storage.js'; try { await ensureData(); process.exit(0); } catch { process.exit(7); }",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ECHOCLASS_DATA_DIR: directory,
          ECHOCLASS_SEED_DEMO: "0",
          STORAGE_MODE: "sqlite",
        },
      },
    );
    assert.equal(result.status, 7);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    for (const table of [
      "users",
      "experiment_records",
      "record_reviews",
      "storage_imports",
      "legacy_import_batches",
    ])
      assert.equal(
        (db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count,
        0,
        table,
      );
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
