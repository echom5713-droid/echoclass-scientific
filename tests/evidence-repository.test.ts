import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { APP_VERSION } from "../src/config/constants.js";
import {
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA,
  EvidenceFault,
  type EvidenceContext,
  type EvidenceObject,
  type EvidenceSource,
  type EvidenceTarget,
} from "../src/domain/evidence/contract.js";
import { validateCsvRows } from "../src/domain/csv/contract.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteEvidenceRepository } from "../src/infrastructure/database/sqlite-evidence-repository.js";
import {
  csvClock,
  csvContext,
  csvFixture,
  openCsvDb,
  seedCsv,
  syntheticCells,
} from "./csv-test-helpers.js";

const source = (patch: Partial<EvidenceSource> = {}): EvidenceSource => ({
  schema_version: EVIDENCE_SCHEMA,
  client_upload_id: "synthetic-upload-0001",
  sha256: "a".repeat(64),
  byte_length: 10,
  media_type: "image/png",
  extension: "png",
  original_name: "synthetic.png",
  ...patch,
});
const object = (input: EvidenceSource = source()): EvidenceObject => ({
  object_key: randomUUID(),
  sha256: input.sha256,
  byte_length: input.byte_length,
});
const fault = (kind: EvidenceFault["kind"], reason?: string) => (error: unknown) =>
  error instanceof EvidenceFault && error.kind === kind && (!reason || error.reason === reason);

function fixture(file = ":memory:") {
  const f = csvFixture(file);
  const batch = f.submit().receipt;
  const target: EvidenceTarget = { kind: "record", id: batch.rows[0]!.record_id };
  const repository = new SqliteEvidenceRepository(f.db, APP_VERSION, csvClock);
  const put = (input = source(), actor: EvidenceContext = f.context, selected = target) =>
    repository.commit(actor, selected, input, object(input));
  const addRecord = (id: string, owner = "student") => {
    f.store.add({
      ...validateCsvRows([syntheticCells], "Synthetic A").commands[0]!,
      id,
      created_by_user_id: owner,
      created_by: owner,
      created_at: csvClock.now(),
      initial_quality_status: "normal",
      synced_from_offline: false,
      metadata: {},
    });
    return { kind: "record", id } as EvidenceTarget;
  };
  return { ...f, batch, target, repository, put, addRecord };
}

function snapshot(f: ReturnType<typeof fixture>) {
  return [
    f.db.prepare("SELECT * FROM evidence_files ORDER BY id").all(),
    f.db.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
  ];
}

test("evidence stores actual identity/time and replays without replacing metadata, object or audit", () => {
  const f = fixture();
  try {
    const first = f.put();
    assert.equal(first.replayed, false);
    assert.equal(first.evidence.uploader_user_id, "teacher");
    assert.equal(first.evidence.received_at, csvClock.now());
    assert.deepEqual(first.evidence.target, f.target);
    const before = snapshot(f);
    const second = f.put(source({ original_name: "renamed.png" }));
    assert.equal(second.replayed, true);
    assert.deepEqual(second.evidence, first.evidence);
    assert.deepEqual(snapshot(f), before);
    assert.throws(
      () => f.put(source({ sha256: "b".repeat(64) })),
      fault("conflict", "IDEMPOTENCY_CONFLICT"),
    );
    assert.throws(
      () => f.repository.commit(f.context, f.target, source(), { ...object(), byte_length: 11 }),
      fault("input", "EVIDENCE_OBJECT_MISMATCH"),
    );
    const peer = f.put(source(), csvContext("peer"));
    assert.notEqual(peer.evidence.id, first.evidence.id);
    assert.equal(f.db.prepare("SELECT count(*) n FROM evidence_files").get()!.n, 2);
  } finally {
    f.db.close();
  }
});

