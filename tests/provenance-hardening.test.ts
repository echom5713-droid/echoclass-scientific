import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  CreateExperimentCommand,
  ExperimentRecord,
  RecordReview,
} from "../src/domain/types.js";
import { parseCreateExperiment } from "../src/http/schemas/experiment.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
import { appendHumanReview } from "./review-test-helpers.js";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function seedUser(db: DatabaseSync, id: string, username = id): void {
  db.prepare(
    `INSERT INTO users(
      id, role, username, password_hash, default_password, name,
      class_name, group_name, status, data_json, created_at, updated_at
    ) VALUES(?, ?, ?, 'scrypt$test', 0, ?, 'Class A', 'Group A',
      'active', '{}', '2026-08-20T00:00:00.000Z', NULL)`,
  ).run(id, id.startsWith("teacher") ? "teacher" : "student", username, username);
}

function record(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
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
    note: "test",
    yield_percent: 1,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    created_by: "user-a",
    created_by_user_id: "user-a",
    review_status: "normal",
    review_note: "",
    reviewed_at: "",
    reviewed_by: "",
    synced_from_offline: false,
    ai_diagnosis: "",
    metadata: {},
    ...overrides,
  };
}

function review(overrides: Partial<RecordReview> = {}): RecordReview {
  return {
    id: "review-a",
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "checked",
    reviewed_by: "teacher-a",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "human",
    ...overrides,
  };
}

function insertLegacy(db: DatabaseSync, id: string, data: object): void {
  db.prepare(
    `INSERT INTO records(
      id, class_name, created_by, student_name, nh4cl_concentration,
      yield_percent, created_at, data_json
    ) VALUES(?, 'Class A', 'user-a', 'Student A', 3, 1, ?, ?)`,
  ).run(id, "2026-08-20T00:00:00.000Z", JSON.stringify(data));
}

test("migration ledger rejects a higher applied version with a missing prefix", () => {
  const db = database();
  db.exec(`CREATE TABLE schema_migrations(
    version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL
  ) STRICT`);
  db.prepare("INSERT INTO schema_migrations VALUES(2, ?, ?)").run(
    MIGRATIONS[1]!.name,
    "2026-08-20T00:00:00.000Z",
  );
  assert.throws(() => runMigrations(db), /prefix|gap|order/i);
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'").get(),
    undefined,
  );
  db.close();
});

test("migration ledger rows are append-only and migration definitions reject duplicate names", () => {
  const db = database();
  runMigrations(db);
  assert.throws(() => db.exec("UPDATE schema_migrations SET name='changed' WHERE version=1"));
  assert.throws(() => db.exec("DELETE FROM schema_migrations WHERE version=1"));
  assert.throws(() =>
    runMigrations(db, [
      MIGRATIONS[0]!,
      { ...MIGRATIONS[1]!, version: 20, name: MIGRATIONS[0]!.name },
    ]),
  );
  db.close();
});

test("legacy preflight rejects valid JSON with missing scientific observations", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  insertLegacy(db, "missing-fields", {
    id: "missing-fields",
    student_name: "Student A",
    class_name: "Class A",
    nh4cl_concentration: 3,
  });
  assert.throws(() => runMigrations(db, MIGRATIONS.slice(0, 2)), /missing-fields.*peel_mass/i);
  assert.equal(
    (db.prepare("SELECT COUNT(*) count FROM records").get() as { count: number }).count,
    1,
  );
  db.close();
});

test("legacy preflight reports invalid scientific types without printing values", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  insertLegacy(db, "invalid-type", {
    ...record({ id: "invalid-type", created_by_user_id: undefined }),
    peel_mass: "not-a-number",
  });
  assert.throws(() => runMigrations(db, MIGRATIONS.slice(0, 2)), /invalid-type:peel_mass\(type\)/);
  db.close();
});

test("legacy boolean parsing treats the string false as false", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  insertLegacy(db, "boolean-false", {
    ...record({ id: "boolean-false", created_by_user_id: undefined }),
    异常标记: "false",
  });
  runMigrations(db, MIGRATIONS.slice(0, 2));
  assert.equal(new SqliteProvenanceStore(db).findById("boolean-false")?.异常标记, false);
  db.close();
});

