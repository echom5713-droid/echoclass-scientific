import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectTraceEnvelope, runProjectTrace, formatProjectTrace } from "../scripts/project-trace.mjs";
import { canonicalHash, canonicalize, parseStrictJson } from "../dist/src/domain/scientific/canonical.js";
import { walkthroughPage } from "../dist/src/views/walkthrough-page.js";

const fixturePath = new URL("./fixtures/scientific/synthetic-envelope.json", import.meta.url);
const fixture = () => parseStrictJson(readFileSync(fixturePath, "utf8"));

test("trace joins the real worker result to every committed input and rejects a changed detached copy without writes", () => {
  const before = readFileSync(fixturePath);
  const trace = runProjectTrace();
  assert.equal(trace.records.length, 20);
  assert.equal(trace.selected.record_id, "synthetic-005");
  assert.equal(trace.selected.review_id, "synthetic-review-5");
  assert.equal(trace.selected.yield_percent, 8.8);
  assert.equal(trace.group.concentration, 1);
  assert.equal(trace.group.n, 5);
  assert.equal(trace.group.mean.value, 9);
  assert.deepEqual(trace.best_tested.concentrations, [1, 3]);
  assert.ok(Math.abs(trace.candidate.concentration - 2) < 1e-12);
  assert.equal(trace.exercise.rejected_by_input_byte_check, true);
  assert.equal(trace.exercise.original_input_still_matches, true);
  assert.notEqual(trace.exercise.changed_input_hash, trace.selected.input_hash);
  assert.equal(trace.exercise.unchanged_saved_hash, trace.selected.input_hash);
  assert.deepEqual(readFileSync(fixturePath), before);
  assert.deepEqual(inspectTraceEnvelope(fixture()).selected, trace.selected);
  for (const locale of ["en", "zh"]) {
    const text = formatProjectTrace(trace, locale);
    assert.ok(text.includes(trace.dataset_hash));
    assert.ok(text.includes(trace.scientific_result_hash));
    assert.ok(text.includes("9% (n=5)"));
  }
});

test("trace rejects changes to canonical input bytes, manifest ordering and execution identity", () => {
  const original = fixture();
  for (const mutate of [
    (value) => { value.canonical_inputs[5].canonical_json += " "; },
    (value) => { value.dataset_canonical_json = value.dataset_canonical_json.replace('"ordinal":5', '"ordinal":6'); },
    (value) => { value.execution_fingerprint = "sha256:" + "0".repeat(64); },
  ]) {
    const altered = structuredClone(original);
    mutate(altered);
    assert.throws(() => inspectTraceEnvelope(altered), /Sealed bytes do not match/);
  }
});

test("trace rejects a rehashed but wrongly bound review, rather than trusting digest consistency alone", () => {
  const altered = fixture();
  const input = parseStrictJson(altered.canonical_inputs[5].canonical_json);
  input.review_snapshot.record_id = "synthetic-006";
  altered.canonical_inputs[5].canonical_json = canonicalize(input);
  altered.canonical_inputs[5].input_hash = canonicalHash(input);
  const dataset = parseStrictJson(altered.dataset_canonical_json);
  dataset.entries[5].input_hash = altered.canonical_inputs[5].input_hash;
  altered.dataset_canonical_json = canonicalize(dataset);
  altered.dataset_hash = canonicalHash(dataset);
  const execution = parseStrictJson(altered.execution_canonical_json);
  execution.dataset_hash = altered.dataset_hash;
  altered.execution_canonical_json = canonicalize(execution);
  altered.execution_fingerprint = canonicalHash(execution);
  assert.throws(() => inspectTraceEnvelope(altered), /record, review and manifest identities disagree/);
});

test("the public reading agrees with the fixture in both languages and keeps native controls, hashes and commands", () => {
  const trace = inspectTraceEnvelope(fixture());
  const en = walkthroughPage(), zh = walkthroughPage("zh");
  for (const page of [en, zh]) {
    for (const value of [trace.selected.record_id, trace.selected.review_id, trace.selected.input_hash, trace.dataset_hash])
      assert.ok(page.includes(value));
    assert.match(page, /<td>8\.8 g<\/td>/);
    assert.match(page, /<td>100 g<\/td>/);
    assert.equal((page.match(/<details /g) ?? []).length, 4);
    assert.doesNotMatch(page, /<script|<form|localStorage|fetch\(/);
  }
  assert.deepEqual(zh.match(/<pre>[\s\S]*?<\/pre>/g), en.match(/<pre>[\s\S]*?<\/pre>/g));
  assert.match(zh, /href="\/walkthrough\?lang=en"/);
  assert.match(zh, /href="\/walkthrough\?lang=zh"/);
  assert.match(zh, /事件、审核者和时间都是虚构/);
});

test("invalid trace options fail before launching Python", () => {
  for (const options of [["--unknown"], ["--text", "--lang", "fr"], ["--json", "--lang", "zh"], ["--text", "--text"]]) {
    const cli = spawnSync(process.execPath, ["scripts/project-trace.mjs", ...options], { encoding: "utf8", timeout: 5000, env: { ...process.env, ECHOCLASS_PYTHON: "not-a-python-executable" } });
    assert.equal(cli.status, 1);
    assert.equal(cli.stdout, "");
    assert.match(cli.stderr, /^Usage:/);
  }
});
