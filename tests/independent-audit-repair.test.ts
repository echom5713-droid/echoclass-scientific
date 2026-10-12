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
  RecordReview,
  Session,
} from "../src/domain/types.js";
import { parseCreateExperiment } from "../src/http/schemas/experiment.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
import { studentPage } from "../src/views/pages.js";
import { appendHumanReview } from "./review-test-helpers.js";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function seedUser(db: DatabaseSync, id: string, role = "student"): void {
  db.prepare(
    `INSERT INTO users(
      id, role, username, password_hash, default_password, name,
      class_name, group_name, status, data_json, created_at, updated_at
    ) VALUES(?, ?, ?, 'scrypt$test', 0, ?, 'Class A', 'Group A',
      'active', '{}', '2026-08-20T00:00:00.000Z', NULL)`,
  ).run(id, role, id, id);
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
    note: "audit",
    experiment_date: "2026-08-20",
    petri_diameter_mm: 90,
    measurement_method: "manual_direct",
    created_by: "user-a",
    created_by_user_id: "user-a",
    created_at: "2026-08-20T00:00:00.000Z",
    synced_from_offline: false,
    metadata: {},
    ...overrides,
  };
}

function record(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    ...command(),
    yield_percent: 1,
    updated_at: "2026-08-20T00:00:00.000Z",
    review_status: "normal",
    review_note: "",
    reviewed_at: "",
    reviewed_by: "",
    ai_diagnosis: "",
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
    reviewed_by: "teacher-a",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "human",
    ...overrides,
  };
}

function analysisRun(id = "run-a"): AnalysisRun {
  return {
    id,
    dataset_hash: `dataset-${id}`,
    algorithm_version: "none",
    configuration: {},
    code_version: "test",
    status: "pending",
    results_metadata: {},
    created_at: "2026-08-20T02:00:00.000Z",
  };
}

function rawPendingAnalysisRun(db: DatabaseSync, id: string, createdAt: string): void {
  const value = analysisRun(id);
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_by_user_id,created_at,completed_at
    ) VALUES(?,?,?,?,?,'pending','{}',NULL,?,NULL)`,
  ).run(
    value.id,
    value.dataset_hash,
    value.algorithm_version,
    JSON.stringify(value.configuration),
    value.code_version,
    createdAt,
  );
}

function insertLegacy(db: DatabaseSync, id: string, data: object): void {
  db.prepare(
    `INSERT INTO records(
      id, class_name, created_by, student_name, nh4cl_concentration,
      yield_percent, created_at, data_json
    ) VALUES(?, 'Class A', 'user-a', 'Student A', 3, 1, ?, ?)`,
  ).run(id, "2026-08-20T00:00:00.000Z", JSON.stringify(data));
}

function cloneRecordRaw(
  db: DatabaseSync,
  sourceId: string,
  targetId: string,
  overrides: Record<string, string>,
): void {
  const columns = (
    db.prepare("PRAGMA table_info(experiment_records)").all() as unknown as Array<{ name: string }>
  ).map((row) => row.name);
  const expressions = columns.map((column) => {
    if (column === "id") return `'${targetId}'`;
    return overrides[column] ?? column;
  });
  db.exec(
    `INSERT INTO experiment_records(${columns.join(",")}) SELECT ${expressions.join(",")} FROM experiment_records WHERE id='${sourceId}'`,
  );
}

function storageProcess(directory: string): ReturnType<typeof spawnSync> {
  const script = `
    import { ensureData } from './dist/src/infrastructure/database/storage.js';
    try { await ensureData(); process.exit(0); } catch { process.exit(7); }
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ECHOCLASS_DATA_DIR: directory,
      ECHOCLASS_SEED_DEMO: "0",
      STORAGE_MODE: "sqlite",
    },
  });
}

function importedUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

async function writeImportFiles(
  directory: string,
  users: unknown[],
  records: unknown[],
): Promise<void> {
  await writeFile(path.join(directory, "users.json"), JSON.stringify(users), "utf8");
  await writeFile(path.join(directory, "records.json"), JSON.stringify(records), "utf8");
}

function sqliteCounts(directory: string): Record<string, number> {
  const db = new DatabaseSync(path.join(directory, "citrus.db"));
  const counts: Record<string, number> = {};
  for (const table of [
    "users",
    "experiment_records",
    "record_reviews",
    "storage_imports",
    "legacy_import_batches",
  ])
    counts[table] = (
      db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }
    ).count;
  db.close();
  return counts;
}