test("evidence current account, class and ownership checks do not trust caller session claims", () => {
  const f = fixture();
  try {
    const own = f.addRecord("student-own");
    const student = csvContext("student"); // This helper deliberately carries a stale teacher role.
    assert.equal(f.repository.authorize(student).role, "student");
    const ownReceipt = f.put(source(), student, own).evidence;
    assert.equal(f.repository.get(student, ownReceipt.id).id, ownReceipt.id);
    assert.throws(() => f.put(source(), student), fault("forbidden"));
    assert.throws(() => f.put(source(), csvContext("other")), fault("forbidden"));
    for (const id of ["disabled", "demo"])
      assert.throws(() => f.put(source(), csvContext(id)), fault("forbidden"));
    assert.throws(
      () => f.repository.authorize({ ...f.context, actor: null }),
      fault("unauthenticated"),
    );
    const first = f.put(source(), f.context, own).evidence;
    for (const mutation of [
      "UPDATE users SET status='disabled' WHERE id='teacher'",
      "UPDATE users SET role='student' WHERE id='teacher'",
      "UPDATE users SET class_name='Synthetic B' WHERE id='teacher'",
      "UPDATE sessions SET revoked_at='2026-09-05T00:00:00.000Z' WHERE user_id='teacher'",
      "UPDATE sessions SET expires_at=1 WHERE user_id='teacher'",
    ]) {
      f.db.exec(mutation);
      assert.throws(() => f.repository.get(f.context, first.id), EvidenceFault);
      assert.throws(() => f.put(source(), f.context, own), EvidenceFault);
      assert.throws(() => f.repository.archive(f.context, first.id), EvidenceFault);
      f.db.exec(
        "UPDATE users SET status='active',role='teacher',class_name='Synthetic A' WHERE id='teacher'",
      );
      f.db
        .prepare("UPDATE sessions SET revoked_at=NULL,expires_at=? WHERE user_id='teacher'")
        .run(Date.parse("2035-01-01T00:00:00Z"));
    }
  } finally {
    f.db.close();
  }
});

test("evidence target changes are rechecked at commit and reads follow the current record class", () => {
  const f = fixture();
  try {
    f.repository.authorizeTarget(f.context, f.target, true);
    f.store.update(f.target.id, { class_name: "Synthetic B", group_name: "Synthetic G" });
    assert.throws(() => f.put(), fault("forbidden"));
    const first = f.put(source(), csvContext("admin")).evidence;
    assert.throws(() => f.repository.get(f.context, first.id), fault("forbidden"));
    assert.equal(f.repository.get(csvContext("other"), first.id).id, first.id);
    f.store.delete(f.target.id);
    assert.throws(
      () => f.put(source({ client_upload_id: "synthetic-new-upload" }), csvContext("admin")),
      fault("conflict", "EVIDENCE_TARGET_ARCHIVED"),
    );
    assert.equal(f.put(source(), csvContext("admin")).replayed, true);
    assert.equal(f.repository.get(csvContext("admin"), first.id).id, first.id);
  } finally {
    f.db.close();
  }
});

test("archive is one-way and students cannot read or replay archived evidence", () => {
  const f = fixture();
  try {
    const own = f.addRecord("student-archive");
    const student = csvContext("student");
    const first = f.put(source(), student, own).evidence;
    assert.throws(() => f.repository.archive(student, first.id), fault("forbidden"));
    const archived = f.repository.archive(f.context, first.id);
    assert.equal(archived.archived_by_user_id, "teacher");
    assert.equal(archived.archived_at, csvClock.now());
    assert.equal(f.repository.list(student, own).length, 0);
    assert.throws(
      () => f.repository.get(student, first.id),
      fault("forbidden", "EVIDENCE_ARCHIVED"),
    );
    assert.throws(
      () => f.repository.findReplay(student, own, source()),
      fault("forbidden", "EVIDENCE_ARCHIVED"),
    );
    assert.throws(() => f.put(source(), student, own), fault("forbidden", "EVIDENCE_ARCHIVED"));
    assert.equal(f.repository.list(f.context, own).length, 1);
    const before = snapshot(f);
    assert.deepEqual(f.repository.archive(f.context, first.id), archived);
    assert.deepEqual(snapshot(f), before);
    const teacherUpload = f.put(
      source({ client_upload_id: "teacher-archive-token" }),
      f.context,
      own,
    ).evidence;
    f.repository.archive(f.context, teacherUpload.id);
    const replay = f.put(source({ client_upload_id: "teacher-archive-token" }), f.context, own);
    assert.equal(replay.replayed, true);
    assert.notEqual(replay.evidence.archived_at, null);
    f.store.delete(own.id);
    assert.throws(() => f.repository.list(student, own), fault("forbidden"));
    assert.equal(f.repository.list(f.context, own).length, 2);
  } finally {
    f.db.close();
  }
});

