import { validateExperiment } from "../../domain/experiments/validation.js";
import type { ExperimentRecord, RecordReview } from "../../domain/types.js";
import { assertJsonSafeObject, JsonSafeError } from "../../shared/json-safe.js";
import { machineIdentity } from "../../shared/provenance-contract.js";
import { isStrictTimestamp } from "../../shared/strict-timestamp.js";
import { hasNonblankText } from "../../shared/nonblank-text.js";

export const ANALYSIS_SNAPSHOT_V1 = "echoclass.analysis-input.v1" as const;
export const ANALYSIS_SNAPSHOT_LEGACY = "echoclass.analysis-input.legacy" as const;

export class SnapshotContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotContractError";
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new SnapshotContractError(`${label} is not valid JSON`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new SnapshotContractError(`${label} must be an object`);
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new SnapshotContractError(`${field} must be a non-empty string`);
  return value;
}

function requiredIdentity(value: unknown, field: string): string {
  try {
    return machineIdentity(value, field);
  } catch {
    throw new SnapshotContractError(`${field} must be a visible-ASCII machine identifier`);
  }
}

function optionalIdentity(value: unknown, field: string): void {
  if (value !== undefined) requiredIdentity(value, field);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new SnapshotContractError(`${field} must be a finite number`);
  return value;
}

export function validateRecordSnapshotV1(
  value: unknown,
  expectedRecordId?: string,
): ExperimentRecord {
  const snapshot = object(value, "record snapshot");
  const id = requiredString(snapshot.id, "record snapshot id");
  if (expectedRecordId && id !== expectedRecordId)
    throw new SnapshotContractError("record snapshot id does not match input record_id");
  for (const field of [
    "student_name",
    "class_name",
    "emulsification_level",
    "ecoli_observation_group",
    "created_at",
    "created_by",
  ])
    requiredString(snapshot[field], `record snapshot ${field}`);
  for (const field of [
    "group_name",
    "error_source",
    "note",
    "review_note",
    "reviewed_by",
    "reviewed_at",
    "ai_diagnosis",
  ]) {
    if (typeof snapshot[field] !== "string")
      throw new SnapshotContractError(`record snapshot ${field} must be a string`);
  }
  for (const field of [
    "nh4cl_concentration",
    "peel_mass",
    "oil_mass",
    "distillation_time",
    "phase_clarity_score",
    "emulsion_concentration",
    "inhibition_zone_diameter",
    "colony_growth_score",
    "yield_percent",
  ])
    finite(snapshot[field], `record snapshot ${field}`);
  if (typeof snapshot.异常标记 !== "boolean")
    throw new SnapshotContractError("record snapshot anomaly flag must be boolean");
  if (snapshot.status !== "active" && snapshot.status !== "deleted")
    throw new SnapshotContractError("record snapshot status is invalid");
  if (typeof snapshot.updated_at !== "string" || !snapshot.updated_at.trim())
    throw new SnapshotContractError("record snapshot updated_at is invalid");
  if (!isStrictTimestamp(snapshot.created_at) || !isStrictTimestamp(snapshot.updated_at))
    throw new SnapshotContractError("record snapshot lifecycle timestamps are invalid");
  if (Date.parse(snapshot.updated_at) < Date.parse(snapshot.created_at))
    throw new SnapshotContractError("record snapshot updated_at predates created_at");
  if (!["normal", "review", "included", "excluded"].includes(String(snapshot.review_status)))
    throw new SnapshotContractError("record snapshot review_status is invalid");
  if (snapshot.reviewed_at && !isStrictTimestamp(snapshot.reviewed_at))
    throw new SnapshotContractError("record snapshot reviewed_at is invalid");
  if (
    snapshot.effective_review_id !== undefined &&
    (typeof snapshot.effective_review_id !== "string" || !snapshot.effective_review_id.trim())
  )
    throw new SnapshotContractError("record snapshot effective_review_id is invalid");
  if (
    snapshot.created_by_user_id !== undefined &&
    (typeof snapshot.created_by_user_id !== "string" || !snapshot.created_by_user_id.trim())
  )
    throw new SnapshotContractError("record snapshot creator identifier is invalid");
  if (
    snapshot.client_submission_id !== undefined &&
    (typeof snapshot.client_submission_id !== "string" || !snapshot.client_submission_id.trim())
  )
    throw new SnapshotContractError("record snapshot client submission identifier is invalid");
  if (typeof snapshot.synced_from_offline !== "boolean")
    throw new SnapshotContractError("record snapshot synced_from_offline must be boolean");
  if (
    ![
      "not_recorded",
      "not_recorded_legacy",
      "manual_direct",
      "manual_local_image_calibrated",
    ].includes(String(snapshot.measurement_method))
  )
    throw new SnapshotContractError("record snapshot measurement_method is invalid");
  if (
    snapshot.petri_diameter_mm !== undefined &&
    snapshot.petri_diameter_mm !== null &&
    (typeof snapshot.petri_diameter_mm !== "number" || !Number.isFinite(snapshot.petri_diameter_mm))
  )
    throw new SnapshotContractError("record snapshot petri_diameter_mm must be finite");
  const findings = validateExperiment(snapshot as unknown as ExperimentRecord, {
    legacySnapshotContract: true,
  });
  if (findings.length)
    throw new SnapshotContractError(
      `record snapshot scientific fields are invalid: ${findings
        .map((finding) => finding.field)
        .join(", ")}`,
    );
  const canonicalYield = Number(
    ((Number(snapshot.oil_mass) / Number(snapshot.peel_mass)) * 100).toFixed(2),
  );
  if (Math.abs(Number(snapshot.yield_percent) - canonicalYield) > 0.000001)
    throw new SnapshotContractError("record snapshot yield_percent is not canonical");
  if (
    !snapshot.metadata ||
    typeof snapshot.metadata !== "object" ||
    Array.isArray(snapshot.metadata)
  )
    throw new SnapshotContractError("record snapshot metadata must be an object");
  return snapshot as unknown as ExperimentRecord;
}

