import { operationLanguageScript } from "../dist/src/shared/operation-copy.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
const script = operationLanguageScript()+"\n"+readFileSync(new URL("../public/retrieval-client.js", import.meta.url), "utf8");
class Element {
  children = []; handlers = {}; value = "bootstrap"; textContent = ""; disabled = false;
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  addEventListener(event, fn) { this.handlers[event] = fn; }
  set innerHTML(_) { throw Error("unsafe HTML"); }
}
async function browser(language = "zh-CN") {
  const elements = new Map(), state = { user: "teacher", calls: 0, delay: null, fail: false, forge: false };
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  vm.runInNewContext(script, { document: {documentElement:{lang:language}, getElementById: id => el(id.replace(/^retrieval-/, "")), createElement: () => new Element() }, location: { pathname: "/grounded-analysis/runs/test-run" }, fetch: async (url, options = {}) => {
    if (options.method !== "POST") return { ok: true, json: async () => ({ ok: true, user_id: state.user, retrieval_available: true }) };
    assert.equal(url, "/api/grounded-runs/test-run/sources");
    assert.deepEqual(JSON.parse(options.body), { question: el("question").value }); state.calls++;
    if (state.delay) await state.delay;
    if (state.fail) return { ok: false, json: async () => ({ ok: false, error: { message: "revoked" } }) };
    return { ok: true, json: async () => ({ ok: true, user_id: state.user, run_id: "test-run", provider: "local-extractive", answer: "<img src=x onerror=alert(1)>", corpus_version: "fixture-v1", answer_hash: "fixture-hash", limitations: ["limited"], citations: [{ document_id: "fixture", chunk_id: "bootstrap", content_hash: state.forge ? null : "fixture-source", content: "<script>payload</script>", title: "Method", source: "project.md", version: "1" }] }) };
  } });
  for (let i=0;i<5;i++) await new Promise(resolve => setImmediate(resolve));
  return { state, el, submit: () => el("form").handlers.submit({ preventDefault() {} }) };
}
test("retrieval client renders exact source text without HTML execution", async () => {
  const b = await browser(); await b.submit();
  assert.equal(b.el("answer").children[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(b.el("answer").children[1].children[1].textContent, "<script>payload</script>");
  assert.match(b.el("status").textContent, /未调用/);
});
test("retrieval clears old results on denied access, changed account or broken source", async () => {
  for (const kind of ["fail", "user", "forge"]) {
    const b = await browser(); await b.submit();
    if (kind === "user") b.state.user = "other"; else b.state[kind] = true;
    await b.submit(); assert.equal(b.el("answer").children.length, 0);
    if (kind === "user") assert.equal(b.el("submit").disabled, true);
  }
});
test("typing a new question invalidates a delayed answer and repeated submit is bounded", async () => {
  const b = await browser(); let release;
  b.state.delay = new Promise(resolve => { release = resolve; });
  const first = b.submit(); await b.submit(); b.el("question").handlers.input(); release(); await first;
  assert.equal(b.state.calls, 1); assert.equal(b.el("answer").children.length, 0);
});

test("English retrieval preserves exact original excerpts and their content hashes",async()=>{
 const b=await browser("en");await b.submit();
 assert.match(b.el("status").textContent,/no external model/);
 const section=b.el("answer").children[3];
 assert.equal(section.children[1].textContent,"<script>payload</script>");
 assert.equal(b.el("answer").children[2].children[1].textContent,"<img src=x onerror=alert(1)>");
 assert.match(section.children[4].textContent,/fixture-source/);
 assert.match(b.el("answer").children.at(-1).textContent,/fixture-hash/);
});
