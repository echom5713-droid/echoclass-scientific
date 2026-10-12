import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  followupPrediction,
  formatErrorProbability,
  mountFollowupDesign,
} from "../public/followup-design.js";
import { engineeringPage, projectPage } from "../dist/src/views/project-page.js";

// A numerical integral provides a separate check of every erfc-generated entry.
// Composite Simpson integration of the standard normal density on [0, z].
function gaussianTailByIntegration(z) {
  const subdivisions = 4096;
  const width = z / subdivisions;
  const density = (value) => Math.exp((-value * value) / 2) / Math.sqrt(2 * Math.PI);
  let weighted = density(0) + density(z);
  for (let index = 1; index < subdivisions; index++) {
    weighted += (index % 2 === 0 ? 2 : 4) * density(index * width);
  }
  return 0.5 - (width * weighted) / 3;
}

test("all 153 design probabilities agree with an independently integrated Gaussian tail", () => {
  let count = 0;
  for (let index = 0; index <= 16; index++) {
    for (const sigma of [1, 2, 4]) {
      for (const repeats of [1, 3, 5]) {
        const result = followupPrediction(index / 4, sigma, repeats);
        // Expanded quartic, separate from the browser's factored expression.
        const x = result.x;
        const quartic = -(x ** 4) + 8 * x ** 3 - 20 * x ** 2 + 16 * x + 6;
        assert.equal(result.quartic, quartic);
        const gap = Math.abs(result.quadratic - quartic);
        const expected = gaussianTailByIntegration((gap * Math.sqrt(repeats)) / (2 * sigma));
        assert.ok(Math.abs(result.errorProbability - expected) < 1e-12);
        assert.ok(result.errorProbability > 0 && result.errorProbability <= 0.5);
        assert.deepEqual(followupPrediction(4 - x, sigma, repeats).errorProbability, result.errorProbability);
        count++;
      }
    }
  }
  assert.equal(count, 153);
});

test("the original concentrations remain indistinguishable, even with more repeats", () => {
  for (const x of [0, 1, 3, 4]) {
    for (const sigma of [1, 2, 4]) {
      for (const repeats of [1, 3, 5]) {
        const result = followupPrediction(x, sigma, repeats);
        assert.equal(result.gap, 0);
        assert.equal(result.errorProbability, 0.5);
      }
    }
  }
  assert.equal(followupPrediction(2, 2, 3).gap, 4);
  assert.ok(Math.abs(followupPrediction(2, 2, 3).errorProbability - 0.04163225833177522) < 1e-15);
  assert.ok(Math.abs(followupPrediction(2, 2, 1).errorProbability - 0.15865525393145707) < 1e-15);
});

test("noise and replication have their expected direction without claiming zero error", () => {
  for (let index = 0; index <= 16; index++) {
    const x = index / 4;
    assert.ok(followupPrediction(x, 1, 3).errorProbability <= followupPrediction(x, 2, 3).errorProbability);
    assert.ok(followupPrediction(x, 2, 3).errorProbability <= followupPrediction(x, 4, 3).errorProbability);
    assert.ok(followupPrediction(x, 2, 5).errorProbability <= followupPrediction(x, 2, 3).errorProbability);
    assert.ok(followupPrediction(x, 2, 3).errorProbability <= followupPrediction(x, 2, 1).errorProbability);
  }
  assert.equal(formatErrorProbability(followupPrediction(2, 1, 5).errorProbability), "<0.01%");
  assert.equal(formatErrorProbability(0.5), "50.00%");
  assert.equal(formatErrorProbability(followupPrediction(2, 2, 3).errorProbability), "4.16%");
});

test("unsupported designs and nonfinite values cannot silently select a lookup entry", () => {
  for (const [x, sigma, repeats] of [
    [-0.25, 2, 3], [4.25, 2, 3], [0.1, 2, 3], [NaN, 2, 3],
    [Infinity, 2, 3], ["2", 2, 3], [2, 0, 3], [2, 3, 3], [2, 2, 2], [2, 2, "3"],
  ]) {
    assert.throws(() => followupPrediction(x, sigma, repeats), RangeError);
  }
  for (const value of [NaN, Infinity, -1, 0.51]) {
    assert.throws(() => formatErrorProbability(value), RangeError);
  }
});

