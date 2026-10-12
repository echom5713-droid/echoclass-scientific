import { operationLanguageScript } from "../dist/src/shared/operation-copy.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
const script = operationLanguageScript()+"\n"+readFileSync(new URL("../public/grounded-client.js", import.meta.url), "utf8");
class Element {
  children = []; handlers = {}; value = "best"; checked = false; textContent = ""; disabled = false;
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  set innerHTML(_) { throw Error("Unsafe HTML rendering"); }
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
async function browser(language = "zh-CN") {
  const elements = new Map(), state = { user: "teacher", calls: [], wait: null, failure: false, forged: false };
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  vm.runInNewContext(script, { document: {documentElement:{lang:language}, getElementById: id => el(id.replace(/^grounded-/, "")), createElement: () => new Element() }, location: { pathname: "/grounded-analysis/runs/synthetic-run" }, fetch: async (url, options = {}) => {
    assert.equal(url, "/api/grounded-runs/synthetic-run");
    if (options.method !== "POST") return { ok: true, json: async () => ({ ok: true, user_id: state.user, topics: { best: "实测最佳" }, model_available: false }) };
    state.calls.push(JSON.parse(options.body));
    if (state.wait) await state.wait;
    if (state.failure) return { ok: false, json: async () => ({ ok: false, error: { message: "scope revoked" } }) };
    return { ok: true, json: async () => ({ ok: true, user_id: state.user, mode: "deterministic", answer_hash: "synthetic-answer", evidence: { schema: "echoclass.grounded-cards.v1", run_id: "synthetic-run", evidence_hash: "synthetic-pack", scientific_result_hash: "synthetic-result", sources: [{ id: "best", kind: "report", pointer: "/result/best_tested", hash: "synthetic-source", value: language === "en" ? {mean: 10.125, concentrations: [1,3]} : "<script>injected</script>" }] }, cards: [{ id: "best", title: "实测最佳", text: "<img src=x onerror=alert(1)>", citations: [state.forged ? "unknown" : "best"] }] }) };
  } });
  await settle(); return { state, el, click: () => el("explain").handlers.click() };
}
test("grounded page renders text-only citations and defaults to no model transmission", async () => {
  const b = await browser(); await b.click();
  assert.deepEqual(b.state.calls, [{ topic: "best", use_model: false }]);
  assert.ok(b.el("answer").children.length);
  assert.equal(b.el("answer").children[0].children[1].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(b.el("model").disabled, true);
  assert.match(b.el("status").textContent, /未调用/);
});
test("changed account, missing citation or denied access clears previously visible explanation", async () => {
  for (const mode of ["account", "citation", "denied"]) {
    const b = await browser(); await b.click();
    if (mode === "account") b.state.user = "other";
    if (mode === "citation") b.state.forged = true;
    if (mode === "denied") b.state.failure = true;
    await b.click(); assert.equal(b.el("answer").children.length, 0);
    if (mode === "account") assert.equal(b.el("explain").disabled, true);
  }
});
test("topic changes invalidate delayed replies and double clicks do not duplicate requests", async () => {
  const b = await browser(); let release;
  b.state.wait = new Promise(resolve => { release = resolve; });
  const first = b.click(); await b.click();
  b.el("topic").handlers.change();
  release(); await first;
  assert.equal(b.state.calls.length, 1);
  assert.equal(b.el("answer").children.length, 0);
});

test("English reading uses cited numeric fields and retains the canonical text, citations and hashes",async()=>{
 const b=await browser("en");await b.click();
 assert.match(b.el("status").textContent,/no external model/);
 const section=b.el("answer").children[1];
 assert.match(section.children[1].textContent,/1%, 3%; mean yield 10\.125%/);
 assert.equal(section.children[2].children[2].textContent,"<img src=x onerror=alert(1)>");
 assert.equal(section.children[3].children[2].textContent,JSON.stringify({mean:10.125,concentrations:[1,3]},null,2));
 assert.match(section.children[3].children[0].textContent,/\[best\]/);
 assert.match(section.children[3].children[3].textContent,/synthetic-source/);
 assert.match(b.el("answer").children.at(-1).textContent,/synthetic-answer/);
 assert.deepEqual(b.state.calls,[{topic:"best",use_model:false}]);
});
