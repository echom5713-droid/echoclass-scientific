import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { EvidenceService, type EvidenceUploadInput } from "../src/application/evidence-service.js";
import { AppError } from "../src/application/errors.js";
import {
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA,
  EvidenceFault,
  type EvidenceContext,
  type EvidenceFileStore,
  type EvidenceObject,
  type EvidenceRepository,
  type EvidenceSource,
  type EvidenceTarget,
  type StoredEvidence,
} from "../src/domain/evidence/contract.js";
import {
  validateEvidenceBytes,
  validateEvidenceSource,
} from "../src/domain/evidence/validation.js";
import { evidenceHeader, readEvidenceBytes } from "../src/http/evidence-body.js";
import { evidenceRoutes } from "../src/http/routes/evidence-routes.js";
import { SlidingWindowRateLimiter } from "../src/shared/rate-limiter.js";

const hashes = { sha256: (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex") };
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const target: EvidenceTarget = { kind: "record", id: "record-1" };
const input: EvidenceUploadInput = {
  original_name: "实验.png",
  media_type: "image/png",
  client_upload_id: "synthetic-upload-001",
};
const context: EvidenceContext = {
  actor: { id: "teacher", role: "teacher", username: "teacher", name: "Teacher", class_name: "A" },
  ip: "127.0.0.1",
  ua: "synthetic evidence fixture",
};
const appStatus = (status: number) => (error: unknown) =>
  error instanceof AppError && error.status === status;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const state = {
    enabled: true,
    readable: true,
    writable: true,
    events: [] as string[],
    objects: new Map<string, Uint8Array>(),
    records: [] as StoredEvidence[],
    putWait: Promise.resolve(),
    readWait: Promise.resolve(),
    putFails: false,
    commitFails: false,
    loseCommitResponse: false,
    corruptRead: false,
  };
  const authorize = () => {
    if (!state.enabled) throw new EvidenceFault("unauthenticated", "EXPIRED", "请重新登录");
    return { id: "teacher", role: "teacher" as const };
  };
  const authorizeTarget = (_ctx: EvidenceContext, _target: EvidenceTarget, write: boolean) => {
    authorize();
    state.events.push(write ? "authorize-write" : "authorize-read");
    if (!state.readable || (write && !state.writable))
      throw new EvidenceFault("forbidden", "TARGET_FORBIDDEN", "无权访问此记录");
  };
  const repo: EvidenceRepository = {
    authorize,
    authorizeTarget,
    list(ctx, item) {
      authorizeTarget(ctx, item, false);
      return state.records;
    },
    findReplay(ctx, item, source) {
      authorizeTarget(ctx, item, false);
      state.events.push("replay");
      const prior = state.records.find((row) => row.client_upload_id === source.client_upload_id);
      if (prior && prior.sha256 !== source.sha256)
        throw new EvidenceFault("conflict", "TOKEN_CONFLICT", "上传标识已用于另一文件");
      return prior ?? null;
    },
    commit(ctx, item, source, object) {
      authorizeTarget(ctx, item, true);
      state.events.push("commit");
      if (state.commitFails) throw new EvidenceFault("unavailable", "COMMIT_FAILED", "保存失败");
      const record: StoredEvidence = {
        ...source,
        ...object,
        id: `evidence-${state.records.length}`,
        target: item,
        uploader_user_id: "teacher",
        uploader_label_snapshot: "Teacher",
        received_at: "2026-09-05T12:00:00.000Z",
        app_version: "test",
        archived_at: null,
        archived_by_user_id: null,
      };
      state.records.push(record);
      if (state.loseCommitResponse)
        throw new EvidenceFault("unavailable", "UNCERTAIN", "提交结果未知");
      return { evidence: record, replayed: false };
    },
    get(ctx, id) {
      authorizeTarget(ctx, target, false);
      state.events.push("get");
      const record = state.records.find((row) => row.id === id);
      if (!record) throw new EvidenceFault("missing", "MISSING", "证据不存在");
      return { ...record };
    },
    archive(ctx, id) {
      const record = this.get(ctx, id);
      return { ...record, archived_at: "2026-09-05T13:00:00.000Z", archived_by_user_id: "teacher" };
    },
  };
  const files: EvidenceFileStore = {
    async put(bytes) {
      state.events.push("put");
      await state.putWait;
      if (state.putFails)
        throw new EvidenceFault("unavailable", "PUBLICATION_FAILED", "文件保存失败");
      const object: EvidenceObject = {
        object_key: `private-object-${state.objects.size}`,
        sha256: hashes.sha256(bytes),
        byte_length: bytes.byteLength,
      };
      state.objects.set(object.object_key, Uint8Array.from(bytes));
      return object;
    },
    async read(object) {
      state.events.push("read");
      await state.readWait;
      return state.corruptRead ? Uint8Array.of(1) : state.objects.get(object.object_key)!;
    },
  };
  return {
    state,
    repo,
    files,
    service: new EvidenceService(repo, files, hashes, new SlidingWindowRateLimiter(60_000, 10)),
  };
}

test("evidence validation screens supported signatures, canonical extensions and target types", () => {
  for (const [type, name, bytes, extension] of [
    ["image/png", "原始.PNG", png, "png"],
    ["image/jpeg", "原始.JPEG", Uint8Array.from([255, 216, 255]), "jpg"],
    ["application/pdf", "原始.pdf", new TextEncoder().encode("%PDF-1.7"), "pdf"],
  ] as const)
    assert.deepEqual(validateEvidenceBytes(target, type, name, bytes), {
      media_type: type,
      extension,
    });
  assert.deepEqual(
    validateEvidenceBytes(
      { kind: "csv_batch", id: "batch-1" },
      "text/csv",
      "原始.csv",
      new TextEncoder().encode("\uFEFFa,b\r\n1,2\r\n"),
    ),
    { media_type: "text/csv", extension: "csv" },
  );
  for (const name of [
    "",
    " ",
    "../a.png",
    "a\\b.png",
    "a\n.png",
    "a\u202e.png",
    "a".repeat(256),
    "a.pdf",
    "png",
  ])
    assert.throws(() => validateEvidenceBytes(target, "image/png", name, png), EvidenceFault);
  for (const type of ["image/svg+xml", "Image/PNG", "image/png; charset=utf-8"])
    assert.throws(() => validateEvidenceBytes(target, type, "a.png", png), EvidenceFault);
  assert.throws(() => validateEvidenceBytes(target, "image/jpeg", "a.jpg", png), /签名/);
  assert.throws(
    () => validateEvidenceBytes(target, "text/csv", "a.csv", Uint8Array.of(65)),
    /关联目标/,
  );
  assert.throws(
    () =>
      validateEvidenceBytes(
        { kind: "csv_batch", id: "b" },
        "text/csv",
        "a.csv",
        Uint8Array.from([0xc3, 0x28]),
      ),
    /UTF-8/,
  );
});

test("evidence byte and identity limits reject empty, oversized and malformed sources", () => {
  assert.throws(
    () => validateEvidenceBytes(target, "image/png", "a.png", new Uint8Array()),
    /不能为空/,
  );
  const exact = new Uint8Array(EVIDENCE_LIMITS.bytes);
  exact.set(png);
  assert.doesNotThrow(() => validateEvidenceBytes(target, "image/png", "a.png", exact));
  assert.throws(
    () =>
      validateEvidenceBytes(
        target,
        "image/png",
        "a.png",
        new Uint8Array(EVIDENCE_LIMITS.bytes + 1),
      ),
    /超过/,
  );
  const source: EvidenceSource = {
    ...input,
    schema_version: EVIDENCE_SCHEMA,
    media_type: "image/png",
    extension: "png",
    sha256: hashes.sha256(png),
    byte_length: png.length,
  };
  assert.doesNotThrow(() => validateEvidenceSource(source, target));
  for (const patch of [
    { schema_version: "unknown" },
    { client_upload_id: "short" },
    { sha256: "a" },
    { byte_length: 1.1 },
    { byte_length: Infinity },
    { extension: "jpg" },
  ])
    assert.throws(
      () => validateEvidenceSource({ ...source, ...patch } as EvidenceSource, target),
      EvidenceFault,
    );
});

test("upload publishes before commit, replays without file work and never exposes the object key", async () => {
  const f = fixture();
  const created = await f.service.upload(context, target, input, png);
  assert.equal(created.replayed, false);
  assert.equal(f.state.records.length, 1);
  assert.ok(f.state.events.indexOf("put") < f.state.events.indexOf("commit"));
  f.state.writable = false;
  const replay = await f.service.upload(context, target, input, png);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.evidence, created.evidence);
  assert.equal(f.state.objects.size, 1);
  for (const metadata of [
    created.evidence,
    replay.evidence,
    f.service.get(context, created.evidence.id),
    f.service.list(context, target)[0],
    f.service.archive(context, created.evidence.id),
  ])
    assert.equal(Object.hasOwn(metadata!, "object_key"), false);
});

