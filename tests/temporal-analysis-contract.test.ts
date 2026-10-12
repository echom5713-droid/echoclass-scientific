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
import { preflightAndPrepareMigration2 } from "../src/infrastructure/database/migrations/002-legacy-preflight.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
import { appendHumanReview } from "./review-test-helpers.js";

const V1 = "echoclass.analysis-input.v1";
const LEGACY = "echoclass.analysis-input.legacy";

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
    note: "temporal audit",
    experiment_date: "2026-08-20",
    petri_diameter_mm: 90,
    measurement_method: "manual_direct",
    created_by: "Student A",
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

function review(
  id: string,
  createdAt: string,
  overrides: Partial<RecordReview> = {},
): RecordReview {
  return {
    id,
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: `decision ${id}`,
    reviewed_by: "Teacher A",
    reviewed_at: createdAt,
    created_at: createdAt,
    provenance_kind: "human",
    ...overrides,
  };
}

function run(id: string, createdAt: string): AnalysisRun {
  return {
    id,
    dataset_hash: `dataset-${id}`,
    algorithm_version: "none",
    configuration: {},
    code_version: "test",
    status: "pending",
    results_metadata: {},
    created_at: createdAt,
  };
}

function rawPendingAnalysisRun(db: DatabaseSync, id: string, createdAt: string): void {
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_by_user_id,created_at,completed_at
    ) VALUES(?,?,?,?,?,'pending','{}',NULL,?,NULL)`,
  ).run(id, `dataset-${id}`, "none", "{}", "test", createdAt);
}

function seededStore(
  migrations = MIGRATIONS,
  now = "2026-08-20T04:00:00.000Z",
): {
  db: DatabaseSync;
  store: SqliteProvenanceStore;
} {
  const db = database();
  runMigrations(db, migrations);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db, { now: () => now });
  store.add(command());
  return { db, store };
}

function rawAnalysisInsert(
  db: DatabaseSync,
  runId: string,
  recordSnapshot: string,
  options: {
    reviewId?: string;
    reviewSnapshot?: string;
    binding?: "effective" | "none" | "omit";
    reason?: string;
  } = {},
): void {
  db.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,
      record_snapshot_json,review_snapshot_json,snapshot_schema,
      review_binding_mode,review_omission_reason
    ) VALUES(?,0,'record-a',?,'raw-hash',?,?,?, ?,?)`,
  ).run(
    runId,
    options.reviewId ?? null,
    recordSnapshot,
    options.reviewSnapshot ?? null,
    V1,
    options.binding ?? "none",
    options.reason ?? null,
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

function importedUser(): Record<string, unknown> {
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
  };
}

async function writeImport(directory: string, records: unknown[]): Promise<void> {
  await writeFile(path.join(directory, "users.json"), JSON.stringify([importedUser()]), "utf8");
  await writeFile(path.join(directory, "records.json"), JSON.stringify(records), "utf8");
}

