import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  AnalysisRun,
  ExperimentRecord,
  PersistExperimentCommand,
  RecordReview,
} from "../src/domain/types.js";
import { RepositoryCorruptionError } from "../src/domain/repositories.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
import { appendHumanReview } from "./review-test-helpers.js";

const V1 = "echoclass.analysis-input.v1";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function seedUser(db: DatabaseSync, id: string, role = "student"): void {
  db.prepare(
    `INSERT INTO users(
      id,role,username,password_hash,default_password,name,class_name,group_name,
      status,data_json,created_at,updated_at
    ) VALUES(?,?,?,'scrypt$test',0,?,'Class A','Group A','active','{}',?,NULL)`,
  ).run(id, role, id, id === "teacher-a" ? "Teacher A" : "Student A", "2026-08-20T00:00:00.000Z");
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
    emulsification_level: "轻微乳化",
    emulsion_concentration: 20,
    ecoli_observation_group: "精油乳液组",
    inhibition_zone_diameter: 10,
    colony_growth_score: 3,
    异常标记: false,
    error_source: "",
    note: "2A.5",
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

function review(overrides: Partial<RecordReview> = {}): RecordReview {
  return {
    id: "review-a",
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "accepted",
    reviewed_by: "Teacher A",
    reviewed_at: "2026-08-20T02:00:00.000Z",
    created_at: "2026-08-20T02:00:00.000Z",
    provenance_kind: "human",
    ...overrides,
  };
}

function seeded(now = "2026-08-20T03:00:00.000Z"): {
  db: DatabaseSync;
  store: SqliteProvenanceStore;
} {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db, { now: () => now });
  store.add(command());
  return { db, store };
}

