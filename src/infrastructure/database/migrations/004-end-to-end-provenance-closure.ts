import type { DatabaseSync } from "node:sqlite";
import {
  ANALYSIS_SNAPSHOT_LEGACY,
  ANALYSIS_SNAPSHOT_V1,
  isRecordSnapshotV1,
  isReviewSnapshotV1,
} from "../analysis-snapshot-v1.js";
import type { Migration } from "./types.js";

const MEASUREMENT_METHODS = new Set([
  "not_recorded",
  "not_recorded_legacy",
  "manual_direct",
  "manual_local_image_calibrated",
]);

function object(value: unknown, context: string): Record<string, unknown> {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${context} contains invalid JSON`);
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function has(source: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, field) && source[field] !== "";
}

function recoverMeasurementsAndYield(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT id, submission_kind, submitted_json, metadata_json,
        experiment_date, petri_diameter_mm, measurement_method,
        peel_mass, oil_mass, yield_percent
       FROM experiment_records ORDER BY id`,
    )
    .all() as unknown as Array<Record<string, unknown> & { id: string }>;
  const invalid: string[] = [];
  const update = database.prepare(
    `UPDATE experiment_records SET
      experiment_date=?, petri_diameter_mm=?, measurement_method=?,
      yield_percent=?, metadata_json=? WHERE id=?`,
  );
  for (const row of rows) {
    const submitted = object(row.submitted_json, `Record ${row.id} submitted_json`);
    const metadata = object(row.metadata_json, `Record ${row.id} metadata_json`);
    let experimentDate = row.experiment_date as string | null;
    let petriDiameter = row.petri_diameter_mm as number | null;
    let measurementMethod = String(row.measurement_method || "not_recorded_legacy");
    let recoveredFromLegacyMetadata = false;
    const dateSource = has(submitted, "experiment_date")
      ? { value: submitted.experiment_date, label: "submitted_json" }
      : has(metadata, "experiment_date")
        ? { value: metadata.experiment_date, label: "legacy_metadata" }
        : null;
    if (dateSource) {
      if (!validDate(dateSource.value))
        invalid.push(`${row.id}:experiment_date(${dateSource.label})`);
      else {
        experimentDate = dateSource.value;
        recoveredFromLegacyMetadata ||= dateSource.label === "legacy_metadata";
      }
    }
    const diameterSource = has(submitted, "petri_diameter_mm")
      ? { value: submitted.petri_diameter_mm, label: "submitted_json" }
      : has(metadata, "petri_diameter_mm")
        ? { value: metadata.petri_diameter_mm, label: "legacy_metadata" }
        : null;
    if (diameterSource) {
      const value = diameterSource.value;
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 500)
        invalid.push(`${row.id}:petri_diameter_mm(${diameterSource.label})`);
      else {
        petriDiameter = value;
        recoveredFromLegacyMetadata ||= diameterSource.label === "legacy_metadata";
      }
    }
    const methodSource = has(submitted, "measurement_method")
      ? { value: submitted.measurement_method, label: "submitted_json" }
      : has(metadata, "measurement_method")
        ? { value: metadata.measurement_method, label: "legacy_metadata" }
        : null;
    if (methodSource) {
      const value = methodSource.value;
      if (typeof value !== "string" || !MEASUREMENT_METHODS.has(value))
        invalid.push(`${row.id}:measurement_method(${methodSource.label})`);
      else {
        measurementMethod = value;
        recoveredFromLegacyMetadata ||= methodSource.label === "legacy_metadata";
      }
    }
    if (measurementMethod === "manual_local_image_calibrated" && petriDiameter === null)
      invalid.push(`${row.id}:petri_diameter_mm(calibration_required)`);
    if (recoveredFromLegacyMetadata) metadata.measurement_provenance_source = "legacy_metadata";
    const canonicalYield = Number(
      ((Number(row.oil_mass) / Number(row.peel_mass)) * 100).toFixed(2),
    );
    if (!Number.isFinite(canonicalYield)) invalid.push(`${row.id}:yield_percent(non_finite)`);
    if (Math.abs(Number(row.yield_percent) - canonicalYield) > 0.000001) {
      metadata.legacy_reported_yield_percent = Number(row.yield_percent);
      metadata.legacy_yield_recomputed_by = "migration_004";
    }
    update.run(
      experimentDate,
      petriDiameter,
      measurementMethod,
      canonicalYield,
      JSON.stringify(metadata),
      row.id,
    );
  }
  if (invalid.length)
    throw new Error(`Migration 004 requires measurement repair: ${invalid.join(", ")}`);
}

