import type { DatabaseSync } from "node:sqlite";
import type { ExperimentRecord, RecordReview } from "../../../domain/types.js";
import { isStrictTimestamp } from "../../../shared/strict-timestamp.js";
import {
  ANALYSIS_SNAPSHOT_LEGACY,
  ANALYSIS_SNAPSHOT_V1,
  validateAnalysisBindingV1,
  validateRecordSnapshotV1,
  validateReviewSnapshotV1,
} from "../analysis-snapshot-v1.js";
import type { Migration } from "./types.js";

type Row = Record<string, unknown>;

const MAX_IDENTITY = 256;

function object(value: unknown, label: string): Row {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Row;
  } catch {
    throw new Error(`${label} must be a JSON object`);
  }
}

function bounded(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_IDENTITY &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function terminal(status: string): boolean {
  return status === "completed" || status === "failed";
}

function preflightRuns(database: DatabaseSync): void {
  const invalid: string[] = [];
  const rows = database.prepare("SELECT * FROM analysis_runs ORDER BY id").all() as Row[];
  for (const row of rows) {
    const id = String(row.id);
    const status = String(row.status);
    const createdAt = String(row.created_at);
    const completedAt = row.completed_at === null ? undefined : String(row.completed_at);
    let validJson = true;
    try {
      object(row.configuration_json, "configuration");
      object(row.results_metadata_json, "results metadata");
    } catch {
      validJson = false;
    }
    const creatorValid =
      row.created_by_user_id === null ||
      (bounded(row.created_by_user_id) &&
        Boolean(
          database.prepare("SELECT 1 FROM users WHERE id=?").get(String(row.created_by_user_id)),
        ));
    const stateValid =
      (["pending", "running", "completed", "failed"] as string[]).includes(status) &&
      (terminal(status)
        ? completedAt !== undefined &&
          isStrictTimestamp(completedAt) &&
          isStrictTimestamp(createdAt) &&
          Date.parse(completedAt) >= Date.parse(createdAt)
        : completedAt === undefined);
    if (
      !bounded(row.id) ||
      !bounded(row.dataset_hash) ||
      !bounded(row.algorithm_version) ||
      !bounded(row.code_version) ||
      !isStrictTimestamp(createdAt) ||
      !validJson ||
      !creatorValid ||
      !stateValid
    )
      invalid.push(id);
  }
  if (invalid.length) throw new Error(`Migration 007 invalid analysis runs: ${invalid.join(", ")}`);
}

function reviewFromRow(row: Row): RecordReview {
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

function reviewEvent(database: DatabaseSync, id: string, recordId: string): RecordReview | null {
  const row = database
    .prepare(
      `SELECT rr.*,reo.event_sequence FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       WHERE rr.id=? AND rr.record_id=?`,
    )
    .get(id, recordId) as Row | undefined;
  return row ? reviewFromRow(row) : null;
}

function wasEffectiveAt(
  database: DatabaseSync,
  event: RecordReview,
  runCreatedAt: string,
): boolean {
  if (
    !isStrictTimestamp(event.created_at) ||
    Date.parse(event.created_at) > Date.parse(runCreatedAt)
  )
    return false;
  return !database
    .prepare(
      `SELECT 1 FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       WHERE rr.record_id=? AND reo.event_sequence>?
         AND julianday(rr.created_at)<=julianday(?) LIMIT 1`,
    )
    .get(event.record_id, event.event_sequence ?? 0, runCreatedAt);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function currentRecord(database: DatabaseSync, recordId: string): ExperimentRecord | null {
  const row = database.prepare("SELECT * FROM experiment_records WHERE id=?").get(recordId) as
    Row | undefined;
  if (!row) return null;
  const metadata = object(row.metadata_json, `Record ${recordId} metadata`);
  if (row.client_submission_id) {
    metadata.client_submission_id = String(row.client_submission_id);
    if (row.created_by_user_id) metadata.idempotency_actor_id = String(row.created_by_user_id);
    metadata.idempotency_class_name = String(row.class_name_snapshot);
  }
  return {
    id: String(row.id),
    client_submission_id: row.client_submission_id ? String(row.client_submission_id) : undefined,
    created_by_user_id: row.created_by_user_id ? String(row.created_by_user_id) : undefined,
    class_id: String(row.class_id),
    group_id: row.group_id ? String(row.group_id) : undefined,
    experiment_type: String(row.experiment_type),
    status: String(row.status) as ExperimentRecord["status"],
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
    petri_diameter_mm: row.petri_diameter_mm === null ? undefined : Number(row.petri_diameter_mm),
    measurement_method: String(row.measurement_method) as ExperimentRecord["measurement_method"],
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
    metadata: metadata as Record<string, string | number | boolean | null>,
  };
}

const EXACT_RECORD_FIELDS: readonly (keyof ExperimentRecord)[] = [
  "id",
  "client_submission_id",
  "created_by_user_id",
  "class_id",
  "group_id",
  "experiment_type",
  "status",
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
  "yield_percent",
  "created_at",
  "created_by",
  "synced_from_offline",
  "ai_diagnosis",
  "metadata",
];

function recordDifferences(snapshot: ExperimentRecord, durable: ExperimentRecord): string[] {
  return EXACT_RECORD_FIELDS.filter(
    (field) => canonical(snapshot[field]) !== canonical(durable[field]),
  ).map(String);
}

function revalidateInputs(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT ai.*,ar.created_at AS run_created_at
       FROM analysis_inputs ai JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
       ORDER BY ai.analysis_run_id,ai.ordinal`,
    )
    .all() as Row[];
  const definite: string[] = [];
  const downgrade: Array<[string, number]> = [];
  for (const row of rows) {
    const runId = String(row.analysis_run_id);
    const ordinal = Number(row.ordinal);
    const label = `${runId}:${ordinal}`;
    if (!bounded(row.record_id) || !bounded(row.input_hash)) {
      definite.push(label);
      continue;
    }
    if (row.snapshot_schema !== ANALYSIS_SNAPSHOT_V1) continue;
    try {
      const recordId = String(row.record_id);
      const runCreatedAt = String(row.run_created_at);
      const snapshot = validateRecordSnapshotV1(row.record_snapshot_json, recordId);
      const durable = currentRecord(database, recordId);
      if (!durable) throw new Error("missing durable record");
      const differences = recordDifferences(snapshot, durable);
      if (differences.length) {
        if (Date.parse(durable.updated_at ?? durable.created_at) <= Date.parse(runCreatedAt)) {
          definite.push(`${label}[${differences.join("|")}]`);
          continue;
        }
        throw new Error("later record edits prevent exact historical proof");
      }
      if (snapshot.updated_at !== durable.updated_at) {
        const laterReviewProjection = database
          .prepare(
            `SELECT 1 FROM record_reviews
             WHERE record_id=? AND created_at=? AND julianday(created_at)>julianday(?) LIMIT 1`,
          )
          .get(recordId, durable.updated_at ?? durable.created_at, runCreatedAt);
        if (!laterReviewProjection) {
          if (Date.parse(durable.updated_at ?? durable.created_at) <= Date.parse(runCreatedAt)) {
            definite.push(`${label}[updated_at]`);
            continue;
          }
          throw new Error("later record version prevents exact historical proof");
        }
      }
      if (
        Date.parse(snapshot.created_at) > Date.parse(runCreatedAt) ||
        Date.parse(snapshot.updated_at ?? snapshot.created_at) > Date.parse(runCreatedAt)
      )
        throw new Error("snapshot version postdates run");
      const mode = String(row.review_binding_mode);
      if (mode === "effective") {
        const reviewId = String(row.review_id ?? "");
        const review = validateReviewSnapshotV1(row.review_snapshot_json, reviewId, recordId);
        const event = reviewEvent(database, reviewId, recordId);
        if (!event || !wasEffectiveAt(database, event, runCreatedAt)) throw new Error();
        validateAnalysisBindingV1(snapshot, review, event);
      } else if (mode === "omit") {
        if (!String(row.review_omission_reason ?? "").trim() || !snapshot.effective_review_id)
          throw new Error();
        const event = reviewEvent(database, snapshot.effective_review_id, recordId);
        if (!event || !wasEffectiveAt(database, event, runCreatedAt)) throw new Error();
        validateAnalysisBindingV1(snapshot, event, event);
      } else if (mode === "none") {
        if (
          snapshot.effective_review_id ||
          snapshot.review_status === "included" ||
          snapshot.review_status === "excluded"
        )
          throw new Error();
        if (
          database
            .prepare(
              "SELECT 1 FROM record_reviews WHERE record_id=? AND julianday(created_at)<=julianday(?) LIMIT 1",
            )
            .get(recordId, runCreatedAt)
        )
          throw new Error();
      } else throw new Error();
    } catch {
      downgrade.push([runId, ordinal]);
    }
  }
  if (definite.length)
    throw new Error(`Migration 007 definite analysis input corruption: ${definite.join(", ")}`);
  database.exec(`
    DROP TRIGGER IF EXISTS analysis_inputs_insert_contract;
    DROP TRIGGER IF EXISTS analysis_inputs_no_update;
    DROP TRIGGER IF EXISTS analysis_inputs_no_delete;
  `);
  const update = database.prepare(
    `UPDATE analysis_inputs SET snapshot_schema=?,review_binding_mode='legacy_unspecified',
      review_omission_reason=NULL WHERE analysis_run_id=? AND ordinal=?`,
  );
  for (const [runId, ordinal] of downgrade) update.run(ANALYSIS_SNAPSHOT_LEGACY, runId, ordinal);
}

function validTimestampSql(expression: string, allowEmpty = false): string {
  const valid = `(typeof(${expression})='text' AND length(${expression}) BETWEEN 20 AND 35
    AND substr(${expression},5,1)='-' AND substr(${expression},8,1)='-'
    AND substr(${expression},11,1)='T' AND substr(${expression},14,1)=':'
    AND substr(${expression},17,1)=':'
    AND date(substr(${expression},1,10),'+0 days')=substr(${expression},1,10)
    AND CAST(substr(${expression},12,2) AS INTEGER) BETWEEN 0 AND 23
    AND CAST(substr(${expression},15,2) AS INTEGER) BETWEEN 0 AND 59
    AND CAST(substr(${expression},18,2) AS INTEGER) BETWEEN 0 AND 59
    AND julianday(${expression}) IS NOT NULL)`;
  return allowEmpty ? `(${expression}='' OR ${valid})` : valid;
}

function installRunContract(database: DatabaseSync): void {
  const created = validTimestampSql("NEW.created_at");
  const completed = validTimestampSql("NEW.completed_at");
  database.exec(`
    DROP TRIGGER IF EXISTS analysis_runs_identity_guard;
    DROP TRIGGER IF EXISTS analysis_runs_insert_contract;
    DROP TRIGGER IF EXISTS analysis_runs_update_contract;

    CREATE TRIGGER analysis_runs_insert_contract BEFORE INSERT ON analysis_runs
    WHEN typeof(NEW.id)<>'text' OR trim(NEW.id)='' OR length(NEW.id)>${MAX_IDENTITY}
      OR typeof(NEW.dataset_hash)<>'text' OR trim(NEW.dataset_hash)=''
        OR length(NEW.dataset_hash)>${MAX_IDENTITY}
      OR typeof(NEW.algorithm_version)<>'text' OR trim(NEW.algorithm_version)=''
        OR length(NEW.algorithm_version)>${MAX_IDENTITY}
      OR typeof(NEW.code_version)<>'text' OR trim(NEW.code_version)=''
        OR length(NEW.code_version)>${MAX_IDENTITY}
      OR json_valid(NEW.configuration_json)=0 OR json_type(NEW.configuration_json)<>'object'
      OR json_valid(NEW.results_metadata_json)=0 OR json_type(NEW.results_metadata_json)<>'object'
      OR NEW.status<>'pending' OR NEW.completed_at IS NOT NULL OR NOT ${created}
      OR (NEW.created_by_user_id IS NOT NULL AND (
        typeof(NEW.created_by_user_id)<>'text' OR trim(NEW.created_by_user_id)=''
        OR length(NEW.created_by_user_id)>${MAX_IDENTITY}
        OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by_user_id)
      ))
    BEGIN SELECT RAISE(ABORT,'analysis run creation contract violation'); END;

    CREATE TRIGGER analysis_runs_identity_guard
    BEFORE UPDATE OF id,dataset_hash,algorithm_version,configuration_json,code_version,
      created_by_user_id,created_at ON analysis_runs
    WHEN NEW.id IS NOT OLD.id OR NEW.dataset_hash IS NOT OLD.dataset_hash
      OR NEW.algorithm_version IS NOT OLD.algorithm_version
      OR NEW.configuration_json IS NOT OLD.configuration_json
      OR NEW.code_version IS NOT OLD.code_version
      OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT,'analysis run identity and creator are immutable'); END;

    CREATE TRIGGER analysis_runs_update_contract
    BEFORE UPDATE OF status,results_metadata_json,completed_at ON analysis_runs
    WHEN json_valid(NEW.results_metadata_json)=0 OR json_type(NEW.results_metadata_json)<>'object'
      OR NOT ${created}
      OR (NEW.status IN ('pending','running') AND NEW.completed_at IS NOT NULL)
      OR (NEW.status IN ('completed','failed') AND (
        NEW.completed_at IS NULL OR NOT ${completed}
        OR julianday(NEW.completed_at)<julianday(NEW.created_at)
      ))
      OR (OLD.status='pending' AND NEW.status NOT IN ('pending','running','completed','failed'))
      OR (OLD.status='running' AND NEW.status NOT IN ('running','completed','failed'))
      OR (OLD.status='completed' AND NEW.status<>'completed')
      OR (OLD.status='failed' AND NEW.status<>'failed')
    BEGIN SELECT RAISE(ABORT,'analysis run state transition contract violation'); END;
  `);
}

function installInputContract(database: DatabaseSync): void {
  const snapshot = "NEW.record_snapshot_json";
  const j = (field: string) => `json_extract(${snapshot},'$.${field}')`;
  const t = (field: string) => `json_type(${snapshot},'$.${field}')`;
  const requiredStrings = [
    "id",
    "student_name",
    "class_name",
    "group_name",
    "emulsification_level",
    "ecoli_observation_group",
    "error_source",
    "note",
    "measurement_method",
    "status",
    "created_at",
    "updated_at",
    "created_by",
    "review_status",
    "review_note",
    "reviewed_at",
    "reviewed_by",
    "ai_diagnosis",
  ];
  const numeric = [
    "nh4cl_concentration",
    "peel_mass",
    "oil_mass",
    "distillation_time",
    "phase_clarity_score",
    "emulsion_concentration",
    "inhibition_zone_diameter",
    "colony_growth_score",
    "yield_percent",
  ];
  const presence = [
    ...requiredStrings.map((field) => `${t(field)} IS NOT 'text'`),
    ...numeric.map((field) => `${t(field)} IS NULL OR ${t(field)} NOT IN ('integer','real')`),
    `${t("异常标记")} IS NULL OR ${t("异常标记")} NOT IN ('true','false')`,
    `${t("synced_from_offline")} IS NULL OR ${t("synced_from_offline")} NOT IN ('true','false')`,
    `${t("metadata")} IS NOT 'object'`,
  ].join("\n      OR ");
  const created = validTimestampSql(j("created_at"));
  const updated = validTimestampSql(j("updated_at"));
  const reviewed = validTimestampSql(j("reviewed_at"), true);
  const expectedMetadata = `CASE WHEN er.client_submission_id IS NOT NULL THEN
    json_set(json(er.metadata_json),'$.client_submission_id',er.client_submission_id,
      '$.idempotency_actor_id',er.created_by_user_id,
      '$.idempotency_class_name',er.class_name_snapshot)
    ELSE json(er.metadata_json) END`;
  database.exec(`
    CREATE TRIGGER analysis_inputs_insert_contract BEFORE INSERT ON analysis_inputs
    WHEN typeof(NEW.analysis_run_id)<>'text' OR trim(NEW.analysis_run_id)=''
      OR length(NEW.analysis_run_id)>${MAX_IDENTITY}
      OR typeof(NEW.record_id)<>'text' OR trim(NEW.record_id)=''
      OR length(NEW.record_id)>${MAX_IDENTITY}
      OR typeof(NEW.input_hash)<>'text' OR trim(NEW.input_hash)=''
      OR length(NEW.input_hash)>${MAX_IDENTITY}
      OR NEW.snapshot_schema<>'${ANALYSIS_SNAPSHOT_V1}'
      OR json_valid(${snapshot})=0
      OR ${presence}
      OR trim(${j("id")})='' OR ${j("id")} IS NOT NEW.record_id
      OR ${j("nh4cl_concentration")} NOT IN (0,1,3,4)
      OR ${j("peel_mass")}<=0 OR ${j("peel_mass")}>1000
      OR ${j("oil_mass")}<0 OR ${j("oil_mass")}>20
      OR ${j("distillation_time")}<=0 OR ${j("distillation_time")}>1440
      OR ${j("phase_clarity_score")}<1 OR ${j("phase_clarity_score")}>5
      OR ${j("emulsion_concentration")}<0 OR ${j("emulsion_concentration")}>100
      OR ${j("inhibition_zone_diameter")}<0 OR ${j("inhibition_zone_diameter")}>60
      OR ${j("colony_growth_score")}<1 OR ${j("colony_growth_score")}>5
      OR abs(${j("yield_percent")}-round((${j("oil_mass")}*100.0)/${j("peel_mass")},2))>0.000001
      OR ${j("measurement_method")} NOT IN (
        'not_recorded','not_recorded_legacy','manual_direct','manual_local_image_calibrated')
      OR (${j("measurement_method")}='manual_local_image_calibrated' AND (
        ${t("petri_diameter_mm")} IS NULL
        OR ${t("petri_diameter_mm")} NOT IN ('integer','real')
        OR ${j("petri_diameter_mm")}<=0 OR ${j("petri_diameter_mm")}>500))
      OR (${t("petri_diameter_mm")} IS NOT NULL AND (
        ${t("petri_diameter_mm")} NOT IN ('integer','real')
        OR ${j("petri_diameter_mm")}<=0 OR ${j("petri_diameter_mm")}>500))
      OR (${t("experiment_date")} IS NOT NULL AND (
        ${t("experiment_date")} IS NOT 'text'
        OR date(${j("experiment_date")},'+0 days') IS NOT ${j("experiment_date")}))
      OR ${j("status")} NOT IN ('active','deleted')
      OR ${j("review_status")} NOT IN ('normal','review','included','excluded')
      OR NOT ${created} OR NOT ${updated}
      OR julianday(${j("updated_at")})<julianday(${j("created_at")})
      OR NOT ${reviewed}
      OR trim(${j("created_by")})=''
      OR (${t("created_by_user_id")} IS NOT NULL AND (
        ${t("created_by_user_id")} IS NOT 'text' OR trim(${j("created_by_user_id")})=''
        OR NOT EXISTS(SELECT 1 FROM users WHERE id=${j("created_by_user_id")})))
      OR (${t("effective_review_id")} IS NOT NULL AND (
        ${t("effective_review_id")} IS NOT 'text' OR trim(${j("effective_review_id")})=''))
      OR NOT EXISTS(
        SELECT 1 FROM experiment_records er JOIN analysis_runs ar
        WHERE er.id=NEW.record_id
          AND julianday(er.created_at)<=julianday(ar.created_at)
          AND julianday(er.updated_at)<=julianday(ar.created_at)
          AND ${j("student_name")} IS er.student_name
          AND ${j("class_name")} IS er.class_name_snapshot
          AND ${j("group_name")} IS er.group_name_snapshot
          AND ${j("nh4cl_concentration")} IS er.nh4cl_concentration
          AND ${j("peel_mass")} IS er.peel_mass AND ${j("oil_mass")} IS er.oil_mass
          AND ${j("distillation_time")} IS er.distillation_time
          AND ${j("phase_clarity_score")} IS er.phase_clarity_score
          AND ${j("emulsification_level")} IS er.emulsification_level
          AND ${j("emulsion_concentration")} IS er.emulsion_concentration
          AND ${j("ecoli_observation_group")} IS er.ecoli_observation_group
          AND ${j("inhibition_zone_diameter")} IS er.inhibition_zone_diameter
          AND ${j("colony_growth_score")} IS er.colony_growth_score
          AND ${j("异常标记")} IS er.anomaly_flag
          AND ${j("error_source")} IS er.error_source AND ${j("note")} IS er.note
          AND COALESCE(${j("experiment_date")},'') IS COALESCE(er.experiment_date,'')
          AND COALESCE(${j("petri_diameter_mm")},-1) IS COALESCE(er.petri_diameter_mm,-1)
          AND ${j("measurement_method")} IS er.measurement_method
          AND ${j("yield_percent")} IS er.yield_percent
          AND ${j("status")} IS er.status
          AND ${j("created_at")} IS er.created_at AND ${j("updated_at")} IS er.updated_at
          AND ${j("created_by")} IS er.created_by_label
          AND COALESCE(${j("created_by_user_id")},'') IS COALESCE(er.created_by_user_id,'')
          AND COALESCE(${j("class_id")},'') IS COALESCE(er.class_id,'')
          AND COALESCE(${j("group_id")},'') IS COALESCE(er.group_id,'')
          AND COALESCE(${j("experiment_type")},'') IS COALESCE(er.experiment_type,'')
          AND COALESCE(${j("client_submission_id")},'') IS COALESCE(er.client_submission_id,'')
          AND ${j("synced_from_offline")} IS er.synced_from_offline
          AND ${j("ai_diagnosis")} IS er.ai_diagnosis
          AND json(${j("metadata")})=${expectedMetadata}
      )
      OR (NEW.review_binding_mode='effective' AND (
        NEW.review_id IS NULL OR NEW.review_snapshot_json IS NULL
        OR NEW.review_omission_reason IS NOT NULL
        OR NEW.review_id<>(SELECT effective_review_id FROM experiment_records WHERE id=NEW.record_id)
        OR NOT EXISTS(
          SELECT 1 FROM record_reviews rr JOIN review_event_order reo ON reo.review_id=rr.id
          JOIN analysis_runs ar ON ar.id=NEW.analysis_run_id
          WHERE rr.id=NEW.review_id AND rr.record_id=NEW.record_id
            AND julianday(rr.created_at)<=julianday(ar.created_at)
            AND reo.event_sequence=(SELECT MAX(reo2.event_sequence)
              FROM record_reviews rr2 JOIN review_event_order reo2 ON reo2.review_id=rr2.id
              WHERE rr2.record_id=NEW.record_id)
            AND json_valid(NEW.review_snapshot_json)=1
            AND json_extract(NEW.review_snapshot_json,'$.id') IS rr.id
            AND json_extract(NEW.review_snapshot_json,'$.record_id') IS rr.record_id
            AND json_extract(NEW.review_snapshot_json,'$.status') IS rr.decision
            AND json_extract(NEW.review_snapshot_json,'$.note') IS rr.reason
            AND json_extract(NEW.review_snapshot_json,'$.reviewed_by') IS rr.reviewer_label
            AND json_extract(NEW.review_snapshot_json,'$.reviewed_at') IS COALESCE(rr.decided_at,'')
            AND json_extract(NEW.review_snapshot_json,'$.created_at') IS rr.created_at
            AND json_extract(NEW.review_snapshot_json,'$.provenance_kind') IS rr.provenance_kind
            AND COALESCE(json_extract(NEW.review_snapshot_json,'$.reviewer_user_id'),'')
              IS COALESCE(rr.reviewer_user_id,'')
            AND json_extract(NEW.review_snapshot_json,'$.event_sequence') IS reo.event_sequence
            AND ${j("effective_review_id")} IS rr.id
            AND ${j("review_status")} IS rr.decision
            AND ${j("review_note")} IS rr.reason
            AND ${j("reviewed_by")} IS rr.reviewer_label
            AND ${j("reviewed_at")} IS COALESCE(rr.decided_at,'')
        )
      ))
      OR (NEW.review_binding_mode='omit' AND (
        NEW.review_id IS NOT NULL OR NEW.review_snapshot_json IS NOT NULL
        OR NEW.review_omission_reason IS NULL OR trim(NEW.review_omission_reason)=''
        OR NOT EXISTS(
          SELECT 1 FROM experiment_records er JOIN record_reviews rr
          JOIN analysis_runs ar ON ar.id=NEW.analysis_run_id
          WHERE er.id=NEW.record_id AND rr.id=er.effective_review_id
            AND rr.record_id=NEW.record_id
            AND julianday(rr.created_at)<=julianday(ar.created_at)
            AND ${j("effective_review_id")} IS rr.id
            AND ${j("review_status")} IS rr.decision
            AND ${j("review_note")} IS rr.reason
            AND ${j("reviewed_by")} IS rr.reviewer_label
            AND ${j("reviewed_at")} IS COALESCE(rr.decided_at,'')
        )
      ))
      OR (NEW.review_binding_mode='none' AND (
        NEW.review_id IS NOT NULL OR NEW.review_snapshot_json IS NOT NULL
        OR NEW.review_omission_reason IS NOT NULL
        OR (SELECT effective_review_id FROM experiment_records WHERE id=NEW.record_id) IS NOT NULL
        OR ${j("effective_review_id")} IS NOT NULL
        OR ${j("review_status")} IN ('included','excluded')
      ))
      OR NEW.review_binding_mode='legacy_unspecified'
    BEGIN SELECT RAISE(ABORT,'analysis input exact selection contract violation'); END;

    CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
    CREATE TRIGGER analysis_inputs_no_delete BEFORE DELETE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
  `);
}

export const analysisSelectionAndRunIntegrityMigration: Migration = {
  version: 7,
  name: "analysis_selection_and_run_integrity",
  up(database) {
    preflightRuns(database);
    revalidateInputs(database);
    installRunContract(database);
    installInputContract(database);
  },
};
