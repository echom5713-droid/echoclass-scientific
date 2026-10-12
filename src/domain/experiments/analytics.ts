import type { ExperimentRecord } from "../types.js";
import { diagnoseRecord, type RecordDiagnosis } from "./diagnostics.js";

type RecordLike = ExperimentRecord;

export function isContaminated(record: Partial<RecordLike>): boolean {
  const value: unknown = (record as unknown as Record<string, unknown>)["异常标记"];
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

export interface GroupStatistic {
  conc: number;
  count: number;
  meanYield: number;
  medianYield: number;
  stdYield: number;
  meanZone: number;
  stdZone: number;
  phase: number;
}

/** Highest represented means, preserving exact ties in the existing descriptive calculation. */
export function highestObservedGroups(stats: readonly GroupStatistic[]): GroupStatistic[] {
  const observed = stats.filter((group) => group.count > 0 && Number.isFinite(group.meanYield));
  if (!observed.length) return [];
  const highest = Math.max(...observed.map((group) => group.meanYield));
  return observed.filter((group) => group.meanYield === highest);
}

export interface QuadraticFit {
  a: number;
  b: number;
  c: number;
  optimum: number;
  predictedYield: number;
  curve: Array<{ x: number; y: number }>;
}

export function yieldPercentFor(record: Partial<RecordLike>): number {
  const peel = Number(record.peel_mass);
  const oil = Number(record.oil_mass);
  if (Number.isFinite(peel) && Number.isFinite(oil) && peel > 0 && oil > 0)
    return (oil / peel) * 100;
  const stored = Number(record.yield_percent);
  return Number.isFinite(stored) ? stored : 0;
}

export function mean(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

export function stddev(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  const average = mean(finite);
  return Math.sqrt(
    finite.reduce((sum, value) => sum + (value - average) ** 2, 0) / (finite.length - 1),
  );
}

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const lower = sorted[base] ?? 0;
  const upper = sorted[base + 1];
  return upper === undefined ? lower : lower + rest * (upper - lower);
}

function median(values: readonly number[]): number {
  return quantile(
    [...values].filter(Number.isFinite).sort((a, b) => a - b),
    0.5,
  );
}

export function recordDiagnostics(
  record: RecordLike,
  cohort: readonly ExperimentRecord[] = [],
): RecordDiagnosis {
  return diagnoseRecord(record, cohort);
}

export function recordInclusion(record: RecordLike, cohort: readonly ExperimentRecord[] = []) {
  const flag = String(record.review_status ?? "").toLowerCase();
  const diagnosis = recordDiagnostics(record, cohort);
  if (flag === "excluded")
    return {
      status: "excluded",
      label: "已排除",
      included: false,
      reasons: record.review_note ? [record.review_note] : diagnosis.reasons,
    };
  if (flag === "included")
    return {
      status: "included",
      label: "已纳入",
      included: true,
      reasons: record.review_note ? [record.review_note] : diagnosis.reasons,
    };
  if (diagnosis.status === "review")
    return { status: "review", label: "需复核", included: false, reasons: diagnosis.reasons };
  return { status: "normal", label: "正常", included: true, reasons: diagnosis.reasons };
}

export function validRecords(records: readonly ExperimentRecord[]): ExperimentRecord[] {
  return records.filter((record) => recordInclusion(record, records).included);
}

export function groupStats(records: readonly ExperimentRecord[]): GroupStatistic[] {
  const source = validRecords(records);
  return [0, 1, 3, 4].map((conc) => {
    const rows = source.filter((record) => record.nh4cl_concentration === conc);
    const yields = rows.map(yieldPercentFor).filter(Number.isFinite);
    const zones = rows.map((record) => record.inhibition_zone_diameter).filter(Number.isFinite);
    const phases = rows.map((record) => record.phase_clarity_score).filter(Number.isFinite);
    return {
      conc,
      count: rows.length,
      meanYield: mean(yields),
      medianYield: median(yields),
      stdYield: stddev(yields),
      meanZone: mean(zones),
      stdZone: stddev(zones),
      phase: mean(phases),
    };
  });
}

function solve3(matrix: number[][], vector: number[]): [number, number, number] | null {
  const rows = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1)
      if (Math.abs(rows[row]?.[column] ?? 0) > Math.abs(rows[pivot]?.[column] ?? 0)) pivot = row;
    if (Math.abs(rows[pivot]?.[column] ?? 0) < 1e-9) return null;
    [rows[column], rows[pivot]] = [rows[pivot] ?? [], rows[column] ?? []];
    const divisor = rows[column]?.[column] ?? 1;
    for (let item = column; item < 4; item += 1)
      if (rows[column]) rows[column]![item] = (rows[column]![item] ?? 0) / divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row]?.[column] ?? 0;
      for (let item = column; item < 4; item += 1)
        if (rows[row])
          rows[row]![item] = (rows[row]![item] ?? 0) - factor * (rows[column]?.[item] ?? 0);
    }
  }
  return [rows[0]?.[3] ?? 0, rows[1]?.[3] ?? 0, rows[2]?.[3] ?? 0];
}

