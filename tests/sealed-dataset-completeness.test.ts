import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type {
  AnalysisInputSelection,
  CreateAnalysisRunCommand,
  ExperimentRecord,
  PersistExperimentCommand,
  RecordReview,
} from "../src/domain/types.js";
import { preflightAndPrepareMigration2 } from "../src/infrastructure/database/migrations/002-legacy-preflight.js";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
  type Migration,
} from "../src/infrastructure/database/migrations/index.js";
import {
  SqliteProvenanceStore,
  type LegacyImportExperimentCommand,
} from "../src/infrastructure/database/sqlite-provenance-store.js";

const V1 = "echoclass.analysis-input.v1";
const LEGACY = "echoclass.analysis-input.legacy";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");
  return db;
}

function seedUser(
  db: DatabaseSync,
  id: string,
  role: "student" | "teacher" | "admin" = "student",
  options: { name?: string; username?: string; status?: "active" | "disabled" | "demo" } = {},
): void {
  const username = options.username ?? id;
  const name = options.name ?? (role === "teacher" ? "Teacher A" : "Student A");
  db.prepare(
    `INSERT INTO users(
      id,role,username,password_hash,default_password,name,class_name,group_name,
      status,data_json,created_at,updated_at
    ) VALUES(?,?,?,'scrypt$test',0,?,'Class A','Group A',?,'{}',?,NULL)`,
  ).run(id, role, username, name, options.status ?? "active", "2026-08-20T00:00:00.000Z");
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

function run(overrides: Partial<CreateAnalysisRunCommand> = {}): CreateAnalysisRunCommand {
  return {
    id: "run-a",
    dataset_hash: "sha256:dataset-a",
    algorithm_version: "algorithm-a",
    configuration: {},
    code_version: "code-a",
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
    reviewed_at: "2026-08-20T01:00:00.000Z",
    created_at: "2026-08-20T01:00:00.000Z",
    provenance_kind: "human",
    ...overrides,
  };
}

function storeAt(db: DatabaseSync, timestamp: string): SqliteProvenanceStore {
  return new SqliteProvenanceStore(db, { now: () => timestamp });
}

function seeded(timestamp = "2026-08-20T03:00:00.000Z"): {
  db: DatabaseSync;
  store: SqliteProvenanceStore;
} {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher", { name: "Teacher A" });
  const store = storeAt(db, timestamp);
  store.add(command());
  return { db, store };
}

function seededLegacyImport(timestamp = "2026-08-20T03:00:00.000Z"): {
  db: DatabaseSync;
  store: SqliteProvenanceStore;
} {
  const db = database();
  runMigrations(db);
  const store = storeAt(db, timestamp);
  db.exec("BEGIN IMMEDIATE");
  db.prepare(
    `INSERT INTO legacy_import_batches(
      id,source_kind,source_user_count,source_record_count,opened_at
    ) VALUES('json-startup-v1','startup_json_snapshot',0,1,?)`,
  ).run("2026-08-20T00:00:00.000Z");
  store.importExperiment({
    ...command({
      created_by_user_id: undefined as never,
      created_by: "Historical notebook label",
    }),
    storage_import_id: "json-startup-v1",
  } satisfies LegacyImportExperimentCommand);
  return { db, store };
}

function closeOpenImport(db: DatabaseSync): void {
  db.exec("ROLLBACK");
  db.close();
}

function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>).some(
    (row) => row.name === column,
  );
}

function rawRun(db: DatabaseSync, id: string, createdAt = "2026-08-20T03:00:00.000Z"): void {
  const sealed = tableHasColumn(db, "analysis_runs", "inputs_sealed");
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_by_user_id,created_at,completed_at${sealed ? ",inputs_sealed" : ""}
    ) VALUES(?,?,?,?,?,'pending','{}',NULL,?,NULL${sealed ? ",0" : ""})`,
  ).run(id, `sha256:${id}`, "algorithm-a", "{}", "code-a", createdAt);
}

function sourceSnapshot(
  db: DatabaseSync,
  store: SqliteProvenanceStore,
  runId: string,
  recordId = "record-a",
): string {
  store.createAnalysisRun(run({ id: runId, dataset_hash: `sha256:${runId}` }), [
    { record_id: recordId, input_hash: `sha256:${runId}:input` },
  ]);
  return String(
    (
      db
        .prepare(
          "SELECT record_snapshot_json FROM analysis_inputs WHERE analysis_run_id=? AND ordinal=0",
        )
        .get(runId) as Record<string, unknown>
    ).record_snapshot_json,
  );
}

function insertNoneInput(
  db: DatabaseSync,
  runId: string,
  ordinal: number,
  recordId: string,
  snapshot: string,
): void {
  db.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id,ordinal,record_id,review_id,input_hash,
      record_snapshot_json,review_snapshot_json,snapshot_schema,
      review_binding_mode,review_omission_reason
    ) VALUES(?,?,?,NULL,?,?,NULL,?,'none',NULL)`,
  ).run(runId, ordinal, recordId, `sha256:${runId}:${ordinal}`, snapshot, V1);
}

function auditSnapshot(db: DatabaseSync, recordId: string): ExperimentRecord {
  const store = new SqliteProvenanceStore(db);
  const record = store.findByIdIncludingDeleted(recordId);
  assert.ok(record);
  const row = db
    .prepare("SELECT class_id,group_id FROM experiment_records WHERE id=?")
    .get(recordId) as Record<string, unknown>;
  return {
    ...record,
    class_id: String(row.class_id),
    ...(row.group_id ? { group_id: String(row.group_id) } : {}),
  };
}

function rollbackAndClose(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // The tested trigger may already have rolled the transaction back.
  }
  db.close();
}

test("ordinary analysis creation rejects an empty selection atomically", () => {
  const { db, store } = seeded();
  try {
    assert.throws(() => store.createAnalysisRun(run({ id: "empty-run" }), []), /input|selection/i);
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='empty-run'").get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    db.close();
  }
});

test("ordinary analysis creation rejects sparse JavaScript selections", () => {
  const { db, store } = seeded();
  const selections: AnalysisInputSelection[] = [];
  selections.length = 6;
  selections[5] = { record_id: "record-a", input_hash: "sha256:sparse" };
  try {
    assert.throws(
      () => store.createAnalysisRun(run({ id: "sparse-run" }), selections),
      /dense|hole|sparse|selection/i,
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='sparse-run'").get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    db.close();
  }
});

test("raw zero-input sealing rolls back the run", () => {
  const { db } = seeded();
  try {
    db.exec("BEGIN IMMEDIATE");
    rawRun(db, "raw-empty");
    assert.throws(
      () => db.exec("UPDATE analysis_runs SET inputs_sealed=1 WHERE id='raw-empty'"),
      /complete|input|ordinal|seal/i,
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='raw-empty'").get() as {
          count: number;
        }
      ).count,
      0,
      "failed completeness must roll back the raw run transaction",
    );
  } finally {
    rollbackAndClose(db);
  }
});