function importCounts(directory: string): Record<string, number> {
  const db = new DatabaseSync(path.join(directory, "citrus.db"));
  const counts: Record<string, number> = {};
  for (const table of [
    "users",
    "experiment_records",
    "record_reviews",
    "storage_imports",
    "legacy_import_batches",
  ])
    counts[table] = Number(
      (db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count,
    );
  db.close();
  return counts;
}

test("point-in-time run remains readable after a later review", () => {
  const { db, store } = seededStore();
  appendHumanReview(db, review("review-1", "2026-08-20T01:00:00.000Z"));
  store.createAnalysisRun(run("run-1", "2026-08-20T02:00:00.000Z"), [
    { record_id: "record-a", review_mode: "effective", input_hash: "hash-1" },
  ]);
  appendHumanReview(db, review("review-2", "2026-08-20T03:00:00.000Z", { status: "excluded" }));
  const input = store.listAnalysisInputs("run-1")[0];
  assert.equal(input?.review_id, "review-1");
  assert.equal(input?.review_snapshot?.event_sequence, 1);
  db.close();
});

test("Migration 006 preserves a plausible old-event point-in-time v1 snapshot", () => {
  const { db, store } = seededStore(MIGRATIONS.slice(0, 4), "2026-08-20T02:00:00.000Z");
  appendHumanReview(db, review("review-1", "2026-08-20T01:00:00.000Z"));
  store.createAnalysisRun(run("run-1", "2026-08-20T02:00:00.000Z"), [
    { record_id: "record-a", input_hash: "hash-1" },
  ]);
  appendHumanReview(db, review("review-2", "2026-08-20T03:00:00.000Z", { status: "excluded" }));
  runMigrations(db);
  const row = db
    .prepare(
      "SELECT snapshot_schema,review_binding_mode,review_id FROM analysis_inputs WHERE analysis_run_id='run-1'",
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...row },
    {
      snapshot_schema: V1,
      review_binding_mode: "effective",
      review_id: "review-1",
    },
  );
  db.close();
});

test("Migration 006 downgrades a temporally impossible old-event binding", () => {
  const { db, store } = seededStore(MIGRATIONS.slice(0, 4), "2026-08-20T03:00:00.000Z");
  store.importReview(review("review-1", "2026-08-20T02:00:00.000Z"));
  store.createAnalysisRun(run("snapshot-source", "2026-08-20T03:00:00.000Z"), [
    { record_id: "record-a", input_hash: "impossible" },
  ]);
  const snapshots = db
    .prepare(
      `SELECT record_snapshot_json,review_snapshot_json,review_id,snapshot_schema
       FROM analysis_inputs WHERE analysis_run_id='snapshot-source'`,
    )
    .get() as Record<string, unknown>;
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_at
    ) VALUES('run-before-review','dataset','none','{}','test','pending','{}',?)`,
  ).run("2026-08-20T01:00:00.000Z");
  db.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,
      record_snapshot_json,review_snapshot_json,snapshot_schema
    ) VALUES('run-before-review',0,'record-a',?,'impossible',?,?,?)`,
  ).run(
    String(snapshots.review_id),
    String(snapshots.record_snapshot_json),
    String(snapshots.review_snapshot_json),
    String(snapshots.snapshot_schema),
  );
  runMigrations(db);
  const row = db
    .prepare(
      "SELECT snapshot_schema,review_binding_mode FROM analysis_inputs WHERE analysis_run_id='run-before-review'",
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...row },
    {
      snapshot_schema: LEGACY,
      review_binding_mode: "legacy_unspecified",
    },
  );
  db.close();
});

test("raw structurally incomplete v1 snapshot fails at SQLite INSERT", () => {
  const { db } = seededStore();
  const sourceCreatedAt = String(
    (
      db.prepare("SELECT updated_at FROM experiment_records WHERE id='record-a'").get() as {
        updated_at: string;
      }
    ).updated_at,
  );
  rawPendingAnalysisRun(db, "raw-incomplete", sourceCreatedAt);
  assert.throws(() =>
    rawAnalysisInsert(
      db,
      "raw-incomplete",
      JSON.stringify({ id: "record-a", review_status: "normal" }),
    ),
  );
  db.close();
});

test("raw coercible non-finite and cross-field-invalid v1 snapshots fail", () => {
  const { db, store } = seededStore();
  store.createAnalysisRun(run("seed", "2026-08-20T01:00:00.000Z"), [
    { record_id: "record-a", input_hash: "seed" },
  ]);
  const source = db
    .prepare(
      `SELECT ai.record_snapshot_json,ar.created_at
       FROM analysis_inputs ai
       JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
       WHERE ai.analysis_run_id='seed'`,
    )
    .get() as { record_snapshot_json: string; created_at: string };
  const base = JSON.parse(source.record_snapshot_json) as Record<string, unknown>;
  const invalid = [
    { ...base, peel_mass: "100" },
    { ...base, inhibition_zone_diameter: Number.POSITIVE_INFINITY },
    { ...base, yield_percent: 99 },
  ];
  invalid.forEach((snapshot, index) => {
    const id = `invalid-${index}`;
    rawPendingAnalysisRun(db, id, source.created_at);
    assert.throws(() => rawAnalysisInsert(db, id, JSON.stringify(snapshot)), id);
  });
  db.close();
});

