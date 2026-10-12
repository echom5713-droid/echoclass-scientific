import type { DatabaseSync } from "node:sqlite";

interface LegacyPreflightFinding {
  id: string;
  field: string;
  reason: "missing" | "type" | "range";
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new Error("type");
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("type");
  return parsed as Record<string, unknown>;
}

export function parseLegacyBoolean(value: unknown): boolean {
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
  throw new Error("invalid legacy boolean");
}

export function preflightAndPrepareMigration2(database: DatabaseSync): void {
  const recordsTable = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='records'")
    .get();
  if (!recordsTable) return;
  const rows = database
    .prepare("SELECT id, data_json FROM records ORDER BY id")
    .all() as unknown as Array<{ id: string; data_json: string }>;
  const findings: LegacyPreflightFinding[] = [];
  const prepared: Array<{ id: string; data: Record<string, unknown> }> = [];
  const numericRules: Array<{ field: string; valid: (value: number) => boolean }> = [
    { field: "nh4cl_concentration", valid: (value) => [0, 1, 3, 4].includes(value) },
    { field: "peel_mass", valid: (value) => value > 0 && value <= 1000 },
    { field: "oil_mass", valid: (value) => value >= 0 && value <= 20 },
    { field: "distillation_time", valid: (value) => value > 0 && value <= 1440 },
    { field: "phase_clarity_score", valid: (value) => value >= 1 && value <= 5 },
    { field: "emulsion_concentration", valid: (value) => value >= 0 && value <= 100 },
    { field: "inhibition_zone_diameter", valid: (value) => value >= 0 && value <= 60 },
    { field: "colony_growth_score", valid: (value) => value >= 1 && value <= 5 },
  ];
  for (const row of rows) {
    let data: Record<string, unknown>;
    try {
      data = parseObject(row.data_json);
    } catch {
      findings.push({ id: row.id, field: "data_json", reason: "type" });
      continue;
    }
    for (const rule of numericRules) {
      const raw = data[rule.field];
      if (raw === undefined || raw === null || raw === "") {
        findings.push({ id: row.id, field: rule.field, reason: "missing" });
      } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
        findings.push({ id: row.id, field: rule.field, reason: "type" });
      } else if (!rule.valid(raw)) {
        findings.push({ id: row.id, field: rule.field, reason: "range" });
      }
    }
    for (const field of ["emulsification_level", "ecoli_observation_group"] as const) {
      if (typeof data[field] !== "string" || !data[field].trim())
        findings.push({
          id: row.id,
          field,
          reason: data[field] === undefined || data[field] === null ? "missing" : "type",
        });
    }
    try {
      data.异常标记 = parseLegacyBoolean(data.异常标记);
    } catch {
      findings.push({ id: row.id, field: "异常标记", reason: "type" });
    }
    prepared.push({ id: row.id, data });
  }
  if (findings.length)
    throw new Error(
      `Legacy migration preflight failed: ${findings
        .map((finding) => `${finding.id}:${finding.field}(${finding.reason})`)
        .join(", ")}`,
    );
  const update = database.prepare("UPDATE records SET data_json=? WHERE id=?");
  for (const row of prepared) update.run(JSON.stringify(row.data), row.id);
}

export function runMigrationPreflight(database: DatabaseSync, version: number): void {
  if (version === 2) preflightAndPrepareMigration2(database);
}
