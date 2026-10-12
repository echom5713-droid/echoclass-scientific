import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the actual polling block with browser surfaces stubbed; no copied polling logic.
const source = readFileSync(new URL("../public/client.js", import.meta.url), "utf8");
const start = source.indexOf("// Real-time trend chart polling:");
const end = source.indexOf("// V8 material gallery:", start);
assert.ok(start >= 0 && end > start);
const polling = source.slice(start, end);

async function refresh(path, successful = true) {
  const requests = [];
  const chart = { outerHTML: "initial synthetic chart" };
  let callback;
  vm.runInNewContext(polling, {
    URL,
    URLSearchParams,
    location: new URL(path, "http://localhost:3000"),
    window: { location: new URL(path, "http://localhost:3000") },
    document: { getElementById: () => chart },
    setInterval: (fn) => { callback = fn; },
    fetch: async (url) => {
      requests.push(url);
      return { ok: successful, json: async () => ({ stats: [{}] }), text: async () => "<svg>updated</svg>" };
    },
  });
  assert.equal(typeof callback, "function");
  await callback();
  return { requests, chart };
}

test("every public demonstration chart keeps explicit demo context during polling", async () => {
  for (const path of ["/", "/classroom", "/theme", "/demo", "/dashboard", "/submit?demo=1", "/admin?mode=demo", "/report?demo=1"]) {
    const result = await refresh(path);
    assert.deepEqual(result.requests, ["/api/analytics?demo=1", "/api/trend-svg?demo=1"], path);
    assert.equal(result.chart.outerHTML, "<svg>updated</svg>");
  }
});

test("normal classroom chart polling keeps its authenticated scope", async () => {
  for (const path of ["/submit", "/admin", "/report", "/admin?demo=0"]) {
    const result = await refresh(path);
    assert.deepEqual(result.requests, ["/api/analytics", "/api/trend-svg"], path);
  }
});

test("a rejected refresh does not replace the existing chart", async () => {
  const result = await refresh("/theme", false);
  assert.equal(result.requests.length, 1);
  assert.equal(result.chart.outerHTML, "initial synthetic chart");
});
