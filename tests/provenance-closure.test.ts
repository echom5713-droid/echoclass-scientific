import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ReviewService } from "../src/application/review-service.js";
import { validateExperiment } from "../src/domain/experiments/validation.js";
import type {
  AuditRepository,
  ExperimentRepository,
  ReviewRepository,
} from "../src/domain/repositories.js";
import type { AnalysisRun, ExperimentRecord, RecordReview, Session } from "../src/domain/types.js";
import { parseCreateExperiment } from "../src/http/schemas/experiment.js";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
} from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
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
    note: "closure",
    experiment_date: "2026-08-20",
    petri_diameter_mm: 90,
    measurement_method: "manual_local_image_calibrated",
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
    note: "accepted",
    reviewed_by: "teacher-a",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "human",
    ...overrides,
  };
}

function run(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: "run-a",
    dataset_hash: "dataset-a",
    algorithm_version: "none",
    configuration: {},
    code_version: "test",
    status: "pending",
    results_metadata: {},
    created_at: "2026-08-20T02:00:00.000Z",
    ...overrides,
  };
}

function rawPendingAnalysisRun(
  db: DatabaseSync,
  id: string,
  createdAt = "2026-08-20T02:00:00.000Z",
): void {
  const value = run({ id });
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

function insertLegacy(db: DatabaseSync, id: string, data: object, legacyYield = 1): void {
  db.prepare(
    `INSERT INTO records(
      id, class_name, created_by, student_name, nh4cl_concentration,
      yield_percent, created_at, data_json
    ) VALUES(?, 'Class A', 'user-a', 'Student A', 3, ?, ?, ?)`,
  ).run(id, legacyYield, "2026-08-20T00:00:00.000Z", JSON.stringify(data));
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

async function writeImportFiles(
  directory: string,
  records: unknown[],
  includeTeacher = false,
): Promise<void> {
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
    ...(includeTeacher
      ? [
          {
            id: "teacher-a",
            role: "teacher",
            username: "teacher-a",
            passwordHash: "scrypt$test",
            defaultPassword: false,
            name: "teacher-a",
            class_name: "Class A",
            group_name: "",
            status: "active",
            created_at: "2026-08-20T00:00:00.000Z",
          },
        ]
      : []),
  ];
  await writeFile(path.join(directory, "users.json"), JSON.stringify(users), "utf8");
  await writeFile(path.join(directory, "records.json"), JSON.stringify(records), "utf8");
}

test("released migration sources match accepted fingerprints", () => {
  const expected = new Map([
    ["001-initial-schema.ts", "ba1c161de326f446a01eeac308816ba67bee41b6"],
    ["002-normalized-provenance.ts", "5c7a8485486c99a4b55c1c8bee2b37e2691559d5"],
    ["003-provenance-integrity-hardening.ts", "2061186b4a757023a1861000e892cbc6204a589a"],
  ]);
  for (const [file, hash] of expected) {
    const result = spawnSync(
      "git",
      ["hash-object", `src/infrastructure/database/migrations/${file}`],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), hash, file);
  }
});

test("legacy measurement provenance is recovered from migration metadata", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  seedUser(db, "user-a");
  const legacy = record({ id: "legacy-measure", created_by_user_id: undefined });
  const data = {
    ...legacy,
    experiment_date: "2026-08-19",
    petri_diameter_mm: 90,
    measurement_method: "manual_local_image_calibrated",
  };
  insertLegacy(db, "legacy-measure", data);
  runMigrations(db);
  const stored = new SqliteProvenanceStore(db).findById("legacy-measure");
  assert.equal(stored?.experiment_date, "2026-08-19");
  assert.equal(stored?.petri_diameter_mm, 90);
  assert.equal(stored?.measurement_method, "manual_local_image_calibrated");
  const metadata = JSON.parse(
    (
      db
        .prepare("SELECT metadata_json FROM experiment_records WHERE id='legacy-measure'")
        .get() as {
        metadata_json: string;
      }
    ).metadata_json,
  ) as Record<string, unknown>;
  assert.equal(metadata.measurement_provenance_source, "legacy_metadata");
  db.close();
});

