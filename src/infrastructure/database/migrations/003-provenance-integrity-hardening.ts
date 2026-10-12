import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./types.js";

const SNAPSHOT_SCHEMA = "echoclass.analysis-input.v1";
const MEASUREMENT_METHODS = new Set([
  "not_recorded",
  "not_recorded_legacy",
  "manual_direct",
  "manual_local_image_calibrated",
]);

function parseJsonObject(value: unknown, context: string): Record<string, unknown> {
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

function validateMigratedLegacyRows(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT id, nh4cl_concentration, peel_mass, oil_mass, distillation_time,
        phase_clarity_score, emulsification_level, emulsion_concentration,
        ecoli_observation_group, inhibition_zone_diameter, colony_growth_score,
        anomaly_flag
       FROM experiment_records WHERE submission_kind='legacy_canonical_snapshot' ORDER BY id`,
    )
    .all() as unknown as Array<Record<string, unknown> & { id: string }>;
  const affected: string[] = [];
  for (const row of rows) {
    const invalid: string[] = [];
    if (![0, 1, 3, 4].includes(Number(row.nh4cl_concentration)))
      invalid.push("nh4cl_concentration");
    if (!(Number(row.peel_mass) > 0 && Number(row.peel_mass) <= 1000)) invalid.push("peel_mass");
    if (!(Number(row.oil_mass) >= 0 && Number(row.oil_mass) <= 20)) invalid.push("oil_mass");
    if (!(Number(row.distillation_time) > 0 && Number(row.distillation_time) <= 1440))
      invalid.push("distillation_time");
    if (!(Number(row.phase_clarity_score) >= 1 && Number(row.phase_clarity_score) <= 5))
      invalid.push("phase_clarity_score");
    if (typeof row.emulsification_level !== "string" || !row.emulsification_level.trim())
      invalid.push("emulsification_level");
    if (!(Number(row.emulsion_concentration) >= 0 && Number(row.emulsion_concentration) <= 100))
      invalid.push("emulsion_concentration");
    if (typeof row.ecoli_observation_group !== "string" || !row.ecoli_observation_group.trim())
      invalid.push("ecoli_observation_group");
    if (!(Number(row.inhibition_zone_diameter) >= 0 && Number(row.inhibition_zone_diameter) <= 60))
      invalid.push("inhibition_zone_diameter");
    if (!(Number(row.colony_growth_score) >= 1 && Number(row.colony_growth_score) <= 5))
      invalid.push("colony_growth_score");
    if (![0, 1].includes(Number(row.anomaly_flag))) invalid.push("anomaly_flag");
    if (invalid.length) affected.push(`${row.id}:${invalid.join("|")}`);
  }
  if (affected.length)
    throw new Error(
      `Migration 003 requires manual repair/restore for legacy records: ${affected.join(", ")}`,
    );
}

function preserveUnscopedLegacyTokens(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT id, client_submission_id, metadata_json FROM experiment_records
       WHERE submission_kind='legacy_canonical_snapshot'
         AND client_submission_id IS NOT NULL AND created_by_user_id IS NULL`,
    )
    .all() as unknown as Array<{
    id: string;
    client_submission_id: string;
    metadata_json: string;
  }>;
  const update = database.prepare(
    `UPDATE experiment_records
     SET client_submission_id=NULL, metadata_json=?
     WHERE id=?`,
  );
  for (const row of rows) {
    const metadata = parseJsonObject(row.metadata_json, `Legacy record ${row.id} metadata`);
    metadata.legacy_unscoped_client_submission_id = row.client_submission_id;
    metadata.legacy_idempotency_scope = "unresolved_actor_no_durable_guarantee";
    update.run(JSON.stringify(metadata), row.id);
  }
}

function backfillMeasurementProvenance(database: DatabaseSync): void {
  const rows = database
    .prepare("SELECT id, submission_kind, submitted_json FROM experiment_records ORDER BY id")
    .all() as unknown as Array<{
    id: string;
    submission_kind: string;
    submitted_json: string;
  }>;
  const update = database.prepare(
    `UPDATE experiment_records
     SET experiment_date=?, petri_diameter_mm=?, measurement_method=?
     WHERE id=?`,
  );
  for (const row of rows) {
    const submitted = parseJsonObject(row.submitted_json, `Record ${row.id} submission`);
    const experimentDate = validDate(submitted.experiment_date) ? submitted.experiment_date : null;
    const diameter = Number(submitted.petri_diameter_mm);
    const petriDiameter =
      submitted.petri_diameter_mm !== undefined &&
      Number.isFinite(diameter) &&
      diameter > 0 &&
      diameter <= 500
        ? diameter
        : null;
    const suppliedMethod = submitted.measurement_method;
    const method =
      typeof suppliedMethod === "string" && MEASUREMENT_METHODS.has(suppliedMethod)
        ? suppliedMethod
        : row.submission_kind === "legacy_canonical_snapshot"
          ? "not_recorded_legacy"
          : "not_recorded";
    update.run(experimentDate, petriDiameter, method, row.id);
  }
}