test("raw gapped ordinal sealing rolls back the run and its inputs", () => {
  const { db, store } = seeded();
  const snapshot = sourceSnapshot(db, store, "gap-source");
  try {
    db.exec("BEGIN IMMEDIATE");
    rawRun(db, "raw-gap");
    insertNoneInput(db, "raw-gap", 5, "record-a", snapshot);
    assert.throws(
      () => db.exec("UPDATE analysis_runs SET inputs_sealed=1 WHERE id='raw-gap'"),
      /complete|input|ordinal|seal/i,
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='raw-gap'").get() as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) count FROM analysis_inputs WHERE analysis_run_id='raw-gap'")
          .get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    rollbackAndClose(db);
  }
});

test("raw duplicate-record sealing rolls back the entire run", () => {
  const { db, store } = seeded();
  const snapshot = sourceSnapshot(db, store, "duplicate-source");
  try {
    db.exec("BEGIN IMMEDIATE");
    rawRun(db, "raw-duplicate-record");
    insertNoneInput(db, "raw-duplicate-record", 0, "record-a", snapshot);
    assert.throws(
      () => insertNoneInput(db, "raw-duplicate-record", 1, "record-a", snapshot),
      /unique|constraint|record/i,
    );
    db.exec("ROLLBACK");
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='raw-duplicate-record'")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    rollbackAndClose(db);
  }
});

test("sealed ordinary input ordinals are exactly zero through N minus one", () => {
  const { db, store } = seeded();
  try {
    store.add(command({ id: "record-b" }));
    store.add(command({ id: "record-c" }));
    store.createAnalysisRun(run({ id: "dense-run" }), [
      { record_id: "record-a", input_hash: "sha256:a" },
      { record_id: "record-b", input_hash: "sha256:b" },
      { record_id: "record-c", input_hash: "sha256:c" },
    ]);
    assert.deepEqual(
      (
        db
          .prepare(
            "SELECT ordinal FROM analysis_inputs WHERE analysis_run_id='dense-run' ORDER BY ordinal",
          )
          .all() as Array<{ ordinal: number }>
      ).map((row) => row.ordinal),
      [0, 1, 2],
    );
    assert.equal(
      (
        db.prepare("SELECT inputs_sealed FROM analysis_runs WHERE id='dense-run'").get() as {
          inputs_sealed: number;
        }
      ).inputs_sealed,
      1,
    );
  } finally {
    db.close();
  }
});

test("duplicate ordinary selections fail atomically", () => {
  const { db, store } = seeded();
  try {
    assert.throws(() =>
      store.createAnalysisRun(run({ id: "duplicate-run" }), [
        { record_id: "record-a", input_hash: "sha256:first" },
        { record_id: "record-a", input_hash: "sha256:second" },
      ]),
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='duplicate-run'").get() as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) count FROM analysis_inputs WHERE analysis_run_id='duplicate-run'",
          )
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    db.close();
  }
});

test("none binding cannot change a durable normal projection to review", () => {
  const { db, store } = seeded();
  try {
    const snapshot = JSON.parse(sourceSnapshot(db, store, "normal-source")) as Record<
      string,
      unknown
    >;
    snapshot.review_status = "review";
    rawRun(db, "forged-normal-review");
    assert.throws(
      () => insertNoneInput(db, "forged-normal-review", 0, "record-a", JSON.stringify(snapshot)),
      /projection|provenance|selection|review/i,
    );
  } finally {
    db.close();
  }
});

test("none binding cannot change a durable review projection to normal", () => {
  const db = database();
  runMigrations(db);
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T03:00:00.000Z");
  store.add(command({ initial_quality_status: "review" }));
  try {
    const snapshot = JSON.parse(sourceSnapshot(db, store, "review-source")) as Record<
      string,
      unknown
    >;
    snapshot.review_status = "normal";
    rawRun(db, "forged-review-normal");
    assert.throws(
      () => insertNoneInput(db, "forged-review-normal", 0, "record-a", JSON.stringify(snapshot)),
      /projection|provenance|selection|review/i,
    );
  } finally {
    db.close();
  }
});

test("Migration 009 downgrades forged historical none and omit projections", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher", { name: "Teacher A" });
  storeAt(db, "2026-08-20T00:00:00.000Z").add(command());
  storeAt(db, "2026-08-20T00:00:00.000Z").add(
    command({ id: "record-none", client_submission_id: undefined }),
  );
  storeAt(db, "2026-08-20T01:00:00.000Z").createAnalysisRun(
    run({ id: "historical-none", dataset_hash: "sha256:historical-none" }),
    [{ record_id: "record-none", input_hash: "sha256:historical-none:0" }],
  );
  storeAt(db, "2026-08-20T02:00:00.000Z").importReview(review());
  storeAt(db, "2026-08-20T03:00:00.000Z").createAnalysisRun(
    run({ id: "historical-omit", dataset_hash: "sha256:historical-omit" }),
    [
      {
        record_id: "record-a",
        input_hash: "sha256:historical-omit:0",
        review_mode: "omit",
        review_omission_reason: "Independent blinded analysis",
      },
    ],
  );
  storeAt(db, "2026-08-20T03:00:00.000Z").createAnalysisRun(
    run({ id: "historical-blank-omit", dataset_hash: "sha256:historical-blank-omit" }),
    [
      {
        record_id: "record-a",
        input_hash: "sha256:historical-blank-omit:0",
        review_mode: "omit",
        review_omission_reason: "Valid reason before historical corruption",
      },
    ],
  );
  for (const id of ["historical-effective-reason", "historical-effective-event"] as const)
    storeAt(db, "2026-08-20T03:00:00.000Z").createAnalysisRun(
      run({ id, dataset_hash: `sha256:${id}` }),
      [{ record_id: "record-a", input_hash: `sha256:${id}:0` }],
    );
  db.exec("DROP TRIGGER analysis_inputs_no_update");
  for (const [runId, field, value] of [
    ["historical-none", "review_status", "review"],
    ["historical-omit", "review_note", "forged projection"],
  ] as const) {
    const row = db
      .prepare("SELECT record_snapshot_json FROM analysis_inputs WHERE analysis_run_id=?")
      .get(runId) as { record_snapshot_json: string };
    const snapshot = JSON.parse(row.record_snapshot_json) as Record<string, unknown>;
    snapshot[field] = value;
    db.prepare("UPDATE analysis_inputs SET record_snapshot_json=? WHERE analysis_run_id=?").run(
      JSON.stringify(snapshot),
      runId,
    );
  }
  db.exec(
    "UPDATE analysis_inputs SET review_omission_reason=char(160) WHERE analysis_run_id='historical-blank-omit'",
  );
  db.exec(
    "UPDATE analysis_inputs SET review_omission_reason='contradictory reason' WHERE analysis_run_id='historical-effective-reason'",
  );
  const effectiveEventRow = db
    .prepare(
      "SELECT review_snapshot_json FROM analysis_inputs WHERE analysis_run_id='historical-effective-event'",
    )
    .get() as { review_snapshot_json: string };
  const forgedReviewSnapshot = JSON.parse(effectiveEventRow.review_snapshot_json) as Record<
    string,
    unknown
  >;
  forgedReviewSnapshot.event_sequence = 999;
  db.prepare(
    "UPDATE analysis_inputs SET review_snapshot_json=? WHERE analysis_run_id='historical-effective-event'",
  ).run(JSON.stringify(forgedReviewSnapshot));
  db.exec(`CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
    BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END`);
  try {
    runMigrations(db);
    const rows = db
      .prepare(
        `SELECT ai.analysis_run_id,ai.snapshot_schema,ar.dataset_classification
         FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
         WHERE ai.analysis_run_id IN (
           'historical-blank-omit','historical-effective-event','historical-effective-reason',
           'historical-none','historical-omit'
         )
         ORDER BY ai.analysis_run_id`,
      )
      .all() as Array<{
      analysis_run_id: string;
      snapshot_schema: string;
      dataset_classification: string;
    }>;
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        {
          analysis_run_id: "historical-blank-omit",
          snapshot_schema: LEGACY,
          dataset_classification: "legacy_unverified",
        },
        {
          analysis_run_id: "historical-effective-event",
          snapshot_schema: LEGACY,
          dataset_classification: "legacy_unverified",
        },
        {
          analysis_run_id: "historical-effective-reason",
          snapshot_schema: LEGACY,
          dataset_classification: "legacy_unverified",
        },
        {
          analysis_run_id: "historical-none",
          snapshot_schema: LEGACY,
          dataset_classification: "legacy_unverified",
        },
        {
          analysis_run_id: "historical-omit",
          snapshot_schema: LEGACY,
          dataset_classification: "legacy_unverified",
        },
      ],
    );
    assert.ok(
      db
        .prepare(
          `SELECT 1 FROM provenance_boundary_classifications
           WHERE entity_type='analysis_input' AND entity_id='historical-blank-omit#0'
             AND field_name='review_omission_reason'
             AND classification='legacy_blank_review_omission_reason'`,
        )
        .get(),
    );
  } finally {
    db.close();
  }
});

