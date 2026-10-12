import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  RepositoryConflictError,
  RepositoryCorruptionError,
  type RecordScope,
} from "../../domain/repositories.js";
import type { Clock, IdGenerator } from "../../application/ports.js";
import { validateExperiment } from "../../domain/experiments/validation.js";
import type {
  AnalysisInput,
  AnalysisInputSelection,
  AnalysisRun,
  AnalysisRunStateUpdate,
  AppendReviewCommand,
  CreateAnalysisRunCommand,
  ExperimentRecord,
  PersistExperimentCommand,
  RecordReview,
  UpdateExperimentCommand,
} from "../../domain/types.js";
import {
  ANALYSIS_SNAPSHOT_V1,
  SnapshotContractError,
  validateAnalysisBindingV1,
  validateRecordSnapshotV1Strict,
  validateScientificRecordSnapshot,
  validateReviewSnapshotV1Strict,
} from "./analysis-snapshot-v1.js";
import { isStrictOffsetTimestamp, isStrictTimestamp } from "../../shared/strict-timestamp.js";
import { hasNonBlankUnicodeText, machineIdentity } from "../../shared/provenance-contract.js";
import {
  parseJsonSafeObject,
  serializeJsonSafeObject,
  type JsonObject,
} from "../../shared/json-safe.js";

type SqliteRow = Record<string, unknown>;

function strictObject(value: unknown, label: string): JsonObject {
  try {
    return parseJsonSafeObject(value, label);
  } catch (error) {
    throw new RepositoryCorruptionError(
      error instanceof Error ? error.message : `${label} contains invalid JSON`,
    );
  }
}

function serializeObject(value: unknown, label: string): string {
  return serializeJsonSafeObject(value, label);
}

const boundedIdentity = machineIdentity;

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function isConstraint(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    code.includes("SQLITE_CONSTRAINT") ||
    /constraint failed|offline token duplicate replacement is forbidden/i.test(message)
  );
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The original operation error remains authoritative.
    }
    throw error;
  }
}

function inTransaction(database: DatabaseSync): boolean {
  return Boolean((database as DatabaseSync & { isTransaction?: boolean }).isTransaction);
}

function monotonicTimestamp(clock: Clock, previous: string, label: string): string {
  const observed = clock.now();
  if (!isStrictTimestamp(observed)) throw new Error(`${label} clock returned an invalid timestamp`);
  const previousMillis = Date.parse(previous);
  if (!Number.isFinite(previousMillis)) throw new Error(`${label} prior timestamp is invalid`);
  const nextMillis = Math.max(Date.parse(observed), previousMillis + 1);
  const next = new Date(nextMillis).toISOString();
  if (!isStrictTimestamp(next)) throw new Error(`${label} clock could not advance monotonically`);
  return next;
}

function recordFromRow(row: SqliteRow): ExperimentRecord {
  const metadata = strictObject(row.metadata_json, "experiment record metadata");
  if (row.client_submission_id) {
    metadata.client_submission_id = String(row.client_submission_id);
    if (row.created_by_user_id) metadata.idempotency_actor_id = String(row.created_by_user_id);
    metadata.idempotency_class_name = String(row.class_name_snapshot);
  }
  return {
    id: String(row.id),
    client_submission_id: row.client_submission_id ? String(row.client_submission_id) : undefined,
    created_by_user_id: row.created_by_user_id ? String(row.created_by_user_id) : undefined,
    experiment_type: String(row.experiment_type),
    status: String(row.status) as "active" | "deleted",
    effective_review_id: row.effective_review_id ? String(row.effective_review_id) : undefined,
    student_name: String(row.student_name),
    class_name: String(row.class_name_snapshot),
    group_name: String(row.group_name_snapshot),
    nh4cl_concentration: Number(row.nh4cl_concentration),
    peel_mass: Number(row.peel_mass),
    oil_mass: Number(row.oil_mass),
    distillation_time: Number(row.distillation_time),
    phase_clarity_score: Number(row.phase_clarity_score),
    emulsification_level: String(row.emulsification_level),
    emulsion_concentration: Number(row.emulsion_concentration),
    ecoli_observation_group: String(row.ecoli_observation_group),
    inhibition_zone_diameter: Number(row.inhibition_zone_diameter),
    colony_growth_score: Number(row.colony_growth_score),
    异常标记: Boolean(row.anomaly_flag),
    error_source: String(row.error_source),
    note: String(row.note),
    experiment_date: row.experiment_date ? String(row.experiment_date) : undefined,
    petri_diameter_mm:
      row.petri_diameter_mm === null || row.petri_diameter_mm === undefined
        ? undefined
        : Number(row.petri_diameter_mm),
    measurement_method: row.measurement_method
      ? (String(row.measurement_method) as ExperimentRecord["measurement_method"])
      : undefined,
    yield_percent: Number(row.yield_percent),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    created_by: String(row.created_by_label),
    review_status: String(row.review_status) as ExperimentRecord["review_status"],
    review_note: String(row.review_note),
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : "",
    reviewed_by: String(row.reviewed_by),
    synced_from_offline: Boolean(row.synced_from_offline),
    ai_diagnosis: String(row.ai_diagnosis),
    metadata,
  };
}

function reviewFromRow(row: SqliteRow): RecordReview {
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
    event_sequence: row.event_sequence === undefined ? undefined : Number(row.event_sequence),
  };
}