test("migration 003 preserves v2 records reviews runs inputs timestamps and snapshots", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a");
  insertLegacy(db, "record-a", record());
  runMigrations(db, MIGRATIONS.slice(0, 2));
  db.prepare(
    `INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind
    ) VALUES('review-a','record-a','teacher-a','teacher-a','included','kept',?,?, 'human')`,
  ).run("2026-08-20T01:00:00.000Z", "2026-08-20T01:00:00.000Z");
  db.exec(`INSERT INTO analysis_runs(
    id,dataset_hash,algorithm_version,configuration_json,code_version,status,
    results_metadata_json,created_at
  ) VALUES('run-a','dataset','none','{}','v2','pending','{}','2026-08-20T02:00:00.000Z')`);
  const recordSnapshot = '{"preserved":"record"}';
  const reviewSnapshot = '{"preserved":"review"}';
  db.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,
      record_snapshot_json,review_snapshot_json
    ) VALUES('run-a',0,'record-a','review-a','input',?,?)`,
  ).run(recordSnapshot, reviewSnapshot);

  runMigrations(db);
  const retained = db
    .prepare(
      `SELECT ai.record_snapshot_json, ai.review_snapshot_json, ai.snapshot_schema,
        ar.created_at, er.created_at AS record_created_at, er.effective_review_id
       FROM analysis_inputs ai
       JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
       JOIN experiment_records er ON er.id=ai.record_id`,
    )
    .get() as Record<string, unknown>;
  assert.equal(retained.record_snapshot_json, recordSnapshot);
  assert.equal(retained.review_snapshot_json, reviewSnapshot);
  assert.equal(retained.snapshot_schema, "echoclass.analysis-input.legacy");
  assert.equal(retained.created_at, "2026-08-20T02:00:00.000Z");
  assert.equal(retained.record_created_at, "2026-08-20T00:00:00.000Z");
  assert.equal(retained.effective_review_id, "review-a");
  db.close();
});

test("migration 003 reports impossible v2 legacy measurements for manual remediation", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  insertLegacy(db, "needs-repair", record({ id: "needs-repair", created_by_user_id: undefined }));
  runMigrations(db, MIGRATIONS.slice(0, 2));
  db.exec("UPDATE experiment_records SET peel_mass=0 WHERE id='needs-repair'");
  assert.throws(() => runMigrations(db), /needs-repair:peel_mass/);
  assert.deepEqual(
    (
      db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
        version: number;
      }>
    ).map((row) => row.version),
    [1, 2],
  );
  db.close();
});

test("review events reject replacement and duplicate-ID mutation paths", () => {
  const db = database();
  db.exec("PRAGMA recursive_triggers=OFF");
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  appendHumanReview(db, review());
  const replace = `INSERT OR REPLACE INTO record_reviews(
    id, record_id, reviewer_user_id, reviewer_label, decision, reason,
    decided_at, created_at, provenance_kind
  ) VALUES('review-a','record-a','teacher-a','teacher-a','excluded','replaced',
    '2026-08-20T02:00:00.000Z','2026-08-20T02:00:00.000Z','human')`;
  assert.throws(() => db.exec(replace));
  assert.throws(() => db.exec("UPDATE record_reviews SET reason='changed' WHERE id='review-a'"));
  assert.throws(() => db.exec("DELETE FROM record_reviews WHERE id='review-a'"));
  assert.throws(() =>
    db.exec(
      `${replace.replace("INSERT OR REPLACE", "INSERT")} ON CONFLICT(id) DO UPDATE SET reason='upserted'`,
    ),
  );
  assert.equal(store.listReviewHistory("record-a")[0]?.note, "checked");
  db.close();
});

test("equal review timestamps keep the effective pointer and projection consistent", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  db.prepare(
    `INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind,projection_updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "review-z",
    "record-a",
    "teacher-a",
    "teacher-a",
    "included",
    "checked",
    "2026-08-20T01:00:00.000Z",
    "2026-08-20T01:00:00.000Z",
    "human",
    "2026-08-20T01:00:00.001Z",
  );
  db.prepare(
    `INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind,projection_updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "review-a",
    "record-a",
    "teacher-a",
    "teacher-a",
    "excluded",
    "second",
    "2026-08-20T01:00:00.000Z",
    "2026-08-20T01:00:00.000Z",
    "human",
    "2026-08-20T01:00:00.002Z",
  );
  assert.equal(store.getEffectiveReview("record-a")?.id, "review-a");
  assert.equal(store.findById("record-a")?.review_status, "excluded");
  assert.throws(() =>
    db.exec("UPDATE experiment_records SET effective_review_id='review-z' WHERE id='record-a'"),
  );
  assert.throws(() =>
    db.exec("UPDATE experiment_records SET effective_review_id=NULL WHERE id='record-a'"),
  );
  assert.equal(store.getEffectiveReview("record-a")?.id, "review-a");
  assert.equal(store.findById("record-a")?.review_status, "excluded");
  db.close();
});

test("a direct review insert updates the effective pointer and projection", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  db.prepare(
    `INSERT INTO record_reviews(
      id, record_id, reviewer_user_id, reviewer_label, decision, reason,
      decided_at, created_at, provenance_kind, projection_updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "direct-review",
    "record-a",
    "teacher-a",
    "teacher-a",
    "excluded",
    "direct",
    "2026-08-20T01:00:00.000Z",
    "2026-08-20T01:00:00.000Z",
    "human",
    "2026-08-20T01:00:00.000Z",
  );
  assert.equal(store.getEffectiveReview("record-a")?.id, "direct-review");
  assert.equal(store.findById("record-a")?.review_status, "excluded");
  db.close();
});

