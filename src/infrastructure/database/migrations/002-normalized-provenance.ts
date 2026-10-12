import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./types.js";

interface LegacyRecordRow {
  id: string;
  class_name: string;
  created_by: string | null;
  student_name: string | null;
  nh4cl_concentration: number | null;
  yield_percent: number | null;
  created_at: string;
  data_json: string;
}

const knownRecordKeys = new Set([
  "id",
  "client_submission_id",
  "created_by_user_id",
  "class_id",
  "group_id",
  "experiment_type",
  "status",
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
  "yield_percent",
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
]);

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("non-object legacy JSON");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Legacy record JSON is malformed; migration aborted");
  }
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function resolveUserId(database: DatabaseSync, ...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const value = text(candidate).trim();
    if (!value) continue;
    const row = database
      .prepare("SELECT id FROM users WHERE id = ? OR username = ? LIMIT 1")
      .get(value, value) as unknown as { id: string } | undefined;
    if (row?.id) return row.id;
  }
  return null;
}

function ensureClass(database: DatabaseSync, className: string, appliedAt: string): string {
  const existing = database
    .prepare("SELECT id FROM classes WHERE name=?")
    .get(className) as unknown as { id: string } | undefined;
  if (existing?.id) return existing.id;
  const classId = stableId("class", className);
  database
    .prepare(
      "INSERT OR IGNORE INTO classes(id, name, teacher_id, created_at) VALUES(?, ?, NULL, ?)",
    )
    .run(classId, className, appliedAt);
  return classId;
}

function ensureGroup(
  database: DatabaseSync,
  classId: string,
  groupName: string,
  appliedAt: string,
): string | null {
  if (!groupName) return null;
  const existing = database
    .prepare("SELECT id FROM groups WHERE class_id=? AND name=?")
    .get(classId, groupName) as unknown as { id: string } | undefined;
  if (existing?.id) return existing.id;
  const groupId = stableId("group", `${classId}\u0000${groupName}`);
  database
    .prepare("INSERT OR IGNORE INTO groups(id, class_id, name, created_at) VALUES(?, ?, ?, ?)")
    .run(groupId, classId, groupName, appliedAt);
  return groupId;
}

function normalizedSubmission(data: Record<string, unknown>, row: LegacyRecordRow) {
  return {
    student_name: text(data.student_name, row.student_name ?? ""),
    class_name: text(data.class_name, row.class_name),
    group_name: text(data.group_name),
    nh4cl_concentration: number(data.nh4cl_concentration, Number(row.nh4cl_concentration ?? 0)),
    peel_mass: number(data.peel_mass),
    oil_mass: number(data.oil_mass),
    distillation_time: number(data.distillation_time),
    phase_clarity_score: number(data.phase_clarity_score),
    emulsification_level: text(data.emulsification_level),
    emulsion_concentration: number(data.emulsion_concentration),
    ecoli_observation_group: text(data.ecoli_observation_group),
    inhibition_zone_diameter: number(data.inhibition_zone_diameter),
    colony_growth_score: number(data.colony_growth_score),
    异常标记: Boolean(data.异常标记),
    error_source: text(data.error_source),
    note: text(data.note),
  };
}

