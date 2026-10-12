import type { DatabaseSync } from "node:sqlite";
import {
  ANALYSIS_SNAPSHOT_LEGACY,
  ANALYSIS_SNAPSHOT_V1,
  validateRecordSnapshotV1,
  validateReviewSnapshotV1,
} from "../analysis-snapshot-v1.js";
import type { RecordReview } from "../../../domain/types.js";
import type { Migration } from "./types.js";

type Row = Record<string, unknown>;

function json(value: unknown): Row {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("invalid JSON");
  return parsed as Row;
}

function eventFromRow(row: Row): RecordReview {
  return {
    id: String(row.id),
    record_id: String(row.record_id),
    reviewer_user_id: row.reviewer_user_id ? String(row.reviewer_user_id) : undefined,
    status: String(row.decision) as RecordReview["status"],
    note: String(row.reason),
    reviewed_by: String(row.reviewer_label),
    reviewed_at: row.decided_at ? String(row.decided_at) : "",
    created_at: String(row.created_at),
    provenance_kind: String(row.provenance_kind) as RecordReview["provenance_kind"],
    event_sequence: Number(row.event_sequence),
  };
}

function sameReview(left: RecordReview, right: RecordReview): boolean {
  return (
    left.id === right.id &&
    left.record_id === right.record_id &&
    left.reviewer_user_id === right.reviewer_user_id &&
    left.status === right.status &&
    left.note === right.note &&
    left.reviewed_by === right.reviewed_by &&
    left.reviewed_at === right.reviewed_at &&
    left.created_at === right.created_at &&
    left.provenance_kind === right.provenance_kind &&
    left.event_sequence === right.event_sequence
  );
}

function latestEvent(database: DatabaseSync, recordId: string): RecordReview | null {
  const row = database
    .prepare(
      `SELECT rr.*,reo.event_sequence FROM record_reviews rr
     JOIN review_event_order reo ON reo.review_id=rr.id
     WHERE rr.record_id=? ORDER BY reo.event_sequence DESC LIMIT 1`,
    )
    .get(recordId) as Row | undefined;
  return row ? eventFromRow(row) : null;
}

function repairReviewProjections(database: DatabaseSync): void {
  const records = database
    .prepare(
      `SELECT id,effective_review_id,review_status,review_note,reviewed_by,reviewed_at,metadata_json
     FROM experiment_records ORDER BY id`,
    )
    .all() as Row[];
  const mark = database.prepare("UPDATE experiment_records SET metadata_json=? WHERE id=?");
  for (const record of records) {
    const event = latestEvent(database, String(record.id));
    const consistent = event
      ? record.effective_review_id === event.id &&
        record.review_status === event.status &&
        record.review_note === event.note &&
        record.reviewed_by === event.reviewed_by &&
        (record.reviewed_at ?? "") === event.reviewed_at
      : !record.effective_review_id &&
        ["normal", "review"].includes(String(record.review_status)) &&
        record.review_note === "" &&
        record.reviewed_by === "" &&
        record.reviewed_at === null;
    if (!consistent) {
      const metadata = json(record.metadata_json);
      metadata.migration_005_review_projection_repaired = true;
      metadata.migration_005_review_projection_source = "latest_immutable_review_event";
      mark.run(JSON.stringify(metadata), String(record.id));
    }
  }
  database.exec(`
    UPDATE experiment_records SET
      effective_review_id=(SELECT rr.id FROM record_reviews rr JOIN review_event_order reo
        ON reo.review_id=rr.id WHERE rr.record_id=experiment_records.id
        ORDER BY reo.event_sequence DESC LIMIT 1),
      review_status=COALESCE((SELECT rr.decision FROM record_reviews rr JOIN review_event_order reo
        ON reo.review_id=rr.id WHERE rr.record_id=experiment_records.id
        ORDER BY reo.event_sequence DESC LIMIT 1),
        CASE WHEN review_status IN ('normal','review') THEN review_status ELSE 'review' END),
      review_note=COALESCE((SELECT rr.reason FROM record_reviews rr JOIN review_event_order reo
        ON reo.review_id=rr.id WHERE rr.record_id=experiment_records.id
        ORDER BY reo.event_sequence DESC LIMIT 1),''),
      reviewed_by=COALESCE((SELECT rr.reviewer_label FROM record_reviews rr JOIN review_event_order reo
        ON reo.review_id=rr.id WHERE rr.record_id=experiment_records.id
        ORDER BY reo.event_sequence DESC LIMIT 1),''),
      reviewed_at=(SELECT rr.decided_at FROM record_reviews rr JOIN review_event_order reo
        ON reo.review_id=rr.id WHERE rr.record_id=experiment_records.id
        ORDER BY reo.event_sequence DESC LIMIT 1)
  `);
}

