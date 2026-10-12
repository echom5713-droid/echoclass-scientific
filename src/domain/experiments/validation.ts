import type { ExperimentRecordInput } from "../types.js";
import { hasNonblankText } from "../../shared/nonblank-text.js";

export interface ValidationFinding {
  field: string;
  message: string;
  code: "INVALID_FIELD";
}

function invalid(field: ValidationFinding["field"], message: string): ValidationFinding {
  return { field, message, code: "INVALID_FIELD" };
}

function isValidDate(value: string, legacySnapshotContract: boolean): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || (!legacySnapshotContract && value.startsWith("0000-")))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateExperiment(
  input: ExperimentRecordInput,
  options: { legacySnapshotContract?: true } = {},
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  // Released snapshot parsers and migrations retain their original acceptance rules.
  const requiredText = options.legacySnapshotContract
    ? (value: unknown): value is string => typeof value === "string" && value.length > 0
    : hasNonblankText;
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  if (!requiredText(input.student_name) || input.student_name.length > 40)
    findings.push(invalid("student_name", "学生姓名缺失或过长"));
  if (!finite(input.nh4cl_concentration) || ![0, 1, 3, 4].includes(input.nh4cl_concentration))
    findings.push(invalid("nh4cl_concentration", "NH₄Cl 浓度只能为 0%、1%、3%、4%"));
  if (!finite(input.peel_mass) || !(input.peel_mass > 0 && input.peel_mass <= 1000))
    findings.push(invalid("peel_mass", "橘皮质量不合理"));
  if (!finite(input.oil_mass) || !(input.oil_mass >= 0 && input.oil_mass <= 20))
    findings.push(invalid("oil_mass", "精油质量不合理"));
  // Individually finite masses can still overflow the existing yield formula.
  // This is a representability check, not a minimum scientific mass threshold.
  if (
    finite(input.peel_mass) &&
    input.peel_mass > 0 &&
    input.peel_mass <= 1000 &&
    finite(input.oil_mass) &&
    input.oil_mass >= 0 &&
    input.oil_mass <= 20 &&
    !Number.isFinite((input.oil_mass / input.peel_mass) * 100)
  )
    findings.push(invalid("peel_mass", "橘皮质量与精油质量计算的产率超出有限数值范围"));
  if (
    !finite(input.distillation_time) ||
    !(input.distillation_time > 0 && input.distillation_time <= 1440)
  )
    findings.push(invalid("distillation_time", "蒸馏时间不合理"));
  if (
    !finite(input.phase_clarity_score) ||
    !(input.phase_clarity_score >= 1 && input.phase_clarity_score <= 5)
  )
    findings.push(invalid("phase_clarity_score", "分层清晰度评分不合理"));
  if (!requiredText(input.emulsification_level))
    findings.push(invalid("emulsification_level", "乳化情况缺失"));
  if (
    !finite(input.emulsion_concentration) ||
    !(input.emulsion_concentration >= 0 && input.emulsion_concentration <= 100)
  )
    findings.push(invalid("emulsion_concentration", "精油乳液浓度不合理"));
  if (!requiredText(input.ecoli_observation_group))
    findings.push(invalid("ecoli_observation_group", "观察组别缺失"));
  if (
    !finite(input.inhibition_zone_diameter) ||
    input.inhibition_zone_diameter < 0 ||
    input.inhibition_zone_diameter > 60
  )
    findings.push(invalid("inhibition_zone_diameter", "抑菌圈直径不合理"));
  if (
    !finite(input.colony_growth_score) ||
    !(input.colony_growth_score >= 1 && input.colony_growth_score <= 5)
  )
    findings.push(invalid("colony_growth_score", "菌落生长评分不合理"));
  if (typeof input.异常标记 !== "boolean") findings.push(invalid("异常标记", "异常标记类型无效"));
  if (!requiredText(input.class_name) || input.class_name.length > 80)
    findings.push(invalid("class_name", "班级名称缺失或过长"));
  if (typeof input.group_name !== "string")
    findings.push(invalid("group_name", "小组名称类型无效"));
  if (typeof input.error_source !== "string")
    findings.push(invalid("error_source", "误差来源类型无效"));
  if (typeof input.note !== "string") findings.push(invalid("note", "备注类型无效"));
  if (
    input.experiment_date !== undefined &&
    (typeof input.experiment_date !== "string" ||
      !isValidDate(input.experiment_date, options.legacySnapshotContract === true))
  )
    findings.push(invalid("experiment_date", "实验日期无效"));
  if (
    input.petri_diameter_mm !== undefined &&
    (!finite(input.petri_diameter_mm) ||
      !(input.petri_diameter_mm > 0 && input.petri_diameter_mm <= 500))
  )
    findings.push(invalid("petri_diameter_mm", "培养皿直径不合理"));
  if (
    input.measurement_method !== undefined &&
    (typeof input.measurement_method !== "string" ||
      ![
        "not_recorded",
        "not_recorded_legacy",
        "manual_direct",
        "manual_local_image_calibrated",
      ].includes(input.measurement_method))
  )
    findings.push(invalid("measurement_method", "测量方法无效"));
  if (
    input.measurement_method === "manual_local_image_calibrated" &&
    (input.petri_diameter_mm === undefined ||
      !Number.isFinite(input.petri_diameter_mm) ||
      input.petri_diameter_mm <= 0 ||
      input.petri_diameter_mm > 500)
  )
    findings.push(invalid("petri_diameter_mm", "本地图像校准测量必须提供有效培养皿直径"));
  return findings;
}