test("new effective input cannot bind an older review after a newer event", () => {
  const { db, store } = seededStore();
  appendHumanReview(db, review("review-1", "2026-08-20T01:00:00.000Z"));
  store.createAnalysisRun(run("seed-old", "2026-08-20T02:00:00.000Z"), [
    { record_id: "record-a", input_hash: "seed-old" },
  ]);
  const old = db
    .prepare(
      "SELECT record_snapshot_json,review_snapshot_json FROM analysis_inputs WHERE analysis_run_id='seed-old'",
    )
    .get() as { record_snapshot_json: string; review_snapshot_json: string };
  appendHumanReview(db, review("review-2", "2026-08-20T03:00:00.000Z", { status: "excluded" }));
  const projectionUpdatedAt = String(
    (
      db.prepare("SELECT updated_at FROM experiment_records WHERE id='record-a'").get() as {
        updated_at: string;
      }
    ).updated_at,
  );
  rawPendingAnalysisRun(db, "raw-stale", projectionUpdatedAt);
  assert.throws(() =>
    rawAnalysisInsert(db, "raw-stale", old.record_snapshot_json, {
      reviewId: "review-1",
      reviewSnapshot: old.review_snapshot_json,
      binding: "effective",
    }),
  );
  db.close();
});

test("explicit effective mode rejects an unreviewed record", () => {
  const { db, store } = seededStore();
  assert.throws(() =>
    store.createAnalysisRun(run("explicit-effective", "2026-08-20T01:00:00.000Z"), [
      { record_id: "record-a", review_mode: "effective", input_hash: "hash" },
    ]),
  );
  db.close();
});

test("omit mode rejects an unreviewed record", () => {
  const { db, store } = seededStore();
  assert.throws(() =>
    store.createAnalysisRun(run("invalid-omit", "2026-08-20T01:00:00.000Z"), [
      {
        record_id: "record-a",
        review_mode: "omit",
        review_omission_reason: "nothing exists to omit",
        input_hash: "hash",
      },
    ]),
  );
  db.close();
});

test("omission of an existing review persists the exact non-empty reason", () => {
  const { db, store } = seededStore();
  appendHumanReview(db, review("review-1", "2026-08-20T01:00:00.000Z"));
  const reason = "pre-registered sensitivity analysis without the decision";
  store.createAnalysisRun(run("omit-reviewed", "2026-08-20T02:00:00.000Z"), [
    {
      record_id: "record-a",
      review_mode: "omit",
      review_omission_reason: reason,
      input_hash: "hash",
    },
  ]);
  const input = store.listAnalysisInputs("omit-reviewed")[0];
  assert.equal(input?.review_binding_mode, "omit");
  assert.equal(input?.review_omission_reason, reason);
  db.close();
});

