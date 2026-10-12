import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { open as openFileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createBackup, restoreBackup } from "../scripts/evidence-backup.mjs";
import { csvClock, csvFixture } from "../dist/tests/csv-test-helpers.js";

const FORMAT = "echoclass.sqlite-evidence-backup.v1";

for (const version of [15, 16]) test(`schema ${version} backups remain restorable without silently rewriting their database ledger`, async (t) => {
  const f = fixture(t, version);
  const manifest = await createBackup(f.source, f.backup);
  assert.equal(manifest.schema_version, version);
  const restored = path.join(f.root, `restored-schema${version}`);
  await restoreBackup(f.backup, restored);
  const database = new DatabaseSync(path.join(restored, "citrus.db"), { readOnly: true });
  try { assert.equal(database.prepare("SELECT max(version) AS version FROM schema_migrations").get().version, version); }
  finally { database.close(); }
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = (file) => sha256(readFileSync(file));
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const objectPath = (directory, key) => path.join(directory, "evidence", "objects", key);
function tamperFile(file, bytes) {
  // Synthetic corruption by the file owner, including files normally retained read-only.
  chmodSync(file, 0o600);
  writeFileSync(file, bytes);
}

function fixture(t, version) {
  const root = mkdtempSync(path.join(tmpdir(), "echoclass-synthetic-backup-"));
  const source = path.join(root, "source");
  mkdirSync(source);
  const databaseFile = path.join(source, "citrus.db");
  const seeded = csvFixture(databaseFile, true, version);
  seeded.db.close();
  const mode = new DatabaseSync(databaseFile);
  try {
    mode.exec("PRAGMA journal_mode=WAL");
  } finally {
    mode.close();
  }
  const f = csvFixture(databaseFile, false);
  t.after(() => {
    f.db.close();
    rmSync(root, { recursive: true, force: true });
  });
  f.db.exec("PRAGMA wal_autocheckpoint=0");
  f.submit();
  const recordId = f.db.prepare("SELECT id FROM experiment_records LIMIT 1").get().id;
  mkdirSync(path.join(source, "evidence", "objects"), { recursive: true });
  return {
    ...f,
    root,
    source,
    recordId,
    backup: path.join(root, "backup"),
    restored: path.join(root, "restored"),
  };
}

function addObject(f, { bytes = png, archived = false } = {}) {
  const id = randomUUID();
  const object = { object_key: randomUUID(), sha256: sha256(bytes), byte_length: bytes.length };
  writeFileSync(objectPath(f.source, object.object_key), bytes, { flag: "wx" });
  f.db
    .prepare(
      `INSERT INTO evidence_files (
        id, object_key, record_id, csv_batch_id, schema_version, client_upload_id,
        sha256, byte_length, media_type, extension, original_name,
        uploader_user_id, uploader_label_snapshot, received_at, app_version,
        archived_at, archived_by_user_id
      ) VALUES (?, ?, ?, NULL, 'echoclass.evidence.v1', ?, ?, ?, 'image/png', 'png',
        'synthetic-backup-fixture.png', 'teacher', 'teacher', ?, '3.0.0-beta.14', NULL, NULL)`,
    )
    .run(
      id,
      object.object_key,
      f.recordId,
      `synthetic-backup-${randomUUID()}`,
      object.sha256,
      object.byte_length,
      csvClock.now(),
    );
  if (archived)
    f.db
      .prepare("UPDATE evidence_files SET archived_at=?, archived_by_user_id='teacher' WHERE id=?")
      .run("2026-09-05T00:01:00.000Z", id);
  return { id, ...object };
}

function snapshotRows(directory) {
  const db = new DatabaseSync(path.join(directory, "citrus.db"), { readOnly: true });
  try {
    return db
      .prepare("SELECT object_key, sha256, byte_length FROM evidence_files ORDER BY object_key")
      .all()
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

function checkBackup(directory) {
  const manifestFile = path.join(directory, "manifest.json");
  const manifest = json(manifestFile);
  assert.equal(manifest.format, FORMAT);
  assert.equal(manifest.schema_version, 17);
  assert.equal(manifest.scope, "sqlite-and-evidence-only");
  assert.ok(Number.isFinite(Date.parse(manifest.created_at)));
  assert.deepEqual(json(path.join(directory, "COMPLETE")), {
    format: FORMAT,
    manifest_sha256: fileHash(manifestFile),
  });
  assert.equal(manifest.database.file, "citrus.db");
  assert.equal(manifest.database.sha256, fileHash(path.join(directory, "citrus.db")));
  assert.equal(manifest.database.byte_length, statSync(path.join(directory, "citrus.db")).size);
  assert.deepEqual(
    [...manifest.objects].sort((a, b) => a.object_key.localeCompare(b.object_key)),
    snapshotRows(directory),
  );
  for (const object of manifest.objects) {
    const bytes = readFileSync(objectPath(directory, object.object_key));
    assert.equal(bytes.length, object.byte_length);
    assert.equal(sha256(bytes), object.sha256);
  }
  return manifest;
}

function resealManifest(directory, change) {
  const manifestFile = path.join(directory, "manifest.json");
  const manifest = json(manifestFile);
  change(manifest);
  tamperFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  tamperFile(
    path.join(directory, "COMPLETE"),
    JSON.stringify({ format: FORMAT, manifest_sha256: fileHash(manifestFile) }),
  );
}

async function rejectedRestore(f, expected) {
  await assert.rejects(() => restoreBackup(f.backup, f.restored), expected);
  assert.equal(existsSync(path.join(f.restored, "RESTORE_COMPLETE")), false);
  if (existsSync(f.restored))
    assert.equal(existsSync(path.join(f.restored, "RESTORE_IN_PROGRESS")), true);
}

test("backup includes committed WAL data and archived evidence; restore opens a real queryable database", async (t) => {
  const f = fixture(t);
  const active = addObject(f);
  const archived = addObject(f, {
    archived: true,
    bytes: Buffer.concat([png, Buffer.from("synthetic archived")]),
  });
  assert.ok(statSync(path.join(f.source, "citrus.db-wal")).size > 0);
  // A deliberately incomplete test control demonstrates why copying only the live main file loses data.
  const mainOnly = path.join(f.root, "synthetic-main-only.db");
  copyFileSync(path.join(f.source, "citrus.db"), mainOnly);
  const incomplete = new DatabaseSync(mainOnly, { readOnly: true });
  try {
    assert.equal(incomplete.prepare("SELECT COUNT(*) AS n FROM experiment_records").get().n, 0);
    assert.equal(incomplete.prepare("SELECT COUNT(*) AS n FROM evidence_files").get().n, 0);
  } finally {
    incomplete.close();
  }
  const mainBefore = fileHash(path.join(f.source, "citrus.db"));
  const objectBefore = fileHash(objectPath(f.source, active.object_key));
  await createBackup(f.source, f.backup);
  const manifest = checkBackup(f.backup);
  assert.equal(manifest.objects.length, 2);
  assert.equal(fileHash(path.join(f.source, "citrus.db")), mainBefore);
  assert.equal(fileHash(objectPath(f.source, active.object_key)), objectBefore);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM evidence_files").get().n, 2);

  await restoreBackup(f.backup, f.restored);
  assert.equal(existsSync(path.join(f.restored, "RESTORE_IN_PROGRESS")), false);
  assert.deepEqual(json(path.join(f.restored, "RESTORE_COMPLETE")), {
    format: FORMAT,
    manifest_sha256: fileHash(path.join(f.backup, "manifest.json")),
  });
  assert.deepEqual(
    readFileSync(path.join(f.restored, "restore-manifest.json")),
    readFileSync(path.join(f.backup, "manifest.json")),
  );
  assert.deepEqual(snapshotRows(f.restored), snapshotRows(f.backup));
  assert.deepEqual(readFileSync(objectPath(f.restored, active.object_key)), png);
  assert.equal(fileHash(objectPath(f.restored, archived.object_key)), archived.sha256);
  const restored = new DatabaseSync(path.join(f.restored, "citrus.db"), { readOnly: true });
  try {
    assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM experiment_records").get().n, 1);
    assert.equal(
      restored.prepare("SELECT archived_by_user_id FROM evidence_files WHERE id=?").get(archived.id)
        .archived_by_user_id,
      "teacher",
    );
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    restored.close();
  }
});

test("backup membership comes from the VACUUM snapshot when a new upload commits during copying", async (t) => {
  const f = fixture(t);
  const first = addObject(f);
  let added;
  const originalExec = DatabaseSync.prototype.exec;
  const observer = t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    const result = originalExec.call(this, sql);
    // Observe the actual SQLite snapshot boundary; no timing assumptions or production hook.
    if (/\bVACUUM\s+INTO\b/i.test(sql) && !added) added = addObject(f);
    return result;
  });
  try {
    await createBackup(f.source, f.backup);
  } finally {
    observer.mock.restore();
  }
  assert.ok(added, "the real snapshot must have completed before the concurrent source write");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM evidence_files").get().n, 2);
  assert.deepEqual(
    checkBackup(f.backup).objects.map((object) => object.object_key),
    [first.object_key],
  );
  assert.equal(existsSync(objectPath(f.backup, added.object_key)), false);
  const nextBackup = path.join(f.root, "next-backup");
  await createBackup(f.source, nextBackup);
  assert.equal(checkBackup(nextBackup).objects.length, 2);
});

test("backup fails on a missing or corrupt referenced object without a completion marker", async (t) => {
  for (const damage of ["missing", "wrong-bytes", "wrong-size"]) {
    await t.test(damage, async (t) => {
      const f = fixture(t);
      const object = addObject(f, { archived: damage === "missing" });
      const file = objectPath(f.source, object.object_key);
      if (damage === "missing") rmSync(file);
      else
        writeFileSync(
          file,
          damage === "wrong-size" ? Buffer.from("short") : Buffer.alloc(png.length),
        );
      await assert.rejects(() => createBackup(f.source, f.backup));
      assert.equal(existsSync(path.join(f.backup, "COMPLETE")), false);
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM evidence_files").get().n, 1);
    });
  }
});

test("VACUUM failure is reported without falling back to copying the live main database", async (t) => {
  const f = fixture(t);
  addObject(f);
  const originalExec = DatabaseSync.prototype.exec;
  let attempted = false;
  const failure = t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    if (/\bVACUUM\s+INTO\b/i.test(sql)) {
      attempted = true;
      throw new Error("synthetic VACUUM write failure");
    }
    return originalExec.call(this, sql);
  });
  try {
    await assert.rejects(() => createBackup(f.source, f.backup), /synthetic VACUUM write failure/);
  } finally {
    failure.mock.restore();
  }
  assert.equal(attempted, true);
  assert.equal(existsSync(path.join(f.backup, "COMPLETE")), false);
  assert.equal(existsSync(path.join(f.backup, "citrus.db")), false);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM evidence_files").get().n, 1);
});