test("the static page retains an accessible default result and explicit scientific assumptions", () => {
  const html = engineeringPage();
  assert.match(html, /id="followup-controls" class="followup-controls" disabled/);
  assert.match(html, /id="followup-x" type="range" min="0" max="4" step="0.25" value="2"/);
  assert.match(html, /id="followup-error">4.16%/);
  assert.match(html, /id="followup-quadratic">10.00%/);
  assert.match(html, /id="followup-quartic">6.00%/);
  assert.match(html, /<label for="followup-x">/);
  assert.match(html, /aria-live="polite" aria-atomic="true"/);
  assert.match(html, /known SD; equal prior probabilities and equal error costs/);
  assert.match(html, /balanced assignment on a tie/);
  assert.match(html, /bounded uniform noise/);
  assert.match(html, /cannot identify an arbitrary response curve/);
  assert.match(html, /docs\/followup-design.md/);
  assert.deepEqual(html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g), [
    '<script type="module" src="/static/followup-design.js"></script>',
  ]);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.match(projectPage(), /href="\/engineering#next-measurement"/);
  assert.doesNotMatch(projectPage(), /<script/);
  const script = readFileSync(new URL("../public/followup-design.js", import.meta.url), "utf8");
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|innerHTML|eval)\b/);
});

test("changing the controls updates predictions, probability, accessible text and plotted markers", () => {
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: "", value: "", disabled: true, attributes: new Map(), listeners: new Map(),
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
      });
    }
    return elements.get(id);
  };
  el("followup-x").value = "2";
  el("followup-sigma").value = "2";
  el("followup-repeats").value = "3";
  mountFollowupDesign({ getElementById: el });
  assert.equal(el("followup-controls").disabled, false);
  assert.equal(el("followup-error").textContent, "4.16%");
  el("followup-x").value = "1";
  el("followup-x").listeners.get("input")();
  assert.equal(el("followup-quadratic").textContent, "9.00%");
  assert.equal(el("followup-quartic").textContent, "9.00%");
  assert.equal(el("followup-error").textContent, "50.00%");
  assert.equal(el("followup-x").attributes.get("aria-valuetext"), "1.00 percent ammonium chloride");
  assert.match(el("followup-reading").textContent, /Repeating this concentration cannot distinguish/);
  assert.equal(el("followup-q-point").attributes.get("cy"), el("followup-f-point").attributes.get("cy"));
  el("followup-repeats").value = "5";
  el("followup-repeats").listeners.get("change")();
  assert.equal(el("followup-error").textContent, "50.00%");
  el("followup-x").value = "2";
  el("followup-sigma").value = "1";
  el("followup-sigma").listeners.get("input")();
  assert.equal(el("followup-error").textContent, "<0.01%");
  assert.equal(el("followup-guide").attributes.get("y1"), "68");
  assert.equal(el("followup-guide").attributes.get("y2"), "240");
  assert.doesNotThrow(() => mountFollowupDesign({ getElementById: () => null }));
});

test("Chinese controls retain the same predictions and describe the indistinguishable case in Chinese", () => {
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", value: "", disabled: true, attributes: new Map(), listeners: new Map(),
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      addEventListener(name, listener) { this.listeners.set(name, listener); },
    });
    return elements.get(id);
  };
  el("followup-x").value = "2";
  el("followup-sigma").value = "2";
  el("followup-repeats").value = "3";
  mountFollowupDesign({ documentElement: { lang: "zh-CN" }, getElementById: el });
  assert.equal(el("followup-controls").disabled, false);
  assert.equal(el("followup-error").textContent, "4.16%");
  assert.equal(el("followup-quadratic").textContent, "10.00%");
  assert.equal(el("followup-quartic").textContent, "6.00%");
  assert.match(el("followup-reading").textContent, /两项预测相差/);
  el("followup-x").value = "1";
  el("followup-x").listeners.get("input")();
  assert.equal(el("followup-error").textContent, "50.00%");
  assert.match(el("followup-reading").textContent, /无法区分/);
  assert.match(el("followup-x").attributes.get("aria-valuetext"), /氯化铵/);
  assert.equal(el("followup-q-point").attributes.get("cy"), el("followup-f-point").attributes.get("cy"));
});