test("projection-only invalid reviewed_at causes atomic import failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-temporal-time-"));
  try {
    await writeImport(directory, [
      record({
        review_status: "included",
        review_note: "legacy projection",
        reviewed_by: "Teacher A",
        reviewed_at: "not-a-date",
      }),
    ]);
    assert.equal(storageProcess(directory).status, 7);
    assert.deepEqual(importCounts(directory), {
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

test("invalid reviewer_user_id is not silently discarded during import", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-temporal-reviewer-"));
  try {
    const imported = record({ metadata: {} }) as ExperimentRecord & {
      review_history?: unknown[];
    };
    imported.review_history = [
      {
        id: "review-1",
        status: "included",
        note: "legacy",
        reviewed_by: "Teacher A",
        reviewed_at: "2026-08-20T01:00:00.000Z",
        created_at: "2026-08-20T01:00:00.000Z",
        reviewer_user_id: 42,
      },
    ];
    await writeImport(directory, [imported]);
    assert.equal(storageProcess(directory).status, 7);
    assert.deepEqual(importCounts(directory), {
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

test("unresolved creator reference receives truthful audit metadata", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-temporal-creator-"));
  try {
    await writeImport(directory, [
      record({ created_by: "", created_by_user_id: "missing-user", metadata: {} }),
    ]);
    assert.equal(storageProcess(directory).status, 0);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const row = db
      .prepare("SELECT created_by_user_id,created_by_label,metadata_json FROM experiment_records")
      .get() as {
      created_by_user_id: string | null;
      created_by_label: string;
      metadata_json: string;
    };
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    assert.equal(row.created_by_user_id, null);
    assert.equal(row.created_by_label, "legacy-unknown");
    assert.equal(metadata.created_by_label_source, "unresolved_creator_reference");
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Migration 006 detects definite historical canonical submission disagreement", () => {
  const { db } = seededStore(MIGRATIONS.slice(0, 4));
  db.exec("DROP TRIGGER experiment_original_provenance_guard");
  const submitted = db
    .prepare("SELECT submitted_json FROM experiment_records WHERE id='record-a'")
    .get() as { submitted_json: string };
  const forged = JSON.parse(submitted.submitted_json) as Record<string, unknown>;
  forged.peel_mass = -99;
  db.prepare("UPDATE experiment_records SET submitted_json=? WHERE id='record-a'").run(
    JSON.stringify(forged),
  );
  assert.throws(() => runMigrations(db), /record-a.*peel_mass/i);
  assert.equal(
    (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number })
      .version,
    5,
  );
  db.close();
});

test("dish diameter change and image replacement invalidate browser calibration state", async () => {
  const modulePath = new URL("../../public/measurement-provenance.js", import.meta.url).href;
  await import(modulePath);
  const api = (
    globalThis as typeof globalThis & {
      EchoClassMeasurementProvenance?: {
        createState(): {
          imageLoaded(): void;
          calibrationCompleted(value: {
            dishDiameterMm: number;
            circleRadiusPx: number;
            plateDiameterPx: number;
          }): void;
          dishDiameterChanged(value: number): void;
          imageReplacementStarted(): void;
          fileReadFailed(): void;
          snapshot(): { imageState: string; method: string; calibration: unknown };
        };
      };
    }
  ).EchoClassMeasurementProvenance;
  assert.ok(api);
  const state = api.createState();
  state.imageLoaded();
  state.calibrationCompleted({ dishDiameterMm: 90, circleRadiusPx: 10, plateDiameterPx: 100 });
  assert.equal(state.snapshot().method, "manual_local_image_calibrated");
  state.dishDiameterChanged(100);
  assert.deepEqual(state.snapshot(), {
    imageState: "image_loaded",
    method: "manual_direct",
    calibration: null,
  });
  state.calibrationCompleted({ dishDiameterMm: 100, circleRadiusPx: 10, plateDiameterPx: 100 });
  state.imageReplacementStarted();
  assert.equal(state.snapshot().method, "manual_direct");
  assert.equal(state.snapshot().calibration, null);
  state.fileReadFailed();
  assert.equal(state.snapshot().imageState, "manual_only");
});

test("released migrations frozen preflight and v2 manifest binding remain immutable", async () => {
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
  assert.equal(MIGRATIONS[1]?.version, 2);
  assert.equal(MIGRATIONS[1]?.preflight, preflightAndPrepareMigration2);
  assert.deepEqual(
    MIGRATIONS.filter((migration) => migration.preflight).map((migration) => migration.version),
    [2, 10, 12, 14],
  );
});