test("restore rejects incomplete backups and altered manifest, completion, database or objects", async (t) => {
  for (const damage of [
    "incomplete",
    "manifest",
    "completion",
    "database",
    "object",
    "missing-object",
  ]) {
    await t.test(damage, async (t) => {
      const f = fixture(t);
      const object = addObject(f);
      await createBackup(f.source, f.backup);
      if (damage === "incomplete") rmSync(path.join(f.backup, "COMPLETE"));
      if (damage === "manifest") tamperFile(path.join(f.backup, "manifest.json"), "{}");
      if (damage === "completion") tamperFile(path.join(f.backup, "COMPLETE"), "{broken");
      if (damage === "database") {
        const changed = new DatabaseSync(path.join(f.backup, "citrus.db"));
        try {
          changed.exec("CREATE TABLE synthetic_tamper(value TEXT)");
        } finally {
          changed.close();
        }
      }
      if (damage === "object")
        tamperFile(objectPath(f.backup, object.object_key), Buffer.alloc(png.length));
      if (damage === "missing-object") rmSync(objectPath(f.backup, object.object_key));
      await rejectedRestore(f);
    });
  }
});

test("valid completion hashes cannot hide malformed manifests or changed snapshot reference sets", async (t) => {
  const mutations = {
    "object traversal": (manifest) => {
      manifest.objects[0].object_key = "../outside";
    },
    "absolute object path": (manifest) => {
      manifest.objects[0].object_key = "/tmp/synthetic-outside";
    },
    "database traversal": (manifest) => {
      manifest.database.file = "../citrus.db";
    },
    "wrong schema": (manifest) => {
      manifest.schema_version = 14;
    },
    "missing reference": (manifest) => {
      manifest.objects = [];
    },
    "duplicate reference": (manifest) => {
      manifest.objects.push({ ...manifest.objects[0] });
    },
    "extra reference": (manifest) => {
      manifest.objects.push({ ...manifest.objects[0], object_key: randomUUID() });
      manifest.objects.sort((a, b) => a.object_key.localeCompare(b.object_key));
    },
    "invalid digest": (manifest) => {
      manifest.objects[0].sha256 = "x".repeat(64);
    },
    "invalid byte length": (manifest) => {
      manifest.objects[0].byte_length = -1;
    },
  };
  for (const [name, change] of Object.entries(mutations)) {
    await t.test(name, async (t) => {
      const f = fixture(t);
      const original = addObject(f);
      await createBackup(f.source, f.backup);
      resealManifest(f.backup, change);
      if (name === "missing reference") rmSync(objectPath(f.backup, original.object_key));
      if (name === "extra reference") {
        const extra = json(path.join(f.backup, "manifest.json")).objects.find(
          (object) => object.object_key !== original.object_key,
        );
        writeFileSync(objectPath(f.backup, extra.object_key), png, { flag: "wx" });
      }
      await rejectedRestore(
        f,
        ["missing reference", "extra reference"].includes(name)
          ? /Database references do not match manifest/
          : undefined,
      );
    });
  }
});

