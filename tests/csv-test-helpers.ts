import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { APP_VERSION } from "../src/config/constants.js";
import { CsvService } from "../src/application/csv-service.js";
import { CSV_HEADERS, CSV_SCHEMA, type CsvContext } from "../src/domain/csv/contract.js";
import { NodeCsvCodec } from "../src/infrastructure/csv/node-csv-codec.js";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
} from "../src/infrastructure/database/migrations/index.js";
import { SqliteCsvRepository } from "../src/infrastructure/database/sqlite-csv-repository.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";
import { SlidingWindowRateLimiter } from "../src/shared/rate-limiter.js";

export const csvClock = { now: () => "2026-09-05T00:00:00.000Z" };
export const codec = new NodeCsvCodec();
export const syntheticCells = [
  "Synthetic 学生",
  "Synthetic G",
  "3",
  "100",
  "1",
  "45",
  "3.5",
  "轻微",
  "20",
  "synthetic control",
  "10",
  "3",
  "false",
  "",
  "synthetic fixture only",
  "2024-02-29",
  "",
  "manual_direct",
];
export const csvBytes = (rows: string[][] = [syntheticCells]) => codec.serialize(CSV_HEADERS, rows);
export function csvContext(id = "teacher"): CsvContext {
  return {
    actor: {
      id,
      role: id === "admin" ? "admin" : "teacher",
      username: id,
      name: id,
      class_name: "Synthetic A",
      sidHash: createHash("sha256").update(`synthetic-session-${id}`).digest("hex"),
    },
    ip: "127.0.0.1",
    ua: "synthetic test",
  };
}
export function openCsvDb(file = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=5000");
  return db;
}

// Test-only sign-in fixture after a scope change; retired tokens are never revived.
export function freshCsvCookie(db: DatabaseSync, userId: string, rawToken: string): string {
  const sidHash = createHash("sha256").update(rawToken).digest("hex");
  const result = db
    .prepare(
      "INSERT INTO sessions(sid_hash,user_id,role,created_at,expires_at) SELECT ?,id,role,?,? FROM users WHERE id=? AND status='active'",
    )
    .run(sidHash, csvClock.now(), Date.parse("2035-01-01T00:00:00Z"), userId);
  if (Number(result.changes) !== 1) throw new Error("Cannot seed an active fixture session");
  return `citrus_sid=${rawToken}`;
}
export function seedCsv(db: DatabaseSync, version = LATEST_SCHEMA_VERSION): void {
  runMigrations(db, MIGRATIONS.slice(0, version), csvClock.now);
  for (const id of ["A", "B"])
    db.prepare("INSERT INTO classes(id,name,created_at) VALUES(?,?,?)").run(
      `class-${id}`,
      `Synthetic ${id}`,
      csvClock.now(),
    );
  for (const id of ["teacher", "peer", "other", "admin", "student", "disabled", "demo"]) {
    const role = id === "admin" || id === "student" ? id : "teacher";
    db.prepare(
      `INSERT INTO users(id,role,username,password_hash,default_password,name,class_name,group_name,status,data_json,created_at)
      VALUES(?,?,?,'scrypt$synthetic-test',0,?,?,'',?,'{}',?)`,
    ).run(
      id,
      role,
      id,
      id,
      id === "other" ? "Synthetic B" : "Synthetic A",
      ["disabled", "demo"].includes(id) ? id : "active",
      csvClock.now(),
    );
    db.prepare(
      "INSERT INTO sessions(sid_hash,user_id,role,created_at,expires_at) VALUES(?,?,?,?,?)",
    ).run(
      csvContext(id).actor!.sidHash!,
      id,
      role,
      csvClock.now(),
      Date.parse("2035-01-01T00:00:00Z"),
    );
  }
}
export function csvFixture(file = ":memory:", initialize = true, version = LATEST_SCHEMA_VERSION) {
  const db = openCsvDb(file);
  if (initialize) seedCsv(db, version);
  const repo = new SqliteCsvRepository(db, APP_VERSION, csvClock);
  const service = new CsvService(repo, codec, codec, new SlidingWindowRateLimiter(60_000, 10));
  const context = csvContext();
  const submit = (
    bytes = csvBytes(),
    token = "synthetic-import-0001",
    actor = context,
    classId = "class-A",
  ) => service.import(actor, classId, CSV_SCHEMA, token, codec.sha256(bytes), bytes);
  return { db, repo, service, context, submit, store: new SqliteProvenanceStore(db) };
}
export function csvSnapshot(db: DatabaseSync) {
  return Object.fromEntries(
    [
      "classes",
      "groups",
      "experiment_records",
      "csv_import_rows",
      "csv_import_batches",
      "audit_logs",
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
  );
}
