import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  CSV_HEADERS,
  CSV_LIMITS,
  CsvFault,
  type CsvCell,
  type CsvCodec,
  type ContentHasher,
} from "../../domain/csv/contract.js";

export class NodeCsvCodec implements CsvCodec, ContentHasher {
  sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  parse(bytes: Uint8Array): string[][] {
    if (bytes.byteLength > CSV_LIMITS.bytes)
      throw new CsvFault("limit", "FILE_TOO_LARGE", "CSV 超过 1 MiB 限制");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new CsvFault("input", "INVALID_UTF8", "CSV 必须使用 UTF-8 编码");
    }
    if (text.startsWith("\uFEFF")) text = text.slice(1);
    let records: string[][];
    try {
      records = parse(text, {
        bom: false,
        delimiter: ",",
        record_delimiter: ["\r\n", "\n"],
        cast: false,
        columns: false,
        skip_empty_lines: false,
        skip_records_with_error: false,
        relax_quotes: false,
        relax_column_count: false,
        trim: false,
        max_record_size: CSV_LIMITS.recordBuffer,
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "CSV_MAX_RECORD_SIZE"
      )
        throw new CsvFault("limit", "RECORD_LIMIT", "CSV 单记录超过解析缓冲区限制");
      throw new CsvFault("input", "CSV_SYNTAX", "CSV 引号、列数或单行长度无效");
    }
    const header = records.shift();
    if (
      !header ||
      header.length !== CSV_HEADERS.length ||
      header.some((value, i) => value !== CSV_HEADERS[i])
    )
      throw new CsvFault("input", "CSV_HEADER", "表头必须与 v1 模板的 18 列及顺序完全一致");
    if (!records.length) throw new CsvFault("input", "CSV_EMPTY", "CSV 至少需要一条数据记录");
    if (records.length > CSV_LIMITS.rows)
      throw new CsvFault("limit", "ROW_LIMIT", "CSV 最多包含 500 条数据记录");
    return records;
  }

  serialize(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): Uint8Array {
    const values = [headers, ...rows].map((row) =>
      row.map((value) => (typeof value === "boolean" ? String(value) : value)),
    );
    return Buffer.from(
      stringify(values, { bom: true, quoted: true, quoted_empty: true, record_delimiter: "\r\n" }),
      "utf8",
    );
  }
}
