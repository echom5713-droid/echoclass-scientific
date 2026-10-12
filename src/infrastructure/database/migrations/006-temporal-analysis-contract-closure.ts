import type { DatabaseSync } from "node:sqlite";
import type { RecordReview } from "../../../domain/types.js";
import {
  ANALYSIS_SNAPSHOT_LEGACY,
  ANALYSIS_SNAPSHOT_V1,
  validateAnalysisBindingV1,
  validateRecordSnapshotV1,
  validateReviewSnapshotV1,
} from "../analysis-snapshot-v1.js";
import type { Migration } from "./types.js";

type Row = Record<string, unknown>;

function object(value: unknown, label: string): Row {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Row;
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
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

function reviewEvent(
  database: DatabaseSync,
  reviewId: string,
  recordId: string,
): RecordReview | null {
  const row = database
    .prepare(
      `SELECT rr.*,reo.event_sequence FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       WHERE rr.id=? AND rr.record_id=?`,
    )
    .get(reviewId, recordId) as Row | undefined;
  return row ? eventFromRow(row) : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function wasEffectiveAt(
  database: DatabaseSync,
  event: RecordReview,
  runCreatedAt: string,
): boolean {
  if (!validTimestamp(event.created_at) || !validTimestamp(runCreatedAt)) return false;
  if (Date.parse(event.created_at) > Date.parse(runCreatedAt)) return false;
  const laterAtSelection = database
    .prepare(
      `SELECT 1 FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       WHERE rr.record_id=? AND reo.event_sequence>?
         AND julianday(rr.created_at)<=julianday(?) LIMIT 1`,
    )
    .get(event.record_id, event.event_sequence ?? 0, runCreatedAt);
  return !laterAtSelection;
}

function classifyHistoricalInput(
  database: DatabaseSync,
  row: Row,
): {
  schema: string;
  mode: string;
  reason: string | null;
} {
  try {
    const recordId = String(row.record_id);
    const runCreatedAt = String(row.run_created_at);
    const record = validateRecordSnapshotV1(row.record_snapshot_json, recordId);
    if (row.review_id) {
      const reviewId = String(row.review_id);
      const snapshot = validateReviewSnapshotV1(row.review_snapshot_json, reviewId, recordId);
      const event = reviewEvent(database, reviewId, recordId);
      if (!event || !wasEffectiveAt(database, event, runCreatedAt)) throw new Error();
      validateAnalysisBindingV1(record, snapshot, event);
      return { schema: ANALYSIS_SNAPSHOT_V1, mode: "effective", reason: null };
    }
    const priorMode = String(row.review_binding_mode || "legacy_unspecified");
    if (priorMode === "omit") {
      const reason =
        typeof row.review_omission_reason === "string" ? row.review_omission_reason.trim() : "";
      if (!reason || !record.effective_review_id) throw new Error();
      const event = reviewEvent(database, record.effective_review_id, recordId);
      if (!event || !wasEffectiveAt(database, event, runCreatedAt)) throw new Error();
      validateAnalysisBindingV1(record, event, event);
      return { schema: ANALYSIS_SNAPSHOT_V1, mode: "omit", reason };
    }
    if (priorMode === "none") {
      if (
        record.effective_review_id ||
        record.review_status === "included" ||
        record.review_status === "excluded"
      )
        throw new Error();
      const eventAtSelection = database
        .prepare(
          `SELECT 1 FROM record_reviews
           WHERE record_id=? AND julianday(created_at)<=julianday(?) LIMIT 1`,
        )
        .get(recordId, runCreatedAt);
      if (eventAtSelection) throw new Error();
      return { schema: ANALYSIS_SNAPSHOT_V1, mode: "none", reason: null };
    }
  } catch {
    // Any incomplete, forged, or temporally impossible historical row remains explicit legacy.
  }
  return { schema: ANALYSIS_SNAPSHOT_LEGACY, mode: "legacy_unspecified", reason: null };
}

function reclassifyHistoricalInputs(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT ai.*,ar.created_at AS run_created_at
       FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
       ORDER BY ai.analysis_run_id,ai.ordinal`,
    )
    .all() as Row[];
  database.exec(`
    DROP TRIGGER IF EXISTS analysis_inputs_insert_contract;
    DROP TRIGGER IF EXISTS analysis_inputs_no_update;
    DROP TRIGGER IF EXISTS analysis_inputs_no_delete;
  `);
  const update = database.prepare(
    `UPDATE analysis_inputs SET snapshot_schema=?,review_binding_mode=?,review_omission_reason=?
     WHERE analysis_run_id=? AND ordinal=?`,
  );
  for (const row of rows) {
    const classification = classifyHistoricalInput(database, row);
    update.run(
      classification.schema,
      classification.mode,
      classification.reason,
      String(row.analysis_run_id),
      Number(row.ordinal),
    );
  }
}

const SUBMISSION_FIELDS: ReadonlyArray<{
  json: string;
  column: string;
  optional?: boolean;
}> = [
  { json: "student_name", column: "student_name" },
  { json: "class_name", column: "class_name_snapshot" },
  { json: "group_name", column: "group_name_snapshot" },
  { json: "nh4cl_concentration", column: "nh4cl_concentration" },
  { json: "peel_mass", column: "peel_mass" },
  { json: "oil_mass", column: "oil_mass" },
  { json: "distillation_time", column: "distillation_time" },
  { json: "phase_clarity_score", column: "phase_clarity_score" },
  { json: "emulsification_level", column: "emulsification_level" },
  { json: "emulsion_concentration", column: "emulsion_concentration" },
  { json: "ecoli_observation_group", column: "ecoli_observation_group" },
  { json: "inhibition_zone_diameter", column: "inhibition_zone_diameter" },
  { json: "colony_growth_score", column: "colony_growth_score" },
  { json: "异常标记", column: "anomaly_flag" },
  { json: "error_source", column: "error_source" },
  { json: "note", column: "note" },
  { json: "experiment_date", column: "experiment_date", optional: true },
  { json: "petri_diameter_mm", column: "petri_diameter_mm", optional: true },
  { json: "measurement_method", column: "measurement_method", optional: true },
];

function valuesAgree(submitted: unknown, canonical: unknown, field: string): boolean {
  if (field === "异常标记") return submitted === Boolean(canonical);
  return submitted === canonical;
}

function preflightHistoricalSubmissions(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT * FROM experiment_records
       WHERE submission_kind='canonical_submission' ORDER BY id`,
    )
    .all() as Row[];
  const definite: string[] = [];
  const mark = database.prepare("UPDATE experiment_records SET metadata_json=? WHERE id=?");
  for (const row of rows) {
    const submitted = object(row.submitted_json, `Record ${String(row.id)} submitted_json`);
    const mismatches: string[] = [];
    for (const field of SUBMISSION_FIELDS) {
      if (!(field.json in submitted)) {
        if (!field.optional) mismatches.push(field.json);
        continue;
      }
      const canonical = row[field.column] ?? null;
      const supplied = submitted[field.json] ?? null;
      if (!valuesAgree(supplied, canonical, field.json)) mismatches.push(field.json);
    }
    if (!mismatches.length) continue;
    if (String(row.updated_at) === String(row.created_at)) {
      for (const field of mismatches) definite.push(`${String(row.id)}:${field}`);
      continue;
    }
    const metadata = object(row.metadata_json, `Record ${String(row.id)} metadata_json`);
    metadata.submission_agreement_unverifiable = true;
    metadata.submission_agreement_unverifiable_fields = mismatches;
    metadata.submission_agreement_assessed_by = "migration_006";
    mark.run(JSON.stringify(metadata), String(row.id));
  }
  if (definite.length)
    throw new Error(`Migration 006 canonical submission contradictions: ${definite.join(", ")}`);
}

function installCompleteContract(database: DatabaseSync): void {
  database.exec(`
    CREATE TRIGGER analysis_inputs_insert_contract
    BEFORE INSERT ON analysis_inputs
    WHEN NEW.snapshot_schema<>'${ANALYSIS_SNAPSHOT_V1}'
      OR json_type(NEW.record_snapshot_json,'$.id') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.id'))=''
      OR json_extract(NEW.record_snapshot_json,'$.id')<>NEW.record_id
      OR json_type(NEW.record_snapshot_json,'$.student_name') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.student_name'))=''
      OR json_type(NEW.record_snapshot_json,'$.class_name') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.class_name'))=''
      OR json_type(NEW.record_snapshot_json,'$.group_name') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.emulsification_level') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.emulsification_level'))=''
      OR json_type(NEW.record_snapshot_json,'$.ecoli_observation_group') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.ecoli_observation_group'))=''
      OR json_type(NEW.record_snapshot_json,'$.error_source') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.note') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.异常标记') NOT IN ('true','false')
      OR json_type(NEW.record_snapshot_json,'$.nh4cl_concentration') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.nh4cl_concentration') NOT IN (0,1,3,4)
      OR json_type(NEW.record_snapshot_json,'$.peel_mass') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.peel_mass')<=0
      OR json_extract(NEW.record_snapshot_json,'$.peel_mass')>1000
      OR json_type(NEW.record_snapshot_json,'$.oil_mass') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.oil_mass')<0
      OR json_extract(NEW.record_snapshot_json,'$.oil_mass')>20
      OR json_type(NEW.record_snapshot_json,'$.distillation_time') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.distillation_time')<=0
      OR json_extract(NEW.record_snapshot_json,'$.distillation_time')>1440
      OR json_type(NEW.record_snapshot_json,'$.phase_clarity_score') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.phase_clarity_score')<1
      OR json_extract(NEW.record_snapshot_json,'$.phase_clarity_score')>5
      OR json_type(NEW.record_snapshot_json,'$.emulsion_concentration') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.emulsion_concentration')<0
      OR json_extract(NEW.record_snapshot_json,'$.emulsion_concentration')>100
      OR json_type(NEW.record_snapshot_json,'$.inhibition_zone_diameter') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.inhibition_zone_diameter')<0
      OR json_extract(NEW.record_snapshot_json,'$.inhibition_zone_diameter')>60
      OR json_type(NEW.record_snapshot_json,'$.colony_growth_score') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.colony_growth_score')<1
      OR json_extract(NEW.record_snapshot_json,'$.colony_growth_score')>5
      OR json_type(NEW.record_snapshot_json,'$.yield_percent') NOT IN ('integer','real')
      OR abs(json_extract(NEW.record_snapshot_json,'$.yield_percent')-
        round((json_extract(NEW.record_snapshot_json,'$.oil_mass')*100.0)/
          json_extract(NEW.record_snapshot_json,'$.peel_mass'),2))>0.000001
      OR json_type(NEW.record_snapshot_json,'$.measurement_method') IS NOT 'text'
      OR json_extract(NEW.record_snapshot_json,'$.measurement_method') NOT IN (
        'not_recorded','not_recorded_legacy','manual_direct','manual_local_image_calibrated'
      )
      OR (json_type(NEW.record_snapshot_json,'$.petri_diameter_mm') IS NOT NULL AND (
        json_type(NEW.record_snapshot_json,'$.petri_diameter_mm') NOT IN ('integer','real')
        OR json_extract(NEW.record_snapshot_json,'$.petri_diameter_mm')<=0
        OR json_extract(NEW.record_snapshot_json,'$.petri_diameter_mm')>500
      ))
      OR (json_extract(NEW.record_snapshot_json,'$.measurement_method')=
          'manual_local_image_calibrated' AND
          json_type(NEW.record_snapshot_json,'$.petri_diameter_mm') NOT IN ('integer','real'))
      OR (json_type(NEW.record_snapshot_json,'$.experiment_date') IS NOT NULL AND (
        json_type(NEW.record_snapshot_json,'$.experiment_date') IS NOT 'text'
        OR date(json_extract(NEW.record_snapshot_json,'$.experiment_date'))<>
          json_extract(NEW.record_snapshot_json,'$.experiment_date')
      ))
      OR json_type(NEW.record_snapshot_json,'$.status') IS NOT 'text'
      OR json_extract(NEW.record_snapshot_json,'$.status') NOT IN ('active','deleted')
      OR json_type(NEW.record_snapshot_json,'$.created_at') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.created_at'))=''
      OR json_type(NEW.record_snapshot_json,'$.updated_at') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.updated_at'))=''
      OR json_type(NEW.record_snapshot_json,'$.created_by') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.created_by'))=''
      OR (json_type(NEW.record_snapshot_json,'$.created_by_user_id') IS NOT NULL AND
          json_type(NEW.record_snapshot_json,'$.created_by_user_id') IS NOT 'text')
      OR json_type(NEW.record_snapshot_json,'$.review_status') IS NOT 'text'
      OR json_extract(NEW.record_snapshot_json,'$.review_status') NOT IN (
        'normal','review','included','excluded'
      )
      OR json_type(NEW.record_snapshot_json,'$.review_note') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.reviewed_by') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.reviewed_at') IS NOT 'text'
      OR (json_type(NEW.record_snapshot_json,'$.effective_review_id') IS NOT NULL AND
          json_type(NEW.record_snapshot_json,'$.effective_review_id') IS NOT 'text')
      OR json_type(NEW.record_snapshot_json,'$.metadata') IS NOT 'object'
      OR (NEW.review_binding_mode='effective' AND (
        NEW.review_id IS NULL OR NEW.review_snapshot_json IS NULL
        OR NEW.review_omission_reason IS NOT NULL
        OR NEW.review_id<>(SELECT effective_review_id FROM experiment_records WHERE id=NEW.record_id)
        OR NOT EXISTS(
          SELECT 1 FROM record_reviews rr JOIN review_event_order reo ON reo.review_id=rr.id
          WHERE rr.id=NEW.review_id AND rr.record_id=NEW.record_id
            AND reo.event_sequence=(SELECT MAX(reo2.event_sequence)
              FROM record_reviews rr2 JOIN review_event_order reo2 ON reo2.review_id=rr2.id
              WHERE rr2.record_id=NEW.record_id)
            AND json_type(NEW.review_snapshot_json,'$.id')='text'
            AND json_extract(NEW.review_snapshot_json,'$.id')=rr.id
            AND json_extract(NEW.review_snapshot_json,'$.record_id')=rr.record_id
            AND json_extract(NEW.review_snapshot_json,'$.status')=rr.decision
            AND json_type(NEW.review_snapshot_json,'$.note')='text'
            AND json_extract(NEW.review_snapshot_json,'$.note')=rr.reason
            AND json_type(NEW.review_snapshot_json,'$.reviewed_by')='text'
            AND json_extract(NEW.review_snapshot_json,'$.reviewed_by')=rr.reviewer_label
            AND json_type(NEW.review_snapshot_json,'$.reviewed_at')='text'
            AND json_extract(NEW.review_snapshot_json,'$.reviewed_at')=COALESCE(rr.decided_at,'')
            AND json_type(NEW.review_snapshot_json,'$.created_at')='text'
            AND json_extract(NEW.review_snapshot_json,'$.created_at')=rr.created_at
            AND json_extract(NEW.review_snapshot_json,'$.provenance_kind')=rr.provenance_kind
            AND COALESCE(json_extract(NEW.review_snapshot_json,'$.reviewer_user_id'),'')=
              COALESCE(rr.reviewer_user_id,'')
            AND json_type(NEW.review_snapshot_json,'$.event_sequence')='integer'
            AND json_extract(NEW.review_snapshot_json,'$.event_sequence')=reo.event_sequence
            AND json_extract(NEW.record_snapshot_json,'$.effective_review_id')=rr.id
            AND json_extract(NEW.record_snapshot_json,'$.review_status')=rr.decision
            AND json_extract(NEW.record_snapshot_json,'$.review_note')=rr.reason
            AND json_extract(NEW.record_snapshot_json,'$.reviewed_by')=rr.reviewer_label
            AND json_extract(NEW.record_snapshot_json,'$.reviewed_at')=COALESCE(rr.decided_at,'')
        )
      ))
      OR (NEW.review_binding_mode='omit' AND (
        NEW.review_id IS NOT NULL OR NEW.review_snapshot_json IS NOT NULL
        OR NEW.review_omission_reason IS NULL OR trim(NEW.review_omission_reason)=''
        OR (SELECT effective_review_id FROM experiment_records WHERE id=NEW.record_id) IS NULL
        OR NOT EXISTS(
          SELECT 1 FROM record_reviews rr
          WHERE rr.id=(SELECT effective_review_id FROM experiment_records WHERE id=NEW.record_id)
            AND rr.record_id=NEW.record_id
            AND json_extract(NEW.record_snapshot_json,'$.effective_review_id')=rr.id
            AND json_extract(NEW.record_snapshot_json,'$.review_status')=rr.decision
            AND json_extract(NEW.record_snapshot_json,'$.review_note')=rr.reason
            AND json_extract(NEW.record_snapshot_json,'$.reviewed_by')=rr.reviewer_label
            AND json_extract(NEW.record_snapshot_json,'$.reviewed_at')=COALESCE(rr.decided_at,'')
        )
      ))
      OR (NEW.review_binding_mode='none' AND (
        NEW.review_id IS NOT NULL OR NEW.review_snapshot_json IS NOT NULL
        OR NEW.review_omission_reason IS NOT NULL
        OR (SELECT effective_review_id FROM experiment_records WHERE id=NEW.record_id) IS NOT NULL
        OR json_extract(NEW.record_snapshot_json,'$.effective_review_id') IS NOT NULL
        OR json_extract(NEW.record_snapshot_json,'$.review_status') IN ('included','excluded')
      ))
      OR NEW.review_binding_mode='legacy_unspecified'
    BEGIN SELECT RAISE(ABORT,'analysis snapshot v1 temporal contract violation'); END;

    CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
    CREATE TRIGGER analysis_inputs_no_delete BEFORE DELETE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
  `);
}

export const temporalAnalysisContractClosureMigration: Migration = {
  version: 6,
  name: "temporal_analysis_contract_closure",
  up(database) {
    preflightHistoricalSubmissions(database);
    reclassifyHistoricalInputs(database);
    installCompleteContract(database);
  },
};
