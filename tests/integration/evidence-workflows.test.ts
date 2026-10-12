import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { request, type ClientRequest } from "node:http";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { EVIDENCE_LIMITS, type EvidenceMetadata } from "../../src/domain/evidence/contract.js";
import { validateCsvRows } from "../../src/domain/csv/contract.js";
import {
  csvBytes,
  csvClock,
  csvFixture,
  syntheticCells,
  freshCsvCookie,
} from "../csv-test-helpers.js";

interface EvidenceResponse {
  ok: boolean;
  request_id: string;
  evidence: EvidenceMetadata;
  replayed: boolean;
  error: { fields: { code: string }[] };
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const port = 48000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const recordUrl = "/api/records/record-teacher/evidence";
const cookie = (id = "teacher") => `citrus_sid=synthetic-session-${id}`;
const headers = (token = "synthetic-http-upload-001", actor = "teacher") => ({
  Cookie: cookie(actor),
  "Content-Type": "image/png",
  "X-EchoClass-Client-Upload-Id": token,
});
let directory: string, child: ChildProcess, db: DatabaseSync, batchId: string;

async function json(response: Response): Promise<EvidenceResponse> {
  return (await response.json()) as EvidenceResponse;
}

async function error(response: Response, status: number) {
  assert.equal(response.status, status);
  const data = await json(response);
  assert.equal(data.ok, false);
  assert.ok(data.request_id);
  assert.ok(Array.isArray(data.error.fields));
  return data;
}

function upload(
  route = recordUrl,
  bytes: Uint8Array = png,
  options: {
    name?: string;
    type?: string;
    token?: string;
    actor?: string;
    extra?: Record<string, string>;
  } = {},
) {
  return fetch(`${base}${route}?filename=${encodeURIComponent(options.name ?? "实验.png")}`, {
    method: "POST",
    headers: {
      ...headers(options.token, options.actor),
      "Content-Type": options.type ?? "image/png",
      ...options.extra,
    },
    body: Buffer.from(bytes),
  });
}

async function start() {
  child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ECHOCLASS_DATA_DIR: directory,
      ECHOCLASS_SEED_DEMO: "0",
      STORAGE_MODE: "sqlite",
      NODE_ENV: "test",
      DEEPSEEK_API_KEY: "",
      LLM_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* Startup polling. */
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Evidence fixture server failed: ${errors}`);
}

async function stop() {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
}

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "evidence-http-"));
  const f = csvFixture(path.join(directory, "citrus.db"));
  db = f.db;
  for (const actor of ["teacher", "student"])
    f.store.add({
      ...validateCsvRows([syntheticCells], "Synthetic A").commands[0]!,
      id: `record-${actor}`,
      created_by_user_id: actor,
      created_by: actor,
      created_at: csvClock.now(),
      synced_from_offline: false,
      metadata: {},
    });
  batchId = f.submit().receipt.batch_id;
  await start();
});

afterEach(async () => {
  await stop();
  db?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("HTTP attachment upload, restart, verified download, archive and original retry retain custody", async () => {
  const createdResponse = await upload();
  assert.equal(createdResponse.status, 201);
  const created = await json(createdResponse);
  assert.equal(Object.hasOwn(created.evidence, "object_key"), false);
  const id = created.evidence.id;
  const listResponse = await fetch(`${base}${recordUrl}`, { headers: { Cookie: cookie() } });
  const list = (await listResponse.json()) as {
    user_id: string;
    role: string;
    evidence: EvidenceMetadata[];
  };
  assert.equal(list.user_id, "teacher");
  assert.equal(list.role, "teacher");
  assert.deepEqual(list.evidence, [created.evidence]);
  await stop();
  await start();
  const downloaded = await fetch(`${base}/api/evidence/${id}/download`, {
    headers: { Cookie: cookie() },
  });
  assert.equal(downloaded.status, 200);
  assert.equal(
    downloaded.headers.get("content-disposition"),
    'attachment; filename="echoclass-evidence.png"',
  );
  assert.equal(downloaded.headers.get("cache-control"), "no-store");
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.equal(downloaded.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  const archivedResponse = await fetch(`${base}/api/evidence/${id}/archive`, {
    method: "POST",
    headers: { Cookie: cookie() },
  });
  assert.equal(archivedResponse.status, 200);
  const archived = await json(archivedResponse);
  assert.ok(archived.evidence.archived_at);
  assert.equal(Object.hasOwn(archived.evidence, "object_key"), false);
  db.prepare(
    "UPDATE experiment_records SET status='deleted',updated_at=? WHERE id='record-teacher'",
  ).run(new Date().toISOString());
  const replayResponse = await upload(recordUrl, png, { name: "另一个名字.png" });
  assert.equal(replayResponse.status, 200);
  const replay = await json(replayResponse);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.evidence, archived.evidence);
  await error(await upload(recordUrl, png, { token: "synthetic-new-after-archive" }), 409);
  assert.equal(db.prepare("SELECT count(*) n FROM evidence_files").get()!.n, 1);
  assert.equal(readdirSync(path.join(directory, "evidence", "objects")).length, 1);
  const page = await fetch(`${base}/evidence?record_id=record-teacher`, {
    headers: { Cookie: cookie() },
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Experiment attachments/);
});

test("HTTP attachment permissions use current role, owner, class and archived visibility", async () => {
  await error(await fetch(`${base}${recordUrl}`), 401);
  for (const actor of ["disabled", "demo", "other", "student"])
    await error(
      await fetch(`${base}${recordUrl}`, { headers: { Cookie: cookie(actor) } }),
      ["disabled", "demo"].includes(actor) ? 401 : 403,
    );
  const own = "/api/records/record-student/evidence";
  const ownResponse = await upload(own, png, { actor: "student" });
  assert.equal(ownResponse.status, 201);
  const ownFile = (await json(ownResponse)).evidence;
  await error(
    await fetch(`${base}/api/evidence/${ownFile.id}/archive`, {
      method: "POST",
      headers: { Cookie: cookie("student") },
    }),
    403,
  );
  const archived = await fetch(`${base}/api/evidence/${ownFile.id}/archive`, {
    method: "POST",
    headers: { Cookie: cookie() },
  });
  assert.equal(archived.status, 200);
  await error(
    await fetch(`${base}/api/evidence/${ownFile.id}`, { headers: { Cookie: cookie("student") } }),
    403,
  );
  await error(
    await fetch(`${base}/api/evidence/${ownFile.id}/download`, {
      headers: { Cookie: cookie("student") },
    }),
    403,
  );
  await error(await upload(own, png, { actor: "student" }), 403);
  db.prepare("UPDATE users SET class_name='Synthetic B' WHERE id='teacher'").run();
  await error(
    await fetch(`${base}/api/evidence/${ownFile.id}`, { headers: { Cookie: cookie() } }),
    401,
  );
  const fresh = freshCsvCookie(db, "teacher", "synthetic-teacher-new-evidence-scope");
  await error(
    await fetch(`${base}/api/evidence/${ownFile.id}`, { headers: { Cookie: fresh } }),
    403,
  );
  const admin = await fetch(`${base}/api/evidence/${ownFile.id}`, {
    headers: { Cookie: cookie("admin") },
  });
  assert.equal(admin.status, 200);
  await error(
    await upload(own, png, { actor: "admin", extra: { Origin: "https://attacker.invalid" } }),
    403,
  );
});

test("HTTP batch attachment accepts only original CSV bytes and follows receipt ownership", async () => {
  const route = `/api/csv/imports/${batchId}/evidence`;
  const result = await upload(route, csvBytes(), { name: "原始.csv", type: "text/csv" });
  assert.equal(result.status, 201);
  const receipt = await json(result);
  assert.equal(receipt.evidence.target.kind, "csv_batch");
  assert.equal(Object.hasOwn(receipt.evidence, "object_key"), false);
  await error(
    await upload(route, Buffer.from("a,b\n1,2\n"), {
      name: "不同.csv",
      type: "text/csv",
      token: "different-csv-source-token",
    }),
    409,
  );
  for (const actor of ["peer", "student"])
    await error(await fetch(`${base}${route}`, { headers: { Cookie: cookie(actor) } }), 403);
  const admin = await fetch(`${base}/api/evidence/${receipt.evidence.id}/download`, {
    headers: { Cookie: cookie("admin") },
  });
  assert.equal(admin.status, 200);
  assert.deepEqual(Buffer.from(await admin.arrayBuffer()), Buffer.from(csvBytes()));
  const recordId = db
    .prepare("SELECT record_id FROM csv_import_rows WHERE batch_id=? LIMIT 1")
    .get(batchId)!.record_id;
  db.prepare(
    "UPDATE experiment_records SET class_id='class-B',class_name_snapshot='Synthetic B',group_id=NULL,group_name_snapshot='',updated_at=? WHERE id=?",
  ).run(new Date().toISOString(), String(recordId));
  const moved = await error(await fetch(`${base}${route}`, { headers: { Cookie: cookie() } }), 409);
  assert.ok(moved.error.fields.some((field) => field.code === "BATCH_SCOPE_CHANGED"));
});

test("HTTP attachment envelope rejects unknown/repeated query, wrong methods and misleading format", async () => {
  for (const suffix of ["", "?filename=a.png&filename=b.png", "?filename=a.png&record_id=other"])
    await error(
      await fetch(`${base}${recordUrl}${suffix}`, {
        method: "POST",
        headers: headers(),
        body: png,
      }),
      400,
    );
  await error(
    await fetch(`${base}${recordUrl}?filename=a.png`, { headers: { Cookie: cookie() } }),
    400,
  );
  await error(
    await fetch(`${base}${recordUrl}`, { method: "PUT", headers: { Cookie: cookie() } }),
    405,
  );
  for (const options of [
    { type: "image/png; charset=utf-8" },
    { extra: { "Content-Encoding": "identity" } },
    { name: "../a.png" },
    { name: "a.pdf", type: "application/pdf" },
  ])
    await error(await upload(recordUrl, png, options), 400);
  await error(
    await fetch(`${base}/evidence?record_id=record-teacher&batch_id=x`, {
      headers: { Cookie: cookie() },
    }),
    400,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM evidence_files").get()!.n, 0);
});

function rawUpload(extra: Record<string, string | string[]>, chunks: Uint8Array[]) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      `${base}${recordUrl}?filename=a.png`,
      { method: "POST", headers: { ...headers(), ...extra } },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.once("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.once("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test("HTTP raw repeated headers and chunked byte overflow cannot publish files", async () => {
  for (const extra of [
    { "Content-Type": ["image/png", "image/png"] },
    { "X-EchoClass-Client-Upload-Id": ["synthetic-token-001", "synthetic-token-001"] },
  ]) {
    const response = await rawUpload(extra, [png]);
    assert.equal(response.status, 400);
    assert.equal((JSON.parse(response.body) as EvidenceResponse).ok, false);
  }
  const large = await rawUpload({}, [png, new Uint8Array(EVIDENCE_LIMITS.bytes)]);
  assert.equal(large.status, 413);
  assert.equal((JSON.parse(large.body) as EvidenceResponse).ok, false);
  assert.equal(db.prepare("SELECT count(*) n FROM evidence_files").get()!.n, 0);
  const exact = Buffer.alloc(EVIDENCE_LIMITS.bytes);
  png.copy(exact);
  const accepted = await upload(recordUrl, exact);
  assert.equal(accepted.status, 201);
});

test("HTTP missing and corrupted objects return 503 with no attachment response", async () => {
  const first = await json(await upload());
  const key = db
    .prepare("SELECT object_key FROM evidence_files WHERE id=?")
    .get(first.evidence.id)!.object_key;
  const file = path.join(directory, "evidence", "objects", String(key));
  chmodSync(file, 0o600);
  writeFileSync(file, Buffer.from("corrupt"));
  const corrupt = await fetch(`${base}/api/evidence/${first.evidence.id}/download`, {
    headers: { Cookie: cookie() },
  });
  assert.equal(corrupt.headers.get("content-disposition"), null);
  await error(corrupt, 503);
  rmSync(file);
  const missing = await fetch(`${base}/api/evidence/${first.evidence.id}/download`, {
    headers: { Cookie: cookie() },
  });
  assert.equal(missing.headers.get("content-disposition"), null);
  await error(missing, 503);
  const range = await fetch(`${base}/api/evidence/${first.evidence.id}/download`, {
    headers: { Cookie: cookie(), Range: "bytes=0-1" },
  });
  await error(range, 400);
});

test("HTTP slow chunked uploads occupy all four file slots before their bodies finish", async () => {
  const waiting: Array<{ req: ClientRequest; done: Promise<number> }> = [];
  try {
    for (let i = 0; i < 4; i++) {
      let req!: ClientRequest;
      const done = new Promise<number>((resolve, reject) => {
        req = request(
          `${base}${recordUrl}?filename=a.png`,
          { method: "POST", headers: headers(`slow-upload-token-${i}`) },
          (res) => {
            res.resume();
            res.once("end", () => resolve(res.statusCode!));
          },
        );
        req.once("error", reject);
        req.write(png);
      });
      waiting.push({ req, done });
    }
    // A following metadata request confirms the server has serviced the prior connections.
    await new Promise((resolve) => setTimeout(resolve, 40));
    await fetch(`${base}${recordUrl}`, { headers: { Cookie: cookie() } });
    const busy = await upload(recordUrl, png, { token: "fifth-upload-must-wait" });
    await error(busy, 503);
    assert.equal(db.prepare("SELECT count(*) n FROM evidence_files").get()!.n, 0);
    for (const pending of waiting) pending.req.end();
    assert.deepEqual(
      await Promise.all(waiting.map((pending) => pending.done)),
      [201, 201, 201, 201],
    );
    const after = await upload(recordUrl, png, { token: "upload-after-slot-release" });
    assert.equal(after.status, 201);
  } finally {
    for (const pending of waiting) pending.req.destroy();
  }
});
