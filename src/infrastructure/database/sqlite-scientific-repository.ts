import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../../application/ports.js";
import { canAccessClass } from "../../domain/authorization.js";
import {
  canonicalHash,
  canonicalize,
  hashCanonicalBytes,
  parseStrictJson,
} from "../../domain/scientific/canonical.js";
import {
  SCIENTIFIC_ALGORITHM,
  SCIENTIFIC_LIMITS,
  SCIENTIFIC_POLICY,
  SCIENTIFIC_REGISTRATION_SCHEMA,
  SCIENTIFIC_STATE_SCHEMA,
  ScientificFault,
  scientificSettings,
  type ScientificAnalysisRepository,
  type ScientificAttempt,
  type ScientificCommand,
  type ScientificConfiguration,
  type ScientificContext,
  type ScientificEnvelope,
  type ScientificIdentity,
  type ScientificOutcome,
  type ScientificRun,
  type ScientificWork,
} from "../../domain/scientific/contract.js";
import { validateScientificResult } from "../../domain/scientific/result-validation.js";
import type { Session } from "../../domain/types.js";
import { assertJsonSafeObject, type JsonObject } from "../../shared/json-safe.js";
import { isMachineIdentity } from "../../shared/provenance-contract.js";
import { isStrictTimestamp } from "../../shared/strict-timestamp.js";
import { currentAccount, SqliteAuthorityFault, type DatabaseRow } from "./sqlite-authority.js";
import { SqliteProvenanceStore } from "./sqlite-provenance-store.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const ATTEMPT_TOKEN = /^[0-9a-f]{48}$/;
const ERROR = /^[A-Z][A-Z0-9_]{0,79}$/;
const corrupt = () =>
  new ScientificFault("corrupt", "SCIENTIFIC_INTEGRITY_ERROR", "科学分析的封存数据或执行状态异常");
function object(value: unknown): JsonObject {
  assertJsonSafeObject(value, "scientific metadata");
  return value;
}
function keys(value: object, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === expected.sort().join(",");
}
function identity(value: unknown): ScientificIdentity {
  const v = object(value);
  if (
    !keys(v, [
      "algorithm_version",
      "code_version",
      "node_code_version",
      "environment_fingerprint",
      "environment",
      "app_version",
    ]) ||
    v.algorithm_version !== SCIENTIFIC_ALGORITHM ||
    typeof v.code_version !== "string" ||
    !DIGEST.test(v.code_version) ||
    typeof v.node_code_version !== "string" ||
    !DIGEST.test(v.node_code_version) ||
    typeof v.environment_fingerprint !== "string" ||
    !DIGEST.test(v.environment_fingerprint) ||
    typeof v.app_version !== "string" ||
    v.app_version.length < 1 ||
    v.app_version.length > 64
  )
    throw corrupt();
  object(v.environment);
  canonicalize(v);
  return v as ScientificIdentity;
}
function sameIdentity(a: ScientificIdentity, b: ScientificIdentity): boolean {
  return (
    a.algorithm_version === b.algorithm_version &&
    a.code_version === b.code_version &&
    a.node_code_version === b.node_code_version &&
    a.environment_fingerprint === b.environment_fingerprint &&
    canonicalize(a.environment) === canonicalize(b.environment)
  );
}
function configuration(datasetHash: string): ScientificConfiguration {
  const settings = scientificSettings();
  const seed = canonicalHash({
    schema: "echoclass.scientific-seed.v1",
    dataset_hash: datasetHash,
    settings_without_seed: settings,
  }).slice(7, 39);
  return { ...settings, seed_hex: seed } as ScientificConfiguration;
}
function state(run: ScientificRun): JsonObject {
  return {
    schema: SCIENTIFIC_STATE_SCHEMA,
    attempts: run.attempts.map((a) => ({ ...a })),
    result: run.result,
    scientific_result_hash: run.scientific_result_hash,
    error_code: run.error_code,
  };
}