test("CSV evidence binds exact receipt bytes and retains receipt owner and moved-record rules", () => {
  const f = fixture();
  try {
    const target: EvidenceTarget = { kind: "csv_batch", id: f.batch.batch_id };
    const input = source({
      sha256: f.batch.raw_sha256,
      byte_length: f.batch.byte_length,
      media_type: "text/csv",
      extension: "csv",
      original_name: "synthetic.csv",
    });
    assert.throws(
      () => f.repository.findReplay(f.context, target, { ...input, sha256: "b".repeat(64) }),
      fault("conflict", "EVIDENCE_CSV_SOURCE_MISMATCH"),
    );
    assert.throws(
      () => f.put({ ...input, sha256: "b".repeat(64) }, f.context, target),
      fault("conflict", "EVIDENCE_CSV_SOURCE_MISMATCH"),
    );
    assert.throws(
      () => f.put({ ...input, byte_length: input.byte_length + 1 }, f.context, target),
      fault("conflict"),
    );
    assert.throws(() => f.put(input, csvContext("student"), target), fault("forbidden"));
    assert.throws(() => f.put(input, csvContext("peer"), target), fault("forbidden"));
    const first = f.put(input, f.context, target).evidence;
    assert.equal(first.received_at, csvClock.now());
    f.store.update(f.target.id, { class_name: "Synthetic B", group_name: "Synthetic G" });
    assert.throws(
      () => f.repository.get(f.context, first.id),
      fault("conflict", "BATCH_SCOPE_CHANGED"),
    );
    assert.throws(() => f.put(input, f.context, target), fault("conflict", "BATCH_SCOPE_CHANGED"));
    assert.equal(f.repository.get(csvContext("admin"), first.id).id, first.id);
    assert.equal(f.put(input, csvContext("admin"), target).replayed, false);
  } finally {
    f.db.close();
  }
});

