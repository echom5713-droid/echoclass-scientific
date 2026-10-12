import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadEnvFile(fileName: string): void {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function integerEnv(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

export const env = Object.freeze({
  port: integerEnv("PORT", 3000, 1),
  nodeEnv: process.env.NODE_ENV ?? "development",
  seedDemo: process.env.ECHOCLASS_SEED_DEMO === "1",
  scientificEnabled: process.env.ECHOCLASS_SCIENTIFIC_ENABLED !== "0",
  scientificPython: process.env.ECHOCLASS_PYTHON || "python3",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  deepseekBaseUrl: process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com",
  deepseekTimeoutMs: integerEnv("DEEPSEEK_API_TIMEOUT_MS", 20_000, 100),
  deepseekMaxTokens: integerEnv("DEEPSEEK_MAX_TOKENS", 650, 1),
  aiRateWindowMs: integerEnv("AI_RATE_WINDOW_MS", 60_000, 1),
  aiRateMaximum: integerEnv("AI_RATE_MAX", 10, 1),
});

export type AppEnv = typeof env;