function migrateLegacyRecords(database: DatabaseSync, appliedAt: string): void {
  const legacyRows = database
    .prepare(
      `SELECT id, class_name, created_by, student_name, nh4cl_concentration,
              yield_percent, created_at, data_json
       FROM records ORDER BY created_at, id`,
    )
    .all() as unknown as LegacyRecordRow[];
  const insertRecord = database.prepare(`
    INSERT INTO experiment_records(
      id, client_submission_id, created_by_user_id, created_by_label,
      class_id, class_name_snapshot, group_id, group_name_snapshot,
      student_name, experiment_type, status,
      nh4cl_concentration, peel_mass, oil_mass, distillation_time,
      phase_clarity_score, emulsification_level, emulsion_concentration,
      ecoli_observation_group, inhibition_zone_diameter, colony_growth_score,
      anomaly_flag, error_source, note, yield_percent,
      review_status, review_note, reviewed_at, reviewed_by,
      synced_from_offline, ai_diagnosis, submission_kind,
      submitted_json, metadata_json, created_at, updated_at
    ) VALUES(
      $id, $clientSubmissionId, $createdByUserId, $createdByLabel,
      $classId, $className, $groupId, $groupName,
      $studentName, $experimentType, $status,
      $concentration, $peelMass, $oilMass, $distillationTime,
      $clarityScore, $emulsificationLevel, $emulsionConcentration,
      $observationGroup, $zoneDiameter, $colonyScore,
      $anomalyFlag, $errorSource, $note, $yieldPercent,
      $reviewStatus, $reviewNote, $reviewedAt, $reviewedBy,
      $offline, $aiDiagnosis, 'legacy_canonical_snapshot',
      $submittedJson, $metadataJson, $createdAt, $updatedAt
    )
  `);
  const insertReview = database.prepare(`
    INSERT INTO record_reviews(
      id, record_id, reviewer_user_id, reviewer_label, decision, reason,
      decided_at, created_at, provenance_kind
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'legacy_projection')
  `);

  for (const row of legacyRows) {
    const data = parseObject(row.data_json);
    const metadataSource =
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? { ...(data.metadata as Record<string, unknown>) }
        : {};
    const clientSubmissionId = text(
      data.client_submission_id,
      text(metadataSource.client_submission_id),
    ).trim();
    const className = text(data.class_name, row.class_name) || "unassigned";
    const groupName = text(data.group_name);
    const classId = ensureClass(database, className, appliedAt);
    const groupId = ensureGroup(database, classId, groupName, appliedAt);
    const createdByLabel = text(data.created_by, row.created_by ?? "");
    const createdByUserId = resolveUserId(
      database,
      data.created_by_user_id,
      metadataSource.idempotency_actor_id,
      createdByLabel,
    );
    const submission = normalizedSubmission(data, row);
    const extensionMetadata: Record<string, unknown> = { ...metadataSource };
    delete extensionMetadata.client_submission_id;
    delete extensionMetadata.idempotency_actor_id;
    delete extensionMetadata.idempotency_class_name;
    for (const [key, value] of Object.entries(data)) {
      if (!knownRecordKeys.has(key)) extensionMetadata[key] = value;
    }
    if (!createdByUserId && createdByLabel)
      extensionMetadata.legacy_unresolved_created_by = createdByLabel;
    const reviewStatusValue = text(data.review_status);
    const reviewStatus = ["normal", "review", "included", "excluded"].includes(reviewStatusValue)
      ? reviewStatusValue
      : "normal";
    const createdAt = text(data.created_at, row.created_at) || appliedAt;
    const updatedAt = text(data.updated_at, createdAt);
    insertRecord.run({
      $id: row.id,
      $clientSubmissionId: clientSubmissionId || null,
      $createdByUserId: createdByUserId,
      $createdByLabel: createdByLabel,
      $classId: classId,
      $className: className,
      $groupId: groupId,
      $groupName: groupName,
      $studentName: submission.student_name,
      $experimentType: text(data.experiment_type, "nh4cl_citrus_oil"),
      $status: text(data.status) === "deleted" ? "deleted" : "active",
      $concentration: submission.nh4cl_concentration,
      $peelMass: submission.peel_mass,
      $oilMass: submission.oil_mass,
      $distillationTime: submission.distillation_time,
      $clarityScore: submission.phase_clarity_score,
      $emulsificationLevel: submission.emulsification_level,
      $emulsionConcentration: submission.emulsion_concentration,
      $observationGroup: submission.ecoli_observation_group,
      $zoneDiameter: submission.inhibition_zone_diameter,
      $colonyScore: submission.colony_growth_score,
      $anomalyFlag: submission.异常标记 ? 1 : 0,
      $errorSource: submission.error_source,
      $note: submission.note,
      $yieldPercent: number(data.yield_percent, Number(row.yield_percent ?? 0)),
      $reviewStatus: reviewStatus,
      $reviewNote: text(data.review_note),
      $reviewedAt: text(data.reviewed_at) || null,
      $reviewedBy: text(data.reviewed_by),
      $offline: data.synced_from_offline || clientSubmissionId ? 1 : 0,
      $aiDiagnosis: text(data.ai_diagnosis),
      $submittedJson: JSON.stringify(submission),
      $metadataJson: JSON.stringify(extensionMetadata),
      $createdAt: createdAt,
      $updatedAt: updatedAt,
    });

    if (["review", "included", "excluded"].includes(reviewStatus)) {
      const reviewerLabel = text(data.reviewed_by);
      insertReview.run(
        `legacy-review-${row.id}`,
        row.id,
        resolveUserId(database, reviewerLabel),
        reviewerLabel,
        reviewStatus,
        text(data.review_note),
        text(data.reviewed_at) || null,
        appliedAt,
      );
    }
  }
  const migrated = database
    .prepare("SELECT COUNT(*) AS count FROM experiment_records")
    .get() as unknown as { count: number };
  if (Number(migrated.count) !== legacyRows.length)
    throw new Error("Legacy record migration count mismatch");
}

