import type { DatabaseSync } from "node:sqlite";
import { initialSchemaMigration } from "./001-initial-schema.js";
import { normalizedProvenanceMigration } from "./002-normalized-provenance.js";
import { preflightAndPrepareMigration2 } from "./002-legacy-preflight.js";
import { provenanceIntegrityHardeningMigration } from "./003-provenance-integrity-hardening.js";
import { endToEndProvenanceClosureMigration } from "./004-end-to-end-provenance-closure.js";
import { independentAuditProvenanceRepairMigration } from "./005-independent-audit-provenance-repair.js";
import { temporalAnalysisContractClosureMigration } from "./006-temporal-analysis-contract-closure.js";
import { analysisSelectionAndRunIntegrityMigration } from "./007-analysis-selection-and-run-integrity.js";
import { analysisInputSealingAndProvenanceBoundaryMigration } from "./008-analysis-input-sealing-and-provenance-boundary.js";
import { sealedDatasetAndHistoricalProvenanceClosureMigration } from "./009-sealed-dataset-and-historical-provenance-closure.js";
import { canonicalAttributionAndLedgerAuthorityMigration } from "./010-canonical-attribution-and-ledger-authority.js";
import { legacyReviewImportAuthorityMigration } from "./011-legacy-review-import-authority.js";
import { historicalLegacyReviewQuarantineMigration } from "./012-historical-legacy-review-quarantine.js";
import { csvInterchangeMigration } from "./013-csv-interchange.js";
import { finiteDerivedYieldMigration } from "./014-finite-derived-yield.js";
import { durableEvidenceStorageMigration } from "./015-durable-evidence-storage.js";
import { scientificAnalysisRequestsMigration } from "./016-scientific-analysis-requests.js";
import { credentialSessionBoundaryMigration } from "./017-credential-session-boundary.js";
import { runMigrationList } from "./runner.js";
import type { Migration, MigrationResult } from "./types.js";

export const MIGRATIONS: readonly Migration[] = [
  initialSchemaMigration,
  { ...normalizedProvenanceMigration, preflight: preflightAndPrepareMigration2 },
  provenanceIntegrityHardeningMigration,
  endToEndProvenanceClosureMigration,
  independentAuditProvenanceRepairMigration,
  temporalAnalysisContractClosureMigration,
  analysisSelectionAndRunIntegrityMigration,
  analysisInputSealingAndProvenanceBoundaryMigration,
  sealedDatasetAndHistoricalProvenanceClosureMigration,
  canonicalAttributionAndLedgerAuthorityMigration,
  legacyReviewImportAuthorityMigration,
  historicalLegacyReviewQuarantineMigration,
  csvInterchangeMigration,
  finiteDerivedYieldMigration,
  durableEvidenceStorageMigration,
  scientificAnalysisRequestsMigration,
  credentialSessionBoundaryMigration,
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export function runMigrations(
  database: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): MigrationResult {
  return runMigrationList(database, migrations, now);
}

export type { Migration, MigrationResult } from "./types.js";
