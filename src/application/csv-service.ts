import { AppError, type ErrorCode } from "./errors.js";
import type { RateLimiter } from "./ports.js";
import { isMachineIdentity } from "../shared/provenance-contract.js";
import {
  CSV_SCHEMA,
  CSV_EXPORT_SCHEMA,
  CSV_EXPORT_HEADERS,
  CSV_HEADERS,
  CSV_LIMITS,
  CsvFault,
  spreadsheetText,
  validateCsvRows,
  type ContentHasher,
  type CsvCodec,
  type CsvContext,
  type CsvRepository,
  type CsvSource,
} from "../domain/csv/contract.js";

const failureStatuses = {
  input: ["VALIDATION_ERROR", 400],
  limit: ["VALIDATION_ERROR", 413],
  unauthenticated: ["AUTHENTICATION_REQUIRED", 401],
  forbidden: ["FORBIDDEN", 403],
  missing: ["NOT_FOUND", 404],
  conflict: ["CONFLICT", 409],
  unavailable: ["STORAGE_UNAVAILABLE", 503],
  corrupt: ["INTERNAL_ERROR", 500],
} as const satisfies Record<CsvFault["kind"], readonly [ErrorCode, number]>;

export class CsvService {
  constructor(
    private readonly repository: CsvRepository,
    private readonly codec: CsvCodec,
    private readonly hashes: ContentHasher,
    private readonly limiter: RateLimiter,
  ) {}

  private invoke<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (!(error instanceof CsvFault)) throw error;
      const [code, status] = failureStatuses[error.kind];
      throw new AppError(
        code,
        error.kind === "corrupt" ? "CSV 来源数据异常" : error.message,
        status,
        error.issues.length
          ? error.issues
          : [{ row_number: null, field: "csv", code: error.reason, message: error.message }],
      );
    }
  }

  gate(context: CsvContext, limited: boolean): { id: string } {
    return this.invoke(() => {
      const actor = this.repository.authorize(context);
      if (limited && !this.limiter.allow(actor.id))
        throw new AppError("RATE_LIMITED", "CSV 操作过于频繁，请稍后重试", 429);
      return actor;
    });
  }

  classes(context: CsvContext) {
    return this.invoke(() => this.repository.classes(context));
  }
  resolveClass(context: CsvContext, classId: string) {
    return this.invoke(() => {
      if (!isMachineIdentity(classId))
        throw new CsvFault("input", "INVALID_CLASS_ID", "班级 ID 格式无效");
      return this.repository.resolveClass(context, classId);
    });
  }
  template() {
    return this.codec.serialize(CSV_HEADERS, []);
  }

  private envelope(classId: string, schema: string, bytes: Uint8Array): void {
    if (!isMachineIdentity(classId) || schema !== CSV_SCHEMA)
      throw new CsvFault("input", "CSV_ENVELOPE", "班级 ID 或 CSV 契约版本无效");
    if (bytes.byteLength > CSV_LIMITS.bytes)
      throw new CsvFault("limit", "FILE_TOO_LARGE", "CSV 超过 1 MiB 限制");
  }

  preview(context: CsvContext, classId: string, schema: string, bytes: Uint8Array) {
    return this.invoke(() => {
      this.envelope(classId, schema, bytes);
      const classroom = this.repository.resolveClass(context, classId);
      const rows = this.codec.parse(bytes);
      const result = validateCsvRows(rows, classroom.name);
      return {
        ok: true,
        schema_version: schema,
        class_id: classroom.id,
        class_name: classroom.name,
        raw_sha256: this.hashes.sha256(bytes),
        byte_length: bytes.byteLength,
        row_count: rows.length,
        valid: result.valid,
        errors: result.errors,
        error_count: result.error_count,
        errors_truncated: result.errors_truncated,
        preview: rows
          .slice(0, CSV_LIMITS.preview)
          .map((cells, i) => ({ row_number: i + 1, values: cells })),
        headers: CSV_HEADERS,
      };
    });
  }

  import(
    context: CsvContext,
    classId: string,
    schema: string,
    token: string,
    expectedHash: string,
    bytes: Uint8Array,
  ) {
    return this.invoke(() => {
      this.envelope(classId, schema, bytes);
      const classroom = this.repository.resolveClass(context, classId);
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash))
        throw new CsvFault("input", "CSV_IMPORT_IDENTITY", "导入标识或预览摘要格式无效");
      const actualHash = this.hashes.sha256(bytes);
      if (actualHash !== expectedHash)
        throw new CsvFault(
          "conflict",
          "PREVIEW_BYTES_CHANGED",
          "文件字节与预览摘要不一致，请重新预览",
        );
      const source: CsvSource = {
        class_id: classId,
        schema_version: schema,
        client_import_id: token,
        raw_sha256: actualHash,
        byte_length: bytes.byteLength,
      };
      const prior = this.repository.findReceipt(context, source);
      if (prior) return { receipt: prior, replayed: true, added_this_request: 0 };
      const result = validateCsvRows(this.codec.parse(bytes), classroom.name);
      if (!result.valid)
        throw new AppError(
          "VALIDATION_ERROR",
          `CSV 未通过验证（${result.error_count} 个错误${result.errors_truncated ? "，仅展示前 100 个" : ""}），未导入任何记录`,
          422,
          result.errors,
        );
      return this.repository.commit(context, source, result.commands);
    });
  }

  receipt(context: CsvContext, batchId: string) {
    return this.invoke(() => {
      if (!isMachineIdentity(batchId))
        throw new CsvFault("input", "INVALID_BATCH_ID", "批次 ID 格式无效");
      return this.repository.getReceipt(context, batchId);
    });
  }

  export(context: CsvContext, classId: string) {
    return this.invoke(() => {
      if (!isMachineIdentity(classId))
        throw new CsvFault("input", "INVALID_CLASS_ID", "班级 ID 格式无效");
      const rows = this.repository.exportRows(context, classId).map((row) =>
        row.map((cell) => {
          if (typeof cell === "number" && !Number.isFinite(cell))
            throw new CsvFault("corrupt", "NONFINITE_VALUE", "导出数据包含非有限数字");
          return typeof cell === "string" ? spreadsheetText(cell) : cell;
        }),
      );
      const bytes = this.codec.serialize(CSV_EXPORT_HEADERS, rows);
      if (bytes.byteLength > CSV_LIMITS.exportBytes)
        throw new CsvFault("limit", "EXPORT_LIMIT", "导出超过 5 MiB 限制，未生成部分文件");
      return { bytes, schema: CSV_EXPORT_SCHEMA };
    });
  }
}
