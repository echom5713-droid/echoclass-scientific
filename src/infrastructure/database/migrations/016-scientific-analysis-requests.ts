import type { Migration } from "./types.js";

const digest = (v: string) =>
  `typeof(${v})='text' AND length(${v})=71 AND substr(${v},1,7)='sha256:' AND substr(${v},8) NOT GLOB '*[^0-9a-f]*' AND instr(${v},char(0))=0`;
const stamp = (v: string) =>
  `typeof(${v})='text' AND length(${v})=24 AND substr(${v},1,4) BETWEEN '0001' AND '9999' AND substr(${v},12,2) BETWEEN '00' AND '23' AND substr(${v},15,2) BETWEEN '00' AND '59' AND substr(${v},18,2) BETWEEN '00' AND '59' AND strftime('%Y-%m-%dT%H:%M:%fZ',${v},'+0 days') IS ${v}`;
const errorCode = (v: string) =>
  `typeof(${v})='text' AND length(${v}) BETWEEN 1 AND 80 AND substr(${v},1,1) GLOB '[A-Z]' AND ${v} NOT GLOB '*[^A-Z0-9_]*' AND instr(${v},char(0))=0`;
const n = (p: string) => `json_extract(NEW.results_metadata_json,'$.${p}')`;
const o = (p: string) => `json_extract(OLD.results_metadata_json,'$.${p}')`;
const check = (expression: string, message: string) =>
  `SELECT CASE WHEN NOT coalesce((${expression}),0) THEN RAISE(ABORT,'${message}') END;`;

