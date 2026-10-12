import type { DatabaseSync } from "node:sqlite";
import {
  isStrictOffsetTimestamp,
  isStrictTimestamp,
  STRICT_OFFSET_TIMESTAMP_PATTERN,
} from "../../../shared/strict-timestamp.js";
import { hasUnicodeNonBlankText, isMachineIdentity } from "../../../shared/provenance-contract.js";
import { ANALYSIS_SNAPSHOT_V1, validateRecordSnapshotV1Strict } from "../analysis-snapshot-v1.js";
import type { Migration } from "./types.js";

type Row = Record<string, unknown>;

interface Classification {
  entityType: "record" | "analysis_run";
  entityId: string;
  fieldName: string;
  classification: string;
  observedValue: string;
  reason: string;
}

interface AuditResult {
  classifications: Classification[];
  unverifiedRecordIds: Set<string>;
}

interface ImportedStorageMarker {
  id: string;
  sourceRecordCount: number;
}

const MIGRATION_NAME = "canonical_attribution_and_ledger_authority";
const MIGRATION_8_NAME = "analysis_input_sealing_and_provenance_boundary";
const MIGRATION_9_NAME = "sealed_dataset_and_historical_provenance_closure";
const STARTUP_IMPORT_ID = "json-startup-v1";

const MIGRATION_9_CLASSIFICATIONS = new Set([
  "historical_account_state_not_snapshotted",
  "legacy_blank_review_omission_reason",
  "legacy_incomplete_sealed_dataset",
  "legacy_offset_timestamp_calendar_invalid_unverified",
  "legacy_offset_timestamp",
  "legacy_review_chronology_unverified",
  "legacy_review_decision_time_missing_unverified",
  "legacy_review_sequence_chronology_unverified",
  "legacy_unverified_analysis_input",
  "pre_v9_record_version_history_incomplete",
  "pre_v9_record_version_time_collision_unverified",
]);

const RELEASED_LEDGER_GUARDS = [
  "provenance_boundary_classifications_no_replace",
  "provenance_boundary_classifications_no_update",
  "provenance_boundary_classifications_no_delete",
] as const;

const RELEASED_STORAGE_IMPORT_GUARDS = [
  "storage_imports_no_update",
  "storage_imports_no_delete",
] as const;

const RELEASED_LEDGER_GUARD_SQL: Record<(typeof RELEASED_LEDGER_GUARDS)[number], string> = {
  provenance_boundary_classifications_no_replace: `
    CREATE TRIGGER provenance_boundary_classifications_no_replace
    BEFORE INSERT ON provenance_boundary_classifications
    WHEN (
      NEW.classification_id<>-1 AND EXISTS(
        SELECT 1 FROM provenance_boundary_classifications
        WHERE classification_id=NEW.classification_id
      )
    ) OR EXISTS(
      SELECT 1 FROM provenance_boundary_classifications
      WHERE classification_migration_version=NEW.classification_migration_version
        AND entity_type=NEW.entity_type AND entity_id=NEW.entity_id
        AND field_name=NEW.field_name AND classification=NEW.classification
    )
    BEGIN SELECT RAISE(ABORT,'provenance classification ledger rejects replacement'); END`,
  provenance_boundary_classifications_no_update: `
    CREATE TRIGGER provenance_boundary_classifications_no_update
    BEFORE UPDATE ON provenance_boundary_classifications
    BEGIN SELECT RAISE(ABORT,'provenance classification ledger is append-only'); END`,
  provenance_boundary_classifications_no_delete: `
    CREATE TRIGGER provenance_boundary_classifications_no_delete
    BEFORE DELETE ON provenance_boundary_classifications
    BEGIN SELECT RAISE(ABORT,'provenance classification ledger is append-only'); END`,
};

const RELEASED_STORAGE_IMPORT_GUARD_SQL: Record<
  (typeof RELEASED_STORAGE_IMPORT_GUARDS)[number],
  string
> = {
  storage_imports_no_update: `
    CREATE TRIGGER storage_imports_no_update
    BEFORE UPDATE ON storage_imports BEGIN
      SELECT RAISE(ABORT, 'storage import ledger is append-only');
    END`,
  storage_imports_no_delete: `
    CREATE TRIGGER storage_imports_no_delete
    BEFORE DELETE ON storage_imports BEGIN
      SELECT RAISE(ABORT, 'storage import ledger is append-only');
    END`,
};

const RECORD_DIFFERENCE_FIELDS = new Set([
  "submitted_json",
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
  "experiment_date",
  "petri_diameter_mm",
  "measurement_method",
  "status",
]);

const MIGRATION_9_REASONS = {
  offset:
    "Migration 009 classified a valid historical offset timestamp written after the Migration 008 classification pass.",
  invalidOffset:
    "The Migration 008 offset grammar accepted a calendar-invalid or out-of-range offset timestamp.",
  invalidPriorOffset:
    "Migration 009 found that the Migration 008 offset value is not a real Gregorian timestamp with a supported offset.",
  versionCollision:
    "Schemas before version 9 permitted a provenance-bearing change to retain the record creation timestamp; operation order within that timestamp cannot be reconstructed.",
  snapshotVersionCollision:
    "Two provenance-bearing record versions share one timestamp, so their ordering cannot be reconstructed.",
  versionHistory:
    "The record has a plausible advanced update timestamp, but schemas before version 9 did not retain a complete field-level version ledger.",
  reviewSequence:
    "A later immutable legacy review sequence contains an event or decision time before prior review evidence.",
  reviewDecisionMissing:
    "The released legacy projection has no durable decision timestamp; immutable values were retained but are not claimed to satisfy v1 chronology.",
  reviewChronology:
    "The released legacy projection recorded migration capture as event creation after the preserved historical decision time; immutable values were retained but are not claimed to satisfy v1 chronology.",
  accountState:
    "The immutable event retains reviewer ownership and label, but schemas through version 8 did not snapshot the account role, status or names at event time.",
  incompleteDataset:
    "The historical sealed input set was empty, non-contiguous or repeated a selected record.",
  blankOmission: "The historical omission reason does not contain Unicode non-blank text.",
} as const;

function valueText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function normalizedSql(value: unknown): string {
  return valueText(value).toLowerCase().replace(/[\s;]/g, "");
}

function historicalTimestampMillis(value: unknown): number | undefined {
  if (!isStrictTimestamp(value) && !isStrictOffsetTimestamp(value)) return undefined;
  return Date.parse(value);
}

function canonicalTimestampSql(expression: string): string {
  return `(typeof(${expression})='text' AND length(${expression})=24
    AND ${expression} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
    AND CAST(substr(${expression},1,4) AS INTEGER)>=1
    AND date(substr(${expression},1,10),'+0 days')=substr(${expression},1,10)
    AND CAST(substr(${expression},12,2) AS INTEGER) BETWEEN 0 AND 23
    AND CAST(substr(${expression},15,2) AS INTEGER) BETWEEN 0 AND 59
    AND CAST(substr(${expression},18,2) AS INTEGER) BETWEEN 0 AND 59
    AND julianday(${expression}) IS NOT NULL)`;
}

