import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RepositoryConflictError } from "../src/domain/repositories.js";
import type { AnalysisRun, ExperimentRecord, RecordReview } from "../src/domain/types.js";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
} from "../src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
import { appendHumanReview } from "./review-test-helpers.js";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function appliedVersions(db: DatabaseSync): number[] {
  return (
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
      version: number;
    }>
  ).map((row) => Number(row.version));
}

function seedUser(db: DatabaseSync, id: string, username: string, className = "Class A"): void {
  const timestamp = "2026-08-20T00:00:00.000Z";
  db.prepare(
    `INSERT INTO users(
      id, role, username, password_hash, default_password, name,
      class_name, group_name, status, data_json, created_at, updated_at
    ) VALUES(?, ?, ?, 'scrypt$test', 0, ?, ?, 'Group A', 'active', '{}', ?, NULL)`,
  ).run(
    id,
    id.startsWith("teacher") ? "teacher" : "student",
    username,
    username,
    className,
    timestamp,
  );
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
    created_by: "student-a",
    created_by_user_id: "user-a",
    review_status: "normal",
    review_note: "",
    reviewed_at: "",
    reviewed_by: "",
    synced_from_offline: true,
    ai_diagnosis: "",
    client_submission_id: "offline-a",
    metadata: {},
    ...overrides,
  };
}

test("fresh database reaches the latest schema and records every migration once", () => {
  const db = database();
  const first = runMigrations(db);
  const second = runMigrations(db);
  assert.equal(first.applied.length, MIGRATIONS.length);
  assert.equal(second.applied.length, 0);
  assert.equal(appliedVersions(db).at(-1), LATEST_SCHEMA_VERSION);
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  for (const table of [
    "schema_migrations",
    "experiment_records",
    "record_reviews",
    "analysis_runs",
    "analysis_inputs",
  ])
    assert.ok(tables.has(table), `missing ${table}`);
  db.close();
});

test("a failed migration rolls back its schema and version row", () => {
  const db = database();
  assert.throws(() =>
    runMigrations(
      db,
      [
        {
          version: 900,
          name: "intentional_failure",
          up(databaseHandle) {
            databaseHandle.exec("CREATE TABLE must_rollback(id TEXT PRIMARY KEY)");
            throw new Error("injected migration failure");
          },
        },
      ],
      () => "2026-08-20T00:00:00.000Z",
    ),
  );
  const artifact = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='must_rollback'")
    .get();
  assert.equal(artifact, undefined);
  assert.deepEqual(appliedVersions(db), []);
  db.close();
});

test("malformed legacy record JSON aborts migration without replacing the old table", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!], () => "2026-08-20T00:00:00.000Z");
  db.prepare(
    `INSERT INTO records(
      id, class_name, created_by, student_name, nh4cl_concentration,
      yield_percent, created_at, data_json
    ) VALUES('broken', 'Class A', 'student-a', 'Student A', 3, 1, ?, '{broken')`,
  ).run("2026-08-20T00:00:00.000Z");

  assert.throws(
    () => runMigrations(db, MIGRATIONS, () => "2026-08-20T01:00:00.000Z"),
    /Legacy migration preflight failed.*data_json/,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM records").get() as { count: number }).count,
    1,
  );
  assert.equal(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiment_records'")
      .get(),
    undefined,
  );
  assert.deepEqual(appliedVersions(db), [1]);
  db.close();
});