function validateExistingAnalysisSnapshots(database: DatabaseSync): void {
  const corrupt = database
    .prepare(
      `SELECT analysis_run_id, ordinal FROM analysis_inputs
       WHERE json_valid(record_snapshot_json)=0
          OR (review_snapshot_json IS NOT NULL AND json_valid(review_snapshot_json)=0)
       ORDER BY analysis_run_id, ordinal`,
    )
    .all() as unknown as Array<{ analysis_run_id: string; ordinal: number }>;
  if (corrupt.length)
    throw new Error(
      `Migration 003 found corrupt analysis snapshots: ${corrupt
        .map((row) => `${row.analysis_run_id}:${row.ordinal}`)
        .join(", ")}`,
    );
}

export const provenanceIntegrityHardeningMigration: Migration = {
  version: 3,
  name: "provenance_integrity_hardening",
  up(database) {
    validateMigratedLegacyRows(database);
    validateExistingAnalysisSnapshots(database);
    database.exec(`
      ALTER TABLE experiment_records ADD COLUMN effective_review_id TEXT;
      ALTER TABLE experiment_records ADD COLUMN experiment_date TEXT
        CHECK(experiment_date IS NULL OR (
          experiment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND date(experiment_date)=experiment_date
        ));
      ALTER TABLE experiment_records ADD COLUMN petri_diameter_mm REAL
        CHECK(petri_diameter_mm IS NULL OR (petri_diameter_mm>0 AND petri_diameter_mm<=500));
      ALTER TABLE experiment_records ADD COLUMN measurement_method TEXT NOT NULL DEFAULT 'not_recorded_legacy'
        CHECK(measurement_method IN (
          'not_recorded', 'not_recorded_legacy', 'manual_direct',
          'manual_local_image_calibrated'
        ));
      ALTER TABLE analysis_inputs ADD COLUMN snapshot_schema TEXT NOT NULL DEFAULT '${SNAPSHOT_SCHEMA}'
        CHECK(snapshot_schema='${SNAPSHOT_SCHEMA}');

      CREATE TABLE review_event_order (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id TEXT NOT NULL UNIQUE,
        FOREIGN KEY(review_id) REFERENCES record_reviews(id) ON DELETE RESTRICT
      ) STRICT;
      INSERT INTO review_event_order(review_id)
        SELECT id FROM record_reviews ORDER BY rowid;

      CREATE TABLE storage_imports (
        id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL,
        source_user_count INTEGER NOT NULL,
        source_record_count INTEGER NOT NULL,
        target_user_count INTEGER NOT NULL,
        target_record_count INTEGER NOT NULL,
        disposition TEXT NOT NULL CHECK(disposition IN ('imported', 'existing_sqlite_authoritative')),
        completed_at TEXT NOT NULL
      ) STRICT;

      UPDATE experiment_records
      SET effective_review_id=(
        SELECT reo.review_id FROM review_event_order reo
        JOIN record_reviews rr ON rr.id=reo.review_id
        WHERE rr.record_id=experiment_records.id
        ORDER BY reo.event_sequence DESC LIMIT 1
      );
      UPDATE experiment_records
      SET review_status=(SELECT decision FROM record_reviews WHERE id=effective_review_id),
          review_note=(SELECT reason FROM record_reviews WHERE id=effective_review_id),
          reviewed_at=(SELECT decided_at FROM record_reviews WHERE id=effective_review_id),
          reviewed_by=(SELECT reviewer_label FROM record_reviews WHERE id=effective_review_id)
      WHERE effective_review_id IS NOT NULL;
    `);

    preserveUnscopedLegacyTokens(database);
    backfillMeasurementProvenance(database);

    const invalidCanonical = database
      .prepare(
        `SELECT id FROM experiment_records
         WHERE submission_kind='canonical_submission'
           AND client_submission_id IS NOT NULL AND created_by_user_id IS NULL
         ORDER BY id`,
      )
      .all() as unknown as Array<{ id: string }>;
    if (invalidCanonical.length)
      throw new Error(
        `Canonical idempotency records require authenticated creators: ${invalidCanonical
          .map((row) => row.id)
          .join(", ")}`,
      );

    database.exec(`
      DROP TRIGGER record_reviews_no_update;
      DROP TRIGGER record_reviews_no_delete;

      CREATE TRIGGER record_reviews_duplicate_id_guard
      BEFORE INSERT ON record_reviews
      WHEN EXISTS(SELECT 1 FROM record_reviews WHERE id=NEW.id)
      BEGIN
        SELECT RAISE(ABORT, 'duplicate review event id');
      END;
      CREATE TRIGGER record_reviews_no_update
      BEFORE UPDATE ON record_reviews BEGIN
        SELECT RAISE(ABORT, 'record review history is append-only');
      END;
      CREATE TRIGGER record_reviews_no_delete
      BEFORE DELETE ON record_reviews BEGIN
        SELECT RAISE(ABORT, 'record review history is append-only');
      END;
      CREATE TRIGGER review_event_order_no_update
      BEFORE UPDATE ON review_event_order BEGIN
        SELECT RAISE(ABORT, 'review event order is append-only');
      END;
      CREATE TRIGGER review_event_order_no_delete
      BEFORE DELETE ON review_event_order BEGIN
        SELECT RAISE(ABORT, 'review event order is append-only');
      END;
      CREATE TRIGGER effective_review_pointer_guard
      BEFORE UPDATE OF effective_review_id ON experiment_records
      WHEN (
        NEW.effective_review_id IS NULL AND EXISTS(
          SELECT 1 FROM record_reviews WHERE record_id=NEW.id
        )
      ) OR NEW.effective_review_id IS NOT (
        SELECT reo.review_id FROM review_event_order reo
        JOIN record_reviews rr ON rr.id=reo.review_id
        WHERE rr.record_id=NEW.id
        ORDER BY reo.event_sequence DESC LIMIT 1
      )
      BEGIN
        SELECT RAISE(ABORT, 'effective review pointer must reference the latest record event');
      END;
      CREATE TRIGGER record_reviews_project_after_insert
      AFTER INSERT ON record_reviews
      BEGIN
        INSERT INTO review_event_order(review_id) VALUES(NEW.id);
        UPDATE experiment_records
        SET effective_review_id=NEW.id,
            review_status=NEW.decision,
            review_note=NEW.reason,
            reviewed_at=NEW.decided_at,
            reviewed_by=NEW.reviewer_label,
            updated_at=NEW.created_at
        WHERE id=NEW.record_id;
      END;

      CREATE TRIGGER analysis_inputs_duplicate_guard
      BEFORE INSERT ON analysis_inputs
      WHEN EXISTS(
        SELECT 1 FROM analysis_inputs
        WHERE analysis_run_id=NEW.analysis_run_id
          AND (ordinal=NEW.ordinal OR record_id=NEW.record_id)
      )
      BEGIN
        SELECT RAISE(ABORT, 'duplicate analysis input');
      END;
      CREATE TRIGGER analysis_inputs_review_record_guard
      BEFORE INSERT ON analysis_inputs
      WHEN NEW.review_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM record_reviews
        WHERE id=NEW.review_id AND record_id=NEW.record_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'analysis review does not belong to record');
      END;
      CREATE TRIGGER analysis_inputs_snapshot_guard
      BEFORE INSERT ON analysis_inputs
      WHEN NEW.snapshot_schema <> '${SNAPSHOT_SCHEMA}'
        OR json_valid(NEW.record_snapshot_json)=0
        OR (NEW.review_id IS NOT NULL AND NEW.review_snapshot_json IS NULL)
        OR (NEW.review_id IS NULL AND NEW.review_snapshot_json IS NOT NULL)
        OR (NEW.review_snapshot_json IS NOT NULL AND json_valid(NEW.review_snapshot_json)=0)
      BEGIN
        SELECT RAISE(ABORT, 'invalid analysis input snapshot');
      END;
      CREATE TRIGGER analysis_inputs_no_update
      BEFORE UPDATE ON analysis_inputs BEGIN
        SELECT RAISE(ABORT, 'analysis inputs are immutable');
      END;
      CREATE TRIGGER analysis_inputs_no_delete
      BEFORE DELETE ON analysis_inputs BEGIN
        SELECT RAISE(ABORT, 'analysis inputs are immutable');
      END;

      CREATE TRIGGER canonical_idempotency_creator_insert
      BEFORE INSERT ON experiment_records
      WHEN NEW.submission_kind='canonical_submission'
        AND NEW.client_submission_id IS NOT NULL
        AND NEW.created_by_user_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'canonical offline submission requires authenticated creator');
      END;
      CREATE TRIGGER canonical_idempotency_creator_update
      BEFORE UPDATE ON experiment_records
      WHEN NEW.submission_kind='canonical_submission'
        AND NEW.client_submission_id IS NOT NULL
        AND NEW.created_by_user_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'canonical offline submission requires authenticated creator');
      END;

      CREATE TRIGGER storage_imports_no_update
      BEFORE UPDATE ON storage_imports BEGIN
        SELECT RAISE(ABORT, 'storage import ledger is append-only');
      END;
      CREATE TRIGGER storage_imports_no_delete
      BEFORE DELETE ON storage_imports BEGIN
        SELECT RAISE(ABORT, 'storage import ledger is append-only');
      END;
    `);
  },
};

export { SNAPSHOT_SCHEMA };