test("analysis inputs reject cross-record review links in raw SQL and repository use", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  store.add(record({ id: "record-b", client_submission_id: undefined }));
  appendHumanReview(db, review({ id: "review-b", record_id: "record-b" }));
  db.exec(`INSERT INTO analysis_runs(
    id,dataset_hash,algorithm_version,configuration_json,code_version,status,
    results_metadata_json,created_at
  ) VALUES('run-a','hash','none','{}','test','pending','{}','2026-08-20T02:00:00.000Z')`);
  const rawInsert = `INSERT INTO analysis_inputs(
    analysis_run_id,ordinal,record_id,review_id,input_hash,record_snapshot_json,review_snapshot_json
  ) VALUES('run-a',0,'record-a','review-b','hash','{}','{}')`;
  assert.throws(() => db.exec(rawInsert));
  assert.throws(() =>
    store.createAnalysisRun(
      {
        id: "run-b",
        dataset_hash: "hash",
        algorithm_version: "none",
        configuration: {},
        code_version: "test",
      },
      [{ record_id: "record-a", review_id: "review-b", input_hash: "hash" }],
    ),
  );
  db.close();
});

test("analysis input snapshots reject update delete and replacement", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  store.createAnalysisRun(
    {
      id: "run-a",
      dataset_hash: "hash",
      algorithm_version: "none",
      configuration: {},
      code_version: "test",
    },
    [{ record_id: "record-a", input_hash: "hash" }],
  );
  assert.throws(() =>
    db.exec("UPDATE analysis_inputs SET input_hash='changed' WHERE analysis_run_id='run-a'"),
  );
  assert.throws(() => db.exec("DELETE FROM analysis_inputs WHERE analysis_run_id='run-a'"));
  assert.throws(() =>
    db.exec(`INSERT OR REPLACE INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,record_snapshot_json,review_snapshot_json
    ) VALUES('run-a',0,'record-a',NULL,'replacement','{}',NULL)`),
  );
  db.close();
});

test("invalid required snapshot JSON is reported as corruption", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  store.createAnalysisRun(
    {
      id: "run-a",
      dataset_hash: "hash",
      algorithm_version: "none",
      configuration: {},
      code_version: "test",
    },
    [{ record_id: "record-a", input_hash: "hash" }],
  );
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.exec("UPDATE analysis_inputs SET record_snapshot_json='{}' WHERE analysis_run_id='run-a'");
  assert.throws(() => store.listAnalysisInputs("run-a"), /corrupt|snapshot|json/i);
  db.close();
});

test("JSON startup import rolls every record back when a later record fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-import-red-"));
  try {
    await writeFile(path.join(directory, "users.json"), "[]", "utf8");
    await writeFile(
      path.join(directory, "records.json"),
      JSON.stringify([
        record({ created_by_user_id: undefined }),
        record({ created_by_user_id: undefined }),
      ]),
      "utf8",
    );
    const script = `
      import { ensureData } from './dist/src/infrastructure/database/storage.js';
      try { await ensureData(); process.exit(0); } catch { process.exit(7); }
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ECHOCLASS_DATA_DIR: directory,
        ECHOCLASS_SEED_DEMO: "0",
        STORAGE_MODE: "sqlite",
      },
    });
    assert.equal(child.status, 7);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const imported = (
      db.prepare("SELECT COUNT(*) count FROM experiment_records").get() as { count: number }
    ).count;
    db.close();
    assert.equal(imported, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("successful JSON startup import records a durable marker and is idempotent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-import-green-"));
  try {
    await writeFile(
      path.join(directory, "users.json"),
      JSON.stringify([
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
      ]),
      "utf8",
    );
    await writeFile(path.join(directory, "records.json"), JSON.stringify([record()]), "utf8");
    const script = `
      import { ensureData } from './dist/src/infrastructure/database/storage.js';
      await ensureData();
    `;
    const options = {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ECHOCLASS_DATA_DIR: directory,
        ECHOCLASS_SEED_DEMO: "0",
        STORAGE_MODE: "sqlite",
      },
    };
    assert.equal(
      spawnSync(process.execPath, ["--input-type=module", "-e", script], options).status,
      0,
    );
    assert.equal(
      spawnSync(process.execPath, ["--input-type=module", "-e", script], options).status,
      0,
    );
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const counts = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM users) users,
          (SELECT COUNT(*) FROM experiment_records) records,
          (SELECT COUNT(*) FROM storage_imports) imports,
          (SELECT COUNT(*) FROM legacy_import_batches) batches`,
      )
      .get() as { users: number; records: number; imports: number; batches: number };
    const imported = db
      .prepare(
        `SELECT submission_kind,storage_import_id FROM experiment_records
         WHERE id='record-a'`,
      )
      .get() as { submission_kind: string; storage_import_id: string };
    db.close();
    assert.deepEqual({ ...counts }, { users: 1, records: 1, imports: 1, batches: 1 });
    assert.deepEqual(
      { ...imported },
      { submission_kind: "legacy_canonical_snapshot", storage_import_id: "json-startup-v1" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed record updates do not leave orphan class or group rows", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  assert.throws(() =>
    store.update("record-a", {
      class_name: "Orphan Class",
      group_name: "Orphan Group",
      status: "invalid",
    } as unknown as import("../src/domain/types.js").UpdateExperimentCommand),
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) count FROM classes WHERE name='Orphan Class'").get() as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) count FROM groups WHERE name='Orphan Group'").get() as {
        count: number;
      }
    ).count,
    0,
  );
  db.close();
});

