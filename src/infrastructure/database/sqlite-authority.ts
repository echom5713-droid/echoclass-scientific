import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../../application/ports.js";
import { canAccessClass } from "../../domain/authorization.js";
import { CsvFault, type CsvClass, type CsvReceipt } from "../../domain/csv/contract.js";
import type { Session, UserRole } from "../../domain/types.js";

export type AuthorityContext = { actor: Session | null };
export type DatabaseRow = Record<string, unknown>;

export class SqliteAuthorityFault extends Error {
  constructor(public readonly reason: "session_required" | "session_expired" | "role_required") {
    super(reason);
    this.name = "SqliteAuthorityFault";
  }
}

/** Runs within its caller's transaction; it never opens a second transaction. */
export function currentAccount(
  db: DatabaseSync,
  context: AuthorityContext,
  clock: Clock,
  roles: readonly UserRole[],
): Session {
  if (!context.actor?.sidHash) throw new SqliteAuthorityFault("session_required");
  const row = db
    .prepare(
      `SELECT u.id,u.role,u.username,u.name,u.class_name,u.status,s.expires_at,s.revoked_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.sid_hash=? AND u.id=?`,
    )
    .get(context.actor.sidHash, context.actor.id) as DatabaseRow | undefined;
  const now = Date.parse(clock.now());
  if (
    !row ||
    row.revoked_at !== null ||
    !Number.isFinite(now) ||
    !Number.isFinite(Number(row.expires_at)) ||
    Number(row.expires_at) <= now
  )
    throw new SqliteAuthorityFault("session_expired");
  if (row.status !== "active" || !roles.includes(row.role as UserRole))
    throw new SqliteAuthorityFault("role_required");
  return {
    id: String(row.id),
    role: row.role as UserRole,
    username: String(row.username),
    name: String(row.name),
    class_name: String(row.class_name ?? ""),
    sidHash: context.actor.sidHash,
  };
}

export function csvAuthorityFault(error: SqliteAuthorityFault): CsvFault {
  if (error.reason === "session_required")
    return new CsvFault("unauthenticated", "CSV_SESSION_REQUIRED", "请登录后使用 CSV 工作流");
  if (error.reason === "session_expired")
    return new CsvFault("unauthenticated", "CSV_SESSION_EXPIRED", "会话已失效，请重新登录");
  return new CsvFault(
    "forbidden",
    "CSV_ROLE_REQUIRED",
    "仅有效教师或管理员账号可使用真实 CSV 工作流",
  );
}

export function authorizedCsvClass(db: DatabaseSync, actor: Session, id: string): CsvClass {
  const row = db.prepare("SELECT id,name FROM classes WHERE id=?").get(id) as
    DatabaseRow | undefined;
  if (!row) throw new CsvFault("missing", "CSV_CLASS_NOT_FOUND", "班级不存在");
  if (!canAccessClass(actor, String(row.name)))
    throw new CsvFault("forbidden", "CSV_CLASS_FORBIDDEN", "无权访问该班级");
  return { id: String(row.id), name: String(row.name) };
}

/** Includes archived records and their current class, preserving the CSV receipt contract. */
export function authorizedCsvReceipt(
  db: DatabaseSync,
  actor: Session,
  row: DatabaseRow,
): CsvReceipt {
  authorizedCsvClass(db, actor, String(row.class_id));
  if (actor.role === "student" || (actor.role !== "admin" && row.uploader_user_id !== actor.id))
    throw new CsvFault("forbidden", "CSV_RECEIPT_OWNER", "无权读取该导入回执");
  const mappings = db
    .prepare(
      `SELECT cr.row_number,cr.record_id,c.name AS current_class_name
    FROM csv_import_rows cr JOIN experiment_records er ON er.id=cr.record_id
    JOIN classes c ON c.id=er.class_id WHERE cr.batch_id=? ORDER BY cr.row_number`,
    )
    .all(String(row.id));
  if (
    mappings.length !== Number(row.row_count) ||
    mappings.some((mapping, i) => Number(mapping.row_number) !== i + 1)
  )
    throw new CsvFault("corrupt", "CSV_MAPPING_INCOMPLETE", "CSV 来源映射不完整");
  if (mappings.some((mapping) => !canAccessClass(actor, String(mapping.current_class_name))))
    throw new CsvFault(
      "conflict",
      "BATCH_SCOPE_CHANGED",
      "批次中存在当前无权访问的记录，无法展示回执",
    );
  return {
    batch_id: String(row.id),
    uploader_user_id: String(row.uploader_user_id),
    uploader_label_snapshot: String(row.uploader_label_snapshot),
    class_id: String(row.class_id),
    class_name_snapshot: String(row.class_name_snapshot),
    client_import_id: String(row.client_import_id),
    schema_version: String(row.schema_version),
    raw_sha256: String(row.raw_sha256),
    byte_length: Number(row.byte_length),
    row_count: Number(row.row_count),
    created_at: String(row.created_at),
    completed_at: String(row.completed_at),
    app_version: String(row.app_version),
    diagnostics_policy: String(row.diagnostics_policy),
    rows: mappings.map((mapping) => ({
      row_number: Number(mapping.row_number),
      record_id: String(mapping.record_id),
    })),
  };
}