test("backup and restore refuse symlink files, directories and path traversal", async (t) => {
  for (const attack of [
    "source-object",
    "source-objects-directory",
    "source-root",
    "backup-object",
    "backup-root",
    "destination-parent",
    "traversal",
  ]) {
    await t.test(attack, async (t) => {
      const f = fixture(t);
      const object = addObject(f);
      const outside = path.join(f.root, "synthetic-outside");
      mkdirSync(outside);
      const outsideFile = path.join(outside, "original.png");
      writeFileSync(outsideFile, png);
      if (attack.startsWith("source-")) {
        let source = f.source;
        if (attack === "source-object") {
          rmSync(objectPath(source, object.object_key));
          symlinkSync(outsideFile, objectPath(source, object.object_key));
        } else if (attack === "source-objects-directory") {
          rmSync(path.join(source, "evidence", "objects"), { recursive: true });
          writeFileSync(path.join(outside, object.object_key), png);
          symlinkSync(outside, path.join(source, "evidence", "objects"), "dir");
        } else {
          source = path.join(f.root, "source-link");
          symlinkSync(f.source, source, "dir");
        }
        await assert.rejects(() => createBackup(source, f.backup));
        assert.equal(existsSync(path.join(f.backup, "COMPLETE")), false);
      } else {
        await createBackup(f.source, f.backup);
        if (attack === "backup-object") {
          rmSync(objectPath(f.backup, object.object_key));
          symlinkSync(outsideFile, objectPath(f.backup, object.object_key));
          await rejectedRestore(f);
        } else if (attack === "backup-root") {
          const link = path.join(f.root, "backup-link");
          symlinkSync(f.backup, link, "dir");
          await assert.rejects(() => restoreBackup(link, f.restored));
        } else if (attack === "destination-parent") {
          const link = path.join(f.root, "destination-link");
          symlinkSync(outside, link, "dir");
          await assert.rejects(() => restoreBackup(f.backup, path.join(link, "restored")));
          assert.equal(existsSync(path.join(outside, "restored")), false);
        } else {
          await assert.rejects(() => restoreBackup(f.backup, `${f.root}/source/../restored`));
          await assert.rejects(() => createBackup(f.source, `${f.root}/source/../second-backup`));
        }
      }
      assert.deepEqual(readFileSync(outsideFile), png);
    });
  }
});

