import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../../application/ports.js";
import { diagnoseRecord } from "../../domain/experiments/diagnostics.js";
import { validateExperiment } from "../../domain/experiments/validation.js";
import { RepositoryConflictError } from "../../domain/repositories.js";
import type { CreateExperimentCommand, Session } from "../../domain/types.js";
import {
  CSV_SCHEMA,
  CSV_DIAGNOSTICS,
  CSV_FIELDS,
  CSV_LIMITS,
  CsvFault,
  type CsvCell,
  type CsvClass,
  type CsvContext,
  type CsvReceipt,
  type CsvRepository,
  type CsvSource,
} from "../../domain/csv/contract.js";
import { isStrictTimestamp } from "../../shared/strict-timestamp.js";
import { SqliteProvenanceStore } from "./sqlite-provenance-store.js";
import {
  authorizedCsvClass,
  authorizedCsvReceipt,
  currentAccount,
  csvAuthorityFault,
  SqliteAuthorityFault,
} from "./sqlite-authority.js";

type Row = Record<string, unknown>;

export class SqliteCsvRepository implements CsvRepository {
  constructor(
    private readonly database: DatabaseSync | null,
    private readonly appVersion: string,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

  private db(): DatabaseSync {
    if (!this.database)
      throw new CsvFault("unavailable", "CSV_STORAGE_REQUIRED", "CSV 工作流需要 SQLite 存储");
    return this.database;
  }

  private transaction<T>(write: boolean, operation: (db: DatabaseSync) => T): T {
    const db = this.db();
    if (db.isTransaction)
      throw new CsvFault("unavailable", "CSV_TRANSACTION_BUSY", "CSV 事务当前不可用，请重试");
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
          /* Retain the original error. */
        }
      }
      if (error instanceof CsvFault) throw error;
      if (error instanceof SqliteAuthorityFault) throw csvAuthorityFault(error);
      if (error instanceof RepositoryConflictError)
        throw new CsvFault(
          "conflict",
          "CSV_RECORD_CONFLICT",
          "记录标识冲突，本次导入已回滚，请重试",
        );
      const message = error instanceof Error ? error.message : "";
      if (/locked|busy|disk|readonly|read-only|I\/O|database or disk is full/i.test(message))
        throw new CsvFault(
          "unavailable",
          "CSV_STORAGE_BUSY",
          "存储暂时不可用，本次操作未完成，请重试",
        );
      throw error;
    }
  }

  private actor(db: DatabaseSync, context: CsvContext): Session {
    return currentAccount(db, context, this.clock, ["teacher", "admin"]);
  }

  private classroom(db: DatabaseSync, actor: Session, id: string): CsvClass {
    return authorizedCsvClass(db, actor, id);
  }

  authorize(context: CsvContext) {
    return this.transaction(false, (db) => ({ id: this.actor(db, context).id }));
  }
  classes(context: CsvContext): CsvClass[] {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      const rows =
        actor.role === "admin"
          ? db.prepare("SELECT id,name FROM classes ORDER BY name,id").all()
          : db
              .prepare("SELECT id,name FROM classes WHERE name=? ORDER BY id")
              .all(actor.class_name);
      return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
    });
  }
  resolveClass(context: CsvContext, id: string) {
    return this.transaction(false, (db) => this.classroom(db, this.actor(db, context), id));
  }

  private receipt(db: DatabaseSync, actor: Session, row: Row): CsvReceipt {
    return authorizedCsvReceipt(db, actor, row);
  }

  private prior(db: DatabaseSync, actor: Session, source: CsvSource): CsvReceipt | null {
    const row = db
      .prepare(
        "SELECT * FROM csv_import_batches WHERE uploader_user_id=? AND class_id=? AND client_import_id=?",
      )
      .get(actor.id, source.class_id, source.client_import_id) as Row | undefined;
    if (!row) return null;
    if (
      row.raw_sha256 !== source.raw_sha256 ||
      row.schema_version !== source.schema_version ||
      Number(row.byte_length) !== source.byte_length
    )
      throw new CsvFault("conflict", "IDEMPOTENCY_CONFLICT", "该导入标识已用于不同文件或契约");
    return this.receipt(db, actor, row);
  }
  findReceipt(context: CsvContext, source: CsvSource) {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      this.classroom(db, actor, source.class_id);
      return this.prior(db, actor, source);
    });
  }
  getReceipt(context: CsvContext, batchId: string) {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      const row = db.prepare("SELECT * FROM csv_import_batches WHERE id=?").get(batchId) as
        Row | undefined;
      if (!row) throw new CsvFault("missing", "CSV_BATCH_NOT_FOUND", "导入批次不存在");
      return this.receipt(db, actor, row);
    });
  }

  commit(context: CsvContext, source: CsvSource, commands: readonly CreateExperimentCommand[]) {
    return this.transaction(true, (db) => {
      const actor = this.actor(db, context);
      const classroom = this.classroom(db, actor, source.class_id);
      const prior = this.prior(db, actor, source);
      if (prior) return { receipt: prior, replayed: true, added_this_request: 0 };
      if (
        source.schema_version !== CSV_SCHEMA ||
        !commands.length ||
        commands.length > CSV_LIMITS.rows
      )
        throw new CsvFault("input", "CSV_BATCH_INPUT", "批次契约或行数无效");
      const store = new SqliteProvenanceStore(db);
      const cohort = store.findActiveByClassId(classroom.id);
      const batchId = `csv-${randomBytes(16).toString("hex")}`;
      const createdAt = this.clock.now();
      if (!isStrictTimestamp(createdAt))
        throw new CsvFault("corrupt", "CSV_CLOCK", "服务器时间无效");
      for (const [index, command] of commands.entries()) {
        if (command.class_name !== classroom.name)
          throw new CsvFault("conflict", "CSV_CLASS_CHANGED", "班级信息已经变化，请重新预览");
        if (validateExperiment(command).length)
          throw new CsvFault("input", "CSV_DOMAIN_INVALID", "数据未通过领域校验");
        const diagnosis = diagnoseRecord(command, cohort);
        const id = `rec-${randomBytes(16).toString("hex")}`;
        store.add({
          ...command,
          id,
          created_by_user_id: actor.id,
          created_by: actor.username,
          created_at: createdAt,
          initial_quality_status: diagnosis.status,
          synced_from_offline: false,
          metadata: {},
        });
        db.prepare("INSERT INTO csv_import_rows(batch_id,row_number,record_id) VALUES(?,?,?)").run(
          batchId,
          index + 1,
          id,
        );
      }
      const observed = this.clock.now();
      if (!isStrictTimestamp(observed))
        throw new CsvFault("corrupt", "CSV_CLOCK", "服务器时间无效");
      const completedAt = observed < createdAt ? createdAt : observed;
      db.prepare(
        `INSERT INTO csv_import_batches(id,uploader_user_id,class_id,client_import_id,schema_version,
        raw_sha256,byte_length,row_count,created_at,completed_at,uploader_label_snapshot,class_name_snapshot,app_version,diagnostics_policy)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        batchId,
        actor.id,
        classroom.id,
        source.client_import_id,
        source.schema_version,
        source.raw_sha256,
        source.byte_length,
        commands.length,
        createdAt,
        completedAt,
        actor.username,
        classroom.name,
        this.appVersion,
        CSV_DIAGNOSTICS,
      );
      db.prepare(
        `INSERT INTO audit_logs(id,actor_id,actor_role,actor_username,action,target_type,target_id,class_name,ip,ua,ok,detail_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      ).run(
        `audit-${randomBytes(16).toString("hex")}`,
        actor.id,
        actor.role,
        actor.username,
        "records.csv_import",
        "csv_batch",
        batchId,
        classroom.name,
        context.ip,
        context.ua,
        JSON.stringify({
          batch_id: batchId,
          row_count: commands.length,
          raw_sha256: source.raw_sha256,
          schema_version: source.schema_version,
        }),
        completedAt,
      );
      const row = db.prepare("SELECT * FROM csv_import_batches WHERE id=?").get(batchId) as Row;
      return {
        receipt: this.receipt(db, actor, row),
        replayed: false,
        added_this_request: commands.length,
      };
    });
  }

  exportRows(context: CsvContext, classId: string): CsvCell[][] {
    return this.transaction(false, (db) => {
      const actor = this.actor(db, context);
      this.classroom(db, actor, classId);
      const rows: CsvCell[][] = [];
      let budget = 0;
      const query =
        db.prepare(`SELECT er.id,er.class_id,er.class_name_snapshot,er.group_id,er.student_name,er.group_name_snapshot,
        er.nh4cl_concentration,er.peel_mass,er.oil_mass,er.distillation_time,er.phase_clarity_score,er.emulsification_level,
        er.emulsion_concentration,er.ecoli_observation_group,er.inhibition_zone_diameter,er.colony_growth_score,er.anomaly_flag,
        er.error_source,er.note,er.experiment_date,er.petri_diameter_mm,er.measurement_method,er.yield_percent,er.status,
        er.review_status,er.effective_review_id,er.created_by_user_id,er.created_by_label,er.created_at,er.updated_at,er.submission_kind,
        cr.batch_id AS csv_import_batch_id,cr.row_number AS csv_source_row
        FROM experiment_records er LEFT JOIN csv_import_rows cr ON cr.record_id=er.id
        WHERE er.class_id=? AND er.status='active' ORDER BY er.id COLLATE BINARY LIMIT ?`);
      for (const row of query.iterate(classId, CSV_LIMITS.exportRows + 1)) {
        const cell = (field: string): CsvCell => {
          const value = row[field];
          if (value === null || value === undefined) return null;
          if (typeof value !== "string" && typeof value !== "number")
            throw new CsvFault("corrupt", "CSV_EXPORT_TYPE", "导出字段类型无效");
          return value;
        };
        const values: CsvCell[] = [
          cell("id"),
          cell("class_id"),
          cell("class_name_snapshot"),
          cell("group_id"),
          ...CSV_FIELDS.map(([, field]) =>
            field === "异常标记"
              ? Boolean(row.anomaly_flag)
              : cell(field === "group_name" ? "group_name_snapshot" : field),
          ),
          cell("yield_percent"),
          cell("status"),
          cell("review_status"),
          cell("effective_review_id"),
          cell("created_by_user_id"),
          cell("created_by_label"),
          cell("created_at"),
          cell("updated_at"),
          cell("submission_kind"),
          cell("csv_import_batch_id"),
          cell("csv_source_row"),
        ];
        budget += values.reduce<number>(
          (n, value) => n + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0),
          0,
        );
        if (rows.length >= CSV_LIMITS.exportRows || budget > CSV_LIMITS.exportBytes)
          throw new CsvFault("limit", "EXPORT_LIMIT", "导出超过行数或字节限制，未生成部分文件");
        rows.push(values);
      }
      return rows;
    });
  }
}
