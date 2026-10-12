import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { PersistExperimentCommand, RecordReview } from "../src/domain/types.js";
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

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function migrateThrough10(db: DatabaseSync): void {
  runMigrations(db, MIGRATIONS.slice(0, 10), () => "2026-08-24T00:00:00.000Z");
}

function migrateCurrent(db: DatabaseSync): void {
  runMigrations(db, MIGRATIONS, () => "2026-08-24T01:00:00.000Z");
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count);
}

function seedUser(
  db: DatabaseSync,
  id: string,
  role: "student" | "teacher" | "admin" = "student",
  name = role === "student" ? "Student A" : "Teacher A",
): void {
  db.prepare(
    `INSERT INTO users(
      id,role,username,password_hash,default_password,name,class_name,group_name,
      status,data_json,created_at,updated_at
    ) VALUES(?,?,?,'scrypt$test',0,?,'Class A',?,'active','{}',?,NULL)`,
  ).run(id, role, id, name, role === "student" ? "Group A" : "", "2026-08-20T00:00:00.000Z");
}

function canonicalCommand(
  overrides: Partial<PersistExperimentCommand> = {},
): PersistExperimentCommand {
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

function legacyCommand(
  overrides: Partial<LegacyImportExperimentCommand> = {},
): LegacyImportExperimentCommand {
  return {
    ...canonicalCommand({
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

function storeAt(db: DatabaseSync, timestamp: string): SqliteProvenanceStore {
  return new SqliteProvenanceStore(db, { now: () => timestamp });
}

function seedCanonical(): { db: DatabaseSync; store: SqliteProvenanceStore } {
  const db = database();
  migrateCurrent(db);
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T02:00:00.000Z");
  store.add(canonicalCommand());
  return { db, store };
}

function openImportBatch(db: DatabaseSync, sourceUserCount = 0, sourceRecordCount = 1): void {
  db.prepare(
    `INSERT INTO legacy_import_batches(
      id,source_kind,source_user_count,source_record_count,opened_at
    ) VALUES('json-startup-v1','startup_json_snapshot',?,?,?)`,
  ).run(sourceUserCount, sourceRecordCount, "2026-08-20T00:00:00.000Z");
}

function completeImport(db: DatabaseSync, sourceUserCount = 0, sourceRecordCount = 1): void {
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('json-startup-v1','startup_json_snapshot',?,?,?,?,'imported',?)`,
  ).run(
    sourceUserCount,
    sourceRecordCount,
    count(db, "users"),
    count(db, "experiment_records"),
    "2026-08-20T02:00:00.000Z",
  );
}

function importLegacyRecord(store: SqliteProvenanceStore): void {
  store.importExperiment(legacyCommand());
}

function completedImport(includeLegacyReview = false): {
  db: DatabaseSync;
  store: SqliteProvenanceStore;
} {
  const db = database();
  migrateCurrent(db);
  const store = storeAt(db, "2026-08-20T03:00:00.000Z");
  db.exec("BEGIN IMMEDIATE");
  try {
    openImportBatch(db);
    importLegacyRecord(store);
    if (includeLegacyReview) store.importReview(legacyReview());
    completeImport(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  return { db, store };
}

function rawLegacyReview(
  db: DatabaseSync,
  options: { id?: string; recordId?: string; timestamp?: string } = {},
): void {
  const timestamp = options.timestamp ?? "2026-08-20T03:00:00.000Z";
  const projectionUpdatedAt = new Date(Date.parse(timestamp) + 1).toISOString();
  db.prepare(
    `INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind,projection_updated_at
    ) VALUES(?,?,NULL,'Historical Teacher','included','legacy projection',
      ?,?,'legacy_projection',?)`,
  ).run(
    options.id ?? "legacy-review-raw",
    options.recordId ?? "legacy-record-a",
    timestamp,
    timestamp,
    projectionUpdatedAt,
  );
}

test("2A.9-01 Migration 011 remains frozen in the registered schema prefix", () => {
  assert.ok(LATEST_SCHEMA_VERSION >= 17);
  assert.equal(MIGRATIONS[10]?.name, "legacy_review_import_authority");
  assert.deepEqual(
    MIGRATIONS.slice(0, 16).map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
});

test("2A.9-02 importReview rejects a canonical record outside a transaction", () => {
  const { db, store } = seedCanonical();
  try {
    assert.throws(
      () => store.importReview(legacyReview({ id: "canonical-import", record_id: "record-a" })),
      /active import transaction/i,
    );
    assert.equal(count(db, "record_reviews"), 0);
  } finally {
    db.close();
  }
});

test("2A.9-03 importReview rejects a canonical record inside a transaction", () => {
  const { db, store } = seedCanonical();
  try {
    db.exec("BEGIN IMMEDIATE");
    assert.throws(
      () =>
        store.importReview(
          legacyReview({ id: "canonical-import-in-transaction", record_id: "record-a" }),
        ),
      /legacy.*target|durable import batch/i,
    );
    db.exec("ROLLBACK");
    assert.equal(count(db, "record_reviews"), 0);
  } finally {
    db.close();
  }
});

test("2A.9-04 raw legacy_projection INSERT on a canonical record fails", () => {
  const { db } = seedCanonical();
  try {
    assert.throws(() => rawLegacyReview(db, { recordId: "record-a" }));
    assert.equal(count(db, "record_reviews"), 0);
  } finally {
    db.close();
  }
});

test("2A.9-05 raw legacy_projection after completion cannot change the effective projection", () => {
  const { db } = completedImport();
  try {
    const before = db
      .prepare("SELECT effective_review_id,review_status,updated_at FROM experiment_records")
      .get() as Row;
    assert.throws(() => rawLegacyReview(db, { id: "post-completion-raw" }));
    const after = db
      .prepare("SELECT effective_review_id,review_status,updated_at FROM experiment_records")
      .get() as Row;
    assert.deepEqual(after, before);
    assert.equal(count(db, "record_reviews"), 0);
  } finally {
    db.close();
  }
});

test("2A.9-06 repository importReview outside a transaction fails for an imported record", () => {
  const { db, store } = completedImport();
  try {
    assert.throws(
      () => store.importReview(legacyReview({ id: "outside-transaction" })),
      /active import transaction/i,
    );
    assert.equal(count(db, "record_reviews"), 0);
  } finally {
    db.close();
  }
});

test("2A.9-07 repository importReview inside a later transaction fails after completion", () => {
  const { db, store } = completedImport();
  try {
    db.exec("BEGIN IMMEDIATE");
    assert.throws(
      () => store.importReview(legacyReview({ id: "later-transaction" })),
      /active durable import batch/i,
    );
    db.exec("ROLLBACK");
    assert.equal(count(db, "record_reviews"), 0);
  } finally {
    db.close();
  }
});

test("2A.9-08 a legitimate legacy review succeeds before the completion marker", () => {
  const { db, store } = completedImport(true);
  try {
    const review = store.getEffectiveReview("legacy-record-a");
    assert.ok(review);
    assert.equal(review.id, "legacy-review-a");
    assert.equal(review.provenance_kind, "legacy_projection");
    assert.equal(count(db, "storage_imports"), 1);
  } finally {
    db.close();
  }
});

test("2A.9-09 import failure rolls back users records reviews batch and marker", () => {
  const db = database();
  migrateCurrent(db);
  const store = storeAt(db, "2026-08-20T03:00:00.000Z");
  try {
    assert.throws(() => {
      db.exec("BEGIN IMMEDIATE");
      try {
        openImportBatch(db, 1, 1);
        seedUser(db, "batch-user");
        importLegacyRecord(store);
        store.importReview(legacyReview());
        completeImport(db, 1, 1);
        throw new Error("forced post-marker startup import failure");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }, /forced post-marker/);
    for (const table of [
      "users",
      "experiment_records",
      "record_reviews",
      "legacy_import_batches",
      "storage_imports",
    ])
      assert.equal(count(db, table), 0, table);
  } finally {
    db.close();
  }
});

test("2A.9-10 authorized human review remains valid after import completion", () => {
  const { db, store } = completedImport(true);
  try {
    seedUser(db, "teacher-a", "teacher", "Teacher A");
    const projected = storeAt(db, "2026-08-20T04:00:00.000Z").appendReview({
      record_id: "legacy-record-a",
      reviewer_user_id: "teacher-a",
      status: "excluded",
      note: "teacher decision",
      reviewed_by: "Teacher A",
    });
    assert.ok(projected);
    assert.equal(projected.review_status, "excluded");
    assert.equal(store.listReviewHistory("legacy-record-a").length, 2);
    assert.equal(store.getEffectiveReview("legacy-record-a")?.provenance_kind, "human");
  } finally {
    db.close();
  }
});

test("2A.9-11 existing pre-011 legacy reviews remain readable and unchanged", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T02:00:00.000Z");
  store.add(canonicalCommand());
  rawLegacyReview(db, {
    id: "historical-pre-011",
    recordId: "record-a",
    timestamp: "2026-08-20T01:00:00.000Z",
  });
  const before = JSON.stringify(db.prepare("SELECT * FROM record_reviews").get());
  try {
    const result = runMigrations(db, MIGRATIONS, () => "2026-08-24T01:00:00.000Z");
    assert.equal(result.currentVersion, LATEST_SCHEMA_VERSION);
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM record_reviews").get()), before);
    assert.equal(store.getEffectiveReview("record-a")?.id, "historical-pre-011");
  } finally {
    db.close();
  }
});

test("2A.9-12 ReviewRepository exposes no legacy import capability", async () => {
  const repositories = await readFile("src/domain/repositories.ts", "utf8");
  const interfaceBody = repositories.match(
    /export interface ReviewRepository \{(?<body>[\s\S]*?)\n\}/,
  )?.groups?.body;
  assert.ok(interfaceBody);
  assert.doesNotMatch(interfaceBody, /importReview|legacy|storage_import/i);
});

test("2A.9-13 Migration 010 and the released migration prefix remain frozen", async () => {
  const source = await readFile(
    "src/infrastructure/database/migrations/010-canonical-attribution-and-ledger-authority.ts",
  );
  const hash = spawnSync("git", ["hash-object", "--stdin"], { input: source });
  assert.equal(hash.status, 0);
  assert.equal(hash.stdout.toString().trim(), "438cdba4620b51eb9baf8c6e7f7f4a7fe7e90e65");
  assert.deepEqual(
    MIGRATIONS.slice(0, 10).map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test("2A.9-14 Migration 011 installs a prospective legacy-review authority guard", () => {
  const db = database();
  migrateCurrent(db);
  try {
    const trigger = db
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type='trigger' AND name='record_reviews_011_legacy_import_authority'`,
      )
      .get() as Row | undefined;
    assert.ok(trigger);
    const sql = String(trigger.sql);
    assert.match(sql, /provenance_kind='legacy_projection'/i);
    assert.match(sql, /legacy_canonical_snapshot/i);
    assert.match(sql, /legacy_import_batches/i);
    assert.match(sql, /storage_imports/i);
  } finally {
    db.close();
  }
});

test("2A.9-15 prior hard-delete attribution and classification seals remain active", () => {
  const { db, store } = seedCanonical();
  try {
    assert.throws(() => db.exec("DELETE FROM experiment_records WHERE id='record-a'"));
    assert.throws(() =>
      store.add(canonicalCommand({ id: "record-b", created_by: "Forged Creator" })),
    );
    assert.throws(() =>
      db.exec(`INSERT INTO provenance_boundary_classifications(
        classification_migration_version,classification_migration_name,
        entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
      ) VALUES(999,'runtime','record','record-a','created_at','forged_unverified',
        'value','runtime write','2026-08-24T00:00:00.000Z')`),
    );
    assert.equal(count(db, "experiment_records"), 1);
    assert.equal(count(db, "provenance_boundary_classifications"), 0);
  } finally {
    db.close();
  }
});