test("legacy review cannot predate its record", () => {
  const { db, store } = seededLegacyImport();
  try {
    assert.throws(() =>
      store.importReview(
        review({
          id: "legacy-before-record",
          reviewer_user_id: undefined,
          reviewed_by: "Legacy Import",
          reviewed_at: "2026-08-19T23:59:59.999Z",
          created_at: "2026-08-19T23:59:59.999Z",
          provenance_kind: "legacy_projection",
        }),
      ),
    );
    assert.equal(store.getEffectiveReview("record-a"), null);
  } finally {
    closeOpenImport(db);
  }
});

test("a later legacy event sequence cannot predate the preceding event", () => {
  const { db, store } = seededLegacyImport();
  try {
    const first = review({
      id: "legacy-first",
      reviewer_user_id: undefined,
      reviewed_by: "Legacy Import",
      reviewed_at: "2026-08-20T02:00:00.000Z",
      created_at: "2026-08-20T02:00:00.000Z",
      provenance_kind: "legacy_projection",
    });
    store.importReview(first);
    assert.throws(() =>
      store.importReview({
        ...first,
        id: "legacy-backdated-second",
        reviewed_at: "2026-08-20T01:00:00.000Z",
        created_at: "2026-08-20T01:00:00.000Z",
      }),
    );
    assert.equal(store.getEffectiveReview("record-a")?.id, "legacy-first");
  } finally {
    closeOpenImport(db);
  }
});

test("a later event cannot fall behind the preceding decision-time boundary", () => {
  const { db, store } = seededLegacyImport();
  try {
    const first = review({
      id: "legacy-decision-boundary",
      reviewer_user_id: undefined,
      reviewed_by: "Legacy Import",
      created_at: "2026-08-20T01:00:00.000Z",
      reviewed_at: "2026-08-20T02:00:00.000Z",
      provenance_kind: "legacy_projection",
    });
    store.importReview(first);
    assert.throws(() =>
      store.importReview({
        ...first,
        id: "legacy-behind-decision",
        created_at: "2026-08-20T01:30:00.000Z",
        reviewed_at: "2026-08-20T01:30:00.000Z",
      }),
    );
  } finally {
    closeOpenImport(db);
  }
});

test("review projection time cannot predate its event or decision evidence", () => {
  const { db } = seededLegacyImport();
  try {
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO record_reviews(
            id,record_id,reviewer_user_id,reviewer_label,decision,reason,
            decided_at,created_at,provenance_kind,projection_updated_at
          ) VALUES('future-review','record-a',NULL,'Legacy Import','included','future',
            '2026-08-20T05:00:00.000Z','2026-08-20T05:00:00.000Z',
            'legacy_projection','2026-08-20T04:00:00.000Z')`,
        )
        .run(),
    );
    const projected = storeAt(db, "2026-08-20T01:00:00.000Z").importReview(
      review({
        id: "future-import",
        reviewer_user_id: undefined,
        reviewed_by: "Legacy Import",
        created_at: "2026-08-20T05:00:00.000Z",
        reviewed_at: "2026-08-20T05:00:00.000Z",
        provenance_kind: "legacy_projection",
      }),
    );
    assert.ok(projected);
    assert.ok(
      Date.parse(projected.updated_at ?? projected.created_at) >
        Date.parse("2026-08-20T05:00:00.000Z"),
    );
  } finally {
    closeOpenImport(db);
  }
});

test("legacy reviewed_at cannot predate its event creation", () => {
  const { db, store } = seededLegacyImport();
  try {
    assert.throws(() =>
      store.importReview(
        review({
          id: "legacy-bad-decision-time",
          reviewer_user_id: undefined,
          reviewed_by: "Legacy Import",
          reviewed_at: "2026-08-20T00:59:59.999Z",
          created_at: "2026-08-20T01:00:00.000Z",
          provenance_kind: "legacy_projection",
        }),
      ),
    );
  } finally {
    closeOpenImport(db);
  }
});

test("chronology-unverified legacy review cannot seed a new exact dataset", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  storeAt(db, "2026-08-20T00:00:00.000Z").add(command());
  db.exec(`INSERT INTO record_reviews(
    id,record_id,reviewer_user_id,reviewer_label,decision,reason,
    decided_at,created_at,provenance_kind
  ) VALUES(
    'legacy-missing-time','record-a',NULL,'Legacy Import','included','missing time',
    NULL,'2026-08-20T01:00:00.000Z','legacy_projection'
  )`);
  runMigrations(db);
  const store = storeAt(db, "2026-08-20T03:00:00.000Z");
  try {
    assert.throws(() =>
      store.createAnalysisRun(
        run({ id: "blocked-legacy-run", dataset_hash: "sha256:blocked-legacy" }),
        [{ record_id: "record-a", input_hash: "sha256:blocked-legacy:0" }],
      ),
    );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='blocked-legacy-run'")
          .get() as {
          count: number;
        }
      ).count,
      0,
    );

    rawRun(db, "blocked-legacy-raw");
    const recordSnapshot = auditSnapshot(db, "record-a");
    const reviewSnapshot = store.listReviewHistory("record-a")[0];
    assert.ok(reviewSnapshot);
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO analysis_inputs(
            analysis_run_id,ordinal,record_id,review_id,input_hash,
            record_snapshot_json,review_snapshot_json,snapshot_schema,
            review_binding_mode,review_omission_reason
          ) VALUES(
            'blocked-legacy-raw',0,'record-a','legacy-missing-time','sha256:blocked-raw',
            ?,?,?,'effective',NULL
          )`,
        )
        .run(JSON.stringify(recordSnapshot), JSON.stringify(reviewSnapshot), V1),
    );
    assert.throws(() =>
      store.appendReview({
        record_id: "record-a",
        reviewer_user_id: "teacher-a",
        status: "included",
        note: "must not hide incomplete history",
        reviewed_by: "Teacher A",
      }),
    );
  } finally {
    db.close();
  }
});