function unversionedSubmissionDifferences(row: Row): string[] {
  if (row.submission_kind !== "canonical_submission") return [];
  let submitted: Row;
  try {
    const parsed: unknown = JSON.parse(valueText(row.submitted_json));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return ["submitted_json"];
    submitted = parsed as Row;
  } catch {
    return ["submitted_json"];
  }
  const fields = [
    ["student_name", "student_name"],
    ["class_name", "class_name_snapshot"],
    ["group_name", "group_name_snapshot"],
    ["nh4cl_concentration", "nh4cl_concentration"],
    ["peel_mass", "peel_mass"],
    ["oil_mass", "oil_mass"],
    ["distillation_time", "distillation_time"],
    ["phase_clarity_score", "phase_clarity_score"],
    ["emulsification_level", "emulsification_level"],
    ["emulsion_concentration", "emulsion_concentration"],
    ["ecoli_observation_group", "ecoli_observation_group"],
    ["inhibition_zone_diameter", "inhibition_zone_diameter"],
    ["colony_growth_score", "colony_growth_score"],
    ["error_source", "error_source"],
    ["note", "note"],
    ["experiment_date", "experiment_date"],
    ["petri_diameter_mm", "petri_diameter_mm"],
    ["measurement_method", "measurement_method"],
  ] as const;
  const differences: string[] = fields
    .filter(([submittedField, rowField]) => {
      if (!Object.prototype.hasOwnProperty.call(submitted, submittedField)) return false;
      return (submitted[submittedField] ?? null) !== (row[rowField] ?? null);
    })
    .map(([submittedField]) => submittedField);
  if (
    Object.prototype.hasOwnProperty.call(submitted, "异常标记") &&
    submitted.异常标记 !== Boolean(row.anomaly_flag)
  )
    differences.push("异常标记");
  if (row.status !== "active") differences.push("status");
  return differences;
}

function validDifferenceList(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  const fields = value.split("|");
  return fields.length > 0 && fields.every((field) => RECORD_DIFFERENCE_FIELDS.has(field));
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") return Object.is(left, right);
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => jsonValuesEqual(entry, right[index]));
  }
  const leftRow = left as Row;
  const rightRow = right as Row;
  const leftKeys = Object.keys(leftRow).sort();
  const rightKeys = Object.keys(rightRow).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && jsonValuesEqual(leftRow[key], rightRow[key]),
    )
  );
}

function snapshotDiffersFromDurable(snapshot: Row, row: Row): boolean {
  const mappings = [
    ["id", "id"],
    ["client_submission_id", "client_submission_id"],
    ["created_by_user_id", "created_by_user_id"],
    ["student_name", "student_name"],
    ["class_id", "class_id"],
    ["class_name", "class_name_snapshot"],
    ["group_id", "group_id"],
    ["group_name", "group_name_snapshot"],
    ["experiment_type", "experiment_type"],
    ["status", "status"],
    ["nh4cl_concentration", "nh4cl_concentration"],
    ["peel_mass", "peel_mass"],
    ["oil_mass", "oil_mass"],
    ["distillation_time", "distillation_time"],
    ["phase_clarity_score", "phase_clarity_score"],
    ["emulsification_level", "emulsification_level"],
    ["emulsion_concentration", "emulsion_concentration"],
    ["ecoli_observation_group", "ecoli_observation_group"],
    ["inhibition_zone_diameter", "inhibition_zone_diameter"],
    ["colony_growth_score", "colony_growth_score"],
    ["error_source", "error_source"],
    ["note", "note"],
    ["experiment_date", "experiment_date"],
    ["petri_diameter_mm", "petri_diameter_mm"],
    ["measurement_method", "measurement_method"],
    ["yield_percent", "yield_percent"],
    ["created_at", "created_at"],
    ["updated_at", "updated_at"],
    ["created_by", "created_by_label"],
    ["effective_review_id", "effective_review_id"],
    ["review_status", "review_status"],
    ["review_note", "review_note"],
    ["reviewed_by", "reviewed_by"],
    ["ai_diagnosis", "ai_diagnosis"],
  ] as const;
  if (
    mappings.some(
      ([snapshotField, rowField]) => (snapshot[snapshotField] ?? null) !== (row[rowField] ?? null),
    )
  )
    return true;
  if ((snapshot.reviewed_at ?? "") !== (row.reviewed_at ?? "")) return true;
  if (snapshot.异常标记 !== Boolean(row.anomaly_flag)) return true;
  if (snapshot.synced_from_offline !== Boolean(row.synced_from_offline)) return true;
  try {
    const metadata = JSON.parse(valueText(row.metadata_json)) as Row;
    if (row.client_submission_id !== null) {
      metadata.client_submission_id = valueText(row.client_submission_id);
      if (row.created_by_user_id !== null)
        metadata.idempotency_actor_id = valueText(row.created_by_user_id);
      metadata.idempotency_class_name = valueText(row.class_name_snapshot);
    }
    return !jsonValuesEqual(snapshot.metadata, metadata);
  } catch {
    return true;
  }
}

function hasSnapshotVersionCollision(
  database: DatabaseSync,
  recordId: string,
  timestamp: string,
): boolean {
  const rows = database
    .prepare(
      `SELECT analysis_run_id,ordinal,snapshot_schema,record_snapshot_json
       FROM analysis_inputs WHERE record_id=?`,
    )
    .all(recordId) as Row[];
  const snapshots: Row[] = [];
  for (const row of rows) {
    const currentV1 = row.snapshot_schema === ANALYSIS_SNAPSHOT_V1;
    const downgradedReleasedV1 =
      row.snapshot_schema === "echoclass.analysis-input.legacy" &&
      Boolean(
        database
          .prepare(
            `SELECT 1 FROM provenance_boundary_classifications
             WHERE classification_migration_version=9
               AND entity_type='analysis_input' AND entity_id=?
               AND classification='legacy_unverified_analysis_input'`,
          )
          .get(`${valueText(row.analysis_run_id)}#${valueText(row.ordinal)}`),
      );
    if (!currentV1 && !downgradedReleasedV1) continue;
    try {
      const parsed = validateRecordSnapshotV1Strict(
        row.record_snapshot_json,
        recordId,
      ) as unknown as Row;
      if (parsed.updated_at === timestamp) snapshots.push(parsed);
    } catch {
      // Malformed snapshots cannot establish the claimed version collision.
    }
  }
  if (
    snapshots.some((snapshot, index) =>
      snapshots.slice(index + 1).some((other) => !jsonValuesEqual(snapshot, other)),
    )
  )
    return true;
  const durable = database.prepare("SELECT * FROM experiment_records WHERE id=?").get(recordId) as
    Row | undefined;
  return Boolean(
    durable?.updated_at === timestamp &&
    snapshots.some((snapshot) => snapshotDiffersFromDurable(snapshot, durable)),
  );
}