test("raw SQL cannot change/delete/replace evidence or forge target/type/archive relationships", () => {
  const f = fixture();
  try {
    const first = f.put().evidence;
    const row = f.db.prepare("SELECT * FROM evidence_files WHERE id=?").get(first.id)!;
    const before = snapshot(f);
    for (const [column, value] of [
      ["sha256", "b".repeat(64)],
      ["record_id", "missing"],
      ["object_key", randomUUID()],
      ["received_at", "2026-09-04T00:00:00.000Z"],
      ["uploader_user_id", "admin"],
      ["original_name", "changed.png"],
      ["byte_length", 11],
    ])
      assert.throws(
        () =>
          f.db.prepare(`UPDATE evidence_files SET ${column}=? WHERE id=?`).run(value!, first.id),
        /immutable/,
      );
    assert.throws(
      () => f.db.prepare("DELETE FROM evidence_files WHERE id=?").run(first.id),
      /forbidden/,
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE evidence_files SET archived_at=? WHERE id=?")
          .run(csvClock.now(), first.id),
      /archive transition/,
    );
    assert.throws(
      () =>
        f.db
          .prepare(
            "UPDATE evidence_files SET archived_at=?,archived_by_user_id='student' WHERE id=?",
          )
          .run(csvClock.now(), first.id),
      /archive authority/,
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE evidence_files SET archived_at=?,archived_by_user_id='other' WHERE id=?")
          .run(csvClock.now(), first.id),
      /archive authority/,
    );
    const insert = (patch: Record<string, unknown>, mode = "INSERT") => {
      const candidate = {
        ...row,
        id: `synthetic-${randomUUID()}`,
        object_key: randomUUID(),
        client_upload_id: `synthetic-${randomUUID()}`,
        ...patch,
      };
      f.db
        .prepare(
          `${mode} INTO evidence_files(${Object.keys(candidate).join(",")}) VALUES(${Object.keys(
            candidate,
          )
            .map(() => "?")
            .join(",")})`,
        )
        .run(...(Object.values(candidate) as Array<string | number | null>));
    };
    for (const patch of [
      { id: first.id },
      { object_key: first.object_key },
      { client_upload_id: first.client_upload_id },
    ])
      assert.throws(() => insert(patch, "INSERT OR REPLACE"), /replacement/);
    for (const patch of [
      { record_id: null },
      { csv_batch_id: f.batch.batch_id },
      { record_id: "missing" },
      { object_key: "../escape" },
      { sha256: "bad" },
      { byte_length: 0 },
      { byte_length: EVIDENCE_LIMITS.bytes + 1 },
      { byte_length: 1.5 },
      { media_type: "text/html" },
      { extension: "pdf" },
      { original_name: "../escape.png" },
      { original_name: "control\u0085.png" },
      { received_at: "2026-02-30T00:00:00.000Z" },
      { uploader_label_snapshot: "forged" },
      { uploader_user_id: "student", uploader_label_snapshot: "student" },
      { archived_at: csvClock.now(), archived_by_user_id: "teacher" },
      {
        record_id: null,
        csv_batch_id: f.batch.batch_id,
        media_type: "text/csv",
        extension: "csv",
        original_name: "synthetic.csv",
      },
    ])
      assert.throws(() => insert(patch), JSON.stringify(patch));
    assert.deepEqual(snapshot(f), before);
    f.repository.archive(f.context, first.id);
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE evidence_files SET archived_at=NULL,archived_by_user_id=NULL WHERE id=?")
          .run(first.id),
      /archive transition/,
    );
    assert.throws(
      () =>
        f.db.prepare("UPDATE evidence_files SET archived_at=archived_at WHERE id=?").run(first.id),
      /archive transition/,
    );
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.db.close();
  }
});

test("raw SQL rejects filename format controls and UTF-16 overflow while legal 255-unit names stay readable", () => {
  const f = fixture();
  try {
    const first = f.put().evidence;
    const row = f.db.prepare("SELECT * FROM evidence_files WHERE id=?").get(first.id)!;
    const insertName = (name: string) => {
      const candidate = {
        ...row,
        id: `filename-${randomUUID()}`,
        object_key: randomUUID(),
        client_upload_id: `filename-${randomUUID()}`,
        original_name: name,
      };
      f.db
        .prepare(
          `INSERT INTO evidence_files(${Object.keys(candidate).join(",")}) VALUES(${Object.keys(
            candidate,
          )
            .map(() => "?")
            .join(",")})`,
        )
        .run(...(Object.values(candidate) as Array<string | number | null>));
      return String(candidate.id);
    };
    const before = f.repository.list(f.context, f.target);
    const overflow = "😀".repeat(126) + ".png";
    assert.equal(overflow.length, 256);
    for (const name of ["photo\u202e.png", "photo\u200b.png", "photo\u{e0001}.png", overflow]) {
      assert.throws(() => insertName(name));
      assert.deepEqual(f.repository.list(f.context, f.target), before);
    }
    for (const name of ["x".repeat(251) + ".png", "😀".repeat(125) + "x.png"]) {
      assert.equal(name.length, 255);
      const id = insertName(name);
      assert.equal(f.repository.get(f.context, id).original_name, name);
    }
    assert.equal(f.repository.list(f.context, f.target).length, 3);
  } finally {
    f.db.close();
  }
});

