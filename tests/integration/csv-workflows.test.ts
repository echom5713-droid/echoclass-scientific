import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  csvFixture,
  csvBytes,
  csvSnapshot,
  syntheticCells,
  codec,
  freshCsvCookie,
} from "../csv-test-helpers.js";
import {
  CSV_SCHEMA,
  CSV_LIMITS,
  type CsvReceipt,
  type CsvIssue,
} from "../../src/domain/csv/contract.js";

interface WireResult {
  ok: boolean;
  request_id: string;
  error: { fields: CsvIssue[] };
  user_id: string;
  classes: { id: string; name: string }[];
  valid: boolean;
  row_count: number;
  raw_sha256: string;
  added_this_request: number;
  replayed: boolean;
  receipt: CsvReceipt;
  errors: CsvIssue[];
}
async function json(response: Response): Promise<WireResult> {
  return (await response.json()) as WireResult;
}
let child: ChildProcess, directory: string, db: DatabaseSync;
const port = 46000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const cookie = (id = "teacher") => `citrus_sid=synthetic-session-${id}`;
const postHeaders = (id = "teacher") => ({
  Cookie: cookie(id),
  "Content-Type": "text/csv; charset=utf-8",
  "X-EchoClass-Csv-Schema": CSV_SCHEMA,
});
async function post(route: string, bytes = csvBytes(), headers: Record<string, string> = {}) {
  return fetch(`${base}/api/csv/${route}`, {
    method: "POST",
    headers: { ...postHeaders(), ...headers },
    body: Buffer.from(bytes),
  });
}
async function checkError(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  const result = await json(response);
  assert.equal(result.ok, false);
  assert.ok(result.request_id);
  assert.ok(Array.isArray(result.error.fields));
  if (code) assert.ok(result.error.fields.some((field: { code: string }) => field.code === code));
  return result;
}
async function start(mode = "sqlite") {
  child = spawn(process.execPath, ["dist/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ECHOCLASS_DATA_DIR: directory,
      ECHOCLASS_SEED_DEMO: "0",
      STORAGE_MODE: mode,
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
      /* Wait for fixture server. */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`CSV fixture server failed: ${errors}`);
}
async function stop() {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await exited;
  }
}
beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "csv-http-"));
  const f = csvFixture(path.join(directory, "citrus.db"));
  db = f.db;
  await start();
});
afterEach(async () => {
  await stop();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test("HTTP template → preview → atomic import → replay → receipt → export and safe UI contract", async () => {
  const options = await fetch(`${base}/api/csv/classes`, { headers: { Cookie: cookie() } });
  const classes = await json(options);
  assert.equal(classes.user_id, "teacher");
  assert.deepEqual(classes.classes, [{ id: "class-A", name: "Synthetic A" }]);
  const template = await fetch(`${base}/api/csv/template`, { headers: { Cookie: cookie() } });
  assert.equal(template.status, 200);
  assert.equal(template.headers.get("x-echoclass-csv-schema"), CSV_SCHEMA);
  assert.ok((await template.text()).includes("student_name"));
  const before = csvSnapshot(db),
    files = readdirSync(directory).sort();
  const bytes = csvBytes([syntheticCells, syntheticCells]);
  const previewResponse = await post("preview?class_id=class-A", bytes);
  assert.equal(previewResponse.status, 200);
  const preview = await json(previewResponse);
  assert.equal(preview.valid, true);
  assert.equal(preview.row_count, 2);
  assert.deepEqual(csvSnapshot(db), before);
  assert.deepEqual(readdirSync(directory).sort(), files);
  const headers = {
    "X-EchoClass-Client-Import-Id": "synthetic-http-token",
    "X-EchoClass-Expected-SHA256": preview.raw_sha256,
  };
  const create = await post("import?class_id=class-A", bytes, headers);
  assert.equal(create.status, 201);
  const first = await json(create);
  assert.equal(first.added_this_request, 2);
  const retry = await post("import?class_id=class-A", bytes, headers);
  assert.equal(retry.status, 200);
  const replay = await json(retry);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, first.receipt);
  const receipt = await fetch(`${base}/api/csv/imports/${first.receipt.batch_id}`, {
    headers: { Cookie: cookie() },
  });
  assert.deepEqual((await json(receipt)).receipt, first.receipt);
  const download = await fetch(`${base}/api/csv/export?class_id=class-A`, {
    headers: { Cookie: cookie() },
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    download.headers.get("content-disposition"),
    'attachment; filename="echoclass-experiments-spreadsheet-v1.csv"',
  );
  assert.equal(download.headers.get("access-control-allow-origin"), null);
  assert.ok((await download.text()).includes(first.receipt.batch_id));
  const page = await fetch(`${base}/csv`, { headers: { Cookie: cookie() } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /whole file succeeds or fails together/);
  const script = readFileSync("public/csv-client.js", "utf8");
  assert.doesNotMatch(script, /innerHTML|File\.text|file\.text\(|localStorage/);
  assert.match(script, /file\.arrayBuffer\(\)/);
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(script, /prior\.user_id === userId/);
});

test("HTTP authorization rejects anonymous, student, disabled/demo and wrong class before parsing", async () => {
  await checkError(await fetch(`${base}/api/csv/classes`), 401);
  for (const id of ["student", "disabled", "demo"])
    await checkError(
      await post("preview?class_id=class-A", Buffer.from([0xff]), { Cookie: cookie(id) }),
      id === "student" ? 403 : 401,
    );
  await checkError(
    await post("preview?class_id=class-A", csvBytes(), { Cookie: cookie("other") }),
    403,
  );
  await checkError(
    await post("preview?class_id=missing", csvBytes(), { Cookie: cookie("admin") }),
    404,
  );
  await checkError(
    await post("preview?class_id=class-A", csvBytes(), { Origin: "https://attacker.invalid" }),
    403,
  );
  assert.equal(csvSnapshot(db).csv_import_batches!.length, 0);
});

test("HTTP strict envelope refuses unknown query, duplicate class, media type, compressed body and schema", async () => {
  for (const query of [
    "class_id=class-A&class_id=class-A",
    "class_id=class-A&role=admin",
    "class_id=class-A&mode=raw",
    "class_name=Synthetic+A",
    "class_id=class-A&filename=evil.csv",
  ])
    await checkError(await post(`preview?${query}`), 400);
  for (const headers of [
    { "Content-Type": "application/json" },
    { "Content-Type": "text/csv; charset=utf-16" },
    { "Content-Encoding": "gzip" },
    { "X-EchoClass-Csv-Schema": "unknown" },
  ])
    await checkError(await post("preview?class_id=class-A", csvBytes(), headers), 400);
  assert.equal(csvSnapshot(db).experiment_records!.length, 0);
});

function rawPost(headers: Record<string, string | string[]>, chunks: Uint8Array[]) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      `${base}/api/csv/preview?class_id=class-A`,
      { method: "POST", headers: { ...postHeaders(), ...headers } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += String(chunk);
        });
        res.once("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.once("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}
test("raw HTTP repeated headers and chunked byte boundaries cannot bypass the envelope", async () => {
  for (const headers of [
    { "X-EchoClass-Csv-Schema": [CSV_SCHEMA, CSV_SCHEMA] },
    { "Content-Type": ["text/csv", "text/csv"] },
    { "X-EchoClass-Client-Import-Id": ["synthetic-token-0001", "synthetic-token-0001"] },
  ]) {
    const result = await rawPost(headers, [csvBytes()]);
    assert.equal(result.status, 400);
    assert.equal((JSON.parse(result.body) as WireResult).ok, false);
  }
  const before = csvSnapshot(db);
  const bytes = csvBytes();
  const good = await rawPost({}, [bytes.slice(0, 50), bytes.slice(50)]);
  assert.equal(good.status, 200);
  const oversized = await rawPost({}, [Buffer.alloc(CSV_LIMITS.bytes, 65), Buffer.from("x")]);
  assert.equal(oversized.status, 413);
  assert.ok((JSON.parse(oversized.body) as WireResult).request_id);
  assert.deepEqual(csvSnapshot(db), before);
});

test("HTTP invalid preview cannot commit and detects changed bytes and stale permissions", async () => {
  const bad = [...syntheticCells];
  bad[4] = "";
  const bytes = csvBytes([syntheticCells, bad]);
  const p = await post("preview?class_id=class-A", bytes);
  assert.equal(p.status, 200);
  const result = await json(p);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0]!.row_number, 2);
  const headers = {
    "X-EchoClass-Client-Import-Id": "synthetic-errors-token",
    "X-EchoClass-Expected-SHA256": result.raw_sha256,
  };
  await checkError(await post("import?class_id=class-A", bytes, headers), 422);
  await checkError(
    await post("import?class_id=class-A", csvBytes(), headers),
    409,
    "PREVIEW_BYTES_CHANGED",
  );
  const good = await post("preview?class_id=class-A");
  assert.equal(good.status, 200);
  db.exec("UPDATE users SET class_name='Synthetic B' WHERE id='teacher'");
  await checkError(
    await post("import?class_id=class-A", csvBytes(), {
      ...headers,
      "X-EchoClass-Expected-SHA256": codec.sha256(csvBytes()),
    }),
    401,
  );
  const fresh = freshCsvCookie(db, "teacher", "synthetic-teacher-scope-session");
  await checkError(
    await post("import?class_id=class-A", csvBytes(), {
      ...headers,
      Cookie: fresh,
      "X-EchoClass-Expected-SHA256": codec.sha256(csvBytes()),
    }),
    403,
  );
  assert.equal((await post("preview?class_id=class-B", csvBytes(), { Cookie: fresh })).status, 200);
  db.exec("UPDATE sessions SET revoked_at='2026-09-05T00:00:00.000Z' WHERE user_id='teacher'");
  await checkError(await post("preview?class_id=class-B", csvBytes(), { Cookie: fresh }), 401);
  assert.equal(csvSnapshot(db).experiment_records!.length, 0);
});

test("HTTP merged rate limiter rejects the eleventh request without writing", async () => {
  const before = csvSnapshot(db);
  for (let i = 0; i < 10; i++) assert.equal((await post("preview?class_id=class-A")).status, 200);
  await checkError(await post("preview?class_id=class-A"), 429);
  assert.deepEqual(csvSnapshot(db), before);
});

test("JSON compatibility mode cannot silently perform real CSV work", async () => {
  await stop();
  await start("json");
  const response = await fetch(`${base}/api/csv/classes`, { headers: { Cookie: cookie() } });
  await checkError(response, 503);
  assert.equal(csvSnapshot(db).csv_import_batches!.length, 0);
});
