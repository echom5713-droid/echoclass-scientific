import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import type {
  CreateAnalysisRunCommand,
  PersistExperimentCommand,
  RecordReview,
} from "../src/domain/types.js";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
} from "../src/infrastructure/database/migrations/index.js";
import {
  SqliteProvenanceStore,
  type LegacyImportExperimentCommand,
} from "../src/infrastructure/database/sqlite-provenance-store.js";

type Row = Record<string, unknown>;

const V1 = "echoclass.analysis-input.v1";
const LEGACY = "echoclass.analysis-input.legacy";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function migrateThrough(db: DatabaseSync, version: number): void {
  runMigrations(db, MIGRATIONS.slice(0, version), () => "2026-08-24T00:00:00.000Z");
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count);
}

function seedUser(
  db: DatabaseSync,
  id = "user-a",
  role: "student" | "teacher" | "admin" = "student",
  name = role === "student" ? "Student A" : "Teacher A",
): void {
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
    peel_mass: 10,
    oil_mass: 1,
    distillation_time: 45,
    phase_clarity_score: 3,
    emulsification_level: "medium",
    emulsion_concentration: 20,
    ecoli_observation_group: "control",
    inhibition_zone_diameter: 10,
    colony_growth_score: 3,
    异常标记: false,
    error_source: "",
    note: "original",
    experiment_date: "2026-08-20",
    petri_diameter_mm: 90,
    measurement_method: "manual_direct",
    created_by_user_id: "user-a",
    created_by: "Student A",
    created_at: "2026-08-20T00:00:00.000Z",
    synced_from_offline: false,
    metadata: {},
    ...overrides,
  };
}

function analysisRun(overrides: Partial<CreateAnalysisRunCommand> = {}): CreateAnalysisRunCommand {
  return {
    id: "run-a",
    dataset_hash: "sha256:dataset-a",
    algorithm_version: "algorithm-a",
    configuration: {},
    code_version: "code-a",
    ...overrides,
  };
}

function insertBeta9LegacyReview(
  db: DatabaseSync,
  options: { id?: string; recordId?: string; timestamp?: string } = {},
): void {
  const id = options.id ?? "review-a";
  const recordId = options.recordId ?? "record-a";
  const timestamp = options.timestamp ?? "2026-08-20T01:00:00.000Z";
  const projectionUpdatedAt = new Date(Date.parse(timestamp) + 1).toISOString();
  db.prepare(
    `INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind,projection_updated_at
    ) VALUES(?,?,NULL,'Historical Teacher','included','beta.9 legacy projection',
      ?,?,'legacy_projection',?)`,
  ).run(id, recordId, timestamp, timestamp, projectionUpdatedAt);
}

function storeAt(db: DatabaseSync, timestamp: string): SqliteProvenanceStore {
  return new SqliteProvenanceStore(db, { now: () => timestamp });
}

function createExactInput(
  db: DatabaseSync,
  runId: string,
  mode: "effective" | "omit" = "effective",
  recordId = "record-a",
  reviewId = "review-a",
): void {
  storeAt(db, "2026-08-20T02:00:00.000Z").createAnalysisRun(
    analysisRun({ id: runId, dataset_hash: `sha256:${runId}` }),
    [
      mode === "effective"
        ? {
            record_id: recordId,
            review_id: reviewId,
            review_mode: "effective",
            input_hash: `sha256:${runId}:input`,
          }
        : {
            record_id: recordId,
            review_mode: "omit",
            review_omission_reason: "review deliberately omitted",
            input_hash: `sha256:${runId}:input`,
          },
    ],
  );
}

function schema11Exploit(options: { directRun?: string; omitRun?: string } = {}): DatabaseSync {
  const db = database();
  migrateThrough(db, 10);
  seedUser(db);
  new SqliteProvenanceStore(db).add(command());
  insertBeta9LegacyReview(db);
  migrateThrough(db, 11);
  if (options.directRun) createExactInput(db, options.directRun, "effective");
  if (options.omitRun) createExactInput(db, options.omitRun, "omit");
  return db;
}

function migrateCurrent(db: DatabaseSync): number {
  return runMigrations(db, MIGRATIONS, () => "2026-08-24T01:00:00.000Z").currentVersion;
}

function classificationRows(db: DatabaseSync, entityType: string, entityId: string): Row[] {
  return db
    .prepare(
      `SELECT * FROM provenance_boundary_classifications
       WHERE entity_type=? AND entity_id=? ORDER BY classification_id`,
    )
    .all(entityType, entityId);
}