function analysisRunFromRow(
  row: SqliteRow,
  legacyOffsetFields: ReadonlySet<string> = new Set(),
): AnalysisRun {
  try {
    const id = boundedIdentity(row.id, "analysis run id");
    const datasetHash = boundedIdentity(row.dataset_hash, "analysis dataset hash");
    const algorithmVersion = boundedIdentity(row.algorithm_version, "analysis algorithm version");
    const codeVersion = boundedIdentity(row.code_version, "analysis code version");
    const status = String(row.status) as AnalysisRun["status"];
    if (!(["pending", "running", "completed", "failed"] as string[]).includes(status))
      throw new Error("analysis run status is invalid");
    const createdAt = String(row.created_at);
    const validTimestamp = (field: string, value: string): boolean =>
      isStrictTimestamp(value) || (legacyOffsetFields.has(field) && isStrictOffsetTimestamp(value));
    if (!validTimestamp("created_at", createdAt))
      throw new Error("analysis run created_at is invalid");
    const completedAt = row.completed_at === null ? undefined : String(row.completed_at);
    const inputsSealed = row.inputs_sealed === undefined ? undefined : Number(row.inputs_sealed);
    if (
      inputsSealed !== undefined &&
      (!Number.isInteger(inputsSealed) || (inputsSealed !== 0 && inputsSealed !== 1))
    )
      throw new Error("analysis run input seal is invalid");
    const datasetClassification =
      row.dataset_classification === undefined ? undefined : String(row.dataset_classification);
    if (
      datasetClassification !== undefined &&
      !["exact", "legacy_incomplete", "legacy_unverified"].includes(datasetClassification)
    )
      throw new Error("analysis run dataset classification is invalid");
    const terminal = status === "completed" || status === "failed";
    if (
      (terminal &&
        (!completedAt ||
          !validTimestamp("completed_at", completedAt) ||
          Date.parse(completedAt) < Date.parse(createdAt))) ||
      (!terminal && completedAt !== undefined)
    )
      throw new Error("analysis run state timestamps are inconsistent");
    const creator = row.created_by_user_id === null ? undefined : String(row.created_by_user_id);
    if (creator !== undefined) boundedIdentity(creator, "analysis run creator id");
    return {
      id,
      dataset_hash: datasetHash,
      algorithm_version: algorithmVersion,
      configuration: strictObject(row.configuration_json, "analysis run configuration"),
      code_version: codeVersion,
      status,
      results_metadata: strictObject(row.results_metadata_json, "analysis run results metadata"),
      created_at: createdAt,
      ...(creator ? { created_by_user_id: creator } : {}),
      ...(completedAt ? { completed_at: completedAt } : {}),
      ...(inputsSealed === undefined ? {} : { inputs_sealed: inputsSealed === 1 }),
      ...(datasetClassification === undefined
        ? {}
        : {
            dataset_classification: datasetClassification as AnalysisRun["dataset_classification"],
          }),
    };
  } catch (error) {
    if (error instanceof RepositoryCorruptionError) throw error;
    throw new RepositoryCorruptionError(
      error instanceof Error ? error.message : "Stored analysis run is corrupt",
    );
  }
}

function submissionSnapshot(record: import("../../domain/types.js").CreateExperimentCommand) {
  return {
    student_name: record.student_name,
    class_name: record.class_name,
    group_name: record.group_name,
    nh4cl_concentration: record.nh4cl_concentration,
    peel_mass: record.peel_mass,
    oil_mass: record.oil_mass,
    distillation_time: record.distillation_time,
    phase_clarity_score: record.phase_clarity_score,
    emulsification_level: record.emulsification_level,
    emulsion_concentration: record.emulsion_concentration,
    ecoli_observation_group: record.ecoli_observation_group,
    inhibition_zone_diameter: record.inhibition_zone_diameter,
    colony_growth_score: record.colony_growth_score,
    异常标记: record.异常标记,
    error_source: record.error_source,
    note: record.note,
    experiment_date: record.experiment_date,
    petri_diameter_mm: record.petri_diameter_mm,
    measurement_method: record.measurement_method,
  };
}

/** Infrastructure-only command for preserving historical startup-import evidence. */
export type LegacyImportExperimentCommand = Omit<PersistExperimentCommand, "created_by_user_id"> & {
  created_by_user_id?: string | undefined;
  storage_import_id: string;
  updated_at?: string | undefined;
};

export interface CapturedAnalysisSnapshot {
  record: ExperimentRecord;
  review: RecordReview | null;
  bindingMode: "effective" | "omit" | "none";
  omissionReason: string | null;
  recordJson: string;
  reviewJson: string | null;
}

