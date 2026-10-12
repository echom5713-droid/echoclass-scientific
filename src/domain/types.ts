import type { JsonObject } from "../shared/json-safe.js";

export type { JsonObject, JsonValue } from "../shared/json-safe.js";

export type UserRole = "student" | "teacher" | "admin";
export type UserStatus = "active" | "disabled" | "demo";

export interface User {
  id: string;
  role: UserRole;
  username: string;
  passwordHash: string;
  defaultPassword: boolean;
  name: string;
  class_name: string;
  group_name?: string;
  status: UserStatus;
  created_at?: string;
  updated_at?: string;
  password_changed_at?: string;
  password_reset_at?: string;
}

export interface Classroom {
  id: string;
  name: string;
  teacher_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface Session {
  id: string;
  role: UserRole;
  username: string;
  name: string;
  class_name: string;
  group_name?: string;
  defaultPassword?: boolean;
  status?: UserStatus;
  sidHash?: string;
  expires_at?: number;
}

export type ReviewStatus = "" | "normal" | "review" | "included" | "excluded";
export type MeasurementMethod =
  "not_recorded" | "not_recorded_legacy" | "manual_direct" | "manual_local_image_calibrated";

export interface CreateExperimentCommand {
  student_name: string;
  class_name: string;
  group_name: string;
  nh4cl_concentration: number;
  peel_mass: number;
  oil_mass: number;
  distillation_time: number;
  phase_clarity_score: number;
  emulsification_level: string;
  emulsion_concentration: number;
  ecoli_observation_group: string;
  inhibition_zone_diameter: number;
  colony_growth_score: number;
  异常标记: boolean;
  error_source: string;
  note: string;
  experiment_date?: string | undefined;
  petri_diameter_mm?: number | undefined;
  measurement_method?: MeasurementMethod | undefined;
}

export interface OfflineExperimentCommand extends CreateExperimentCommand {
  client_submission_id: string;
}

export interface PersistExperimentCommand extends CreateExperimentCommand {
  id: string;
  client_submission_id?: string | undefined;
  created_by_user_id: string;
  created_by: string;
  created_at: string;
  initial_quality_status?: "normal" | "review" | undefined;
  synced_from_offline: boolean;
  ai_diagnosis?: string | undefined;
  metadata: JsonObject;
}

export interface ExperimentRecord extends CreateExperimentCommand {
  id: string;
  client_submission_id?: string | undefined;
  created_by_user_id?: string | undefined;
  class_id?: string | undefined;
  group_id?: string | undefined;
  experiment_type?: string | undefined;
  status?: "active" | "deleted" | undefined;
  effective_review_id?: string | undefined;
  yield_percent: number;
  created_at: string;
  updated_at?: string | undefined;
  created_by: string;
  review_status: ReviewStatus;
  review_note: string;
  reviewed_at: string;
  reviewed_by: string;
  synced_from_offline: boolean;
  ai_diagnosis: string;
  metadata: JsonObject;
}

export interface UpdateExperimentCommand {
  class_name?: string | undefined;
  group_name?: string | undefined;
  nh4cl_concentration?: number | undefined;
  peel_mass?: number | undefined;
  oil_mass?: number | undefined;
  distillation_time?: number | undefined;
  phase_clarity_score?: number | undefined;
  emulsification_level?: string | undefined;
  emulsion_concentration?: number | undefined;
  ecoli_observation_group?: string | undefined;
  inhibition_zone_diameter?: number | undefined;
  colony_growth_score?: number | undefined;
  异常标记?: boolean | undefined;
  error_source?: string | undefined;
  note?: string | undefined;
  experiment_date?: string | undefined;
  petri_diameter_mm?: number | undefined;
  measurement_method?: MeasurementMethod | undefined;
}

/** @deprecated Use CreateExperimentCommand at write boundaries. */
export type ExperimentRecordInput = CreateExperimentCommand;

export interface RecordReview {
  id: string;
  record_id: string;
  reviewer_user_id?: string | undefined;
  status: Exclude<ReviewStatus, "" | "normal">;
  note: string;
  reviewed_by: string;
  reviewed_at: string;
  created_at: string;
  provenance_kind: "human" | "legacy_projection";
  event_sequence?: number | undefined;
}

/** Trusted human-review intent; persistence owns event identity and time. */
export interface AppendReviewCommand {
  record_id: string;
  reviewer_user_id: string;
  status: Exclude<ReviewStatus, "" | "normal">;
  note: string;
  reviewed_by: string;
}

export type AnalysisStatus = "pending" | "running" | "completed" | "failed";

/** Caller-writable fields for an ordinary, server-timestamped pending run. */
export interface CreateAnalysisRunCommand {
  id: string;
  dataset_hash: string;
  algorithm_version: string;
  configuration: JsonObject;
  code_version: string;
  created_by_user_id?: string | undefined;
}

export interface AnalysisRun {
  id: string;
  dataset_hash: string;
  algorithm_version: string;
  configuration: JsonObject;
  code_version: string;
  status: AnalysisStatus;
  results_metadata: JsonObject;
  created_by_user_id?: string | undefined;
  created_at: string;
  completed_at?: string | undefined;
  inputs_sealed?: boolean | undefined;
  dataset_classification?: "exact" | "legacy_incomplete" | "legacy_unverified" | undefined;
}

export interface AnalysisInputSelection {
  record_id: string;
  review_id?: string | undefined;
  review_mode?: "effective" | "omit" | "none" | undefined;
  review_omission_reason?: string | undefined;
  input_hash: string;
}

export interface AnalysisRunStateUpdate {
  status: AnalysisStatus;
  results_metadata: JsonObject;
  completed_at?: string | undefined;
}

export interface AnalysisInput {
  analysis_run_id: string;
  ordinal: number;
  record_id: string;
  review_id?: string | undefined;
  input_hash: string;
  record_snapshot: ExperimentRecord;
  review_snapshot?: RecordReview | undefined;
  review_binding_mode: "effective" | "omit" | "none" | "legacy_unspecified";
  review_omission_reason?: string | undefined;
  snapshot_schema?: "echoclass.analysis-input.v1" | "echoclass.analysis-input.legacy" | undefined;
}

export interface AuditEvent {
  actor?: Session | User | undefined;
  action: string;
  targetType?: string | undefined;
  targetId?: string | undefined;
  className?: string | undefined;
  ip?: string | undefined;
  ua?: string | undefined;
  ok?: boolean | undefined;
  detail?: Record<string, string | number | boolean | null | undefined> | undefined;
}

export type AIMessageRole = "user" | "assistant";
export interface AIHistoryItem {
  role: AIMessageRole;
  content: string;
}
export interface AIQuestion {
  question: string;
  scene: string;
  history: AIHistoryItem[];
}
export interface AIResponse {
  answer: string;
  mode: "deepseek-proxy" | "local-fallback";
  model?: string;
  reason?: "missing_api_key" | "deepseek_error" | "invalid_provider_response";
}

export interface PracticeAnswer {
  id: string;
  student: Pick<Session, "id" | "name" | "class_name">;
  qid: string;
  level: number;
  correct: boolean;
  selected: number;
  ts: string;
}
