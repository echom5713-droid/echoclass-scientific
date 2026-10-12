import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  DIGEST,
  privateDirectory,
  readVerifiedObject,
  sha256,
  syncDirectory,
  validateObject,
  writeExclusive,
} from "../src/infrastructure/evidence/private-files.js";

export const BACKUP_FORMAT = "echoclass.sqlite-evidence-backup.v1";
const SUPPORTED_SCHEMAS = [15, 16, 17];
const MANIFEST_MAX_BYTES = 67_108_864;
const EXPECTED_MIGRATION_NAMES = [
  "initial_operational_schema",
  "normalized_scientific_provenance",
  "provenance_integrity_hardening",
  "end_to_end_provenance_closure",
  "independent_audit_provenance_repair",
  "temporal_analysis_contract_closure",
  "analysis_selection_and_run_integrity",
  "analysis_input_sealing_and_provenance_boundary",
  "sealed_dataset_and_historical_provenance_closure",
  "canonical_attribution_and_ledger_authority",
  "legacy_review_import_authority",
  "historical_legacy_review_quarantine",
  "csv_interchange",
  "finite_derived_yield",
  "durable_evidence_storage",
  "scientific_analysis_requests",
  "credential_session_boundary",
];

function checkedPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.split(/[\\/]/).includes("..")
  )
    throw new Error("Invalid path: parent traversal is not accepted");
  return path.resolve(value);
}

async function isPresent(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function regularFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Expected a regular file without a symbolic link");
  return stat;
}

async function databasePath(file) {
  await privateDirectory(path.dirname(file));
  await regularFile(file);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (await isPresent(file + suffix)) await regularFile(file + suffix);
  }
}

async function hashFile(file, synchronize = false) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1)
      throw new Error("Invalid file");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(131_072);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, length);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > stat.size) throw new Error("File changed while reading");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (length !== stat.size) throw new Error("File changed while reading");
    if (synchronize) await handle.sync();
    return { sha256: hash.digest("hex"), byte_length: length };
  } finally {
    await handle.close();
  }
}

async function copyDatabase(source, destination, expected) {
  const input = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let output;
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size !== expected.byte_length)
      throw new Error("Database length mismatch");
    output = await open(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    const buffer = Buffer.alloc(131_072);
    const digest = createHash("sha256");
    let offset = 0;
    while (offset < stat.size) {
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - offset),
        offset,
      );
      if (!bytesRead) throw new Error("Incomplete database");
      digest.update(buffer.subarray(0, bytesRead));
      await output.writeFile(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (
      (await input.read(Buffer.alloc(1), 0, 1, offset)).bytesRead ||
      digest.digest("hex") !== expected.sha256
    )
      throw new Error("Database digest mismatch");
    await output.sync();
  } finally {
    await input.close();
    if (output) await output.close();
  }
}

function inspectDatabase(file, expectedVersion) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    database.exec(
      "PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
      throw new Error("SQLite integrity check failed");
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("SQLite foreign-key check failed");
    const migrations = database
      .prepare("SELECT version,name FROM schema_migrations ORDER BY version")
      .all();
    if (
      !SUPPORTED_SCHEMAS.includes(migrations.length) ||
      (expectedVersion !== undefined && migrations.length !== expectedVersion) ||
      migrations.some((row, i) => row.version !== i + 1 || row.name !== EXPECTED_MIGRATION_NAMES[i])
    )
      throw new Error(
        "Unsupported or incomplete schema: expected the complete schema 15, 16 or 17 migration ledger",
      );
    const table = database.prepare("PRAGMA table_list('evidence_files')").get();
    if (!table || table.type !== "table" || table.strict !== 1)
      throw new Error("Evidence table must be STRICT");
    const objects = database
      .prepare("SELECT object_key,sha256,byte_length FROM evidence_files ORDER BY object_key")
      .all()
      .map((row) => ({ ...row }));
    const seen = new Set();
    let total = 0;
    for (const object of objects) {
      validateObject(object);
      if (seen.has(object.object_key)) throw new Error("Duplicate object reference");
      seen.add(object.object_key);
      total += object.byte_length;
    }
    if (total > 1_073_741_824)
      throw new Error("Evidence references exceed the supported database quota");
    return { objects, schemaVersion: migrations.length };
  } finally {
    database.close();
  }
}