export const normalizedProvenanceMigration: Migration = {
  version: 2,
  name: "normalized_scientific_provenance",
  up(database, { appliedAt }) {
    database.exec(`
      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE(class_id, name),
        FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE experiment_records (
        id TEXT PRIMARY KEY,
        client_submission_id TEXT,
        created_by_user_id TEXT,
        created_by_label TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL,
        class_name_snapshot TEXT NOT NULL,
        group_id TEXT,
        group_name_snapshot TEXT NOT NULL DEFAULT '',
        student_name TEXT NOT NULL,
        experiment_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
        nh4cl_concentration REAL NOT NULL,
        peel_mass REAL NOT NULL,
        oil_mass REAL NOT NULL,
        distillation_time REAL NOT NULL,
        phase_clarity_score REAL NOT NULL,
        emulsification_level TEXT NOT NULL,
        emulsion_concentration REAL NOT NULL,
        ecoli_observation_group TEXT NOT NULL,
        inhibition_zone_diameter REAL NOT NULL,
        colony_growth_score REAL NOT NULL,
        anomaly_flag INTEGER NOT NULL CHECK(anomaly_flag IN (0, 1)),
        error_source TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        yield_percent REAL NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'normal'
          CHECK(review_status IN ('normal', 'review', 'included', 'excluded')),
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        reviewed_by TEXT NOT NULL DEFAULT '',
        synced_from_offline INTEGER NOT NULL DEFAULT 0 CHECK(synced_from_offline IN (0, 1)),
        ai_diagnosis TEXT NOT NULL DEFAULT '',
        submission_kind TEXT NOT NULL
          CHECK(submission_kind IN ('canonical_submission', 'legacy_canonical_snapshot')),
        submitted_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE RESTRICT,
        FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
      ) STRICT;

      CREATE TABLE record_reviews (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        reviewer_user_id TEXT,
        reviewer_label TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL CHECK(decision IN ('review', 'included', 'excluded')),
        reason TEXT NOT NULL DEFAULT '',
        decided_at TEXT,
        created_at TEXT NOT NULL,
        provenance_kind TEXT NOT NULL CHECK(provenance_kind IN ('human', 'legacy_projection')),
        FOREIGN KEY(record_id) REFERENCES experiment_records(id) ON DELETE RESTRICT,
        FOREIGN KEY(reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) STRICT;

      CREATE TRIGGER record_reviews_no_update
      BEFORE UPDATE ON record_reviews
      BEGIN
        SELECT RAISE(ABORT, 'record review history is append-only');
      END;
      CREATE TRIGGER record_reviews_no_delete
      BEFORE DELETE ON record_reviews
      BEGIN
        SELECT RAISE(ABORT, 'record review history is append-only');
      END;

      CREATE TABLE analysis_runs (
        id TEXT PRIMARY KEY,
        dataset_hash TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        configuration_json TEXT NOT NULL,
        code_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        results_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_by_user_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) STRICT;

      CREATE TABLE analysis_inputs (
        analysis_run_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        record_id TEXT NOT NULL,
        review_id TEXT,
        input_hash TEXT NOT NULL,
        record_snapshot_json TEXT NOT NULL,
        review_snapshot_json TEXT,
        PRIMARY KEY(analysis_run_id, ordinal),
        UNIQUE(analysis_run_id, record_id),
        FOREIGN KEY(analysis_run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
        FOREIGN KEY(record_id) REFERENCES experiment_records(id) ON DELETE RESTRICT,
        FOREIGN KEY(review_id) REFERENCES record_reviews(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX idx_experiment_records_class_created
        ON experiment_records(class_id, created_at DESC);
      CREATE INDEX idx_experiment_records_creator_created
        ON experiment_records(created_by_user_id, created_at DESC);
      CREATE INDEX idx_experiment_records_class_concentration
        ON experiment_records(class_id, nh4cl_concentration);
      CREATE UNIQUE INDEX uq_experiment_records_offline_submission
        ON experiment_records(created_by_user_id, class_id, client_submission_id)
        WHERE client_submission_id IS NOT NULL;
      CREATE INDEX idx_record_reviews_record_created
        ON record_reviews(record_id, created_at DESC, id DESC);
      CREATE INDEX idx_record_reviews_reviewer_created
        ON record_reviews(reviewer_user_id, created_at DESC);
      CREATE INDEX idx_analysis_inputs_record ON analysis_inputs(record_id);
    `);
    migrateLegacyRecords(database, appliedAt);
    database.exec("DROP TABLE records");
  },
};