function tableIdentity(database: DatabaseSync, table: string, rowId: unknown): string {
  const numericRowId = Number(rowId);
  if (!Number.isSafeInteger(numericRowId)) return String(rowId);
  if (["experiment_records", "record_reviews", "analysis_runs", "users"].includes(table)) {
    const row = database.prepare(`SELECT id FROM ${table} WHERE rowid=?`).get(numericRowId) as
      Row | undefined;
    if (row) return valueText(row.id);
  }
  if (table === "analysis_inputs") {
    const row = database
      .prepare("SELECT analysis_run_id,ordinal,record_id FROM analysis_inputs WHERE rowid=?")
      .get(numericRowId) as Row | undefined;
    if (row)
      return `${valueText(row.analysis_run_id)}#${valueText(row.ordinal)}:${valueText(row.record_id)}`;
  }
  return String(rowId);
}

function auditForeignKeys(database: DatabaseSync): void {
  const failures = database.prepare("PRAGMA foreign_key_check").all() as Row[];
  if (!failures.length) return;
  const identities = failures.map((row) => {
    const table = valueText(row.table);
    return `${table}:${tableIdentity(database, table, row.rowid)}:${valueText(row.parent)}`;
  });
  throw new Error(`Migration 010 foreign-key corruption: ${identities.join(", ")}`);
}

function auditDeleteGuardAbsence(database: DatabaseSync): void {
  const unexpected = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='trigger' AND tbl_name IN ('experiment_records','analysis_runs')
         AND upper(sql) LIKE '%BEFORE DELETE%'
       ORDER BY name`,
    )
    .all() as Row[];
  if (unexpected.length)
    throw new Error(
      `Migration 010 expected physical-delete guards to be absent: ${unexpected
        .map((row) => valueText(row.name))
        .join(", ")}`,
    );
}

function auditReleasedLedgerGuards(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT name,sql FROM sqlite_master
       WHERE type='trigger' AND name IN (?,?,?) ORDER BY name`,
    )
    .all(...RELEASED_LEDGER_GUARDS) as Row[];
  const byName = new Map(rows.map((row) => [valueText(row.name), normalizedSql(row.sql)]));
  const invalid: string[] = [];
  for (const name of RELEASED_LEDGER_GUARDS) {
    const sql = byName.get(name);
    if (!sql || sql !== normalizedSql(RELEASED_LEDGER_GUARD_SQL[name])) invalid.push(name);
  }
  if (invalid.length)
    throw new Error(`Migration 010 classification ledger guard mismatch: ${invalid.join(", ")}`);
}

function auditReleasedStorageImportGuards(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT name,sql FROM sqlite_master
       WHERE type='trigger' AND name IN (?,?) ORDER BY name`,
    )
    .all(...RELEASED_STORAGE_IMPORT_GUARDS) as Row[];
  const byName = new Map(rows.map((row) => [valueText(row.name), normalizedSql(row.sql)]));
  const invalid = RELEASED_STORAGE_IMPORT_GUARDS.filter(
    (name) => byName.get(name) !== normalizedSql(RELEASED_STORAGE_IMPORT_GUARD_SQL[name]),
  );
  if (invalid.length)
    throw new Error(`Migration 010 storage-import ledger guard mismatch: ${invalid.join(", ")}`);
}

function ledgerTargetExists(database: DatabaseSync, row: Row): boolean {
  const entityType = valueText(row.entity_type);
  const entityId = valueText(row.entity_id);
  const target: Record<string, { table: string; key: string }> = {
    record: { table: "experiment_records", key: "id" },
    review: { table: "record_reviews", key: "id" },
    run: { table: "analysis_runs", key: "id" },
    analysis_run: { table: "analysis_runs", key: "id" },
  };
  const direct = target[entityType];
  if (direct)
    return Boolean(
      database.prepare(`SELECT 1 FROM ${direct.table} WHERE ${direct.key}=?`).get(entityId),
    );
  if (entityType === "analysis_input") {
    const separator = entityId.lastIndexOf("#");
    if (separator <= 0) return false;
    const runId = entityId.slice(0, separator);
    const ordinal = Number(entityId.slice(separator + 1));
    return (
      Number.isSafeInteger(ordinal) &&
      Boolean(
        database
          .prepare("SELECT 1 FROM analysis_inputs WHERE analysis_run_id=? AND ordinal=?")
          .get(runId, ordinal),
      )
    );
  }
  return false;
}

function validClassificationShape(row: Row): boolean {
  const version = Number(row.classification_migration_version);
  const entity = valueText(row.entity_type);
  const field = valueText(row.field_name);
  const classification = valueText(row.classification);
  const timestampShape =
    (entity === "record" && ["created_at", "updated_at"].includes(field)) ||
    (entity === "review" && ["created_at", "decided_at"].includes(field)) ||
    (entity === "run" && ["created_at", "completed_at"].includes(field));
  if (version === 8) return classification === "legacy_offset_timestamp" && timestampShape;
  if (
    ["legacy_offset_timestamp", "legacy_offset_timestamp_calendar_invalid_unverified"].includes(
      classification,
    )
  )
    return timestampShape;
  const shapes: Record<string, [string, string]> = {
    historical_account_state_not_snapshotted: ["review", "historical_reviewer_authorization"],
    legacy_blank_review_omission_reason: ["analysis_input", "review_omission_reason"],
    legacy_incomplete_sealed_dataset: ["analysis_run", "sealed_input_set"],
    legacy_review_chronology_unverified: ["review", "decided_at"],
    legacy_review_decision_time_missing_unverified: ["review", "decided_at"],
    legacy_review_sequence_chronology_unverified: ["review", "event_sequence"],
    legacy_unverified_analysis_input: ["analysis_input", "snapshot_schema"],
    pre_v9_record_version_history_incomplete: ["record", "updated_at"],
    pre_v9_record_version_time_collision_unverified: ["record", "updated_at"],
  };
  const expected = shapes[classification];
  return Boolean(expected && entity === expected[0] && field === expected[1]);
}

function analysisInputTarget(database: DatabaseSync, entityId: string): Row | undefined {
  const separator = entityId.lastIndexOf("#");
  if (separator <= 0) return undefined;
  const runId = entityId.slice(0, separator);
  const ordinal = Number(entityId.slice(separator + 1));
  if (!Number.isSafeInteger(ordinal)) return undefined;
  return database
    .prepare("SELECT * FROM analysis_inputs WHERE analysis_run_id=? AND ordinal=?")
    .get(runId, ordinal);
}

function reviewWithSequence(database: DatabaseSync, reviewId: string): Row | undefined {
  return database
    .prepare(
      `SELECT rr.*,reo.event_sequence FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id WHERE rr.id=?`,
    )
    .get(reviewId);
}

function reviewSequenceHasReversal(database: DatabaseSync, review: Row): boolean {
  const prior = database
    .prepare(
      `SELECT rr.created_at,rr.decided_at FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       WHERE rr.record_id=? AND reo.event_sequence<?`,
    )
    .all(valueText(review.record_id), Number(review.event_sequence)) as Row[];
  const priorTimes = prior.flatMap((row) =>
    [historicalTimestampMillis(row.created_at), historicalTimestampMillis(row.decided_at)].filter(
      (value): value is number => value !== undefined,
    ),
  );
  if (!priorTimes.length) return false;
  const boundary = Math.max(...priorTimes);
  const created = historicalTimestampMillis(review.created_at);
  const decided = historicalTimestampMillis(review.decided_at);
  return (
    (created !== undefined && created < boundary) || (decided !== undefined && decided < boundary)
  );
}

function classifiedTargetField(database: DatabaseSync, row: Row): unknown {
  const entity = valueText(row.entity_type);
  const id = valueText(row.entity_id);
  const field = valueText(row.field_name);
  const table =
    entity === "record"
      ? "experiment_records"
      : entity === "review"
        ? "record_reviews"
        : entity === "run"
          ? "analysis_runs"
          : undefined;
  if (!table || !["created_at", "updated_at", "decided_at", "completed_at"].includes(field))
    return undefined;
  return (
    database.prepare(`SELECT ${field} value FROM ${table} WHERE id=?`).get(id) as Row | undefined
  )?.value;
}

function historicalTimestampClassificationStillMatches(
  database: DatabaseSync,
  row: Row,
  observed: unknown,
): boolean {
  const current = classifiedTargetField(database, row);
  if (current === observed) return true;
  if (row.entity_type !== "record" || row.field_name !== "updated_at") return false;
  const historical = historicalTimestampMillis(observed);
  const advanced = historicalTimestampMillis(current);
  if (historical !== undefined && advanced !== undefined && advanced > historical) return true;
  if (!isStrictTimestamp(current)) return false;
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM provenance_boundary_classifications
         WHERE classification_migration_version=9
           AND entity_type=? AND entity_id=? AND field_name=?
           AND classification='legacy_offset_timestamp_calendar_invalid_unverified'
           AND observed_value=? AND reason IN (?,?)`,
      )
      .get(
        valueText(row.entity_type),
        valueText(row.entity_id),
        valueText(row.field_name),
        valueText(observed),
        MIGRATION_9_REASONS.invalidOffset,
        MIGRATION_9_REASONS.invalidPriorOffset,
      ),
  );
}