export function validateReviewSnapshotV1(
  value: unknown,
  expectedReviewId: string,
  expectedRecordId: string,
): RecordReview {
  const snapshot = object(value, "review snapshot");
  const id = requiredString(snapshot.id, "review snapshot id");
  if (id !== expectedReviewId)
    throw new SnapshotContractError("review snapshot id does not match input review_id");
  if (requiredString(snapshot.record_id, "review snapshot record_id") !== expectedRecordId)
    throw new SnapshotContractError("review snapshot belongs to another record");
  if (!["review", "included", "excluded"].includes(String(snapshot.status)))
    throw new SnapshotContractError("review snapshot status is invalid");
  if (typeof snapshot.note !== "string" || typeof snapshot.reviewed_by !== "string")
    throw new SnapshotContractError("review snapshot text fields are invalid");
  if (!isStrictTimestamp(requiredString(snapshot.created_at, "review snapshot created_at")))
    throw new SnapshotContractError("review snapshot created_at is invalid");
  if (
    typeof snapshot.reviewed_at !== "string" ||
    (snapshot.reviewed_at !== "" && !isStrictTimestamp(snapshot.reviewed_at))
  )
    throw new SnapshotContractError("review snapshot reviewed_at is invalid");
  if (
    snapshot.reviewer_user_id !== undefined &&
    (typeof snapshot.reviewer_user_id !== "string" || !snapshot.reviewer_user_id.trim())
  )
    throw new SnapshotContractError("review snapshot reviewer identifier is invalid");
  if (
    snapshot.event_sequence !== undefined &&
    (typeof snapshot.event_sequence !== "number" ||
      !Number.isInteger(snapshot.event_sequence) ||
      snapshot.event_sequence <= 0)
  )
    throw new SnapshotContractError("review snapshot event_sequence is invalid");
  if (snapshot.provenance_kind !== "human" && snapshot.provenance_kind !== "legacy_projection")
    throw new SnapshotContractError("review snapshot provenance_kind is invalid");
  return snapshot as unknown as RecordReview;
}

