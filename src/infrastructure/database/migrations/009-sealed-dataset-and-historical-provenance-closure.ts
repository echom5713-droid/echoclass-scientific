import type { DatabaseSync } from "node:sqlite";
import {
  isStrictOffsetTimestamp,
  isStrictTimestamp,
  STRICT_OFFSET_TIMESTAMP_PATTERN,
} from "../../../shared/strict-timestamp.js";
import {
  isMachineIdentity,
  hasUnicodeNonBlankText,
  MAX_PROVENANCE_IDENTITY_LENGTH,
  UNICODE_BLANK_CODE_POINTS,
} from "../../../shared/provenance-contract.js";
import { parseJsonSafeObject } from "../../../shared/json-safe.js";
import {
  ANALYSIS_SNAPSHOT_LEGACY,
  ANALYSIS_SNAPSHOT_V1,
  validateRecordSnapshotV1Strict,
  validateReviewSnapshotV1Strict,
} from "../analysis-snapshot-v1.js";
import type { Migration } from "./types.js";

type Row = Record<string, unknown>;

interface Classification {
  entityType: string;
  entityId: string;
  fieldName: string;
  classification: string;
  observedValue: string;
  reason: string;
}

interface Downgrade {
  runId: string;
  ordinal: number;
  recordId: string;
  reason: string;
}

interface AuditResult {
  classifications: Classification[];
  downgrades: Downgrade[];
  runClassifications: Map<string, "legacy_incomplete" | "legacy_unverified">;
  migration8AppliedAt: string;
  previousClassifications: Row[];
}

const MIGRATION_NAME = "sealed_dataset_and_historical_provenance_closure";
function isVisibleAsciiIdentity(value: unknown): value is string {
  return isMachineIdentity(value);
}

function isUnicodeBlank(value: unknown): boolean {
  return !hasUnicodeNonBlankText(value);
}

/** Historical offset grammar accepted by 008, with real calendar and offset validation. */
function strictOffsetTimestampMillis(value: unknown): number | undefined {
  return isStrictOffsetTimestamp(value) ? Date.parse(value) : undefined;
}

function timestampMillis(value: unknown): number | undefined {
  if (isStrictTimestamp(value)) return Date.parse(value);
  return strictOffsetTimestampMillis(value);
}

