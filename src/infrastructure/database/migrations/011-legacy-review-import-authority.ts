import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./types.js";

const MIGRATION_NAME = "legacy_review_import_authority";
const TRIGGER_NAME = "record_reviews_011_legacy_import_authority";

interface SqliteObjectRow {
  name: string;
}

interface ForeignKeyFinding {
  table: string;
  rowid: number | null;
  parent: string;
}

function requireSchema10(database: DatabaseSync): void {
  const requiredTables = [
    "experiment_records",
    "record_reviews",
    "legacy_import_batches",
    "storage_imports",
  ];
  const existingTables = new Set(
    (
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name IN (${requiredTables.map(() => "?").join(",")})`,
        )
        .all(...requiredTables) as unknown as SqliteObjectRow[]
    ).map((row) => row.name),
  );
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0)
    throw new Error(`Migration 011 requires schema-10 tables: ${missingTables.join(",")}`);

  const experimentColumns = new Set(
    (
      database.prepare("PRAGMA table_info(experiment_records)").all() as unknown as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  for (const column of ["id", "submission_kind", "storage_import_id"])
    if (!experimentColumns.has(column))
      throw new Error(`Migration 011 requires experiment_records.${column}`);

  const reviewColumns = new Set(
    (
      database.prepare("PRAGMA table_info(record_reviews)").all() as unknown as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  for (const column of ["record_id", "provenance_kind"])
    if (!reviewColumns.has(column))
      throw new Error(`Migration 011 requires record_reviews.${column}`);

  const existingTrigger = database
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?")
    .get(TRIGGER_NAME) as SqliteObjectRow | undefined;
  if (existingTrigger)
    throw new Error(`Migration 011 found an unexpected pre-existing trigger: ${TRIGGER_NAME}`);

  const foreignKeyFindings = database
    .prepare("PRAGMA foreign_key_check")
    .all() as unknown as ForeignKeyFinding[];
  if (foreignKeyFindings.length > 0) {
    const finding = foreignKeyFindings[0]!;
    throw new Error(
      `Migration 011 foreign-key preflight failed: ${finding.table}:${String(finding.rowid)}:${finding.parent}`,
    );
  }
}

function installLegacyReviewAuthority(database: DatabaseSync): void {
  database.exec(`
    CREATE TRIGGER ${TRIGGER_NAME}
    BEFORE INSERT ON record_reviews
    WHEN NEW.provenance_kind='legacy_projection' AND NOT EXISTS(
      SELECT 1
      FROM experiment_records er
      JOIN legacy_import_batches lib ON lib.id=er.storage_import_id
      WHERE er.id=NEW.record_id
        AND er.submission_kind='legacy_canonical_snapshot'
        AND er.storage_import_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM storage_imports si WHERE si.id=lib.id)
    )
    BEGIN
      SELECT RAISE(ABORT,'legacy review import requires an open durable import batch');
    END
  `);
}

export const legacyReviewImportAuthorityMigration: Migration = {
  version: 11,
  name: MIGRATION_NAME,
  up(database) {
    requireSchema10(database);
    installLegacyReviewAuthority(database);
  },
};