test("raw SQL rejects noncanonical evidence times before an irreversible archive and preserves readable history", () => {
  const f = fixture();
  try {
    const first = f.put().evidence;
    const row = f.db.prepare("SELECT * FROM evidence_files WHERE id=?").get(first.id)!;
    const before = f.repository.list(f.context, f.target);
    for (const timestamp of [
      "2026-09-05T24:01:00.000Z",
      "2026-09-05T23:60:00.000Z",
      "2026-09-05T23:59:60.000Z",
      "2026-13-05T12:00:00.000Z",
      "2027-02-29T12:00:00.000Z",
      "0000-09-05T12:00:00.000Z",
    ]) {
      const candidate = {
        ...row,
        id: `timestamp-${randomUUID()}`,
        object_key: randomUUID(),
        client_upload_id: `timestamp-${randomUUID()}`,
        received_at: timestamp,
      };
      assert.throws(() =>
        f.db
          .prepare(
            `INSERT INTO evidence_files(${Object.keys(candidate).join(",")}) VALUES(${Object.keys(
              candidate,
            )
              .map(() => "?")
              .join(",")})`,
          )
          .run(...(Object.values(candidate) as Array<string | number | null>)),
      );
      assert.throws(() =>
        f.db
          .prepare(
            "UPDATE evidence_files SET archived_at=?,archived_by_user_id='teacher' WHERE id=?",
          )
          .run(timestamp, first.id),
      );
      assert.deepEqual(f.repository.list(f.context, f.target), before);
    }
    const valid = "2028-02-29T23:59:59.999Z";
    f.db
      .prepare("UPDATE evidence_files SET archived_at=?,archived_by_user_id='teacher' WHERE id=?")
      .run(valid, first.id);
    assert.equal(f.repository.get(f.context, first.id).archived_at, valid);
    assert.equal(f.repository.list(f.context, f.target).length, 1);
  } finally {
    f.db.close();
  }
});

for (const stage of ["audit", "commit", "archive-audit"] as const)
  test(`evidence ${stage} failure rolls back metadata and audit and permits safe retry`, () => {
    const f = fixture();
    try {
      const first = stage === "archive-audit" ? f.put().evidence : null;
      if (stage === "commit") f.addRecord("unmapped-evidence-fault", "teacher");
      const before = snapshot(f);
      const trigger =
        stage === "commit"
          ? "AFTER INSERT ON audit_logs WHEN NEW.action='evidence.upload' BEGIN INSERT INTO csv_import_rows VALUES('missing-batch',1,'unmapped-evidence-fault'); END"
          : `BEFORE INSERT ON audit_logs WHEN NEW.action='evidence.${stage === "archive-audit" ? "archive" : "upload"}' BEGIN SELECT RAISE(ABORT,'synthetic evidence audit failure'); END`;
      f.db.exec(`CREATE TEMP TRIGGER synthetic_evidence_fault ${trigger}`);
      assert.throws(() => (first ? f.repository.archive(f.context, first.id) : f.put()));
      assert.equal(f.db.isTransaction, false);
      assert.deepEqual(snapshot(f), before);
      f.db.exec("DROP TRIGGER synthetic_evidence_fault");
      if (first) assert.notEqual(f.repository.archive(f.context, first.id).archived_at, null);
      else assert.equal(f.put().replayed, false);
    } finally {
      f.db.close();
    }
  });

test("evidence per-target retention includes archived rows and replay bypasses no quota writes", () => {
  const f = fixture();
  try {
    let firstId = "";
    for (let i = 0; i < EVIDENCE_LIMITS.perTarget; i++) {
      const result = f.put(
        source({ client_upload_id: `synthetic-quota-${String(i).padStart(4, "0")}` }),
      );
      if (i === 0) {
        firstId = result.evidence.id;
        f.repository.archive(f.context, firstId);
      }
    }
    const before = snapshot(f);
    assert.throws(() => f.put(), fault("limit", "EVIDENCE_QUOTA"));
    assert.throws(
      () => f.repository.findReplay(f.context, f.target, source()),
      fault("limit", "EVIDENCE_QUOTA"),
    );
    assert.equal(f.put(source({ client_upload_id: "synthetic-quota-0000" })).evidence.id, firstId);
    assert.deepEqual(snapshot(f), before);
    const row = f.db
      .prepare("SELECT * FROM evidence_files WHERE archived_at IS NULL LIMIT 1")
      .get()!;
    const candidate = {
      ...row,
      id: `quota-${randomUUID()}`,
      object_key: randomUUID(),
      client_upload_id: `quota-${randomUUID()}`,
    };
    assert.throws(
      () =>
        f.db
          .prepare(
            `INSERT INTO evidence_files(${Object.keys(candidate).join(",")}) VALUES(${Object.keys(
              candidate,
            )
              .map(() => "?")
              .join(",")})`,
          )
          .run(...(Object.values(candidate) as Array<string | number | null>)),
      /target quota/,
    );
  } finally {
    f.db.close();
  }
});