test("publication and failed or uncertain commits never trigger guessed object deletion", async () => {
  const failedPut = fixture();
  failedPut.state.putFails = true;
  await assert.rejects(failedPut.service.upload(context, target, input, png), appStatus(503));
  assert.equal(failedPut.state.events.includes("commit"), false);
  const failedCommit = fixture();
  failedCommit.state.commitFails = true;
  await assert.rejects(failedCommit.service.upload(context, target, input, png), appStatus(503));
  assert.equal(failedCommit.state.objects.size, 1);
  assert.equal(failedCommit.state.records.length, 0);
  const uncertain = fixture();
  uncertain.state.loseCommitResponse = true;
  await assert.rejects(uncertain.service.upload(context, target, input, png), appStatus(503));
  assert.equal(uncertain.state.objects.size, 1);
  const replay = await uncertain.service.upload(context, target, input, png);
  assert.equal(replay.replayed, true);
  assert.equal(uncertain.state.records.length, 1);
  assert.equal(uncertain.state.objects.size, 1);
});

test("session revocation or class movement while publishing prevents the metadata commit", async () => {
  for (const revoke of ["enabled", "readable"] as const) {
    const f = fixture();
    const wait = deferred();
    f.state.putWait = wait.promise;
    const upload = f.service.upload(context, target, input, png);
    assert.ok(f.state.events.includes("put"));
    f.state[revoke] = false;
    wait.resolve();
    await assert.rejects(upload, appStatus(revoke === "enabled" ? 401 : 403));
    assert.equal(f.state.records.length, 0);
    assert.equal(f.state.objects.size, 1);
  }
});