function legacyCommand(
  overrides: Partial<LegacyImportExperimentCommand> = {},
): LegacyImportExperimentCommand {
  return {
    ...command({
      id: "legacy-record-a",
      created_by_user_id: undefined as never,
      created_by: "Historical notebook label",
    }),
    storage_import_id: "json-startup-v1",
    ...overrides,
  };
}

function legacyReview(overrides: Partial<RecordReview> = {}): RecordReview {
  return {
    id: "legacy-review-a",
    record_id: "legacy-record-a",
    status: "included",
    note: "legacy projection",
    reviewed_by: "Historical Teacher",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "legacy_projection",
    ...overrides,
  };
}

function openImport(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO legacy_import_batches(
      id,source_kind,source_user_count,source_record_count,opened_at
    ) VALUES('json-startup-v1','startup_json_snapshot',0,1,'2026-08-20T00:00:00.000Z')`,
  ).run();
}

function completeImport(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('json-startup-v1','startup_json_snapshot',0,1,?,?,'imported',?)`,
  ).run(count(db, "users"), count(db, "experiment_records"), "2026-08-20T02:00:00.000Z");
}

function completedLegacyImport(): DatabaseSync {
  const db = database();
  migrateThrough(db, 10);
  const store = storeAt(db, "2026-08-20T03:00:00.000Z");
  db.exec("BEGIN IMMEDIATE");
  try {
    openImport(db);
    store.importExperiment(legacyCommand());
    store.importReview(legacyReview());
    completeImport(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  migrateCurrent(db);
  return db;
}

test("2A.10-01 schema-10 exploit enters exact at schema 11 and is quarantined by Migration 012", () => {
  const db = database();
  try {
    migrateThrough(db, 10);
    seedUser(db);
    new SqliteProvenanceStore(db).add(command());
    insertBeta9LegacyReview(db);
    assert.equal(
      (
        db
          .prepare("SELECT effective_review_id FROM experiment_records WHERE id='record-a'")
          .get() as Row
      ).effective_review_id,
      "review-a",
    );

    migrateThrough(db, 11);
    new SqliteProvenanceStore(db, { now: () => "2026-08-20T02:00:00.000Z" }).createAnalysisRun(
      analysisRun(),
      [{ record_id: "record-a", review_id: "review-a", input_hash: "sha256:input-a" }],
    );
    const vulnerable = db
      .prepare(
        `SELECT ar.dataset_classification,ai.snapshot_schema
         FROM analysis_runs ar JOIN analysis_inputs ai ON ai.analysis_run_id=ar.id
         WHERE ar.id='run-a'`,
      )
      .get() as Row;
    assert.equal(vulnerable.dataset_classification, "exact");
    assert.equal(vulnerable.snapshot_schema, V1);

    runMigrations(db, MIGRATIONS, () => "2026-08-24T01:00:00.000Z");
    const repaired = db
      .prepare(
        `SELECT ar.dataset_classification,ai.snapshot_schema
         FROM analysis_runs ar JOIN analysis_inputs ai ON ai.analysis_run_id=ar.id
         WHERE ar.id='run-a'`,
      )
      .get() as Row;
    assert.equal(repaired.snapshot_schema, LEGACY);
    assert.equal(repaired.dataset_classification, "legacy_unverified");
  } finally {
    db.close();
  }
});

test("2A.10-02 Migration 012 detects canonical_submission plus legacy_projection", () => {
  const db = schema11Exploit();
  try {
    assert.equal(migrateCurrent(db), LATEST_SCHEMA_VERSION);
    const rows = classificationRows(db, "review", "review-a");
    assert.ok(
      rows.some(
        (row) =>
          row.classification_migration_version === 12 &&
          row.classification_migration_name === "historical_legacy_review_quarantine" &&
          row.classification === "legacy_review_authority_unverified",
      ),
    );
  } finally {
    db.close();
  }
});

test("2A.10-03 offending immutable review row is preserved byte-for-byte", () => {
  const db = schema11Exploit();
  try {
    const before = JSON.stringify(
      db.prepare("SELECT * FROM record_reviews WHERE id='review-a'").get(),
    );
    migrateCurrent(db);
    const after = JSON.stringify(
      db.prepare("SELECT * FROM record_reviews WHERE id='review-a'").get(),
    );
    assert.equal(after, before);
  } finally {
    db.close();
  }
});

test("2A.10-04 durable review classification records exact review record and reason", () => {
  const db = schema11Exploit();
  try {
    migrateCurrent(db);
    const row = classificationRows(db, "review", "review-a").find(
      (candidate) => candidate.classification === "legacy_review_authority_unverified",
    );
    assert.ok(row);
    assert.equal(row.observed_value, "record-a");
    assert.match(String(row.reason), /review-a/i);
    assert.match(String(row.reason), /record-a/i);
    assert.match(String(row.reason), /legacy_projection.*canonical_submission/i);
  } finally {
    db.close();
  }
});

test("2A.10-05 all new exact selection modes fail closed after quarantine", () => {
  const db = schema11Exploit();
  try {
    migrateCurrent(db);
    const store = storeAt(db, "2026-08-20T03:00:00.000Z");
    const selections = [
      {
        runId: "effective-after-quarantine",
        selection: {
          record_id: "record-a",
          review_id: "review-a",
          review_mode: "effective" as const,
          input_hash: "sha256:effective",
        },
      },
      {
        runId: "omit-after-quarantine",
        selection: {
          record_id: "record-a",
          review_mode: "omit" as const,
          review_omission_reason: "omit quarantined review",
          input_hash: "sha256:omit",
        },
      },
      {
        runId: "none-after-quarantine",
        selection: {
          record_id: "record-a",
          review_mode: "none" as const,
          input_hash: "sha256:none",
        },
      },
    ];
    for (const value of selections)
      assert.throws(
        () =>
          store.createAnalysisRun(
            analysisRun({ id: value.runId, dataset_hash: `sha256:${value.runId}` }),
            [value.selection],
          ),
        /historically unverified/i,
      );
    assert.equal(count(db, "analysis_runs"), 0);
  } finally {
    db.close();
  }
});

test("2A.10-06 direct offending review binding is downgraded without rewriting snapshots", () => {
  const db = schema11Exploit({ directRun: "direct-run" });
  try {
    const before = db
      .prepare(
        `SELECT record_snapshot_json,review_snapshot_json
         FROM analysis_inputs WHERE analysis_run_id='direct-run'`,
      )
      .get() as Row;
    migrateCurrent(db);
    const after = db
      .prepare(
        `SELECT ai.record_snapshot_json,ai.review_snapshot_json,ai.snapshot_schema,
                ai.review_binding_mode,ar.dataset_classification
         FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
         WHERE ai.analysis_run_id='direct-run'`,
      )
      .get() as Row;
    assert.equal(after.record_snapshot_json, before.record_snapshot_json);
    assert.equal(after.review_snapshot_json, before.review_snapshot_json);
    assert.equal(after.snapshot_schema, LEGACY);
    assert.equal(after.review_binding_mode, "legacy_unspecified");
    assert.equal(after.dataset_classification, "legacy_unverified");
    assert.ok(
      classificationRows(db, "analysis_input", "direct-run#0").some(
        (row) => row.classification === "legacy_unverified_analysis_input",
      ),
    );
  } finally {
    db.close();
  }
});

test("2A.10-07 omit snapshot referencing the offending review is not left exact", () => {
  const db = schema11Exploit({ omitRun: "omit-run" });
  try {
    const before = db
      .prepare(
        `SELECT record_snapshot_json,review_id,review_snapshot_json
         FROM analysis_inputs WHERE analysis_run_id='omit-run'`,
      )
      .get() as Row;
    assert.equal(before.review_id, null);
    assert.equal(before.review_snapshot_json, null);
    const recordSnapshot: unknown = JSON.parse(String(before.record_snapshot_json));
    assert.ok(recordSnapshot && typeof recordSnapshot === "object");
    assert.equal(Reflect.get(recordSnapshot, "effective_review_id"), "review-a");
    migrateCurrent(db);
    const after = db
      .prepare(
        `SELECT ai.record_snapshot_json,ai.review_snapshot_json,ai.snapshot_schema,
                ai.review_binding_mode,ar.dataset_classification
         FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
         WHERE ai.analysis_run_id='omit-run'`,
      )
      .get() as Row;
    assert.equal(after.record_snapshot_json, before.record_snapshot_json);
    assert.equal(after.review_snapshot_json, before.review_snapshot_json);
    assert.equal(after.snapshot_schema, LEGACY);
    assert.equal(after.review_binding_mode, "legacy_unspecified");
    assert.equal(after.dataset_classification, "legacy_unverified");
  } finally {
    db.close();
  }
});

test("2A.10-08 legitimate imported legacy review remains readable", () => {
  const db = completedLegacyImport();
  try {
    const review = new SqliteProvenanceStore(db).getEffectiveReview("legacy-record-a");
    assert.ok(review);
    assert.equal(review.id, "legacy-review-a");
    assert.equal(review.provenance_kind, "legacy_projection");
    assert.equal(
      classificationRows(db, "review", "legacy-review-a").filter(
        (row) => row.classification === "legacy_review_authority_unverified",
      ).length,
      0,
    );
  } finally {
    db.close();
  }
});

test("2A.10-09 legitimate historical imported review without per-review batch evidence is preserved", () => {
  const db = database();
  try {
    migrateThrough(db, 9);
    seedUser(db);
    const store = storeAt(db, "2026-08-20T02:00:00.000Z");
    store.add(command({ id: "legacy-record-a" }));
    const originalGuard = String(
      (
        db
          .prepare(
            `SELECT sql FROM sqlite_master
             WHERE type='trigger' AND name='experiment_original_provenance_guard'`,
          )
          .get() as Row
      ).sql,
    );
    db.exec("DROP TRIGGER experiment_original_provenance_guard");
    db.exec(
      `UPDATE experiment_records SET submission_kind='legacy_canonical_snapshot'
       WHERE id='legacy-record-a'`,
    );
    db.exec(originalGuard);
    insertBeta9LegacyReview(db, {
      id: "legacy-review-a",
      recordId: "legacy-record-a",
    });
    migrateCurrent(db);
    const record = db
      .prepare("SELECT submission_kind,storage_import_id FROM experiment_records")
      .get() as Row;
    assert.equal(record.submission_kind, "legacy_canonical_snapshot");
    assert.equal(record.storage_import_id, null);
    assert.equal(store.getEffectiveReview("legacy-record-a")?.id, "legacy-review-a");
    assert.equal(
      classificationRows(db, "review", "legacy-review-a").filter(
        (row) => row.classification === "legacy_review_authority_unverified",
      ).length,
      0,
    );
  } finally {
    db.close();
  }
});

test("2A.10-10 Migration 011 prospective canonical-target guard remains active", () => {
  const db = schema11Exploit();
  try {
    migrateCurrent(db);
    assert.throws(() =>
      insertBeta9LegacyReview(db, {
        id: "future-canonical-legacy",
        timestamp: "2026-08-20T03:00:00.000Z",
      }),
    );
    assert.equal(count(db, "record_reviews"), 1);
  } finally {
    db.close();
  }
});

test("2A.10-11 post-completion raw legacy review remains rejected", () => {
  const db = completedLegacyImport();
  try {
    assert.throws(() =>
      insertBeta9LegacyReview(db, {
        id: "post-completion-review",
        recordId: "legacy-record-a",
        timestamp: "2026-08-20T03:00:00.000Z",
      }),
    );
    assert.equal(count(db, "record_reviews"), 1);
  } finally {
    db.close();
  }
});

test("2A.10-12 open import batch still cannot commit without a marker", () => {
  const db = database();
  migrateCurrent(db);
  const store = storeAt(db, "2026-08-20T02:00:00.000Z");
  try {
    db.exec("BEGIN IMMEDIATE");
    openImport(db);
    store.importExperiment(legacyCommand());
    assert.throws(() => db.exec("COMMIT"));
    db.exec("ROLLBACK");
    assert.equal(count(db, "experiment_records"), 0);
    assert.equal(count(db, "legacy_import_batches"), 0);
  } finally {
    db.close();
  }
});

test("2A.10-13 authorized human review after import completion still succeeds", () => {
  const db = completedLegacyImport();
  try {
    seedUser(db, "teacher-a", "teacher", "Teacher A");
    const record = storeAt(db, "2026-08-20T03:00:00.000Z").appendReview({
      record_id: "legacy-record-a",
      reviewer_user_id: "teacher-a",
      status: "excluded",
      note: "teacher decision",
      reviewed_by: "Teacher A",
    });
    assert.ok(record);
    assert.equal(record.review_status, "excluded");
    assert.equal(
      new SqliteProvenanceStore(db).getEffectiveReview("legacy-record-a")?.provenance_kind,
      "human",
    );
  } finally {
    db.close();
  }
});

test("2A.10-14 classification ledger is resealed after Migration 012", () => {
  const db = schema11Exploit();
  try {
    migrateCurrent(db);
    assert.throws(() =>
      db.exec(`INSERT INTO provenance_boundary_classifications(
        classification_migration_version,classification_migration_name,
        entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
      ) VALUES(999,'runtime','record','record-a','created_at','forged_unverified',
        'not-shown','runtime write','2026-08-24T02:00:00.000Z')`),
    );
  } finally {
    db.close();
  }
});

test("2A.10-15 migrations 001 through 011 remain frozen", async () => {
  const source = await readFile(
    "src/infrastructure/database/migrations/011-legacy-review-import-authority.ts",
  );
  const hash = spawnSync("git", ["hash-object", "--stdin"], { input: source });
  assert.equal(hash.status, 0);
  assert.equal(hash.stdout.toString().trim(), "91fb979d434a493759e3ef21bbde0369938a539e");
  assert.deepEqual(
    MIGRATIONS.slice(0, 11).map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});
