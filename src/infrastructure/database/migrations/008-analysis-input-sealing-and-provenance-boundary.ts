import type { DatabaseSync } from "node:sqlite";
import type { RecordReview } from "../../../domain/types.js";
import { isBoundedPrintableIdentity } from "../../../shared/provenance-contract.js";
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

function isObjectJson(value: unknown): boolean {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function legacyOffsetTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function preflight(database: DatabaseSync): void {
  const corrupt: string[] = [];
  for (const row of database
    .prepare("SELECT id,metadata_json,created_at,updated_at FROM experiment_records")
    .all() as Row[]) {
    const id = String(row.id);
    if (!isBoundedPrintableIdentity(row.id)) corrupt.push(`record:${id}:id`);
    if (!isObjectJson(row.metadata_json)) corrupt.push(`record:${id}:metadata_json`);
    for (const field of ["created_at", "updated_at"] as const) {
      if (!isStrictTimestamp(row[field]) && !legacyOffsetTimestamp(row[field]))
        corrupt.push(`record:${id}:${field}`);
    }
    if (Date.parse(String(row.updated_at)) < Date.parse(String(row.created_at)))
      corrupt.push(`record:${id}:updated_at`);
  }
  for (const row of database.prepare("SELECT * FROM analysis_runs").all() as Row[]) {
    const id = String(row.id);
    for (const field of ["id", "dataset_hash", "algorithm_version", "code_version"] as const) {
      if (!isBoundedPrintableIdentity(row[field])) corrupt.push(`run:${id}:${field}`);
    }
    if (!isObjectJson(row.configuration_json)) corrupt.push(`run:${id}:configuration_json`);
    if (!isObjectJson(row.results_metadata_json)) corrupt.push(`run:${id}:results_metadata_json`);
    if (!isStrictTimestamp(row.created_at) && !legacyOffsetTimestamp(row.created_at))
      corrupt.push(`run:${id}:created_at`);
    if (
      row.completed_at !== null &&
      !isStrictTimestamp(row.completed_at) &&
      !legacyOffsetTimestamp(row.completed_at)
    )
      corrupt.push(`run:${id}:completed_at`);
    const terminal = row.status === "completed" || row.status === "failed";
    if (
      !(["pending", "running", "completed", "failed"] as unknown[]).includes(row.status) ||
      (terminal && row.completed_at === null) ||
      (!terminal && row.completed_at !== null) ||
      (row.completed_at !== null &&
        Date.parse(String(row.completed_at)) < Date.parse(String(row.created_at)))
    )
      corrupt.push(`run:${id}:state`);
  }
  const reviewRows = database
    .prepare(
      `SELECT rr.*,reo.event_sequence FROM record_reviews rr
       JOIN review_event_order reo ON reo.review_id=rr.id
       ORDER BY rr.record_id,reo.event_sequence`,
    )
    .all() as Row[];
  const priorReviewTime = new Map<string, number>();
  for (const row of reviewRows) {
    const id = String(row.id);
    if (!isBoundedPrintableIdentity(row.id)) corrupt.push(`review:${id}:id`);
    if (!isBoundedPrintableIdentity(row.record_id)) corrupt.push(`review:${id}:record_id`);
    if (row.reviewer_user_id !== null && !isBoundedPrintableIdentity(row.reviewer_user_id))
      corrupt.push(`review:${id}:reviewer_user_id`);
    for (const field of ["created_at", "decided_at"] as const) {
      if (
        row[field] !== null &&
        row[field] !== "" &&
        !isStrictTimestamp(row[field]) &&
        !legacyOffsetTimestamp(row[field])
      )
        corrupt.push(`review:${id}:${field}`);
    }
    const createdMillis = Date.parse(String(row.created_at));
    const decidedMillis = row.decided_at === null ? undefined : Date.parse(String(row.decided_at));
    const record = database
      .prepare("SELECT created_at FROM experiment_records WHERE id=?")
      .get(String(row.record_id)) as Row | undefined;
    if (!record || createdMillis < Date.parse(String(record.created_at)))
      corrupt.push(`review:${id}:record_chronology`);
    const prior = priorReviewTime.get(String(row.record_id));
    if (prior !== undefined && createdMillis < prior) corrupt.push(`review:${id}:event_chronology`);
    priorReviewTime.set(String(row.record_id), createdMillis);
    if (
      row.provenance_kind === "human" &&
      decidedMillis !== undefined &&
      decidedMillis < createdMillis
    )
      corrupt.push(`review:${id}:decided_at`);
    if (row.provenance_kind === "human") {
      const reviewer = database
        .prepare(
          `SELECT 1 FROM users WHERE id=? AND role IN ('teacher','admin')
           AND status IN ('active','demo') AND ? IN (username,name)`,
        )
        .get(String(row.reviewer_user_id ?? ""), String(row.reviewer_label));
      if (!reviewer || !row.decided_at) corrupt.push(`review:${id}:human_reviewer_boundary`);
    }
  }
  for (const row of database
    .prepare("SELECT analysis_run_id,ordinal,record_id,input_hash FROM analysis_inputs")
    .all() as Row[]) {
    const label = `${String(row.analysis_run_id)}:${String(row.ordinal)}`;
    if (!isBoundedPrintableIdentity(row.analysis_run_id))
      corrupt.push(`input:${label}:analysis_run_id`);
    if (!isBoundedPrintableIdentity(row.record_id)) corrupt.push(`input:${label}:record_id`);
    if (!isBoundedPrintableIdentity(row.input_hash)) corrupt.push(`input:${label}:input_hash`);
  }
  if (corrupt.length)
    throw new Error(`Migration 008 definite provenance corruption: ${corrupt.join(", ")}`);
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

function hasControlSql(expression: string): string {
  const controls = [...Array.from({ length: 32 }, (_, index) => index), 127];
  return `(${controls.map((code) => `instr(${expression},char(${code}))>0`).join(" OR ")})`;
}

function invalidIdentitySql(expression: string): string {
  return `(typeof(${expression})<>'text' OR trim(${expression})='' OR length(${expression})>256 OR ${hasControlSql(expression)})`;
}

function classifyHistoricalTimestamps(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE provenance_boundary_classifications (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      classification TEXT NOT NULL,
      observed_value TEXT NOT NULL,
      PRIMARY KEY(entity_type,entity_id,field_name)
    ) STRICT;
  `);
  const insert = database.prepare(
    `INSERT INTO provenance_boundary_classifications(
      entity_type,entity_id,field_name,classification,observed_value
    ) VALUES(?,?,?,'legacy_offset_timestamp',?)`,
  );
  const sources = [
    ["record", "experiment_records", "id", ["created_at", "updated_at"]],
    ["review", "record_reviews", "id", ["created_at", "decided_at"]],
    ["run", "analysis_runs", "id", ["created_at", "completed_at"]],
  ] as const;
  for (const [entity, table, idField, fields] of sources) {
    for (const row of database.prepare(`SELECT * FROM ${table}`).all() as Row[]) {
      for (const field of fields) {
        if (legacyOffsetTimestamp(row[field]))
          insert.run(entity, String(row[idField]), field, String(row[field]));
      }
    }
  }
}

function classifyHistoricalInputs(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT ai.*,ar.created_at AS run_created_at FROM analysis_inputs ai
       JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
       WHERE ai.snapshot_schema=? ORDER BY ai.analysis_run_id,ai.ordinal`,
    )
    .all(ANALYSIS_SNAPSHOT_V1) as Row[];
  database.exec(`
    DROP TRIGGER IF EXISTS analysis_inputs_no_update;
    DROP TRIGGER IF EXISTS analysis_inputs_no_delete;
  `);
  const downgrade = database.prepare(
    `UPDATE analysis_inputs SET snapshot_schema=?,review_binding_mode='legacy_unspecified',
      review_omission_reason=NULL WHERE analysis_run_id=? AND ordinal=?`,
  );
  for (const row of rows) {
    try {
      const recordId = String(row.record_id);
      const runTime = String(row.run_created_at);
      const record = validateRecordSnapshotV1(row.record_snapshot_json, recordId);
      const eventRow = database
        .prepare(
          `SELECT rr.*,reo.event_sequence FROM record_reviews rr
           JOIN review_event_order reo ON reo.review_id=rr.id
           WHERE rr.record_id=? AND julianday(rr.created_at)<=julianday(?)
           ORDER BY reo.event_sequence DESC LIMIT 1`,
        )
        .get(recordId, runTime) as Row | undefined;
      const event = eventRow ? reviewFromRow(eventRow) : undefined;
      const mode = String(row.review_binding_mode);
      if (mode === "effective") {
        if (!event || row.review_id !== event.id) throw new Error();
        const review = validateReviewSnapshotV1(row.review_snapshot_json, event.id, recordId);
        validateAnalysisBindingV1(record, review, event);
      } else if (mode === "omit") {
        if (
          !event ||
          row.review_id !== null ||
          row.review_snapshot_json !== null ||
          !String(row.review_omission_reason ?? "").trim()
        )
          throw new Error();
        validateAnalysisBindingV1(record, event, event);
      } else if (mode === "none") {
        if (
          event ||
          record.effective_review_id ||
          !(["normal", "review"] as string[]).includes(record.review_status) ||
          record.review_note !== "" ||
          record.reviewed_by !== "" ||
          record.reviewed_at !== ""
        )
          throw new Error();
      } else throw new Error();
    } catch {
      downgrade.run(ANALYSIS_SNAPSHOT_LEGACY, String(row.analysis_run_id), Number(row.ordinal));
    }
  }
  database.exec(`
    CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
    CREATE TRIGGER analysis_inputs_no_delete BEFORE DELETE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
  `);
}

function installRunSealing(database: DatabaseSync): void {
  const created = canonicalTimestampSql("NEW.created_at");
  const completed = canonicalTimestampSql("NEW.completed_at");
  database.exec(`
    ALTER TABLE analysis_runs ADD COLUMN inputs_sealed INTEGER NOT NULL DEFAULT 0 CHECK(inputs_sealed IN (0,1));
    UPDATE analysis_runs SET inputs_sealed=1;

    CREATE TRIGGER analysis_runs_008_insert_guard BEFORE INSERT ON analysis_runs
    WHEN NEW.inputs_sealed<>0
      OR ${invalidIdentitySql("NEW.id")}
      OR ${invalidIdentitySql("NEW.dataset_hash")}
      OR ${invalidIdentitySql("NEW.algorithm_version")}
      OR ${invalidIdentitySql("NEW.code_version")}
      OR NOT ${created}
    BEGIN SELECT RAISE(ABORT,'analysis run 008 creation contract violation'); END;

    CREATE TRIGGER analysis_runs_seal_guard BEFORE UPDATE OF inputs_sealed ON analysis_runs
    WHEN NOT (OLD.inputs_sealed=0 AND NEW.inputs_sealed=1 AND OLD.status='pending')
    BEGIN SELECT RAISE(ABORT,'analysis input seal is one-way and pending-only'); END;

    DROP TRIGGER analysis_runs_update_contract;
    CREATE TRIGGER analysis_runs_update_contract
    BEFORE UPDATE OF status,results_metadata_json,completed_at ON analysis_runs
    WHEN json_valid(NEW.results_metadata_json)=0 OR json_type(NEW.results_metadata_json)<>'object'
      OR NOT ${created}
      OR (OLD.status IN ('completed','failed') AND (
        NEW.status IS NOT OLD.status OR NEW.completed_at IS NOT OLD.completed_at
        OR NEW.results_metadata_json IS NOT OLD.results_metadata_json
      ))
      OR (OLD.status='pending' AND NEW.status NOT IN ('pending','running','completed','failed'))
      OR (OLD.status='running' AND NEW.status NOT IN ('running','completed','failed'))
      OR (OLD.status IN ('completed','failed') AND NEW.status<>OLD.status)
      OR (OLD.status IN ('pending','running') AND NEW.status<>OLD.status AND OLD.inputs_sealed<>1)
      OR (NEW.status IN ('pending','running') AND NEW.completed_at IS NOT NULL)
      OR (NEW.status IN ('completed','failed') AND (
        NEW.completed_at IS NULL OR NOT ${completed}
        OR julianday(NEW.completed_at)<julianday(NEW.created_at)
      ))
    BEGIN SELECT RAISE(ABORT,'analysis run sealed state transition violation'); END;
  `);
}

function installInputBoundary(database: DatabaseSync): void {
  const snapshot = "NEW.record_snapshot_json";
  const j = (field: string) => `json_extract(${snapshot},'$.${field}')`;
  database.exec(`
    CREATE TRIGGER analysis_inputs_008_boundary BEFORE INSERT ON analysis_inputs
    WHEN ${invalidIdentitySql("NEW.analysis_run_id")}
      OR ${invalidIdentitySql("NEW.record_id")}
      OR ${invalidIdentitySql("NEW.input_hash")}
      OR NOT EXISTS(
        SELECT 1 FROM analysis_runs ar
        WHERE ar.id=NEW.analysis_run_id AND ar.status='pending' AND ar.inputs_sealed=0
      )
      OR NOT EXISTS(SELECT 1 FROM experiment_records er WHERE er.id=NEW.record_id AND er.status='active')
      OR NOT ${canonicalTimestampSql(j("created_at"))}
      OR NOT ${canonicalTimestampSql(j("updated_at"))}
      OR (${j("reviewed_at")}<>'' AND NOT ${canonicalTimestampSql(j("reviewed_at"))})
      OR (NEW.review_binding_mode='none' AND (
        ${j("effective_review_id")} IS NOT NULL
        OR ${j("review_status")} NOT IN ('normal','review')
        OR ${j("review_note")}<>'' OR ${j("reviewed_by")}<>'' OR ${j("reviewed_at")}<>''
      ))
      OR (NEW.review_binding_mode IN ('effective','omit') AND NOT EXISTS(
        SELECT 1 FROM experiment_records er WHERE er.id=NEW.record_id
          AND ${j("effective_review_id")} IS er.effective_review_id
          AND ${j("review_status")} IS er.review_status
          AND ${j("review_note")} IS er.review_note
          AND ${j("reviewed_by")} IS er.reviewed_by
          AND ${j("reviewed_at")} IS COALESCE(er.reviewed_at,'')
      ))
    BEGIN SELECT RAISE(ABORT,'analysis input sealed provenance boundary violation'); END;
  `);
}

function installRecordBoundary(database: DatabaseSync): void {
  database.exec(`
    CREATE TRIGGER experiment_records_008_insert_guard BEFORE INSERT ON experiment_records
    WHEN ${invalidIdentitySql("NEW.id")}
      OR (NEW.client_submission_id IS NOT NULL AND ${invalidIdentitySql("NEW.client_submission_id")})
      OR NOT ${canonicalTimestampSql("NEW.created_at")}
      OR NOT ${canonicalTimestampSql("NEW.updated_at")}
      OR julianday(NEW.updated_at)<julianday(NEW.created_at)
      OR trim(NEW.created_by_label)=''
      OR json_valid(NEW.metadata_json)=0 OR json_type(NEW.metadata_json)<>'object'
    BEGIN SELECT RAISE(ABORT,'canonical experiment provenance boundary violation'); END;

    CREATE TRIGGER experiment_records_008_update_guard
    BEFORE UPDATE OF updated_at,metadata_json,status ON experiment_records
    WHEN NOT ${canonicalTimestampSql("NEW.updated_at")}
      OR julianday(NEW.updated_at)<julianday(NEW.created_at)
      OR julianday(NEW.updated_at)<julianday(OLD.updated_at)
      OR json_valid(NEW.metadata_json)=0 OR json_type(NEW.metadata_json)<>'object'
    BEGIN SELECT RAISE(ABORT,'experiment update provenance boundary violation'); END;
  `);
}

function installReviewBoundary(database: DatabaseSync): void {
  const created = canonicalTimestampSql("NEW.created_at");
  const decided = canonicalTimestampSql("NEW.decided_at");
  database.exec(`
    CREATE TRIGGER record_reviews_008_insert_guard BEFORE INSERT ON record_reviews
    WHEN ${invalidIdentitySql("NEW.id")}
      OR ${invalidIdentitySql("NEW.record_id")}
      OR (NEW.reviewer_user_id IS NOT NULL AND ${invalidIdentitySql("NEW.reviewer_user_id")})
      OR (NEW.provenance_kind='human' AND (
        NEW.reviewer_user_id IS NULL
        OR NOT EXISTS(
          SELECT 1 FROM users u WHERE u.id=NEW.reviewer_user_id
            AND NEW.reviewer_label IN (u.username,u.name)
            AND u.role IN ('teacher','admin') AND u.status IN ('active','demo')
        )
        OR trim(NEW.reviewer_label)=''
        OR NEW.decision NOT IN ('included','excluded','review')
        OR NOT ${created} OR NEW.decided_at IS NULL OR NOT ${decided}
        OR julianday(NEW.decided_at)<julianday(NEW.created_at)
        OR NOT EXISTS(
          SELECT 1 FROM experiment_records er WHERE er.id=NEW.record_id
            AND julianday(NEW.created_at)>=julianday(er.created_at)
            AND julianday(NEW.created_at)>=julianday(er.updated_at)
        )
        OR EXISTS(
          SELECT 1 FROM record_reviews prior WHERE prior.record_id=NEW.record_id
            AND julianday(NEW.created_at)<julianday(prior.created_at)
        )
      ))
    BEGIN SELECT RAISE(ABORT,'authoritative human review boundary violation'); END;

    DROP TRIGGER record_reviews_project_after_insert;
    CREATE TRIGGER record_reviews_project_after_insert AFTER INSERT ON record_reviews
    BEGIN
      INSERT INTO review_event_order(review_id) VALUES(NEW.id);
      UPDATE experiment_records SET
        effective_review_id=NEW.id,
        review_status=NEW.decision,
        review_note=NEW.reason,
        reviewed_at=NEW.decided_at,
        reviewed_by=NEW.reviewer_label,
        updated_at=CASE
          WHEN julianday(NEW.created_at)>=julianday(updated_at) THEN NEW.created_at
          ELSE updated_at END
      WHERE id=NEW.record_id;
    END;
  `);
}

export const analysisInputSealingAndProvenanceBoundaryMigration: Migration = {
  version: 8,
  name: "analysis_input_sealing_and_provenance_boundary",
  up(database) {
    preflight(database);
    classifyHistoricalTimestamps(database);
    classifyHistoricalInputs(database);
    installRunSealing(database);
    installInputBoundary(database);
    installRecordBoundary(database);
    installReviewBoundary(database);
  },
};