export class SqliteProvenanceStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
    private readonly ids: IdGenerator = {
      random: (bytes = 16) => randomBytes(bytes).toString("hex"),
      hashSession: (value) => createHash("sha256").update(value).digest("hex"),
    },
  ) {}

  private tableHasColumn(table: string, column: string): boolean {
    return (
      this.database.prepare(`PRAGMA table_info(${table})`).all() as unknown as SqliteRow[]
    ).some((candidate) => candidate.name === column);
  }

  private recordHasUnverifiedSelectionEvidence(recordId: string): boolean {
    const ledger = this.database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='provenance_boundary_classifications'",
      )
      .get();
    if (!ledger) return false;
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM provenance_boundary_classifications pbc
           LEFT JOIN record_reviews rr
             ON pbc.entity_type='review' AND rr.id=pbc.entity_id
           WHERE pbc.classification LIKE '%unverified' AND (
             (pbc.entity_type='record' AND pbc.entity_id=?)
             OR (pbc.entity_type='review' AND rr.record_id=?)
           )
           LIMIT 1`,
        )
        .get(recordId, recordId),
    );
  }

  private ensureClassAndGroup(
    record: PersistExperimentCommand | LegacyImportExperimentCommand | ExperimentRecord,
  ): {
    classId: string;
    groupId: string | null;
  } {
    const existingClass = this.database
      .prepare("SELECT id FROM classes WHERE name=?")
      .get(record.class_name) as unknown as { id: string } | undefined;
    const identifiers = record as PersistExperimentCommand & {
      class_id?: string;
      group_id?: string;
    };
    const classId =
      existingClass?.id || identifiers.class_id || stableId("class", record.class_name);
    if (!existingClass)
      this.database
        .prepare("INSERT INTO classes(id, name, teacher_id, created_at) VALUES(?, ?, NULL, ?)")
        .run(classId, record.class_name, record.created_at);
    if (!record.group_name) return { classId, groupId: null };
    const existingGroup = this.database
      .prepare("SELECT id FROM groups WHERE class_id=? AND name=?")
      .get(classId, record.group_name) as unknown as { id: string } | undefined;
    const groupId =
      existingGroup?.id ||
      identifiers.group_id ||
      stableId("group", `${classId}\u0000${record.group_name}`);
    if (!existingGroup)
      this.database
        .prepare("INSERT INTO groups(id, class_id, name, created_at) VALUES(?, ?, ?, ?)")
        .run(groupId, classId, record.group_name, record.created_at);
    return { classId, groupId };
  }

  private insert(
    command: PersistExperimentCommand | LegacyImportExperimentCommand | ExperimentRecord,
    origin: { kind: "canonical" } | { kind: "legacy"; storageImportId: string },
  ): void {
    if ("submitted_values" in command)
      throw new Error("Persistence rejects an alternate submission snapshot");
    const supplied = command as PersistExperimentCommand & Partial<ExperimentRecord>;
    boundedIdentity(command.id, "experiment record id");
    if (!isStrictTimestamp(command.created_at))
      throw new Error("experiment created_at must be a canonical UTC timestamp");
    if (!hasNonBlankUnicodeText(command.created_by))
      throw new Error("experiment creator label is required");
    serializeObject(command.metadata, "experiment metadata");
    if (command.client_submission_id !== undefined)
      boundedIdentity(command.client_submission_id, "client submission id");
    const clientSubmissionId = command.client_submission_id ?? null;
    const createdByUserId = command.created_by_user_id ?? null;
    if (createdByUserId) boundedIdentity(createdByUserId, "experiment creator id");
    if (origin.kind === "canonical") {
      if (!createdByUserId) throw new Error("canonical experiment creator user is required");
      const creator = this.database
        .prepare("SELECT username,name FROM users WHERE id=?")
        .get(createdByUserId) as unknown as SqliteRow | undefined;
      if (
        !creator ||
        (command.created_by !== creator.username && command.created_by !== creator.name)
      )
        throw new Error("canonical experiment creator attribution does not match the account");
      if (command.synced_from_offline !== (clientSubmissionId !== null))
        throw new Error("canonical experiment offline state and client token contradict");
    } else {
      boundedIdentity(origin.storageImportId, "storage import id");
      if (!this.tableHasColumn("experiment_records", "storage_import_id"))
        throw new Error("legacy experiment import requires Migration 010");
      if (!inTransaction(this.database))
        throw new Error("legacy experiment import requires an active import-batch transaction");
      const batch = this.database
        .prepare(
          `SELECT 1 FROM legacy_import_batches lib
           WHERE lib.id=? AND NOT EXISTS(SELECT 1 FROM storage_imports si WHERE si.id=lib.id)`,
        )
        .get(origin.storageImportId);
      if (!batch) throw new Error("legacy experiment import batch is not open");
      if (
        createdByUserId &&
        !this.database.prepare("SELECT 1 FROM users WHERE id=?").get(createdByUserId)
      )
        throw new Error("legacy experiment creator reference is unresolved");
    }
    if (
      supplied.effective_review_id ||
      supplied.review_status === "included" ||
      supplied.review_status === "excluded" ||
      supplied.review_note ||
      supplied.reviewed_by ||
      supplied.reviewed_at
    )
      throw new Error("Creation cannot set a human review projection");
    const findings = validateExperiment(command);
    if (findings.length)
      throw new Error(`Invalid experiment: ${findings.map((finding) => finding.field).join(", ")}`);
    const requestedUpdatedAt =
      "updated_at" in command && command.updated_at !== undefined
        ? command.updated_at
        : command.created_at;
    if (
      !isStrictTimestamp(requestedUpdatedAt) ||
      Date.parse(requestedUpdatedAt) < Date.parse(command.created_at)
    )
      throw new Error("experiment updated_at must not predate its creation time");
    const record: ExperimentRecord = {
      ...command,
      status: "active",
      yield_percent: Number(((command.oil_mass / command.peel_mass) * 100).toFixed(2)),
      updated_at: requestedUpdatedAt,
      review_status:
        supplied.initial_quality_status ||
        (supplied.review_status === "review" ? "review" : "normal"),
      review_note: "",
      reviewed_at: "",
      reviewed_by: "",
      ai_diagnosis: command.ai_diagnosis || "",
      measurement_method: command.measurement_method || "not_recorded",
    };
    if (!Number.isFinite(record.yield_percent))
      throw new Error("Invalid experiment: non-finite yield_percent");
    const { classId, groupId } = this.ensureClassAndGroup(record);
    const metadata = { ...record.metadata };
    delete metadata.client_submission_id;
    delete metadata.idempotency_actor_id;
    delete metadata.idempotency_class_name;
    const metadataJson = serializeObject(metadata, "experiment metadata");
    const columns = [
      "id",
      "client_submission_id",
      "idempotency_scope_class_id",
      "created_by_user_id",
      "created_by_label",
      "class_id",
      "class_name_snapshot",
      "group_id",
      "group_name_snapshot",
      "student_name",
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
      "experiment_date",
      "petri_diameter_mm",
      "measurement_method",
      "yield_percent",
      "review_status",
      "review_note",
      "reviewed_at",
      "reviewed_by",
      "synced_from_offline",
      "ai_diagnosis",
      "submission_kind",
      "submitted_json",
      "metadata_json",
      "created_at",
      "updated_at",
    ];
    const values: Array<string | number | null> = [
      record.id,
      clientSubmissionId,
      clientSubmissionId ? classId : null,
      createdByUserId,
      record.created_by,
      classId,
      record.class_name,
      groupId,
      record.group_name,
      record.student_name,
      record.experiment_type || "nh4cl_citrus_oil",
      record.status || "active",
      record.nh4cl_concentration,
      record.peel_mass,
      record.oil_mass,
      record.distillation_time,
      record.phase_clarity_score,
      record.emulsification_level,
      record.emulsion_concentration,
      record.ecoli_observation_group,
      record.inhibition_zone_diameter,
      record.colony_growth_score,
      record.异常标记 ? 1 : 0,
      record.error_source,
      record.note,
      record.experiment_date || null,
      record.petri_diameter_mm ?? null,
      record.measurement_method || "not_recorded",
      record.yield_percent,
      record.review_status || "normal",
      record.review_note || "",
      record.reviewed_at || null,
      record.reviewed_by || "",
      record.synced_from_offline ? 1 : 0,
      record.ai_diagnosis || "",
      origin.kind === "canonical" ? "canonical_submission" : "legacy_canonical_snapshot",
      JSON.stringify(submissionSnapshot(record)),
      metadataJson,
      record.created_at,
      record.updated_at || record.created_at,
    ];
    if (this.tableHasColumn("experiment_records", "storage_import_id")) {
      columns.push("storage_import_id");
      values.push(origin.kind === "legacy" ? origin.storageImportId : null);
    }
    this.database
      .prepare(
        `INSERT INTO experiment_records(${columns.join(",")})
         VALUES(${columns.map(() => "?").join(",")})`,
      )
      .run(...values);
  }

  findAll(scope: RecordScope = {}): ExperimentRecord[] {
    const rows =
      scope.class_name && !scope.includeAll
        ? this.database
            .prepare(
              `SELECT * FROM experiment_records
             WHERE class_name_snapshot = ? AND status = 'active'
             ORDER BY created_at DESC`,
            )
            .all(scope.class_name)
        : this.database
            .prepare(
              "SELECT * FROM experiment_records WHERE status = 'active' ORDER BY created_at DESC",
            )
            .all();
    return (rows as unknown as SqliteRow[]).map(recordFromRow);
  }

  /** The CSV transaction selects one current class cohort by stable identity. */
  findActiveByClassId(classId: string): ExperimentRecord[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM experiment_records WHERE class_id=? AND status='active' ORDER BY id COLLATE BINARY",
      )
      .all(classId);
    return (rows as unknown as SqliteRow[]).map(recordFromRow);
  }

  findById(id: string): ExperimentRecord | null {
    const row = this.database
      .prepare("SELECT * FROM experiment_records WHERE id = ? AND status = 'active'")
      .get(id) as unknown as SqliteRow | undefined;
    return row ? recordFromRow(row) : null;
  }

  findByIdForAudit(id: string): ExperimentRecord | null {
    return this.findByIdIncludingDeleted(id);
  }

  private analysisRecordSnapshot(id: string): ExperimentRecord | null {
    const row = this.database
      .prepare("SELECT * FROM experiment_records WHERE id = ? AND status = 'active'")
      .get(id) as unknown as SqliteRow | undefined;
    if (!row) return null;
    return {
      ...recordFromRow(row),
      class_id: String(row.class_id),
      group_id: row.group_id ? String(row.group_id) : undefined,
    };
  }

  findByClientSubmission(scope: {
    actorId: string;
    className: string;
    clientSubmissionId: string;
  }): ExperimentRecord | null {
    const row = this.database
      .prepare(
        `SELECT er.*
         FROM experiment_records er
         JOIN classes c ON c.id = er.idempotency_scope_class_id
         WHERE er.created_by_user_id = ? AND c.name = ?
           AND er.client_submission_id = ? AND er.status = 'active'
         LIMIT 1`,
      )
      .get(scope.actorId, scope.className, scope.clientSubmissionId) as unknown as
      SqliteRow | undefined;
    return row ? recordFromRow(row) : null;
  }

  add(record: PersistExperimentCommand | ExperimentRecord): void {
    try {
      if (inTransaction(this.database)) this.insert(record, { kind: "canonical" });
      else transaction(this.database, () => this.insert(record, { kind: "canonical" }));
    } catch (error) {
      if (isConstraint(error)) throw new RepositoryConflictError();
      throw error;
    }
  }

  /** Explicit infrastructure-only startup-import path; never exposed by ExperimentRepository. */
  importExperiment(command: LegacyImportExperimentCommand): void {
    try {
      if (
        this.tableHasColumn("experiment_records", "storage_import_id") &&
        !inTransaction(this.database)
      )
        throw new Error("legacy experiment import requires an active import transaction");
      this.insert(command, { kind: "legacy", storageImportId: command.storage_import_id });
    } catch (error) {
      if (isConstraint(error)) throw new RepositoryConflictError();
      throw error;
    }
  }

  update(id: string, patch: UpdateExperimentCommand): ExperimentRecord | null {
    const allowed = new Set<keyof UpdateExperimentCommand>([
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
    ]);
    for (const field of Object.keys(patch)) {
      if (!allowed.has(field as keyof UpdateExperimentCommand))
        throw new Error(`Protected experiment update field: ${field}`);
    }
    return transaction(this.database, () => {
      const current = this.findById(id);
      if (!current) return null;
      const updatedAt = monotonicTimestamp(
        this.clock,
        current.updated_at ?? current.created_at,
        "experiment",
      );
      const corrections = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      const merged = {
        ...current,
        ...corrections,
        id: current.id,
        yield_percent: Number(
          (
            ((patch.oil_mass ?? current.oil_mass) / (patch.peel_mass ?? current.peel_mass)) *
            100
          ).toFixed(2),
        ),
        updated_at: updatedAt,
      } as ExperimentRecord;
      const findings = validateExperiment(merged);
      if (findings.length)
        throw new Error(
          `Invalid experiment correction: ${findings.map((finding) => finding.field).join(", ")}`,
        );
      if (!Number.isFinite(merged.yield_percent))
        throw new Error("Invalid experiment correction: non-finite yield_percent");
      const { classId, groupId } = this.ensureClassAndGroup(merged);
      const result = this.database
        .prepare(
          `UPDATE experiment_records SET
            class_id=?, class_name_snapshot=?, group_id=?, group_name_snapshot=?,
            nh4cl_concentration=?, peel_mass=?, oil_mass=?, distillation_time=?,
            phase_clarity_score=?, emulsification_level=?, emulsion_concentration=?,
            ecoli_observation_group=?, inhibition_zone_diameter=?, colony_growth_score=?,
            anomaly_flag=?, error_source=?, note=?, experiment_date=?, petri_diameter_mm=?,
            measurement_method=?, yield_percent=?, updated_at=?
           WHERE id=? AND status='active'`,
        )
        .run(
          classId,
          merged.class_name,
          groupId,
          merged.group_name,
          merged.nh4cl_concentration,
          merged.peel_mass,
          merged.oil_mass,
          merged.distillation_time,
          merged.phase_clarity_score,
          merged.emulsification_level,
          merged.emulsion_concentration,
          merged.ecoli_observation_group,
          merged.inhibition_zone_diameter,
          merged.colony_growth_score,
          merged.异常标记 ? 1 : 0,
          merged.error_source,
          merged.note,
          merged.experiment_date || null,
          merged.petri_diameter_mm ?? null,
          merged.measurement_method || "not_recorded",
          merged.yield_percent,
          merged.updated_at ?? this.clock.now(),
          id,
        );
      return Number(result.changes) ? this.findById(id) : null;
    });
  }

  delete(id: string): boolean {
    return transaction(this.database, () => {
      const current = this.findById(id);
      if (!current) return false;
      const timestamp = monotonicTimestamp(
        this.clock,
        current.updated_at ?? current.created_at,
        "experiment",
      );
      const result = this.database
        .prepare(
          `UPDATE experiment_records SET status='deleted', updated_at=?
           WHERE id=? AND status='active' AND updated_at=?`,
        )
        .run(timestamp, id, current.updated_at ?? current.created_at);
      if (Number(result.changes) !== 1) throw new RepositoryConflictError();
      return true;
    });
  }

  findByIdIncludingDeleted(id: string): ExperimentRecord | null {
    const row = this.database
      .prepare("SELECT * FROM experiment_records WHERE id=?")
      .get(id) as unknown as SqliteRow | undefined;
    return row ? recordFromRow(row) : null;
  }

  private insertReview(
    review: RecordReview,
    projectionUpdatedAt?: string,
  ): ExperimentRecord | null {
    try {
      const operation = () => {
        const hasProjectionTimestamp = this.tableHasColumn(
          "record_reviews",
          "projection_updated_at",
        );
        const values: Array<string | null> = [
          review.id,
          review.record_id,
          review.reviewer_user_id || null,
          review.reviewed_by,
          review.status,
          review.note,
          review.reviewed_at || null,
          review.created_at,
          review.provenance_kind,
        ];
        if (hasProjectionTimestamp) {
          if (!projectionUpdatedAt || !isStrictTimestamp(projectionUpdatedAt))
            throw new Error("review projection timestamp is invalid");
          values.push(projectionUpdatedAt);
        }
        this.database
          .prepare(
            `INSERT INTO record_reviews(
              id, record_id, reviewer_user_id, reviewer_label, decision, reason,
              decided_at, created_at, provenance_kind${
                hasProjectionTimestamp ? ", projection_updated_at" : ""
              }
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?${hasProjectionTimestamp ? ", ?" : ""})`,
          )
          .run(...values);
        const projected = this.findById(review.record_id);
        if (!projected || projected.effective_review_id !== review.id)
          throw new Error("Review projection was not updated");
        return projected;
      };
      return inTransaction(this.database) ? operation() : transaction(this.database, operation);
    } catch (error) {
      if (isConstraint(error)) throw new RepositoryConflictError();
      throw error;
    }
  }

  appendReview(command: AppendReviewCommand): ExperimentRecord | null {
    boundedIdentity(command.record_id, "review record id");
    boundedIdentity(command.reviewer_user_id, "reviewer user id");
    if (!command.reviewed_by.trim()) throw new Error("reviewer label is required");
    const current = this.findById(command.record_id);
    if (!current) return null;
    const timestamp = monotonicTimestamp(
      this.clock,
      current.updated_at ?? current.created_at,
      "review",
    );
    return this.insertReview(
      {
        id: `review-${this.ids.random(16)}`,
        record_id: command.record_id,
        reviewer_user_id: command.reviewer_user_id,
        status: command.status,
        note: command.note,
        reviewed_by: command.reviewed_by,
        reviewed_at: timestamp,
        created_at: timestamp,
        provenance_kind: "human",
      },
      timestamp,
    );
  }

  /** Explicit historical-import path. Never used for ordinary human review writes. */
  importReview(review: RecordReview): ExperimentRecord | null {
    boundedIdentity(review.id, "imported review id");
    boundedIdentity(review.record_id, "imported review record id");
    if (this.tableHasColumn("experiment_records", "storage_import_id")) {
      if (!inTransaction(this.database))
        throw new Error("historical review import requires an active import transaction");
      const importedTarget = this.database
        .prepare(
          `SELECT er.submission_kind,er.storage_import_id,
                  lib.id AS batch_id,si.id AS completed_marker_id
           FROM experiment_records er
           LEFT JOIN legacy_import_batches lib ON lib.id=er.storage_import_id
           LEFT JOIN storage_imports si ON si.id=lib.id
           WHERE er.id=?`,
        )
        .get(review.record_id) as SqliteRow | undefined;
      if (!importedTarget) throw new Error("imported review record does not exist");
      if (
        importedTarget.submission_kind !== "legacy_canonical_snapshot" ||
        importedTarget.storage_import_id === null ||
        importedTarget.storage_import_id === undefined
      )
        throw new Error("historical review import requires a legacy imported target");
      if (
        importedTarget.batch_id === null ||
        importedTarget.batch_id === undefined ||
        importedTarget.batch_id !== importedTarget.storage_import_id ||
        importedTarget.completed_marker_id !== null
      )
        throw new Error("historical review import requires an active durable import batch");
    }
    if (!isStrictTimestamp(review.created_at))
      throw new Error("imported review created_at is invalid");
    if (!review.reviewed_at || !isStrictTimestamp(review.reviewed_at))
      throw new Error("imported review reviewed_at is invalid");
    const current = this.findById(review.record_id);
    if (!current) throw new Error("imported review record does not exist");
    if (Date.parse(review.created_at) < Date.parse(current.created_at))
      throw new Error("imported review predates its record");
    if (Date.parse(review.reviewed_at) < Date.parse(review.created_at))
      throw new Error("imported review reviewed_at predates created_at");
    const prior = this.listReviewHistory(review.record_id).at(-1);
    if (prior) {
      const priorBoundary = Math.max(
        Date.parse(prior.created_at),
        Date.parse(prior.reviewed_at || prior.created_at),
      );
      if (
        Date.parse(review.created_at) < priorBoundary ||
        Date.parse(review.reviewed_at) < priorBoundary
      )
        throw new Error("imported review violates event chronology");
    }
    const projectionBaseline = new Date(
      Math.max(
        Date.parse(current.updated_at ?? current.created_at),
        Date.parse(review.created_at),
        Date.parse(review.reviewed_at),
      ),
    ).toISOString();
    const projectionUpdatedAt = monotonicTimestamp(
      this.clock,
      projectionBaseline,
      "review projection",
    );
    return this.insertReview(review, projectionUpdatedAt);
  }

  listReviewHistory(recordId: string): RecordReview[] {
    return (
      this.database
        .prepare(
          `SELECT rr.*, reo.event_sequence
           FROM record_reviews rr
           JOIN review_event_order reo ON reo.review_id=rr.id
           WHERE rr.record_id=? ORDER BY reo.event_sequence`,
        )
        .all(recordId) as unknown as SqliteRow[]
    ).map(reviewFromRow);
  }

  getEffectiveReview(recordId: string): RecordReview | null {
    const row = this.database
      .prepare(
        `SELECT rr.*, reo.event_sequence
         FROM experiment_records er
         JOIN record_reviews rr ON rr.id=er.effective_review_id
         JOIN review_event_order reo ON reo.review_id=rr.id
         WHERE er.id=?`,
      )
      .get(recordId) as unknown as SqliteRow | undefined;
    return row ? reviewFromRow(row) : null;
  }

  private getReviewEvent(reviewId: string, recordId: string): RecordReview | null {
    const row = this.database
      .prepare(
        `SELECT rr.*,reo.event_sequence FROM record_reviews rr
         JOIN review_event_order reo ON reo.review_id=rr.id
         WHERE rr.id=? AND rr.record_id=?`,
      )
      .get(reviewId, recordId) as unknown as SqliteRow | undefined;
    return row ? reviewFromRow(row) : null;
  }

  /** Infrastructure-only capture; caller must own the same synchronous SQLite transaction. */
  captureAnalysisSelection(
    selection: AnalysisInputSelection,
    createdAt: string,
  ): CapturedAnalysisSnapshot {
    if (!inTransaction(this.database)) throw new Error("Analysis capture requires a transaction");
    const record = this.analysisRecordSnapshot(selection.record_id);
    if (!record) throw new Error("Analysis input record not found");
    const effectiveReview = this.getEffectiveReview(selection.record_id);
    if (this.recordHasUnverifiedSelectionEvidence(selection.record_id))
      throw new Error("Analysis input provenance is historically unverified");
    if (effectiveReview)
      validateReviewSnapshotV1Strict(effectiveReview, effectiveReview.id, selection.record_id);
    const requestedMode = selection.review_mode;
    const bindingMode = requestedMode ?? (effectiveReview ? "effective" : "none");
    if (selection.review_id && bindingMode !== "effective")
      throw new Error("Analysis input review_id contradicts the selected binding mode");
    if (bindingMode === "effective") {
      if (!effectiveReview) throw new Error("Effective review binding requires a current review");
      if (selection.review_id && selection.review_id !== effectiveReview.id)
        throw new Error("Analysis input review_id is not the current effective event");
    }
    if (bindingMode === "omit") {
      if (!effectiveReview) throw new Error("Cannot omit a review that does not exist");
      if (!hasNonBlankUnicodeText(selection.review_omission_reason))
        throw new Error("Reviewed analysis input requires an omission reason");
    }
    if (bindingMode === "none" && effectiveReview)
      throw new Error("None binding is invalid when an effective review exists");
    const review = bindingMode === "effective" ? effectiveReview : null;
    validateScientificRecordSnapshot(record, record.id);
    if (
      Date.parse(record.created_at) > Date.parse(createdAt) ||
      Date.parse(record.updated_at ?? record.created_at) > Date.parse(createdAt)
    )
      throw new Error("Analysis selection predates the selected record version");
    if (review) {
      validateReviewSnapshotV1Strict(review, review.id, record.id);
      validateAnalysisBindingV1(record, review, review);
      if (Date.parse(review.created_at) > Date.parse(createdAt))
        throw new Error("Analysis selection predates the bound review event");
    }
    return {
      record,
      review,
      bindingMode,
      omissionReason: bindingMode === "omit" ? (selection.review_omission_reason ?? null) : null,
      recordJson: JSON.stringify(record),
      reviewJson: review ? JSON.stringify(review) : null,
    };
  }

  createAnalysisRun(run: CreateAnalysisRunCommand, selections: AnalysisInputSelection[]): void {
    const id = boundedIdentity(run.id, "analysis run id");
    const datasetHash = boundedIdentity(run.dataset_hash, "analysis dataset hash");
    const algorithmVersion = boundedIdentity(run.algorithm_version, "analysis algorithm version");
    const codeVersion = boundedIdentity(run.code_version, "analysis code version");
    const configuration = serializeObject(run.configuration, "analysis run configuration");
    const createdAt = this.clock.now();
    if (!isStrictTimestamp(createdAt))
      throw new Error("analysis run clock returned an invalid timestamp");
    if (run.created_by_user_id) {
      boundedIdentity(run.created_by_user_id, "analysis run creator id");
      if (!this.database.prepare("SELECT 1 FROM users WHERE id=?").get(run.created_by_user_id))
        throw new Error("analysis run creator does not exist");
    }
    if (!Array.isArray(selections) || selections.length === 0)
      throw new Error("Analysis input selections must be a non-empty dense array");
    const selectedRecords = new Set<string>();
    for (let ordinal = 0; ordinal < selections.length; ordinal += 1) {
      if (!Object.hasOwn(selections, ordinal))
        throw new Error("Analysis input selections cannot contain sparse array holes");
      const selection = selections[ordinal];
      if (!selection) throw new Error("Analysis input selection is missing");
      boundedIdentity(selection.record_id, "analysis input record id");
      boundedIdentity(selection.input_hash, "analysis input hash");
      if (selection.review_id) boundedIdentity(selection.review_id, "analysis input review id");
      if (selectedRecords.has(selection.record_id))
        throw new Error("Analysis input selections cannot contain a duplicate record");
      selectedRecords.add(selection.record_id);
      if (
        selection.review_mode === "omit" &&
        !hasNonBlankUnicodeText(selection.review_omission_reason)
      )
        throw new Error("Reviewed analysis input requires a non-blank omission reason");
    }
    transaction(this.database, () => {
      const hasInputsSealed = this.tableHasColumn("analysis_runs", "inputs_sealed");
      this.database
        .prepare(
          hasInputsSealed
            ? `INSERT INTO analysis_runs(
                id,dataset_hash,algorithm_version,configuration_json,code_version,
                status,results_metadata_json,created_by_user_id,created_at,completed_at,inputs_sealed
              ) VALUES(?,?,?,?,?,?,?,?,?,?,0)`
            : `INSERT INTO analysis_runs(
                id,dataset_hash,algorithm_version,configuration_json,code_version,
                status,results_metadata_json,created_by_user_id,created_at,completed_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          datasetHash,
          algorithmVersion,
          configuration,
          codeVersion,
          "pending",
          "{}",
          run.created_by_user_id || null,
          createdAt,
          null,
        );
      const hasDurableBindingColumns = this.tableHasColumn(
        "analysis_inputs",
        "review_binding_mode",
      );
      const insert = this.database.prepare(
        hasDurableBindingColumns
          ? `INSERT INTO analysis_inputs(
              analysis_run_id, ordinal, record_id, review_id, input_hash,
              record_snapshot_json, review_snapshot_json, snapshot_schema,
              review_binding_mode, review_omission_reason
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          : `INSERT INTO analysis_inputs(
              analysis_run_id, ordinal, record_id, review_id, input_hash,
              record_snapshot_json, review_snapshot_json, snapshot_schema
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (let ordinal = 0; ordinal < selections.length; ordinal += 1) {
        const selection = selections[ordinal]!;
        const captured = this.captureAnalysisSelection(selection, createdAt);
        const { record, review, bindingMode } = captured;
        const values = [
          id,
          ordinal,
          record.id,
          review?.id || null,
          selection.input_hash,
          captured.recordJson,
          captured.reviewJson,
          ANALYSIS_SNAPSHOT_V1,
        ] as Array<string | number | null>;
        if (hasDurableBindingColumns) {
          values.push(bindingMode);
          values.push(bindingMode === "omit" ? (selection.review_omission_reason ?? null) : null);
        } else if (bindingMode === "omit") {
          throw new Error("Durable review omission requires schema migration 005");
        }
        insert.run(...values);
      }
      if (hasInputsSealed) {
        const sealed = this.database
          .prepare(
            "UPDATE analysis_runs SET inputs_sealed=1 WHERE id=? AND status='pending' AND inputs_sealed=0",
          )
          .run(id);
        if (Number(sealed.changes) !== 1) throw new RepositoryConflictError();
      }
    });
  }

  findAnalysisRun(id: string): AnalysisRun | null {
    const row = this.database
      .prepare("SELECT * FROM analysis_runs WHERE id=?")
      .get(id) as unknown as SqliteRow | undefined;
    if (!row) return null;
    const legacyOffsetFields = new Set<string>();
    const ledger = this.database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='provenance_boundary_classifications'",
      )
      .get();
    if (ledger) {
      const classifications = this.database
        .prepare(
          `SELECT field_name FROM provenance_boundary_classifications pbc
           WHERE pbc.entity_type='run' AND pbc.entity_id=?
             AND pbc.classification='legacy_offset_timestamp'
             AND NOT EXISTS(
               SELECT 1 FROM provenance_boundary_classifications invalid
               WHERE invalid.entity_type=pbc.entity_type AND invalid.entity_id=pbc.entity_id
                 AND invalid.field_name=pbc.field_name
                 AND invalid.classification LIKE '%unverified'
             )`,
        )
        .all(id) as unknown as Array<{ field_name: string }>;
      for (const classification of classifications)
        if (
          classification.field_name === "created_at" ||
          classification.field_name === "completed_at"
        )
          legacyOffsetFields.add(classification.field_name);
    }
    const run = analysisRunFromRow(row, legacyOffsetFields);
    if (
      run.created_by_user_id &&
      !this.database.prepare("SELECT 1 FROM users WHERE id=?").get(run.created_by_user_id)
    )
      throw new RepositoryCorruptionError("Analysis run creator reference is corrupt");
    return run;
  }

  updateAnalysisRunState(id: string, update: AnalysisRunStateUpdate): AnalysisRun | null {
    const current = this.findAnalysisRun(id);
    if (!current) return null;
    const transitions: Record<AnalysisRun["status"], ReadonlySet<AnalysisRun["status"]>> = {
      pending: new Set(["pending", "running", "completed", "failed"]),
      running: new Set(["running", "completed", "failed"]),
      completed: new Set(["completed"]),
      failed: new Set(["failed"]),
    };
    if (!transitions[current.status].has(update.status))
      throw new Error(`Invalid analysis run transition from ${current.status} to ${update.status}`);
    const resultsMetadata = serializeObject(
      update.results_metadata,
      "analysis run results metadata",
    );
    if (current.status === "completed" || current.status === "failed") {
      if (
        update.status === current.status &&
        resultsMetadata ===
          serializeObject(current.results_metadata, "stored analysis run results metadata")
      )
        return current;
      throw new Error("Terminal analysis results are immutable");
    }
    const terminal = update.status === "completed" || update.status === "failed";
    const completedAt = terminal ? (current.completed_at ?? this.clock.now()) : undefined;
    if (
      completedAt !== undefined &&
      (!isStrictTimestamp(completedAt) || Date.parse(completedAt) < Date.parse(current.created_at))
    )
      throw new Error("Analysis run completed_at is invalid");
    const result = this.database
      .prepare(
        `UPDATE analysis_runs SET status=?, results_metadata_json=?, completed_at=?
         WHERE id=? AND status=?`,
      )
      .run(update.status, resultsMetadata, completedAt ?? null, id, current.status);
    if (Number(result.changes) !== 1) throw new RepositoryConflictError();
    return this.findAnalysisRun(id);
  }

  listAnalysisInputs(runId: string): AnalysisInput[] {
    boundedIdentity(runId, "analysis run id");
    const runRow = this.database
      .prepare("SELECT * FROM analysis_runs WHERE id=?")
      .get(runId) as unknown as SqliteRow | undefined;
    const rows = this.database
      .prepare("SELECT * FROM analysis_inputs WHERE analysis_run_id=? ORDER BY ordinal")
      .all(runId) as unknown as SqliteRow[];
    const inputs = rows.map((row) => {
      if (row.snapshot_schema !== ANALYSIS_SNAPSHOT_V1)
        throw new RepositoryCorruptionError("Legacy or unknown analysis snapshot schema");
      try {
        boundedIdentity(row.analysis_run_id, "analysis input run id");
        const recordId = String(row.record_id);
        boundedIdentity(recordId, "analysis input record id");
        boundedIdentity(row.input_hash, "analysis input hash");
        const reviewId = row.review_id ? String(row.review_id) : undefined;
        if (reviewId) boundedIdentity(reviewId, "analysis input review id");
        const recordSnapshot = validateRecordSnapshotV1Strict(row.record_snapshot_json, recordId);
        const reviewSnapshot = reviewId
          ? validateReviewSnapshotV1Strict(row.review_snapshot_json, reviewId, recordId)
          : undefined;
        const bindingMode = (
          row.review_binding_mode
            ? String(row.review_binding_mode)
            : reviewSnapshot
              ? "effective"
              : "none"
        ) as AnalysisInput["review_binding_mode"];
        const omissionReason =
          row.review_omission_reason === null || row.review_omission_reason === undefined
            ? undefined
            : String(row.review_omission_reason);
        if (!(["effective", "omit", "none"] as string[]).includes(bindingMode))
          throw new SnapshotContractError("analysis review binding mode is invalid");
        if (bindingMode === "effective" && (!reviewSnapshot || omissionReason !== undefined))
          throw new SnapshotContractError(
            "effective binding requires a review snapshot without an omission reason",
          );
        if (bindingMode === "omit" && (!hasNonBlankUnicodeText(omissionReason) || reviewSnapshot))
          throw new SnapshotContractError("omitted binding requires a durable reason only");
        if (bindingMode === "none" && (reviewSnapshot || omissionReason))
          throw new SnapshotContractError("none binding cannot carry review provenance");
        if (reviewSnapshot) {
          const durable = this.getReviewEvent(reviewId!, recordId);
          if (!durable)
            throw new SnapshotContractError(
              "bound review event is missing or belongs to another record",
            );
          validateAnalysisBindingV1(recordSnapshot, reviewSnapshot, durable);
        } else if (bindingMode === "omit") {
          if (!recordSnapshot.effective_review_id)
            throw new SnapshotContractError("omitted binding requires a review at selection time");
          const durable = this.getReviewEvent(recordSnapshot.effective_review_id, recordId);
          if (!durable)
            throw new SnapshotContractError("omitted review projection has no durable event");
          validateAnalysisBindingV1(recordSnapshot, durable, durable);
        } else {
          if (
            recordSnapshot.effective_review_id ||
            recordSnapshot.review_status === "included" ||
            recordSnapshot.review_status === "excluded"
          )
            throw new SnapshotContractError("none binding contains a review projection");
          const currentReview = this.getEffectiveReview(recordId);
          const currentRecord = this.findByIdIncludingDeleted(recordId);
          if (
            !currentReview &&
            currentRecord &&
            (recordSnapshot.effective_review_id ?? undefined) !==
              (currentRecord.effective_review_id ?? undefined)
          )
            throw new SnapshotContractError("none binding effective review projection is forged");
          if (
            !currentReview &&
            currentRecord &&
            (recordSnapshot.review_status !== currentRecord.review_status ||
              recordSnapshot.review_note !== currentRecord.review_note ||
              recordSnapshot.reviewed_by !== currentRecord.reviewed_by ||
              recordSnapshot.reviewed_at !== currentRecord.reviewed_at)
          )
            throw new SnapshotContractError("none binding review projection is forged");
        }
        return {
          analysis_run_id: String(row.analysis_run_id),
          ordinal: Number(row.ordinal),
          record_id: String(row.record_id),
          review_id: row.review_id ? String(row.review_id) : undefined,
          input_hash: String(row.input_hash),
          snapshot_schema: ANALYSIS_SNAPSHOT_V1,
          record_snapshot: recordSnapshot,
          review_snapshot: reviewSnapshot,
          review_binding_mode: bindingMode,
          review_omission_reason: omissionReason,
        };
      } catch (error) {
        if (error instanceof SnapshotContractError)
          throw new RepositoryCorruptionError(error.message);
        throw error;
      }
    });
    if (runRow && Number(runRow.inputs_sealed) === 1) {
      const classification =
        runRow.dataset_classification === undefined
          ? "exact"
          : String(runRow.dataset_classification);
      if (classification === "exact") {
        if (
          inputs.length === 0 ||
          inputs.some((input, ordinal) => input.ordinal !== ordinal) ||
          new Set(inputs.map((input) => input.record_id)).size !== inputs.length
        )
          throw new RepositoryCorruptionError(
            "Sealed exact analysis dataset is empty, non-contiguous or repeats a record",
          );
      }
    }
    return inputs;
  }
}
