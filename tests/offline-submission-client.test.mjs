import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const owner = { user_id: "student-A", role: "student", class_name: "Class A", group_name: "G1", name: "Student A" };
const payload = { mode: "real", student_name: owner.name, class_name: owner.class_name, group_name: owner.group_name, nh4cl_concentration: "3", peel_mass: "100", oil_mass: "1", distillation_time: "45", phase_clarity_score: "4", emulsification_level: "轻微乳化", emulsion_concentration: "20", ecoli_observation_group: "精油乳液组", inhibition_zone_diameter: "10", colony_growth_score: "3", error_source: "", note: "Synthetic test only", measurement_method: "manual_direct", measurement_image_state: "manual_only" };

function storage() {
  const values = new Map();
  return {
    values, failRead: false, failWrite: false, enumerate: (keys) => keys,
    get length() { return values.size; },
    key(i) { return this.enumerate([...values.keys()])[i] ?? null; },
    getItem(key) { if (this.failRead) throw Error("Storage unavailable"); return values.get(key) ?? null; },
    setItem(key, value) { if (this.failWrite) throw Error("Storage full"); values.set(key, value); },
    removeItem(key) { if (this.failWrite) throw Error("Storage full"); values.delete(key); },
  };
}

class Element {
  constructor(value = "") { this.value = value; this.handlers = {}; this.style = {}; this.dataset = {}; this.textContent = ""; this.children = []; this.disabled = false; this.files = []; }
  addEventListener(name, handler) { (this.handlers[name] ??= []).push(handler); }
  async fire(name) { for (const fn of this.handlers[name] ?? []) await fn({ preventDefault() {} }); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  insertAdjacentElement(_where, child) { this.append(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  remove() {}
  click() { return this.fire("click"); }
}

async function browser({ saved = storage(), tabStorage = storage(), formPresent = true, demo = false, pageOwner = owner } = {}) {
  const fields = { ...payload, student_name: pageOwner.name, class_name: pageOwner.class_name, group_name: pageOwner.group_name, mode: demo ? "demo" : "real" };
  const elements = new Map();
  const form = new Element(), button = new Element();
  form.dataset = { demo: demo ? "1" : "0", submissionContext: JSON.stringify(pageOwner) };
  form.elements = { namedItem: (name) => ({ get value() { return fields[name]; }, set value(value) { fields[name] = value; } }) };
  form.querySelector = () => button;
  if (formPresent) {
    elements.set("student-form", form);
    for (const id of ["peel_mass", "oil_mass", "inhibition_zone_diameter", "phase_clarity_score", "emulsification_level", "yield-text", "zone-text", "diagnosis-text", "data-status", "grade-text", "submit-result", "sync-status"]) elements.set(id, new Element(fields[id]));
  }
  const state = { current: { ...pageOwner }, posts: [], lostResponse: false, failBeforeCommit: false, offline: false, httpStatus: 200, committed: new Map(), timers: [], windowEvents: {}, beforePost: null, invalidReceipt: false };
  const context = vm.createContext({
    document: { readyState: "complete", getElementById: (id) => elements.get(id) ?? null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => new Element(), body: new Element() },
    localStorage: saved, sessionStorage: tabStorage, crypto: { randomUUID }, Blob, URL,
    navigator: { get onLine() { return !state.offline; } },
    FormData: class { entries() { return Object.entries(fields); } get(name) { return fields[name] ?? null; } },
    setTimeout: (fn) => state.timers.push(fn), clearTimeout() {}, setInterval() {}, clearInterval() {},
    addEventListener: (name, fn) => (state.windowEvents[name] ??= []).push(fn),
    fetch: async (url, options = {}) => {
      if (state.offline) throw Error("Offline");
      if (!options.method || options.method === "GET") return { ok: true, status: 200, json: async () => ({ context: state.current }) };
      const body = JSON.parse(options.body);
      await state.beforePost?.(body);
      state.posts.push({ url, body, persisted: [...saved.values.values()].some((raw) => raw.includes(body.record?.client_submission_id ?? "no-token")) });
      if (state.failBeforeCommit) { state.failBeforeCommit = false; throw Error("Transport failure before commit"); }
      if (state.httpStatus !== 200) return { ok: false, status: state.httpStatus, json: async () => ({ error: { message: "Synthetic HTTP rejection", code: "VALIDATION_ERROR", fields: [] } }) };
      if (body.context && JSON.stringify(body.context) !== JSON.stringify(state.current)) return { ok: false, status: 409, json: async () => ({ error: { message: "账号已变更", code: "CONFLICT", fields: [] } }) };
      const record = body.record ?? body.records?.[0] ?? body;
      const token = record.client_submission_id ?? randomUUID();
      if (!state.committed.has(token)) state.committed.set(token, `record-${state.committed.size + 1}`);
      const response = { context: state.current, added: 1, record: { id: state.committed.get(token), ai_diagnosis: "" }, records: [{ client_submission_id: token, record_id: state.committed.get(token), created: true }] };
      if (state.invalidReceipt) response.records[0].client_submission_id = "wrong-token";
      if (state.lostResponse) { state.lostResponse = false; throw Error("Response lost after commit"); }
      return { ok: true, status: 200, json: async () => response };
    },
  });
  context.window = context;
  context.loadActualModule = async (url) => vm.runInContext(readFileSync(new URL(`../public/${url.split("/").at(-1)}`, import.meta.url), "utf8"), context);
  const actual = readFileSync(new URL("../public/client.js", import.meta.url), "utf8").replace(/\bimport\(('|")(\/static\/[^'"]+)\1\)/g, 'loadActualModule("$2")');
  vm.runInContext(actual, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { state, form, fields, button, saved, tabStorage, elements, async timers() { for (const fn of state.timers.splice(0)) await fn(); }, async event(name) { for (const fn of state.windowEvents[name] ?? []) await fn(); } };
}

test("actual shared client never auto-sends an unowned legacy queue on another page", async () => {
  const saved = storage(), original = JSON.stringify([{ ...payload, client_submission_id: "legacy-unknown-owner" }]);
  saved.setItem("citrus_offline_records", original);
  const ui = await browser({ saved, formPresent: false });
  await ui.timers();
  assert.equal(ui.state.posts.length, 0);
  assert.equal(saved.getItem("citrus_offline_records"), original);
});

test("actual form persists an account-bound token before POST and reuses it after a lost response", async () => {
  const ui = await browser();
  ui.state.lostResponse = true;
  await ui.form.fire("submit");
  assert.equal(ui.state.posts[0].persisted, true);
  await ui.form.fire("submit");
  assert.equal(ui.state.committed.size, 1);
  assert.equal(ui.state.posts[1].body.record.client_submission_id, ui.state.posts[0].body.record.client_submission_id);
  const receipt = JSON.parse([...ui.saved.values.values()][0]);
  assert.deepEqual(receipt.context, owner);
  assert.equal(receipt.state, "confirmed");
  assert.equal(receipt.record_id, ui.state.committed.get(receipt.record.client_submission_id));
});

test("HTTP validation rejection is shown instead of being silently queued as offline", async () => {
  const ui = await browser();
  ui.state.httpStatus = 400;
  await ui.form.fire("submit");
  assert.match(ui.elements.get("submit-result").textContent, /Synthetic HTTP rejection/);
  await ui.event("online");
  assert.equal(ui.state.posts.length, 1);
});

test("an uncertain request survives reload and is never sent by a different signed-in user", async () => {
  const ui = await browser();
  ui.state.lostResponse = true;
  await ui.form.fire("submit");
  const originalToken = ui.state.posts[0].body.record.client_submission_id;
  const b = await browser({ saved: ui.saved, pageOwner: { ...owner, user_id: "student-B", name: "Student B" } });
  await b.timers();
  assert.equal(b.state.posts.length, 0);
  const restored = await browser({ saved: ui.saved });
  restored.state.committed = ui.state.committed;
  await restored.timers();
  assert.equal(restored.state.posts[0].body.record.client_submission_id, originalToken);
  assert.equal(restored.state.committed.size, 1);
  assert.match(restored.elements.get("submit-result").textContent, /已确认/);
});

test("account or class changes block a stale form before any record POST", async () => {
  for (const changed of [{ ...owner, user_id: "student-B" }, { ...owner, class_name: "Class B" }, { ...owner, group_name: "G2" }]) {
    const ui = await browser();
    ui.state.current = changed;
    await ui.form.fire("submit");
    await ui.event("online");
    assert.equal(ui.state.posts.length, 0);
    assert.match(ui.elements.get("submit-result").textContent, /账号或班级信息已变更/);
    const entry = JSON.parse([...ui.saved.values.values()][0]);
    assert.equal(entry.context.user_id, owner.user_id);
    assert.equal(entry.state, "pending");
  }
});

test("server guard rejects a cookie change after identity GET; only an explicit restored-account retry sends again", async () => {
  const ui = await browser();
  ui.state.beforePost = () => { ui.state.current = { ...owner, user_id: "student-B" }; };
  await ui.form.fire("submit");
  assert.equal(ui.state.committed.size, 0);
  assert.match(ui.elements.get("submit-result").textContent, /账号已变更/);
  ui.state.beforePost = null;
  ui.state.current = { ...owner };
  await ui.event("online");
  assert.equal(ui.state.posts.length, 1);
  await ui.form.fire("submit");
  assert.equal(ui.state.committed.size, 1);
  assert.equal(ui.state.posts[0].body.record.client_submission_id, ui.state.posts[1].body.record.client_submission_id);
});

test("offline drafts retain separate identities and reconcile one receipt at a time", async () => {
  const ui = await browser();
  ui.state.offline = true;
  await ui.form.fire("submit");
  ui.fields.note = "Second synthetic observation";
  await ui.form.fire("submit");
  assert.equal(ui.state.posts.length, 0);
  assert.equal(ui.saved.values.size, 2);
  ui.state.offline = false;
  ui.state.beforePost = () => { ui.state.failBeforeCommit = true; };
  await ui.event("online");
  assert.equal(ui.state.committed.size, 0);
  assert.match(ui.elements.get("submit-result").textContent, /本轮已确认 0 条.*2 条待确认/);
  ui.state.beforePost = null;
  ui.state.lostResponse = true;
  await ui.event("online");
  const states = [...ui.saved.values.values()].map((raw) => JSON.parse(raw).state);
  assert.deepEqual(states.sort(), ["confirmed", "pending"]);
  assert.match(ui.elements.get("submit-result").textContent, /本轮已确认 1 条.*1 条待确认/);
  await ui.event("online");
  assert.equal(ui.state.committed.size, 2);
  assert.ok([...ui.saved.values.values()].every((raw) => JSON.parse(raw).state === "confirmed"));
  assert.match(ui.elements.get("submit-result").textContent, /本轮已确认 1 条.*0 条待确认/);
});

test("demo form never queues or replays classroom records, even when its response is lost", async () => {
  const saved = storage();
  const original = JSON.stringify([{ ...payload, client_submission_id: "old-owner-unknown" }]);
  saved.setItem("citrus_offline_records", original);
  const ui = await browser({ saved, demo: true });
  ui.state.lostResponse = true;
  await ui.form.fire("submit");
  await ui.event("online");
  await ui.timers();
  assert.equal(ui.state.posts.length, 1);
  assert.equal(ui.state.posts[0].body.mode, "demo");
  assert.deepEqual([...saved.values], [["citrus_offline_records", original]]);
});

test("legacy queue remains byte-for-byte quarantined on a real student page", async () => {
  for (const original of ["{damaged", JSON.stringify([{ ...payload, client_submission_id: "legacy-id" }])]) {
    const saved = storage();
    saved.setItem("citrus_offline_records", original);
    const ui = await browser({ saved });
    await ui.timers();
    assert.equal(ui.state.posts.length, 0);
    assert.equal(saved.getItem("citrus_offline_records"), original);
    assert.match(ui.elements.get("sync-status").children[0].textContent, /无法确认所属账号/);
  }
});

test("storage failure prevents first POST, and a lost receipt write preserves the original retry token", async () => {
  const ui = await browser();
  ui.saved.failWrite = true;
  await ui.form.fire("submit");
  assert.equal(ui.state.posts.length, 0);
  assert.match(ui.elements.get("submit-result").textContent, /本地存储不可用/);
  ui.saved.failWrite = false;
  ui.state.beforePost = () => { ui.saved.failWrite = true; };
  await ui.form.fire("submit");
  assert.equal(ui.state.committed.size, 1);
  ui.saved.failWrite = false;
  ui.state.beforePost = null;
  await ui.form.fire("submit");
  assert.equal(ui.state.posts[0].body.record.client_submission_id, ui.state.posts[1].body.record.client_submission_id);
  assert.equal(ui.state.committed.size, 1);
});

test("invalid receipt and server errors retain the same uncertain intent for retry", async () => {
  const ui = await browser();
  ui.state.invalidReceipt = true;
  await ui.form.fire("submit");
  assert.match(ui.elements.get("submit-result").textContent, /回执不完整/);
  ui.state.invalidReceipt = false;
  ui.state.httpStatus = 503;
  await ui.form.fire("submit");
  ui.state.httpStatus = 200;
  await ui.form.fire("submit");
  assert.equal(ui.state.committed.size, 1);
  assert.equal(new Set(ui.state.posts.map((post) => post.body.record.client_submission_id)).size, 1);
});

test("double click does not create two intents, while an explicit next observation can have equal values", async () => {
  const ui = await browser();
  let release;
  ui.state.beforePost = () => new Promise((resolve) => { release = resolve; });
  const first = ui.form.fire("submit");
  await new Promise((resolve) => setImmediate(resolve));
  await ui.form.fire("submit");
  release();
  await first;
  assert.equal(ui.state.posts.length, 1);
  await ui.form.fire("submit");
  assert.equal(ui.state.posts.length, 1);
  await ui.form.children.find((child) => child.textContent === "开始下一条记录").click();
  ui.state.beforePost = null;
  await ui.form.fire("submit");
  assert.equal(ui.state.committed.size, 2);
  assert.notEqual(ui.state.posts[0].body.record.client_submission_id, ui.state.posts[1].body.record.client_submission_id);
});

test("damaged account queue is preserved and blocks accidental duplicate creation", async () => {
  const ui = await browser();
  ui.state.lostResponse = true;
  await ui.form.fire("submit");
  const key = [...ui.saved.values.keys()][0];
  ui.saved.setItem(key, "{invalid");
  await ui.form.fire("submit");
  assert.equal(ui.state.posts.length, 1);
  assert.equal(ui.saved.getItem(key), "{invalid");
  assert.match(ui.elements.get("submit-result").textContent, /无法读取/);
});

async function nextObservation(ui) {
  await ui.form.children.find((child) => child.textContent === "开始下一条记录").click();
}

for (const failure of ["lostResponse", "failBeforeCommit"]) {
  test(`identical observations retry the unresolved token under reversed/shuffled storage after ${failure}`, async () => {
    for (const reload of ["same-page", "same-tab", "new-tab"]) {
      for (const enumerate of [(keys) => keys.reverse(), (keys) => [...keys.slice(1), keys[0]]]) {
        const saved = storage();
        saved.enumerate = enumerate;
        let ui = await browser({ saved });
        // Two independently confirmed observations with exactly equal form values.
        await ui.form.fire("submit");
        await nextObservation(ui);
        await ui.form.fire("submit");
        await nextObservation(ui);
        ui.state[failure] = true;
        await ui.form.fire("submit");
        const uncertain = ui.state.posts.at(-1).body.record.client_submission_id;
        const committed = ui.state.committed;
        if (reload !== "same-page") {
          ui = await browser({ saved, tabStorage: reload === "same-tab" ? ui.tabStorage : undefined });
          ui.state.committed = committed;
        }
        const before = ui.state.posts.length;
        await ui.form.fire("submit");
        assert.equal(ui.state.posts.length, before + 1, "pending observation must actually retry");
        assert.equal(ui.state.posts.at(-1).body.record.client_submission_id, uncertain);
        assert.equal(committed.size, 3);
        const intent = [...saved.values.values()].map(JSON.parse).find((item) => item.record.client_submission_id === uncertain);
        assert.equal(intent.state, "confirmed");
        assert.equal(intent.record_id, committed.get(uncertain));
        assert.match(ui.elements.get("submit-result").textContent, new RegExp(committed.get(uncertain)));
      }
    }
  });
}

test("two tabs keep separate explicit next observations and retry their own exact active token", async () => {
  const saved = storage(), a = await browser({ saved });
  await a.form.fire("submit");
  const b = await browser({ saved });
  b.state.committed = a.state.committed;
  await b.form.fire("submit");
  await nextObservation(a);
  await nextObservation(b);
  a.state.failBeforeCommit = true;
  b.state.failBeforeCommit = true;
  await a.form.fire("submit");
  await b.form.fire("submit");
  const aToken = a.state.posts.at(-1).body.record.client_submission_id;
  const bToken = b.state.posts.at(-1).body.record.client_submission_id;
  assert.notEqual(aToken, bToken, "explicit next in another tab creates another observation");
  saved.enumerate = (keys) => keys.reverse();
  const ambiguous = await browser({ saved });
  await ambiguous.form.fire("submit");
  assert.equal(ambiguous.state.posts.length, 0, "a tab with no active pointer must not guess between two unresolved observations");
  assert.match(ambiguous.elements.get("submit-result").textContent, /多条待确认/);
  await a.form.fire("submit");
  assert.equal(a.state.posts.at(-1).body.record.client_submission_id, aToken);
  const reloadedB = await browser({ saved, tabStorage: b.tabStorage });
  reloadedB.state.committed = a.state.committed;
  await reloadedB.form.fire("submit");
  assert.equal(reloadedB.state.posts.at(-1).body.record.client_submission_id, bToken);
  assert.equal(a.state.committed.size, 3);
});

test("failed active-pointer storage cannot replace an unresolved next observation with an old receipt after reload", async () => {
  const ui = await browser();
  await ui.form.fire("submit");
  await nextObservation(ui);
  ui.tabStorage.failWrite = true;
  await ui.form.fire("submit");
  assert.equal(ui.state.posts.length, 1, "pointer must be durable before first POST");
  const pending = [...ui.saved.values.values()].map(JSON.parse).find((item) => item.state === "pending");
  assert.ok(pending, "the unposted observation stays available for recovery");
  ui.tabStorage.failWrite = false;
  ui.saved.enumerate = (keys) => keys.reverse();
  const restored = await browser({ saved: ui.saved, tabStorage: ui.tabStorage });
  restored.state.committed = ui.state.committed;
  await restored.form.fire("submit");
  assert.equal(restored.state.posts[0].body.record.client_submission_id, pending.record.client_submission_id);
  assert.equal(restored.state.committed.size, 2);
});
