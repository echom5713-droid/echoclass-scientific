import { AppError } from "../../application/errors.js";
import type { CreateExperimentCommand, OfflineExperimentCommand } from "../../domain/types.js";
import { isMachineIdentity } from "../../shared/provenance-contract.js";

const PROTECTED_FIELDS = [
  "created_at",
  "updated_at",
  "created_by",
  "yield_percent",
  "review_status",
  "review_note",
  "reviewed_at",
  "reviewed_by",
  "ai_diagnosis",
  "metadata",
  "synced_from_offline",
] as const;

const NUMERIC_FIELDS = [
  "nh4cl_concentration",
  "peel_mass",
  "oil_mass",
  "distillation_time",
  "phase_clarity_score",
  "emulsion_concentration",
  "inhibition_zone_diameter",
  "colony_growth_score",
] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function strictBoolean(value: unknown, fields: Array<{ field: string; message: string }>): boolean {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false ||
    value === 0 ||
    value === "0" ||
    value === "false"
  )
    return false;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  fields.push({ field: "异常标记", message: "异常标记必须是明确的布尔值" });
  return false;
}

export function parseCreateExperiment(body: Record<string, unknown>): CreateExperimentCommand {
  const findings: Array<{ field: string; message: string; code: string }> = [];
  for (const field of PROTECTED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field))
      findings.push({ field, message: `${field} 是服务器维护字段`, code: "PROTECTED_FIELD" });
  }

  const numbers = {} as Record<(typeof NUMERIC_FIELDS)[number], number>;
  for (const field of NUMERIC_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null || value === "") {
      findings.push({ field, message: `${field} 是必填科学观测值`, code: "REQUIRED_FIELD" });
      numbers[field] = Number.NaN;
      continue;
    }
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed))
      findings.push({ field, message: `${field} 必须是有效数字`, code: "INVALID_FIELD" });
    numbers[field] = parsed;
  }
  const booleanFindings: Array<{ field: string; message: string }> = [];
  const abnormal = strictBoolean(body.异常标记, booleanFindings);
  findings.push(...booleanFindings.map((item) => ({ ...item, code: "INVALID_FIELD" })));
  const experimentDate = text(body.experiment_date);
  if (experimentDate) {
    const parsedDate = new Date(`${experimentDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(experimentDate) ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== experimentDate
    )
      findings.push({
        field: "experiment_date",
        message: "experiment_date 必须是有效的 YYYY-MM-DD 日期",
        code: "INVALID_FIELD",
      });
  }
  let petriDiameter: number | undefined;
  if (
    body.petri_diameter_mm !== undefined &&
    body.petri_diameter_mm !== null &&
    body.petri_diameter_mm !== ""
  ) {
    const parsed =
      typeof body.petri_diameter_mm === "number"
        ? body.petri_diameter_mm
        : Number(body.petri_diameter_mm);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500)
      findings.push({
        field: "petri_diameter_mm",
        message: "petri_diameter_mm 必须是 0 到 500 mm 之间的有效数字",
        code: "INVALID_FIELD",
      });
    else petriDiameter = parsed;
  }
  const methodText = text(body.measurement_method);
  const imageState = text(body.measurement_image_state) || "manual_only";
  const measurementMethod = methodText || "manual_direct";
  if (
    !["not_recorded", "manual_direct", "manual_local_image_calibrated"].includes(measurementMethod)
  )
    findings.push({
      field: "measurement_method",
      message: "measurement_method 无效",
      code: "INVALID_FIELD",
    });
  if (
    !["manual_only", "image_loaded", "calibrated_complete"].includes(imageState) ||
    (measurementMethod === "manual_local_image_calibrated" && imageState !== "calibrated_complete")
  )
    findings.push({
      field: "measurement_image_state",
      message: "图像标定状态与测量方法不一致",
      code: "INVALID_FIELD",
    });
  if (findings.length)
    throw new AppError("VALIDATION_ERROR", "提交数据未通过传输层验证", 400, findings);

  return {
    student_name: text(body.student_name ?? body.name),
    class_name: text(body.class_name),
    group_name: text(body.group_name ?? body.group_no),
    nh4cl_concentration: numbers.nh4cl_concentration,
    peel_mass: numbers.peel_mass,
    oil_mass: numbers.oil_mass,
    distillation_time: numbers.distillation_time,
    phase_clarity_score: numbers.phase_clarity_score,
    emulsification_level: text(body.emulsification_level),
    emulsion_concentration: numbers.emulsion_concentration,
    ecoli_observation_group: text(body.ecoli_observation_group),
    inhibition_zone_diameter: numbers.inhibition_zone_diameter,
    colony_growth_score: numbers.colony_growth_score,
    异常标记: abnormal,
    error_source: text(body.error_source),
    note: text(body.note),
    experiment_date: experimentDate || undefined,
    petri_diameter_mm: petriDiameter,
    measurement_method: measurementMethod as CreateExperimentCommand["measurement_method"],
  };
}

export function parseOfflineExperiment(body: Record<string, unknown>): OfflineExperimentCommand {
  const clientSubmissionId = body.client_submission_id;
  if (!isMachineIdentity(clientSubmissionId))
    throw new AppError("VALIDATION_ERROR", "client_submission_id 无效", 400, [
      {
        field: "client_submission_id",
        message: "离线提交标识必填且格式无效",
        code: "INVALID_FIELD",
      },
    ]);
  return { ...parseCreateExperiment(body), client_submission_id: clientSubmissionId };
}