function isJsonSafeObjectText(value: unknown): boolean {
  try {
    parseJsonSafeObject(value, "migration JSON object");
    return true;
  } catch {
    return false;
  }
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

function orderedTimestampSql(later: string, earlier: string, order: ">" | ">="): string {
  return `(CASE WHEN ${canonicalTimestampSql(earlier)}
    THEN ${later}${order}${earlier}
    ELSE COALESCE(julianday(${later})${order}julianday(${earlier}),0) END)`;
}

function invalidIdentitySql(expression: string): string {
  return `(typeof(${expression})<>'text'
    OR length(CAST(${expression} AS BLOB)) NOT BETWEEN 1 AND ${MAX_PROVENANCE_IDENTITY_LENGTH}
    OR length(CAST(${expression} AS BLOB))<>length(${expression})
    OR ${expression} GLOB '*[^!-~]*')`;
}

function unicodeBlankSql(expression: string): string {
  let stripped = expression;
  for (const codePoint of UNICODE_BLANK_CODE_POINTS)
    stripped = `replace(${stripped},char(${codePoint}),'')`;
  return `(typeof(${expression})<>'text'
    OR instr(CAST(${expression} AS BLOB),x'00')>0
    OR length(CAST(${stripped} AS BLOB))=0)`;
}

function projection(snapshot: Row): {
  effectiveReviewId: string | null;
  reviewStatus: string;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
} {
  return {
    effectiveReviewId:
      snapshot.effective_review_id === null || snapshot.effective_review_id === undefined
        ? null
        : String(snapshot.effective_review_id),
    reviewStatus: String(snapshot.review_status),
    reviewNote: String(snapshot.review_note),
    reviewedBy: String(snapshot.reviewed_by),
    reviewedAt: String(snapshot.reviewed_at),
  };
}

function projectionMatchesReview(snapshot: Row, review: Row): boolean {
  const value = projection(snapshot);
  return (
    value.effectiveReviewId === String(review.id) &&
    value.reviewStatus === String(review.decision) &&
    value.reviewNote === String(review.reason) &&
    value.reviewedBy === String(review.reviewer_label) &&
    value.reviewedAt === String(review.decided_at ?? "")
  );
}

function reviewSnapshotMatchesEvent(snapshot: Row, review: Row): boolean {
  return (
    String(snapshot.id) === String(review.id) &&
    String(snapshot.record_id) === String(review.record_id) &&
    (snapshot.reviewer_user_id ?? null) === (review.reviewer_user_id ?? null) &&
    String(snapshot.status) === String(review.decision) &&
    String(snapshot.note) === String(review.reason) &&
    String(snapshot.reviewed_by) === String(review.reviewer_label) &&
    String(snapshot.reviewed_at) === String(review.decided_at ?? "") &&
    String(snapshot.created_at) === String(review.created_at) &&
    String(snapshot.provenance_kind) === String(review.provenance_kind) &&
    Number(snapshot.event_sequence) === Number(review.event_sequence)
  );
}

function unversionedSubmissionDifferences(row: Row): string[] {
  if (row.submission_kind !== "canonical_submission") return [];
  let submitted: Row;
  try {
    const parsed: unknown = JSON.parse(String(row.submitted_json));
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
      const left = submitted[submittedField] ?? null;
      const right = row[rowField] ?? null;
      return left !== right;
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

function sameOptional(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

function currentVersionSnapshotDifferences(snapshot: Row, row: Row): string[] {
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
    ["reviewed_at", "reviewed_at"],
    ["reviewed_by", "reviewed_by"],
    ["ai_diagnosis", "ai_diagnosis"],
  ] as const;
  const differences: string[] = mappings
    .filter(([snapshotField, rowField]) => {
      const left = snapshot[snapshotField];
      let right = row[rowField];
      if (snapshotField === "reviewed_at" && right === null) right = "";
      return !sameOptional(left, right);
    })
    .map(([snapshotField]) => snapshotField);
  if (snapshot.异常标记 !== Boolean(row.anomaly_flag)) differences.push("异常标记");
  if (snapshot.synced_from_offline !== Boolean(row.synced_from_offline))
    differences.push("synced_from_offline");
  try {
    const durableMetadata = JSON.parse(String(row.metadata_json)) as Row;
    if (row.client_submission_id !== null) {
      durableMetadata.client_submission_id = String(row.client_submission_id);
      if (row.created_by_user_id !== null)
        durableMetadata.idempotency_actor_id = String(row.created_by_user_id);
      durableMetadata.idempotency_class_name = String(row.class_name_snapshot);
    }
    if (!jsonValuesEqual(snapshot.metadata, durableMetadata)) differences.push("metadata");
  } catch {
    differences.push("metadata");
  }
  return differences;
}

function auditSchema8(database: DatabaseSync): AuditResult {
  const errors: string[] = [];
  const classifications: Classification[] = [];
  const downgradeByInput = new Map<string, Downgrade>();
  const runClassifications = new Map<string, "legacy_incomplete" | "legacy_unverified">();
  const migration8 = database
    .prepare("SELECT applied_at FROM schema_migrations WHERE version=8")
    .get() as Row | undefined;
  if (!migration8 || !isStrictTimestamp(migration8.applied_at))
    errors.push("schema_migrations:8:applied_at");

  const addClassification = (classification: Classification): void => {
    classifications.push(classification);
  };
  const previouslyClassifiedOffsets = new Set(
    (
      database
        .prepare(
          `SELECT entity_type,entity_id,field_name FROM provenance_boundary_classifications
           WHERE classification='legacy_offset_timestamp'`,
        )
        .all() as Row[]
    ).map(
      (row) =>
        `${String(row.entity_type)}\u0000${String(row.entity_id)}\u0000${String(row.field_name)}`,
    ),
  );
  const classifyTimestamp = (
    entityType: string,
    entityId: string,
    fieldName: string,
    value: unknown,
    optional = false,
  ): void => {
    if (optional && (value === null || value === "")) return;
    if (isStrictTimestamp(value)) return;
    if (strictOffsetTimestampMillis(value) !== undefined) {
      const key = `${entityType}\u0000${entityId}\u0000${fieldName}`;
      if (!previouslyClassifiedOffsets.has(key))
        addClassification({
          entityType,
          entityId,
          fieldName,
          classification: "legacy_offset_timestamp",
          observedValue: String(value),
          reason:
            "Migration 009 classified a valid historical offset timestamp written after the Migration 008 classification pass.",
        });
      return;
    }
    if (typeof value === "string" && STRICT_OFFSET_TIMESTAMP_PATTERN.test(value)) {
      addClassification({
        entityType,
        entityId,
        fieldName,
        classification: "legacy_offset_timestamp_calendar_invalid_unverified",
        observedValue: value,
        reason:
          "The Migration 008 offset grammar accepted a calendar-invalid or out-of-range offset timestamp.",
      });
      return;
    }
    errors.push(`${entityType}:${entityId}:${fieldName}`);
  };
  const markRun = (
    runId: string,
    classification: "legacy_incomplete" | "legacy_unverified",
  ): void => {
    const current = runClassifications.get(runId);
    if (current !== "legacy_incomplete") runClassifications.set(runId, classification);
  };
  const downgrade = (value: Downgrade): void => {
    const key = `${value.runId}\u0000${value.ordinal}`;
    if (!downgradeByInput.has(key)) downgradeByInput.set(key, value);
    markRun(value.runId, "legacy_unverified");
  };

  const records = database.prepare("SELECT * FROM experiment_records").all() as Row[];
  const recordsById = new Map(records.map((row) => [String(row.id), row]));
  const recordsWithUnverifiedVersionTiming = new Set<string>();
  for (const row of records) {
    const id = String(row.id);
    for (const [field, value, optional] of [
      ["id", row.id, false],
      ["client_submission_id", row.client_submission_id, true],
      ["created_by_user_id", row.created_by_user_id, true],
      ["class_id", row.class_id, false],
      ["group_id", row.group_id, true],
      ["effective_review_id", row.effective_review_id, true],
    ] as const) {
      if ((!optional || value !== null) && !isVisibleAsciiIdentity(value))
        errors.push(`record:${id}:${field}`);
    }
    if (!isJsonSafeObjectText(row.metadata_json)) errors.push(`record:${id}:metadata_json`);
    classifyTimestamp("record", id, "created_at", row.created_at);
    classifyTimestamp("record", id, "updated_at", row.updated_at);
    const created = timestampMillis(row.created_at);
    const updated = timestampMillis(row.updated_at);
    if (created !== undefined && updated !== undefined) {
      if (updated < created) errors.push(`record:${id}:updated_at_chronology`);
      const differences = unversionedSubmissionDifferences(row);
      if (differences.length && updated === created) {
        recordsWithUnverifiedVersionTiming.add(id);
        addClassification({
          entityType: "record",
          entityId: id,
          fieldName: "updated_at",
          classification: "pre_v9_record_version_time_collision_unverified",
          observedValue: differences.join("|"),
          reason:
            "Schemas before version 9 permitted a provenance-bearing change to retain the record creation timestamp; operation order within that timestamp cannot be reconstructed.",
        });
      } else if (differences.length)
        addClassification({
          entityType: "record",
          entityId: id,
          fieldName: "updated_at",
          classification: "pre_v9_record_version_history_incomplete",
          observedValue: differences.join("|"),
          reason:
            "The record has a plausible advanced update timestamp, but schemas before version 9 did not retain a complete field-level version ledger.",
        });
    }
  }

  const runs = database.prepare("SELECT * FROM analysis_runs").all() as Row[];
  for (const row of runs) {
    const id = String(row.id);
    for (const [field, value, optional] of [
      ["id", row.id, false],
      ["dataset_hash", row.dataset_hash, false],
      ["algorithm_version", row.algorithm_version, false],
      ["code_version", row.code_version, false],
      ["created_by_user_id", row.created_by_user_id, true],
    ] as const) {
      if ((!optional || value !== null) && !isVisibleAsciiIdentity(value))
        errors.push(`run:${id}:${field}`);
    }
    if (!isJsonSafeObjectText(row.configuration_json)) errors.push(`run:${id}:configuration_json`);
    if (!isJsonSafeObjectText(row.results_metadata_json))
      errors.push(`run:${id}:results_metadata_json`);
    classifyTimestamp("run", id, "created_at", row.created_at);
    classifyTimestamp("run", id, "completed_at", row.completed_at, true);
  }

  const reviewRows = database
    .prepare(
      `SELECT rr.*,reo.event_sequence FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       ORDER BY rr.record_id,reo.event_sequence`,
    )
    .all() as Row[];
  const reviewsByRecord = new Map<string, Row[]>();
  const reviewsWithUnverifiedChronology = new Set<string>();
  const priorReviewBoundary = new Map<string, number>();
  for (const row of reviewRows) {
    const id = String(row.id);
    const recordId = String(row.record_id);
    for (const [field, value, optional] of [
      ["id", row.id, false],
      ["record_id", row.record_id, false],
      ["reviewer_user_id", row.reviewer_user_id, true],
    ] as const) {
      if ((!optional || value !== null) && !isVisibleAsciiIdentity(value))
        errors.push(`review:${id}:${field}`);
    }
    classifyTimestamp("review", id, "created_at", row.created_at);
    classifyTimestamp("review", id, "decided_at", row.decided_at, true);
    const created = timestampMillis(row.created_at);
    const decided = row.decided_at === null ? undefined : timestampMillis(row.decided_at);
    if (created === undefined || (row.decided_at !== null && decided === undefined))
      reviewsWithUnverifiedChronology.add(id);
    const recordCreated = timestampMillis(recordsById.get(recordId)?.created_at);
    if (created !== undefined && recordCreated !== undefined && created < recordCreated)
      errors.push(`review:${id}:record_chronology`);
    const prior = priorReviewBoundary.get(recordId);
    if (
      prior !== undefined &&
      ((created !== undefined && created < prior) || (decided !== undefined && decided < prior))
    ) {
      if (row.provenance_kind === "human") errors.push(`review:${id}:event_chronology`);
      else {
        reviewsWithUnverifiedChronology.add(id);
        addClassification({
          entityType: "review",
          entityId: id,
          fieldName: "event_sequence",
          classification: "legacy_review_sequence_chronology_unverified",
          observedValue: String(row.event_sequence),
          reason:
            "A later immutable legacy review sequence contains an event or decision time before prior review evidence.",
        });
      }
    }
    const knownTimes = [prior, created, decided].filter(
      (value): value is number => value !== undefined,
    );
    if (knownTimes.length) priorReviewBoundary.set(recordId, Math.max(...knownTimes));
    if (row.decided_at === null || row.decided_at === "") {
      if (row.provenance_kind === "human") errors.push(`review:${id}:decided_at`);
      else {
        reviewsWithUnverifiedChronology.add(id);
        addClassification({
          entityType: "review",
          entityId: id,
          fieldName: "decided_at",
          classification: "legacy_review_decision_time_missing_unverified",
          observedValue: "missing",
          reason:
            "The released legacy projection has no durable decision timestamp; immutable values were retained but are not claimed to satisfy v1 chronology.",
        });
      }
    } else if (decided !== undefined && created !== undefined && decided < created) {
      if (row.provenance_kind === "human") errors.push(`review:${id}:decided_at`);
      else {
        reviewsWithUnverifiedChronology.add(id);
        addClassification({
          entityType: "review",
          entityId: id,
          fieldName: "decided_at",
          classification: "legacy_review_chronology_unverified",
          observedValue: String(row.decided_at),
          reason:
            "The released legacy projection recorded migration capture as event creation after the preserved historical decision time; immutable values were retained but are not claimed to satisfy v1 chronology.",
        });
      }
    }
    if (row.provenance_kind === "human") {
      if (row.reviewer_user_id === null || !row.decided_at)
        errors.push(`review:${id}:human_event_evidence`);
      addClassification({
        entityType: "review",
        entityId: id,
        fieldName: "historical_reviewer_authorization",
        classification: "historical_account_state_not_snapshotted",
        observedValue: String(row.reviewer_user_id ?? "unresolved"),
        reason:
          "The immutable event retains reviewer ownership and label, but schemas through version 8 did not snapshot the account role, status or names at event time.",
      });
    }
    const existing = reviewsByRecord.get(recordId) ?? [];
    existing.push(row);
    reviewsByRecord.set(recordId, existing);
  }

  const aggregates = database
    .prepare(
      `SELECT ar.id,ar.inputs_sealed,COUNT(ai.ordinal) input_count,
        MIN(ai.ordinal) min_ordinal,MAX(ai.ordinal) max_ordinal,
        COUNT(DISTINCT ai.ordinal) distinct_count,
        COUNT(DISTINCT ai.record_id) distinct_record_count
       FROM analysis_runs ar LEFT JOIN analysis_inputs ai ON ai.analysis_run_id=ar.id
       GROUP BY ar.id`,
    )
    .all() as Row[];
  for (const row of aggregates) {
    const runId = String(row.id);
    const count = Number(row.input_count);
    const complete =
      count >= 1 &&
      Number(row.min_ordinal) === 0 &&
      Number(row.max_ordinal) === count - 1 &&
      Number(row.distinct_count) === count &&
      Number(row.distinct_record_count) === count;
    if (Number(row.inputs_sealed) === 1 && !complete) {
      markRun(runId, "legacy_incomplete");
      addClassification({
        entityType: "analysis_run",
        entityId: runId,
        fieldName: "sealed_input_set",
        classification: "legacy_incomplete_sealed_dataset",
        observedValue: `count=${count};min=${String(row.min_ordinal)};max=${String(row.max_ordinal)};distinct_ordinals=${String(row.distinct_count)};distinct_records=${String(row.distinct_record_count)}`,
        reason:
          "The historical sealed input set was empty, non-contiguous or repeated a selected record.",
      });
    }
  }

  const inputRows = database
    .prepare(
      `SELECT ai.*,ar.created_at run_created_at FROM analysis_inputs ai
       JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
       ORDER BY ai.analysis_run_id,ai.ordinal`,
    )
    .all() as Row[];
  const versionSnapshots = new Map<string, Row>();
  const classifiedVersionCollisions = new Set<string>();
  const classifyVersionCollision = (recordId: string, observedValue: string): void => {
    recordsWithUnverifiedVersionTiming.add(recordId);
    if (classifiedVersionCollisions.has(recordId)) return;
    classifiedVersionCollisions.add(recordId);
    addClassification({
      entityType: "record",
      entityId: recordId,
      fieldName: "updated_at",
      classification: "pre_v9_record_version_time_collision_unverified",
      observedValue,
      reason:
        "Two provenance-bearing record versions share one timestamp, so their ordering cannot be reconstructed.",
    });
  };
  for (const row of inputRows) {
    if (row.snapshot_schema !== ANALYSIS_SNAPSHOT_V1) continue;
    const recordId = String(row.record_id);
    try {
      const snapshot = validateRecordSnapshotV1Strict(
        row.record_snapshot_json,
        recordId,
      ) as unknown as Row;
      const version = String(snapshot.updated_at);
      const key = `${recordId}\u0000${version}`;
      const prior = versionSnapshots.get(key);
      if (prior && !jsonValuesEqual(prior, snapshot)) classifyVersionCollision(recordId, version);
      else if (!prior) versionSnapshots.set(key, snapshot);
      const durable = recordsById.get(recordId);
      if (
        durable &&
        String(durable.updated_at) === version &&
        currentVersionSnapshotDifferences(snapshot, durable).length
      )
        classifyVersionCollision(recordId, version);
    } catch {
      // The ordinary per-input audit below owns malformed snapshot classification.
    }
  }
  for (const row of inputRows) {
    const runId = String(row.analysis_run_id);
    const ordinal = Number(row.ordinal);
    const recordId = String(row.record_id);
    const label = `${runId}:${ordinal}`;
    for (const [field, value, optional] of [
      ["analysis_run_id", row.analysis_run_id, false],
      ["record_id", row.record_id, false],
      ["review_id", row.review_id, true],
      ["input_hash", row.input_hash, false],
    ] as const) {
      if ((!optional || value !== null) && !isVisibleAsciiIdentity(value))
        errors.push(`input:${label}:${field}`);
    }
    if (
      row.review_binding_mode === "omit" &&
      (typeof row.review_omission_reason !== "string" || isUnicodeBlank(row.review_omission_reason))
    ) {
      addClassification({
        entityType: "analysis_input",
        entityId: `${runId}#${ordinal}`,
        fieldName: "review_omission_reason",
        classification: "legacy_blank_review_omission_reason",
        observedValue: "blank_or_non_text",
        reason: "The historical omission reason does not contain Unicode non-blank text.",
      });
      if (row.snapshot_schema === ANALYSIS_SNAPSHOT_V1)
        downgrade({
          runId,
          ordinal,
          recordId,
          reason: "The historical v1 input has no defensible non-blank omission reason.",
        });
      else markRun(runId, "legacy_unverified");
    }
    if (row.snapshot_schema !== ANALYSIS_SNAPSHOT_V1) {
      markRun(runId, "legacy_unverified");
      continue;
    }
    try {
      const snapshot = validateRecordSnapshotV1Strict(
        row.record_snapshot_json,
        recordId,
      ) as unknown as Row;
      if (recordsWithUnverifiedVersionTiming.has(recordId)) {
        downgrade({
          runId,
          ordinal,
          recordId,
          reason:
            "The selected record has a pre-version-9 provenance change whose version timestamp did not advance.",
        });
        continue;
      }
      const durable = recordsById.get(recordId);
      if (durable && snapshot.updated_at === durable.updated_at) {
        const versionDifferences = currentVersionSnapshotDifferences(snapshot, durable);
        if (versionDifferences.length) {
          downgrade({
            runId,
            ordinal,
            recordId,
            reason: `The snapshot and durable record disagree at the same updated_at for fields: ${versionDifferences.join("|")}.`,
          });
          continue;
        }
      }
      const runTime = timestampMillis(row.run_created_at);
      const durableUpdatedAt = timestampMillis(durable?.updated_at);
      if (
        snapshot.status === "deleted" ||
        (durable?.status === "deleted" &&
          durableUpdatedAt !== undefined &&
          runTime !== undefined &&
          durableUpdatedAt < runTime)
      ) {
        downgrade({
          runId,
          ordinal,
          recordId,
          reason:
            "The snapshot or durable lifecycle timing shows that the record was already deleted at selection time.",
        });
        continue;
      }
      const historicalReviews = reviewsByRecord.get(recordId) ?? [];
      if (
        historicalReviews.some((review) => reviewsWithUnverifiedChronology.has(String(review.id)))
      )
        throw new Error("review chronology is not fully verifiable");
      const effectiveAtRun =
        runTime === undefined
          ? undefined
          : [...historicalReviews]
              .filter((review) => {
                const created = timestampMillis(review.created_at);
                return created !== undefined && created <= runTime;
              })
              .sort((left, right) => Number(right.event_sequence) - Number(left.event_sequence))[0];
      const mode = String(row.review_binding_mode);
      if (runTime === undefined) throw new Error("selection timestamp is unverified");
      if (mode === "effective") {
        if (
          !effectiveAtRun ||
          row.review_id !== effectiveAtRun.id ||
          row.review_omission_reason !== null
        )
          throw new Error();
        if (reviewsWithUnverifiedChronology.has(String(effectiveAtRun.id))) throw new Error();
        const review = validateReviewSnapshotV1Strict(
          row.review_snapshot_json,
          String(effectiveAtRun.id),
          recordId,
        ) as unknown as Row;
        if (
          !reviewSnapshotMatchesEvent(review, effectiveAtRun) ||
          !projectionMatchesReview(snapshot, effectiveAtRun)
        )
          throw new Error();
      } else if (mode === "omit") {
        if (
          !effectiveAtRun ||
          reviewsWithUnverifiedChronology.has(String(effectiveAtRun.id)) ||
          row.review_id !== null ||
          row.review_snapshot_json !== null ||
          typeof row.review_omission_reason !== "string" ||
          isUnicodeBlank(row.review_omission_reason) ||
          !projectionMatchesReview(snapshot, effectiveAtRun)
        )
          throw new Error();
      } else if (mode === "none") {
        const value = projection(snapshot);
        if (
          effectiveAtRun ||
          row.review_id !== null ||
          row.review_snapshot_json !== null ||
          row.review_omission_reason !== null ||
          value.effectiveReviewId !== null ||
          !["normal", "review"].includes(value.reviewStatus) ||
          value.reviewNote !== "" ||
          value.reviewedBy !== "" ||
          value.reviewedAt !== ""
        )
          throw new Error();
        if (historicalReviews.length === 0) {
          const durable = recordsById.get(recordId);
          if (
            !durable ||
            value.effectiveReviewId !== (durable.effective_review_id ?? null) ||
            value.reviewStatus !== String(durable.review_status) ||
            value.reviewNote !== String(durable.review_note) ||
            value.reviewedBy !== String(durable.reviewed_by) ||
            value.reviewedAt !== String(durable.reviewed_at ?? "")
          )
            throw new Error();
        }
      } else throw new Error();
    } catch {
      downgrade({
        runId,
        ordinal,
        recordId,
        reason:
          "The historical v1 input cannot prove its exact review projection at selection time.",
      });
    }
  }

  for (const value of downgradeByInput.values())
    addClassification({
      entityType: "analysis_input",
      entityId: `${value.runId}#${value.ordinal}`,
      fieldName: "snapshot_schema",
      classification: "legacy_unverified_analysis_input",
      observedValue: `${value.runId}:${value.ordinal}:${value.recordId}`,
      reason: value.reason,
    });

  const previousClassifications = database
    .prepare(
      "SELECT * FROM provenance_boundary_classifications ORDER BY entity_type,entity_id,field_name",
    )
    .all() as Row[];
  for (const row of previousClassifications) {
    if (row.classification !== "legacy_offset_timestamp") continue;
    const observed = String(row.observed_value);
    if (strictOffsetTimestampMillis(observed) === undefined)
      addClassification({
        entityType: String(row.entity_type),
        entityId: String(row.entity_id),
        fieldName: String(row.field_name),
        classification: "legacy_offset_timestamp_calendar_invalid_unverified",
        observedValue: observed,
        reason:
          "Migration 009 found that the Migration 008 offset value is not a real Gregorian timestamp with a supported offset.",
      });
  }

  if (errors.length)
    throw new Error(
      `Migration 009 definite provenance corruption: ${[...new Set(errors)].join(", ")}`,
    );
  return {
    classifications,
    downgrades: [...downgradeByInput.values()],
    runClassifications,
    migration8AppliedAt: String(migration8!.applied_at),
    previousClassifications,
  };
}

function rebuildClassificationLedger(
  database: DatabaseSync,
  audit: AuditResult,
  classifiedAt: string,
): void {
  database.exec(`
    ALTER TABLE provenance_boundary_classifications
      RENAME TO provenance_boundary_classifications_v8;
    CREATE TABLE provenance_boundary_classifications (
      classification_id INTEGER PRIMARY KEY CHECK(classification_id>0),
      classification_migration_version INTEGER NOT NULL,
      classification_migration_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      classification TEXT NOT NULL,
      observed_value TEXT NOT NULL,
      reason TEXT NOT NULL,
      classified_at TEXT NOT NULL,
      UNIQUE(
        classification_migration_version,entity_type,entity_id,field_name,classification
      )
    ) STRICT;
  `);
  const insert = database.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`,
  );
  for (const row of audit.previousClassifications)
    insert.run(
      8,
      "analysis_input_sealing_and_provenance_boundary",
      String(row.entity_type),
      String(row.entity_id),
      String(row.field_name),
      String(row.classification),
      String(row.observed_value),
      "Preserved Migration 008 classification; its table was mutable before Migration 009 sealed the ledger.",
      audit.migration8AppliedAt,
    );
  const seen = new Set<string>();
  for (const row of audit.classifications) {
    const key = [row.entityType, row.entityId, row.fieldName, row.classification].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    insert.run(
      9,
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
  database.exec(`
    DROP TABLE provenance_boundary_classifications_v8;
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
    BEGIN SELECT RAISE(ABORT,'provenance classification ledger rejects replacement'); END;
    CREATE TRIGGER provenance_boundary_classifications_no_update
    BEFORE UPDATE ON provenance_boundary_classifications
    BEGIN SELECT RAISE(ABORT,'provenance classification ledger is append-only'); END;
    CREATE TRIGGER provenance_boundary_classifications_no_delete
    BEFORE DELETE ON provenance_boundary_classifications
    BEGIN SELECT RAISE(ABORT,'provenance classification ledger is append-only'); END;
  `);
}

function applyHistoricalClassifications(database: DatabaseSync, audit: AuditResult): void {
  database.exec(`
    ALTER TABLE analysis_runs ADD COLUMN dataset_classification TEXT NOT NULL DEFAULT 'exact'
      CHECK(dataset_classification IN ('exact','legacy_incomplete','legacy_unverified'));
    ALTER TABLE record_reviews ADD COLUMN projection_updated_at TEXT;
    DROP TRIGGER analysis_inputs_no_update;
    DROP TRIGGER analysis_inputs_no_delete;
  `);
  const classifyRun = database.prepare(
    "UPDATE analysis_runs SET dataset_classification=? WHERE id=?",
  );
  for (const [runId, classification] of audit.runClassifications)
    classifyRun.run(classification, runId);
  const downgrade = database.prepare(
    `UPDATE analysis_inputs SET snapshot_schema=?,review_binding_mode='legacy_unspecified'
     WHERE analysis_run_id=? AND ordinal=?`,
  );
  for (const row of audit.downgrades)
    downgrade.run(ANALYSIS_SNAPSHOT_LEGACY, row.runId, row.ordinal);
  database.exec(`
    CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
    CREATE TRIGGER analysis_inputs_no_delete BEFORE DELETE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
  `);
}

function installRunAndInputBoundaries(database: DatabaseSync): void {
  const count = "(SELECT COUNT(*) FROM analysis_inputs ai WHERE ai.analysis_run_id=NEW.id)";
  const minimum =
    "(SELECT MIN(ai.ordinal) FROM analysis_inputs ai WHERE ai.analysis_run_id=NEW.id)";
  const maximum =
    "(SELECT MAX(ai.ordinal) FROM analysis_inputs ai WHERE ai.analysis_run_id=NEW.id)";
  const distinct =
    "(SELECT COUNT(DISTINCT ai.ordinal) FROM analysis_inputs ai WHERE ai.analysis_run_id=NEW.id)";
  const distinctRecords =
    "(SELECT COUNT(DISTINCT ai.record_id) FROM analysis_inputs ai WHERE ai.analysis_run_id=NEW.id)";
  const snapshot = "NEW.record_snapshot_json";
  const j = (field: string): string => `json_extract(${snapshot},'$.${field}')`;
  database.exec(`
    DROP TRIGGER analysis_runs_seal_guard;
    CREATE TRIGGER analysis_runs_009_insert_identity BEFORE INSERT ON analysis_runs
    WHEN ${invalidIdentitySql("NEW.id")}
      OR ${invalidIdentitySql("NEW.dataset_hash")}
      OR ${invalidIdentitySql("NEW.algorithm_version")}
      OR ${invalidIdentitySql("NEW.code_version")}
      OR (NEW.created_by_user_id IS NOT NULL AND ${invalidIdentitySql("NEW.created_by_user_id")})
    BEGIN SELECT RAISE(ABORT,'analysis run visible-ASCII identity contract violation'); END;

    CREATE TRIGGER analysis_runs_009_insert_timestamp BEFORE INSERT ON analysis_runs
    WHEN NOT ${canonicalTimestampSql("NEW.created_at")} OR NEW.completed_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'new analysis runs require a canonical creation timestamp'); END;

    CREATE TRIGGER analysis_runs_009_terminal_timestamp
    BEFORE UPDATE OF status,completed_at ON analysis_runs
    WHEN NEW.status IN ('completed','failed') AND (
      NEW.completed_at IS NULL OR NOT ${canonicalTimestampSql("NEW.completed_at")}
      OR NOT ${orderedTimestampSql("NEW.completed_at", "NEW.created_at", ">=")}
    )
    BEGIN SELECT RAISE(ABORT,'analysis terminal state requires a canonical completion timestamp'); END;

    CREATE TRIGGER analysis_runs_009_seal_guard BEFORE UPDATE OF inputs_sealed ON analysis_runs
    WHEN NOT (
      OLD.inputs_sealed=0 AND NEW.inputs_sealed=1 AND OLD.status='pending'
      AND NEW.dataset_classification='exact'
      AND ${count}>=1 AND ${minimum}=0 AND ${maximum}=${count}-1
      AND ${distinct}=${count} AND ${distinctRecords}=${count}
    )
    BEGIN SELECT RAISE(ROLLBACK,'analysis input seal requires a complete non-empty ordinal set'); END;

    CREATE TRIGGER analysis_runs_009_terminal_completeness BEFORE UPDATE OF status ON analysis_runs
    WHEN NEW.status IS NOT OLD.status AND NEW.status IN ('running','completed','failed') AND (
      OLD.inputs_sealed<>1 OR OLD.dataset_classification<>'exact'
      OR ${count}<1 OR ${minimum}<>0 OR ${maximum}<>${count}-1
      OR ${distinct}<>${count} OR ${distinctRecords}<>${count}
    )
    BEGIN SELECT RAISE(ABORT,'analysis terminal transition requires a complete sealed dataset'); END;

    CREATE TRIGGER analysis_runs_dataset_classification_immutable
    BEFORE UPDATE OF dataset_classification ON analysis_runs
    WHEN NEW.dataset_classification IS NOT OLD.dataset_classification
    BEGIN SELECT RAISE(ABORT,'analysis dataset classification is immutable'); END;

    CREATE TRIGGER analysis_inputs_009_boundary BEFORE INSERT ON analysis_inputs
    WHEN ${invalidIdentitySql("NEW.analysis_run_id")}
      OR ${invalidIdentitySql("NEW.record_id")}
      OR (NEW.review_id IS NOT NULL AND ${invalidIdentitySql("NEW.review_id")})
      OR ${invalidIdentitySql("NEW.input_hash")}
      OR ${j("status")}<>'active'
      OR EXISTS(
        SELECT 1 FROM provenance_boundary_classifications pbc
        JOIN record_reviews rr ON rr.id=pbc.entity_id
        WHERE pbc.entity_type='review' AND rr.record_id=NEW.record_id
          AND pbc.classification LIKE '%unverified'
      )
      OR EXISTS(
        SELECT 1 FROM provenance_boundary_classifications pbc
        WHERE pbc.entity_type='record' AND pbc.entity_id=NEW.record_id
          AND pbc.classification LIKE '%unverified'
      )
      OR (NEW.review_binding_mode='omit' AND ${unicodeBlankSql("NEW.review_omission_reason")})
      OR (NEW.review_binding_mode IN ('effective','omit') AND NOT EXISTS(
        SELECT 1 FROM experiment_records er
        JOIN record_reviews rr ON rr.id=er.effective_review_id
        WHERE er.id=NEW.record_id
          AND ${canonicalTimestampSql("rr.created_at")}
          AND rr.decided_at IS NOT NULL AND ${canonicalTimestampSql("rr.decided_at")}
          AND rr.decided_at>=rr.created_at
      ))
      OR (NEW.review_binding_mode='none' AND NOT EXISTS(
        SELECT 1 FROM experiment_records er WHERE er.id=NEW.record_id
          AND er.effective_review_id IS NULL
          AND ${j("effective_review_id")} IS NULL
          AND ${j("review_status")} IS er.review_status
          AND ${j("review_note")} IS er.review_note
          AND ${j("reviewed_by")} IS er.reviewed_by
          AND ${j("reviewed_at")} IS COALESCE(er.reviewed_at,'')
      ))
    BEGIN SELECT RAISE(ABORT,'analysis input 009 projection or identity boundary violation'); END;
  `);
}

function installRecordBoundary(database: DatabaseSync): void {
  const provenanceFields = [
    "student_name",
    "class_id",
    "class_name_snapshot",
    "group_id",
    "group_name_snapshot",
    "experiment_type",
    "status",
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
    "anomaly_flag",
    "error_source",
    "note",
    "yield_percent",
    "experiment_date",
    "petri_diameter_mm",
    "measurement_method",
    "metadata_json",
    "ai_diagnosis",
    "effective_review_id",
    "review_status",
    "review_note",
    "reviewed_at",
    "reviewed_by",
    "synced_from_offline",
  ];
  const changed = provenanceFields.map((field) => `NEW.${field} IS NOT OLD.${field}`).join(" OR ");
  database.exec(`
    CREATE TRIGGER experiment_records_009_insert_identity BEFORE INSERT ON experiment_records
    WHEN ${invalidIdentitySql("NEW.id")}
      OR (NEW.client_submission_id IS NOT NULL AND ${invalidIdentitySql("NEW.client_submission_id")})
      OR (NEW.created_by_user_id IS NOT NULL AND ${invalidIdentitySql("NEW.created_by_user_id")})
      OR ${invalidIdentitySql("NEW.class_id")}
      OR (NEW.group_id IS NOT NULL AND ${invalidIdentitySql("NEW.group_id")})
      OR (NEW.effective_review_id IS NOT NULL AND ${invalidIdentitySql("NEW.effective_review_id")})
    BEGIN SELECT RAISE(ABORT,'experiment visible-ASCII identity contract violation'); END;

    CREATE TRIGGER experiment_records_009_update_identity
    BEFORE UPDATE OF class_id,group_id,effective_review_id ON experiment_records
    WHEN ${invalidIdentitySql("NEW.class_id")}
      OR (NEW.group_id IS NOT NULL AND ${invalidIdentitySql("NEW.group_id")})
      OR (NEW.effective_review_id IS NOT NULL AND ${invalidIdentitySql("NEW.effective_review_id")})
    BEGIN SELECT RAISE(ABORT,'experiment update visible-ASCII identity contract violation'); END;

    CREATE TRIGGER experiment_records_009_version_time
    BEFORE UPDATE OF ${[...provenanceFields, "updated_at"].join(",")} ON experiment_records
    WHEN (NEW.updated_at IS NOT OLD.updated_at OR ${changed}) AND (
      NOT ${canonicalTimestampSql("NEW.updated_at")}
      OR NOT ${orderedTimestampSql("NEW.updated_at", "OLD.updated_at", ">")}
    )
    BEGIN SELECT RAISE(ABORT,'provenance-bearing record changes require a strictly advanced updated_at'); END;
  `);
}

function installReviewBoundary(database: DatabaseSync): void {
  const created = canonicalTimestampSql("NEW.created_at");
  const decided = canonicalTimestampSql("NEW.decided_at");
  const projectionUpdated = canonicalTimestampSql("NEW.projection_updated_at");
  database.exec(`
    DROP TRIGGER record_reviews_008_insert_guard;
    DROP TRIGGER record_reviews_project_after_insert;

    CREATE TRIGGER record_reviews_009_insert_guard BEFORE INSERT ON record_reviews
    WHEN ${invalidIdentitySql("NEW.id")}
      OR ${invalidIdentitySql("NEW.record_id")}
      OR (NEW.reviewer_user_id IS NOT NULL AND ${invalidIdentitySql("NEW.reviewer_user_id")})
      OR NOT ${created}
      OR NEW.decided_at IS NULL OR NOT ${decided}
      OR NOT ${projectionUpdated}
      OR NEW.decided_at<NEW.created_at
      OR NEW.projection_updated_at<NEW.created_at
      OR NEW.projection_updated_at<NEW.decided_at
      OR NOT EXISTS(
        SELECT 1 FROM experiment_records er WHERE er.id=NEW.record_id
          AND ${orderedTimestampSql("NEW.created_at", "er.created_at", ">=")}
          AND ${orderedTimestampSql("NEW.projection_updated_at", "er.updated_at", ">")}
      )
      OR EXISTS(
        SELECT 1 FROM record_reviews prior WHERE prior.record_id=NEW.record_id
          AND (
            NOT ${orderedTimestampSql("NEW.created_at", "prior.created_at", ">=")}
            OR NOT ${orderedTimestampSql("NEW.decided_at", "prior.created_at", ">=")}
            OR (prior.decided_at IS NOT NULL AND (
              NOT ${orderedTimestampSql("NEW.created_at", "prior.decided_at", ">=")}
              OR NOT ${orderedTimestampSql("NEW.decided_at", "prior.decided_at", ">=")}
            ))
          )
      )
      OR EXISTS(
        SELECT 1 FROM provenance_boundary_classifications pbc
        JOIN record_reviews prior ON prior.id=pbc.entity_id
        WHERE pbc.entity_type='review' AND prior.record_id=NEW.record_id
          AND pbc.classification LIKE '%unverified'
      )
      OR EXISTS(
        SELECT 1 FROM provenance_boundary_classifications pbc
        WHERE pbc.entity_type='record' AND pbc.entity_id=NEW.record_id
          AND pbc.classification LIKE '%unverified'
      )
      OR (NEW.provenance_kind='human' AND (
        NEW.reviewer_user_id IS NULL OR ${unicodeBlankSql("NEW.reviewer_label")}
        OR NEW.decision NOT IN ('review','included','excluded')
        OR NEW.decided_at IS NULL
        OR NOT EXISTS(
          SELECT 1 FROM users u WHERE u.id=NEW.reviewer_user_id
            AND NEW.reviewer_label IN (u.username,u.name)
            AND u.role IN ('teacher','admin') AND u.status IN ('active','demo')
        )
      ))
    BEGIN SELECT RAISE(ABORT,'record review 009 chronology, identity or projection-time violation'); END;

    CREATE TRIGGER record_reviews_project_after_insert AFTER INSERT ON record_reviews
    BEGIN
      INSERT INTO review_event_order(review_id) VALUES(NEW.id);
      UPDATE experiment_records SET
        effective_review_id=NEW.id,
        review_status=NEW.decision,
        review_note=NEW.reason,
        reviewed_at=NEW.decided_at,
        reviewed_by=NEW.reviewer_label,
        updated_at=NEW.projection_updated_at
      WHERE id=NEW.record_id;
    END;
  `);
}

export const sealedDatasetAndHistoricalProvenanceClosureMigration: Migration = {
  version: 9,
  name: MIGRATION_NAME,
  up(database, context) {
    if (!isStrictTimestamp(context.appliedAt))
      throw new Error("Migration 009 requires a canonical classification timestamp");
    const audit = auditSchema8(database);
    applyHistoricalClassifications(database, audit);
    rebuildClassificationLedger(database, audit, context.appliedAt);
    installRunAndInputBoundaries(database);
    installRecordBoundary(database);
    installReviewBoundary(database);
  },
};