test("legacy measurement recovery merges defensible fields across both sources", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  seedUser(db, "user-a");
  const legacy = record({ id: "legacy-split", created_by_user_id: undefined });
  insertLegacy(db, "legacy-split", { ...legacy, experiment_date: "2026-08-19" });
  runMigrations(db, MIGRATIONS.slice(0, 3));
  const submitted = JSON.parse(
    (
      db.prepare("SELECT submitted_json FROM experiment_records WHERE id='legacy-split'").get() as {
        submitted_json: string;
      }
    ).submitted_json,
  ) as Record<string, unknown>;
  db.prepare("UPDATE experiment_records SET submitted_json=? WHERE id='legacy-split'").run(
    JSON.stringify({ ...submitted, experiment_date: "2026-08-19" }),
  );
  db.prepare("UPDATE experiment_records SET metadata_json=? WHERE id='legacy-split'").run(
    JSON.stringify({
      petri_diameter_mm: 90,
      measurement_method: "manual_local_image_calibrated",
    }),
  );
  runMigrations(db);
  const stored = new SqliteProvenanceStore(db).findById("legacy-split");
  assert.equal(stored?.experiment_date, "2026-08-19");
  assert.equal(stored?.petri_diameter_mm, 90);
  assert.equal(stored?.measurement_method, "manual_local_image_calibrated");
  db.close();
});

test("canonical repository insertion recomputes forged yield", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record({ yield_percent: 99 }));
  assert.equal(store.findById("record-a")?.yield_percent, 1);
  db.close();
});

test("canonical repository insertion rejects negative scientific values", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  assert.throws(() => store.add(record({ peel_mass: -100 })));
  assert.equal(store.findById("record-a"), null);
  db.close();
});

test("canonical repository insertion rejects coercible numeric types", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  assert.throws(() => store.add(record({ phase_clarity_score: "4" as unknown as number })));
  assert.equal(store.findById("record-a"), null);
  db.close();
});

test("canonical repository insertion rejects coercible boolean types", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  assert.throws(() => store.add(record({ 异常标记: "false" as unknown as boolean })));
  assert.equal(store.findById("record-a"), null);
  db.close();
});

test("canonical repository insertion rejects forged human review projection", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  assert.throws(() =>
    store.add(
      record({
        review_status: "included",
        review_note: "forged",
        reviewed_by: "admin",
        reviewed_at: "2026-08-20T01:00:00.000Z",
      }),
    ),
  );
  db.close();
});

