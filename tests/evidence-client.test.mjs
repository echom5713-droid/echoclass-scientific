import { operationLanguageScript } from "../dist/src/shared/operation-copy.js";
import assert from "node:assert/strict";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = operationLanguageScript()+"\n"+readFileSync(new URL("../public/evidence-client.js", import.meta.url), "utf8");
const pngA = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const pngB = Uint8Array.from([...pngA, 2]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

class Element {
  constructor(tag = "div") { this.tag = tag; }
  files = [];
  handlers = {};
  children = [];
  disabled = false;
  textContent = "";
  clicks = 0;
  set innerHTML(_) { throw new Error("Metadata must never be rendered as HTML"); }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  click() { this.clicks++; return this.handlers.click?.(); }
  remove() { this.removed = true; }
}

function storage() {
  return {
    values: new Map(), failRead: false, failWrite: false,
    getItem(key) {
      if (this.failRead) throw new Error("synthetic read failure");
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.failWrite) throw new Error("synthetic write failure");
      this.values.set(key, value);
    },
  };
}

function backend() { return { rows: [], posts: [], archives: [], downloads: [] }; }
function descendants(element) { return [element, ...element.children.flatMap(descendants)]; }

async function browser({ saved = storage(), server = backend(), userId = "teacher", role = "teacher", query = "?record_id=record-A", language = "zh-CN" } = {}) {
  const names = ["file", "prepare", "upload", "new", "reload", "selection", "status", "list", "target", "policy"];
  const elements = Object.fromEntries(names.map((name) => [name, new Element()]));
  const body = new Element("body"), created = [], revoked = [], requests = [];
  const state = { userId, role, loseResponse: false, confirm: true, prompts: 0, forbidden: false, corrupt: false };
  const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const denied = () => response({ ok: false, error: { message: "当前权限不可访问附件" } }, 403);
  const visible = (item) => state.role !== "student" || !item.archived_at;
  const fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (state.forbidden) return denied();
    const url = new URL(path, "https://synthetic.example");
    const targetMatch = url.pathname.match(/^\/api\/(records|csv\/imports)\/([^/]+)\/evidence$/);
    if (targetMatch) {
      const target = { kind: targetMatch[1] === "records" ? "record" : "csv_batch", id: decodeURIComponent(targetMatch[2]) };
      if (options.method !== "POST")
        return response({ ok: true, user_id: state.userId, role: state.role,
          evidence: server.rows.filter((item) => item.target.kind === target.kind && item.target.id === target.id && visible(item)) });
      assert.deepEqual([...url.searchParams.keys()], ["filename"]);
      assert.ok(["image/png", "image/jpeg", "application/pdf", "text/csv"].includes(options.headers["Content-Type"]));
      const bytes = new Uint8Array(options.body), token = options.headers["X-EchoClass-Client-Upload-Id"];
      let item = server.rows.find((row) => row.client_upload_id === token && row.uploader_user_id === state.userId && row.target.id === target.id && row.target.kind === target.kind);
      const replayed = Boolean(item);
      if (item && !visible(item)) return denied();
      if (!item) {
        item = { id: `evidence-${server.rows.length + 1}`, target,
          schema_version: "echoclass.evidence.v1", client_upload_id: token,
          sha256: sha(bytes), byte_length: bytes.length, media_type: options.headers["Content-Type"],
          original_name: url.searchParams.get("filename"), uploader_user_id: state.userId,
          uploader_label_snapshot: "Teacher <svg onload=alert(1)>", received_at: `2026-09-05T12:00:0${server.rows.length}.000Z`,
          archived_at: null, archived_by_user_id: null,
        };
        server.rows.push(item);
      }
      server.posts.push({ token, item: { ...item }, replayed, bytes, options, target });
      if (state.loseResponse) { state.loseResponse = false; throw new Error("lost response after commit"); }
      return response({ ok: true, evidence: item, replayed });
    }
    const itemMatch = url.pathname.match(/^\/api\/evidence\/([^/]+)\/(download|archive)$/);
    assert.ok(itemMatch, `Unexpected request ${path}`);
    const item = server.rows.find((row) => row.id === decodeURIComponent(itemMatch[1]));
    if (!item || !visible(item)) return denied();
    if (itemMatch[2] === "archive") {
      assert.equal(options.method, "POST");
      assert.ok(state.role === "teacher" || state.role === "admin");
      item.archived_at = "2026-09-05T13:00:00.000Z";
      item.archived_by_user_id = state.userId;
      server.archives.push(item.id);
      return response({ ok: true, evidence: item });
    }
    server.downloads.push(item.id);
    if (state.corrupt) return response({ ok: false, error: { message: "附件校验失败" } }, 503);
    return { ok: true, blob: async () => ({ type: item.media_type }) };
  };
  class BrowserURL extends URL {
    static createObjectURL(blob) { assert.ok(blob); return "blob:synthetic-download"; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  vm.runInNewContext(script, {
    document: {documentElement:{lang:language}, body, getElementById: (id) => elements[id.slice(9)], createElement: (tag) => { const item = new Element(tag); created.push(item); return item; } },
    location: { search: query }, URLSearchParams, URL: BrowserURL,
    sessionStorage: saved, crypto: { randomUUID, subtle: webcrypto.subtle },
    confirm: () => { state.prompts++; return state.confirm; },
    setTimeout: (callback) => callback(), fetch,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const click = async (name) => {
    assert.equal(elements[name].disabled, false, `${name} must be available`);
    await elements[name].click();
  };
  return { state, elements, saved, server, requests, body, created, revoked, click,
    async prepare(bytes = pngA, name = "sample.png", type = "image/png", size = bytes.length) {
      elements.file.files = [{ name, type, size, arrayBuffer: async () => Uint8Array.from(bytes).buffer }];
      elements.file.handlers.change();
      await click("prepare");
    },
    action(label) { return descendants(elements.list).find((item) => item.tag === "button" && item.textContent === label); },
  };
}

test("Evidence UI recovers an uncertain upload after other files and reload without changing receipt", async () => {
  const ui = await browser();
  await ui.prepare();
  ui.state.loseResponse = true;
  await ui.click("upload");
  assert.match(ui.elements.status.textContent, /响应未确认/);
  await ui.prepare(pngB);
  await ui.prepare(pngA, "renamed.png");
  await ui.click("upload");
  const [first, retry] = ui.server.posts;
  assert.equal(first.token, retry.token);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.item, first.item);
  assert.equal(ui.state.prompts, 0);
  const reloaded = await browser({ saved: ui.saved, server: ui.server });
  await reloaded.prepare();
  await reloaded.click("upload");
  assert.equal(ui.server.posts[2].token, first.token);
  assert.equal(ui.server.rows.length, 1);
  assert.match(reloaded.elements.status.textContent, /原接收时间保持不变/);
});

test("Evidence UI scopes tokens to users and targets and stops when the current account changes", async () => {
  const ui = await browser();
  await ui.prepare();
  await ui.click("upload");
  const peer = await browser({ saved: ui.saved, server: ui.server, userId: "peer" });
  await peer.prepare();
  await peer.click("upload");
  const otherTarget = await browser({ saved: ui.saved, server: ui.server, query: "?record_id=record-B" });
  await otherTarget.prepare();
  await otherTarget.click("upload");
  assert.equal(new Set(ui.server.posts.map((item) => item.token)).size, 3);
  const original = new Map(ui.saved.values);
  ui.state.userId = "peer";
  await ui.click("upload");
  assert.equal(ui.server.posts.length, 3);
  assert.match(ui.elements.status.textContent, /账号已变更/);
  assert.equal(ui.elements.upload.disabled, true);
  assert.deepEqual(ui.saved.values, original);
});

test("Evidence UI replaces only the selected file token after explicit confirmation", async () => {
  const ui = await browser();
  await ui.prepare(pngA); await ui.click("upload");
  await ui.prepare(pngB); await ui.click("upload");
  const [a, b] = ui.server.posts;
  await ui.prepare(pngA);
  ui.state.confirm = false;
  await ui.click("new"); await ui.click("upload");
  assert.equal(ui.server.posts[2].token, a.token);
  ui.state.confirm = true;
  await ui.click("new"); await ui.click("upload");
  assert.notEqual(ui.server.posts[3].token, a.token);
  await ui.prepare(pngB); await ui.click("upload");
  assert.equal(ui.server.posts[4].token, b.token);
  assert.equal(ui.server.rows.length, 3);
  assert.equal(ui.state.prompts, 2);
});

test("Evidence UI fails closed on unavailable storage without deleting earlier attempts", async () => {
  const ui = await browser();
  await ui.prepare(); await ui.click("upload");
  const before = new Map(ui.saved.values);
  ui.saved.failWrite = true;
  await ui.click("new");
  assert.deepEqual(ui.saved.values, before);
  await ui.prepare(pngB);
  assert.equal(ui.elements.upload.disabled, true);
  assert.match(ui.elements.status.textContent, /存储可能已满/);
  assert.deepEqual(ui.saved.values, before);
  ui.saved.failWrite = false;
  ui.saved.failRead = true;
  await ui.prepare();
  assert.equal(ui.elements.upload.disabled, true);
  ui.saved.failRead = false;
  await ui.prepare(); await ui.click("upload");
  assert.equal(ui.server.posts[1].token, ui.server.posts[0].token);
  assert.equal(ui.server.rows.length, 1);
});

test("Evidence UI requires confirmed replacement for malformed or mismatched cache entries", async () => {
  const ui = await browser();
  await ui.prepare(); await ui.click("upload");
  const [key, raw] = [...ui.saved.values][0], original = JSON.parse(raw);
  for (const value of ["{invalid", "null", JSON.stringify({ ...original, token: "short" }), JSON.stringify({ ...original, target_id: "record-B" })]) {
    ui.saved.values.set(key, value);
    await ui.prepare();
    assert.equal(ui.elements.upload.disabled, true);
    assert.equal(ui.elements.new.disabled, false);
    assert.match(ui.elements.status.textContent, /损坏或不匹配/);
    assert.equal(ui.saved.values.get(key), value);
  }
  await ui.click("new"); await ui.click("upload");
  assert.equal(ui.state.prompts, 1);
  assert.notEqual(ui.server.posts[1].token, original.token);
});

test("Evidence UI sends bounded raw bytes with canonical MIME and a single encoded filename", async () => {
  const ui = await browser();
  for (const [name, type, size] of [["empty.png", "image/png", 0], ["large.png", "image/png", 5242881], ["x.pdf", "image/png", pngA.length], ["x.csv", "text/csv", pngA.length]]) {
    await ui.prepare(pngA, name, type, size);
    assert.equal(ui.elements.upload.disabled, true);
  }
  await ui.prepare(pngA, "a & b # ?.png");
  await ui.click("upload");
  const upload = ui.server.posts[0];
  assert.deepEqual(upload.bytes, pngA);
  assert.equal(upload.options.headers["Content-Type"], "image/png");
  assert.equal(upload.item.original_name, "a & b # ?.png");
  const csv = await browser({ query: "?batch_id=batch-A" });
  await csv.prepare(pngA);
  assert.equal(csv.elements.upload.disabled, true);
  const bytes = new TextEncoder().encode("a,b\r\n1,2\r\n");
  await csv.prepare(bytes, "source.csv", "text/csv", 1048577);
  assert.equal(csv.elements.upload.disabled, true);
  await csv.prepare(bytes, "source.csv", "text/csv");
  await csv.click("upload");
  assert.equal(csv.server.posts[0].options.headers["Content-Type"], "text/csv");
  assert.deepEqual(csv.server.posts[0].bytes, bytes);
  assert.equal(csv.server.posts[0].target.kind, "csv_batch");
});

test("CSV source preparation ignores browser MIME hints and requires a .csv extension", async () => {
  const bytes = new TextEncoder().encode("a,b\r\n1,2\r\n");
  for (const hint of ["text/csv", "", "application/vnd.ms-excel", "application/octet-stream"]) {
    const ui = await browser({ query: "?batch_id=batch-A" });
    await ui.prepare(bytes, "source.CSV", hint);
    assert.equal(ui.elements.upload.disabled, false, hint);
    await ui.click("upload");
    assert.equal(ui.server.posts[0].options.headers["Content-Type"], "text/csv");
    assert.deepEqual(ui.server.posts[0].bytes, bytes);
    for (const name of ["source.txt", "source.csv.txt", "csv"]) {
      await ui.prepare(bytes, name, hint);
      assert.equal(ui.elements.upload.disabled, true, `${name}: ${hint}`);
    }
  }
});

test("Evidence metadata stays literal and PDF is only an opaque download", async () => {
  const ui = await browser();
  await ui.prepare(new TextEncoder().encode("%PDF-1.7\n"), '<img src=x onerror="alert(1)">.pdf', "application/pdf");
  await ui.click("upload");
  const text = descendants(ui.elements.list).map((item) => item.textContent).join("\n");
  assert.match(text, /<img src=x/);
  assert.match(text, /Teacher <svg/);
  assert.match(text, /2026-09-05T12:00:00.000Z/);
  assert.ok(!ui.created.some((item) => ["img", "iframe", "object", "embed"].includes(item.tag)));
  await ui.action("下载").click();
  const anchor = ui.body.children.at(-1);
  assert.equal(anchor.tag, "a");
  assert.equal(anchor.download, "echoclass-evidence.pdf");
  assert.equal(anchor.clicks, 1);
  assert.equal(anchor.removed, true);
  assert.deepEqual(ui.revoked, ["blob:synthetic-download"]);
  ui.state.corrupt = true;
  await ui.action("下载").click();
  assert.equal(ui.body.children.length, 1);
  assert.match(ui.elements.status.textContent, /校验失败/);
});

test("Evidence UI checks current permissions for archive and hides student archive actions", async () => {
  const ui = await browser();
  await ui.prepare(); await ui.click("upload");
  const staleArchive = ui.action("归档");
  ui.state.role = "student";
  await staleArchive.click();
  assert.equal(ui.server.archives.length, 0);
  assert.equal(ui.action("归档"), undefined);
  ui.state.role = "teacher";
  await ui.click("reload");
  ui.state.confirm = false;
  await ui.action("归档").click();
  assert.equal(ui.server.archives.length, 0);
  ui.state.confirm = true;
  await ui.action("归档").click();
  assert.equal(ui.server.archives.length, 1);
  assert.equal(ui.action("归档"), undefined);
  assert.match(descendants(ui.elements.list).map((item) => item.textContent).join(" "), /已归档/);
  await ui.click("upload");
  assert.equal(ui.server.rows.length, 1);
  assert.ok(ui.server.posts.at(-1).item.archived_at);
  const student = await browser({ server: ui.server, role: "student", userId: "student" });
  assert.equal(student.action("下载"), undefined);
  assert.equal(student.action("归档"), undefined);
});

test("Evidence UI clears stale metadata and blocks mutations when access is revoked", async () => {
  const ui = await browser();
  await ui.prepare(); await ui.click("upload");
  const staleDownload = ui.action("下载");
  ui.state.forbidden = true;
  await staleDownload.click();
  assert.equal(ui.server.downloads.length, 0);
  assert.equal(ui.action("下载"), undefined);
  await ui.click("upload");
  assert.equal(ui.server.posts.length, 1);
  assert.match(ui.elements.status.textContent, /当前权限/);
});

test("Evidence UI rejects missing, repeated, mixed, and unknown target query parameters", async () => {
  for (const query of ["", "?record_id=", "?record_id=A&record_id=B", "?record_id=A&batch_id=B", "?record_id=A&extra=x"]) {
    const ui = await browser({ query });
    assert.match(ui.elements.status.textContent, /目标无效/);
    assert.equal(ui.elements.prepare.disabled, true);
    assert.equal(ui.requests.length, 0);
  }
});

test("Record evidence entries show only a student's own active records and never appear in demo", async () => {
  const viewSource = readFileSync(new URL("../src/views/pages.js", import.meta.url), "utf8")
    .replace(/from "(\.\.\/[^\"]+)"/g, (_, path) => `from "${new URL(path, new URL("../dist/src/views/", import.meta.url)).href}"`);
  const views = await import(`data:text/javascript,${encodeURIComponent(viewSource)}`);
  const records = [
    { ...views.DEMO_RECORDS[0], id: 'own?&"record', created_by_user_id: "student-A", status: "active" },
    { ...views.DEMO_RECORDS[0], id: "peer-record", created_by_user_id: "student-B", status: "active" },
    { ...views.DEMO_RECORDS[0], id: "deleted-record", created_by_user_id: "student-A", status: "deleted" },
  ];
  const student = { id: "student-A", role: "student", name: "A" };
  const ownLink = `/evidence?record_id=${encodeURIComponent(records[0].id)}`;
  const page = views.studentPage(records, student);
  assert.ok(page.includes(ownLink));
  assert.ok(!page.includes("/evidence?record_id=peer-record"));
  assert.ok(!page.includes("/evidence?record_id=deleted-record"));
  assert.ok(!views.studentPage(records, student, true).includes("/evidence?"));
  assert.ok(views.teacherPage(records, { id: "teacher", role: "teacher" }).includes(ownLink));
  assert.ok(!views.teacherPage(records, { id: "teacher", role: "teacher" }, true).includes("/evidence?"));
  assert.ok(views.adminPage(records, [], { id: "admin", role: "admin" }).includes(ownLink));
});

test("CSV receipt evidence entry follows the received batch and disappears when the account changes", async () => {
  const source = operationLanguageScript()+"\n"+readFileSync(new URL("../public/csv-client.js", import.meta.url), "utf8");
  const names = ["class", "file", "preview", "commit", "new", "export", "reload-receipt", "status", "errors", "table", "receipt", "evidence-link"];
  const elements = Object.fromEntries(names.map((name) => [name, new Element()]));
  elements["evidence-link"].hidden = true;
  let userId = "teacher";
  vm.runInNewContext(source, {
    document: {documentElement:{lang:"zh-CN"}, getElementById: (id) => elements[id.slice(4)], createElement: () => new Element() },
    sessionStorage: storage(), crypto: { randomUUID }, confirm: () => true,
    fetch: async (path) => ({ ok: true, json: async () => {
      if (path === "/api/csv/classes") return { ok: true, user_id: userId, classes: [{ id: "class-A", name: "A" }] };
      if (path.startsWith("/api/csv/preview")) return { ok: true, valid: true, class_id: "class-A", class_name: "A", raw_sha256: sha(pngA), row_count: 1, preview: [], headers: [] };
      return { ok: true, receipt: { batch_id: 'batch?&"A' }, replayed: false, added_this_request: 1 };
    } }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements["evidence-link"].hidden, true);
  elements.class.value = "class-A";
  elements.file.files = [{ size: pngA.length, arrayBuffer: async () => pngA.buffer }];
  elements.file.handlers.change();
  await elements.preview.click();
  await elements.commit.click();
  assert.equal(elements["evidence-link"].hidden, false);
  assert.equal(elements["evidence-link"].href, `/evidence?batch_id=${encodeURIComponent('batch?&"A')}`);
  elements.file.handlers.change();
  assert.equal(elements["evidence-link"].hidden, false);
  userId = "peer";
  await elements.preview.click();
  assert.equal(elements["evidence-link"].hidden, true);
});

test("English attachment feedback and a Chinese locale link retain the upload receipt",async()=>{
 const en=await browser({language:"en",query:"?record_id=record-A&lang=en"});await en.prepare(pngA,"原始记录.png");
 assert.match(en.elements.status.textContent,/ready to upload/);
 en.state.loseResponse=true;await en.click("upload");assert.match(en.elements.status.textContent,/response is uncertain/);
 const first=en.server.posts[0];
 const zh=await browser({saved:en.saved,server:en.server,query:"?record_id=record-A&lang=zh"});await zh.prepare(pngA,"原始记录.png");await zh.click("upload");
 assert.equal(zh.server.posts[1].token,first.token);assert.equal(zh.server.rows.length,1);
 assert.deepEqual(zh.server.posts[1].item,first.item);
});