async function reserve(directory) {
  await privateDirectory(path.dirname(directory));
  // No recursive mkdir here: an existing empty directory must also be refused.
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(path.dirname(directory));
}

async function createObjectDirectories(directory) {
  await privateDirectory(path.join(directory, "evidence", "objects"), true);
}

async function syncTree(directory) {
  await syncDirectory(path.join(directory, "evidence", "objects"));
  await syncDirectory(path.join(directory, "evidence"));
  await syncDirectory(directory);
  await syncDirectory(path.dirname(directory));
}

async function copyObjects(source, destination, objects) {
  for (const object of objects) {
    const bytes = await readVerifiedObject(path.join(source, "evidence", "objects"), object);
    await writeExclusive(
      path.join(destination, "evidence", "objects", object.object_key),
      bytes,
      0o400,
    );
    await readVerifiedObject(path.join(destination, "evidence", "objects"), object);
  }
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === keys.toSorted().join("|")
  );
}

function validateManifest(manifest) {
  if (
    !exactKeys(manifest, [
      "format",
      "created_at",
      "schema_version",
      "database",
      "objects",
      "scope",
    ]) ||
    manifest.format !== BACKUP_FORMAT ||
    !SUPPORTED_SCHEMAS.includes(manifest.schema_version) ||
    manifest.scope !== "sqlite-and-evidence-only" ||
    typeof manifest.created_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.created_at) ||
    !Number.isFinite(Date.parse(manifest.created_at)) ||
    new Date(manifest.created_at).toISOString() !== manifest.created_at ||
    !exactKeys(manifest.database, ["file", "sha256", "byte_length"]) ||
    manifest.database.file !== "citrus.db" ||
    typeof manifest.database.sha256 !== "string" ||
    !DIGEST.test(manifest.database.sha256) ||
    !Number.isSafeInteger(manifest.database.byte_length) ||
    manifest.database.byte_length < 1 ||
    !Array.isArray(manifest.objects)
  )
    throw new Error("Invalid backup manifest");
  let previous = "";
  let total = 0;
  for (const object of manifest.objects) {
    if (!exactKeys(object, ["object_key", "sha256", "byte_length"]))
      throw new Error("Invalid object manifest");
    validateObject(object);
    if (object.object_key <= previous) throw new Error("Duplicate or unordered object manifest");
    previous = object.object_key;
    total += object.byte_length;
  }
  if (total > 1_073_741_824) throw new Error("Evidence references exceed supported quota");
}

async function boundedJson(file, limit) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit)
      throw new Error("Invalid backup metadata size");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("Incomplete backup metadata");
      offset += bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead)
      throw new Error("Backup metadata changed");
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), bytes };
  } finally {
    await handle.close();
  }
}

async function exactDirectory(directory, expected) {
  await privateDirectory(directory);
  const entries = await readdir(directory);
  if (entries.toSorted().join("\0") !== expected.toSorted().join("\0"))
    throw new Error("Unexpected or missing backup entries");
}

async function readBackup(directory) {
  await exactDirectory(directory, ["citrus.db", "evidence", "manifest.json", "COMPLETE"]);
  const { value: completion } = await boundedJson(path.join(directory, "COMPLETE"), 1024);
  const { value: manifest, bytes } = await boundedJson(
    path.join(directory, "manifest.json"),
    MANIFEST_MAX_BYTES,
  );
  validateManifest(manifest);
  if (
    !exactKeys(completion, ["format", "manifest_sha256"]) ||
    completion.format !== BACKUP_FORMAT ||
    completion.manifest_sha256 !== sha256(bytes)
  )
    throw new Error("Incomplete or altered backup manifest");
  await exactDirectory(path.join(directory, "evidence"), ["objects"]);
  await exactDirectory(
    path.join(directory, "evidence", "objects"),
    manifest.objects.map((row) => row.object_key),
  );
  await databasePath(path.join(directory, "citrus.db"));
  const actual = await hashFile(path.join(directory, "citrus.db"));
  if (
    actual.sha256 !== manifest.database.sha256 ||
    actual.byte_length !== manifest.database.byte_length
  )
    throw new Error("Database does not match manifest");
  const { objects } = inspectDatabase(path.join(directory, "citrus.db"), manifest.schema_version);
  if (JSON.stringify(objects) !== JSON.stringify(manifest.objects))
    throw new Error("Database references do not match manifest");
  for (const object of objects)
    await readVerifiedObject(path.join(directory, "evidence", "objects"), object);
  return { manifest, bytes };
}

