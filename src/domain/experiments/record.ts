import type {
  CreateExperimentCommand,
  ExperimentRecord,
  JsonObject,
  ReviewStatus,
} from "../types.js";

export function createExperimentRecord(
  input: CreateExperimentCommand,
  ownership: {
    id: string;
    createdAt: string;
    createdBy: string;
    createdByUserId?: string | undefined;
    clientSubmissionId?: string | undefined;
    reviewStatus: ReviewStatus;
    syncedFromOffline?: boolean;
    metadata?: JsonObject;
  },
): ExperimentRecord {
  return {
    ...input,
    measurement_method: input.measurement_method ?? "not_recorded",
    id: ownership.id,
    client_submission_id: ownership.clientSubmissionId,
    created_by_user_id: ownership.createdByUserId,
    experiment_type: "nh4cl_citrus_oil",
    status: "active",
    yield_percent: Number(((input.oil_mass / input.peel_mass) * 100).toFixed(2)),
    created_at: ownership.createdAt,
    updated_at: ownership.createdAt,
    created_by: ownership.createdBy,
    review_status: ownership.reviewStatus,
    review_note: "",
    reviewed_at: "",
    reviewed_by: "",
    synced_from_offline: ownership.syncedFromOffline ?? false,
    ai_diagnosis: "",
    metadata: ownership.metadata ?? {},
  };
}
