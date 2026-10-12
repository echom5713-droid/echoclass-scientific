import type { JsonObject } from "../../shared/json-safe.js";
import type { Session } from "../types.js";

export const SCIENTIFIC_ALGORITHM = "echoclass.yield-analysis.v1";
export const SCIENTIFIC_POLICY = "approved_only.v1";
export const SCIENTIFIC_STATE_SCHEMA = "echoclass.scientific-run-state.v1";
export const SCIENTIFIC_REGISTRATION_SCHEMA = "echoclass.scientific-registration.v1";
export const SCIENTIFIC_LIMITS = Object.freeze({
  candidates: 500,
  requestBytes: 8_388_608,
  resultBytes: 2_097_152,
  pending: 10,
  attempts: 2,
  recent: 50,
});

export interface ScientificContext {
  actor: Session | null;
  ip: string;
  ua: string;
}
export interface ScientificCommand {
  class_id: string;
  client_request_id: string;
  policy: typeof SCIENTIFIC_POLICY;
}
export interface ScientificIdentity extends JsonObject {
  algorithm_version: string;
  code_version: string;
  node_code_version: string;
  environment_fingerprint: string;
  environment: JsonObject;
  app_version: string;
}
export interface ScientificConfiguration extends JsonObject {
  schema: "echoclass.scientific-configuration.v1";
  selection_policy: typeof SCIENTIFIC_POLICY;
  seed_hex: string;
}
export function scientificSettings(): JsonObject {
  return {
    schema: "echoclass.scientific-configuration.v1",
    selection_policy: SCIENTIFIC_POLICY,
    metric: "yield_percent",
    group_by: "nh4cl_concentration",
    concentrations: [0, 1, 3, 4],
    quantile_method: "linear",
    sd_ddof: 1,
    iqr_multiplier: 1.5,
    iqr_min_n: 4,
    bootstrap_method: "percentile",
    bootstrap_confidence_level: 0.95,
    bootstrap_resamples: 10000,
    bootstrap_batch_size: 256,
    resampling_unit: "record_assumed_independent",
    rng: "PCG64",
    regression: "quadratic_group_means_equal_weight",
    numerical_policy: "float64_scaled.v1",
  };
}
export interface ScientificEnvelope {
  schema: "echoclass.scientific-envelope.v1";
  canonical_inputs: Array<{ input_hash: string; canonical_json: string }>;
  dataset_hash: string;
  dataset_canonical_json: string;
  execution_fingerprint: string;
  execution_canonical_json: string;
}
export interface ScientificAttempt {
  number: 1 | 2;
  token: string;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
}
export interface ScientificRun {
  id: string;
  class_id: string;
  class_name: string;
  requester_user_id: string;
  client_request_id: string;
  request_fingerprint: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  completed_at: string | null;
  dataset_hash: string;
  execution_fingerprint: string;
  configuration: ScientificConfiguration;
  identity: ScientificIdentity;
  attempts: ScientificAttempt[];
  result: JsonObject | null;
  scientific_result_hash: string | null;
  error_code: string | null;
}
export interface ScientificWork {
  run: ScientificRun;
  envelope: ScientificEnvelope;
  attempt: ScientificAttempt;
}
export type ScientificOutcome =
  { status: "completed"; result: JsonObject } | { status: "failed"; error_code: string };
export class ScientificFault extends Error {
  constructor(
    public readonly kind:
      | "input"
      | "limit"
      | "unauthenticated"
      | "forbidden"
      | "missing"
      | "conflict"
      | "unavailable"
      | "corrupt",
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "ScientificFault";
  }
}
export interface ScientificAnalysisRepository {
  authorize(context: ScientificContext): { id: string; role: Session["role"] };
  classes(context: ScientificContext): Array<{ id: string; name: string }>;
  createScientificRun(
    context: ScientificContext,
    command: ScientificCommand,
    identity: ScientificIdentity | null,
  ): { run: ScientificRun; replayed: boolean };
  getScientificRun(context: ScientificContext, runId: string): ScientificRun;
  listScientificRuns(context: ScientificContext, classId: string): ScientificRun[];
  pendingRunIds(): string[];
  runningRunIds(): string[];
  readExecutionRun(runId: string): ScientificRun;
  claimPendingRun(runId: string, identity: ScientificIdentity): ScientificWork | null;
  retryRunningRun(
    runId: string,
    previousAttemptToken: string,
    failure: string,
    identity: ScientificIdentity,
  ): ScientificWork | null;
  finishScientificRun(
    runId: string,
    attemptToken: string,
    outcome: ScientificOutcome,
  ): ScientificRun;
  failPendingRun(runId: string, errorCode: string): ScientificRun;
  readScientificInputs(runId: string): ScientificEnvelope;
}
