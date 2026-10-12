import { operationLanguageScript } from "../dist/src/shared/operation-copy.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  codec,
  csvBytes,
  csvContext,
  csvFixture,
  syntheticCells,
} from "../dist/tests/csv-test-helpers.js";

const script = operationLanguageScript()+"\n"+readFileSync(new URL("../public/csv-client.js", import.meta.url), "utf8");
const schema = "echoclass.csv.experiment.v1";
const fileA = csvBytes();
const fileB = csvBytes([
  [...syntheticCells.slice(0, 14), "Another file", ...syntheticCells.slice(15)],
]);

class Element {
  value = "";
  files = [];
  handlers = {};
  children = [];
  disabled = false;
  textContent = "";
  addEventListener(name, handler) {
    this.handlers[name] = handler;
  }
  append(child) {
    this.children.push(child);
    if (child.value && !this.value) this.value = child.value;
  }
  replaceChildren() {
    this.children = [];
  }
}

function storage() {
  const values = new Map();
  return {
    values,
    failRead: false,
    failWrite: false,
    getItem(key) {
      if (this.failRead) throw new Error("synthetic storage read failure");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.failWrite) throw new Error("synthetic storage quota failure");
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function browser(fixture, sessionStorage, userId = "teacher", language = "zh-CN") {
  const names = [
    "class",
    "file",
    "preview",
    "commit",
    "new",
    "export",
    "reload-receipt",
    "status",
    "errors",
    "table",
    "receipt",
  ];
  const elements = Object.fromEntries(names.map((name) => [name, new Element()]));
  const state = { userId, loseResponse: false, confirm: true, prompts: 0, imports: [] };
  vm.runInNewContext(script, {
    document: {documentElement:{lang:language},
      getElementById: (id) => elements[id.slice(4)],
      createElement: () => new Element(),
    },
    sessionStorage,
    crypto: { randomUUID },
    confirm: () => {
      state.prompts++;
      return state.confirm;
    },
    setTimeout,
    fetch: async (path, options) => {
      const actor = csvContext(state.userId);
      let data;
      if (path === "/api/csv/classes") {
        data = { ok: true, user_id: state.userId, classes: fixture.service.classes(actor) };
      } else {
        const url = new URL(path, "http://synthetic.fixture");
        const classId = url.searchParams.get("class_id");
        const headers = options.headers;
        const bytes = new Uint8Array(options.body);
        if (url.pathname.endsWith("/preview")) {
          data = fixture.service.preview(actor, classId, headers["X-EchoClass-Csv-Schema"], bytes);
        } else if (url.pathname.endsWith("/import")) {
          const token = headers["X-EchoClass-Client-Import-Id"];
          const result = fixture.service.import(
            actor,
            classId,
            headers["X-EchoClass-Csv-Schema"],
            token,
            headers["X-EchoClass-Expected-SHA256"],
            bytes,
          );
          state.imports.push({ token, ...result });
          if (state.loseResponse) {
            state.loseResponse = false;
            throw new Error("synthetic lost response after SQLite commit");
          }
          data = { ok: true, ...result };
        } else throw new Error(`Unexpected request: ${path}`);
      }
      return { ok: true, json: async () => data };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const click = async (name) => {
    assert.equal(elements[name].disabled, false, `${name} must be available`);
    await elements[name].handlers.click();
  };
  return {
    state,
    elements,
    click,
    async preview(bytes, classId = "class-A") {
      elements.class.value = classId;
      elements.class.handlers.change();
      elements.file.files = [
        { size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer },
      ];
      elements.file.handlers.change();
      await click("preview");
    },
  };
}

function fixtureFor(t) {
  const fixture = csvFixture();
  t.after(() => fixture.db.close());
  return fixture;
}

function count(fixture, table) {
  return fixture.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
}

function legacyAttempt(bytes, token) {
  return { user_id: "teacher", class_id: "class-A", schema, sha: codec.sha256(bytes), token };
}

test("CSV UI preserves an uncertain committed attempt across another file preview and reload", async (t) => {
  const f = fixtureFor(t),
    saved = storage(),
    ui = await browser(f, saved);
  await ui.preview(fileA);
  ui.state.loseResponse = true;
  await ui.click("commit");
  assert.match(ui.elements.status.textContent, /lost response/);
  await ui.preview(fileB);
  await ui.preview(fileA);
  await ui.click("commit");
  const [first, retry] = ui.state.imports;
  assert.equal(retry.token, first.token);
  assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(retry.replayed, true);
  assert.equal(retry.added_this_request, 0);
  assert.equal(ui.state.prompts, 0);
  const reloaded = await browser(f, saved);
  await reloaded.preview(fileA);
  await reloaded.click("commit");
  assert.equal(reloaded.state.imports[0].token, first.token);
  assert.equal(count(f, "experiment_records"), 1);
  assert.equal(count(f, "csv_import_batches"), 1);
  assert.equal(count(f, "audit_logs"), 1);
});

test("CSV UI separates the same bytes by class and changes only an explicitly confirmed attempt", async (t) => {
  const f = fixtureFor(t),
    saved = storage(),
    ui = await browser(f, saved, "admin");
  await ui.preview(fileA, "class-A");
  await ui.click("commit");
  await ui.preview(fileA, "class-B");
  await ui.click("commit");
  const [a, b] = ui.state.imports;
  assert.notEqual(a.token, b.token);
  await ui.preview(fileA, "class-A");
  ui.state.confirm = false;
  await ui.click("new");
  await ui.click("commit");
  assert.equal(ui.state.imports[2].token, a.token);
  ui.state.confirm = true;
  await ui.click("new");
  await ui.preview(fileA, "class-A");
  await ui.click("commit");
  assert.notEqual(ui.state.imports[3].token, a.token);
  assert.equal(ui.state.imports[3].added_this_request, 1);
  await ui.preview(fileA, "class-B");
  await ui.click("commit");
  assert.equal(ui.state.imports[4].token, b.token);
  assert.equal(ui.state.imports[4].replayed, true);
  assert.equal(count(f, "experiment_records"), 3);
  assert.equal(ui.state.prompts, 2);
});

test("CSV UI lazily restores the legacy token even after previewing another file", async (t) => {
  const f = fixtureFor(t),
    saved = storage(),
    token = "synthetic-legacy-token";
  const receipt = f.submit(fileA, token).receipt;
  const legacy = JSON.stringify(legacyAttempt(fileA, token));
  saved.setItem("echoclass.csv.attempt.v1:teacher", legacy);
  const ui = await browser(f, saved);
  await ui.preview(fileB);
  assert.equal(saved.getItem("echoclass.csv.attempt.v1:teacher"), legacy);
  await ui.preview(fileA);
  await ui.click("commit");
  assert.equal(ui.state.imports[0].token, token);
  assert.deepEqual(ui.state.imports[0].receipt, receipt);
  await ui.click("new");
  const reloaded = await browser(f, saved);
  await reloaded.preview(fileA);
  await reloaded.click("commit");
  assert.notEqual(reloaded.state.imports[0].token, token);
  assert.equal(count(f, "experiment_records"), 2);
});

test("CSV UI storage failures preserve legacy and current retry tokens without eviction", async (t) => {
  const f = fixtureFor(t),
    saved = storage(),
    token = "synthetic-quota-token";
  f.submit(fileA, token);
  saved.setItem("echoclass.csv.attempt.v1:teacher", JSON.stringify(legacyAttempt(fileA, token)));
  const ui = await browser(f, saved),
    before = new Map(saved.values);
  saved.failWrite = true;
  await ui.preview(fileA);
  assert.equal(ui.elements.commit.disabled, true);
  assert.deepEqual(saved.values, before);
  saved.failWrite = false;
  await ui.preview(fileA);
  await ui.click("commit");
  assert.equal(ui.state.imports[0].token, token);
  const migrated = new Map(saved.values);
  saved.failWrite = true;
  await ui.click("new");
  assert.deepEqual(saved.values, migrated);
  await ui.preview(fileB);
  assert.equal(ui.elements.commit.disabled, true);
  assert.match(ui.elements.status.textContent, /存储可能已满/);
  assert.deepEqual(saved.values, migrated);
  saved.failWrite = false;
  saved.failRead = true;
  await ui.preview(fileA);
  assert.equal(ui.elements.commit.disabled, true);
  assert.deepEqual(saved.values, migrated);
  saved.failRead = false;
  await ui.preview(fileA);
  await ui.click("commit");
  assert.equal(ui.state.imports[1].token, token);
  assert.equal(count(f, "experiment_records"), 1);
});

test("CSV UI requires an explicit new import to recover a damaged or mismatched cache", async (t) => {
  const f = fixtureFor(t),
    saved = storage(),
    ui = await browser(f, saved);
  await ui.preview(fileA);
  await ui.click("commit");
  const [key, raw] = [...saved.values][0];
  const original = JSON.parse(raw);
  for (const damaged of [
    "{invalid",
    "null",
    JSON.stringify({ ...original, token: "short" }),
    JSON.stringify({ ...original, user_id: "peer" }),
  ]) {
    saved.values.set(key, damaged);
    await ui.preview(fileA);
    assert.equal(ui.elements.commit.disabled, true);
    assert.equal(ui.elements.new.disabled, false);
    assert.match(ui.elements.status.textContent, /损坏|不匹配/);
    assert.equal(count(f, "experiment_records"), 1);
  }
  await ui.click("new");
  await ui.preview(fileA);
  await ui.click("commit");
  assert.notEqual(ui.state.imports[1].token, original.token);
  assert.equal(ui.state.prompts, 1);
  assert.equal(count(f, "experiment_records"), 2);
});

test("CSV UI does not silently replace damaged legacy metadata", async (t) => {
  const f = fixtureFor(t),
    saved = storage();
  saved.setItem("echoclass.csv.attempt.v1:teacher", "{invalid");
  const ui = await browser(f, saved);
  await ui.preview(fileA);
  assert.equal(ui.elements.commit.disabled, true);
  assert.match(ui.elements.status.textContent, /标识损坏/);
  assert.equal(saved.values.size, 1);
  await ui.click("new");
  await ui.preview(fileA);
  await ui.click("commit");
  assert.equal(count(f, "experiment_records"), 1);
  assert.equal(ui.state.prompts, 1);
});

test("CSV UI isolates users and preserves the original user's uncertain attempt", async (t) => {
  const f = fixtureFor(t),
    saved = storage(),
    teacher = await browser(f, saved);
  await teacher.preview(fileA);
  teacher.state.loseResponse = true;
  await teacher.click("commit");
  teacher.state.userId = "peer";
  await teacher.click("commit");
  assert.equal(teacher.state.imports.length, 1);
  assert.match(teacher.elements.status.textContent, /账号已变更/);
  const peer = await browser(f, saved, "peer");
  await peer.preview(fileA);
  await peer.click("commit");
  assert.notEqual(peer.state.imports[0].token, teacher.state.imports[0].token);
  const restored = await browser(f, saved);
  await restored.preview(fileA);
  await restored.click("commit");
  assert.equal(restored.state.imports[0].token, teacher.state.imports[0].token);
  assert.equal(restored.state.imports[0].replayed, true);
  assert.equal(count(f, "experiment_records"), 2);
});

test("English CSV feedback and a Chinese reload preserve the original imported batch",async(t)=>{
 const f=fixtureFor(t),saved=storage();
 const en=await browser(f,saved,"teacher","en");await en.preview(fileA);
 assert.match(en.elements.status.textContent,/passed validation/);
 en.state.loseResponse=true;await en.click("commit");const first=en.state.imports[0];
 const zh=await browser(f,saved,"teacher","zh-CN");await zh.preview(fileA);await zh.click("commit");
 assert.equal(zh.state.imports[0].token,first.token);
 assert.deepEqual(zh.state.imports[0].receipt,first.receipt);
 assert.equal(zh.state.imports[0].replayed,true);
});
