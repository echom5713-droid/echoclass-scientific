import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../../application/ports.js";
import { canAccessClass } from "../../domain/authorization.js";
import { CsvFault, type CsvReceipt } from "../../domain/csv/contract.js";
import {
  EVIDENCE_LIMITS,
  EvidenceFault,
  type EvidenceContext,
  type EvidenceObject,
  type EvidenceRepository,
  type EvidenceSource,
  type EvidenceTarget,
  type StoredEvidence,
} from "../../domain/evidence/contract.js";
import {
  validateEvidenceSource,
  validateEvidenceTarget,
} from "../../domain/evidence/validation.js";
import type { Session } from "../../domain/types.js";
import { isMachineIdentity } from "../../shared/provenance-contract.js";
import { isStrictTimestamp } from "../../shared/strict-timestamp.js";
import {
  authorizedCsvReceipt,
  currentAccount,
  SqliteAuthorityFault,
  type DatabaseRow,
} from "./sqlite-authority.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class SqliteEvidenceRepository implements EvidenceRepository {
  constructor(
    private readonly database: DatabaseSync | null,
    private readonly appVersion: string,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

  private transaction<T>(write: boolean, operation: (db: DatabaseSync) => T): T {
    const db = this.database;
    if (!db)
      throw new EvidenceFault("unavailable", "EVIDENCE_STORAGE_REQUIRED", "附件需要 SQLite 存储");
    if (db.isTransaction)
      throw new EvidenceFault(
        "unavailable",
        "EVIDENCE_TRANSACTION_BUSY",
        "附件存储当前不可用，请重试",
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
          /* Preserve the original failure; never remove a published object. */
        }
      }
      if (error instanceof EvidenceFault) throw error;
      if (error instanceof SqliteAuthorityFault) {
        if (error.reason === "role_required")
          throw new EvidenceFault(
            "forbidden",
            "EVIDENCE_ACTIVE_ACCOUNT_REQUIRED",
            "仅有效账号可使用附件",
          );
        throw new EvidenceFault(
          "unauthenticated",
          "EVIDENCE_SESSION_REQUIRED",
          "会话已失效，请重新登录",
        );
      }
      if (error instanceof CsvFault)
        throw new EvidenceFault(error.kind, error.reason, error.message);
      const message = error instanceof Error ? error.message : "";
      if (/locked|busy|disk|readonly|read-only|I\/O|database or disk is full/i.test(message))
        throw new EvidenceFault(
          "unavailable",
          "EVIDENCE_STORAGE_BUSY",
          "附件存储暂时不可用，请重试",
        );
      throw error;
    }
  }

  private actor(db: DatabaseSync, context: EvidenceContext): Session {
    return currentAccount(db, context, this.clock, ["student", "teacher", "admin"]);
  }

  private now(): string {
    const now = this.clock.now();
    if (!isStrictTimestamp(now))
      throw new EvidenceFault("corrupt", "EVIDENCE_CLOCK", "服务器时间无效");
    return now;
  }

  private target(
    db: DatabaseSync,
    actor: Session,
    target: EvidenceTarget,
    write: boolean,
  ): { className: string; csv?: CsvReceipt } {
    validateEvidenceTarget(target);
    if (target.kind === "csv_batch") {
      if (actor.role === "student")
        throw new EvidenceFault(
          "forbidden",
          "EVIDENCE_CSV_ROLE_REQUIRED",
          "学生不能访问 CSV 来源附件",
        );
      const row = db.prepare("SELECT * FROM csv_import_batches WHERE id=?").get(target.id) as
        DatabaseRow | undefined;
      if (!row) throw new EvidenceFault("missing", "EVIDENCE_TARGET_NOT_FOUND", "附件目标不存在");
      const receipt = authorizedCsvReceipt(db, actor, row);
      const classroom = db.prepare("SELECT name FROM classes WHERE id=?").get(receipt.class_id);
      return { className: String(classroom!.name), csv: receipt };
    }
    const row = db
      .prepare(
        `SELECT er.status,er.created_by_user_id,c.name AS class_name
      FROM experiment_records er JOIN classes c ON c.id=er.class_id WHERE er.id=?`,
      )
      .get(target.id) as DatabaseRow | undefined;
    if (!row) throw new EvidenceFault("missing", "EVIDENCE_TARGET_NOT_FOUND", "附件目标不存在");
    if (
      !canAccessClass(actor, String(row.class_name)) ||
      (actor.role === "student" && (row.created_by_user_id !== actor.id || row.status !== "active"))
    )
      throw new EvidenceFault("forbidden", "EVIDENCE_TARGET_FORBIDDEN", "无权访问该记录的附件");
    if (write && row.status !== "active")
      throw new EvidenceFault("conflict", "EVIDENCE_TARGET_ARCHIVED", "已归档记录不能新增附件");
    return { className: String(row.class_name) };
  }

  private metadata(row: DatabaseRow): StoredEvidence {
    const target: EvidenceTarget =
      row.record_id !== null
        ? { kind: "record", id: String(row.record_id) }
        : { kind: "csv_batch", id: String(row.csv_batch_id) };
    const stored = {
      id: String(row.id),
      object_key: String(row.object_key),
      target,
      schema_version: row.schema_version as EvidenceSource["schema_version"],
      client_upload_id: String(row.client_upload_id),
      sha256: String(row.sha256),
      byte_length: Number(row.byte_length),
      media_type: row.media_type as EvidenceSource["media_type"],
      extension: row.extension as EvidenceSource["extension"],
      original_name: String(row.original_name),
      uploader_user_id: String(row.uploader_user_id),
      uploader_label_snapshot: String(row.uploader_label_snapshot),
      received_at: String(row.received_at),
      app_version: String(row.app_version),
      archived_at: row.archived_at === null ? null : String(row.archived_at),
      archived_by_user_id:
        row.archived_by_user_id === null ? null : String(row.archived_by_user_id),
    };
    try {
      validateEvidenceSource(stored, target);
      if (
        !UUID.test(stored.object_key) ||
        !isStrictTimestamp(stored.received_at) ||
        (stored.archived_at === null) !== (stored.archived_by_user_id === null) ||
        (stored.archived_at !== null &&
          (!isStrictTimestamp(stored.archived_at) || stored.archived_at < stored.received_at))
      )
        throw new Error("Invalid stored evidence");
    } catch {
      throw new EvidenceFault("corrupt", "EVIDENCE_METADATA_CORRUPT", "附件元数据异常");
    }
    return stored;
  }

  private readable(db: DatabaseSync, actor: Session, row: DatabaseRow): StoredEvidence {
    const evidence = this.metadata(row);
    this.target(db, actor, evidence.target, false);
    if (actor.role === "student" && evidence.archived_at !== null)
      throw new EvidenceFault("forbidden", "EVIDENCE_ARCHIVED", "归档附件仅供教师和管理员查阅");
    return evidence;
  }

  private row(db: DatabaseSync, id: string): DatabaseRow {
    if (!isMachineIdentity(id)) throw new EvidenceFault("input", "EVIDENCE_ID", "附件 ID 格式无效");
    const row = db.prepare("SELECT * FROM evidence_files WHERE id=?").get(id) as
      DatabaseRow | undefined;
    if (!row) throw new EvidenceFault("missing", "EVIDENCE_NOT_FOUND", "附件不存在");
    return row;
  }

  private prior(
    db: DatabaseSync,
    actor: Session,
    target: EvidenceTarget,
    source: EvidenceSource,
  ): StoredEvidence | null {
    const row = db
      .prepare(
        `SELECT * FROM evidence_files WHERE uploader_user_id=? AND client_upload_id=? AND
      ${target.kind === "record" ? "record_id" : "csv_batch_id"}=?`,
      )
      .get(actor.id, source.client_upload_id, target.id) as DatabaseRow | undefined;
    if (!row) return null;
    const stored = this.readable(db, actor, row);
    if (
      stored.sha256 !== source.sha256 ||
      stored.byte_length !== source.byte_length ||
      stored.media_type !== source.media_type ||
      stored.extension !== source.extension ||
      stored.schema_version !== source.schema_version
    )
      throw new EvidenceFault("conflict", "IDEMPOTENCY_CONFLICT", "该上传标识已用于不同文件或契约");
    return stored;
  }

  authorize(context: EvidenceContext) {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      return { id: actor.id, role: actor.role };
    });
  }

  authorizeTarget(context: EvidenceContext, target: EvidenceTarget, write: boolean): void {
    this.transaction(false, (db) => {
      this.target(db, this.actor(db, context), target, write);
    });
  }

  list(context: EvidenceContext, target: EvidenceTarget): StoredEvidence[] {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      this.target(db, actor, target, false);
      const rows = db
        .prepare(
          `SELECT * FROM evidence_files WHERE ${target.kind === "record" ? "record_id" : "csv_batch_id"}=?
        ${actor.role === "student" ? "AND archived_at IS NULL" : ""} ORDER BY received_at,id`,
        )
        .all(target.id);
      if (rows.length > EVIDENCE_LIMITS.perTarget)
        throw new EvidenceFault("corrupt", "EVIDENCE_METADATA_CORRUPT", "附件数量异常");
      return rows.map((row) => this.metadata(row));
    });
  }

  findReplay(
    context: EvidenceContext,
    target: EvidenceTarget,
    source: EvidenceSource,
  ): StoredEvidence | null {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      const scope = this.target(db, actor, target, false);
      validateEvidenceSource(source, target);
      const prior = this.prior(db, actor, target, source);
      if (!prior) {
        this.checkCsvSource(scope.csv, source);
        this.checkQuota(db, target, source);
      }
      return prior;
    });
  }

  private checkCsvSource(receipt: CsvReceipt | undefined, source: EvidenceSource): void {
    if (
      receipt &&
      (receipt.raw_sha256 !== source.sha256 || receipt.byte_length !== source.byte_length)
    )
      throw new EvidenceFault(
        "conflict",
        "EVIDENCE_CSV_SOURCE_MISMATCH",
        "附件不是该批次的原始 CSV 字节",
      );
  }

  private checkQuota(db: DatabaseSync, target: EvidenceTarget, source: EvidenceSource): void {
    const count = db
      .prepare(
        `SELECT count(*) AS n FROM evidence_files WHERE ${target.kind === "record" ? "record_id" : "csv_batch_id"}=?`,
      )
      .get(target.id)!;
    const total = db.prepare("SELECT COALESCE(sum(byte_length),0) AS n FROM evidence_files").get()!;
    if (
      Number(count.n) >= EVIDENCE_LIMITS.perTarget ||
      Number(total.n) + source.byte_length > EVIDENCE_LIMITS.totalBytes
    )
      throw new EvidenceFault("limit", "EVIDENCE_QUOTA", "附件保留数量或总容量已达到上限");
  }

  commit(
    context: EvidenceContext,
    target: EvidenceTarget,
    source: EvidenceSource,
    object: EvidenceObject,
  ) {
    return this.transaction(true, (db) => {
      const actor = this.actor(db, context);
      const scope = this.target(db, actor, target, false);
      validateEvidenceSource(source, target);
      if (
        !UUID.test(object.object_key) ||
        source.sha256 !== object.sha256 ||
        source.byte_length !== object.byte_length
      )
        throw new EvidenceFault("input", "EVIDENCE_OBJECT_MISMATCH", "附件字节与存储结果不一致");
      const prior = this.prior(db, actor, target, source);
      if (prior) return { evidence: prior, replayed: true };
      this.target(db, actor, target, true);
      this.checkCsvSource(scope.csv, source);
      this.checkQuota(db, target, source);
      const id = `evidence-${randomUUID()}`;
      const receivedAt = this.now();
      db.prepare(
        `INSERT INTO evidence_files(id,object_key,record_id,csv_batch_id,schema_version,client_upload_id,sha256,byte_length,
        media_type,extension,original_name,uploader_user_id,uploader_label_snapshot,received_at,app_version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        object.object_key,
        target.kind === "record" ? target.id : null,
        target.kind === "csv_batch" ? target.id : null,
        source.schema_version,
        source.client_upload_id,
        source.sha256,
        source.byte_length,
        source.media_type,
        source.extension,
        source.original_name,
        actor.id,
        actor.username,
        receivedAt,
        this.appVersion,
      );
      this.audit(db, context, actor, "evidence.upload", id, scope.className, receivedAt, {
        target,
        sha256: source.sha256,
        byte_length: source.byte_length,
      });
      return { evidence: this.metadata(this.row(db, id)), replayed: false };
    });
  }

  get(context: EvidenceContext, id: string): StoredEvidence {
    return this.transaction(false, (db) =>
      this.readable(db, this.actor(db, context), this.row(db, id)),
    );
  }

  archive(context: EvidenceContext, id: string): StoredEvidence {
    return this.transaction(true, (db) => {
      const actor = this.actor(db, context);
      if (actor.role === "student")
        throw new EvidenceFault("forbidden", "EVIDENCE_ARCHIVE_ROLE", "仅教师和管理员可以归档附件");
      const evidence = this.readable(db, actor, this.row(db, id));
      if (evidence.archived_at !== null) return evidence;
      const scope = this.target(db, actor, evidence.target, false);
      const archivedAt = this.now();
      if (archivedAt < evidence.received_at)
        throw new EvidenceFault("corrupt", "EVIDENCE_CLOCK", "服务器时间早于附件接收时间");
      db.prepare("UPDATE evidence_files SET archived_at=?,archived_by_user_id=? WHERE id=?").run(
        archivedAt,
        actor.id,
        id,
      );
      this.audit(db, context, actor, "evidence.archive", id, scope.className, archivedAt, {
        target: evidence.target,
      });
      return this.metadata(this.row(db, id));
    });
  }

  private audit(
    db: DatabaseSync,
    context: EvidenceContext,
    actor: Session,
    action: string,
    id: string,
    className: string,
    at: string,
    detail: object,
  ): void {
    db.prepare(
      `INSERT INTO audit_logs(id,actor_id,actor_role,actor_username,action,target_type,target_id,class_name,ip,ua,ok,detail_json,created_at)
      VALUES(?,?,?,?,?,'evidence',?,?,?,?,1,?,?)`,
    ).run(
      `audit-${randomUUID()}`,
      actor.id,
      actor.role,
      actor.username,
      action,
      id,
      className,
      context.ip,
      context.ua,
      JSON.stringify(detail),
      at,
    );
  }
}