export async function createBackup(dataDir, destination) {
  const source = checkedPath(dataDir);
  const target = checkedPath(destination);
  await privateDirectory(source);
  if (await isPresent(path.join(source, "RESTORE_IN_PROGRESS")))
    throw new Error("Cannot back up an incomplete restore");
  const sourceDatabase = path.join(source, "citrus.db");
  await databasePath(sourceDatabase);
  await reserve(target);
  await createObjectDirectories(target);
  const database = new DatabaseSync(sourceDatabase, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF");
    // VACUUM INTO incorporates committed WAL pages into one consistent snapshot.
    // Failure is final: copying a live main database is never a safe fallback.
    database.exec(`VACUUM INTO '${path.join(target, "citrus.db").replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
  const { objects, schemaVersion } = inspectDatabase(path.join(target, "citrus.db"));
  await copyObjects(source, target, objects);
  const dbFingerprint = await hashFile(path.join(target, "citrus.db"), true);
  const manifest = {
    format: BACKUP_FORMAT,
    created_at: new Date().toISOString(),
    schema_version: schemaVersion,
    database: { file: "citrus.db", ...dbFingerprint },
    objects,
    scope: "sqlite-and-evidence-only",
  };
  validateManifest(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  if (bytes.length > MANIFEST_MAX_BYTES)
    throw new Error("Backup manifest exceeds the 64 MiB maintenance limit");
  await syncTree(target);
  await writeExclusive(path.join(target, "manifest.json"), bytes, 0o400);
  await syncDirectory(target);
  await writeExclusive(
    path.join(target, "COMPLETE"),
    JSON.stringify({ format: BACKUP_FORMAT, manifest_sha256: sha256(bytes) }) + "\n",
    0o400,
  );
  await syncDirectory(target);
  await syncDirectory(path.dirname(target));
  return manifest;
}

export async function restoreBackup(backupDir, newDataDir) {
  const source = checkedPath(backupDir);
  const target = checkedPath(newDataDir);
  const { manifest, bytes } = await readBackup(source);
  await reserve(target);
  // The server refuses to open any data root carrying this marker. A failed or
  // interrupted restore deliberately keeps its partial directory and marker.
  await writeExclusive(
    path.join(target, "RESTORE_IN_PROGRESS"),
    "Restore has not completed. Do not start EchoClass with this directory.\n",
  );
  await syncDirectory(target);
  await createObjectDirectories(target);
  await copyDatabase(
    path.join(source, "citrus.db"),
    path.join(target, "citrus.db"),
    manifest.database,
  );
  await copyObjects(source, target, manifest.objects);
  const { objects } = inspectDatabase(path.join(target, "citrus.db"), manifest.schema_version);
  if (JSON.stringify(objects) !== JSON.stringify(manifest.objects))
    throw new Error("Restored database reference mismatch");
  if ((await hashFile(path.join(target, "citrus.db"), true)).sha256 !== manifest.database.sha256)
    throw new Error("Restored database changed during validation");
  await syncTree(target);
  await writeExclusive(path.join(target, "restore-manifest.json"), bytes, 0o400);
  await syncDirectory(target);
  await writeExclusive(
    path.join(target, "RESTORE_COMPLETE"),
    JSON.stringify({ format: BACKUP_FORMAT, manifest_sha256: sha256(bytes) }) + "\n",
    0o400,
  );
  await syncDirectory(target);
  await unlink(path.join(target, "RESTORE_IN_PROGRESS"));
  await syncDirectory(target);
  await syncDirectory(path.dirname(target));
  return manifest;
}
