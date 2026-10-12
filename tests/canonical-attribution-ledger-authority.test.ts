import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RepositoryConflictError } from "../src/domain/repositories.js";
import type { PersistExperimentCommand, RecordReview } from "../src/domain/types.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";

interface LegacyImportExperimentCommand extends Omit<
  PersistExperimentCommand,
  "created_by_user_id"
> {
  created_by_user_id?: string | undefined;
  storage_import_id: string;
  updated_at?: string;
}

interface LegacyImportStore {
  importExperiment(command: LegacyImportExperimentCommand): void;
}

type Row = Record<string, unknown>;

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function migrateThrough9(db: DatabaseSync): void {
  runMigrations(db, MIGRATIONS.slice(0, 9), () => "2026-08-22T00:00:00.000Z");
}

function migrateThrough10(db: DatabaseSync): void {
  runMigrations(db, MIGRATIONS, () => "2026-08-22T01:00:00.000Z");
}

function seedUser(
  db: DatabaseSync,
  id: string,
  options: {
    role?: "student" | "teacher" | "admin";
    username?: string;
    name?: string;
    className?: string;
    groupName?: string;
  } = {},
): void {
  const role = options.role ?? "student";
  const username = options.username ?? id;
  const name = options.name ?? (role === "student" ? "Student A" : "Teacher A");
  db.prepare(
    `INSERT INTO users(
      id,role,username,password_hash,default_password,name,class_name,group_name,
      status,data_json,created_at,updated_at
    ) VALUES(?,?,?,'scrypt$test',0,?,?,?,'active','{}',?,NULL)`,
  ).run(
    id,
    role,
    username,
    name,
    options.className ?? "Class A",
    options.groupName ?? (role === "student" ? "Group A" : ""),
    "2026-08-20T00:00:00.000Z",
  );
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

function commandWithoutCreator(
  overrides: Partial<PersistExperimentCommand> = {},
): PersistExperimentCommand {
  return {
    ...command(overrides),
    created_by_user_id: undefined,
  } as unknown as PersistExperimentCommand;
}

function storeAt(db: DatabaseSync, timestamp: string): SqliteProvenanceStore {
  return new SqliteProvenanceStore(db, { now: () => timestamp });
}

function seeded(): { db: DatabaseSync; store: SqliteProvenanceStore } {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T01:00:00.000Z");
  store.add(command());
  return { db, store };
}

function openImportBatch(
  db: DatabaseSync,
  id = "json-startup-v1",
  sourceUserCount = 0,
  sourceRecordCount = 1,
): void {
  db.prepare(
    `INSERT INTO legacy_import_batches(
      id,source_kind,source_user_count,source_record_count,opened_at
    ) VALUES(?,'startup_json_snapshot',?,?,?)`,
  ).run(id, sourceUserCount, sourceRecordCount, "2026-08-20T00:00:00.000Z");
}

function completeStorageImport(
  db: DatabaseSync,
  id = "json-startup-v1",
  sourceUserCount = 0,
  sourceRecordCount = 1,
): void {
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES(?,'startup_json_snapshot',?,?,?,?,'imported',?)`,
  ).run(
    id,
    sourceUserCount,
    sourceRecordCount,
    count(db, "users"),
    count(db, "experiment_records"),
    "2026-08-20T02:00:00.000Z",
  );
}

function legacyCommand(
  overrides: Partial<LegacyImportExperimentCommand> = {},
): LegacyImportExperimentCommand {
  return {
    ...commandWithoutCreator({
      id: "legacy-record-a",
      created_by: "Historical notebook label",
    }),
    storage_import_id: "json-startup-v1",
    ...overrides,
  };
}

function importExperiment(
  store: SqliteProvenanceStore,
  imported: LegacyImportExperimentCommand,
): void {
  const candidate = store as unknown as Partial<LegacyImportStore>;
  const operation = candidate.importExperiment;
  if (typeof operation !== "function") assert.fail("explicit legacy import path missing");
  operation.call(candidate, imported);
}

function appendReview(db: DatabaseSync, recordId = "record-a"): void {
  seedUser(db, "teacher-a", { role: "teacher", name: "Teacher A" });
  storeAt(db, "2026-08-20T02:00:00.000Z").appendReview({
    record_id: recordId,
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "accepted",
    reviewed_by: "Teacher A",
  });
}

function createAnalysisRun(db: DatabaseSync, recordId = "record-a", runId = "run-a"): void {
  storeAt(db, "2026-08-20T03:00:00.000Z").createAnalysisRun(
    {
      id: runId,
      dataset_hash: `sha256:${runId}`,
      algorithm_version: "algorithm-a",
      configuration: {},
      code_version: "code-a",
    },
    [{ record_id: recordId, input_hash: `sha256:${runId}:input` }],
  );
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as Row).count);
}

function cloneStoredRecord(db: DatabaseSync, overrides: Row): void {
  const stored = db.prepare("SELECT * FROM experiment_records WHERE id='record-a'").get() as Row;
  const columns = (db.prepare("PRAGMA table_info(experiment_records)").all() as Row[]).map((row) =>
    String(row.name),
  );
  const clone: Row = { ...stored, ...overrides };
  const values: Array<string | number | null> = columns.map((column) => {
    const value = clone[column];
    if (value === null || value === undefined) return null;
    return typeof value === "number" ? value : String(value);
  });
  db.prepare(
    `INSERT INTO experiment_records(${columns.join(",")})
     VALUES(${columns.map(() => "?").join(",")})`,
  ).run(...values);
}

function replaceStoredRow(
  db: DatabaseSync,
  table: string,
  idColumn: string,
  id: string,
  overrides: Row,
): void {
  const stored = db.prepare(`SELECT * FROM ${table} WHERE ${idColumn}=?`).get(id) as Row;
  const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) =>
    String(row.name),
  );
  const replacement: Row = { ...stored, ...overrides };
  const values: Array<string | number | null> = columns.map((column) => {
    const value = replacement[column];
    if (value === null || value === undefined) return null;
    return typeof value === "number" ? value : String(value);
  });
  db.prepare(
    `INSERT OR REPLACE INTO ${table}(${columns.join(",")})
     VALUES(${columns.map(() => "?").join(",")})`,
  ).run(...values);
}

function classificationSql(verb = "INSERT", explicitId = false): string {
  return `${verb} INTO provenance_boundary_classifications(
    ${explicitId ? "classification_id," : ""}
    classification_migration_version,classification_migration_name,
    entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
  ) VALUES(${explicitId ? "4242," : ""}999,'runtime-forgery','record','record-a',
    'created_at','forged_unverified','observed','runtime must not write',
    '2026-08-22T00:00:00.000Z')`;
}

function legitimateClassifiedDatabase(through10 = true): DatabaseSync {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7), () => "2026-08-20T00:00:00.000Z");
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec("DROP TRIGGER experiment_original_provenance_guard");
  db.prepare("UPDATE experiment_records SET created_at=?,updated_at=? WHERE id='record-a'").run(
    "2026-08-20T08:00:00.000+08:00",
    "2026-08-20T08:00:00.000+08:00",
  );
  migrateThrough9(db);
  if (through10) migrateThrough10(db);
  return db;
}

test("2A.8-01 hard delete of an active unreviewed record fails", () => {
  const { db } = seeded();
  try {
    const before = JSON.stringify(db.prepare("SELECT * FROM experiment_records").get());
    assert.throws(() => db.exec("DELETE FROM experiment_records WHERE id='record-a'"));
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM experiment_records").get()), before);
  } finally {
    db.close();
  }
});

test("2A.8-02 hard delete of an archived record fails", () => {
  const { db, store } = seeded();
  try {
    assert.equal(store.delete("record-a"), true);
    assert.throws(() => db.exec("DELETE FROM experiment_records WHERE id='record-a'"));
    assert.equal(
      (db.prepare("SELECT status FROM experiment_records").get() as Row).status,
      "deleted",
    );
  } finally {
    db.close();
  }
});

test("2A.8-03 hard delete of a reviewed record fails", () => {
  const { db } = seeded();
  try {
    appendReview(db);
    db.exec("PRAGMA foreign_keys=OFF");
    assert.throws(() => db.exec("DELETE FROM experiment_records WHERE id='record-a'"));
    assert.equal(count(db, "record_reviews"), 1);
  } finally {
    db.close();
  }
});

test("2A.8-04 hard delete of a record selected by analysis fails", () => {
  const { db } = seeded();
  try {
    createAnalysisRun(db);
    db.exec("PRAGMA foreign_keys=OFF");
    assert.throws(() => db.exec("DELETE FROM experiment_records WHERE id='record-a'"));
    assert.equal(count(db, "analysis_inputs"), 1);
  } finally {
    db.close();
  }
});

test("2A.8-05 failed hard delete does not release an offline token", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  const store = new SqliteProvenanceStore(db);
  try {
    store.add(
      command({
        client_submission_id: "offline-token-a",
        synced_from_offline: true,
      }),
    );
    assert.throws(() => db.exec("DELETE FROM experiment_records WHERE id='record-a'"));
    assert.throws(
      () =>
        store.add(
          command({
            id: "record-b",
            client_submission_id: "offline-token-a",
            synced_from_offline: true,
          }),
        ),
      RepositoryConflictError,
    );
    assert.equal(count(db, "experiment_records"), 1);
  } finally {
    db.close();
  }
});

test("2A.8-06 repository delete is monotonic soft deletion and audit-readable", () => {
  const { db, store } = seeded();
  try {
    const before = store.findById("record-a");
    assert.ok(before);
    assert.equal(store.delete("record-a"), true);
    assert.equal(store.findById("record-a"), null);
    const archived = store.findByIdForAudit("record-a");
    assert.ok(archived);
    assert.equal(archived.status, "deleted");
    assert.ok(Date.parse(archived.updated_at!) > Date.parse(before.updated_at!));
  } finally {
    db.close();
  }
});

test("2A.8-07 hard delete of an unreferenced analysis run fails", () => {
  const db = database();
  migrateThrough10(db);
  try {
    db.prepare(
      `INSERT INTO analysis_runs(
        id,dataset_hash,algorithm_version,configuration_json,code_version,status,
        results_metadata_json,created_by_user_id,created_at,completed_at,inputs_sealed,
        dataset_classification
      ) VALUES('run-a','sha256:run-a','algorithm-a','{}','code-a','pending','{}',NULL,?,NULL,0,'exact')`,
    ).run("2026-08-20T00:00:00.000Z");
    assert.throws(() => db.exec("DELETE FROM analysis_runs WHERE id='run-a'"));
    assert.equal(count(db, "analysis_runs"), 1);
  } finally {
    db.close();
  }
});

test("2A.8-08 ordinary creator ID and label mismatch fails atomically", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  try {
    assert.throws(() =>
      new SqliteProvenanceStore(db).add(command({ created_by: "Forged Creator" })),
    );
    assert.equal(count(db, "experiment_records"), 0);
    assert.equal(count(db, "classes"), 0);
    assert.equal(count(db, "groups"), 0);
  } finally {
    db.close();
  }
});

test("2A.8-09 ordinary canonical creation without creator ID fails atomically", () => {
  const db = database();
  migrateThrough10(db);
  try {
    assert.throws(() => new SqliteProvenanceStore(db).add(commandWithoutCreator()));
    assert.equal(count(db, "experiment_records"), 0);
    assert.equal(count(db, "classes"), 0);
  } finally {
    db.close();
  }
});

test("2A.8-10 offline=true without a token fails", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  try {
    assert.throws(() => new SqliteProvenanceStore(db).add(command({ synced_from_offline: true })));
    assert.equal(count(db, "experiment_records"), 0);
  } finally {
    db.close();
  }
});

test("2A.8-11 token present with offline=false fails", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  try {
    assert.throws(() =>
      new SqliteProvenanceStore(db).add(
        command({ client_submission_id: "offline-token-a", synced_from_offline: false }),
      ),
    );
    assert.equal(count(db, "experiment_records"), 0);
  } finally {
    db.close();
  }
});

test("2A.8-12 offline token without actor or durable scope fails", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  try {
    assert.throws(() =>
      new SqliteProvenanceStore(db).add(
        commandWithoutCreator({
          client_submission_id: "offline-token-a",
          synced_from_offline: true,
        }),
      ),
    );
    const valid = command({ client_submission_id: "offline-token-b", synced_from_offline: true });
    new SqliteProvenanceStore(db).add(valid);
    assert.throws(() =>
      cloneStoredRecord(db, {
        id: "record-b",
        client_submission_id: "offline-token-c",
        idempotency_scope_class_id: null,
      }),
    );
    assert.equal(count(db, "experiment_records"), 1);
  } finally {
    db.close();
  }
});

test("2A.8-13 valid online authoritative creation succeeds", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  try {
    new SqliteProvenanceStore(db).add(command());
    const row = db.prepare("SELECT * FROM experiment_records WHERE id='record-a'").get() as Row;
    assert.equal(row.submission_kind, "canonical_submission");
    assert.equal(row.created_by_user_id, "user-a");
    assert.equal(row.synced_from_offline, 0);
    assert.equal(row.client_submission_id, null);
    assert.equal(row.idempotency_scope_class_id, null);
  } finally {
    db.close();
  }
});

test("2A.8-14 valid offline authoritative creation succeeds with immutable scope", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  try {
    new SqliteProvenanceStore(db).add(
      command({ client_submission_id: "offline-token-a", synced_from_offline: true }),
    );
    const row = db.prepare("SELECT * FROM experiment_records WHERE id='record-a'").get() as Row;
    assert.equal(row.synced_from_offline, 1);
    assert.equal(row.client_submission_id, "offline-token-a");
    assert.equal(row.created_by_user_id, "user-a");
    assert.equal(row.idempotency_scope_class_id, row.class_id);
  } finally {
    db.close();
  }
});

test("2A.8-15 explicit legacy unknown-creator import is truthful and batch-bound", () => {
  const db = database();
  migrateThrough10(db);
  try {
    db.exec("BEGIN IMMEDIATE");
    openImportBatch(db);
    importExperiment(new SqliteProvenanceStore(db), legacyCommand());
    completeStorageImport(db);
    db.exec("COMMIT");
    const row = db
      .prepare("SELECT * FROM experiment_records WHERE id='legacy-record-a'")
      .get() as Row;
    assert.equal(row.submission_kind, "legacy_canonical_snapshot");
    assert.equal(row.created_by_user_id, null);
    assert.equal(row.created_by_label, "Historical notebook label");
    assert.equal(row.storage_import_id, "json-startup-v1");
    assert.equal(count(db, "storage_imports"), 1);
  } finally {
    db.close();
  }
});

test("2A.8-16 later account rename does not invalidate imported creator evidence", () => {
  const db = database();
  migrateThrough10(db);
  try {
    db.exec("BEGIN IMMEDIATE");
    openImportBatch(db, "json-startup-v1", 1, 1);
    seedUser(db, "user-a", { username: "student-old", name: "Student Old" });
    importExperiment(
      new SqliteProvenanceStore(db),
      legacyCommand({ created_by_user_id: "user-a", created_by: "Student Historical" }),
    );
    completeStorageImport(db, "json-startup-v1", 1, 1);
    db.exec("COMMIT");
    db.exec("UPDATE users SET username='student-new',name='Student New' WHERE id='user-a'");
    const imported = new SqliteProvenanceStore(db).findById("legacy-record-a");
    assert.ok(imported);
    assert.equal(imported.created_by, "Student Historical");
  } finally {
    db.close();
  }
});

test("2A.8-17 legacy import failure rolls back the whole batch", () => {
  const db = database();
  migrateThrough10(db);
  const store = new SqliteProvenanceStore(db);
  try {
    const candidate = store as unknown as Partial<LegacyImportStore>;
    if (typeof candidate.importExperiment !== "function")
      assert.fail("explicit legacy import path missing before rollback exercise");
    assert.throws(() => {
      db.exec("BEGIN IMMEDIATE");
      try {
        openImportBatch(db, "json-startup-v1", 1, 1);
        seedUser(db, "batch-user");
        importExperiment(store, legacyCommand());
        const importedReview: RecordReview = {
          id: "legacy-review-a",
          record_id: "legacy-record-a",
          status: "included",
          note: "legacy projection",
          reviewed_by: "Historical Teacher",
          reviewed_at: "2026-08-20T01:00:00.000Z",
          created_at: "2026-08-20T01:00:00.000Z",
          provenance_kind: "legacy_projection",
        };
        store.importReview(importedReview);
        importExperiment(store, legacyCommand());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    for (const table of [
      "users",
      "classes",
      "groups",
      "experiment_records",
      "record_reviews",
      "storage_imports",
      "legacy_import_batches",
    ])
      assert.equal(count(db, table), 0, table);
  } finally {
    db.close();
  }
});

test("2A.8-18 ordinary repository interface exposes no legacy bypass", async () => {
  const repositories = await readFile("src/domain/repositories.ts", "utf8");
  const interfaceBody = repositories.match(
    /export interface ExperimentRepository \{(?<body>[\s\S]*?)\n\}/,
  )?.groups?.body;
  assert.ok(interfaceBody);
  assert.doesNotMatch(interfaceBody, /importExperiment|storage_import|legacy/i);
  const reviewInterfaceBody = repositories.match(
    /export interface ReviewRepository \{(?<body>[\s\S]*?)\n\}/,
  )?.groups?.body;
  assert.ok(reviewInterfaceBody);
  assert.doesNotMatch(reviewInterfaceBody, /importReview|legacy/i);
  const storage = await readFile("src/infrastructure/database/storage.js", "utf8");
  assert.match(storage, /function importRecord[\s\S]*provenanceStore\.importExperiment\(record\)/);
  assert.doesNotMatch(storage, /function importRecord[\s\S]{0,250}provenanceStore\.add\(/);
});

for (const [number, label, sql] of [
  [19, "plain runtime ledger INSERT fails", classificationSql()],
  [
    20,
    "INSERT OR IGNORE fails instead of silently bypassing the seal",
    classificationSql("INSERT OR IGNORE"),
  ],
  [21, "INSERT OR REPLACE remains blocked", classificationSql("INSERT OR REPLACE", true)],
  [22, "explicit new classification_id INSERT fails", classificationSql("INSERT", true)],
] as const)
  test(`2A.8-${number} ${label}`, () => {
    const db = database();
    migrateThrough10(db);
    try {
      assert.throws(() => db.exec(sql));
      assert.equal(count(db, "provenance_boundary_classifications"), 0);
    } finally {
      db.close();
    }
  });

test("2A.8-23 runtime cannot forge unverified evidence to block an exact record", () => {
  const { db } = seeded();
  try {
    assert.throws(() => db.exec(classificationSql()));
    createAnalysisRun(db);
    assert.equal(count(db, "analysis_runs"), 1);
  } finally {
    db.close();
  }
});

test("2A.8-24 Migration 010 classifies account-state ambiguity before sealing", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec("UPDATE users SET username='renamed-user',name='Renamed Student' WHERE id='user-a'");
  try {
    migrateThrough10(db);
    const row = db
      .prepare(
        `SELECT * FROM provenance_boundary_classifications
         WHERE classification_migration_version=10 AND entity_type='record'
           AND entity_id='record-a' AND field_name='created_by_label'`,
      )
      .get() as Row | undefined;
    assert.ok(row);
    assert.equal(row.classification, "historical_creator_account_state_not_snapshotted");
    assert.throws(() => db.exec(classificationSql()));
  } finally {
    db.close();
  }
});

test("2A.8-25 legitimate Migration 008/009 classifications remain readable", () => {
  const db = legitimateClassifiedDatabase(false);
  try {
    storeAt(db, "2026-08-20T00:00:00.001Z").update("record-a", {
      note: "normal beta.8 follow-up",
    });
    const before = db
      .prepare(
        `SELECT * FROM provenance_boundary_classifications
         WHERE classification_migration_version IN (8,9)
         ORDER BY classification_id`,
      )
      .all() as Row[];
    assert.ok(before.some((row) => row.classification_migration_version === 8));
    migrateThrough10(db);
    const after = db
      .prepare(
        `SELECT * FROM provenance_boundary_classifications
         WHERE classification_migration_version IN (8,9)
         ORDER BY classification_id`,
      )
      .all() as Row[];
    assert.deepEqual(after, before);
  } finally {
    db.close();
  }
});

test("2A.8-26 classification ledger UPDATE and DELETE remain blocked", () => {
  const db = legitimateClassifiedDatabase();
  try {
    const before = JSON.stringify(
      db
        .prepare("SELECT * FROM provenance_boundary_classifications ORDER BY classification_id")
        .all(),
    );
    assert.throws(() =>
      db.exec("UPDATE provenance_boundary_classifications SET reason='tampered'"),
    );
    assert.throws(() => db.exec("DELETE FROM provenance_boundary_classifications"));
    assert.equal(
      JSON.stringify(
        db
          .prepare("SELECT * FROM provenance_boundary_classifications ORDER BY classification_id")
          .all(),
      ),
      before,
    );
  } finally {
    db.close();
  }
});

test("raw SQL cannot bypass canonical creator attribution with forged metadata", () => {
  const { db } = seeded();
  try {
    assert.throws(() =>
      cloneStoredRecord(db, {
        id: "record-b",
        created_by_label: "Forged Creator",
        metadata_json: JSON.stringify({ created_by: "Student A" }),
      }),
    );
    assert.equal(count(db, "experiment_records"), 1);
  } finally {
    db.close();
  }
});

test("submission origin cannot be flipped later with an advanced version timestamp", () => {
  const { db } = seeded();
  try {
    assert.throws(() =>
      db.exec(
        `UPDATE experiment_records SET synced_from_offline=1,
         updated_at='2026-08-20T01:00:00.001Z' WHERE id='record-a'`,
      ),
    );
    const row = db
      .prepare("SELECT synced_from_offline,updated_at FROM experiment_records WHERE id='record-a'")
      .get() as Row;
    assert.deepEqual(
      { ...row },
      { synced_from_offline: 0, updated_at: "2026-08-20T00:00:00.000Z" },
    );
  } finally {
    db.close();
  }
});

test("raw legacy insertion requires a real open import batch", () => {
  const { db } = seeded();
  try {
    assert.throws(() =>
      cloneStoredRecord(db, {
        id: "record-b",
        submission_kind: "legacy_canonical_snapshot",
        storage_import_id: "caller-selected-batch",
      }),
    );
    assert.equal(count(db, "experiment_records"), 1);
  } finally {
    db.close();
  }
});

test("a completed import batch cannot receive another legacy record", () => {
  const db = database();
  migrateThrough10(db);
  const store = new SqliteProvenanceStore(db);
  try {
    db.exec("BEGIN IMMEDIATE");
    openImportBatch(db);
    importExperiment(store, legacyCommand());
    completeStorageImport(db);
    db.exec("COMMIT");
    db.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => importExperiment(store, legacyCommand({ id: "legacy-record-b" })));
      db.exec("ROLLBACK");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    assert.equal(count(db, "experiment_records"), 1);
  } finally {
    db.close();
  }
});

test("an import batch cannot commit without its durable completion marker", () => {
  const db = database();
  migrateThrough10(db);
  try {
    db.exec("BEGIN IMMEDIATE");
    openImportBatch(db);
    assert.throws(() => db.exec("COMMIT"), /foreign key/i);
    db.exec("ROLLBACK");
    assert.equal(count(db, "legacy_import_batches"), 0);
  } finally {
    db.close();
  }
});

test("INSERT OR REPLACE cannot physically replace a scientific record", () => {
  const { db } = seeded();
  try {
    const before = JSON.stringify(db.prepare("SELECT * FROM experiment_records").get());
    assert.throws(() =>
      db.exec("INSERT OR REPLACE INTO experiment_records SELECT * FROM experiment_records"),
    );
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM experiment_records").get()), before);
  } finally {
    db.close();
  }
});

test("Migration 010 marks historical offline contradiction and downgrades its exact run", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec(
    `UPDATE experiment_records SET synced_from_offline=1,
     updated_at='2026-08-20T00:00:00.001Z' WHERE id='record-a'`,
  );
  createAnalysisRun(db, "record-a", "historical-exact-run");
  try {
    migrateThrough10(db);
    const classification = db
      .prepare(
        `SELECT classification FROM provenance_boundary_classifications
         WHERE classification_migration_version=10 AND entity_type='record'
           AND entity_id='record-a' AND field_name='synced_from_offline'`,
      )
      .get() as Row;
    assert.match(String(classification.classification), /unverified$/);
    assert.equal(
      (
        db
          .prepare("SELECT dataset_classification FROM analysis_runs WHERE id=?")
          .get("historical-exact-run") as Row
      ).dataset_classification,
      "legacy_unverified",
    );
  } finally {
    db.close();
  }
});

test("Migration 010 foreign-key preflight reports exact run identity", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "missing-user");
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_by_user_id,created_at,completed_at,inputs_sealed,
      dataset_classification
    ) VALUES('orphan-run','sha256:orphan','algorithm-a','{}','code-a','pending','{}',
      'missing-user',?,NULL,0,'exact')`,
  ).run("2026-08-20T00:00:00.000Z");
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("DELETE FROM users WHERE id='missing-user'");
  db.exec("PRAGMA foreign_keys=ON");
  try {
    assert.throws(() => migrateThrough10(db), /analysis_runs:orphan-run:users/i);
    assert.equal(
      (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as Row).version,
      9,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 rejects a well-shaped but impossible Migration 009 taxonomy row", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  const appliedAt = (
    db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row
  ).applied_at;
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','record','record-a',
      'created_at','forged_unverified','not-shown','forged runtime row',?)`,
  ).run(String(appliedAt));
  try {
    assert.throws(() => migrateThrough10(db), /1.*classification/i);
  } finally {
    db.close();
  }
});

test("Migration 010 preflight fails closed with exact forged classification IDs and fields", () => {
  for (const [field, replacement] of [
    ["classification_migration_version", 999],
    ["classification_migration_name", ""],
    ["entity_type", ""],
    ["entity_id", ""],
    ["field_name", ""],
    ["classification", ""],
    ["reason", ""],
    ["classified_at", "not-a-date"],
  ] as const) {
    const db = database();
    migrateThrough9(db);
    const row: Row = {
      classification_id: 4242,
      classification_migration_version: 9,
      classification_migration_name: "sealed_dataset_and_historical_provenance_closure",
      entity_type: "record",
      entity_id: "record-a",
      field_name: "created_at",
      classification: "legacy_offset_timestamp",
      observed_value: "2026-08-20T08:00:00.000+08:00",
      reason: "Historical offset timestamp retained by Migration 009.",
      classified_at: "2026-08-22T00:00:00.000Z",
    };
    row[field] = replacement;
    db.prepare(
      `INSERT INTO provenance_boundary_classifications(
        classification_id,classification_migration_version,classification_migration_name,
        entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      Number(row.classification_id),
      Number(row.classification_migration_version),
      String(row.classification_migration_name),
      String(row.entity_type),
      String(row.entity_id),
      String(row.field_name),
      String(row.classification),
      String(row.observed_value),
      String(row.reason),
      String(row.classified_at),
    );
    try {
      assert.throws(() => migrateThrough10(db), new RegExp(`4242.*${field}`, "i"));
      assert.equal(
        (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as Row).version,
        9,
      );
    } finally {
      db.close();
    }
  }
});