test("mass correction recalculates derived yield", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  const originalSubmission = (
    db.prepare("SELECT submitted_json FROM experiment_records WHERE id='record-a'").get() as {
      submitted_json: string;
    }
  ).submitted_json;
  const updated = store.update("record-a", { peel_mass: 200, oil_mass: 1 });
  assert.equal(updated?.yield_percent, 0.5);
  assert.equal(
    (
      db.prepare("SELECT submitted_json FROM experiment_records WHERE id='record-a'").get() as {
        submitted_json: string;
      }
    ).submitted_json,
    originalSubmission,
  );
  db.close();
});

test("ordinary deletion soft-deletes while retaining canonical provenance", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  assert.equal(store.delete("record-a"), true);
  assert.equal(store.findById("record-a"), null);
  const retained = db
    .prepare("SELECT status, oil_mass, submitted_json FROM experiment_records WHERE id='record-a'")
    .get() as { status: string; oil_mass: number; submitted_json: string } | undefined;
  assert.equal(retained?.status, "deleted");
  assert.equal(retained?.oil_mass, 1);
  assert.ok(retained?.submitted_json);
  db.close();
});

test("canonical offline idempotency cannot be stored without an authenticated creator", () => {
  const db = database();
  runMigrations(db);
  const store = new SqliteProvenanceStore(db);
  assert.throws(() =>
    store.add(
      record({
        client_submission_id: "offline-a",
        created_by_user_id: undefined,
      }),
    ),
  );
  db.close();
});

test("unresolved legacy offline tokens remain explicit metadata without a false scope guarantee", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  insertLegacy(db, "legacy-offline", {
    ...record({
      id: "legacy-offline",
      created_by: "unknown-user",
      created_by_user_id: undefined,
      client_submission_id: "legacy-token",
    }),
  });
  runMigrations(db);
  const row = db
    .prepare(
      "SELECT client_submission_id, created_by_user_id, metadata_json FROM experiment_records WHERE id='legacy-offline'",
    )
    .get() as {
    client_submission_id: string | null;
    created_by_user_id: string | null;
    metadata_json: string;
  };
  const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  assert.equal(row.client_submission_id, null);
  assert.equal(row.created_by_user_id, null);
  assert.equal(metadata.legacy_unscoped_client_submission_id, "legacy-token");
  assert.equal(metadata.legacy_idempotency_scope, "unresolved_actor_no_durable_guarantee");
  db.close();
});

test("transport preserves validated measurement provenance fields", () => {
  const parsed = parseCreateExperiment({
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
    note: "test",
    experiment_date: "2026-08-20",
    petri_diameter_mm: "90",
    measurement_method: "manual_local_image_calibrated",
    measurement_image_state: "calibrated_complete",
  });
  const measurement = parsed as CreateExperimentCommand & {
    experiment_date?: string;
    petri_diameter_mm?: number;
    measurement_method?: string;
  };
  assert.equal(measurement.experiment_date, "2026-08-20");
  assert.equal(measurement.petri_diameter_mm, 90);
  assert.equal(measurement.measurement_method, "manual_local_image_calibrated");
});

test("supported runtime surfaces consistently select Node 24", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    engines: { node: string };
  };
  assert.equal(packageJson.engines.node, ">=24.0.0 <25");
  assert.equal((await readFile(".nvmrc", "utf8")).trim(), "24");
  const dockerfile = await readFile("Dockerfile", "utf8");
  assert.match(
    dockerfile,
    /^FROM node:24\.\d+\.\d+-bookworm-slim@sha256:[a-f0-9]{64} AS node-build$/m,
  );
  assert.match(
    dockerfile,
    /^COPY --from=node-build \/usr\/local\/bin\/node \/usr\/local\/bin\/node$/m,
  );
  assert.match(await readFile(".github/workflows/ci.yml", "utf8"), /node-version:\s*24\.x/);
});