test("calendar-invalid legacy review history blocks later app and raw exact selections", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher", { name: "Teacher A" });
  storeAt(db, "2026-08-20T00:00:00.000Z").add(command());
  db.exec(`INSERT INTO record_reviews(
    id,record_id,reviewer_user_id,reviewer_label,decision,reason,
    decided_at,created_at,provenance_kind
  ) VALUES(
    'legacy-invalid-calendar','record-a',NULL,'Legacy Import','included','invalid calendar',
    '2026-09-31T02:00:00.000+00:00','2026-09-30T02:00:00.000Z','legacy_projection'
  )`);
  storeAt(db, "2026-10-02T02:00:00.000Z").appendReview({
    record_id: "record-a",
    reviewer_user_id: "teacher-a",
    status: "included",
    note: "later valid review",
    reviewed_by: "Teacher A",
  });
  runMigrations(db);
  const store = storeAt(db, "2026-10-03T02:00:00.000Z");
  try {
    assert.throws(() =>
      store.createAnalysisRun(
        run({ id: "invalid-history-app", dataset_hash: "sha256:invalid-history-app" }),
        [{ record_id: "record-a", input_hash: "sha256:invalid-history-app:0" }],
      ),
    );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) count FROM analysis_runs WHERE id='invalid-history-app'")
          .get() as {
          count: number;
        }
      ).count,
      0,
    );

    rawRun(db, "invalid-history-raw", "2026-10-03T02:00:00.000Z");
    const recordSnapshot = auditSnapshot(db, "record-a");
    const reviewSnapshot = store.listReviewHistory("record-a").at(-1);
    assert.ok(reviewSnapshot);
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO analysis_inputs(
            analysis_run_id,ordinal,record_id,review_id,input_hash,
            record_snapshot_json,review_snapshot_json,snapshot_schema,
            review_binding_mode,review_omission_reason
          ) VALUES('invalid-history-raw',0,'record-a',?,'sha256:invalid-history-raw:0',
            ?,?,?,'effective',NULL)`,
        )
        .run(reviewSnapshot.id, JSON.stringify(recordSnapshot), JSON.stringify(reviewSnapshot), V1),
    );
    assert.throws(() =>
      store.appendReview({
        record_id: "record-a",
        reviewer_user_id: "teacher-a",
        status: "included",
        note: "cannot append over unverified history",
        reviewed_by: "Teacher A",
      }),
    );
  } finally {
    db.close();
  }
});

test("calendar-invalid legacy record time blocks new review events", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher", { name: "Teacher A" });
  storeAt(db, "2026-08-20T00:00:00.000Z").add(command());
  db.exec("DROP TRIGGER experiment_original_provenance_guard");
  db.exec(
    `UPDATE experiment_records
     SET created_at='2026-02-30T00:00:00.000+00:00'
     WHERE id='record-a'`,
  );
  db.exec(`CREATE TRIGGER experiment_original_provenance_guard
    BEFORE UPDATE OF id,submitted_json,submission_kind,created_by_user_id,
      client_submission_id,created_at,idempotency_scope_class_id
    ON experiment_records
    WHEN NEW.id IS NOT OLD.id
      OR NEW.submitted_json IS NOT OLD.submitted_json
      OR NEW.submission_kind IS NOT OLD.submission_kind
      OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
      OR NEW.client_submission_id IS NOT OLD.client_submission_id
      OR NEW.created_at IS NOT OLD.created_at
      OR NEW.idempotency_scope_class_id IS NOT OLD.idempotency_scope_class_id
    BEGIN SELECT RAISE(ABORT,'original submission provenance is immutable'); END`);
  runMigrations(db);
  const store = storeAt(db, "2026-08-21T00:00:00.000Z");
  try {
    assert.ok(
      db
        .prepare(
          `SELECT 1 FROM provenance_boundary_classifications
           WHERE entity_type='record' AND entity_id='record-a' AND field_name='created_at'
             AND classification='legacy_offset_timestamp_calendar_invalid_unverified'`,
        )
        .get(),
    );
    assert.throws(() =>
      store.appendReview({
        record_id: "record-a",
        reviewer_user_id: "teacher-a",
        status: "included",
        note: "cannot establish chronology",
        reviewed_by: "Teacher A",
      }),
    );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) count FROM record_reviews WHERE record_id='record-a'")
          .get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    db.close();
  }
});

test("raw scientific correction requires a strictly advanced updated_at", () => {
  const { db } = seeded();
  try {
    const before = db
      .prepare(
        "SELECT oil_mass,yield_percent,updated_at FROM experiment_records WHERE id='record-a'",
      )
      .get();
    assert.throws(() =>
      db.exec("UPDATE experiment_records SET oil_mass=2,yield_percent=20 WHERE id='record-a'"),
    );
    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT oil_mass,yield_percent,updated_at FROM experiment_records WHERE id='record-a'",
          )
          .get(),
      },
      { ...before },
    );
  } finally {
    db.close();
  }
});

test("raw note correction requires a strictly advanced updated_at", () => {
  const { db } = seeded();
  try {
    assert.throws(() =>
      db.exec("UPDATE experiment_records SET note='changed' WHERE id='record-a'"),
    );
    assert.equal(
      (
        db.prepare("SELECT note FROM experiment_records WHERE id='record-a'").get() as {
          note: string;
        }
      ).note,
      "original",
    );
  } finally {
    db.close();
  }
});

test("raw metadata correction requires a strictly advanced updated_at", () => {
  const { db } = seeded();
  try {
    assert.throws(() =>
      db
        .prepare("UPDATE experiment_records SET metadata_json=? WHERE id='record-a'")
        .run(JSON.stringify({ corrected: true })),
    );
    assert.equal(
      (
        db.prepare("SELECT metadata_json FROM experiment_records WHERE id='record-a'").get() as {
          metadata_json: string;
        }
      ).metadata_json,
      "{}",
    );
  } finally {
    db.close();
  }
});

test("raw offline-provenance correction requires a strictly advanced updated_at", () => {
  const { db } = seeded();
  try {
    assert.throws(() =>
      db.exec("UPDATE experiment_records SET synced_from_offline=1 WHERE id='record-a'"),
    );
    assert.equal(
      (
        db
          .prepare("SELECT synced_from_offline FROM experiment_records WHERE id='record-a'")
          .get() as {
          synced_from_offline: number;
        }
      ).synced_from_offline,
      0,
    );
  } finally {
    db.close();
  }
});

test("record identity corrections cannot introduce a non-machine class identifier", () => {
  const { db } = seeded();
  try {
    db.prepare("INSERT INTO classes(id,name,teacher_id,created_at) VALUES(?,?,NULL,?)").run(
      "\u00a0",
      "Invalid historical class",
      "2026-08-20T00:00:00.000Z",
    );
    assert.throws(() =>
      db
        .prepare(
          `UPDATE experiment_records SET class_id=?,class_name_snapshot=?,updated_at=?
           WHERE id='record-a'`,
        )
        .run("\u00a0", "Invalid historical class", "2026-08-20T00:00:00.001Z"),
    );
  } finally {
    db.close();
  }
});

test("canonical one-millisecond version advances are exact and cannot be reused", () => {
  const { db } = seeded();
  try {
    db.exec(
      `UPDATE experiment_records SET note='advanced',updated_at='2026-08-20T00:00:00.001Z'
       WHERE id='record-a'`,
    );
    assert.equal(
      (
        db.prepare("SELECT note FROM experiment_records WHERE id='record-a'").get() as {
          note: string;
        }
      ).note,
      "advanced",
    );
    assert.throws(() =>
      db.exec(
        `UPDATE experiment_records SET note='reused',updated_at='2026-08-20T00:00:00.001Z'
         WHERE id='record-a'`,
      ),
    );
  } finally {
    db.close();
  }
});

test("timestamp-only writes cannot move a record version clock backward or off contract", () => {
  const { db } = seeded();
  try {
    db.exec(
      `UPDATE experiment_records SET note='version one',updated_at='2026-08-20T00:00:01.000Z'
       WHERE id='record-a'`,
    );
    assert.throws(() =>
      db.exec(
        `UPDATE experiment_records SET updated_at='2026-08-20T00:00:00.000Z'
         WHERE id='record-a'`,
      ),
    );
    assert.throws(() =>
      db.exec("UPDATE experiment_records SET updated_at='not-a-time' WHERE id='record-a'"),
    );
    assert.throws(() =>
      db.exec(
        `UPDATE experiment_records SET note='laundered',updated_at='2026-08-20T00:00:00.001Z'
         WHERE id='record-a'`,
      ),
    );
    const row = db
      .prepare("SELECT note,updated_at FROM experiment_records WHERE id='record-a'")
      .get();
    assert.deepEqual({ ...row }, { note: "version one", updated_at: "2026-08-20T00:00:01.000Z" });
  } finally {
    db.close();
  }
});

test("Migration 009 downgrades same-version snapshot and durable-record disagreement", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  storeAt(db, "2026-08-20T00:00:00.000Z").add(command());
  storeAt(db, "2026-08-20T01:00:00.000Z").update("record-a", { note: "versioned" });
  storeAt(db, "2026-08-20T02:00:00.000Z").createAnalysisRun(
    run({ id: "same-version-run", dataset_hash: "sha256:same-version-run" }),
    [{ record_id: "record-a", input_hash: "sha256:same-version-run:0" }],
  );
  db.exec("UPDATE experiment_records SET note='unversioned tamper' WHERE id='record-a'");
  try {
    runMigrations(db);
    const row = db
      .prepare(
        `SELECT ai.snapshot_schema,ar.dataset_classification
         FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
         WHERE ai.analysis_run_id='same-version-run'`,
      )
      .get() as { snapshot_schema: string; dataset_classification: string };
    assert.deepEqual(
      { ...row },
      { snapshot_schema: LEGACY, dataset_classification: "legacy_unverified" },
    );
  } finally {
    db.close();
  }
});

test("Migration 009 classifies a schema-8 same-timestamp accepted correction", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  storeAt(db, "2026-08-20T00:00:00.000Z").add(command());
  db.exec("UPDATE experiment_records SET note='schema-8 accepted correction' WHERE id='record-a'");
  storeAt(db, "2026-08-20T02:00:00.000Z").createAnalysisRun(
    run({ id: "timestamp-collision-run", dataset_hash: "sha256:timestamp-collision" }),
    [{ record_id: "record-a", input_hash: "sha256:timestamp-collision:0" }],
  );
  try {
    runMigrations(db);
    assert.ok(
      db
        .prepare(
          `SELECT 1 FROM provenance_boundary_classifications
           WHERE entity_type='record' AND entity_id='record-a' AND field_name='updated_at'
             AND classification='pre_v9_record_version_time_collision_unverified'`,
        )
        .get(),
    );
    const row = db
      .prepare(
        `SELECT ai.snapshot_schema,ar.dataset_classification
         FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
         WHERE ai.analysis_run_id='timestamp-collision-run'`,
      )
      .get() as { snapshot_schema: string; dataset_classification: string };
    assert.deepEqual(
      { ...row },
      { snapshot_schema: LEGACY, dataset_classification: "legacy_unverified" },
    );
    const store = storeAt(db, "2026-08-20T03:00:00.000Z");
    assert.throws(() =>
      store.createAnalysisRun(
        run({ id: "timestamp-collision-new", dataset_hash: "sha256:collision-new" }),
        [{ record_id: "record-a", input_hash: "sha256:collision-new:0" }],
      ),
    );
  } finally {
    db.close();
  }
});

test("Migration 009 downgrades every snapshot sharing a collided record version", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  storeAt(db, "2026-08-20T00:00:00.000Z").add(command());
  storeAt(db, "2026-08-20T01:00:00.000Z").update("record-a", { note: "first version" });
  storeAt(db, "2026-08-20T02:00:00.000Z").createAnalysisRun(
    run({ id: "collision-before", dataset_hash: "sha256:collision-before" }),
    [{ record_id: "record-a", input_hash: "sha256:collision-before:0" }],
  );
  db.exec("UPDATE experiment_records SET note='second version' WHERE id='record-a'");
  storeAt(db, "2026-08-20T03:00:00.000Z").createAnalysisRun(
    run({ id: "collision-after", dataset_hash: "sha256:collision-after" }),
    [{ record_id: "record-a", input_hash: "sha256:collision-after:0" }],
  );
  try {
    runMigrations(db);
    const rows = db
      .prepare(
        `SELECT ai.analysis_run_id,ai.snapshot_schema,ar.dataset_classification
         FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
         WHERE ai.analysis_run_id IN ('collision-before','collision-after')
         ORDER BY ai.analysis_run_id`,
      )
      .all() as Array<{
      analysis_run_id: string;
      snapshot_schema: string;
      dataset_classification: string;
    }>;
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        {
          analysis_run_id: "collision-after",
          snapshot_schema: LEGACY,
          dataset_classification: "legacy_unverified",
        },
        {
          analysis_run_id: "collision-before",
          snapshot_schema: LEGACY,
          dataset_classification: "legacy_unverified",
        },
      ],
    );
    assert.throws(() =>
      storeAt(db, "2026-08-20T04:00:00.000Z").createAnalysisRun(
        run({ id: "collision-current", dataset_hash: "sha256:collision-current" }),
        [{ record_id: "record-a", input_hash: "sha256:collision-current:0" }],
      ),
    );
  } finally {
    db.close();
  }
});

test("Migration 009 classifies historical empty and non-zero-start sealed datasets", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T00:00:00.000Z");
  store.add(command());
  const snapshot = sourceSnapshot(db, store, "historical-source");
  rawRun(db, "historical-empty", "2026-08-20T03:00:00.000Z");
  rawRun(db, "historical-gap", "2026-08-20T03:00:00.000Z");
  insertNoneInput(db, "historical-gap", 5, "record-a", snapshot);
  runMigrations(db, MIGRATIONS.slice(0, 8));
  try {
    runMigrations(db);
    const rows = db
      .prepare(
        `SELECT id,dataset_classification FROM analysis_runs
         WHERE id IN ('historical-empty','historical-gap') ORDER BY id`,
      )
      .all() as Array<{ id: string; dataset_classification: string }>;
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        { id: "historical-empty", dataset_classification: "legacy_incomplete" },
        { id: "historical-gap", dataset_classification: "legacy_incomplete" },
      ],
    );
  } finally {
    db.close();
  }
});

test("Migration 009 classifies a historical sealed duplicate-record dataset", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T00:00:00.000Z");
  store.add(command());
  const snapshot = JSON.stringify(auditSnapshot(db, "record-a"));
  rawRun(db, "historical-duplicate", "2026-08-20T03:00:00.000Z");
  db.exec(`
    PRAGMA foreign_keys=OFF;
    DROP TRIGGER IF EXISTS analysis_inputs_008_boundary;
    DROP TRIGGER analysis_inputs_no_update;
    DROP TRIGGER analysis_inputs_no_delete;
    ALTER TABLE analysis_inputs RENAME TO analysis_inputs_unique_v8;
    CREATE TABLE analysis_inputs (
      analysis_run_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0),
      record_id TEXT NOT NULL,
      review_id TEXT,
      input_hash TEXT NOT NULL,
      record_snapshot_json TEXT NOT NULL CHECK(json_valid(record_snapshot_json)),
      review_snapshot_json TEXT CHECK(review_snapshot_json IS NULL OR json_valid(review_snapshot_json)),
      snapshot_schema TEXT NOT NULL CHECK(snapshot_schema IN ('${V1}','${LEGACY}')),
      review_binding_mode TEXT NOT NULL CHECK(review_binding_mode IN (
        'effective','omit','none','legacy_unspecified'
      )),
      review_omission_reason TEXT,
      PRIMARY KEY(analysis_run_id,ordinal),
      FOREIGN KEY(analysis_run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(record_id) REFERENCES experiment_records(id) ON DELETE RESTRICT,
      FOREIGN KEY(review_id) REFERENCES record_reviews(id) ON DELETE RESTRICT
    ) STRICT;
    DROP TABLE analysis_inputs_unique_v8;
    CREATE INDEX idx_analysis_inputs_record ON analysis_inputs(record_id);
    PRAGMA foreign_keys=ON;
  `);
  insertNoneInput(db, "historical-duplicate", 0, "record-a", snapshot);
  insertNoneInput(db, "historical-duplicate", 1, "record-a", snapshot);
  db.exec("UPDATE analysis_runs SET inputs_sealed=1 WHERE id='historical-duplicate'");
  db.exec(`
    CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
    CREATE TRIGGER analysis_inputs_no_delete BEFORE DELETE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
  `);
  try {
    runMigrations(db);
    const row = db
      .prepare(`SELECT dataset_classification FROM analysis_runs WHERE id='historical-duplicate'`)
      .get() as { dataset_classification: string };
    assert.equal(row.dataset_classification, "legacy_incomplete");
    assert.ok(
      db
        .prepare(
          `SELECT 1 FROM provenance_boundary_classifications
           WHERE entity_type='analysis_run' AND entity_id='historical-duplicate'
             AND classification='legacy_incomplete_sealed_dataset'`,
        )
        .get(),
    );
  } finally {
    db.close();
  }
});

test("Migration 009 fails closed on recursively unsafe historical run JSON", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  db.prepare(
    `INSERT INTO analysis_runs(
      id,dataset_hash,algorithm_version,configuration_json,code_version,status,
      results_metadata_json,created_by_user_id,created_at,completed_at,inputs_sealed
    ) VALUES('unsafe-json-run','sha256:unsafe-json','algorithm-a',?,'code-a','pending',
      '{}',NULL,'2026-08-20T03:00:00.000Z',NULL,0)`,
  ).run('{"nested":[1e400]}');
  try {
    assert.throws(() => runMigrations(db), /run:unsafe-json-run:configuration_json/);
    assert.equal(
      (
        db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
      8,
    );
  } finally {
    db.close();
  }
});

test("deleted-at-selection historical input does not remain exact v1", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T00:00:00.000Z");
  store.add(command());
  storeAt(db, "2026-08-20T01:00:00.000Z").delete("record-a");
  rawRun(db, "deleted-selection", "2026-08-20T02:00:00.000Z");
  insertNoneInput(
    db,
    "deleted-selection",
    0,
    "record-a",
    JSON.stringify(auditSnapshot(db, "record-a")),
  );
  try {
    try {
      runMigrations(db);
    } catch (error) {
      assert.match(String(error), /deleted-selection|record-a|archive|deleted/i);
      return;
    }
    const row = db
      .prepare(
        "SELECT snapshot_schema,review_binding_mode FROM analysis_inputs WHERE analysis_run_id='deleted-selection'",
      )
      .get() as { snapshot_schema: string; review_binding_mode: string };
    assert.equal(row.snapshot_schema, LEGACY);
    assert.equal(row.review_binding_mode, "legacy_unspecified");
  } finally {
    db.close();
  }
});

test("active snapshot with a run time after durable archival does not remain exact", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a");
  const store = storeAt(db, "2026-08-20T00:00:00.000Z");
  store.add(command());
  const activeSnapshot = sourceSnapshot(db, store, "pre-archive-source");
  rawRun(db, "post-archive-claim", "2026-08-20T02:00:00.000Z");
  insertNoneInput(db, "post-archive-claim", 0, "record-a", activeSnapshot);
  storeAt(db, "2026-08-20T01:00:00.000Z").delete("record-a");
  try {
    runMigrations(db);
    const row = db
      .prepare(
        `SELECT ai.snapshot_schema,ar.dataset_classification
         FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
         WHERE ai.analysis_run_id='post-archive-claim'`,
      )
      .get() as { snapshot_schema: string; dataset_classification: string };
    assert.deepEqual(
      { ...row },
      { snapshot_schema: LEGACY, dataset_classification: "legacy_unverified" },
    );
  } finally {
    db.close();
  }
});

function databaseWithHistoricalOffset(offsetTimestamp: string): DatabaseSync {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a");
  new SqliteProvenanceStore(db).add(command());
  db.exec("DROP TRIGGER experiment_original_provenance_guard");
  db.prepare("UPDATE experiment_records SET created_at=?,updated_at=? WHERE id='record-a'").run(
    offsetTimestamp,
    offsetTimestamp,
  );
  return db;
}

test("calendar-invalid legacy offset timestamp is rejected or explicitly unverified", () => {
  const db = databaseWithHistoricalOffset("2026-02-30T00:00:00.000+08:00");
  try {
    try {
      runMigrations(db);
    } catch (error) {
      assert.match(String(error), /record-a|created_at|calendar|timestamp/i);
      return;
    }
    const classifications = db
      .prepare(
        `SELECT classification FROM provenance_boundary_classifications
         WHERE entity_type='record' AND entity_id='record-a' AND field_name='created_at'`,
      )
      .all() as Array<{ classification: string }>;
    assert.ok(
      classifications.some((row) => /invalid|unverified/i.test(row.classification)),
      "an impossible offset date must not be represented only as a legitimate legacy offset",
    );
  } finally {
    db.close();
  }
});

function classifiedDatabase(): DatabaseSync {
  const db = databaseWithHistoricalOffset("2026-08-20T08:00:00.000+08:00");
  runMigrations(db);
  assert.ok(
    db
      .prepare(
        `SELECT 1 FROM provenance_boundary_classifications
         WHERE entity_type='record' AND entity_id='record-a' AND field_name='created_at'`,
      )
      .get(),
  );
  return db;
}

test("classification ledger rejects UPDATE", () => {
  const db = classifiedDatabase();
  try {
    assert.throws(() =>
      db.exec(
        `UPDATE provenance_boundary_classifications SET classification='tampered'
         WHERE entity_type='record' AND entity_id='record-a' AND field_name='created_at'`,
      ),
    );
  } finally {
    db.close();
  }
});

test("classification ledger rejects DELETE", () => {
  const db = classifiedDatabase();
  try {
    assert.throws(() =>
      db.exec(
        `DELETE FROM provenance_boundary_classifications
         WHERE entity_type='record' AND entity_id='record-a' AND field_name='created_at'`,
      ),
    );
  } finally {
    db.close();
  }
});

test("classification ledger rejects INSERT OR REPLACE mutation paths", () => {
  const db = classifiedDatabase();
  try {
    const row = db
      .prepare(
        `SELECT * FROM provenance_boundary_classifications
         WHERE entity_type='record' AND entity_id='record-a' AND field_name='created_at'
         ORDER BY classification_id LIMIT 1`,
      )
      .get() as {
      classification_id: number;
      classification_migration_version: number;
      classification_migration_name: string;
      entity_type: string;
      entity_id: string;
      field_name: string;
      classification: string;
      observed_value: string;
      classified_at: string;
    };
    db.exec("PRAGMA recursive_triggers=OFF");
    assert.throws(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO provenance_boundary_classifications(
            classification_id,classification_migration_version,classification_migration_name,
            entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          row.classification_id,
          row.classification_migration_version,
          row.classification_migration_name,
          row.entity_type,
          row.entity_id,
          row.field_name,
          row.classification,
          row.observed_value,
          "tampered replacement",
          row.classified_at,
        ),
    );
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO provenance_boundary_classifications(
            classification_id,classification_migration_version,classification_migration_name,
            entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
          ) VALUES(-1,9,'sentinel-attempt','record','sentinel-record','updated_at',
            'sentinel_attempt','value','must fail','2026-08-20T00:00:00.000Z')`,
        )
        .run(),
    );
  } finally {
    db.close();
  }
});