test("Migration 010 preflight reports unexpected physical-delete guards", () => {
  const db = database();
  migrateThrough9(db);
  db.exec(`CREATE TRIGGER unexpected_record_delete BEFORE DELETE ON experiment_records
    BEGIN SELECT RAISE(ABORT,'unexpected'); END`);
  try {
    assert.throws(() => migrateThrough10(db), /unexpected_record_delete|delete guard/i);
    assert.equal(
      (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as Row).version,
      9,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 preserves the immutable schema-v7 reviewer-drift stop", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7), () => "2026-08-20T00:00:00.000Z");
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", { role: "teacher", name: "Teacher A" });
  new SqliteProvenanceStore(db).add(command());
  const historicalReview: RecordReview = {
    id: "review-a",
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "accepted",
    reviewed_by: "Teacher A",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "human",
  };
  storeAt(db, "2026-08-20T02:00:00.000Z").importReview(historicalReview);
  db.exec(
    "UPDATE users SET username='renamed-teacher',name='Renamed Teacher' WHERE id='teacher-a'",
  );
  try {
    assert.throws(() => migrateThrough10(db), /review-a|human reviewer boundary/i);
    assert.equal(
      (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as Row).version,
      7,
    );
  } finally {
    db.close();
  }
});

test("Migration 009 remains frozen at its accepted Git blob", async () => {
  const source = await readFile(
    "src/infrastructure/database/migrations/009-sealed-dataset-and-historical-provenance-closure.ts",
  );
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", ["hash-object", "--stdin"], { input: source });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.toString().trim(), "6528a8d26aa8c86fe67937d823cdb9f4bb77c600");
});

test("Migration 010 blocks replacement even when recursive triggers are disabled", () => {
  const { db } = seeded();
  createAnalysisRun(db);
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('json-startup-v1','startup_json_snapshot',0,0,1,1,
      'existing_sqlite_authoritative','2026-08-20T04:00:00.000Z')`,
  ).run();
  try {
    db.exec("PRAGMA recursive_triggers=OFF; PRAGMA foreign_keys=OFF");
    const submitted = JSON.parse(
      String(
        (
          db
            .prepare("SELECT submitted_json FROM experiment_records WHERE id='record-a'")
            .get() as Row
        ).submitted_json,
      ),
    ) as Row;
    submitted.note = "replaced";
    assert.throws(
      () =>
        replaceStoredRow(db, "experiment_records", "id", "record-a", {
          note: "replaced",
          submitted_json: JSON.stringify(submitted),
        }),
      /duplicate.*replacement/i,
    );
    assert.throws(
      () => replaceStoredRow(db, "analysis_runs", "id", "run-a", { dataset_hash: "changed" }),
      /duplicate.*replacement/i,
    );
    assert.throws(
      () =>
        replaceStoredRow(db, "storage_imports", "id", "json-startup-v1", {
          target_record_count: 999,
        }),
      /duplicate.*replacement/i,
    );
    assert.equal(
      (db.prepare("SELECT note FROM experiment_records WHERE id='record-a'").get() as Row).note,
      "original",
    );
    assert.equal(
      (db.prepare("SELECT dataset_hash FROM analysis_runs WHERE id='run-a'").get() as Row)
        .dataset_hash,
      "sha256:run-a",
    );
  } finally {
    db.close();
  }

  const batchDb = database();
  migrateThrough10(batchDb);
  try {
    batchDb.exec("BEGIN IMMEDIATE");
    openImportBatch(batchDb, "json-startup-v1", 0, 0);
    completeStorageImport(batchDb, "json-startup-v1", 0, 0);
    batchDb.exec("COMMIT");
    batchDb.exec("PRAGMA recursive_triggers=OFF; PRAGMA foreign_keys=OFF");
    assert.throws(
      () =>
        replaceStoredRow(batchDb, "legacy_import_batches", "id", "json-startup-v1", {
          source_record_count: 1,
        }),
      /duplicate.*replacement/i,
    );
  } finally {
    batchDb.close();
  }
});

test("Migration 010 rejects an allow-listed classification without released semantics", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','record','record-a',
      'updated_at','pre_v9_record_version_time_collision_unverified','note',
      'Schemas before version 9 permitted a provenance-bearing change to retain the record creation timestamp; operation order within that timestamp cannot be reconstructed.',?)`,
  ).run(appliedAt);
  try {
    assert.throws(() => migrateThrough10(db), /1.*observed_value/i);
    assert.equal(
      (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as Row).version,
      9,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 classifies beta.8 imported canonical rows and their exact runs", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  createAnalysisRun(db, "record-a", "legacy-import-run");
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('json-startup-v1','startup_json_snapshot',1,1,1,1,'imported',?)`,
  ).run("2026-08-20T01:00:00.000Z");
  try {
    migrateThrough10(db);
    const recordClassification = db
      .prepare(
        `SELECT classification FROM provenance_boundary_classifications
         WHERE classification_migration_version=10 AND entity_type='record'
           AND entity_id='record-a' AND field_name='storage_import_id'`,
      )
      .get() as Row | undefined;
    assert.equal(
      recordClassification?.classification,
      "historical_legacy_import_batch_link_not_recorded_unverified",
    );
    const run = db
      .prepare("SELECT dataset_classification FROM analysis_runs WHERE id='legacy-import-run'")
      .get() as Row;
    assert.equal(run.dataset_classification, "legacy_unverified");
    const runClassification = db
      .prepare(
        `SELECT classification FROM provenance_boundary_classifications
         WHERE classification_migration_version=10 AND entity_type='analysis_run'
           AND entity_id='legacy-import-run' AND field_name='dataset_classification'`,
      )
      .get() as Row | undefined;
    assert.equal(runClassification?.classification, "historical_input_attribution_unverified");
  } finally {
    db.close();
  }
});

test("Migration 010 rejects malformed historical storage-import evidence by exact ID", () => {
  const db = database();
  migrateThrough9(db);
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('forged-marker','forged-kind',9,8,7,6,
      'existing_sqlite_authoritative','2026-08-20T00:00:00.000Z')`,
  ).run();
  try {
    assert.throws(
      () => migrateThrough10(db),
      /forged-marker:.*source_kind.*source_user_count.*source_record_count/i,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 validates every new import marker and canonical batch timestamp", () => {
  const db = database();
  migrateThrough10(db);
  try {
    assert.throws(() =>
      db.exec(
        `INSERT INTO storage_imports VALUES(
          'bad-marker','forged-kind',-1,0,0,0,
          'existing_sqlite_authoritative','not-a-date')`,
      ),
    );
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() =>
      db.exec(
        `INSERT INTO legacy_import_batches VALUES(
          'bad-batch','startup_json_snapshot',0,0,'2026-08-20T24:00:00.000Z')`,
      ),
    );
    db.exec("ROLLBACK");

    db.exec("BEGIN IMMEDIATE");
    openImportBatch(db, "json-startup-v1", 0, 0);
    assert.throws(() =>
      db.exec(
        `INSERT INTO storage_imports VALUES(
          'json-startup-v1','startup_json_snapshot',0,0,0,0,
          'existing_sqlite_authoritative','2026-08-20T00:00:00.000Z')`,
      ),
    );
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
});

test("Migration 010 preflight rejects missing released ledger guards", () => {
  const db = database();
  migrateThrough9(db);
  db.exec(
    `DROP TRIGGER provenance_boundary_classifications_no_update;
     DROP TRIGGER provenance_boundary_classifications_no_delete`,
  );
  try {
    assert.throws(() => migrateThrough10(db), /classification.*guard.*no_update.*no_delete/i);
    assert.equal(
      (db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as Row).version,
      9,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 installs independent update and delete ledger seals", () => {
  const db = legitimateClassifiedDatabase();
  try {
    db.exec(
      `DROP TRIGGER provenance_boundary_classifications_no_update;
       DROP TRIGGER provenance_boundary_classifications_no_delete`,
    );
    assert.throws(() =>
      db.exec("UPDATE provenance_boundary_classifications SET reason='runtime rewrite'"),
    );
    assert.throws(() => db.exec("DELETE FROM provenance_boundary_classifications"));
  } finally {
    db.close();
  }
});

test("Migration 010 exposes an executable migration preflight", () => {
  assert.equal(typeof MIGRATIONS[9]?.preflight, "function");
});

test("Migration 010 preserves a genuine released collision after a later versioned update", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8), () => "2026-08-22T00:00:00.000Z");
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec("UPDATE experiment_records SET note='schema-8 accepted correction' WHERE id='record-a'");
  migrateThrough9(db);
  const releasedClassification = db
    .prepare(
      `SELECT * FROM provenance_boundary_classifications
       WHERE classification='pre_v9_record_version_time_collision_unverified'`,
    )
    .get();
  assert.ok(releasedClassification);
  const classificationBefore = JSON.stringify(releasedClassification);
  storeAt(db, "2026-08-20T00:00:00.001Z").update("record-a", { note: "later versioned" });
  try {
    migrateThrough10(db);
    assert.equal(
      JSON.stringify(
        db
          .prepare(
            `SELECT * FROM provenance_boundary_classifications
             WHERE classification='pre_v9_record_version_time_collision_unverified'`,
          )
          .get(),
      ),
      classificationBefore,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 rejects a snapshot-collision claim without immutable collision evidence", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','record','record-a',
      'updated_at','pre_v9_record_version_time_collision_unverified',?,
      'Two provenance-bearing record versions share one timestamp, so their ordering cannot be reconstructed.',?)`,
  ).run("2026-08-20T00:00:00.000Z", appliedAt);
  try {
    assert.throws(() => migrateThrough10(db), /1:.*collision.*observed_value/i);
  } finally {
    db.close();
  }
});

test("INSERT OR REPLACE cannot transfer an offline token to a new record ID", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(
    command({ client_submission_id: "offline-token-a", synced_from_offline: true }),
  );
  const before = JSON.stringify(
    db.prepare("SELECT * FROM experiment_records WHERE id='record-a'").get(),
  );
  try {
    db.exec("PRAGMA recursive_triggers=OFF; PRAGMA foreign_keys=OFF");
    assert.throws(
      () =>
        replaceStoredRow(db, "experiment_records", "id", "record-a", {
          id: "record-b",
        }),
      /offline token.*replacement/i,
    );
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM experiment_records WHERE id='record-a'").get()),
      before,
    );
    assert.equal(
      Number(
        (
          db
            .prepare("SELECT COUNT(*) count FROM experiment_records WHERE id='record-b'")
            .get() as Row
        ).count,
      ),
      0,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 rejects a well-shaped historical marker with a non-canonical ID", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('forged-batch','startup_json_snapshot',1,1,1,1,'imported',?)`,
  ).run("2026-08-20T01:00:00.000Z");
  try {
    assert.throws(() => migrateThrough10(db), /forged-batch:.*id/i);
  } finally {
    db.close();
  }
});

test("a historical completion marker cannot authorize a post-hoc import batch", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('json-startup-v1','startup_json_snapshot',0,0,1,1,
      'existing_sqlite_authoritative',?)`,
  ).run("2026-08-20T01:00:00.000Z");
  migrateThrough10(db);
  try {
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => openImportBatch(db, "json-startup-v1", 0, 0), /completed marker/i);
    db.exec("ROLLBACK");
    assert.equal(count(db, "legacy_import_batches"), 0);
  } finally {
    db.close();
  }
});

test("Migration 010 rejects forged review chronology for a normal human event", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", { role: "teacher", name: "Teacher A" });
  new SqliteProvenanceStore(db).add(command());
  const reviewStore = storeAt(db, "2026-08-20T02:00:00.000Z");
  reviewStore.appendReview({
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "accepted",
    reviewed_by: "Teacher A",
  });
  const review = reviewStore.listReviewHistory("record-a").at(-1);
  assert.ok(review);
  const decidedAt = String(
    (db.prepare("SELECT decided_at FROM record_reviews WHERE id=?").get(review.id) as Row)
      .decided_at,
  );
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','review',?,
      'decided_at','legacy_review_chronology_unverified',?,
      'The released legacy projection recorded migration capture as event creation after the preserved historical decision time; immutable values were retained but are not claimed to satisfy v1 chronology.',?)`,
  ).run(review.id, decidedAt, appliedAt);
  try {
    assert.throws(() => migrateThrough10(db), /1:legacy_review_chronology.*observed_value/i);
  } finally {
    db.close();
  }
});

test("Migration 010 rejects forged review-sequence chronology without an actual reversal", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", { role: "teacher", name: "Teacher A" });
  new SqliteProvenanceStore(db).add(command());
  storeAt(db, "2026-08-20T01:00:00.000Z").appendReview({
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "review",
    note: "first",
    reviewed_by: "Teacher A",
  });
  const reviewStore = storeAt(db, "2026-08-20T02:00:00.000Z");
  reviewStore.appendReview({
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "second",
    reviewed_by: "Teacher A",
  });
  const second = reviewStore.listReviewHistory("record-a").at(-1);
  assert.ok(second);
  const sequence = String(
    (
      db
        .prepare("SELECT event_sequence FROM review_event_order WHERE review_id=?")
        .get(second.id) as Row
    ).event_sequence,
  );
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','review',?,
      'event_sequence','legacy_review_sequence_chronology_unverified',?,
      'A later immutable legacy review sequence contains an event or decision time before prior review evidence.',?)`,
  ).run(second.id, sequence, appliedAt);
  try {
    assert.throws(
      () => migrateThrough10(db),
      /1:legacy_review_sequence_chronology.*observed_value/i,
    );
  } finally {
    db.close();
  }
});

test("key order alone cannot substantiate a forged snapshot-version collision", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  createAnalysisRun(db, "record-a", "order-run-a");
  createAnalysisRun(db, "record-a", "order-run-b");
  const row = db
    .prepare("SELECT record_snapshot_json FROM analysis_inputs WHERE analysis_run_id='order-run-b'")
    .get() as Row;
  const snapshot = JSON.parse(String(row.record_snapshot_json)) as Row;
  const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.prepare(
    "UPDATE analysis_inputs SET record_snapshot_json=? WHERE analysis_run_id='order-run-b'",
  ).run(JSON.stringify(reordered));
  db.exec(`CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
    BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END`);
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','record','record-a',
      'updated_at','pre_v9_record_version_time_collision_unverified',?,
      'Two provenance-bearing record versions share one timestamp, so their ordering cannot be reconstructed.',?)`,
  ).run("2026-08-20T00:00:00.000Z", appliedAt);
  try {
    assert.throws(() => migrateThrough10(db), /1:.*collision.*observed_value/i);
  } finally {
    db.close();
  }
});

