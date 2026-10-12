import type { CreateExperimentCommand, Session } from "../types.js";
import { validateExperiment } from "../experiments/validation.js";
import { hasNonBlankUnicodeText } from "../../shared/provenance-contract.js";

export const CSV_SCHEMA = "echoclass.csv.experiment.v1";
export const CSV_EXPORT_SCHEMA = "echoclass.csv.experiment-export.v1";
export const CSV_DIAGNOSTICS = "pre_import_class_cohort.v1";
export const CSV_LIMITS = Object.freeze({
  bytes: 1_048_576,
  rows: 500,
  recordBuffer: 16_384,
  errors: 100,
  preview: 20,
  exportRows: 5_000,
  exportBytes: 5_242_880,
});

export const CSV_FIELDS = [
  ["student_name", "student_name"],
  ["group_name", "group_name"],
  ["nh4cl_concentration_pct", "nh4cl_concentration"],
  ["peel_mass_g", "peel_mass"],
  ["oil_mass_g", "oil_mass"],
  ["distillation_time_min", "distillation_time"],
  ["phase_clarity_score", "phase_clarity_score"],
  ["emulsification_level", "emulsification_level"],
  ["emulsion_concentration_pct", "emulsion_concentration"],
  ["ecoli_observation_group", "ecoli_observation_group"],
  ["inhibition_zone_diameter_mm", "inhibition_zone_diameter"],
  ["colony_growth_score", "colony_growth_score"],
  ["anomaly_flag", "异常标记"],
  ["error_source", "error_source"],
  ["note", "note"],
  ["experiment_date", "experiment_date"],
  ["petri_diameter_mm", "petri_diameter_mm"],
  ["measurement_method", "measurement_method"],
] as const;
export const CSV_HEADERS: readonly string[] = CSV_FIELDS.map(([header]) => header);
export const CSV_EXPORT_HEADERS: readonly string[] = [
  "record_id",
  "class_id",
  "class_name",
  "group_id",
  ...CSV_HEADERS,
  "yield_percent",
  "status",
  "review_status",
  "effective_review_id",
  "created_by_user_id",
  "created_by",
  "created_at",
  "updated_at",
  "submission_kind",
  "csv_import_batch_id",
  "csv_source_row",
];
export type CsvCell = string | number | boolean | null;
export interface CsvIssue {
  row_number: number | null;
  field: string;
  code: string;
  message: string;
}
export class CsvFault extends Error {
  constructor(
    public readonly kind:
      | "input"
      | "limit"
      | "unauthenticated"
      | "forbidden"
      | "missing"
      | "conflict"
      | "unavailable"
      | "corrupt",
    public readonly reason: string,
    message: string,
    public readonly issues: CsvIssue[] = [],
  ) {
    super(message);
    this.name = "CsvFault";
  }
}
export interface CsvContext {
  actor: Session | null;
  ip: string;
  ua: string;
}
export interface CsvClass {
  id: string;
  name: string;
}
export interface CsvSource {
  class_id: string;
  client_import_id: string;
  schema_version: string;
  raw_sha256: string;
  byte_length: number;
}
export interface CsvReceipt extends CsvSource {
  batch_id: string;
  uploader_user_id: string;
  uploader_label_snapshot: string;
  class_name_snapshot: string;
  row_count: number;
  created_at: string;
  completed_at: string;
  app_version: string;
  diagnostics_policy: string;
  rows: Array<{ row_number: number; record_id: string }>;
}
export interface CsvCommitResult {
  receipt: CsvReceipt;
  replayed: boolean;
  added_this_request: number;
}
export interface CsvRepository {
  authorize(context: CsvContext): { id: string };
  classes(context: CsvContext): CsvClass[];
  resolveClass(context: CsvContext, classId: string): CsvClass;
  findReceipt(context: CsvContext, source: CsvSource): CsvReceipt | null;
  getReceipt(context: CsvContext, batchId: string): CsvReceipt;
  commit(
    context: CsvContext,
    source: CsvSource,
    commands: readonly CreateExperimentCommand[],
  ): CsvCommitResult;
  exportRows(context: CsvContext, classId: string): CsvCell[][];
}
export interface CsvCodec {
  parse(bytes: Uint8Array): string[][];
  serialize(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): Uint8Array;
}
export interface ContentHasher {
  sha256(bytes: Uint8Array): string;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const numeric = [2, 3, 4, 5, 6, 8, 10, 11, 16] as const;
const textLimits = [
  [0, 40, true],
  [1, 80, false],
  [7, 80, true],
  [9, 80, true],
  [13, 500, false],
  [14, 2000, false],
] as const;

/** CSV lexical checks supplement, but never replace, the existing experiment validator. */
export function validateCsvRows(rows: readonly string[][], className: string) {
  const errors: CsvIssue[] = [];
  let errorCount = 0;
  const commands: CreateExperimentCommand[] = [];
  for (const [index, cells] of rows.entries()) {
    const seen = new Set<string>();
    const add = (column: number, code: string, message: string) => {
      const field = CSV_HEADERS[column] ?? "csv";
      if (seen.has(field)) return;
      seen.add(field);
      errorCount++;
      if (errors.length < CSV_LIMITS.errors)
        errors.push({ row_number: index + 1, field, code, message });
    };
    for (const [i, value] of cells.entries())
      if (value.includes("\u0000")) add(i, "INVALID_TEXT", "单元格不能包含 NUL 字符");
    for (const [i, maximum, required] of textLimits) {
      const value = cells[i]!;
      if (value.length > maximum) add(i, "TEXT_TOO_LONG", `文本最长 ${maximum} 个字符`);
      if ((required || (i === 1 && value !== "")) && !hasNonBlankUnicodeText(value))
        add(i, "REQUIRED_TEXT", "请填写非空白文本");
    }
    const nums = new Map<number, number>();
    for (const i of numeric) {
      const value = cells[i]!;
      if (i === 16 && value === "") continue;
      if (value.length > 64 || !NUMBER.test(value) || !Number.isFinite(Number(value)))
        add(i, "INVALID_NUMBER", "必须填写完整的有限十进制数字");
      nums.set(i, value !== "" && NUMBER.test(value) ? Number(value) : Number.NaN);
    }
    if (!["true", "false"].includes(cells[12]!)) add(12, "INVALID_BOOLEAN", "只接受 true 或 false");
    if (!["not_recorded", "manual_direct"].includes(cells[17]!))
      add(17, "INVALID_MEASUREMENT_METHOD", "CSV v1 只接受 not_recorded / manual_direct");
    const command: CreateExperimentCommand = {
      student_name: cells[0]!,
      class_name: className,
      group_name: cells[1]!,
      nh4cl_concentration: nums.get(2)!,
      peel_mass: nums.get(3)!,
      oil_mass: nums.get(4)!,
      distillation_time: nums.get(5)!,
      phase_clarity_score: nums.get(6)!,
      emulsification_level: cells[7]!,
      emulsion_concentration: nums.get(8)!,
      ecoli_observation_group: cells[9]!,
      inhibition_zone_diameter: nums.get(10)!,
      colony_growth_score: nums.get(11)!,
      异常标记: cells[12] === "true",
      error_source: cells[13]!,
      note: cells[14]!,
      experiment_date: cells[15] || undefined,
      petri_diameter_mm: nums.get(16),
      measurement_method: cells[17] as CreateExperimentCommand["measurement_method"],
    };
    for (const finding of validateExperiment(command)) {
      const column = CSV_FIELDS.findIndex(([, field]) => field === finding.field);
      add(column, finding.code, finding.message);
    }
    commands.push(command);
  }
  return {
    valid: errorCount === 0,
    commands,
    errors,
    error_count: errorCount,
    errors_truncated: errorCount > errors.length,
  };
}

/** A display transformation only: stored text is never changed. */
export function spreadsheetText(value: string): string {
  // eslint-disable-next-line no-control-regex -- Detect spreadsheet control prefixes without modifying stored text.
  const probe = value.replace(/^[\p{White_Space}\p{Cf}\u0000-\u001f\u007f-\u009f\uFEFF']*/u, "");
  // eslint-disable-next-line no-control-regex -- C0/C1 prefixes explicitly require display protection.
  return /^[\u0000-\u001f\u007f-\u009f]/u.test(value) || /^[=+@＝＋－＠-]/u.test(probe)
    ? `text:${value}`
    : value;
}