function classify(
  database: DatabaseSync,
  row: Row,
): { schema: string; mode: string; reason: string | null } {
  if (String(row.snapshot_schema) !== ANALYSIS_SNAPSHOT_V1)
    return { schema: ANALYSIS_SNAPSHOT_LEGACY, mode: "legacy_unspecified", reason: null };
  try {
    const record = validateRecordSnapshotV1(row.record_snapshot_json, String(row.record_id));
    const durable = latestEvent(database, String(row.record_id));
    if (row.review_id) {
      const review = validateReviewSnapshotV1(
        row.review_snapshot_json,
        String(row.review_id),
        String(row.record_id),
      );
      if (
        !durable ||
        !sameReview(review, durable) ||
        record.effective_review_id !== review.id ||
        record.review_status !== review.status ||
        record.review_note !== review.note ||
        record.reviewed_by !== review.reviewed_by ||
        record.reviewed_at !== review.reviewed_at
      )
        throw new Error("snapshot/event mismatch");
      return { schema: ANALYSIS_SNAPSHOT_V1, mode: "effective", reason: null };
    }
    if (
      row.review_snapshot_json ||
      durable ||
      record.effective_review_id ||
      record.review_status === "included" ||
      record.review_status === "excluded"
    )
      throw new Error("omitted historical binding is ambiguous");
    return { schema: ANALYSIS_SNAPSHOT_V1, mode: "none", reason: null };
  } catch {
    return { schema: ANALYSIS_SNAPSHOT_LEGACY, mode: "legacy_unspecified", reason: null };
  }
}