/** Current schema-9 snapshot boundary. Historical migrations retain the v1 validator above. */
export function validateRecordSnapshotV1Strict(
  value: unknown,
  expectedRecordId?: string,
): ExperimentRecord {
  const snapshot = validateRecordSnapshotV1(value, expectedRecordId);
  const fields = snapshot as unknown as Record<string, unknown>;
  requiredIdentity(fields.id, "record snapshot id");
  optionalIdentity(fields.effective_review_id, "record snapshot effective_review_id");
  optionalIdentity(fields.created_by_user_id, "record snapshot creator identifier");
  optionalIdentity(fields.client_submission_id, "record snapshot client submission identifier");
  optionalIdentity(fields.class_id, "record snapshot class identifier");
  optionalIdentity(fields.group_id, "record snapshot group identifier");
  try {
    assertJsonSafeObject(fields.metadata, "record snapshot metadata");
  } catch (error) {
    if (error instanceof JsonSafeError)
      throw new SnapshotContractError("record snapshot metadata must be a lossless JSON object");
    throw error;
  }
  return snapshot;
}

/** Prospective scientific capture only; historical snapshot readers keep their v1 rules. */
export function validateScientificRecordSnapshot(
  value: unknown,
  expectedRecordId?: string,
): ExperimentRecord {
  const snapshot = validateRecordSnapshotV1Strict(value, expectedRecordId);
  const fields = validateExperiment(snapshot).map((finding) => finding.field);
  if (!hasNonblankText(snapshot.created_by)) fields.push("created_by");
  if (fields.length)
    throw new SnapshotContractError(
      `record snapshot scientific fields are invalid: ${fields.join(", ")}`,
    );
  return snapshot;
}

/** Current schema-9 review-snapshot identity boundary. */
export function validateReviewSnapshotV1Strict(
  value: unknown,
  expectedReviewId: string,
  expectedRecordId: string,
): RecordReview {
  const snapshot = validateReviewSnapshotV1(value, expectedReviewId, expectedRecordId);
  const fields = snapshot as unknown as Record<string, unknown>;
  requiredIdentity(fields.id, "review snapshot id");
  requiredIdentity(fields.record_id, "review snapshot record_id");
  optionalIdentity(fields.reviewer_user_id, "review snapshot reviewer identifier");
  if (
    typeof fields.reviewed_at !== "string" ||
    !isStrictTimestamp(fields.reviewed_at) ||
    Date.parse(fields.reviewed_at) < Date.parse(snapshot.created_at)
  )
    throw new SnapshotContractError(
      "current review snapshot requires reviewed_at at or after created_at",
    );
  return snapshot;
}

export function validateAnalysisBindingV1(
  record: ExperimentRecord,
  review: RecordReview | undefined,
  durableReview?: RecordReview | null,
): void {
  if (!review) return;
  if (
    record.effective_review_id !== review.id ||
    record.review_status !== review.status ||
    record.review_note !== review.note ||
    record.reviewed_by !== review.reviewed_by ||
    record.reviewed_at !== review.reviewed_at
  )
    throw new SnapshotContractError("record and review snapshots do not describe one projection");
  if (durableReview) {
    for (const field of [
      "id",
      "record_id",
      "reviewer_user_id",
      "status",
      "note",
      "reviewed_by",
      "reviewed_at",
      "created_at",
      "provenance_kind",
      "event_sequence",
    ] as const) {
      if (review[field] !== durableReview[field])
        throw new SnapshotContractError(`review snapshot ${field} does not match durable event`);
    }
  }
}

export function isRecordSnapshotV1(value: unknown, expectedRecordId: string): boolean {
  try {
    validateRecordSnapshotV1(value, expectedRecordId);
    return true;
  } catch {
    return false;
  }
}

export function isReviewSnapshotV1(
  value: unknown,
  expectedReviewId: string,
  expectedRecordId: string,
): boolean {
  try {
    validateReviewSnapshotV1(value, expectedReviewId, expectedRecordId);
    return true;
  } catch {
    return false;
  }
}