test("a legacy startup-import batch cannot open over existing authoritative data", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "existing-user");
  try {
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => openImportBatch(db, "json-startup-v1", 1, 0), /empty.*database/i);
    db.exec("ROLLBACK");
    assert.equal(count(db, "legacy_import_batches"), 0);
  } finally {
    db.close();
  }
});

test("Migration 010 rejects a same-name no-op replacement for a released ledger guard", () => {
  const db = database();
  migrateThrough9(db);
  db.exec(`
    DROP TRIGGER provenance_boundary_classifications_no_update;
    CREATE TRIGGER provenance_boundary_classifications_no_update
    BEFORE UPDATE ON provenance_boundary_classifications WHEN 0
    BEGIN SELECT RAISE(ABORT,'provenance classification ledger is append-only'); END
  `);
  try {
    assert.throws(() => migrateThrough10(db), /classification ledger guard mismatch.*no_update/i);
  } finally {
    db.close();
  }
});

test("Migration 010 rejects missing released storage-import ledger guards", () => {
  const db = database();
  migrateThrough9(db);
  db.exec("DROP TRIGGER storage_imports_no_update");
  try {
    assert.throws(() => migrateThrough10(db), /storage-import ledger guard mismatch.*no_update/i);
  } finally {
    db.close();
  }
});

