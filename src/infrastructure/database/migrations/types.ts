import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  preflight?(database: DatabaseSync): void;
  up(database: DatabaseSync, context: { appliedAt: string }): void;
}

export interface MigrationResult {
  applied: Array<{ version: number; name: string; appliedAt: string }>;
  currentVersion: number;
}