test("classified valid historical offset analysis runs remain readable", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  rawRun(db, "historical-offset-run", "2026-08-20T09:00:00.000+08:00");
  try {
    runMigrations(db);
    const runRow = new SqliteProvenanceStore(db).findAnalysisRun("historical-offset-run");
    assert.ok(runRow);
    assert.equal(runRow.created_at, "2026-08-20T09:00:00.000+08:00");
    assert.ok(
      db
        .prepare(
          `SELECT 1 FROM provenance_boundary_classifications
           WHERE entity_type='run' AND entity_id='historical-offset-run'
             AND field_name='created_at' AND classification='legacy_offset_timestamp'`,
        )
        .get(),
    );
    assert.throws(() => rawRun(db, "new-offset-run", "2026-08-20T09:00:00.000+08:00"));
  } finally {
    db.close();
  }
});

function reviewedSchema8(): DatabaseSync {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 8));
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher", { name: "Teacher A" });
  new SqliteProvenanceStore(db).add(command());
  storeAt(db, "2026-08-20T01:00:00.000Z").importReview(review());
  storeAt(db, "2026-08-20T02:00:00.000Z").createAnalysisRun(
    run({ id: "reviewed-history-run", dataset_hash: "sha256:reviewed-history-run" }),
    [{ record_id: "record-a", input_hash: "sha256:reviewed-history-run:0" }],
  );
  return db;
}