test("Migration 010 independently seals storage-import marker update and delete", () => {
  const db = database();
  migrateThrough10(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('json-startup-v1','startup_json_snapshot',0,0,1,1,
      'existing_sqlite_authoritative',?)`,
  ).run("2026-08-20T04:00:00.000Z");
  db.exec("DROP TRIGGER storage_imports_no_update; DROP TRIGGER storage_imports_no_delete");
  try {
    assert.throws(() =>
      db.exec("UPDATE storage_imports SET completed_at='2026-08-20T05:00:00.000Z'"),
    );
    assert.throws(() => db.exec("DELETE FROM storage_imports"));
  } finally {
    db.close();
  }
});

test("Migration 010 independently seals canonical creator and origin evidence", () => {
  const { db } = seeded();
  db.exec("DROP TRIGGER experiment_original_provenance_guard");
  try {
    assert.throws(() =>
      db.exec(
        "UPDATE experiment_records SET created_by_label='Forged Creator' WHERE id='record-a'",
      ),
    );
    assert.throws(() =>
      db.exec("UPDATE experiment_records SET created_by_user_id=NULL WHERE id='record-a'"),
    );
    assert.throws(() =>
      db.exec("UPDATE experiment_records SET submitted_json='{}' WHERE id='record-a'"),
    );
  } finally {
    db.close();
  }
});

test("Migration 010 rejects a forged incomplete-dataset classification for a complete run", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  createAnalysisRun(db);
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','analysis_run','run-a',
      'sealed_input_set','legacy_incomplete_sealed_dataset',
      'count=1;min=0;max=0;distinct_ordinals=1;distinct_records=1',
      'The historical sealed input set was empty, non-contiguous or repeated a selected record.',?)`,
  ).run(appliedAt);
  try {
    assert.throws(
      () => migrateThrough10(db),
      /1:legacy_incomplete_sealed_dataset.*observed_value/i,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 rejects a forged version-history classification without a durable difference", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','record','record-a',
      'updated_at','pre_v9_record_version_history_incomplete','note',
      'The record has a plausible advanced update timestamp, but schemas before version 9 did not retain a complete field-level version ledger.',?)`,
  ).run(appliedAt);
  try {
    assert.throws(
      () => migrateThrough10(db),
      /1:pre_v9_record_version_history_incomplete.*observed_value/i,
    );
  } finally {
    db.close();
  }
});

test("historical review import succeeds only while its imported record batch is open", () => {
  const db = database();
  migrateThrough10(db);
  const store = new SqliteProvenanceStore(db);
  const importedReview: RecordReview = {
    id: "legacy-review-a",
    record_id: "legacy-record-a",
    status: "included",
    note: "legacy projection",
    reviewed_by: "Historical Teacher",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "legacy_projection",
  };
  try {
    db.exec("BEGIN IMMEDIATE");
    openImportBatch(db);
    importExperiment(store, legacyCommand());
    assert.ok(store.importReview(importedReview));
    completeStorageImport(db);
    db.exec("COMMIT");
    assert.equal(count(db, "record_reviews"), 1);
    assert.throws(
      () => store.importReview({ ...importedReview, id: "legacy-review-after-completion" }),
      /active.*import batch|transaction/i,
    );
    assert.equal(count(db, "record_reviews"), 1);
  } finally {
    db.close();
  }
});

test("legacy experiment import cannot run outside its durable batch transaction", () => {
  const db = database();
  migrateThrough10(db);
  try {
    assert.throws(
      () => importExperiment(new SqliteProvenanceStore(db), legacyCommand()),
      /active.*import transaction/i,
    );
    assert.equal(count(db, "experiment_records"), 0);
  } finally {
    db.close();
  }
});

test("legacy-schema v1-shaped JSON alone cannot substantiate a version collision", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  createAnalysisRun(db);
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  db.exec(
    `UPDATE analysis_inputs SET snapshot_schema='echoclass.analysis-input.legacy'
     WHERE analysis_run_id='run-a'`,
  );
  db.exec(`CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
    BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END`);
  const appliedAt = String(
    (db.prepare("SELECT applied_at FROM schema_migrations WHERE version=9").get() as Row)
      .applied_at,
  );
  db.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(9,'sealed_dataset_and_historical_provenance_closure','record','record-a',
      'updated_at','pre_v9_record_version_time_collision_unverified',?,
      'Two provenance-bearing record versions share one timestamp, so their ordering cannot be reconstructed.',?)`,
  ).run("2026-08-20T00:00:00.000Z", appliedAt);
  try {
    assert.throws(() => migrateThrough10(db), /1:.*collision.*observed_value/i);
  } finally {
    db.close();
  }
});