test("nonempty authoritative SQLite ignores malformed stale JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-authoritative-"));
  try {
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
    runMigrations(db);
    seedUser(db, "user-a");
    new SqliteProvenanceStore(db).add(record());
    db.close();
    await writeFile(path.join(directory, "users.json"), "{malformed", "utf8");
    await writeFile(path.join(directory, "records.json"), "{malformed", "utf8");
    assert.equal(storageProcess(directory).status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON import rejects invalid science and remains empty", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-invalid-import-"));
  try {
    await writeImportFiles(directory, [record({ peel_mass: -100 })]);
    assert.equal(storageProcess(directory).status, 7);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const count = (
      db.prepare("SELECT COUNT(*) count FROM experiment_records").get() as { count: number }
    ).count;
    db.close();
    assert.equal(count, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON import is all-or-nothing and a corrected restart is deterministic", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-atomic-import-"));
  try {
    await writeImportFiles(directory, [record(), record()]);
    assert.equal(storageProcess(directory).status, 7);
    let db = new DatabaseSync(path.join(directory, "citrus.db"));
    assert.equal(
      (db.prepare("SELECT COUNT(*) count FROM users").get() as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) count FROM experiment_records").get() as { count: number })
        .count,
      0,
    );
    db.close();

    await writeImportFiles(directory, [record()]);
    assert.equal(storageProcess(directory).status, 0);
    assert.equal(storageProcess(directory).status, 0);
    db = new DatabaseSync(path.join(directory, "citrus.db"));
    assert.equal(
      (db.prepare("SELECT COUNT(*) count FROM users").get() as { count: number }).count,
      1,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) count FROM experiment_records").get() as { count: number })
        .count,
      1,
    );
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON import converts defensible review history into events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-review-import-"));
  try {
    const imported = record({
      metadata: { review_history: [review()] as unknown as string },
    });
    await writeImportFiles(directory, [imported], true);
    assert.equal(storageProcess(directory).status, 0);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const event = db
      .prepare("SELECT decision, provenance_kind FROM record_reviews WHERE record_id='record-a'")
      .get() as { decision: string; provenance_kind: string } | undefined;
    db.close();
    assert.deepEqual({ ...event }, { decision: "included", provenance_kind: "human" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON import converts projection-only review into an explicit legacy event", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-projection-import-"));
  try {
    await writeImportFiles(directory, [
      record({
        review_status: "excluded",
        review_note: "legacy projection",
        reviewed_by: "legacy teacher",
        reviewed_at: "",
      }),
    ]);
    assert.equal(storageProcess(directory).status, 0);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const event = db
      .prepare("SELECT decision, provenance_kind FROM record_reviews WHERE record_id='record-a'")
      .get() as { decision: string; provenance_kind: string } | undefined;
    db.close();
    assert.deepEqual({ ...event }, { decision: "excluded", provenance_kind: "legacy_projection" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON projection import preserves an explicit defensible historical review time", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-timed-projection-import-"));
  try {
    const historicalTime = "2026-08-20T01:00:00.000Z";
    await writeImportFiles(directory, [
      record({
        review_status: "included",
        review_note: "historical projection",
        reviewed_by: "legacy teacher",
        reviewed_at: historicalTime,
      }),
    ]);
    assert.equal(storageProcess(directory).status, 0);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const event = db
      .prepare(
        `SELECT rr.created_at,rr.decided_at,er.updated_at
         FROM record_reviews rr JOIN experiment_records er ON er.id=rr.record_id
         WHERE rr.record_id='record-a'`,
      )
      .get() as { created_at: string; decided_at: string; updated_at: string };
    db.close();
    assert.equal(event.created_at, historicalTime);
    assert.equal(event.decided_at, historicalTime);
    assert.ok(Date.parse(event.updated_at) > Date.parse(historicalTime));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("raw SQL cannot forge a review projection", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(record());
  assert.throws(() =>
    db.exec(
      "UPDATE experiment_records SET review_status='included', review_note='forged', reviewed_by='admin' WHERE id='record-a'",
    ),
  );
  db.close();
});

test("record INSERT cannot point at another record review", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  appendHumanReview(db, review());
  assert.throws(() =>
    cloneRecordRaw(db, "record-a", "record-b", { effective_review_id: "'review-a'" }),
  );
  db.close();
});

test("v1 record snapshot rejects empty objects at the database boundary", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  rawPendingAnalysisRun(db, "run-a");
  assert.throws(() =>
    db.exec(
      `INSERT INTO analysis_inputs(
        analysis_run_id,ordinal,record_id,review_id,input_hash,
        record_snapshot_json,review_snapshot_json,snapshot_schema,
        review_binding_mode,review_omission_reason
      ) VALUES('run-a',0,'record-a',NULL,'hash','{}',NULL,
        'echoclass.analysis-input.v1','none',NULL)`,
    ),
  );
  db.close();
});