test("legacy records migrate without losing canonical, scientific, review, or extension data", () => {
  const db = database();
  runMigrations(db, [MIGRATIONS[0]!], () => "2026-08-20T00:00:00.000Z");
  seedUser(db, "user-a", "student-a");
  const legacy = record({
    review_status: "included",
    review_note: "legacy decision",
    reviewed_by: "teacher-old",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    metadata: { client_submission_id: "offline-a", idempotency_actor_id: "user-a" },
  }) as ExperimentRecord & { extension_value: string };
  legacy.extension_value = "preserve-me";
  db.prepare(
    `INSERT INTO records(
      id, class_name, created_by, student_name, nh4cl_concentration,
      yield_percent, created_at, data_json
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    legacy.id,
    legacy.class_name,
    legacy.created_by,
    legacy.student_name,
    legacy.nh4cl_concentration,
    legacy.yield_percent,
    legacy.created_at,
    JSON.stringify(legacy),
  );

  runMigrations(db, MIGRATIONS, () => "2026-08-20T02:00:00.000Z");
  const store = new SqliteProvenanceStore(db);
  const migrated = store.findById("record-a");
  assert.ok(migrated);
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.created_by_user_id, "user-a");
  assert.equal(migrated.class_name, "Class A");
  assert.equal(migrated.group_name, "Group A");
  assert.equal(migrated.oil_mass, 1);
  assert.equal(migrated.client_submission_id, "offline-a");
  assert.equal(migrated.metadata.extension_value, "preserve-me");
  const history = store.listReviewHistory("record-a");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.status, "included");
  assert.equal(history[0]?.provenance_kind, "legacy_projection");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM experiment_records").get() as { count: number })
      .count,
    1,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("record persistence enforces scoped idempotency and cross-user isolation", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a", "student-a");
  seedUser(db, "user-b", "student-b");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  assert.equal(store.findById("record-a")?.id, "record-a");
  assert.throws(
    () => store.add(record({ id: "record-b" })),
    (error: unknown) => error instanceof RepositoryConflictError,
  );
  store.add(
    record({
      id: "record-c",
      created_by: "student-b",
      created_by_user_id: "user-b",
    }),
  );
  assert.equal(
    store.findByClientSubmission({
      actorId: "user-b",
      className: "Class A",
      clientSubmissionId: "offline-a",
    })?.id,
    "record-c",
  );
  db.close();
});

test("SQLite record update and delete target one row and retain foreign-key integrity", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a", "student-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  store.add(
    record({
      id: "record-b",
      client_submission_id: "offline-b",
      group_name: "Group B",
      note: "untouched",
    }),
  );
  assert.equal(store.update("record-a", { note: "updated" })?.note, "updated");
  assert.equal(store.findById("record-b")?.note, "untouched");
  assert.equal(store.delete("record-a"), true);
  assert.equal(store.findById("record-a"), null);
  assert.throws(() => store.add(record({ id: "record-fk", created_by_user_id: "missing" })));
  db.close();
});

test("review rows are append-only and effective review is the latest event", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a", "student-a");
  seedUser(db, "teacher-a", "teacher-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  const first: RecordReview = {
    id: "review-1",
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "first",
    reviewed_by: "teacher-a",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "human",
  };
  const second: RecordReview = {
    ...first,
    id: "review-2",
    status: "excluded",
    note: "second",
    reviewed_at: "2026-08-20T02:00:00.000Z",
    created_at: "2026-08-20T02:00:00.000Z",
  };
  appendHumanReview(db, first);
  appendHumanReview(db, second);
  assert.deepEqual(
    store.listReviewHistory("record-a").map((review) => review.id),
    ["review-1", "review-2"],
  );
  assert.equal(store.getEffectiveReview("record-a")?.id, "review-2");
  assert.equal(store.findById("record-a")?.review_status, "excluded");
  assert.throws(() =>
    db.prepare("UPDATE record_reviews SET decision='included' WHERE id='review-1'").run(),
  );
  assert.equal(
    store.appendReview({
      record_id: "missing",
      reviewer_user_id: "teacher-a",
      status: second.status,
      note: second.note,
      reviewed_by: second.reviewed_by,
    }),
    null,
  );
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM record_reviews WHERE id='review-missing'")
        .get() as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal(store.delete("record-a"), true);
  assert.equal(store.findByIdIncludingDeleted("record-a")?.status, "deleted");
  assert.equal(store.listReviewHistory("record-a").length, 2);
  db.close();
});

test("analysis creation stores exact immutable record and review snapshots atomically", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a", "student-a");
  seedUser(db, "teacher-a", "teacher-a");
  const store = new SqliteProvenanceStore(db);
  store.add(record());
  appendHumanReview(db, {
    id: "review-1",
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "checked",
    reviewed_by: "teacher-a",
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "human",
  });
  const run: AnalysisRun = {
    id: "run-1",
    dataset_hash: "sha256:dataset",
    algorithm_version: "not-implemented",
    configuration: {},
    code_version: "test",
    status: "pending",
    results_metadata: {},
    created_by_user_id: "teacher-a",
    created_at: "2026-08-20T03:00:00.000Z",
  };
  store.createAnalysisRun(run, [
    { record_id: "record-a", review_id: "review-1", input_hash: "sha256:input" },
  ]);
  store.update("record-a", { oil_mass: 2 });
  const inputs = store.listAnalysisInputs("run-1");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.record_snapshot.oil_mass, 1);
  assert.equal(inputs[0]?.review_snapshot?.id, "review-1");
  assert.deepEqual(store.findAnalysisRun("run-1")?.results_metadata, {});

  assert.throws(() =>
    store.createAnalysisRun({ ...run, id: "run-rollback" }, [
      { record_id: "record-a", input_hash: "one" },
      { record_id: "missing", input_hash: "two" },
    ]),
  );
  assert.equal(store.findAnalysisRun("run-rollback"), null);
  db.close();
});

test("class listing query can use the documented class/time index", () => {
  const db = database();
  runMigrations(db);
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM experiment_records WHERE class_id = ? AND status = 'active' ORDER BY created_at DESC",
    )
    .all("class-a") as Array<{ detail: string }>;
  assert.ok(plan.some((row) => row.detail.includes("idx_experiment_records_class_created")));
  db.close();
});