test("download verifies bytes and reauthorizes after the asynchronous read", async () => {
  for (const failure of ["enabled", "readable", "corruptRead"] as const) {
    const f = fixture();
    const receipt = await f.service.upload(context, target, input, png);
    const wait = deferred();
    f.state.readWait = wait.promise;
    const download = f.service.download(context, receipt.evidence.id);
    f.state[failure] = failure === "corruptRead";
    wait.resolve();
    await assert.rejects(
      download,
      appStatus(failure === "enabled" ? 401 : failure === "readable" ? 403 : 503),
    );
  }
  const f = fixture();
  const receipt = await f.service.upload(context, target, input, png);
  const result = await f.service.download(context, receipt.evidence.id);
  assert.deepEqual(result.bytes, png);
  assert.equal(Object.hasOwn(result.evidence, "object_key"), false);
});

test("HTTP download rechecks permission after promise continuation before emitting bytes", async (t) => {
  const f = fixture();
  const receipt = await f.service.upload(context, target, input, png);
  const original = f.service.download.bind(f.service);
  t.mock.method(f.service, "download", async (...args: Parameters<EvidenceService["download"]>) => {
    const result = await original(...args);
    queueMicrotask(() => {
      f.state.readable = false;
    });
    return result;
  });
  const { req } = incoming();
  req.method = "GET";
  let wrote = false;
  const res = {
    setHeader() {},
    writeHead() {
      wrote = true;
    },
    end() {
      wrote = true;
    },
  } as unknown as ServerResponse;
  await assert.rejects(
    evidenceRoutes(
      {
        req,
        res,
        url: new URL(`http://localhost/api/evidence/${receipt.evidence.id}/download`),
        session: context.actor,
        ip: context.ip,
        ua: context.ua,
        requestId: "synthetic-request",
      },
      f.service,
    ),
    appStatus(403),
  );
  assert.equal(wrote, false);
});