function rebuildAnalysisInputs(database: DatabaseSync): void {
  const rows = database
    .prepare("SELECT * FROM analysis_inputs ORDER BY analysis_run_id,ordinal")
    .all() as Row[];
  database.exec(`
    DROP TRIGGER IF EXISTS analysis_inputs_insert_contract;
    DROP TRIGGER IF EXISTS analysis_inputs_duplicate_guard;
    DROP TRIGGER IF EXISTS analysis_inputs_review_record_guard;
    DROP TRIGGER IF EXISTS analysis_inputs_no_update;
    DROP TRIGGER IF EXISTS analysis_inputs_no_delete;
    ALTER TABLE analysis_inputs RENAME TO analysis_inputs_v4;
    CREATE TABLE analysis_inputs (
      analysis_run_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0),
      record_id TEXT NOT NULL,
      review_id TEXT,
      input_hash TEXT NOT NULL,
      record_snapshot_json TEXT NOT NULL CHECK(json_valid(record_snapshot_json)),
      review_snapshot_json TEXT CHECK(review_snapshot_json IS NULL OR json_valid(review_snapshot_json)),
      snapshot_schema TEXT NOT NULL CHECK(snapshot_schema IN (
        '${ANALYSIS_SNAPSHOT_V1}','${ANALYSIS_SNAPSHOT_LEGACY}'
      )),
      review_binding_mode TEXT NOT NULL CHECK(review_binding_mode IN (
        'effective','omit','none','legacy_unspecified'
      )),
      review_omission_reason TEXT,
      PRIMARY KEY(analysis_run_id,ordinal),
      UNIQUE(analysis_run_id,record_id),
      FOREIGN KEY(analysis_run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(record_id) REFERENCES experiment_records(id) ON DELETE RESTRICT,
      FOREIGN KEY(review_id) REFERENCES record_reviews(id) ON DELETE RESTRICT
    ) STRICT;
  `);
  const insert = database.prepare(`INSERT INTO analysis_inputs VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for (const row of rows) {
    const result = classify(database, row);
    insert.run(
      String(row.analysis_run_id),
      Number(row.ordinal),
      String(row.record_id),
      row.review_id ? String(row.review_id) : null,
      String(row.input_hash),
      String(row.record_snapshot_json),
      row.review_snapshot_json ? String(row.review_snapshot_json) : null,
      result.schema,
      result.mode,
      result.reason,
    );
  }
  database.exec(
    "DROP TABLE analysis_inputs_v4; CREATE INDEX idx_analysis_inputs_record ON analysis_inputs(record_id)",
  );
}

function repairIdempotencyScopes(database: DatabaseSync): void {
  const unresolved = database
    .prepare(
      `SELECT id FROM experiment_records WHERE client_submission_id IS NOT NULL
      AND (created_by_user_id IS NULL OR class_id IS NULL) ORDER BY id`,
    )
    .all() as Row[];
  if (unresolved.length)
    throw new Error(
      `Migration 005 cannot establish durable idempotency scope: ${unresolved.map((r) => r.id).join(", ")}`,
    );
  database.exec(`UPDATE experiment_records SET idempotency_scope_class_id=class_id
    WHERE client_submission_id IS NOT NULL AND idempotency_scope_class_id IS NULL`);
}

function installTriggers(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER IF EXISTS experiment_original_provenance_guard;
    CREATE TRIGGER experiment_original_provenance_guard
    BEFORE UPDATE OF id,submitted_json,submission_kind,created_by_user_id,created_by_label,
      client_submission_id,created_at,idempotency_scope_class_id
    ON experiment_records
    WHEN NEW.id IS NOT OLD.id OR NEW.submitted_json IS NOT OLD.submitted_json
      OR NEW.submission_kind IS NOT OLD.submission_kind
      OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
      OR NEW.created_by_label IS NOT OLD.created_by_label
      OR NEW.client_submission_id IS NOT OLD.client_submission_id
      OR NEW.created_at IS NOT OLD.created_at
      OR NEW.idempotency_scope_class_id IS NOT OLD.idempotency_scope_class_id
    BEGIN SELECT RAISE(ABORT,'original submission provenance is immutable'); END;

    CREATE TRIGGER experiment_idempotency_insert_guard BEFORE INSERT ON experiment_records
    WHEN NEW.client_submission_id IS NOT NULL AND (
      NEW.created_by_user_id IS NULL OR NEW.idempotency_scope_class_id IS NULL
      OR NEW.idempotency_scope_class_id<>NEW.class_id
      OR NOT EXISTS(SELECT 1 FROM classes WHERE id=NEW.idempotency_scope_class_id)
    ) BEGIN SELECT RAISE(ABORT,'offline idempotency scope must be durable'); END;

    CREATE TRIGGER experiment_submission_agreement_guard BEFORE INSERT ON experiment_records
    WHEN NEW.submission_kind='canonical_submission' AND (
      json_valid(NEW.submitted_json)=0
      OR trim(NEW.created_by_label)=''
      OR json_extract(NEW.submitted_json,'$.student_name') IS NOT NEW.student_name
      OR json_extract(NEW.submitted_json,'$.class_name') IS NOT NEW.class_name_snapshot
      OR json_extract(NEW.submitted_json,'$.group_name') IS NOT NEW.group_name_snapshot
      OR json_extract(NEW.submitted_json,'$.nh4cl_concentration') IS NOT NEW.nh4cl_concentration
      OR json_extract(NEW.submitted_json,'$.peel_mass') IS NOT NEW.peel_mass
      OR json_extract(NEW.submitted_json,'$.oil_mass') IS NOT NEW.oil_mass
      OR json_extract(NEW.submitted_json,'$.distillation_time') IS NOT NEW.distillation_time
      OR json_extract(NEW.submitted_json,'$.phase_clarity_score') IS NOT NEW.phase_clarity_score
      OR json_extract(NEW.submitted_json,'$.emulsification_level') IS NOT NEW.emulsification_level
      OR json_extract(NEW.submitted_json,'$.emulsion_concentration') IS NOT NEW.emulsion_concentration
      OR json_extract(NEW.submitted_json,'$.ecoli_observation_group') IS NOT NEW.ecoli_observation_group
      OR json_extract(NEW.submitted_json,'$.inhibition_zone_diameter') IS NOT NEW.inhibition_zone_diameter
      OR json_extract(NEW.submitted_json,'$.colony_growth_score') IS NOT NEW.colony_growth_score
      OR json_extract(NEW.submitted_json,'$.异常标记') IS NOT NEW.anomaly_flag
      OR json_extract(NEW.submitted_json,'$.error_source') IS NOT NEW.error_source
      OR json_extract(NEW.submitted_json,'$.note') IS NOT NEW.note
      OR COALESCE(json_extract(NEW.submitted_json,'$.experiment_date'),'') IS NOT COALESCE(NEW.experiment_date,'')
      OR COALESCE(json_extract(NEW.submitted_json,'$.petri_diameter_mm'),-1) IS NOT COALESCE(NEW.petri_diameter_mm,-1)
      OR json_extract(NEW.submitted_json,'$.measurement_method') IS NOT NEW.measurement_method
    ) BEGIN SELECT RAISE(ABORT,'canonical submission snapshot mismatch'); END;

    CREATE TRIGGER analysis_inputs_insert_contract BEFORE INSERT ON analysis_inputs
    WHEN NEW.snapshot_schema<>'${ANALYSIS_SNAPSHOT_V1}'
      OR (NEW.review_binding_mode='effective' AND (
        NEW.review_id IS NULL OR NEW.review_snapshot_json IS NULL OR NEW.review_omission_reason IS NOT NULL))
      OR (NEW.review_binding_mode='omit' AND (
        NEW.review_id IS NOT NULL OR NEW.review_snapshot_json IS NOT NULL
        OR NEW.review_omission_reason IS NULL OR trim(NEW.review_omission_reason)=''))
      OR (NEW.review_binding_mode='none' AND (
        NEW.review_id IS NOT NULL OR NEW.review_snapshot_json IS NOT NULL OR NEW.review_omission_reason IS NOT NULL
        OR json_extract(NEW.record_snapshot_json,'$.effective_review_id') IS NOT NULL
        OR json_extract(NEW.record_snapshot_json,'$.review_status') IN ('included','excluded')))
      OR NEW.review_binding_mode='legacy_unspecified'
      OR json_extract(NEW.record_snapshot_json,'$.id') IS NOT NEW.record_id
      OR (NEW.review_binding_mode='effective' AND NOT EXISTS(
        SELECT 1 FROM record_reviews rr JOIN review_event_order reo ON reo.review_id=rr.id
        WHERE rr.id=NEW.review_id AND rr.record_id=NEW.record_id
          AND json_extract(NEW.review_snapshot_json,'$.id')=rr.id
          AND json_extract(NEW.review_snapshot_json,'$.record_id')=rr.record_id
          AND json_extract(NEW.review_snapshot_json,'$.status')=rr.decision
          AND json_extract(NEW.review_snapshot_json,'$.note')=rr.reason
          AND json_extract(NEW.review_snapshot_json,'$.reviewed_by')=rr.reviewer_label
          AND json_extract(NEW.review_snapshot_json,'$.reviewed_at')=COALESCE(rr.decided_at,'')
          AND json_extract(NEW.review_snapshot_json,'$.created_at')=rr.created_at
          AND json_extract(NEW.review_snapshot_json,'$.provenance_kind')=rr.provenance_kind
          AND COALESCE(json_extract(NEW.review_snapshot_json,'$.reviewer_user_id'),'')=COALESCE(rr.reviewer_user_id,'')
          AND json_extract(NEW.review_snapshot_json,'$.event_sequence')=reo.event_sequence
          AND json_extract(NEW.record_snapshot_json,'$.effective_review_id')=rr.id
          AND json_extract(NEW.record_snapshot_json,'$.review_status')=rr.decision
          AND json_extract(NEW.record_snapshot_json,'$.review_note')=rr.reason
          AND json_extract(NEW.record_snapshot_json,'$.reviewed_by')=rr.reviewer_label
          AND json_extract(NEW.record_snapshot_json,'$.reviewed_at')=COALESCE(rr.decided_at,'')
      ))
    BEGIN SELECT RAISE(ABORT,'analysis snapshot semantic contract violation'); END;
    CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
    CREATE TRIGGER analysis_inputs_no_delete BEFORE DELETE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
  `);
}

export const independentAuditProvenanceRepairMigration: Migration = {
  version: 5,
  name: "independent_audit_provenance_repair",
  up(database) {
    repairReviewProjections(database);
    repairIdempotencyScopes(database);
    rebuildAnalysisInputs(database);
    installTriggers(database);
  },
};
