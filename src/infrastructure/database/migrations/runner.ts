import type { DatabaseSync } from "node:sqlite";
import type { Migration, MigrationResult } from "./types.js";

interface AppliedMigrationRow {
  version: number;
  name: string;
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The original migration error remains authoritative when no transaction is active.
  }
}

export function runMigrationList(
  database: DatabaseSync,
  migrations: readonly Migration[],
  now: () => string,
): MigrationResult {
  database.exec("PRAGMA recursive_triggers=ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS schema_migrations_duplicate_guard
    BEFORE INSERT ON schema_migrations
    WHEN EXISTS(
      SELECT 1 FROM schema_migrations WHERE version=NEW.version OR name=NEW.name
    ) BEGIN
      SELECT RAISE(ABORT, 'schema migration ledger is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS schema_migrations_no_update
    BEFORE UPDATE ON schema_migrations BEGIN
      SELECT RAISE(ABORT, 'schema migration ledger is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS schema_migrations_no_delete
    BEFORE DELETE ON schema_migrations BEGIN
      SELECT RAISE(ABORT, 'schema migration ledger is append-only');
    END
  `);
  const ordered = [...migrations];
  const names = new Set<string>();
  for (let index = 0; index < ordered.length; index += 1) {
    const migration = ordered[index]!;
    if (names.has(migration.name)) throw new Error(`Duplicate migration name ${migration.name}`);
    names.add(migration.name);
    if (index > 0 && ordered[index - 1]!.version >= migration.version)
      throw new Error(`Migration definitions are out of order at version ${migration.version}`);
  }
  const existing = database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as unknown as AppliedMigrationRow[];
  if (existing.length > ordered.length)
    throw new Error("Migration ledger is not an exact prefix of known migrations");
  for (let index = 0; index < existing.length; index += 1) {
    const row = existing[index]!;
    const expected = ordered[index];
    if (!expected || Number(row.version) !== expected.version || row.name !== expected.name)
      throw new Error(
        `Migration ledger prefix violation at version ${row.version}: gap, order, or name mismatch`,
      );
  }

  const completed: MigrationResult["applied"] = [];
  for (const migration of ordered.slice(existing.length)) {
    const appliedAt = now();
    database.exec("BEGIN IMMEDIATE");
    try {
      migration.preflight?.(database);
      migration.up(database, { appliedAt });
      database
        .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)")
        .run(migration.version, migration.name, appliedAt);
      database.exec("COMMIT");
      completed.push({ version: migration.version, name: migration.name, appliedAt });
    } catch (error) {
      rollback(database);
      throw error;
    }
  }
  const current = database
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as unknown as { version: number };
  return { applied: completed, currentVersion: Number(current.version) };
}