test("four operation reservations include pre-upload waits and release on success or rejection", async () => {
  const f = fixture();
  const wait = deferred();
  let started = 0;
  const pending = Array.from({ length: 4 }, () =>
    f.service.withOperation(context, async () => {
      started++;
      await wait.promise;
    }),
  );
  assert.equal(started, 4);
  await assert.rejects(
    f.service.withOperation(context, async () => {
      started++;
    }),
    appStatus(503),
  );
  assert.equal(started, 4);
  wait.resolve();
  await Promise.all(pending);
  await assert.rejects(
    f.service.withOperation(context, async () => {
      throw new Error("synthetic callback failure");
    }),
    /synthetic/,
  );
  await f.service.withOperation(context, async () => {
    started++;
  });
  assert.equal(started, 5);
});

test("expensive operations enforce the per-actor rate limit before invoking work", async () => {
  const f = fixture();
  let started = 0;
  for (let i = 0; i < 10; i++)
    await f.service.withOperation(context, async () => {
      started++;
    });
  await assert.rejects(
    f.service.withOperation(context, async () => {
      started++;
    }),
    appStatus(429),
  );
  assert.equal(started, 10);
});

function incoming(headers: Record<string, string> = {}) {
  const stream = new PassThrough();
  const req = Object.assign(stream, {
    headers,
    rawHeaders: Object.entries(headers).flat(),
  }) as unknown as IncomingMessage;
  return { stream, req };
}

test("raw evidence body respects lengths, chunk boundaries and repeated headers", async () => {
  const exact = incoming({ "content-length": "3" });
  const read = readEvidenceBytes(exact.req, 3);
  exact.stream.write(Uint8Array.of(1));
  exact.stream.end(Uint8Array.from([2, 3]));
  assert.deepEqual(await read, Buffer.from([1, 2, 3]));
  const overflow = incoming();
  const tooLarge = readEvidenceBytes(overflow.req, 3);
  overflow.stream.write(Uint8Array.from([1, 2, 3]));
  overflow.stream.end(Uint8Array.of(4));
  await assert.rejects(tooLarge, appStatus(413));
  const advertised = incoming({ "content-length": "4" });
  await assert.rejects(readEvidenceBytes(advertised.req, 3), appStatus(413));
  const repeated = incoming({ "content-type": "image/png" });
  repeated.req.rawHeaders.push("Content-Type", "image/png");
  assert.throws(() => evidenceHeader(repeated.req, "content-type"), appStatus(400));
});

test("evidence upload body timeout and abort reject without retaining listeners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timed = incoming();
  const read = readEvidenceBytes(timed.req, 3);
  t.mock.timers.tick(15_000);
  await assert.rejects(read, appStatus(408));
  assert.equal(timed.req.listenerCount("data"), 0);
  const aborted = incoming();
  const incomplete = readEvidenceBytes(aborted.req, 3);
  aborted.req.emit("aborted");
  await assert.rejects(incomplete, appStatus(400));
  assert.equal(aborted.req.listenerCount("data"), 0);
});