function rawInput(
  db: DatabaseSync,
  runId: string,
  snapshot: Record<string, unknown>,
  options: { review?: RecordReview; inputHash?: string } = {},
): void {
  db.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,
      record_snapshot_json,review_snapshot_json,snapshot_schema,
      review_binding_mode,review_omission_reason
    ) VALUES(?,0,'record-a',?,?,?,?,? ,?,NULL)`,
  ).run(
    runId,
    options.review?.id ?? null,
    options.inputHash ?? "sha256:input",
    JSON.stringify(snapshot),
    options.review ? JSON.stringify(options.review) : null,
    V1,
    options.review ? "effective" : "none",
  );
}

function snapshotFor(db: DatabaseSync, store: SqliteProvenanceStore): Record<string, unknown> {
  store.createAnalysisRun(run({ id: "snapshot-seed" }), [
    { record_id: "record-a", input_hash: "sha256:seed" },
  ]);
  const row = db
    .prepare(
      "SELECT record_snapshot_json FROM analysis_inputs WHERE analysis_run_id='snapshot-seed'",
    )
    .get() as { record_snapshot_json: string };
  return JSON.parse(row.record_snapshot_json) as Record<string, unknown>;
}

function rawRun(db: DatabaseSync, id: string, values: Partial<AnalysisRun> = {}): void {
  const value = run({ id, ...values });
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

function storageProcess(directory: string): ReturnType<typeof spawnSync> {
  return spawnSync(
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
}

async function writeImport(
  directory: string,
  options: { userCreatedAt?: string; recordCreatedAt?: string; provenanceKind?: string },
): Promise<void> {
  const user = {
    id: "user-a",
    role: "student",
    username: "user-a",
    passwordHash: "scrypt$test",
    defaultPassword: false,
    name: "Student A",
    class_name: "Class A",
    group_name: "Group A",
    status: "active",
    created_at: options.userCreatedAt ?? "2026-08-20T00:00:00.000Z",
  };
  const imported = {
    ...command({ created_at: options.recordCreatedAt ?? "2026-08-20T00:00:00.000Z" }),
    yield_percent: 1,
    updated_at: "2026-08-20T00:00:00.000Z",
    review_status: "normal",
    review_note: "",
    reviewed_at: "",
    reviewed_by: "",
    review_history:
      options.provenanceKind === undefined
        ? []
        : [
            {
              id: "review-a",
              status: "included",
              note: "accepted",
              reviewed_by: "Teacher A",
              reviewed_at: "2026-08-20T02:00:00.000Z",
              created_at: "2026-08-20T02:00:00.000Z",
              provenance_kind: options.provenanceKind,
            },
          ],
  };
  await writeFile(path.join(directory, "users.json"), JSON.stringify([user]), "utf8");
  await writeFile(path.join(directory, "records.json"), JSON.stringify([imported]), "utf8");
}

test("ordinary analysis creation ignores caller status and timestamps", () => {
  const { db, store } = seeded("2026-08-20T03:00:00.000Z");
  store.createAnalysisRun(
    run({
      status: "completed",
      created_at: "not-a-date",
      completed_at: "1999-01-01T00:00:00.000Z",
      results_metadata: { forged: true },
    }),
    [{ record_id: "record-a", input_hash: "sha256:trusted-input" }],
  );
  const created = store.findAnalysisRun("run-a");
  assert.deepEqual(
    created && {
      id: created.id,
      dataset_hash: created.dataset_hash,
      algorithm_version: created.algorithm_version,
      configuration: created.configuration,
      code_version: created.code_version,
      status: created.status,
      results_metadata: created.results_metadata,
      created_at: created.created_at,
    },
    {
      id: "run-a",
      dataset_hash: "sha256:dataset-a",
      algorithm_version: "algorithm-a",
      configuration: {},
      code_version: "code-a",
      status: "pending",
      results_metadata: {},
      created_at: "2026-08-20T03:00:00.000Z",
    },
  );
  db.close();
});

test("ordinary analysis identity, configuration and creator are validated", () => {
  const { db, store } = seeded();
  for (const [field, value] of [
    ["id", ""],
    ["dataset_hash", ""],
    ["algorithm_version", ""],
    ["code_version", ""],
    ["dataset_hash", "x".repeat(257)],
    ["configuration", []],
    ["configuration", "scalar"],
    ["created_by_user_id", "missing-user"],
  ] as const) {
    assert.throws(
      () =>
        store.createAnalysisRun(run({ [field]: value }), [
          { record_id: "record-a", input_hash: "sha256:valid-input" },
        ]),
      String(field),
    );
  }
  db.close();
});

test("backdated effective selection fails at repository and SQLite boundaries", () => {
  const { db, store } = seeded("2026-08-20T01:00:00.000Z");
  appendHumanReview(db, review());
  assert.throws(() =>
    store.createAnalysisRun(run({ id: "repository-backdated" }), [
      { record_id: "record-a", review_mode: "effective", input_hash: "sha256:input" },
    ]),
  );

  rawRun(db, "raw-backdated", { created_at: "2026-08-20T01:00:00.000Z" });
  const record = store.findById("record-a") as ExperimentRecord;
  const durableReview = store.getEffectiveReview("record-a") as RecordReview;
  assert.throws(() =>
    rawInput(db, "raw-backdated", record as unknown as Record<string, unknown>, {
      review: durableReview,
    }),
  );
  db.close();
});

test("analysis run SQL insert contract rejects invalid states and timestamps", () => {
  const { db } = seeded();
  const cases: Array<[string, Partial<AnalysisRun>]> = [
    ["completed-missing", { status: "completed" }],
    ["failed-missing", { status: "failed" }],
    ["running-new", { status: "running" }],
    ["pending-completed-at", { status: "pending", completed_at: "2026-08-20T04:00:00.000Z" }],
    ["terminal-before", { status: "completed", completed_at: "2026-08-20T02:00:00.000Z" }],
    ["invalid-created", { created_at: "not-a-date" }],
    ["calendar-invalid-created", { created_at: "2026-02-30T00:00:00Z" }],
    ["array-configuration", { configuration: [] as unknown as AnalysisRun["configuration"] }],
    ["array-results", { results_metadata: [] as unknown as AnalysisRun["results_metadata"] }],
  ];
  for (const [id, values] of cases) assert.throws(() => rawRun(db, id, values), id);
  db.close();
});

test("analysis run SQL update contract blocks terminal regression and creator mutation", () => {
  const { db, store } = seeded("2026-08-20T04:00:00.000Z");
  store.createAnalysisRun(run({ created_by_user_id: "teacher-a" }), [
    { record_id: "record-a", input_hash: "sha256:state-contract" },
  ]);
  store.updateAnalysisRunState("run-a", {
    status: "completed",
    results_metadata: {},
    completed_at: "2026-08-20T04:00:00.000Z",
  });
  assert.throws(() => db.exec("UPDATE analysis_runs SET status='pending',completed_at=NULL"));
  assert.throws(() => db.exec("UPDATE analysis_runs SET created_by_user_id='user-a'"));
  db.close();
});

test("state updates use trusted completion time and ignore caller timestamp", () => {
  const { db, store } = seeded("2026-08-20T04:00:00.000Z");
  store.createAnalysisRun(run(), [
    { record_id: "record-a", input_hash: "sha256:state-timestamps" },
  ]);
  const running = store.updateAnalysisRunState("run-a", {
    status: "running",
    results_metadata: {},
    completed_at: "1999-01-01T00:00:00.000Z",
  });
  assert.equal(running?.completed_at, undefined);
  const completed = store.updateAnalysisRunState("run-a", {
    status: "completed",
    results_metadata: { outcome: "complete" },
    completed_at: "1999-01-01T00:00:00.000Z",
  });
  assert.equal(completed?.completed_at, "2026-08-20T04:00:00.000Z");
  db.close();
});

test("analysis run reads fail closed on malformed JSON and state", () => {
  for (const mutation of [
    "configuration_json='[]'",
    "configuration_json='not-json'",
    "results_metadata_json='[]'",
    "results_metadata_json='not-json'",
    "status='completed',completed_at=NULL",
  ]) {
    const { db, store } = seeded();
    store.createAnalysisRun(run(), [
      { record_id: "record-a", input_hash: "sha256:corruption-source" },
    ]);
    db.exec("DROP TRIGGER analysis_runs_identity_guard");
    db.exec("DROP TRIGGER analysis_runs_update_contract");
    db.exec("DROP TRIGGER analysis_runs_009_terminal_timestamp");
    db.exec(`UPDATE analysis_runs SET ${mutation} WHERE id='run-a'`);
    assert.throws(() => store.findAnalysisRun("run-a"), RepositoryCorruptionError, mutation);
    db.close();
  }
});

test("every required v1 snapshot key is fail-closed at SQLite INSERT", () => {
  const { db, store } = seeded();
  const base = snapshotFor(db, store);
  const required = [
    "id",
    "student_name",
    "class_name",
    "group_name",
    "nh4cl_concentration",
    "peel_mass",
    "oil_mass",
    "distillation_time",
    "phase_clarity_score",
    "emulsification_level",
    "emulsion_concentration",
    "ecoli_observation_group",
    "inhibition_zone_diameter",
    "colony_growth_score",
    "异常标记",
    "error_source",
    "note",
    "measurement_method",
    "yield_percent",
    "status",
    "created_at",
    "updated_at",
    "created_by",
    "review_status",
    "review_note",
    "reviewed_at",
    "reviewed_by",
    "synced_from_offline",
    "ai_diagnosis",
    "metadata",
  ];
  required.forEach((field, ordinal) => {
    rawRun(db, `missing-${ordinal}`);
    const invalid = { ...base };
    delete invalid[field];
    assert.throws(() => rawInput(db, `missing-${ordinal}`, invalid), field);
  });
  db.close();
});

test("v1 snapshot timestamps and optional creator identifier are strict", () => {
  const { db, store } = seeded();
  const base = snapshotFor(db, store);
  const invalid = [
    { ...base, created_at: "not-a-date" },
    { ...base, updated_at: "2026-02-30T00:00:00Z" },
    { ...base, created_by_user_id: "" },
    { ...base, created_by_user_id: "missing-user" },
  ];
  invalid.forEach((snapshot, ordinal) => {
    rawRun(db, `invalid-provenance-${ordinal}`);
    assert.throws(() => rawInput(db, `invalid-provenance-${ordinal}`, snapshot));
  });
  db.close();
});

test("empty or oversized input and record identities are rejected", () => {
  const { db, store } = seeded();
  assert.throws(() =>
    store.createAnalysisRun(run(), [{ record_id: "", input_hash: "sha256:input" }]),
  );
  assert.throws(() =>
    store.createAnalysisRun(run({ id: "empty-input" }), [
      { record_id: "record-a", input_hash: "" },
    ]),
  );
  assert.throws(() =>
    store.createAnalysisRun(run({ id: "oversized-input" }), [
      { record_id: "record-a", input_hash: "x".repeat(257) },
    ]),
  );
  const base = snapshotFor(db, store);
  rawRun(db, "raw-empty-input");
  assert.throws(() => rawInput(db, "raw-empty-input", base, { inputHash: "" }));
  db.close();
});

test("plausible but durable-record-mismatched snapshot fails only at selection time", () => {
  const { db, store } = seeded();
  const base = snapshotFor(db, store);
  const forged = {
    ...base,
    student_name: "Another Student",
    oil_mass: 2,
    yield_percent: 2,
    note: "forged but internally valid",
  };
  rawRun(db, "forged-selection");
  assert.throws(() => rawInput(db, "forged-selection", forged));

  store.update("record-a", { oil_mass: 2, note: "later correction" });
  assert.equal(store.listAnalysisInputs("snapshot-seed")[0]?.record_snapshot.oil_mass, 1);
  db.close();
});

test("calendar-invalid imported record timestamp fails atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-2a5-calendar-"));
  try {
    await writeImport(directory, { recordCreatedAt: "2026-02-30T00:00:00Z" });
    assert.equal(storageProcess(directory).status, 7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsupported imported review provenance is never upgraded to human", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-2a5-provenance-"));
  try {
    await writeImport(directory, { provenanceKind: "fabricated_kind" });
    assert.equal(storageProcess(directory).status, 7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid imported-user timestamp fails atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-2a5-user-time-"));
  try {
    await writeImport(directory, { userCreatedAt: "not-a-date" });
    assert.equal(storageProcess(directory).status, 7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Migration 009 is registered without changing released migration sources", async () => {
  assert.equal(MIGRATIONS[8]?.version, 9);
  assert.equal(MIGRATIONS[15]?.version, 16);
  const expected = new Map([
    ["001-initial-schema.ts", "ba1c161de326f446a01eeac308816ba67bee41b6"],
    ["002-normalized-provenance.ts", "5c7a8485486c99a4b55c1c8bee2b37e2691559d5"],
    ["003-provenance-integrity-hardening.ts", "2061186b4a757023a1861000e892cbc6204a589a"],
    ["004-end-to-end-provenance-closure.ts", "5fe991ef6fe2272f927078e1848485969cfa5643"],
    ["005-independent-audit-provenance-repair.ts", "0d11a54555e8d60291a88d60a274c79fdfa9b3bf"],
    ["006-temporal-analysis-contract-closure.ts", "e1793e06a0b31d20de6d9872e16cdc7696bbeb72"],
    ["007-analysis-selection-and-run-integrity.ts", "c00484b07209ef401ea4c4c63fb397cc2b23af5e"],
    ["002-legacy-preflight.ts", "a803cc9032e23d8603d5ebcea827740aab321e33"],
  ]);
  for (const [file, hash] of expected) {
    const source = await readFile(`src/infrastructure/database/migrations/${file}`);
    const result = spawnSync("git", ["hash-object", "--stdin"], { input: source });
    assert.equal(result.status, 0, file);
    assert.equal(result.stdout.toString().trim(), hash, file);
  }
});

test("Migration 007 preflight reports corrupt analysis run IDs and rolls back", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 6));
  rawRun(db, "bad-run", { configuration: [] as unknown as AnalysisRun["configuration"] });
  assert.throws(() => runMigrations(db), /invalid analysis runs: bad-run/i);
  assert.equal(
    (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number })
      .version,
    6,
  );
  db.close();
});

test("Migration 007 downgrades structurally unverifiable historical v1 input", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 6));
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db, {
    now: () => "2026-08-20T03:00:00.000Z",
  });
  store.add(command());
  store.createAnalysisRun(run(), [{ record_id: "record-a", input_hash: "sha256:input" }]);
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.exec(
    `UPDATE analysis_inputs SET record_snapshot_json=json_remove(record_snapshot_json,'$.oil_mass')`,
  );
  runMigrations(db);
  const row = db.prepare("SELECT snapshot_schema,review_binding_mode FROM analysis_inputs").get();
  assert.deepEqual(
    { ...row },
    {
      snapshot_schema: "echoclass.analysis-input.legacy",
      review_binding_mode: "legacy_unspecified",
    },
  );
  db.close();
});

test("Migration 007 fails closed on definite historical record contradiction", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 6));
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db, {
    now: () => "2026-08-20T03:00:00.000Z",
  });
  store.add(command());
  store.createAnalysisRun(run(), [{ record_id: "record-a", input_hash: "sha256:input" }]);
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.exec(
    `UPDATE analysis_inputs SET record_snapshot_json=json_set(
      record_snapshot_json,'$.oil_mass',2,'$.yield_percent',2,'$.note','forged')`,
  );
  assert.throws(() => runMigrations(db), /run-a:0.*oil_mass/i);
  db.close();
});

test("Migration 007 marks point-in-time agreement unverifiable after later record edits", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 6));
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db, {
    now: () => "2026-08-20T03:00:00.000Z",
  });
  store.add(command());
  store.createAnalysisRun(run(), [{ record_id: "record-a", input_hash: "sha256:input" }]);
  new SqliteProvenanceStore(db, { now: () => "2026-08-20T04:00:00.000Z" }).update("record-a", {
    oil_mass: 2,
    note: "later correction",
  });
  runMigrations(db);
  const row = db.prepare("SELECT snapshot_schema,review_binding_mode FROM analysis_inputs").get();
  assert.deepEqual(
    { ...row },
    {
      snapshot_schema: "echoclass.analysis-input.legacy",
      review_binding_mode: "legacy_unspecified",
    },
  );
  db.close();
});