export function quadraticFit(points: Array<{ x: number; y: number }>): QuadraticFit | null {
  const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (valid.length < 3) return null;
  const sums = valid.reduce<{
    n: number;
    x: number;
    x2: number;
    x3: number;
    x4: number;
    y: number;
    xy: number;
    x2y: number;
  }>(
    (all, point) => ({
      n: all.n + 1,
      x: all.x + point.x,
      x2: all.x2 + point.x ** 2,
      x3: all.x3 + point.x ** 3,
      x4: all.x4 + point.x ** 4,
      y: all.y + point.y,
      xy: all.xy + point.x * point.y,
      x2y: all.x2y + point.x ** 2 * point.y,
    }),
    { n: 0, x: 0, x2: 0, x3: 0, x4: 0, y: 0, xy: 0, x2y: 0 },
  );
  const coefficients = solve3(
    [
      [sums.x4, sums.x3, sums.x2],
      [sums.x3, sums.x2, sums.x],
      [sums.x2, sums.x, sums.n],
    ],
    [sums.x2y, sums.xy, sums.y],
  );
  if (!coefficients) return null;
  const [a, b, c] = coefficients;
  const predict = (x: number): number => a * x * x + b * x + c;
  const vertex = Math.abs(a) > 1e-9 && a < 0 ? Math.min(4, Math.max(0, -b / (2 * a))) : null;
  const optimum = vertex ?? [...valid].sort((left, right) => right.y - left.y)[0]?.x ?? 3;
  return {
    a: Number(a.toFixed(5)),
    b: Number(b.toFixed(5)),
    c: Number(c.toFixed(5)),
    optimum: Number(optimum.toFixed(2)),
    predictedYield: Number(Math.max(0, predict(optimum)).toFixed(3)),
    curve: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((x) => ({
      x,
      y: Number(Math.max(0, predict(x)).toFixed(3)),
    })),
  };
}

export function errorSource(record: ExperimentRecord): string {
  const diagnosis = recordDiagnostics(record).reasons.join(" ");
  const explicit = String(record.error_source ?? "");
  if (explicit.includes("无明显")) return "无明显异常";
  if (explicit.trim()) return explicit;
  if (diagnosis.includes("乳化")) return "乳化严重";
  if (diagnosis.includes("水相") || diagnosis.includes("偏高")) return "混入水相";
  if (diagnosis.includes("皮重") || diagnosis.includes("称量")) return "称量误差";
  if (diagnosis.includes("污染")) return "污染标记";
  if (Number(record.phase_clarity_score) <= 2) return "分层不清";
  return "无明显异常";
}

export function analyticsFor(records: ExperimentRecord[]) {
  const stats = groupStats(records);
  const fit = quadraticFit(
    stats.filter((item) => item.count > 0).map((item) => ({ x: item.conc, y: item.meanYield })),
  );
  const diagnostics = records.map((record) => {
    const inclusion = recordInclusion(record, records);
    const diagnosis = recordDiagnostics(record, records);
    return {
      id: record.id,
      student_name: record.student_name,
      group_name: record.group_name,
      class_name: record.class_name,
      conc: record.nh4cl_concentration,
      ...diagnosis,
      inclusion: inclusion.status,
      included: inclusion.included,
      label: inclusion.label,
    };
  });
  const review = diagnostics.filter((item) => item.inclusion === "review");
  const excluded = diagnostics.filter((item) => item.inclusion === "excluded");
  const hotwordCandidates: Array<[string, number]> = [
    [
      "乳化",
      records.filter((record) => String(record.emulsification_level ?? "").includes("乳化")).length,
    ],
    [
      "得率偏高",
      review.filter((item) => item.reasons.some((reason) => reason.includes("偏高"))).length,
    ],
    [
      "对照组",
      records.filter((record) => String(record.ecoli_observation_group ?? "").includes("对照"))
        .length,
    ],
    ["抑菌圈", records.filter((record) => record.inhibition_zone_diameter > 0).length],
    ["污染标记", records.filter(isContaminated).length],
    [
      "Tween 80",
      records.filter((record) => String(record.ecoli_observation_group ?? "").includes("Tween 80"))
        .length,
    ],
    ["分层不清", records.filter((record) => record.phase_clarity_score <= 2).length],
  ];
  const hotwords = hotwordCandidates
    .filter((entry) => entry[1] > 0)
    .sort((left, right) => right[1] - left[1]);
  const errorCounts: Record<string, number> = Object.fromEntries(
    ["乳化严重", "称量误差", "混入水相", "分层不清", "污染标记", "边缘模糊", "无明显异常"].map(
      (type) => [type, 0],
    ),
  );
  for (const record of records) {
    const type = errorSource(record);
    errorCounts[type] = (errorCounts[type] ?? 0) + 1;
  }
  return {
    count: records.length,
    validCount: validRecords(records).length,
    reviewCount: review.length,
    excludedCount: excluded.length,
    stats,
    fit,
    diagnostics,
    hotwords,
    errorCounts,
    classes: [...new Set(records.map((record) => record.class_name || "未分班"))],
    generated_at: new Date().toISOString(),
  };
}

export function inhibitionGrade(value: number) {
  if (!Number.isFinite(value) || value <= 1)
    return {
      level: "无明显抑制",
      color: "#94a3b8",
      note: "观察不到稳定抑菌圈，需结合对照组和重复实验判断。",
    };
  if (value < 8)
    return { level: "弱抑制", color: "#f59e0b", note: "存在轻微生长受抑现象，建议增加平行数据。" };
  if (value < 15)
    return {
      level: "中等抑制",
      color: "#10b981",
      note: "抑菌现象较清楚，但仍需结合扩散性和对照组解释。",
    };
  return {
    level: "较强抑制",
    color: "#2563eb",
    note: "抑菌圈较明显，建议复核边缘清晰度并避免作绝对结论。",
  };
}