test("browser form default diameter without image state remains manual direct", () => {
  const session: Session = {
    id: "user-a",
    role: "student",
    username: "user-a",
    name: "Student A",
    class_name: "Class A",
    group_name: "Group A",
  };
  const html = String(studentPage([], session, false));
  const diameter = html.match(/name="petri_diameter_mm"[^>]*value="([^"]+)"/)?.[1];
  assert.equal(diameter, "90");
  const payload = { ...command(), petri_diameter_mm: diameter } as Record<string, unknown>;
  for (const field of [
    "id",
    "created_by",
    "created_by_user_id",
    "created_at",
    "synced_from_offline",
    "metadata",
  ])
    delete payload[field];
  const parsed = parseCreateExperiment(payload);
  assert.equal(parsed.measurement_method, "manual_direct");
});

test("mismatched submitted values fail without record class or group side effects", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  const forged = {
    ...command(),
    submitted_values: { ...command(), peel_mass: -5, oil_mass: 9 },
  } as unknown as PersistExperimentCommand;
  assert.throws(() => store.add(forged));
  for (const table of ["experiment_records", "classes", "groups"])
    assert.equal(
      (db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count,
      0,
      table,
    );
  db.close();
});

test("JSON record missing ID and creator fails atomically then supports corrected restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-audit-import-record-"));
  try {
    const invalid = { ...record(), id: undefined, created_by: undefined };
    await writeImportFiles(directory, [importedUser()], [invalid]);
    assert.equal(storageProcess(directory).status, 7);
    assert.deepEqual(sqliteCounts(directory), {
      users: 0,
      experiment_records: 0,
      record_reviews: 0,
      storage_imports: 0,
      legacy_import_batches: 0,
    });
    await writeImportFiles(
      directory,
      [importedUser()],
      [{ ...record(), id: "record-a", created_by: "Legacy Student A" }],
    );
    assert.equal(storageProcess(directory).status, 0);
    assert.equal(storageProcess(directory).status, 0);
    assert.deepEqual(sqliteCounts(directory), {
      users: 1,
      experiment_records: 1,
      record_reviews: 0,
      storage_imports: 1,
      legacy_import_batches: 1,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON user missing ID fails before import", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-audit-import-user-"));
  try {
    await writeImportFiles(directory, [{ ...importedUser(), id: undefined }], [record()]);
    assert.equal(storageProcess(directory).status, 7);
    assert.deepEqual(sqliteCounts(directory), {
      users: 0,
      experiment_records: 0,
      record_reviews: 0,
      storage_imports: 0,
      legacy_import_batches: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON provenance timestamp is validated atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-audit-import-time-"));
  try {
    await writeImportFiles(
      directory,
      [importedUser()],
      [{ ...record(), created_at: "not-a-timestamp" }],
    );
    assert.equal(storageProcess(directory).status, 7);
    assert.deepEqual(sqliteCounts(directory), {
      users: 0,
      experiment_records: 0,
      record_reviews: 0,
      storage_imports: 0,
      legacy_import_batches: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("original creator label is immutable at the database boundary", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  assert.throws(() =>
    db.exec("UPDATE experiment_records SET created_by_label='forged' WHERE id='record-a'"),
  );
  db.close();
});

test("offline idempotency rows cannot use a null durable scope", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(
    command({ client_submission_id: "offline-a", synced_from_offline: true }),
  );
  assert.throws(() =>
    cloneRecordRaw(db, "record-a", "record-null-scope", {
      idempotency_scope_class_id: "NULL",
    }),
  );
  db.close();
});

test("explicit review omission reason survives persistence and readback", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(command());
  appendHumanReview(db, review());
  store.createAnalysisRun(analysisRun(), [
    {
      record_id: "record-a",
      input_hash: "hash",
      review_mode: "omit",
      review_omission_reason: "sensitivity analysis without teacher decision",
    },
  ]);
  const input = store.listAnalysisInputs("run-a")[0] as
    | (ReturnType<SqliteProvenanceStore["listAnalysisInputs"]>[number] & {
        review_binding_mode?: string;
        review_omission_reason?: string;
      })
    | undefined;
  assert.equal(input?.review_binding_mode, "omit");
  assert.equal(input?.review_omission_reason, "sensitivity analysis without teacher decision");
});

test("raw SQL cannot fabricate durable review snapshot content", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(command());
  appendHumanReview(db, review());
  store.createAnalysisRun(analysisRun("seed-run"), [{ record_id: "record-a", input_hash: "seed" }]);
  const source = db
    .prepare(
      `SELECT record_snapshot_json,review_snapshot_json
       FROM analysis_inputs WHERE analysis_run_id='seed-run'`,
    )
    .get() as { record_snapshot_json: string; review_snapshot_json: string };
  const forgedReview = JSON.parse(source.review_snapshot_json) as Record<string, unknown>;
  forgedReview.note = "fabricated note";
  forgedReview.reviewed_by = "fabricated reviewer";
  const sourceCreatedAt = (
    db.prepare("SELECT created_at FROM analysis_runs WHERE id='seed-run'").get() as {
      created_at: string;
    }
  ).created_at;
  rawPendingAnalysisRun(db, "forged-run", sourceCreatedAt);
  const columns = (
    db.prepare("PRAGMA table_info(analysis_inputs)").all() as unknown as Array<{ name: string }>
  ).map((row) => row.name);
  const bindingColumns = columns.includes("review_binding_mode")
    ? ",review_binding_mode,review_omission_reason"
    : "";
  const bindingValues = columns.includes("review_binding_mode") ? ",'effective',NULL" : "";
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO analysis_inputs(
          analysis_run_id,ordinal,record_id,review_id,input_hash,
          record_snapshot_json,review_snapshot_json,snapshot_schema${bindingColumns}
        ) VALUES('forged-run',0,'record-a','review-a','hash',?,?,'echoclass.analysis-input.v1'${bindingValues})`,
      )
      .run(source.record_snapshot_json, JSON.stringify(forgedReview)),
  );
  db.close();
});

test("repository reads fail closed on review snapshot content inconsistent with its event", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 4));
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(command());
  store.importReview(review());
  store.createAnalysisRun(analysisRun(), [{ record_id: "record-a", input_hash: "hash" }]);
  const row = db
    .prepare("SELECT review_snapshot_json FROM analysis_inputs WHERE analysis_run_id='run-a'")
    .get() as { review_snapshot_json: string };
  const forged = JSON.parse(row.review_snapshot_json) as Record<string, unknown>;
  forged.note = "fabricated historical note";
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.prepare("UPDATE analysis_inputs SET review_snapshot_json=? WHERE analysis_run_id='run-a'").run(
    JSON.stringify(forged),
  );
  assert.throws(() => store.listAnalysisInputs("run-a"));
  db.close();
});

test("Migration 005 repairs a forged v3 compatibility projection from immutable events", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  insertLegacy(db, "record-a", record({ created_by_user_id: undefined }));
  runMigrations(db, MIGRATIONS.slice(0, 3));
  db.prepare(
    `INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind
    ) VALUES('review-a','record-a','teacher-a','teacher-a','included','accepted',?,?, 'human')`,
  ).run("2026-08-20T01:00:00.000Z", "2026-08-20T01:00:00.000Z");
  db.exec(
    "UPDATE experiment_records SET review_note='forged',reviewed_by='forged' WHERE id='record-a'",
  );
  runMigrations(db);
  const projection = db
    .prepare(
      "SELECT effective_review_id,review_status,review_note,reviewed_by FROM experiment_records WHERE id='record-a'",
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...projection },
    {
      effective_review_id: "review-a",
      review_status: "included",
      review_note: "accepted",
      reviewed_by: "teacher-a",
    },
  );
  db.close();
});

test("Migration 005 reclassifies inconsistent historical v1 input instead of retaining v1", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 4));
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(command());
  store.importReview(review());
  store.createAnalysisRun(analysisRun(), [{ record_id: "record-a", input_hash: "hash" }]);
  const row = db
    .prepare("SELECT review_snapshot_json FROM analysis_inputs WHERE analysis_run_id='run-a'")
    .get() as { review_snapshot_json: string };
  const forged = JSON.parse(row.review_snapshot_json) as Record<string, unknown>;
  forged.note = "fabricated historical note";
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.prepare("UPDATE analysis_inputs SET review_snapshot_json=? WHERE analysis_run_id='run-a'").run(
    JSON.stringify(forged),
  );
  runMigrations(db);
  const migrated = db
    .prepare(
      "SELECT snapshot_schema,review_binding_mode FROM analysis_inputs WHERE analysis_run_id='run-a'",
    )
    .get() as { snapshot_schema: string; review_binding_mode: string };
  assert.deepEqual(
    { ...migrated },
    {
      snapshot_schema: "echoclass.analysis-input.legacy",
      review_binding_mode: "legacy_unspecified",
    },
  );
  db.close();
});

test("released migrations and frozen v2 preflight match accepted fingerprints", () => {
  const expected = new Map([
    ["migrations/001-initial-schema.ts", "ba1c161de326f446a01eeac308816ba67bee41b6"],
    ["migrations/002-normalized-provenance.ts", "5c7a8485486c99a4b55c1c8bee2b37e2691559d5"],
    [
      "migrations/003-provenance-integrity-hardening.ts",
      "2061186b4a757023a1861000e892cbc6204a589a",
    ],
    ["migrations/004-end-to-end-provenance-closure.ts", "5fe991ef6fe2272f927078e1848485969cfa5643"],
    ["migrations/002-legacy-preflight.ts", "a803cc9032e23d8603d5ebcea827740aab321e33"],
  ]);
  for (const [file, hash] of expected) {
    const result = spawnSync("git", ["hash-object", `src/infrastructure/database/${file}`], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, file);
    assert.equal(result.stdout.trim(), hash, file);
  }
});
