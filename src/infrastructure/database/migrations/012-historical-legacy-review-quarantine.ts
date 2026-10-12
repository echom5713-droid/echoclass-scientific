import type { DatabaseSync } from "node:sqlite";
import { isStrictTimestamp } from "../../../shared/strict-timestamp.js";
import { ANALYSIS_SNAPSHOT_LEGACY, ANALYSIS_SNAPSHOT_V1 } from "../analysis-snapshot-v1.js";
import type { Migration } from "./types.js";

const MIGRATION_NAME = "historical_legacy_review_quarantine";
const CLASSIFICATION_INSERT_SEAL = "provenance_boundary_classifications_010_insert_seal";

type Row = Record<string, unknown>;

interface InvalidReview {
  reviewId: string;
  recordId: string;
}

interface AffectedInput {
  runId: string;
  ordinal: number;
  recordId: string;
  reviewIds: Set<string>;
}

interface QuarantineAudit {
  invalidReviews: InvalidReview[];
  affectedInputs: AffectedInput[];
  affectedRuns: Map<string, Set<string>>;
}

interface ForeignKeyFinding {
  table: string;
  rowid: number | null;
  parent: string;
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function requireColumns(database: DatabaseSync, table: string, columns: string[]): void {
  const existing = new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Row[]).map((row) =>
      valueText(row.name),
    ),
  );
  for (const column of columns)
    if (!existing.has(column)) throw new Error(`Migration 012 requires ${table}.${column}`);
}

function requireSchema11(database: DatabaseSync): void {
  const requiredTables = [
    "experiment_records",
    "record_reviews",
    "analysis_runs",
    "analysis_inputs",
    "provenance_boundary_classifications",
  ];
  const tables = new Set(
    (
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name IN (${requiredTables.map(() => "?").join(",")})`,
        )
        .all(...requiredTables) as unknown as Row[]
    ).map((row) => valueText(row.name)),
  );
  const missingTables = requiredTables.filter((table) => !tables.has(table));
  if (missingTables.length)
    throw new Error(`Migration 012 requires schema-11 tables: ${missingTables.join(",")}`);

  requireColumns(database, "experiment_records", ["id", "submission_kind"]);
  requireColumns(database, "record_reviews", ["id", "record_id", "provenance_kind"]);
  requireColumns(database, "analysis_runs", ["id", "dataset_classification"]);
  requireColumns(database, "analysis_inputs", [
    "analysis_run_id",
    "ordinal",
    "record_id",
    "review_id",
    "record_snapshot_json",
    "snapshot_schema",
    "review_binding_mode",
  ]);

  const requiredTriggers = [
    "record_reviews_011_legacy_import_authority",
    CLASSIFICATION_INSERT_SEAL,
    "provenance_boundary_classifications_010_update_seal",
    "provenance_boundary_classifications_010_delete_seal",
    "analysis_inputs_no_update",
    "analysis_runs_dataset_classification_immutable",
  ];
  const triggers = new Set(
    (
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='trigger' AND name IN (${requiredTriggers.map(() => "?").join(",")})`,
        )
        .all(...requiredTriggers) as unknown as Row[]
    ).map((row) => valueText(row.name)),
  );
  const missingTriggers = requiredTriggers.filter((trigger) => !triggers.has(trigger));
  if (missingTriggers.length)
    throw new Error(`Migration 012 requires schema-11 guards: ${missingTriggers.join(",")}`);

  const foreignKeyFindings = database
    .prepare("PRAGMA foreign_key_check")
    .all() as unknown as ForeignKeyFinding[];
  if (foreignKeyFindings.length) {
    const finding = foreignKeyFindings[0]!;
    throw new Error(
      `Migration 012 foreign-key preflight failed: ${finding.table}:${String(finding.rowid)}:${finding.parent}`,
    );
  }
}

function auditHistoricalLegacyReviewAuthority(database: DatabaseSync): QuarantineAudit {
  requireSchema11(database);
  const invalidReviews = database
    .prepare(
      `SELECT rr.id AS review_id,rr.record_id
       FROM record_reviews rr
       JOIN experiment_records er ON er.id=rr.record_id
       WHERE rr.provenance_kind='legacy_projection'
         AND er.submission_kind='canonical_submission'
       ORDER BY rr.record_id,rr.id`,
    )
    .all()
    .map((row) => {
      const value = row as Row;
      return {
        reviewId: valueText(value.review_id),
        recordId: valueText(value.record_id),
      };
    });

  const affectedByKey = new Map<string, AffectedInput>();
  const selectInputs = database.prepare(
    `SELECT ai.analysis_run_id,ai.ordinal,ai.record_id
     FROM analysis_inputs ai
     JOIN analysis_runs ar ON ar.id=ai.analysis_run_id
     WHERE ar.dataset_classification='exact'
       AND ai.snapshot_schema=?
       AND (
         ai.review_id=?
         OR CASE WHEN json_valid(ai.record_snapshot_json)=1
           THEN json_extract(ai.record_snapshot_json,'$.effective_review_id') END=?
       )
     ORDER BY ai.analysis_run_id,ai.ordinal`,
  );
  for (const invalid of invalidReviews)
    for (const row of selectInputs.all(ANALYSIS_SNAPSHOT_V1, invalid.reviewId, invalid.reviewId)) {
      const value = row as Row;
      const runId = valueText(value.analysis_run_id);
      const ordinal = Number(value.ordinal);
      const key = `${runId}\u0000${ordinal}`;
      const affected = affectedByKey.get(key) ?? {
        runId,
        ordinal,
        recordId: valueText(value.record_id),
        reviewIds: new Set<string>(),
      };
      affected.reviewIds.add(invalid.reviewId);
      affectedByKey.set(key, affected);
    }

  const affectedInputs = [...affectedByKey.values()].sort(
    (left, right) => left.runId.localeCompare(right.runId) || left.ordinal - right.ordinal,
  );
  const affectedRuns = new Map<string, Set<string>>();
  for (const input of affectedInputs) {
    const reviewIds = affectedRuns.get(input.runId) ?? new Set<string>();
    for (const reviewId of input.reviewIds) reviewIds.add(reviewId);
    affectedRuns.set(input.runId, reviewIds);
  }
  return { invalidReviews, affectedInputs, affectedRuns };
}