test("backup and restore never replace an existing destination, including an empty directory", async (t) => {
  const f = fixture(t);
  addObject(f);
  await createBackup(f.source, f.backup);
  const before = fileHash(path.join(f.backup, "manifest.json"));
  await assert.rejects(() => createBackup(f.source, f.backup));
  assert.equal(fileHash(path.join(f.backup, "manifest.json")), before);
  for (const kind of ["empty-directory", "live-directory", "file"]) {
    const destination = path.join(f.root, `existing-${kind}`);
    if (kind === "file") writeFileSync(destination, "synthetic owner file");
    else {
      mkdirSync(destination);
      if (kind === "live-directory")
        writeFileSync(path.join(destination, "citrus.db"), "synthetic owner database");
    }
    await assert.rejects(() => restoreBackup(f.backup, destination));
    await assert.rejects(() => createBackup(f.source, destination));
    if (kind === "file") assert.equal(readFileSync(destination, "utf8"), "synthetic owner file");
    if (kind === "live-directory")
      assert.equal(
        readFileSync(path.join(destination, "citrus.db"), "utf8"),
        "synthetic owner database",
      );
    if (kind !== "file")
      assert.equal(existsSync(path.join(destination, "RESTORE_IN_PROGRESS")), false);
  }
});

test("a complete backup with no evidence restores, but unreferenced source files are not represented as evidence", async (t) => {
  const f = fixture(t);
  const orphan = randomUUID();
  writeFileSync(objectPath(f.source, orphan), png);
  await createBackup(f.source, f.backup);
  assert.deepEqual(checkBackup(f.backup).objects, []);
  assert.equal(existsSync(objectPath(f.backup, orphan)), false);
  await restoreBackup(f.backup, f.restored);
  assert.deepEqual(snapshotRows(f.restored), []);
});