function historicalInvalidTimestampClassificationStillMatches(
  database: DatabaseSync,
  row: Row,
  observed: unknown,
  reason: string,
): boolean {
  const current = classifiedTargetField(database, row);
  if (current === observed) return true;
  if (
    row.entity_type !== "record" ||
    row.field_name !== "updated_at" ||
    !isStrictTimestamp(current)
  )
    return false;
  if (reason === MIGRATION_9_REASONS.invalidOffset) return true;
  if (reason !== MIGRATION_9_REASONS.invalidPriorOffset) return false;
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM provenance_boundary_classifications
         WHERE classification_migration_version=8
           AND entity_type=? AND entity_id=? AND field_name=?
           AND classification='legacy_offset_timestamp' AND observed_value=?`,
      )
      .get(
        valueText(row.entity_type),
        valueText(row.entity_id),
        valueText(row.field_name),
        valueText(observed),
      ),
  );
}

function validUnverifiedInputReason(reason: string): boolean {
  if (
    [
      "The historical v1 input has no defensible non-blank omission reason.",
      "The selected record has a pre-version-9 provenance change whose version timestamp did not advance.",
      "The snapshot or durable lifecycle timing shows that the record was already deleted at selection time.",
      "The historical v1 input cannot prove its exact review projection at selection time.",
    ].includes(reason)
  )
    return true;
  const match =
    /^The snapshot and durable record disagree at the same updated_at for fields: ([A-Za-z0-9_|\u5f02\u5e38\u6807\u8bb0]+)\.$/.exec(
      reason,
    );
  return Boolean(match?.[1] && match[1].split("|").every((field) => field.length > 0));
}

function validateMigration9Semantics(database: DatabaseSync, row: Row): string[] {
  const fields: string[] = [];
  const classification = valueText(row.classification);
  const observed = row.observed_value;
  const reason = valueText(row.reason);
  const entityId = valueText(row.entity_id);
  if (typeof observed !== "string" || !hasUnicodeNonBlankText(observed))
    fields.push("observed_value");

  if (classification === "legacy_offset_timestamp") {
    if (
      !isStrictOffsetTimestamp(observed) ||
      !historicalTimestampClassificationStillMatches(database, row, observed)
    )
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.offset) fields.push("reason");
  } else if (classification === "legacy_offset_timestamp_calendar_invalid_unverified") {
    if (
      typeof observed !== "string" ||
      !STRICT_OFFSET_TIMESTAMP_PATTERN.test(observed) ||
      isStrictOffsetTimestamp(observed) ||
      !historicalInvalidTimestampClassificationStillMatches(database, row, observed, reason)
    )
      fields.push("observed_value");
    if (
      !new Set<string>([
        MIGRATION_9_REASONS.invalidOffset,
        MIGRATION_9_REASONS.invalidPriorOffset,
      ]).has(reason)
    )
      fields.push("reason");
  } else if (classification === "historical_account_state_not_snapshotted") {
    const review = database.prepare("SELECT * FROM record_reviews WHERE id=?").get(entityId) as
      Row | undefined;
    if (
      !review ||
      review.provenance_kind !== "human" ||
      observed !== valueText(review.reviewer_user_id ?? "unresolved")
    )
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.accountState) fields.push("reason");
  } else if (classification === "legacy_blank_review_omission_reason") {
    const input = analysisInputTarget(database, entityId);
    if (
      observed !== "blank_or_non_text" ||
      !input ||
      !["omit", "legacy_unspecified"].includes(valueText(input.review_binding_mode)) ||
      hasUnicodeNonBlankText(input.review_omission_reason)
    )
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.blankOmission) fields.push("reason");
  } else if (classification === "legacy_incomplete_sealed_dataset") {
    const aggregate = database
      .prepare(
        `SELECT ar.inputs_sealed,COUNT(ai.ordinal) input_count,MIN(ai.ordinal) min_ordinal,
          MAX(ai.ordinal) max_ordinal,COUNT(DISTINCT ai.ordinal) distinct_count,
          COUNT(DISTINCT ai.record_id) distinct_record_count
         FROM analysis_runs ar LEFT JOIN analysis_inputs ai ON ai.analysis_run_id=ar.id
         WHERE ar.id=? GROUP BY ar.id`,
      )
      .get(entityId) as Row | undefined;
    const expected = aggregate
      ? `count=${Number(aggregate.input_count)};min=${String(aggregate.min_ordinal)};max=${String(aggregate.max_ordinal)};distinct_ordinals=${String(aggregate.distinct_count)};distinct_records=${String(aggregate.distinct_record_count)}`
      : "";
    const count = Number(aggregate?.input_count);
    const complete =
      count >= 1 &&
      Number(aggregate?.min_ordinal) === 0 &&
      Number(aggregate?.max_ordinal) === count - 1 &&
      Number(aggregate?.distinct_count) === count &&
      Number(aggregate?.distinct_record_count) === count;
    if (!aggregate || Number(aggregate.inputs_sealed) !== 1 || complete || observed !== expected)
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.incompleteDataset) fields.push("reason");
  } else if (classification === "legacy_review_sequence_chronology_unverified") {
    const review = reviewWithSequence(database, entityId);
    if (
      !review ||
      review.provenance_kind !== "legacy_projection" ||
      observed !== valueText(review.event_sequence) ||
      !reviewSequenceHasReversal(database, review)
    )
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.reviewSequence) fields.push("reason");
  } else if (classification === "legacy_review_decision_time_missing_unverified") {
    const review = database
      .prepare("SELECT provenance_kind,decided_at FROM record_reviews WHERE id=?")
      .get(entityId) as Row | undefined;
    if (
      !review ||
      review.provenance_kind !== "legacy_projection" ||
      observed !== "missing" ||
      ![null, ""].includes(review.decided_at as null | "")
    )
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.reviewDecisionMissing) fields.push("reason");
  } else if (classification === "legacy_review_chronology_unverified") {
    const review = database
      .prepare("SELECT provenance_kind,created_at,decided_at FROM record_reviews WHERE id=?")
      .get(entityId) as Row | undefined;
    const created = historicalTimestampMillis(review?.created_at);
    const decided = historicalTimestampMillis(review?.decided_at);
    if (
      !review ||
      review.provenance_kind !== "legacy_projection" ||
      observed !== valueText(review.decided_at) ||
      created === undefined ||
      decided === undefined ||
      decided >= created
    )
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.reviewChronology) fields.push("reason");
  } else if (classification === "legacy_unverified_analysis_input") {
    const input = analysisInputTarget(database, entityId);
    if (
      !input ||
      observed !==
        `${valueText(input.analysis_run_id)}:${valueText(input.ordinal)}:${valueText(input.record_id)}` ||
      input.snapshot_schema !== "echoclass.analysis-input.legacy"
    )
      fields.push("observed_value");
    if (!validUnverifiedInputReason(reason)) fields.push("reason");
  } else if (classification === "pre_v9_record_version_history_incomplete") {
    const record = database.prepare("SELECT * FROM experiment_records WHERE id=?").get(entityId) as
      Row | undefined;
    const created = historicalTimestampMillis(record?.created_at);
    const updated = historicalTimestampMillis(record?.updated_at);
    if (
      !record ||
      !validDifferenceList(observed) ||
      created === undefined ||
      updated === undefined ||
      updated <= created
    )
      fields.push("observed_value");
    if (reason !== MIGRATION_9_REASONS.versionHistory) fields.push("reason");
  } else if (classification === "pre_v9_record_version_time_collision_unverified") {
    const record = database.prepare("SELECT * FROM experiment_records WHERE id=?").get(entityId) as
      Row | undefined;
    if (reason === MIGRATION_9_REASONS.versionCollision) {
      const currentDifferences = record ? unversionedSubmissionDifferences(record) : [];
      const created = historicalTimestampMillis(record?.created_at);
      const updated = historicalTimestampMillis(record?.updated_at);
      if (
        !record ||
        !validDifferenceList(observed) ||
        created === undefined ||
        updated === undefined ||
        updated < created ||
        (updated === created && currentDifferences.join("|") !== observed)
      )
        fields.push("observed_value");
    } else if (reason === MIGRATION_9_REASONS.snapshotVersionCollision) {
      if (
        typeof observed !== "string" ||
        historicalTimestampMillis(observed) === undefined ||
        !hasSnapshotVersionCollision(database, entityId, observed)
      )
        fields.push("observed_value");
    } else fields.push("reason");
  }
  return [...new Set(fields)];
}

function auditClassificationLedger(database: DatabaseSync): void {
  const appliedRows = database
    .prepare("SELECT version,name,applied_at FROM schema_migrations WHERE version IN (8,9)")
    .all() as Row[];
  const applied = new Map(appliedRows.map((row) => [Number(row.version), row]));
  const bad: string[] = [];
  const rows = database
    .prepare("SELECT * FROM provenance_boundary_classifications ORDER BY classification_id")
    .all() as Row[];
  let expectedId = 1;
  let previousVersion = 8;
  for (const row of rows) {
    const id = Number(row.classification_id);
    const fields: string[] = [];
    const version = Number(row.classification_migration_version);
    const migration = applied.get(version);
    if (!Number.isSafeInteger(id) || id <= 0) fields.push("classification_id");
    if (id !== expectedId) fields.push("classification_id_sequence");
    expectedId += 1;
    if (version !== 8 && version !== 9) fields.push("classification_migration_version");
    if (version < previousVersion) fields.push("classification_migration_version_order");
    if (version === 8 || version === 9) previousVersion = version;
    const expectedName = version === 8 ? MIGRATION_8_NAME : version === 9 ? MIGRATION_9_NAME : "";
    if (!hasUnicodeNonBlankText(row.classification_migration_name))
      fields.push("classification_migration_name");
    else if (valueText(row.classification_migration_name) !== expectedName)
      fields.push("classification_migration_name");
    for (const field of ["entity_type", "entity_id", "field_name", "classification", "reason"])
      if (!hasUnicodeNonBlankText(row[field])) fields.push(field);
    if (!isStrictTimestamp(row.classified_at)) fields.push("classified_at");
    else if (!migration || row.classified_at !== migration.applied_at) fields.push("classified_at");
    const classification = valueText(row.classification);
    if (version === 8) {
      if (classification !== "legacy_offset_timestamp") fields.push("classification");
      if (
        typeof row.observed_value !== "string" ||
        !STRICT_OFFSET_TIMESTAMP_PATTERN.test(row.observed_value) ||
        !historicalTimestampClassificationStillMatches(database, row, row.observed_value)
      )
        fields.push("observed_value");
      if (
        row.reason !==
        "Preserved Migration 008 classification; its table was mutable before Migration 009 sealed the ledger."
      )
        fields.push("reason");
    } else if (version === 9) {
      if (!MIGRATION_9_CLASSIFICATIONS.has(classification)) fields.push("classification");
      else fields.push(...validateMigration9Semantics(database, row));
    }
    if ((version === 8 || version === 9) && !validClassificationShape(row))
      fields.push("entity_type/field_name/classification");
    if (!ledgerTargetExists(database, row)) fields.push("entity_type/entity_id");
    if (fields.length)
      bad.push(
        `${Number.isFinite(id) ? id : valueText(row.classification_id)}:${classification}:${[
          ...new Set(fields),
        ].join("|")}`,
      );
  }
  if (bad.length)
    throw new Error(`Migration 010 invalid classification IDs and fields: ${bad.join(", ")}`);
}

function auditStorageImports(database: DatabaseSync): ImportedStorageMarker[] {
  const bad: string[] = [];
  const imported: ImportedStorageMarker[] = [];
  const currentUserCount = Number(
    database.prepare("SELECT COUNT(*) count FROM users").get()!.count,
  );
  const currentRecordCount = Number(
    database.prepare("SELECT COUNT(*) count FROM experiment_records").get()!.count,
  );
  for (const row of database.prepare("SELECT * FROM storage_imports ORDER BY id").all() as Row[]) {
    const id = valueText(row.id);
    const fields: string[] = [];
    if (!isMachineIdentity(row.id) || id !== STARTUP_IMPORT_ID) fields.push("id");
    if (row.source_kind !== "startup_json_snapshot") fields.push("source_kind");
    for (const field of [
      "source_user_count",
      "source_record_count",
      "target_user_count",
      "target_record_count",
    ]) {
      if (typeof row[field] !== "number" || !Number.isSafeInteger(row[field]) || row[field] < 0)
        fields.push(field);
    }
    const disposition = valueText(row.disposition);
    if (disposition === "imported") {
      if (row.source_user_count !== row.target_user_count) fields.push("source_user_count");
      if (row.source_record_count !== row.target_record_count) fields.push("source_record_count");
      imported.push({
        id,
        sourceRecordCount: Number(row.source_record_count),
      });
    } else if (disposition === "existing_sqlite_authoritative") {
      if (row.source_user_count !== 0) fields.push("source_user_count");
      if (row.source_record_count !== 0) fields.push("source_record_count");
      if (Number(row.target_user_count) + Number(row.target_record_count) < 1)
        fields.push("target_user_count/target_record_count");
    } else fields.push("disposition");
    if (Number(row.target_user_count) > currentUserCount) fields.push("target_user_count");
    if (Number(row.target_record_count) > currentRecordCount) fields.push("target_record_count");
    if (!isStrictTimestamp(row.completed_at)) fields.push("completed_at");
    if (fields.length) bad.push(`${id}:${[...new Set(fields)].join("|")}`);
  }
  if (bad.length)
    throw new Error(`Migration 010 invalid storage-import evidence: ${bad.join(", ")}`);
  return imported;
}

function auditCanonicalAndLegacyRows(
  database: DatabaseSync,
  importedMarkers: ImportedStorageMarker[],
): AuditResult {
  const classifications: Classification[] = [];
  const unverifiedRecordIds = new Set<string>();
  const seen = new Set<string>();
  const add = (value: Classification): void => {
    const key = `${value.entityId}\u0000${value.fieldName}\u0000${value.classification}`;
    if (seen.has(key)) return;
    seen.add(key);
    classifications.push(value);
    if (value.classification.endsWith("_unverified")) unverifiedRecordIds.add(value.entityId);
  };
  const records = database.prepare("SELECT * FROM experiment_records ORDER BY id").all() as Row[];
  const potentialHistoricalImports = new Set<string>();
  for (const marker of importedMarkers) {
    if (marker.sourceRecordCount === 0) continue;
    if (records.length < marker.sourceRecordCount)
      throw new Error(
        `Migration 010 invalid storage-import evidence: ${marker.id}:record_membership`,
      );
    // Released markers did not bind individual rows and imposed no relationship between
    // record clocks and the importer clock. Every surviving row is therefore a candidate.
    for (const row of records) potentialHistoricalImports.add(valueText(row.id));
  }
  for (const row of records) {
    const id = valueText(row.id);
    const kind = valueText(row.submission_kind);
    if (kind === "legacy_canonical_snapshot") {
      add({
        entityType: "record",
        entityId: id,
        fieldName: "storage_import_id",
        classification: "historical_legacy_import_batch_link_not_recorded_unverified",
        observedValue: "not_recorded",
        reason:
          "This legacy snapshot predates the durable per-record import-batch reference introduced by Migration 010; immutable evidence was retained without an exact import-batch claim.",
      });
      continue;
    }
    if (kind !== "canonical_submission")
      throw new Error(`Migration 010 unsupported submission kind: ${id}:submission_kind`);

    if (potentialHistoricalImports.has(id))
      add({
        entityType: "record",
        entityId: id,
        fieldName: "storage_import_id",
        classification: "historical_legacy_import_batch_link_not_recorded_unverified",
        observedValue: "not_recorded",
        reason:
          "A released imported storage marker predates durable per-record batch links; this row may belong to that legacy snapshot and is not claimed as a new authoritative canonical submission.",
      });

    const creatorId = row.created_by_user_id === null ? "" : valueText(row.created_by_user_id);
    const creator = creatorId
      ? (database.prepare("SELECT username,name FROM users WHERE id=?").get(creatorId) as
          Row | undefined)
      : undefined;
    if (!creatorId || !creator) {
      add({
        entityType: "record",
        entityId: id,
        fieldName: "created_by_user_id",
        classification: "historical_creator_attribution_unverified",
        observedValue: creatorId || "not_recorded",
        reason:
          "The released canonical row has no durable creator account reference; immutable creator evidence was retained but is not claimed as exact attribution.",
      });
    } else if (row.created_by_label !== creator.username && row.created_by_label !== creator.name) {
      add({
        entityType: "record",
        entityId: id,
        fieldName: "created_by_label",
        classification: "historical_creator_account_state_not_snapshotted",
        observedValue: valueText(row.created_by_label),
        reason:
          "The creator label differs from the current account names, but historical account-name state was not snapshotted; a later rename is therefore not treated as corruption.",
      });
    }

    const hasToken = row.client_submission_id !== null;
    const offline = Number(row.synced_from_offline) === 1;
    const classId = valueText(row.class_id);
    const scopeId =
      row.idempotency_scope_class_id === null ? "" : valueText(row.idempotency_scope_class_id);
    if (offline !== hasToken)
      add({
        entityType: "record",
        entityId: id,
        fieldName: "synced_from_offline",
        classification: "historical_offline_attribution_unverified",
        observedValue: `offline=${offline};token=${hasToken}`,
        reason:
          "The released canonical row has contradictory offline and client-token evidence; immutable fields were retained without an exact offline-attribution claim.",
      });
    if (hasToken && (!creatorId || !scopeId || scopeId !== classId))
      add({
        entityType: "record",
        entityId: id,
        fieldName: "idempotency_scope_class_id",
        classification: "historical_offline_scope_unverified",
        observedValue: scopeId || "not_recorded",
        reason:
          "The released offline token lacks a complete actor and immutable initial-class scope; immutable fields were retained without an exact idempotency-scope claim.",
      });
    if (!hasToken && scopeId)
      add({
        entityType: "record",
        entityId: id,
        fieldName: "idempotency_scope_class_id",
        classification: "historical_offline_scope_unverified",
        observedValue: scopeId,
        reason:
          "The released online row unexpectedly retains an idempotency scope without a client token; immutable fields were retained without an exact idempotency-scope claim.",
      });
  }
  const affectedRuns = new Map<string, Set<string>>();
  const selectRuns = database.prepare(
    `SELECT DISTINCT ar.id FROM analysis_runs ar
     JOIN analysis_inputs ai ON ai.analysis_run_id=ar.id
     WHERE ar.dataset_classification='exact' AND ai.record_id=? ORDER BY ar.id`,
  );
  for (const recordId of [...unverifiedRecordIds].sort())
    for (const row of selectRuns.all(recordId) as Row[]) {
      const runId = valueText(row.id);
      const ids = affectedRuns.get(runId) ?? new Set<string>();
      ids.add(recordId);
      affectedRuns.set(runId, ids);
    }
  for (const [runId, recordIds] of affectedRuns) {
    classifications.push({
      entityType: "analysis_run",
      entityId: runId,
      fieldName: "dataset_classification",
      classification: "historical_input_attribution_unverified",
      observedValue: [...recordIds].sort().join("|"),
      reason:
        "Migration 010 downgraded this exact run because at least one sealed input record has historically unverifiable attribution or import origin.",
    });
  }
  return { classifications, unverifiedRecordIds };
}

function auditSchema9(database: DatabaseSync): AuditResult {
  auditDeleteGuardAbsence(database);
  auditForeignKeys(database);
  auditReleasedLedgerGuards(database);
  auditReleasedStorageImportGuards(database);
  auditClassificationLedger(database);
  const importedMarkers = auditStorageImports(database);
  return auditCanonicalAndLegacyRows(database, importedMarkers);
}

function addImportReference(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE legacy_import_batches (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL CHECK(source_kind='startup_json_snapshot'),
      source_user_count INTEGER NOT NULL CHECK(source_user_count>=0),
      source_record_count INTEGER NOT NULL CHECK(source_record_count>=0),
      opened_at TEXT NOT NULL,
      FOREIGN KEY(id) REFERENCES storage_imports(id) ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    ALTER TABLE experiment_records ADD COLUMN storage_import_id TEXT
      REFERENCES legacy_import_batches(id) ON DELETE RESTRICT;
    CREATE INDEX idx_experiment_records_storage_import
      ON experiment_records(storage_import_id);
  `);
}