function appendClassifications(
  database: DatabaseSync,
  audit: QuarantineAudit,
  classifiedAt: string,
): void {
  database.exec(`DROP TRIGGER ${CLASSIFICATION_INSERT_SEAL}`);
  const insert = database.prepare(
    `INSERT INTO provenance_boundary_classifications(
      classification_migration_version,classification_migration_name,
      entity_type,entity_id,field_name,classification,observed_value,reason,classified_at
    ) VALUES(12,?,?,?,?,?,?,?,?)`,
  );
  for (const review of audit.invalidReviews)
    insert.run(
      MIGRATION_NAME,
      "review",
      review.reviewId,
      "provenance_kind",
      "legacy_review_authority_unverified",
      review.recordId,
      `Review ${review.reviewId} is legacy_projection on canonical_submission record ${review.recordId}; legacy_projection cannot truthfully originate from a canonical_submission under the supported provenance model.`,
      classifiedAt,
    );
  for (const input of audit.affectedInputs) {
    const reviewIds = [...input.reviewIds].sort().join("|");
    insert.run(
      MIGRATION_NAME,
      "analysis_input",
      `${input.runId}#${input.ordinal}`,
      "snapshot_schema",
      "legacy_unverified_analysis_input",
      `${input.runId}:${input.ordinal}:${input.recordId}`,
      `Migration 012 downgraded this exact input because it binds or snapshots definite-invalid legacy review evidence ${reviewIds} for canonical record ${input.recordId}; immutable snapshot bytes were preserved.`,
      classifiedAt,
    );
  }
  for (const [runId, reviewIds] of [...audit.affectedRuns].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    insert.run(
      MIGRATION_NAME,
      "analysis_run",
      runId,
      "dataset_classification",
      "historical_input_attribution_unverified",
      [...reviewIds].sort().join("|"),
      `Migration 012 downgraded this exact run because its sealed inputs depend on definite-invalid legacy review authority evidence ${[...reviewIds].sort().join("|")}.`,
      classifiedAt,
    );
}

function downgradeAffectedInputs(database: DatabaseSync, audit: QuarantineAudit): void {
  if (audit.affectedInputs.length) {
    database.exec(`
      DROP TRIGGER analysis_inputs_no_update;
      DROP TRIGGER analysis_runs_dataset_classification_immutable;
    `);
    const downgradeInput = database.prepare(
      `UPDATE analysis_inputs
       SET snapshot_schema=?,review_binding_mode='legacy_unspecified'
       WHERE analysis_run_id=? AND ordinal=? AND snapshot_schema=?`,
    );
    for (const input of audit.affectedInputs)
      downgradeInput.run(
        ANALYSIS_SNAPSHOT_LEGACY,
        input.runId,
        input.ordinal,
        ANALYSIS_SNAPSHOT_V1,
      );
    const downgradeRun = database.prepare(
      `UPDATE analysis_runs SET dataset_classification='legacy_unverified'
       WHERE id=? AND dataset_classification='exact'`,
    );
    for (const runId of [...audit.affectedRuns.keys()].sort()) downgradeRun.run(runId);
    database.exec(`
      CREATE TRIGGER analysis_inputs_no_update BEFORE UPDATE ON analysis_inputs
      BEGIN SELECT RAISE(ABORT,'analysis inputs are immutable'); END;
      CREATE TRIGGER analysis_runs_dataset_classification_immutable
      BEFORE UPDATE OF dataset_classification ON analysis_runs
      WHEN NEW.dataset_classification IS NOT OLD.dataset_classification
      BEGIN SELECT RAISE(ABORT,'analysis dataset classification is immutable'); END;
    `);
  }
  database.exec(`
    CREATE TRIGGER ${CLASSIFICATION_INSERT_SEAL}
    BEFORE INSERT ON provenance_boundary_classifications BEGIN
      SELECT RAISE(ABORT,'provenance classification ledger is migration-write-only');
    END;
  `);
}

export const historicalLegacyReviewQuarantineMigration: Migration = {
  version: 12,
  name: MIGRATION_NAME,
  preflight(database) {
    auditHistoricalLegacyReviewAuthority(database);
  },
  up(database, context) {
    if (!isStrictTimestamp(context.appliedAt))
      throw new Error("Migration 012 requires a canonical migration timestamp");
    const audit = auditHistoricalLegacyReviewAuthority(database);
    appendClassifications(database, audit, context.appliedAt);
    downgradeAffectedInputs(database, audit);
  },
};