function classifySnapshot(row: Record<string, unknown>): string {
  if (!isRecordSnapshotV1(row.record_snapshot_json, String(row.record_id)))
    return ANALYSIS_SNAPSHOT_LEGACY;
  if (row.review_id) {
    if (
      !row.review_snapshot_json ||
      !isReviewSnapshotV1(row.review_snapshot_json, String(row.review_id), String(row.record_id))
    )
      return ANALYSIS_SNAPSHOT_LEGACY;
  } else if (row.review_snapshot_json) {
    return ANALYSIS_SNAPSHOT_LEGACY;
  }
  return ANALYSIS_SNAPSHOT_V1;
}

function rebuildAnalysisInputs(database: DatabaseSync): void {
  const rows = database
    .prepare("SELECT * FROM analysis_inputs ORDER BY analysis_run_id, ordinal")
    .all() as unknown as Array<Record<string, unknown>>;
  database.exec(`
    DROP TRIGGER IF EXISTS analysis_inputs_duplicate_guard;
    DROP TRIGGER IF EXISTS analysis_inputs_review_record_guard;
    DROP TRIGGER IF EXISTS analysis_inputs_snapshot_guard;
    DROP TRIGGER IF EXISTS analysis_inputs_no_update;
    DROP TRIGGER IF EXISTS analysis_inputs_no_delete;
    ALTER TABLE analysis_inputs RENAME TO analysis_inputs_v3;
    CREATE TABLE analysis_inputs (
      analysis_run_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
      record_id TEXT NOT NULL,
      review_id TEXT,
      input_hash TEXT NOT NULL,
      record_snapshot_json TEXT NOT NULL CHECK(json_valid(record_snapshot_json)),
      review_snapshot_json TEXT CHECK(review_snapshot_json IS NULL OR json_valid(review_snapshot_json)),
      snapshot_schema TEXT NOT NULL CHECK(snapshot_schema IN (
        '${ANALYSIS_SNAPSHOT_V1}', '${ANALYSIS_SNAPSHOT_LEGACY}'
      )),
      PRIMARY KEY(analysis_run_id, ordinal),
      UNIQUE(analysis_run_id, record_id),
      FOREIGN KEY(analysis_run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(record_id) REFERENCES experiment_records(id) ON DELETE RESTRICT,
      FOREIGN KEY(review_id) REFERENCES record_reviews(id) ON DELETE RESTRICT
    ) STRICT;
  `);
  const insert = database.prepare(
    `INSERT INTO analysis_inputs(
      analysis_run_id, ordinal, record_id, review_id, input_hash,
      record_snapshot_json, review_snapshot_json, snapshot_schema
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows)
    insert.run(
      String(row.analysis_run_id),
      Number(row.ordinal),
      String(row.record_id),
      row.review_id ? String(row.review_id) : null,
      String(row.input_hash),
      String(row.record_snapshot_json),
      row.review_snapshot_json ? String(row.review_snapshot_json) : null,
      classifySnapshot(row),
    );
  database.exec(`
    DROP TABLE analysis_inputs_v3;
    CREATE INDEX idx_analysis_inputs_record ON analysis_inputs(record_id);
  `);
}

function installIntegrityTriggers(database: DatabaseSync): void {
  database.exec(`
    CREATE TRIGGER experiment_science_insert_guard
    BEFORE INSERT ON experiment_records
    WHEN NEW.peel_mass<=0 OR NEW.peel_mass>1000
      OR NEW.oil_mass<0 OR NEW.oil_mass>20
      OR NEW.distillation_time<=0 OR NEW.distillation_time>1440
      OR NEW.phase_clarity_score<1 OR NEW.phase_clarity_score>5
      OR NEW.emulsion_concentration<0 OR NEW.emulsion_concentration>100
      OR NEW.inhibition_zone_diameter<0 OR NEW.inhibition_zone_diameter>60
      OR NEW.colony_growth_score<1 OR NEW.colony_growth_score>5
      OR NEW.nh4cl_concentration NOT IN (0,1,3,4)
      OR abs(NEW.yield_percent-round((NEW.oil_mass/NEW.peel_mass)*100,2))>0.000001
      OR json_valid(NEW.submitted_json)=0
      OR (NEW.measurement_method='manual_local_image_calibrated'
          AND NEW.petri_diameter_mm IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid canonical scientific record');
    END;
    CREATE TRIGGER experiment_science_update_guard
    BEFORE UPDATE OF nh4cl_concentration,peel_mass,oil_mass,distillation_time,
      phase_clarity_score,emulsion_concentration,inhibition_zone_diameter,
      colony_growth_score,yield_percent,petri_diameter_mm,measurement_method
    ON experiment_records
    WHEN NEW.peel_mass<=0 OR NEW.peel_mass>1000
      OR NEW.oil_mass<0 OR NEW.oil_mass>20
      OR NEW.distillation_time<=0 OR NEW.distillation_time>1440
      OR NEW.phase_clarity_score<1 OR NEW.phase_clarity_score>5
      OR NEW.emulsion_concentration<0 OR NEW.emulsion_concentration>100
      OR NEW.inhibition_zone_diameter<0 OR NEW.inhibition_zone_diameter>60
      OR NEW.colony_growth_score<1 OR NEW.colony_growth_score>5
      OR NEW.nh4cl_concentration NOT IN (0,1,3,4)
      OR abs(NEW.yield_percent-round((NEW.oil_mass/NEW.peel_mass)*100,2))>0.000001
      OR (NEW.measurement_method='manual_local_image_calibrated'
          AND NEW.petri_diameter_mm IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid canonical scientific record');
    END;

    CREATE TRIGGER experiment_original_provenance_guard
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
    BEGIN
      SELECT RAISE(ABORT, 'original submission provenance is immutable');
    END;

    CREATE TRIGGER experiment_review_insert_guard
    BEFORE INSERT ON experiment_records
    WHEN NEW.effective_review_id IS NOT NULL
      OR NEW.review_status NOT IN ('normal','review')
      OR NEW.review_note<>'' OR NEW.reviewed_by<>'' OR NEW.reviewed_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'human review projection requires an event');
    END;
    CREATE TRIGGER experiment_review_projection_guard
    BEFORE UPDATE OF effective_review_id,review_status,review_note,reviewed_by,reviewed_at
    ON experiment_records
    WHEN (
      NEW.effective_review_id IS NULL AND (
        NEW.review_status NOT IN ('normal','review')
        OR NEW.review_status IS NOT OLD.review_status
        OR NEW.review_note<>'' OR NEW.reviewed_by<>'' OR NEW.reviewed_at IS NOT NULL
      )
    ) OR (
      NEW.effective_review_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM record_reviews rr
        JOIN review_event_order reo ON reo.review_id=rr.id
        WHERE rr.id=NEW.effective_review_id AND rr.record_id=NEW.id
          AND reo.event_sequence=(
            SELECT MAX(reo2.event_sequence)
            FROM record_reviews rr2 JOIN review_event_order reo2 ON reo2.review_id=rr2.id
            WHERE rr2.record_id=NEW.id
          )
          AND NEW.review_status=rr.decision
          AND NEW.review_note=rr.reason
          AND NEW.reviewed_by=rr.reviewer_label
          AND NEW.reviewed_at IS rr.decided_at
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'review projection must equal latest effective event');
    END;

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
      OR json_type(NEW.record_snapshot_json,'$.peel_mass') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.peel_mass') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.peel_mass')<=0
      OR json_extract(NEW.record_snapshot_json,'$.peel_mass')>1000
      OR json_type(NEW.record_snapshot_json,'$.oil_mass') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.oil_mass') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.oil_mass')<0
      OR json_extract(NEW.record_snapshot_json,'$.oil_mass')>20
      OR json_type(NEW.record_snapshot_json,'$.nh4cl_concentration') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.nh4cl_concentration') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.nh4cl_concentration') NOT IN (0,1,3,4)
      OR json_type(NEW.record_snapshot_json,'$.distillation_time') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.distillation_time') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.distillation_time')<=0
      OR json_extract(NEW.record_snapshot_json,'$.distillation_time')>1440
      OR json_type(NEW.record_snapshot_json,'$.phase_clarity_score') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.phase_clarity_score') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.phase_clarity_score')<1
      OR json_extract(NEW.record_snapshot_json,'$.phase_clarity_score')>5
      OR json_type(NEW.record_snapshot_json,'$.emulsion_concentration') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.emulsion_concentration') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.emulsion_concentration')<0
      OR json_extract(NEW.record_snapshot_json,'$.emulsion_concentration')>100
      OR json_type(NEW.record_snapshot_json,'$.inhibition_zone_diameter') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.inhibition_zone_diameter') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.inhibition_zone_diameter')<0
      OR json_extract(NEW.record_snapshot_json,'$.inhibition_zone_diameter')>60
      OR json_type(NEW.record_snapshot_json,'$.colony_growth_score') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.colony_growth_score') NOT IN ('integer','real')
      OR json_extract(NEW.record_snapshot_json,'$.colony_growth_score')<1
      OR json_extract(NEW.record_snapshot_json,'$.colony_growth_score')>5
      OR json_type(NEW.record_snapshot_json,'$.yield_percent') IS NULL
      OR json_type(NEW.record_snapshot_json,'$.yield_percent') NOT IN ('integer','real')
      OR abs(json_extract(NEW.record_snapshot_json,'$.yield_percent')-
        round((json_extract(NEW.record_snapshot_json,'$.oil_mass')*100.0)/
          json_extract(NEW.record_snapshot_json,'$.peel_mass'),2))>0.000001
      OR json_type(NEW.record_snapshot_json,'$.measurement_method') IS NOT 'text'
      OR json_extract(NEW.record_snapshot_json,'$.measurement_method') NOT IN (
        'not_recorded','not_recorded_legacy','manual_direct','manual_local_image_calibrated'
      )
      OR (json_extract(NEW.record_snapshot_json,'$.measurement_method')=
          'manual_local_image_calibrated' AND (
        json_type(NEW.record_snapshot_json,'$.petri_diameter_mm') NOT IN ('integer','real')
        OR json_extract(NEW.record_snapshot_json,'$.petri_diameter_mm')<=0
        OR json_extract(NEW.record_snapshot_json,'$.petri_diameter_mm')>500
      ))
      OR (json_type(NEW.record_snapshot_json,'$.experiment_date') NOT IN ('text','null')
          AND json_type(NEW.record_snapshot_json,'$.experiment_date') IS NOT NULL)
      OR json_type(NEW.record_snapshot_json,'$.status') IS NOT 'text'
      OR json_extract(NEW.record_snapshot_json,'$.status') NOT IN ('active','deleted')
      OR json_type(NEW.record_snapshot_json,'$.created_at') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.created_at'))=''
      OR json_type(NEW.record_snapshot_json,'$.updated_at') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.updated_at'))=''
      OR json_type(NEW.record_snapshot_json,'$.created_by') IS NOT 'text'
      OR trim(json_extract(NEW.record_snapshot_json,'$.created_by'))=''
      OR json_type(NEW.record_snapshot_json,'$.review_status') IS NOT 'text'
      OR json_extract(NEW.record_snapshot_json,'$.review_status') NOT IN (
        'normal','review','included','excluded'
      )
      OR json_type(NEW.record_snapshot_json,'$.review_note') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.reviewed_by') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.reviewed_at') IS NOT 'text'
      OR json_type(NEW.record_snapshot_json,'$.metadata') IS NOT 'object'
      OR (NEW.review_id IS NULL AND NEW.review_snapshot_json IS NOT NULL)
      OR (NEW.review_id IS NOT NULL AND (
        NEW.review_snapshot_json IS NULL
        OR json_type(NEW.review_snapshot_json,'$.id') IS NOT 'text'
        OR json_extract(NEW.review_snapshot_json,'$.id')<>NEW.review_id
        OR json_type(NEW.review_snapshot_json,'$.record_id') IS NOT 'text'
        OR json_extract(NEW.review_snapshot_json,'$.record_id')<>NEW.record_id
        OR json_type(NEW.review_snapshot_json,'$.status') IS NOT 'text'
        OR json_extract(NEW.review_snapshot_json,'$.status') NOT IN (
          'review','included','excluded'
        )
        OR json_type(NEW.review_snapshot_json,'$.note') IS NOT 'text'
        OR json_type(NEW.review_snapshot_json,'$.reviewed_by') IS NOT 'text'
        OR json_type(NEW.review_snapshot_json,'$.reviewed_at') IS NOT 'text'
        OR json_type(NEW.review_snapshot_json,'$.created_at') IS NOT 'text'
        OR json_type(NEW.review_snapshot_json,'$.provenance_kind') IS NOT 'text'
        OR json_extract(NEW.review_snapshot_json,'$.provenance_kind') NOT IN (
          'human','legacy_projection'
        )
      ))
    BEGIN
      SELECT RAISE(ABORT, 'analysis snapshot v1 contract violation');
    END;
    CREATE TRIGGER analysis_inputs_duplicate_guard
    BEFORE INSERT ON analysis_inputs
    WHEN EXISTS(
      SELECT 1 FROM analysis_inputs
      WHERE analysis_run_id=NEW.analysis_run_id
        AND (ordinal=NEW.ordinal OR record_id=NEW.record_id)
    ) BEGIN
      SELECT RAISE(ABORT, 'duplicate analysis input');
    END;
    CREATE TRIGGER analysis_inputs_review_record_guard
    BEFORE INSERT ON analysis_inputs
    WHEN NEW.review_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM record_reviews WHERE id=NEW.review_id AND record_id=NEW.record_id
    ) BEGIN
      SELECT RAISE(ABORT, 'analysis review does not belong to record');
    END;
    CREATE TRIGGER analysis_inputs_no_update
    BEFORE UPDATE ON analysis_inputs BEGIN
      SELECT RAISE(ABORT, 'analysis inputs are immutable');
    END;
    CREATE TRIGGER analysis_inputs_no_delete
    BEFORE DELETE ON analysis_inputs BEGIN
      SELECT RAISE(ABORT, 'analysis inputs are immutable');
    END;

    CREATE TRIGGER analysis_runs_identity_guard
    BEFORE UPDATE OF id,dataset_hash,algorithm_version,configuration_json,code_version,created_at
    ON analysis_runs
    WHEN NEW.id IS NOT OLD.id OR NEW.dataset_hash IS NOT OLD.dataset_hash
      OR NEW.algorithm_version IS NOT OLD.algorithm_version
      OR NEW.configuration_json IS NOT OLD.configuration_json
      OR NEW.code_version IS NOT OLD.code_version OR NEW.created_at IS NOT OLD.created_at
    BEGIN
      SELECT RAISE(ABORT, 'analysis run identity is immutable');
    END;
  `);
}

export const endToEndProvenanceClosureMigration: Migration = {
  version: 4,
  name: "end_to_end_provenance_closure",
  up(database) {
    recoverMeasurementsAndYield(database);
    rebuildAnalysisInputs(database);
    database.exec(`
      ALTER TABLE experiment_records ADD COLUMN idempotency_scope_class_id TEXT;
      UPDATE experiment_records
      SET idempotency_scope_class_id=class_id
      WHERE client_submission_id IS NOT NULL;
      DROP INDEX uq_experiment_records_offline_submission;
      CREATE UNIQUE INDEX uq_experiment_records_offline_submission
        ON experiment_records(created_by_user_id,idempotency_scope_class_id,client_submission_id)
        WHERE client_submission_id IS NOT NULL;
    `);
    installIntegrityTriggers(database);
  },
};