/** All state changes and input hashes use this one synchronous SQLite connection. */
export class SqliteScientificRepository implements ScientificAnalysisRepository {
  constructor(
    private readonly database: DatabaseSync | null,
    private readonly appVersion: string,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}
  private transaction<T>(write: boolean, operation: (db: DatabaseSync) => T): T {
    const db = this.database;
    if (!db)
      throw new ScientificFault(
        "unavailable",
        "SCIENTIFIC_STORAGE_REQUIRED",
        "科学分析需要 SQLite 存储",
      );
    if (db.isTransaction)
      throw new ScientificFault(
        "unavailable",
        "SCIENTIFIC_TRANSACTION_BUSY",
        "科学分析存储忙，请重试",
      );
    let began = false;
    try {
      db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
      began = true;
      const result = operation(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* Preserve first failure. */
        }
      }
      if (error instanceof ScientificFault) throw error;
      if (error instanceof SqliteAuthorityFault)
        throw new ScientificFault(
          error.reason === "role_required" ? "forbidden" : "unauthenticated",
          error.reason === "role_required"
            ? "SCIENTIFIC_ROLE_REQUIRED"
            : "SCIENTIFIC_SESSION_REQUIRED",
          "请使用有效教师或管理员账号",
        );
      if (error instanceof Error && /locked|busy|disk|readonly|read-only|I\/O/i.test(error.message))
        throw new ScientificFault(
          "unavailable",
          "SCIENTIFIC_STORAGE_BUSY",
          "科学分析存储暂时不可用",
        );
      throw error;
    }
  }
  private actor(db: DatabaseSync, context: ScientificContext): Session {
    return currentAccount(db, context, this.clock, ["teacher", "admin"]);
  }
  private now(min?: string): string {
    const now = this.clock.now();
    if (!isStrictTimestamp(now) || (min !== undefined && now < min)) throw corrupt();
    return now;
  }
  private classroom(db: DatabaseSync, actor: Session, id: string): { id: string; name: string } {
    if (!isMachineIdentity(id))
      throw new ScientificFault("input", "SCIENTIFIC_CLASS_ID", "班级标识无效");
    const row = db.prepare("SELECT id,name FROM classes WHERE id=?").get(id);
    if (!row) throw new ScientificFault("missing", "SCIENTIFIC_CLASS_NOT_FOUND", "班级不存在");
    if (!canAccessClass(actor, String(row.name)))
      throw new ScientificFault("forbidden", "SCIENTIFIC_CLASS_FORBIDDEN", "无权访问该班级");
    return { id: String(row.id), name: String(row.name) };
  }
  private scope(db: DatabaseSync, actor: Session, run: ScientificRun): void {
    this.classroom(db, actor, run.class_id);
    const rows = db
      .prepare(
        `SELECT c.name FROM analysis_inputs ai JOIN experiment_records er ON er.id=ai.record_id JOIN classes c ON c.id=er.class_id WHERE ai.analysis_run_id=?`,
      )
      .all(run.id);
    const n = Number(
      db.prepare("SELECT count(*) n FROM analysis_inputs WHERE analysis_run_id=?").get(run.id)!.n,
    );
    if (rows.length !== n || n === 0) throw corrupt();
    if (rows.some((row) => !canAccessClass(actor, String(row.name))))
      throw new ScientificFault(
        "forbidden",
        "SCIENTIFIC_SCOPE_CHANGED",
        "分析中含有当前无权访问的记录",
      );
  }
  private requester(db: DatabaseSync, run: ScientificRun): void {
    const row = db
      .prepare("SELECT id,role,username,name,class_name,status FROM users WHERE id=?")
      .get(run.requester_user_id);
    if (!row || row.status !== "active" || !(["teacher", "admin"] as unknown[]).includes(row.role))
      throw new ScientificFault(
        "forbidden",
        "SCIENTIFIC_AUTHORITY_CHANGED",
        "分析请求人的权限已改变",
      );
    this.scope(
      db,
      {
        id: String(row.id),
        role: row.role as Session["role"],
        username: String(row.username),
        name: String(row.name),
        class_name: String(row.class_name ?? ""),
      },
      run,
    );
  }
  authorize(context: ScientificContext): { id: string; role: Session["role"] } {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      return { id: actor.id, role: actor.role };
    });
  }
  classes(context: ScientificContext): Array<{ id: string; name: string }> {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      return db
        .prepare("SELECT id,name FROM classes ORDER BY name COLLATE BINARY,id COLLATE BINARY")
        .all()
        .filter((row) => canAccessClass(actor, String(row.name)))
        .map((row) => ({ id: String(row.id), name: String(row.name) }));
    });
  }

  private read(db: DatabaseSync, id: string): ScientificRun {
    if (!isMachineIdentity(id))
      throw new ScientificFault("input", "SCIENTIFIC_RUN_ID", "分析标识无效");
    const reg = db
      .prepare(
        "SELECT sr.*,c.name AS class_name FROM scientific_analysis_requests sr JOIN classes c ON c.id=sr.class_id WHERE run_id=?",
      )
      .get(id) as DatabaseRow | undefined;
    if (!reg) throw new ScientificFault("missing", "SCIENTIFIC_RUN_NOT_FOUND", "科学分析不存在");
    try {
      const stored = new SqliteProvenanceStore(db, this.clock).findAnalysisRun(id);
      if (
        !stored ||
        stored.inputs_sealed !== true ||
        stored.dataset_classification !== "exact" ||
        stored.created_by_user_id !== reg.requester_user_id ||
        !DIGEST.test(stored.dataset_hash)
      )
        throw corrupt();
      const wrapper = object(stored.configuration);
      if (
        !keys(wrapper, ["schema", "configuration", "identity", "execution_fingerprint"]) ||
        wrapper.schema !== SCIENTIFIC_REGISTRATION_SCHEMA ||
        typeof wrapper.execution_fingerprint !== "string" ||
        !DIGEST.test(wrapper.execution_fingerprint)
      )
        throw corrupt();
      const frozen = identity(wrapper.identity);
      if (
        frozen.algorithm_version !== stored.algorithm_version ||
        frozen.code_version !== stored.code_version
      )
        throw corrupt();
      const config = configuration(stored.dataset_hash);
      if (canonicalize(config) !== canonicalize(wrapper.configuration)) throw corrupt();
      const run: ScientificRun = {
        id,
        class_id: String(reg.class_id),
        class_name: String(reg.class_name),
        requester_user_id: String(reg.requester_user_id),
        client_request_id: String(reg.client_request_id),
        request_fingerprint: String(reg.request_fingerprint),
        status: stored.status,
        created_at: stored.created_at,
        completed_at: stored.completed_at ?? null,
        dataset_hash: stored.dataset_hash,
        execution_fingerprint: wrapper.execution_fingerprint,
        configuration: config,
        identity: frozen,
        attempts: [],
        result: null,
        scientific_result_hash: null,
        error_code: null,
      };
      if (
        !TOKEN.test(run.client_request_id) ||
        !DIGEST.test(run.request_fingerprint) ||
        !isStrictTimestamp(run.created_at)
      )
        throw corrupt();
      const meta = object(stored.results_metadata);
      if (run.status === "pending") {
        if (Object.keys(meta).length !== 0 || run.completed_at !== null) throw corrupt();
        return run;
      }
      if (
        !keys(meta, ["schema", "attempts", "result", "scientific_result_hash", "error_code"]) ||
        meta.schema !== SCIENTIFIC_STATE_SCHEMA ||
        !Array.isArray(meta.attempts) ||
        meta.attempts.length > 2
      )
        throw corrupt();
      run.attempts = meta.attempts.map((value, index) => {
        const a = object(value);
        if (
          !keys(a, ["number", "token", "started_at", "finished_at", "error_code"]) ||
          a.number !== index + 1 ||
          typeof a.token !== "string" ||
          !ATTEMPT_TOKEN.test(a.token) ||
          typeof a.started_at !== "string" ||
          !isStrictTimestamp(a.started_at) ||
          a.started_at < run.created_at ||
          (a.finished_at !== null &&
            (typeof a.finished_at !== "string" ||
              !isStrictTimestamp(a.finished_at) ||
              a.finished_at < a.started_at)) ||
          (a.error_code !== null && (typeof a.error_code !== "string" || !ERROR.test(a.error_code)))
        )
          throw corrupt();
        return a as unknown as ScientificAttempt;
      });
      for (let i = 0; i < run.attempts.length - 1; i++) {
        const a = run.attempts[i]!,
          next = run.attempts[i + 1]!;
        if (
          a.finished_at === null ||
          a.error_code === null ||
          a.finished_at > next.started_at ||
          a.token === next.token
        )
          throw corrupt();
      }
      const last = run.attempts.at(-1);
      if (run.status === "running") {
        if (
          !last ||
          last.finished_at !== null ||
          last.error_code !== null ||
          run.completed_at !== null ||
          meta.result !== null ||
          meta.scientific_result_hash !== null ||
          meta.error_code !== null
        )
          throw corrupt();
      } else {
        if (
          run.completed_at === null ||
          !isStrictTimestamp(run.completed_at) ||
          run.completed_at < run.created_at ||
          (last && last.finished_at !== run.completed_at)
        )
          throw corrupt();
        if (run.status === "failed") {
          if (
            meta.result !== null ||
            meta.scientific_result_hash !== null ||
            typeof meta.error_code !== "string" ||
            !ERROR.test(meta.error_code) ||
            (last && last.error_code !== meta.error_code)
          )
            throw corrupt();
          run.error_code = meta.error_code;
        } else {
          if (
            !last ||
            last.error_code !== null ||
            meta.error_code !== null ||
            typeof meta.scientific_result_hash !== "string" ||
            !DIGEST.test(meta.scientific_result_hash)
          )
            throw corrupt();
          run.result = object(meta.result);
          run.scientific_result_hash = meta.scientific_result_hash;
          if (canonicalHash(run.result) !== run.scientific_result_hash) throw corrupt();
        }
      }
      return run;
    } catch (error) {
      if (error instanceof ScientificFault) throw error;
      throw corrupt();
    }
  }

  private envelope(db: DatabaseSync, run: ScientificRun): ScientificEnvelope {
    try {
      const validated = new SqliteProvenanceStore(db, this.clock).listAnalysisInputs(run.id);
      const rows = db
        .prepare("SELECT * FROM analysis_inputs WHERE analysis_run_id=? ORDER BY ordinal")
        .all(run.id);
      if (
        rows.length !== validated.length ||
        rows.length < 1 ||
        rows.length > SCIENTIFIC_LIMITS.candidates
      )
        throw corrupt();
      const canonical_inputs = rows.map((row, i) => {
        if (
          Number(row.ordinal) !== i ||
          row.snapshot_schema !== "echoclass.analysis-input.v1" ||
          !(["effective", "none"] as unknown[]).includes(row.review_binding_mode) ||
          row.review_omission_reason !== null
        )
          throw corrupt();
        const snapshot = object(parseStrictJson(String(row.record_snapshot_json)));
        if (snapshot.class_id !== run.class_id) throw corrupt();
        const value = {
          schema: "echoclass.scientific-input.v1",
          snapshot_schema: row.snapshot_schema,
          record_snapshot: snapshot,
          review_snapshot:
            row.review_snapshot_json === null
              ? null
              : parseStrictJson(String(row.review_snapshot_json)),
          review_binding_mode: row.review_binding_mode,
          review_omission_reason: null,
        };
        const canonical_json = canonicalize(value),
          input_hash = hashCanonicalBytes(canonical_json);
        if (input_hash !== row.input_hash) throw corrupt();
        if (
          i > 0 &&
          Buffer.compare(
            Buffer.from(String(rows[i - 1]!.record_id)),
            Buffer.from(String(row.record_id)),
          ) >= 0
        )
          throw corrupt();
        return { input_hash, canonical_json };
      });
      const dataset_canonical_json = canonicalize({
        schema: "echoclass.scientific-dataset.v1",
        class_id: run.class_id,
        entries: rows.map((row, i) => ({
          ordinal: i,
          record_id: row.record_id,
          input_hash: canonical_inputs[i]!.input_hash,
        })),
      });
      const dataset_hash = hashCanonicalBytes(dataset_canonical_json);
      const execution_canonical_json = canonicalize({
        schema: "echoclass.scientific-execution.v1",
        dataset_hash,
        configuration: run.configuration,
        algorithm_version: run.identity.algorithm_version,
        code_version: run.identity.code_version,
        node_code_version: run.identity.node_code_version,
        environment_fingerprint: run.identity.environment_fingerprint,
      });
      const execution_fingerprint = hashCanonicalBytes(execution_canonical_json);
      if (dataset_hash !== run.dataset_hash || execution_fingerprint !== run.execution_fingerprint)
        throw corrupt();
      const envelope: ScientificEnvelope = {
        schema: "echoclass.scientific-envelope.v1",
        canonical_inputs,
        dataset_hash,
        dataset_canonical_json,
        execution_fingerprint,
        execution_canonical_json,
      };
      if (Buffer.byteLength(JSON.stringify(envelope)) > SCIENTIFIC_LIMITS.requestBytes)
        throw corrupt();
      return envelope;
    } catch (error) {
      if (error instanceof ScientificFault) throw error;
      throw corrupt();
    }
  }
  private validatedRead(db: DatabaseSync, id: string): ScientificRun {
    const run = this.read(db, id);
    const envelope = this.envelope(db, run);
    if (run.result) validateScientificResult(run.result, envelope);
    return run;
  }
  getScientificRun(context: ScientificContext, runId: string): ScientificRun {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context),
        run = this.read(db, runId);
      this.scope(db, actor, run);
      return this.validatedRead(db, runId);
    });
  }
  listScientificRuns(context: ScientificContext, classId: string): ScientificRun[] {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      this.classroom(db, actor, classId);
      const rows = db
        .prepare(
          `SELECT sr.run_id FROM scientific_analysis_requests sr JOIN analysis_runs ar ON ar.id=sr.run_id WHERE sr.class_id=? ORDER BY ar.created_at DESC,ar.id DESC LIMIT ?`,
        )
        .all(classId, SCIENTIFIC_LIMITS.recent);
      return rows.map((row) => {
        const run = this.read(db, String(row.run_id));
        this.scope(db, actor, run);
        return this.validatedRead(db, run.id);
      });
    });
  }
  readExecutionRun(runId: string): ScientificRun {
    return this.transaction(false, (db) => this.read(db, runId));
  }
  readScientificInputs(runId: string): ScientificEnvelope {
    return this.transaction(false, (db) => this.envelope(db, this.read(db, runId)));
  }
  private ids(status: "pending" | "running"): string[] {
    return this.transaction(false, (db) =>
      db
        .prepare(
          `SELECT ar.id FROM analysis_runs ar JOIN scientific_analysis_requests sr ON sr.run_id=ar.id WHERE ar.status=? ORDER BY ar.created_at,ar.id LIMIT ?`,
        )
        .all(status, SCIENTIFIC_LIMITS.pending)
        .map((row) => String(row.id)),
    );
  }
  pendingRunIds(): string[] {
    return this.ids("pending");
  }
  runningRunIds(): string[] {
    return this.ids("running");
  }

  createScientificRun(
    context: ScientificContext,
    command: ScientificCommand,
    workerIdentity: ScientificIdentity | null,
  ): { run: ScientificRun; replayed: boolean } {
    return this.transaction(true, (db) => {
      const actor = this.actor(db, context);
      if (
        !command ||
        !keys(command, ["class_id", "client_request_id", "policy"]) ||
        command.policy !== SCIENTIFIC_POLICY ||
        !TOKEN.test(command.client_request_id)
      )
        throw new ScientificFault("input", "SCIENTIFIC_COMMAND_INVALID", "分析请求格式无效");
      const classroom = this.classroom(db, actor, command.class_id);
      const request_fingerprint = canonicalHash({
        schema: "echoclass.scientific-request.v1",
        class_id: classroom.id,
        policy: command.policy,
      });
      const prior = db
        .prepare(
          "SELECT run_id,request_fingerprint FROM scientific_analysis_requests WHERE requester_user_id=? AND class_id=? AND client_request_id=?",
        )
        .get(actor.id, classroom.id, command.client_request_id);
      if (prior) {
        const run = this.read(db, String(prior.run_id));
        this.scope(db, actor, run);
        if (prior.request_fingerprint !== request_fingerprint)
          throw new ScientificFault("conflict", "IDEMPOTENCY_CONFLICT", "该请求标识已用于不同分析");
        return { run: this.validatedRead(db, run.id), replayed: true };
      }
      if (workerIdentity === null)
        throw new ScientificFault("unavailable", "WORKER_UNAVAILABLE", "科学分析服务暂时不可用");
      const frozen = identity(structuredClone(workerIdentity));
      if (frozen.app_version !== this.appVersion)
        throw new ScientificFault("unavailable", "WORKER_IDENTITY_MISMATCH", "科学分析身份不匹配");
      const pending = Number(
        db
          .prepare(
            "SELECT count(*) n FROM scientific_analysis_requests sr JOIN analysis_runs ar ON ar.id=sr.run_id WHERE ar.status='pending'",
          )
          .get()!.n,
      );
      if (pending >= SCIENTIFIC_LIMITS.pending)
        throw new ScientificFault("limit", "SCIENTIFIC_QUEUE_FULL", "分析队列已满，请稍后重试");
      const records = db
        .prepare(
          "SELECT id FROM experiment_records WHERE class_id=? AND status='active' ORDER BY id COLLATE BINARY LIMIT ?",
        )
        .all(classroom.id, SCIENTIFIC_LIMITS.candidates + 1);
      if (records.length === 0)
        throw new ScientificFault("input", "SCIENTIFIC_EMPTY_CLASS", "该班级没有可分析的记录");
      if (records.length > SCIENTIFIC_LIMITS.candidates)
        throw new ScientificFault(
          "limit",
          "SCIENTIFIC_CANDIDATE_LIMIT",
          "每次分析最多包含 500 条记录",
        );
      const createdAt = this.now(),
        id = `analysis-${randomUUID()}`,
        store = new SqliteProvenanceStore(db, this.clock);
      const captured = records.map((row) =>
        store.captureAnalysisSelection(
          { record_id: String(row.id), input_hash: "capture-in-transaction" },
          createdAt,
        ),
      );
      const canonical_inputs = captured.map((c) => {
        const canonical_json = canonicalize({
          schema: "echoclass.scientific-input.v1",
          snapshot_schema: "echoclass.analysis-input.v1",
          record_snapshot: parseStrictJson(c.recordJson),
          review_snapshot: c.reviewJson === null ? null : parseStrictJson(c.reviewJson),
          review_binding_mode: c.bindingMode,
          review_omission_reason: null,
        });
        return { canonical_json, input_hash: hashCanonicalBytes(canonical_json) };
      });
      const dataset_canonical_json = canonicalize({
        schema: "echoclass.scientific-dataset.v1",
        class_id: classroom.id,
        entries: captured.map((c, ordinal) => ({
          ordinal,
          record_id: c.record.id,
          input_hash: canonical_inputs[ordinal]!.input_hash,
        })),
      });
      const dataset_hash = hashCanonicalBytes(dataset_canonical_json),
        config = configuration(dataset_hash);
      const execution_canonical_json = canonicalize({
        schema: "echoclass.scientific-execution.v1",
        dataset_hash,
        configuration: config,
        algorithm_version: frozen.algorithm_version,
        code_version: frozen.code_version,
        node_code_version: frozen.node_code_version,
        environment_fingerprint: frozen.environment_fingerprint,
      });
      const execution_fingerprint = hashCanonicalBytes(execution_canonical_json);
      if (
        Buffer.byteLength(
          JSON.stringify({
            schema: "echoclass.scientific-envelope.v1",
            canonical_inputs,
            dataset_hash,
            dataset_canonical_json,
            execution_fingerprint,
            execution_canonical_json,
          }),
        ) > SCIENTIFIC_LIMITS.requestBytes
      )
        throw new ScientificFault("limit", "SCIENTIFIC_REQUEST_LIMIT", "分析输入超过大小限制");
      db.prepare(
        `INSERT INTO analysis_runs(id,dataset_hash,algorithm_version,configuration_json,code_version,status,results_metadata_json,created_by_user_id,created_at,completed_at,inputs_sealed,dataset_classification) VALUES(?,?,?,?,?,'pending','{}',?,?,NULL,0,'exact')`,
      ).run(
        id,
        dataset_hash,
        frozen.algorithm_version,
        canonicalize({
          schema: SCIENTIFIC_REGISTRATION_SCHEMA,
          configuration: config,
          identity: frozen,
          execution_fingerprint,
        }),
        frozen.code_version,
        actor.id,
        createdAt,
      );
      const insert = db.prepare(
        `INSERT INTO analysis_inputs(analysis_run_id,ordinal,record_id,review_id,input_hash,record_snapshot_json,review_snapshot_json,snapshot_schema,review_binding_mode,review_omission_reason) VALUES(?,?,?,?,?,?,?,'echoclass.analysis-input.v1',?,NULL)`,
      );
      captured.forEach((c, i) =>
        insert.run(
          id,
          i,
          c.record.id,
          c.review?.id ?? null,
          canonical_inputs[i]!.input_hash,
          c.recordJson,
          c.reviewJson,
          c.bindingMode,
        ),
      );
      db.prepare("UPDATE analysis_runs SET inputs_sealed=1 WHERE id=?").run(id);
      db.prepare(
        "INSERT INTO scientific_analysis_requests(run_id,class_id,requester_user_id,client_request_id,request_fingerprint) VALUES(?,?,?,?,?)",
      ).run(id, classroom.id, actor.id, command.client_request_id, request_fingerprint);
      db.prepare(
        `INSERT INTO audit_logs(id,actor_id,actor_role,actor_username,action,target_type,target_id,class_name,ip,ua,ok,detail_json,created_at) VALUES(?,?,?,?,'scientific.create','analysis',?,?,?,?,1,?,?)`,
      ).run(
        `audit-${randomUUID()}`,
        actor.id,
        actor.role,
        actor.username,
        id,
        classroom.name,
        context.ip,
        context.ua,
        JSON.stringify({
          dataset_hash,
          execution_fingerprint,
          candidate_count: captured.length,
          app_version: this.appVersion,
        }),
        createdAt,
      );
      return { run: this.validatedRead(db, id), replayed: false };
    });
  }

  private write(db: DatabaseSync, old: ScientificRun, next: ScientificRun): ScientificRun {
    const token = old.attempts.at(-1)?.token ?? null;
    const changed = db
      .prepare(
        `UPDATE analysis_runs SET status=?,results_metadata_json=?,completed_at=? WHERE id=? AND status=? AND json_extract(results_metadata_json,'$.attempts[#-1].token') IS ?`,
      )
      .run(next.status, canonicalize(state(next)), next.completed_at, next.id, old.status, token);
    if (Number(changed.changes) !== 1)
      throw new ScientificFault(
        "conflict",
        "SCIENTIFIC_ATTEMPT_STALE",
        "该分析已由另一个执行尝试更新",
      );
    if (next.status === "completed" || next.status === "failed") {
      db.prepare(
        `INSERT INTO audit_logs(id,actor_id,actor_role,actor_username,action,target_type,target_id,class_name,ip,ua,ok,detail_json,created_at)
        SELECT ?,u.id,u.role,u.username,?,'analysis',?,?,NULL,'scientific-dispatcher',?,?,? FROM users u WHERE u.id=?`,
      ).run(
        `audit-${randomUUID()}`,
        `scientific.${next.status}`,
        next.id,
        next.class_name,
        next.status === "completed" ? 1 : 0,
        JSON.stringify({
          dataset_hash: next.dataset_hash,
          execution_fingerprint: next.execution_fingerprint,
          scientific_result_hash: next.scientific_result_hash,
          error_code: next.error_code,
          attempts: next.attempts.length,
        }),
        next.completed_at,
        next.requester_user_id,
      );
    }
    return this.read(db, next.id);
  }
  private readiness(
    db: DatabaseSync,
    run: ScientificRun,
    frozen: ScientificIdentity,
  ): ScientificEnvelope {
    this.requester(db, run);
    if (!sameIdentity(run.identity, identity(frozen)))
      throw new ScientificFault("conflict", "WORKER_IDENTITY_MISMATCH", "执行环境与封存分析不匹配");
    return this.envelope(db, run);
  }
  claimPendingRun(runId: string, frozen: ScientificIdentity): ScientificWork | null {
    return this.transaction(true, (db) => {
      const old = this.read(db, runId);
      if (old.status !== "pending") return null;
      const envelope = this.readiness(db, old, frozen);
      const attempt: ScientificAttempt = {
        number: 1,
        token: randomBytes(24).toString("hex"),
        started_at: this.now(old.created_at),
        finished_at: null,
        error_code: null,
      };
      const run = this.write(db, old, { ...old, status: "running", attempts: [attempt] });
      return { run, envelope, attempt };
    });
  }
  retryRunningRun(
    runId: string,
    previousAttemptToken: string,
    failure: string,
    frozen: ScientificIdentity,
  ): ScientificWork | null {
    return this.transaction(true, (db) => {
      if (!ERROR.test(failure))
        throw new ScientificFault("input", "SCIENTIFIC_ERROR_CODE", "执行错误代码无效");
      const old = this.read(db, runId),
        previous = old.attempts.at(-1);
      if (
        old.status !== "running" ||
        previous?.token !== previousAttemptToken ||
        old.attempts.length !== 1
      )
        return null;
      const envelope = this.readiness(db, old, frozen),
        at = this.now(previous.started_at),
        attempt: ScientificAttempt = {
          number: 2,
          token: randomBytes(24).toString("hex"),
          started_at: at,
          finished_at: null,
          error_code: null,
        };
      const run = this.write(db, old, {
        ...old,
        attempts: [{ ...previous, finished_at: at, error_code: failure }, attempt],
      });
      return { run, envelope, attempt };
    });
  }
  finishScientificRun(
    runId: string,
    attemptToken: string,
    outcome: ScientificOutcome,
  ): ScientificRun {
    return this.transaction(true, (db) => {
      const old = this.read(db, runId),
        attempt = old.attempts.at(-1);
      if (!attempt || attempt.token !== attemptToken)
        throw new ScientificFault("conflict", "SCIENTIFIC_ATTEMPT_STALE", "该执行尝试已失效");
      if (outcome.status === "failed" && !ERROR.test(outcome.error_code))
        throw new ScientificFault("input", "SCIENTIFIC_ERROR_CODE", "执行错误代码无效");
      let result: JsonObject | null = null,
        hash: string | null = null;
      if (outcome.status === "completed") {
        this.requester(db, old);
        const envelope = this.envelope(db, old);
        result = validateScientificResult(outcome.result, envelope);
        hash = canonicalHash(result);
        if (Buffer.byteLength(canonicalize(result)) > SCIENTIFIC_LIMITS.resultBytes)
          throw new ScientificFault("limit", "SCIENTIFIC_RESULT_LIMIT", "分析结果超过大小限制");
      }
      if (old.status !== "running") {
        if (
          old.status === outcome.status &&
          old.scientific_result_hash === hash &&
          (outcome.status === "completed" || old.error_code === outcome.error_code)
        )
          return old;
        throw new ScientificFault(
          "conflict",
          "SCIENTIFIC_TERMINAL_IMMUTABLE",
          "完成的分析不能被替换",
        );
      }
      const at = this.now(attempt.started_at),
        error_code = outcome.status === "failed" ? outcome.error_code : null;
      return this.write(db, old, {
        ...old,
        status: outcome.status,
        completed_at: at,
        attempts: [...old.attempts.slice(0, -1), { ...attempt, finished_at: at, error_code }],
        result,
        scientific_result_hash: hash,
        error_code,
      });
    });
  }
  failPendingRun(runId: string, errorCode: string): ScientificRun {
    return this.transaction(true, (db) => {
      if (!ERROR.test(errorCode))
        throw new ScientificFault("input", "SCIENTIFIC_ERROR_CODE", "执行错误代码无效");
      const old = this.read(db, runId);
      if (old.status === "failed" && old.error_code === errorCode) return old;
      if (old.status !== "pending")
        throw new ScientificFault("conflict", "SCIENTIFIC_STATUS_CHANGED", "分析状态已改变");
      return this.write(db, old, {
        ...old,
        status: "failed",
        completed_at: this.now(old.created_at),
        error_code: errorCode,
      });
    });
  }
}