test("backup rejects an older schema without upgrading or modifying its source database", async (t) => {
  const f = fixture(t, 14);
  const ledgerBefore = f.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  const mainBefore = fileHash(path.join(f.source, "citrus.db"));
  await assert.rejects(() => createBackup(f.source, f.backup));
  assert.equal(existsSync(path.join(f.backup, "COMPLETE")), false);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(),
    ledgerBefore,
  );
  assert.equal(fileHash(path.join(f.source, "citrus.db")), mainBefore);
  assert.equal(
    f.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,
    14,
  );
});

test("a restore copy failure keeps the incomplete marker and cannot be retried over the partial destination", async (t) => {
  const f = fixture(t);
  addObject(f);
  await createBackup(f.source, f.backup);
  const probe = await openFileHandle(path.join(f.backup, "citrus.db"), "r");
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const originalWrite = prototype.writeFile;
  let injected = false;
  const failure = t.mock.method(prototype, "writeFile", function (bytes, ...args) {
    if (Buffer.isBuffer(bytes) && bytes.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))) {
      injected = true;
      throw new Error("synthetic restore database copy failure");
    }
    return originalWrite.call(this, bytes, ...args);
  });
  try {
    await assert.rejects(
      () => restoreBackup(f.backup, f.restored),
      /synthetic restore database copy failure/,
    );
  } finally {
    failure.mock.restore();
  }
  assert.equal(injected, true);
  assert.equal(existsSync(path.join(f.restored, "RESTORE_IN_PROGRESS")), true);
  assert.equal(existsSync(path.join(f.restored, "RESTORE_COMPLETE")), false);
  await assert.rejects(() => restoreBackup(f.backup, f.restored));
  await assert.rejects(
    () => createBackup(f.restored, path.join(f.root, "partial-backup")),
    /incomplete restore/i,
  );
  checkBackup(f.backup);
});

test("an incomplete restore marker prevents backing up an otherwise valid database", async (t) => {
  const f = fixture(t);
  addObject(f);
  writeFileSync(path.join(f.source, "RESTORE_IN_PROGRESS"), "synthetic unfinished restore");
  const before = fileHash(path.join(f.source, "citrus.db"));
  await assert.rejects(() => createBackup(f.source, f.backup), /incomplete restore/i);
  assert.equal(existsSync(f.backup), false);
  assert.equal(fileHash(path.join(f.source, "citrus.db")), before);
  assert.equal(
    readFileSync(path.join(f.source, "RESTORE_IN_PROGRESS"), "utf8"),
    "synthetic unfinished restore",
  );
});

test("backup and restore verify copied objects even when a write reports success after corrupting bytes", async (t) => {
  for (const operation of ["backup", "restore"]) {
    await t.test(operation, async (t) => {
      const f = fixture(t);
      const object = addObject(f);
      if (operation === "restore") await createBackup(f.source, f.backup);
      const probe = await openFileHandle(objectPath(f.source, object.object_key), "r");
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const originalWrite = prototype.writeFile;
      let corruptedWrites = 0;
      const corruption = t.mock.method(prototype, "writeFile", function (bytes, ...args) {
        if (Buffer.isBuffer(bytes) && bytes.equals(png)) {
          corruptedWrites++;
          // Real successful disk write with the expected length and a wrong digest.
          return originalWrite.call(this, Buffer.alloc(bytes.length), ...args);
        }
        return originalWrite.call(this, bytes, ...args);
      });
      try {
        await assert.rejects(
          () =>
            operation === "backup"
              ? createBackup(f.source, f.backup)
              : restoreBackup(f.backup, f.restored),
          /Altered evidence object/,
        );
      } finally {
        corruption.mock.restore();
      }
      assert.equal(corruptedWrites, 1);
      const target = operation === "backup" ? f.backup : f.restored;
      assert.deepEqual(
        readFileSync(objectPath(target, object.object_key)),
        Buffer.alloc(png.length),
      );
      assert.deepEqual(readFileSync(objectPath(f.source, object.object_key)), png);
      if (operation === "backup") assert.equal(existsSync(path.join(target, "COMPLETE")), false);
      else {
        assert.equal(existsSync(path.join(target, "RESTORE_IN_PROGRESS")), true);
        assert.equal(existsSync(path.join(target, "RESTORE_COMPLETE")), false);
        checkBackup(f.backup);
      }
    });
  }
});