test("the 1 GiB referenced-byte quota is exact and database-enforced across targets", () => {
  const f = fixture();
  try {
    const targets = Array.from({ length: 11 }, (_, i) =>
      f.addRecord(`quota-record-${i}`, "teacher"),
    );
    let bytes = 0;
    let lastId = "";
    for (let i = 0; i < 205; i++) {
      const length = Math.min(EVIDENCE_LIMITS.bytes, EVIDENCE_LIMITS.totalBytes - bytes);
      const result = f.put(
        source({
          client_upload_id: `synthetic-global-${String(i).padStart(4, "0")}`,
          byte_length: length,
        }),
        f.context,
        targets[Math.floor(i / 20)],
      );
      bytes += length;
      lastId = result.evidence.id;
    }
    assert.equal(bytes, EVIDENCE_LIMITS.totalBytes);
    f.repository.archive(f.context, lastId);
    assert.throws(
      () => f.put(source({ byte_length: 1 }), f.context, targets[10]),
      fault("limit", "EVIDENCE_QUOTA"),
    );
    const row = f.db.prepare("SELECT * FROM evidence_files WHERE id=?").get(lastId)!;
    const candidate = {
      ...row,
      id: `bytes-${randomUUID()}`,
      object_key: randomUUID(),
      client_upload_id: `bytes-${randomUUID()}`,
      byte_length: 1,
      archived_at: null,
      archived_by_user_id: null,
    };
    assert.throws(
      () =>
        f.db
          .prepare(
            `INSERT INTO evidence_files(${Object.keys(candidate).join(",")}) VALUES(${Object.keys(
              candidate,
            )
              .map(() => "?")
              .join(",")})`,
          )
          .run(...Object.values(candidate)),
      /byte quota/,
    );
    assert.equal(
      f.db.prepare("SELECT sum(byte_length) n FROM evidence_files").get()!.n,
      EVIDENCE_LIMITS.totalBytes,
    );
  } finally {
    f.db.close();
  }
});

async function race(file: string, recordId: string, tokens: string[]) {
  const workers = tokens.map((token) =>
    fork(new URL("./fixtures/evidence-race-worker.js", import.meta.url), [file, recordId, token], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve, reject) => {
            worker.once("error", reject);
            worker.once("exit", (code) => {
              if (code !== 0) reject(new Error(`worker exited ${code}`));
            });
            worker.once("message", (message) => {
              assert.equal(message, "ready");
              resolve();
            });
          }),
      ),
    );
    const results = workers.map(
      (worker) =>
        new Promise<{ id?: string; replayed?: boolean; failure?: string }>((resolve, reject) => {
          worker.once("error", reject);
          worker.once("message", (message) =>
            resolve(message as { id?: string; replayed?: boolean; failure?: string }),
          );
        }),
    );
    workers.forEach((worker) => worker.send("start"));
    return await Promise.all(results);
  } finally {
    workers.forEach((worker) => worker.kill());
  }
}