function appendClassifications(
  database: DatabaseSync,
  classifications: Classification[],
  classifiedAt: string,
): void {
  const insert = database.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(10,?,?,?,?,?,?,?,?)`,
  );
  for (const row of classifications)
    insert.run(
      MIGRATION_NAME,
      row.entityType,
      row.entityId,
      row.fieldName,
      row.classification,
      row.observedValue,
      row.reason,
      classifiedAt,
    );
}

function downgradeAffectedRuns(database: DatabaseSync, recordIds: Set<string>): void {
  if (!recordIds.size) return;
  database.exec("DROP TRIGGER analysis_runs_dataset_classification_immutable");
  const update = database.prepare(
    `UPDATE analysis_runs SET dataset_classification='legacy_unverified'
     WHERE dataset_classification='exact' AND EXISTS(
       SELECT 1 FROM analysis_inputs ai WHERE ai.analysis_run_id=analysis_runs.id
         AND ai.record_id=?
     )`,
  );
  for (const id of recordIds) update.run(id);
  database.exec(`CREATE TRIGGER analysis_runs_dataset_classification_immutable
    BEFORE UPDATE OF dataset_classification ON analysis_runs
    WHEN NEW.dataset_classification IS NOT OLD.dataset_classification
    BEGIN SELECT RAISE(ABORT,'analysis dataset classification is immutable'); END`);
}

function installAuthorityAndDeletionGuards(database: DatabaseSync): void {
  database.exec(`
    CREATE TRIGGER experiment_records_010_no_delete
    BEFORE DELETE ON experiment_records BEGIN
      SELECT RAISE(ABORT,'scientific experiment provenance cannot be physically deleted');
    END;

    CREATE TRIGGER experiment_records_010_duplicate_guard
    BEFORE INSERT ON experiment_records
    WHEN EXISTS(SELECT 1 FROM experiment_records WHERE id=NEW.id)
    BEGIN
      SELECT RAISE(ABORT,'scientific record duplicate ID replacement is forbidden');
    END;

    CREATE TRIGGER experiment_records_010_offline_token_duplicate_guard
    BEFORE INSERT ON experiment_records
    WHEN NEW.client_submission_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM experiment_records existing
      WHERE existing.created_by_user_id=NEW.created_by_user_id
        AND existing.idempotency_scope_class_id=NEW.idempotency_scope_class_id
        AND existing.client_submission_id=NEW.client_submission_id
    )
    BEGIN
      SELECT RAISE(ABORT,'offline token duplicate replacement is forbidden');
    END;

    CREATE TRIGGER analysis_runs_010_no_delete
    BEFORE DELETE ON analysis_runs BEGIN
      SELECT RAISE(ABORT,'scientific analysis provenance cannot be physically deleted');
    END;

    CREATE TRIGGER analysis_runs_010_duplicate_guard
    BEFORE INSERT ON analysis_runs
    WHEN EXISTS(SELECT 1 FROM analysis_runs WHERE id=NEW.id)
    BEGIN
      SELECT RAISE(ABORT,'scientific analysis duplicate ID replacement is forbidden');
    END;

    CREATE TRIGGER experiment_records_010_canonical_authority
    BEFORE INSERT ON experiment_records
    WHEN NEW.submission_kind='canonical_submission' AND (
      NEW.storage_import_id IS NOT NULL
      OR NEW.created_by_user_id IS NULL
      OR NOT EXISTS(
        SELECT 1 FROM users u WHERE u.id=NEW.created_by_user_id
          AND NEW.created_by_label IN (u.username,u.name)
      )
      OR (NEW.synced_from_offline=1)<>(NEW.client_submission_id IS NOT NULL)
      OR (NEW.client_submission_id IS NULL AND NEW.idempotency_scope_class_id IS NOT NULL)
      OR (NEW.client_submission_id IS NOT NULL AND (
        NEW.created_by_user_id IS NULL OR NEW.idempotency_scope_class_id IS NULL
        OR NEW.idempotency_scope_class_id<>NEW.class_id
      ))
    ) BEGIN
      SELECT RAISE(ABORT,'canonical submission requires authoritative creator and offline scope');
    END;

    CREATE TRIGGER experiment_records_010_legacy_import_authority
    BEFORE INSERT ON experiment_records
    WHEN NEW.submission_kind='legacy_canonical_snapshot' AND (
      NEW.storage_import_id IS NULL
      OR NOT EXISTS(
        SELECT 1 FROM legacy_import_batches lib WHERE lib.id=NEW.storage_import_id
          AND NOT EXISTS(SELECT 1 FROM storage_imports si WHERE si.id=lib.id)
      )
      OR (SELECT COUNT(*) FROM experiment_records existing
          WHERE existing.storage_import_id=NEW.storage_import_id)>=(
            SELECT lib.source_record_count FROM legacy_import_batches lib
            WHERE lib.id=NEW.storage_import_id
          )
    ) BEGIN
      SELECT RAISE(ABORT,'legacy import requires a durable open import batch');
    END;

    CREATE TRIGGER legacy_import_batches_010_insert_guard
    BEFORE INSERT ON legacy_import_batches
    WHEN NEW.id<>'${STARTUP_IMPORT_ID}'
      OR EXISTS(SELECT 1 FROM users)
      OR EXISTS(SELECT 1 FROM experiment_records)
      OR EXISTS(SELECT 1 FROM storage_imports)
      OR NEW.source_kind<>'startup_json_snapshot'
      OR typeof(NEW.source_user_count)<>'integer' OR NEW.source_user_count<0
      OR typeof(NEW.source_record_count)<>'integer' OR NEW.source_record_count<0
      OR NOT (
      typeof(NEW.id)='text' AND length(CAST(NEW.id AS BLOB)) BETWEEN 1 AND 256
      AND length(CAST(NEW.id AS BLOB))=length(NEW.id) AND NEW.id NOT GLOB '*[^!-~]*'
    ) OR NOT ${canonicalTimestampSql("NEW.opened_at")} BEGIN
      SELECT RAISE(ABORT,'legacy import batch requires an empty database and no completed marker; identity, counts and timestamp must be valid');
    END;

    CREATE TRIGGER legacy_import_batches_010_duplicate_guard
    BEFORE INSERT ON legacy_import_batches
    WHEN EXISTS(SELECT 1 FROM legacy_import_batches WHERE id=NEW.id)
    BEGIN
      SELECT RAISE(ABORT,'legacy import batch duplicate ID replacement is forbidden');
    END;

    CREATE TRIGGER legacy_import_batches_010_no_update
    BEFORE UPDATE ON legacy_import_batches BEGIN
      SELECT RAISE(ABORT,'legacy import batch evidence is immutable');
    END;

    CREATE TRIGGER legacy_import_batches_010_no_delete
    BEFORE DELETE ON legacy_import_batches BEGIN
      SELECT RAISE(ABORT,'legacy import batch evidence is immutable');
    END;

    CREATE TRIGGER storage_imports_010_insert_guard
    BEFORE INSERT ON storage_imports
    WHEN NEW.id<>'${STARTUP_IMPORT_ID}' OR NOT (
      typeof(NEW.id)='text' AND length(CAST(NEW.id AS BLOB)) BETWEEN 1 AND 256
      AND length(CAST(NEW.id AS BLOB))=length(NEW.id) AND NEW.id NOT GLOB '*[^!-~]*'
    ) OR NEW.source_kind<>'startup_json_snapshot'
      OR typeof(NEW.source_user_count)<>'integer' OR NEW.source_user_count<0
      OR typeof(NEW.source_record_count)<>'integer' OR NEW.source_record_count<0
      OR typeof(NEW.target_user_count)<>'integer' OR NEW.target_user_count<0
      OR typeof(NEW.target_record_count)<>'integer' OR NEW.target_record_count<0
      OR NOT ${canonicalTimestampSql("NEW.completed_at")}
      OR NEW.disposition NOT IN ('imported','existing_sqlite_authoritative')
      OR (NEW.disposition='imported' AND (
        NEW.source_user_count<>NEW.target_user_count
        OR NEW.source_record_count<>NEW.target_record_count
      ))
      OR (NEW.disposition='existing_sqlite_authoritative' AND (
        NEW.source_user_count<>0 OR NEW.source_record_count<>0
        OR NEW.target_user_count+NEW.target_record_count<1
        OR NEW.target_user_count<>(SELECT COUNT(*) FROM users)
        OR NEW.target_record_count<>(SELECT COUNT(*) FROM experiment_records)
        OR EXISTS(SELECT 1 FROM legacy_import_batches WHERE id=NEW.id)
      ))
    BEGIN
      SELECT RAISE(ABORT,'storage import marker fields are invalid');
    END;

    CREATE TRIGGER storage_imports_010_duplicate_guard
    BEFORE INSERT ON storage_imports
    WHEN EXISTS(SELECT 1 FROM storage_imports WHERE id=NEW.id)
    BEGIN
      SELECT RAISE(ABORT,'storage import duplicate ID replacement is forbidden');
    END;

    CREATE TRIGGER storage_imports_010_no_update
    BEFORE UPDATE ON storage_imports BEGIN
      SELECT RAISE(ABORT,'storage import ledger is append-only');
    END;

    CREATE TRIGGER storage_imports_010_no_delete
    BEFORE DELETE ON storage_imports BEGIN
      SELECT RAISE(ABORT,'storage import ledger is append-only');
    END;

    CREATE TRIGGER storage_imports_010_completion_guard
    BEFORE INSERT ON storage_imports
    WHEN NEW.disposition='imported' AND NOT EXISTS(
      SELECT 1 FROM legacy_import_batches lib WHERE lib.id=NEW.id
        AND lib.source_kind=NEW.source_kind
        AND lib.source_user_count=NEW.source_user_count
        AND lib.source_record_count=NEW.source_record_count
        AND (SELECT COUNT(*) FROM experiment_records er
             WHERE er.storage_import_id=lib.id)=lib.source_record_count
        AND NEW.target_user_count=(SELECT COUNT(*) FROM users)
        AND NEW.target_record_count=(SELECT COUNT(*) FROM experiment_records)
        AND NEW.completed_at>=lib.opened_at
    ) BEGIN
      SELECT RAISE(ABORT,'storage import completion does not match its durable batch');
    END;

    CREATE TRIGGER experiment_records_010_origin_immutable
    BEFORE UPDATE OF id,submitted_json,submission_kind,created_by_user_id,created_by_label,
      client_submission_id,created_at,idempotency_scope_class_id,storage_import_id,
      synced_from_offline ON experiment_records
    WHEN NEW.id IS NOT OLD.id
      OR NEW.submitted_json IS NOT OLD.submitted_json
      OR NEW.submission_kind IS NOT OLD.submission_kind
      OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
      OR NEW.created_by_label IS NOT OLD.created_by_label
      OR NEW.client_submission_id IS NOT OLD.client_submission_id
      OR NEW.created_at IS NOT OLD.created_at
      OR NEW.idempotency_scope_class_id IS NOT OLD.idempotency_scope_class_id
      OR NEW.storage_import_id IS NOT OLD.storage_import_id
      OR NEW.synced_from_offline IS NOT OLD.synced_from_offline
    BEGIN
      SELECT RAISE(ABORT,'submission origin evidence is immutable');
    END;

    /* Future migrations must explicitly drop and reinstall this seal in their transaction. */
    CREATE TRIGGER provenance_boundary_classifications_010_insert_seal
    BEFORE INSERT ON provenance_boundary_classifications BEGIN
      SELECT RAISE(ABORT,'provenance classification ledger is migration-write-only');
    END;

    CREATE TRIGGER provenance_boundary_classifications_010_update_seal
    BEFORE UPDATE ON provenance_boundary_classifications BEGIN
      SELECT RAISE(ABORT,'provenance classification ledger is migration-write-only');
    END;

    CREATE TRIGGER provenance_boundary_classifications_010_delete_seal
    BEFORE DELETE ON provenance_boundary_classifications BEGIN
      SELECT RAISE(ABORT,'provenance classification ledger is migration-write-only');
    END;
  `);
}

export const canonicalAttributionAndLedgerAuthorityMigration: Migration = {
  version: 10,
  name: MIGRATION_NAME,
  preflight: auditSchema9,
  up(database, context) {
    if (!isStrictTimestamp(context.appliedAt))
      throw new Error("Migration 010 requires a canonical migration timestamp");
    // Re-run the read-only preflight to retain the classifications consumed by this migration.
    const audit = auditSchema9(database);
    addImportReference(database);
    appendClassifications(database, audit.classifications, context.appliedAt);
    downgradeAffectedRuns(database, audit.unverifiedRecordIds);
    installAuthorityAndDeletionGuards(database);
  },
};
