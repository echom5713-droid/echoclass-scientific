import type { CreateExperimentCommand, ExperimentRecord } from "../types.js";

export interface RecordDiagnosis {
  status: "normal" | "review";
  reasons: string[];
}

export function diagnoseRecord(
  record: CreateExperimentCommand,
  cohort: readonly ExperimentRecord[] = [],
): RecordDiagnosis {
  const reasons: string[] = [];
  const yieldPercent = record.peel_mass > 0 ? (record.oil_mass / record.peel_mass) * 100 : 0;
  if (yieldPercent > 2) reasons.push("得率偏高，建议复核是否混入水相或未扣除容器皮重");
  if (yieldPercent < 0.35) reasons.push("得率偏低，建议检查蒸馏时间、冷凝效率与收集过程");
  if (Number(record.phase_clarity_score) <= 2 && yieldPercent >= 1.5)
    reasons.push("逻辑矛盾：分层清晰度较低但得率较高，可能混入底层水相");
  if (String(record.emulsification_level ?? "").includes("明显") && yieldPercent > 1.4)
    reasons.push("明显乳化条件下得率较高，建议复核样品是否充分分离");
  if (Number(record.inhibition_zone_diameter) > 20)
    reasons.push("抑菌圈直径偏大，建议复核测量尺度、扩散性和污染标记");
  if (
    Number(record.inhibition_zone_diameter) === 0 &&
    String(record.ecoli_observation_group ?? "").includes("精油")
  )
    reasons.push("精油组未观察到抑菌圈，建议检查乳液浓度或图像质量");
  if (record.异常标记) reasons.push("已被学生标记为疑似污染或异常观察");

  const group = cohort
    .filter((item) => item.nh4cl_concentration === record.nh4cl_concentration)
    .map((item) => item.yield_percent)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (group.length >= 4) {
    const quantile = (q: number): number => {
      const position = (group.length - 1) * q;
      const base = Math.floor(position);
      const rest = position - base;
      return group[base + 1] === undefined
        ? (group[base] ?? 0)
        : (group[base] ?? 0) + rest * ((group[base + 1] ?? 0) - (group[base] ?? 0));
    };
    const q1 = quantile(0.25);
    const q3 = quantile(0.75);
    const iqr = q3 - q1;
    if (iqr > 0 && (yieldPercent < q1 - 1.5 * iqr || yieldPercent > q3 + 1.5 * iqr))
      reasons.push("组内 IQR 规则标记为疑似离群值");
  }
  return { status: reasons.length ? "review" : "normal", reasons };
}
