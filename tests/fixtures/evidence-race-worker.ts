import { randomUUID } from "node:crypto";
import { SqliteEvidenceRepository } from "../../src/infrastructure/database/sqlite-evidence-repository.js";
import { EVIDENCE_SCHEMA, type EvidenceSource } from "../../src/domain/evidence/contract.js";
import { csvClock, csvContext, openCsvDb } from "../csv-test-helpers.js";

const db = openCsvDb(process.argv[2]);
const repository = new SqliteEvidenceRepository(db, "synthetic-test", csvClock);
process.send?.("ready");
process.once("message", () => {
  try {
    const source: EvidenceSource = {
      schema_version: EVIDENCE_SCHEMA,
      client_upload_id: process.argv[4] ?? "synthetic-upload-race",
      sha256: "a".repeat(64),
      byte_length: 10,
      media_type: "image/png",
      extension: "png",
      original_name: "synthetic.png",
    };
    const result = repository.commit(
      csvContext(),
      { kind: "record", id: process.argv[3]! },
      source,
      { object_key: randomUUID(), sha256: source.sha256, byte_length: source.byte_length },
    );
    process.send?.({ id: result.evidence.id, replayed: result.replayed });
  } catch (error) {
    process.send?.({ failure: error instanceof Error ? error.message : String(error) });
  } finally {
    db.close();
    process.disconnect?.();
  }
});