function assertReviewPreserved(db: DatabaseSync, expectExactInput = true): void {
  const row = db
    .prepare(
      `SELECT rr.id,rr.record_id,rr.reviewer_user_id,rr.reviewer_label,
        rr.decision,rr.reason,rr.decided_at,rr.created_at,rr.provenance_kind,
        reo.event_sequence,er.effective_review_id,er.review_status,er.review_note,
        er.reviewed_at,er.reviewed_by,er.updated_at
       FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       JOIN experiment_records er ON er.id=rr.record_id
       WHERE rr.id='review-a'`,
    )
    .get();
  assert.deepEqual(
    { ...row },
    {
      id: "review-a",
      record_id: "record-a",
      reviewer_user_id: "teacher-a",
      reviewer_label: "Teacher A",
      decision: "included",
      reason: "accepted",
      decided_at: "2026-08-20T01:00:00.000Z",
      created_at: "2026-08-20T01:00:00.000Z",
      provenance_kind: "human",
      event_sequence: 1,
      effective_review_id: "review-a",
      review_status: "included",
      review_note: "accepted",
      reviewed_at: "2026-08-20T01:00:00.000Z",
      reviewed_by: "Teacher A",
      updated_at: "2026-08-20T01:00:00.000Z",
    },
  );
  if (!expectExactInput) return;
  const input = new SqliteProvenanceStore(db).listAnalysisInputs("reviewed-history-run")[0];
  assert.ok(input);
  assert.equal(input.snapshot_schema, V1);
  assert.equal(input.review_binding_mode, "effective");
  assert.equal(input.review_id, "review-a");
  assert.equal(input.review_snapshot?.id, "review-a");
  assert.equal(input.review_snapshot?.reviewed_by, "Teacher A");
}