/** Forward-only registration; old analysis runs never gain a scientific claim by backfill. */
export const scientificAnalysisRequestsMigration: Migration = {
  version: 16,
  name: "scientific_analysis_requests",
  up(database) {
    database.exec(`
      CREATE TABLE scientific_analysis_requests (
        run_id TEXT PRIMARY KEY NOT NULL REFERENCES analysis_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        class_id TEXT NOT NULL REFERENCES classes(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        requester_user_id TEXT NOT NULL REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        client_request_id TEXT NOT NULL CHECK(length(client_request_id) BETWEEN 16 AND 128 AND instr(client_request_id,char(0))=0 AND client_request_id NOT GLOB '*[^A-Za-z0-9_-]*'),
        request_fingerprint TEXT NOT NULL CHECK(${digest("request_fingerprint")}),
        UNIQUE(requester_user_id,class_id,client_request_id)
      ) STRICT;
      CREATE INDEX scientific_requests_class ON scientific_analysis_requests(class_id,run_id);
      CREATE TRIGGER scientific_registration_insert BEFORE INSERT ON scientific_analysis_requests BEGIN
        ${check("NOT EXISTS(SELECT 1 FROM scientific_analysis_requests WHERE run_id=NEW.run_id OR (requester_user_id=NEW.requester_user_id AND class_id=NEW.class_id AND client_request_id=NEW.client_request_id))", "Scientific registration cannot be replaced")}
        ${check(
          `EXISTS(SELECT 1 FROM analysis_runs ar JOIN users u ON u.id=NEW.requester_user_id JOIN classes c ON c.id=NEW.class_id
          WHERE ar.id=NEW.run_id AND ar.created_by_user_id=u.id AND u.status='active' AND (u.role='admin' OR (u.role='teacher' AND u.class_name=c.name))
          AND ar.status='pending' AND ar.completed_at IS NULL AND ar.inputs_sealed=1 AND ar.dataset_classification='exact'
          AND json_type(ar.results_metadata_json)='object' AND (SELECT count(*) FROM json_each(ar.results_metadata_json))=0
          AND ar.algorithm_version='echoclass.yield-analysis.v1' AND ${digest("ar.dataset_hash")} AND ${digest("ar.code_version")}
          AND json_extract(ar.configuration_json,'$.schema')='echoclass.scientific-registration.v1'
          AND (SELECT count(*) FROM json_each(ar.configuration_json))=4
          AND json_extract(ar.configuration_json,'$.identity.algorithm_version')=ar.algorithm_version
          AND json_extract(ar.configuration_json,'$.identity.code_version')=ar.code_version
          AND ${digest("json_extract(ar.configuration_json,'$.identity.node_code_version')")}
          AND ${digest("json_extract(ar.configuration_json,'$.identity.environment_fingerprint')")}
          AND json_type(ar.configuration_json,'$.identity.environment')='object'
          AND json_extract(ar.configuration_json,'$.configuration.schema')='echoclass.scientific-configuration.v1'
          AND json_extract(ar.configuration_json,'$.configuration.selection_policy')='approved_only.v1'
          AND ${digest("json_extract(ar.configuration_json,'$.execution_fingerprint')")})`,
          "Scientific registration requires a new sealed pending run",
        )}
        ${check(
          `(SELECT count(*) FROM analysis_inputs WHERE analysis_run_id=NEW.run_id) BETWEEN 1 AND 500
          AND (SELECT count(*) FROM analysis_inputs WHERE analysis_run_id=NEW.run_id)=(SELECT count(*) FROM experiment_records WHERE class_id=NEW.class_id AND status='active')
          AND NOT EXISTS(SELECT 1 FROM analysis_inputs ai LEFT JOIN experiment_records er ON er.id=ai.record_id
            WHERE ai.analysis_run_id=NEW.run_id AND (er.id IS NULL OR er.class_id<>NEW.class_id OR er.status<>'active' OR ai.snapshot_schema<>'echoclass.analysis-input.v1' OR ai.review_binding_mode NOT IN ('effective','none') OR ai.review_omission_reason IS NOT NULL OR NOT (${digest("ai.input_hash")}) OR json_extract(ai.record_snapshot_json,'$.class_id') IS NOT NEW.class_id))
          AND NOT EXISTS(SELECT 1 FROM analysis_inputs a JOIN analysis_inputs b ON a.analysis_run_id=b.analysis_run_id AND a.ordinal<b.ordinal WHERE a.analysis_run_id=NEW.run_id AND a.record_id COLLATE BINARY>=b.record_id COLLATE BINARY)`,
          "Scientific registration requires the complete ordered active cohort",
        )}
        ${check("(SELECT count(*) FROM scientific_analysis_requests sr JOIN analysis_runs ar ON ar.id=sr.run_id WHERE ar.status='pending')<10", "Scientific queue limit exceeded")}
      END;
      CREATE TRIGGER scientific_registration_update BEFORE UPDATE ON scientific_analysis_requests BEGIN SELECT RAISE(ABORT,'Scientific registration is immutable'); END;
      CREATE TRIGGER scientific_registration_delete BEFORE DELETE ON scientific_analysis_requests BEGIN SELECT RAISE(ABORT,'Scientific registration cannot be deleted'); END;
      CREATE TRIGGER scientific_state_update BEFORE UPDATE ON analysis_runs
      WHEN EXISTS(SELECT 1 FROM scientific_analysis_requests WHERE run_id=OLD.id) BEGIN
        ${check("NEW.status IN ('running','completed','failed')", "Scientific pending state is sealed")}
        ${check(
          `json_type(NEW.results_metadata_json)='object' AND (SELECT count(*) FROM json_each(NEW.results_metadata_json))=5
          AND ${n("schema")}='echoclass.scientific-run-state.v1' AND json_type(NEW.results_metadata_json,'$.attempts')='array'
          AND json_array_length(NEW.results_metadata_json,'$.attempts') BETWEEN 0 AND 2
          AND json_type(NEW.results_metadata_json,'$.result') IS NOT NULL
          AND json_type(NEW.results_metadata_json,'$.scientific_result_hash') IS NOT NULL
          AND json_type(NEW.results_metadata_json,'$.error_code') IS NOT NULL`,
          "Invalid scientific result envelope",
        )}
        ${check(
          `NOT EXISTS(SELECT 1 FROM json_each(NEW.results_metadata_json,'$.attempts') a WHERE NOT coalesce(
          json_type(a.value)='object' AND (SELECT count(*) FROM json_each(a.value))=5
          AND json_type(a.value,'$.number')='integer' AND json_extract(a.value,'$.number')=a.key+1
          AND typeof(json_extract(a.value,'$.token'))='text' AND length(json_extract(a.value,'$.token'))=48 AND json_extract(a.value,'$.token') NOT GLOB '*[^0-9a-f]*' AND instr(json_extract(a.value,'$.token'),char(0))=0
          AND ${stamp("json_extract(a.value,'$.started_at')")} AND json_extract(a.value,'$.started_at')>=NEW.created_at
          AND (json_type(a.value,'$.finished_at')='null' OR (${stamp("json_extract(a.value,'$.finished_at')")} AND json_extract(a.value,'$.finished_at')>=json_extract(a.value,'$.started_at')))
          AND (json_type(a.value,'$.error_code')='null' OR ${errorCode("json_extract(a.value,'$.error_code')")}),0))`,
          "Invalid scientific attempt",
        )}
        ${check(
          `json_array_length(NEW.results_metadata_json,'$.attempts')<>2 OR (
          ${n("attempts[0].token")}<>${n("attempts[1].token")} AND ${n("attempts[0].finished_at")} IS NOT NULL AND ${n("attempts[0].error_code")} IS NOT NULL
          AND ${n("attempts[0].finished_at")}<=${n("attempts[1].started_at")})`,
          "Scientific attempts must be ordered",
        )}
        ${check(
          `(NEW.status='running' AND NEW.completed_at IS NULL AND json_array_length(NEW.results_metadata_json,'$.attempts') IN (1,2)
            AND ${n("attempts[#-1].finished_at")} IS NULL AND ${n("attempts[#-1].error_code")} IS NULL AND ${n("result")} IS NULL AND ${n("scientific_result_hash")} IS NULL AND ${n("error_code")} IS NULL)
          OR (NEW.status='failed' AND ${stamp("NEW.completed_at")} AND NEW.completed_at>=NEW.created_at
            AND ${n("result")} IS NULL AND ${n("scientific_result_hash")} IS NULL AND ${errorCode(n("error_code"))}
            AND (json_array_length(NEW.results_metadata_json,'$.attempts')=0 OR (${n("attempts[#-1].finished_at")}=NEW.completed_at AND ${n("attempts[#-1].error_code")}=${n("error_code")})))
          OR (NEW.status='completed' AND ${stamp("NEW.completed_at")} AND NEW.completed_at>=NEW.created_at
            AND json_array_length(NEW.results_metadata_json,'$.attempts') IN (1,2) AND ${n("attempts[#-1].finished_at")}=NEW.completed_at AND ${n("attempts[#-1].error_code")} IS NULL
            AND json_type(NEW.results_metadata_json,'$.result')='object' AND ${digest(n("scientific_result_hash"))} AND ${n("error_code")} IS NULL
            AND ${n("result.schema")}='echoclass.scientific-result.v1' AND ${n("result.dataset_hash")}=NEW.dataset_hash
            AND ${n("result.execution_fingerprint")}=json_extract(NEW.configuration_json,'$.execution_fingerprint')
            AND ${n("result.algorithm_version")}=NEW.algorithm_version)`,
          "Scientific state and outcome disagree",
        )}
        ${check(
          `(OLD.status='pending' AND ((NEW.status='running' AND json_array_length(NEW.results_metadata_json,'$.attempts')=1) OR (NEW.status='failed' AND json_array_length(NEW.results_metadata_json,'$.attempts')=0)))
          OR (OLD.status='running' AND NEW.status='running' AND json_array_length(OLD.results_metadata_json,'$.attempts')=1 AND json_array_length(NEW.results_metadata_json,'$.attempts')=2
            AND ${n("attempts[0].number")}=${o("attempts[0].number")} AND ${n("attempts[0].token")}=${o("attempts[0].token")} AND ${n("attempts[0].started_at")}=${o("attempts[0].started_at")})
          OR (OLD.status='running' AND NEW.status IN ('completed','failed') AND json_array_length(OLD.results_metadata_json,'$.attempts')=json_array_length(NEW.results_metadata_json,'$.attempts')
            AND ${n("attempts[#-1].number")}=${o("attempts[#-1].number")} AND ${n("attempts[#-1].token")}=${o("attempts[#-1].token")} AND ${n("attempts[#-1].started_at")}=${o("attempts[#-1].started_at")}
            AND (json_array_length(NEW.results_metadata_json,'$.attempts')=1 OR ${n("attempts[0]")}=${o("attempts[0]")}))`,
          "Scientific attempt transition is forbidden",
        )}
      END;
    `);
  },
};