test(
  "independent WAL processes produce one receipt for one token, survive reopen and enforce the last quota slot",
  { timeout: 20000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "echo-evidence-race-"));
    const file = path.join(dir, "citrus.db");
    const f = fixture(file);
    try {
      f.db.exec("PRAGMA journal_mode=WAL");
      const results = await race(file, f.target.id, [
        "synthetic-upload-race",
        "synthetic-upload-race",
      ]);
      assert.equal(results[0]!.id, results[1]!.id);
      assert.equal(results.filter((result) => result.replayed === false).length, 1);
      assert.equal(results.filter((result) => result.replayed === true).length, 1);
      assert.equal(
        f.db.prepare("SELECT count(*) n FROM audit_logs WHERE action='evidence.upload'").get()!.n,
        1,
      );
      const reopened = openCsvDb(file);
      try {
        const replay = new SqliteEvidenceRepository(reopened, APP_VERSION, csvClock).commit(
          f.context,
          f.target,
          source({ client_upload_id: "synthetic-upload-race" }),
          object(),
        );
        assert.equal(replay.replayed, true);
        assert.equal(replay.evidence.id, results[0]!.id);
      } finally {
        reopened.close();
      }
      for (let i = 0; i < 18; i++)
        f.put(source({ client_upload_id: `synthetic-slot-${String(i).padStart(4, "0")}` }));
      const last = await race(file, f.target.id, [
        "synthetic-last-slot-a",
        "synthetic-last-slot-b",
      ]);
      assert.equal(last.filter((result) => result.replayed === false).length, 1);
      assert.equal(last.filter((result) => result.failure).length, 1);
      assert.equal(f.db.prepare("SELECT count(*) n FROM evidence_files").get()!.n, 20);
    } finally {
      f.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("JSON mode and a busy SQLite writer fail without adding metadata", () => {
  assert.throws(
    () => new SqliteEvidenceRepository(null, APP_VERSION, csvClock).authorize(csvContext()),
    fault("unavailable"),
  );
  const dir = mkdtempSync(path.join(tmpdir(), "echo-evidence-lock-"));
  const file = path.join(dir, "citrus.db");
  const f = fixture(file);
  const lock = openCsvDb(file);
  try {
    f.db.exec("PRAGMA busy_timeout=1");
    const before = snapshot(f);
    lock.exec("BEGIN IMMEDIATE");
    assert.throws(() => f.put(), fault("unavailable"));
    assert.equal(f.db.isTransaction, false);
    assert.deepEqual(snapshot(f), before);
    lock.exec("ROLLBACK");
    assert.equal(f.put().replayed, false);
  } finally {
    if (lock.isTransaction) lock.exec("ROLLBACK");
    lock.close();
    f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Migration 015 upgrades schema14 without changing historical rows and rolls back failed installation", () => {
  const db = openCsvDb();
  try {
    seedCsv(db, 14);
    const before = db.prepare("SELECT * FROM users ORDER BY id").all();
    const schemaBefore = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
    const migration = MIGRATIONS[14]!;
    const failing = {
      ...migration,
      up(database: typeof db, context: Parameters<typeof migration.up>[1]) {
        migration.up(database, context);
        throw new Error("synthetic evidence migration failure");
      },
    };
    assert.throws(
      () => runMigrations(db, [...MIGRATIONS.slice(0, 14), failing], csvClock.now),
      /synthetic evidence migration failure/,
    );
    assert.equal(db.isTransaction, false);
    assert.deepEqual(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), schemaBefore);
    assert.equal(runMigrations(db, MIGRATIONS.slice(0, 15), csvClock.now).currentVersion, 15);
    const schemaAfter = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
    assert.equal(runMigrations(db, MIGRATIONS.slice(0, 15), csvClock.now).currentVersion, 15);
    assert.deepEqual(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), schemaAfter);
    assert.deepEqual(db.prepare("SELECT * FROM users ORDER BY id").all(), before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    for (const [filename, digest] of [
      [
        "013-csv-interchange.ts",
        "46ae44cf7c2872d9d5141b0e9f5d7d1e0846697fc2ec3c2f3b7aee7ba0736f07",
      ],
      [
        "014-finite-derived-yield.ts",
        "58f8f5c8d94fe8bff2b60d57d1cf743c606dd9f42daa29b5555e3a062bd7fae8",
      ],
    ])
      assert.equal(
        createHash("sha256")
          .update(readFileSync(`src/infrastructure/database/migrations/${filename}`))
          .digest("hex"),
        digest,
      );
  } finally {
    db.close();
  }
});