function assertHistoricalReviewerLimitationRecorded(db: DatabaseSync): void {
  const row = db
    .prepare(
      `SELECT classification_migration_version,entity_id,classification,observed_value,classified_at
       FROM provenance_boundary_classifications
       WHERE entity_type='review' AND entity_id='review-a'
         AND field_name='historical_reviewer_authorization'`,
    )
    .get() as {
    classification_migration_version: number;
    entity_id: string;
    classification: string;
    observed_value: string;
    classified_at: string;
  };
  assert.equal(row.classification_migration_version, 9);
  assert.equal(row.entity_id, "review-a");
  assert.equal(row.classification, "historical_account_state_not_snapshotted");
  assert.equal(row.observed_value, "teacher-a");
  assert.match(row.classified_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}

test("Migration 009 preserves a valid old review after reviewer rename", () => {
  const db = reviewedSchema8();
  try {
    db.exec(
      `UPDATE users SET username='teacher-renamed',name='Teacher Renamed'
       WHERE id='teacher-a'`,
    );
    runMigrations(db);
    assert.equal(
      (
        db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
      LATEST_SCHEMA_VERSION,
    );
    assertReviewPreserved(db);
    assertHistoricalReviewerLimitationRecorded(db);
  } finally {
    db.close();
  }
});

test("Migration 009 preserves a valid old review after account disablement and role change", () => {
  const db = reviewedSchema8();
  try {
    db.exec("UPDATE users SET status='disabled',role='student' WHERE id='teacher-a'");
    runMigrations(db);
    assert.equal(
      (
        db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
      LATEST_SCHEMA_VERSION,
    );
    assertReviewPreserved(db);
    assertHistoricalReviewerLimitationRecorded(db);
  } finally {
    db.close();
  }
});

function assertSchema7ReviewerDriftGate(mutateAccount: (db: DatabaseSync) => void): void {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  seedUser(db, "user-a");
  seedUser(db, "teacher-a", "teacher", { name: "Teacher A" });
  new SqliteProvenanceStore(db).add(command());
  storeAt(db, "2026-08-20T01:00:00.000Z").importReview(review());
  mutateAccount(db);
  const recordBefore = JSON.stringify(
    db.prepare("SELECT * FROM experiment_records WHERE id='record-a'").get(),
  );
  const reviewBefore = JSON.stringify(
    db.prepare("SELECT * FROM record_reviews WHERE id='review-a'").get(),
  );
  const usersBefore = JSON.stringify(db.prepare("SELECT * FROM users ORDER BY id").all());
  let sentinelCalled = false;
  const sentinel: Migration = {
    version: 9,
    name: "schema_v7_compatibility_sentinel",
    up() {
      sentinelCalled = true;
    },
  };
  try {
    assert.throws(
      () => runMigrations(db, [...MIGRATIONS.slice(0, 8), sentinel]),
      /review:review-a:human_reviewer_boundary|human reviewer boundary/i,
    );
    assert.equal(sentinelCalled, false);
    assert.equal(
      (
        db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
      7,
    );
    assert.equal(tableHasColumn(db, "analysis_runs", "inputs_sealed"), false);
    assert.equal(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='provenance_boundary_classifications'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM experiment_records WHERE id='record-a'").get()),
      recordBefore,
    );
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM record_reviews WHERE id='review-a'").get()),
      reviewBefore,
    );
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM users ORDER BY id").all()), usersBefore);
    assert.deepEqual(
      (
        db.prepare("SELECT id FROM users ORDER BY id").all() as Array<{
          id: string;
        }>
      ).map((row) => row.id),
      ["teacher-a", "user-a"],
    );
    assertReviewPreserved(db, false);
  } finally {
    db.close();
  }
}

for (const [label, mutate] of [
  [
    "rename",
    (db: DatabaseSync) =>
      db.exec(
        `UPDATE users SET username='teacher-renamed',name='Teacher Renamed'
         WHERE id='teacher-a'`,
      ),
  ],
  [
    "disablement",
    (db: DatabaseSync) => db.exec("UPDATE users SET status='disabled' WHERE id='teacher-a'"),
  ],
  [
    "role change",
    (db: DatabaseSync) => db.exec("UPDATE users SET role='student' WHERE id='teacher-a'"),
  ],
] as const)
  test(`schema-v7 reviewer ${label} stops at immutable Migration 008`, () =>
    assertSchema7ReviewerDriftGate(mutate));

test("frozen Migration 008 keeps its historical shared identity semantics", () => {
  const db = database();
  runMigrations(db, MIGRATIONS.slice(0, 7));
  rawRun(db, "rún-histórico");
  try {
    runMigrations(db, MIGRATIONS.slice(0, 8));
    assert.equal(
      (
        db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
      8,
    );
    assert.throws(() => runMigrations(db), /run:rún-histórico:id/);
  } finally {
    db.close();
  }
});

test("legitimate point-in-time input remains readable after edit review and archive", () => {
  const { db, store } = seeded("2026-08-20T01:00:00.000Z");
  try {
    store.createAnalysisRun(run({ id: "historical-run" }), [
      { record_id: "record-a", input_hash: "sha256:historical" },
    ]);
    storeAt(db, "2026-08-20T02:00:00.000Z").update("record-a", {
      note: "later correction",
      oil_mass: 2,
    });
    storeAt(db, "2026-08-20T03:00:00.000Z").appendReview({
      record_id: "record-a",
      reviewer_user_id: "teacher-a",
      status: "included",
      note: "later review",
      reviewed_by: "Teacher A",
    });
    assert.equal(storeAt(db, "2026-08-20T04:00:00.000Z").delete("record-a"), true);

    const input = store.listAnalysisInputs("historical-run")[0];
    assert.ok(input);
    assert.equal(input.snapshot_schema, V1);
    assert.equal(input.review_binding_mode, "none");
    assert.equal(input.record_snapshot.note, "original");
    assert.equal(input.record_snapshot.oil_mass, 1);
    assert.equal(input.record_snapshot.status, "active");
    assert.equal(input.record_snapshot.updated_at, "2026-08-20T00:00:00.000Z");
  } finally {
    db.close();
  }
});

test("released migrations 001 through 008 and frozen v2 preflight retain accepted bindings", async () => {
  const expected = new Map([
    ["001-initial-schema.ts", "ba1c161de326f446a01eeac308816ba67bee41b6"],
    ["002-normalized-provenance.ts", "5c7a8485486c99a4b55c1c8bee2b37e2691559d5"],
    ["003-provenance-integrity-hardening.ts", "2061186b4a757023a1861000e892cbc6204a589a"],
    ["004-end-to-end-provenance-closure.ts", "5fe991ef6fe2272f927078e1848485969cfa5643"],
    ["005-independent-audit-provenance-repair.ts", "0d11a54555e8d60291a88d60a274c79fdfa9b3bf"],
    ["006-temporal-analysis-contract-closure.ts", "e1793e06a0b31d20de6d9872e16cdc7696bbeb72"],
    ["007-analysis-selection-and-run-integrity.ts", "c00484b07209ef401ea4c4c63fb397cc2b23af5e"],
    [
      "008-analysis-input-sealing-and-provenance-boundary.ts",
      "672479686b7e1c8a815b7599f45229a1de83534a",
    ],
    ["002-legacy-preflight.ts", "a803cc9032e23d8603d5ebcea827740aab321e33"],
  ]);
  for (const [file, hash] of expected) {
    const source = await readFile(`src/infrastructure/database/migrations/${file}`);
    const result = spawnSync("git", ["hash-object", "--stdin"], { input: source });
    assert.equal(result.status, 0, file);
    assert.equal(result.stdout.toString().trim(), hash, file);
  }
  assert.deepEqual(
    MIGRATIONS.slice(0, 8).map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(MIGRATIONS[1]?.preflight, preflightAndPrepareMigration2);
});
