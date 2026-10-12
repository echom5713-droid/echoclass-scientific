import assert from "node:assert/strict";
import crypto, { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { EvidenceFault, EVIDENCE_LIMITS } from "../src/domain/evidence/contract.js";
import { LocalEvidenceFileStore } from "../src/infrastructure/evidence/local-evidence-file-store.js";

const bytes = Buffer.from("synthetic private evidence bytes");
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "echoclass-synthetic-object-"));
  const data = path.join(root, "data");
  const objects = path.join(data, "evidence", "objects");
  const staging = path.join(data, "evidence", "staging");
  await fs.mkdir(data);
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    data,
    objects,
    staging,
    store: new LocalEvidenceFileStore(data),
  };
}

function unavailable(error: unknown): boolean {
  assert.ok(error instanceof EvidenceFault);
  assert.equal(error.kind, "unavailable");
  assert.equal(error.reason, "EVIDENCE_STORAGE_UNAVAILABLE");
  assert.doesNotMatch(error.message, /\/tmp|synthetic-object|ENOENT|ELOOP/);
  return true;
}

test("evidence bytes survive a new store instance; identical content has independent immutable keys", async (t) => {
  const f = await fixture(t);
  const mutable = Buffer.from(bytes);
  const pending = f.store.put(mutable);
  mutable.fill(0);
  const first = await pending;
  const second = await f.store.put(bytes);
  assert.notEqual(first.object_key, second.object_key);
  assert.match(
    first.object_key,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(first.byte_length, bytes.length);
  assert.equal(first.sha256, digest(bytes));
  assert.deepEqual(await new LocalEvidenceFileStore(f.data).read(first), bytes);
  const mutableReference = { ...first };
  const reading = f.store.read(mutableReference);
  mutableReference.object_key = "../../../outside";
  mutableReference.sha256 = "0".repeat(64);
  assert.deepEqual(await reading, bytes);
  assert.deepEqual(await f.store.read(second), bytes);
  assert.equal((await fs.stat(path.join(f.objects, first.object_key))).mode & 0o777, 0o400);
  assert.deepEqual(await fs.readdir(f.staging), []);
  assert.deepEqual(
    (await fs.readdir(f.objects)).sort(),
    [first.object_key, second.object_key].sort(),
  );
});

test("evidence storage validates bounds and controlled references before reading", async (t) => {
  const f = await fixture(t);
  for (const input of [Buffer.alloc(0), Buffer.alloc(EVIDENCE_LIMITS.bytes + 1)]) {
    await assert.rejects(
      f.store.put(input),
      (error: unknown) => error instanceof EvidenceFault && error.kind === "input",
    );
  }
  const object = await f.store.put(bytes);
  for (const changed of [
    { object_key: "../../../outside" },
    { object_key: object.object_key.toUpperCase() },
    { object_key: randomUUID() },
    { sha256: "0".repeat(64) },
    { sha256: "not-a-digest" },
    { byte_length: 0 },
    { byte_length: bytes.length - 1 },
    { byte_length: EVIDENCE_LIMITS.bytes + 1 },
  ])
    await assert.rejects(f.store.read({ ...object, ...changed }), unavailable);
  const maximum = Buffer.alloc(EVIDENCE_LIMITS.bytes, 0x5a);
  assert.deepEqual(await f.store.read(await f.store.put(maximum)), maximum);
});

test("evidence storage rejects same-size corruption, truncation, append and oversized files", async (t) => {
  const f = await fixture(t);
  const object = await f.store.put(bytes);
  const file = path.join(f.objects, object.object_key);
  await fs.chmod(file, 0o600);
  for (const replacement of [
    Buffer.alloc(bytes.length),
    bytes.subarray(1),
    Buffer.concat([bytes, bytes]),
  ]) {
    await fs.writeFile(file, replacement);
    await assert.rejects(f.store.read(object), unavailable);
  }
  await fs.truncate(file, EVIDENCE_LIMITS.bytes + 1);
  await assert.rejects(f.store.read(object), unavailable);
  await fs.unlink(file);
  await assert.rejects(f.store.read(object), unavailable);
});

test("evidence storage rejects symbolic links and nonregular final objects", async (t) => {
  const f = await fixture(t);
  const object = await f.store.put(bytes);
  const file = path.join(f.objects, object.object_key);
  const outside = path.join(f.root, "outside");
  await fs.writeFile(outside, bytes);
  await fs.unlink(file);
  await fs.symlink(outside, file);
  await assert.rejects(f.store.read(object), unavailable);
  await fs.unlink(file);
  await fs.mkdir(file);
  await assert.rejects(f.store.read(object), unavailable);
  assert.deepEqual(await fs.readFile(outside), bytes);
});

test("evidence storage refuses linked object, staging and data directories", async (t) => {
  for (const linked of ["objects", "staging", "data"]) {
    await t.test(linked, async (subtest) => {
      const f = await fixture(subtest);
      const outside = path.join(f.root, "outside");
      await fs.mkdir(outside);
      if (linked === "data") {
        await fs.rmdir(f.data);
        await fs.symlink(outside, f.data);
      } else {
        await fs.mkdir(path.join(f.data, "evidence"));
        await fs.symlink(outside, linked === "objects" ? f.objects : f.staging);
      }
      await assert.rejects(f.store.put(bytes), unavailable);
      assert.deepEqual(await fs.readdir(outside), []);
    });
  }
});

test("exclusive publication refuses an existing UUID and preserves its original bytes", async (t) => {
  const f = await fixture(t);
  const first = await f.store.put(bytes);
  const replacement = Buffer.from("synthetic replacement must never overwrite");
  const replacementUuid = t.mock.method(
    crypto,
    "randomUUID",
    () => first.object_key as ReturnType<typeof randomUUID>,
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.store.put(replacement), unavailable);
  } finally {
    replacementUuid.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(await f.store.read(first), bytes);
  assert.deepEqual(await fs.readdir(f.objects), [first.object_key]);
  assert.deepEqual(await fs.readdir(f.staging), []);
});

test("failure after publication reports unavailable and retains the real orphan object", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.objects, { recursive: true });
  await fs.mkdir(f.staging);
  const probe = await fs.open(path.join(f.root, "probe"), "wx");
  const prototype = Object.getPrototypeOf(probe) as {
    sync: () => Promise<void>;
  };
  const originalSync = prototype.sync;
  const originalLink = fs.link;
  let published = false;
  const linkMock = t.mock.method(fs, "link", async (...args: Parameters<typeof fs.link>) => {
    await originalLink(...args);
    published = true;
  });
  const syncMock = t.mock.method(prototype, "sync", async function (this: typeof probe) {
    if (published) throw new Error("synthetic directory sync failure after actual hard link");
    await originalSync.call(this);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.store.put(bytes), unavailable);
  } finally {
    syncMock.mock.restore();
    linkMock.mock.restore();
    syncBuiltinESMExports();
    await probe.close();
  }
  assert.equal(published, true);
  const keys = await fs.readdir(f.objects);
  assert.equal(keys.length, 1);
  assert.deepEqual(await fs.readFile(path.join(f.objects, keys[0]!)), bytes);
  assert.deepEqual(await fs.readdir(f.staging), []);
});