test("v1 snapshot IDs must match analysis input columns", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  rawPendingAnalysisRun(db, "run-a");
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO analysis_inputs(
        analysis_run_id,ordinal,record_id,review_id,input_hash,
        record_snapshot_json,review_snapshot_json,snapshot_schema,
        review_binding_mode,review_omission_reason
      ) VALUES('run-a',0,'record-a',NULL,'hash',?,NULL,
        'echoclass.analysis-input.v1','none',NULL)`,
      )
      .run(JSON.stringify(record({ id: "wrong-id" }))),
  );
  db.close();
});

test("v1 database contract rejects missing science and incomplete review snapshots", () => {
  {
    const db = database();
    runMigrations(db);
    seedUser(db, "user-a");
    const store = new SqliteProvenanceStore(db);
    store.add(record());
    store.createAnalysisRun(run({ id: "seed-run" }), [
      { record_id: "record-a", input_hash: "seed" },
    ]);
    const incomplete = {
      ...store.listAnalysisInputs("seed-run")[0]!.record_snapshot,
    } as Partial<ExperimentRecord>;
    delete incomplete.emulsification_level;
    const sourceCreatedAt = (
      db.prepare("SELECT created_at FROM analysis_runs WHERE id='seed-run'").get() as {
        created_at: string;
      }
    ).created_at;
    rawPendingAnalysisRun(db, "run-a", sourceCreatedAt);
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO analysis_inputs(
            analysis_run_id,ordinal,record_id,review_id,input_hash,
            record_snapshot_json,review_snapshot_json,snapshot_schema,
            review_binding_mode,review_omission_reason
          ) VALUES('run-a',0,'record-a',NULL,'hash',?,NULL,
            'echoclass.analysis-input.v1','none',NULL)`,
        )
        .run(JSON.stringify(incomplete)),
    );
    db.close();
  }
  {
    const db = database();
    runMigrations(db);
    seedUser(db, "user-a");
    seedUser(db, "teacher-a", "teacher");
    const store = new SqliteProvenanceStore(db);
    store.add(record());
    appendHumanReview(db, review());
    store.createAnalysisRun(run({ id: "seed-run" }), [
      { record_id: "record-a", input_hash: "seed" },
    ]);
    const validRecordSnapshot = store.listAnalysisInputs("seed-run")[0]!.record_snapshot;
    const sourceCreatedAt = (
      db.prepare("SELECT created_at FROM analysis_runs WHERE id='seed-run'").get() as {
        created_at: string;
      }
    ).created_at;
    rawPendingAnalysisRun(db, "run-a", sourceCreatedAt);
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO analysis_inputs(
            analysis_run_id,ordinal,record_id,review_id,input_hash,
            record_snapshot_json,review_snapshot_json,snapshot_schema,
            review_binding_mode,review_omission_reason
          ) VALUES('run-a',0,'record-a','review-a','hash',?,?,
            'echoclass.analysis-input.v1','effective',NULL)`,
        )
        .run(
          JSON.stringify(validRecordSnapshot),
          JSON.stringify({
            id: "review-a",
            record_id: "record-a",
            status: "included",
            created_at: "2026-08-20T01:00:00.000Z",
            provenance_kind: "human",
          }),
        ),
    );
    db.close();
  }
});

test("reviewed analysis input binds the effective review when omitted", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  appendHumanReview(db, review());
  store.createAnalysisRun(run(), [{ record_id: "record-a", input_hash: "hash" }]);
  const input = store.listAnalysisInputs("run-a")[0];
  assert.equal(input?.review_id, "review-a");
  assert.equal(input?.review_snapshot?.id, "review-a");
  db.close();
});

test("analysis input cannot silently bind a stale review instead of the effective event", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  appendHumanReview(db, review({ id: "review-first" }));
  appendHumanReview(
    db,
    review({
      id: "review-effective",
      status: "excluded",
      reviewed_at: "2026-08-20T02:00:00.000Z",
      created_at: "2026-08-20T02:00:00.000Z",
    }),
  );
  assert.throws(() =>
    store.createAnalysisRun(run(), [
      { record_id: "record-a", review_id: "review-first", input_hash: "hash" },
    ]),
  );
  assert.equal(store.findAnalysisRun("run-a"), null);
  db.close();
});

test("original submission and identity fields are database immutable", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(
    record({ client_submission_id: "offline-a", synced_from_offline: true }),
  );
  for (const sql of [
    "UPDATE experiment_records SET submitted_json='{}' WHERE id='record-a'",
    "UPDATE experiment_records SET submission_kind='legacy_canonical_snapshot' WHERE id='record-a'",
    "UPDATE experiment_records SET created_at='2099-01-01T00:00:00.000Z' WHERE id='record-a'",
    "UPDATE experiment_records SET client_submission_id='changed' WHERE id='record-a'",
  ])
    assert.throws(() => db.exec(sql), sql);
  db.close();
});

test("authorized audit history remains available after archival", async () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  appendHumanReview(db, review());
  store.delete("record-a");
  const service = new ReviewService(
    store as unknown as ExperimentRepository,
    store as unknown as ReviewRepository,
    { write: async () => undefined } satisfies AuditRepository,
    { random: () => "fixed", hashSession: (value) => value },
  );
  const teacher: Session = {
    id: "teacher-a",
    role: "teacher",
    username: "teacher-a",
    name: "Teacher A",
    class_name: "Class A",
    group_name: "",
  };
  assert.equal((await service.history(teacher, "record-a")).length, 1);
  await assert.rejects(() =>
    service.history({ ...teacher, role: "student", id: "user-a" }, "record-a"),
  );
  db.close();
});

test("legacy canonical yield is recomputed while stale evidence is retained", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!]);
  seedUser(db, "user-a");
  insertLegacy(
    db,
    "legacy-yield",
    record({ id: "legacy-yield", created_by_user_id: undefined, yield_percent: 99 }),
    99,
  );
  runMigrations(db);
  const stored = new SqliteProvenanceStore(db).findById("legacy-yield");
  assert.equal(stored?.yield_percent, 1);
  const metadata = JSON.parse(
    (
      db.prepare("SELECT metadata_json FROM experiment_records WHERE id='legacy-yield'").get() as {
        metadata_json: string;
      }
    ).metadata_json,
  ) as Record<string, unknown>;
  assert.equal(metadata.legacy_reported_yield_percent, 99);
  db.close();
});

test("JSON import parses the string false without truthiness", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-false-import-"));
  try {
    await writeImportFiles(directory, [{ ...record(), 异常标记: "false" }]);
    assert.equal(storageProcess(directory).status, 0);
    const db = new DatabaseSync(path.join(directory, "citrus.db"));
    const row = db
      .prepare("SELECT anomaly_flag FROM experiment_records WHERE id='record-a'")
      .get() as { anomaly_flag: number };
    db.close();
    assert.equal(row.anomaly_flag, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline idempotency retains its original class scope after reclassification", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record({ client_submission_id: "offline-a", synced_from_offline: true }));
  store.update("record-a", { class_name: "Class B", group_name: "Group B" });
  const original = store.findByClientSubmission({
    actorId: "user-a",
    className: "Class A",
    clientSubmissionId: "offline-a",
  });
  assert.equal(original?.id, "record-a");
  db.close();
});

test("calibrated measurement requires a valid Petri diameter", () => {
  const payload = {
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
    note: "closure",
    measurement_method: "manual_local_image_calibrated",
    measurement_image_state: "calibrated_complete",
  };
  const parsed = parseCreateExperiment(payload);
  assert.equal(
    validateExperiment(parsed).some((finding) => finding.field === "petri_diameter_mm"),
    true,
  );
});

test("analysis run identity and configuration fields are immutable", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  store.createAnalysisRun(run(), [{ record_id: "record-a", input_hash: "hash" }]);
  for (const sql of [
    "UPDATE analysis_runs SET dataset_hash='forged' WHERE id='run-a'",
    "UPDATE analysis_runs SET algorithm_version='forged' WHERE id='run-a'",
    "UPDATE analysis_runs SET configuration_json='{\"changed\":true}' WHERE id='run-a'",
    "UPDATE analysis_runs SET code_version='forged' WHERE id='run-a'",
    "UPDATE analysis_runs SET created_at='2099-01-01T00:00:00.000Z' WHERE id='run-a'",
  ])
    assert.throws(() => db.exec(sql), sql);
  assert.equal(
    store.updateAnalysisRunState("run-a", { status: "running", results_metadata: {} })?.status,
    "running",
  );
  assert.equal(
    store.updateAnalysisRunState("run-a", {
      status: "completed",
      results_metadata: { outcome: "test-only" },
      completed_at: "2026-08-20T03:00:00.000Z",
    })?.status,
    "completed",
  );
  assert.throws(() =>
    store.updateAnalysisRunState("run-a", { status: "running", results_metadata: {} }),
  );
  db.close();
});

test("migrations 004 through 017 upgrade realistic v2 and v3 databases without data loss", async () => {
  assert.equal(MIGRATIONS[8]?.version, 9);
  assert.equal(MIGRATIONS[15]?.version, 16);
  for (const prefix of [2, 3]) {
    const db = database();
    runMigrations(db, [MIGRATIONS[0]!]);
    seedUser(db, "user-a");
    insertLegacy(db, "record-a", record({ created_by_user_id: undefined }));
    runMigrations(db, MIGRATIONS.slice(0, prefix));
    const before = db
      .prepare("SELECT id,created_at,submitted_json FROM experiment_records WHERE id='record-a'")
      .get() as { id: string; created_at: string; submitted_json: string };
    runMigrations(db);
    const after = db
      .prepare("SELECT id,created_at,submitted_json FROM experiment_records WHERE id='record-a'")
      .get() as { id: string; created_at: string; submitted_json: string };
    assert.deepEqual({ ...after }, { ...before });
    assert.equal(
      (
        db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
      LATEST_SCHEMA_VERSION,
    );
    db.close();
  }
  assert.ok(
    (
      await readFile(
        "src/infrastructure/database/migrations/004-end-to-end-provenance-closure.ts",
        "utf8",
      )
    ).length > 0,
  );
});