test("Migration 010 accepts a genuine released legacy review chronology classification", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7), () => "2026-08-22T00:00:00.000Z");
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec(`INSERT INTO record_reviews(
    id,record_id,reviewer_user_id,reviewer_label,decision,reason,
    decided_at,created_at,provenance_kind
  ) VALUES('legacy-chronology','record-a',NULL,'Legacy Import','included','historical',
    '2026-08-20T01:00:00.000Z','2026-08-20T02:00:00.000Z','legacy_projection')`);
  migrateThrough9(db);
  const before = JSON.stringify(
    db.prepare("SELECT * FROM record_reviews WHERE id='legacy-chronology'").get(),
  );
  assert.ok(
    db
      .prepare(
        `SELECT 1 FROM provenance_boundary_classifications
         WHERE entity_id='legacy-chronology'
           AND classification='legacy_review_chronology_unverified'`,
      )
      .get(),
  );
  try {
    migrateThrough10(db);
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM record_reviews WHERE id='legacy-chronology'").get()),
      before,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 accepts a genuine released legacy review-sequence reversal classification", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8), () => "2026-08-22T00:00:00.000Z");
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec(`
    INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind
    ) VALUES('legacy-sequence-first','record-a',NULL,'Legacy Import','review','first',
      '2026-08-20T03:00:00.000Z','2026-08-20T03:00:00.000Z','legacy_projection');
    DROP TRIGGER record_reviews_008_insert_guard;
    INSERT INTO record_reviews(
      id,record_id,reviewer_user_id,reviewer_label,decision,reason,
      decided_at,created_at,provenance_kind
    ) VALUES('legacy-sequence-second','record-a',NULL,'Legacy Import','included','second',
      '2026-08-20T02:00:00.000Z','2026-08-20T02:00:00.000Z','legacy_projection');
    CREATE TRIGGER record_reviews_008_insert_guard BEFORE INSERT ON record_reviews WHEN 0
      BEGIN SELECT RAISE(ABORT,'restored for released migration replacement'); END
  `);
  migrateThrough9(db);
  const before = JSON.stringify(
    db.prepare("SELECT * FROM record_reviews WHERE id='legacy-sequence-second'").get(),
  );
  assert.ok(
    db
      .prepare(
        `SELECT 1 FROM provenance_boundary_classifications
         WHERE entity_id='legacy-sequence-second'
           AND classification='legacy_review_sequence_chronology_unverified'`,
      )
      .get(),
  );
  try {
    migrateThrough10(db);
    assert.equal(
      JSON.stringify(
        db.prepare("SELECT * FROM record_reviews WHERE id='legacy-sequence-second'").get(),
      ),
      before,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 preserves released invalid-offset evidence after updated_at advances", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7), () => "2026-08-22T00:00:00.000Z");
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec("DROP TRIGGER experiment_original_provenance_guard");
  db.prepare("UPDATE experiment_records SET created_at=?,updated_at=? WHERE id='record-a'").run(
    "2026-09-31T00:00:00.000+00:00",
    "2026-09-31T00:00:00.000+00:00",
  );
  migrateThrough9(db);
  storeAt(db, "2026-10-03T00:00:00.000Z").update("record-a", {
    note: "normal beta.8 follow-up",
  });
  const before = db
    .prepare(
      `SELECT * FROM provenance_boundary_classifications
       WHERE entity_type='record' AND entity_id='record-a'
       ORDER BY classification_id`,
    )
    .all();
  assert.ok(before.length >= 2);
  try {
    migrateThrough10(db);
    assert.deepEqual(
      db
        .prepare(
          `SELECT * FROM provenance_boundary_classifications
           WHERE entity_type='record' AND entity_id='record-a'
           ORDER BY classification_id`,
        )
        .all(),
      before,
    );
  } finally {
    db.close();
  }
});

test("Migration 010 does not infer legacy batch membership from a future-dated record clock", () => {
  const db = database();
  migrateThrough9(db);
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command({ created_at: "2027-01-01T00:00:00.000Z" }));
  db.prepare(
    `INSERT INTO storage_imports(
      id,source_kind,source_user_count,source_record_count,target_user_count,
      target_record_count,disposition,completed_at
    ) VALUES('json-startup-v1','startup_json_snapshot',1,1,1,1,'imported',?)`,
  ).run("2026-08-22T00:00:00.000Z");
  try {
    migrateThrough10(db);
    const classification = db
      .prepare(
        `SELECT classification FROM provenance_boundary_classifications
         WHERE classification_migration_version=10 AND entity_type='record'
           AND entity_id='record-a' AND field_name='storage_import_id'`,
      )
      .get() as Row | undefined;
    assert.equal(
      classification?.classification,
      "historical_legacy_import_batch_link_not_recorded_unverified",
    );
  } finally {
    db.close();
  }
});

test("Migration 010 preserves a genuine future-dated Migration 009 version classification", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8), () => "2026-08-22T00:00:00.000Z");
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command({ created_at: "2026-08-23T00:00:00.000Z" }));
  storeAt(db, "2026-08-24T00:00:00.000Z").update("record-a", {
    note: "pre-Migration-009 future-dated update",
  });
  migrateThrough9(db);
  const before = db
    .prepare(
      `SELECT * FROM provenance_boundary_classifications
       WHERE classification='pre_v9_record_version_history_incomplete'`,
    )
    .get();
  assert.ok(before);
  try {
    migrateThrough10(db);
    assert.deepEqual(
      db
        .prepare(
          `SELECT * FROM provenance_boundary_classifications
           WHERE classification='pre_v9_record_version_history_incomplete'`,
        )
        .get(),
      before,
    );
  } finally {
    db.close();
  }
});
