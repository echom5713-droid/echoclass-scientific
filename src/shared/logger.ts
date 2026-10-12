export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  request_id?: string | undefined;
  event: string;
  route?: string | undefined;
  actor_role?: string | undefined;
  result?: string | undefined;
  duration_ms?: number | undefined;
  status?: number | undefined;
}

export function log(entry: LogEntry): void {
  const record = { timestamp: new Date().toISOString(), ...entry };
  const output = JSON.stringify(record);
  if (entry.level === "error") console.error(output);
  else if (entry.level === "warn") console.warn(output);
  else console.log(output);
}
