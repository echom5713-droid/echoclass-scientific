import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runSyntheticDemo, formatSyntheticDemo } from "../scripts/scientific-demo.mjs";

function fakePython(source, run) {
  const directory = mkdtempSync(path.join(tmpdir(), "echoclass-demo-process-"));
  const executable = path.join(directory, "python-fixture");
  try {
    writeFileSync(executable, `#!${process.execPath}\n${source}\n`);
    chmodSync(executable, 0o700);
    run(executable);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("demo calculates the committed synthetic case and distinguishes the observed tie from the model candidate", () => {
  const summary = runSyntheticDemo();
  assert.deepEqual(summary.selection, { candidate_count: 20, included_count: 20, excluded_count: 0 });
  assert.deepEqual(summary.groups.map((group) => [group.concentration, group.n]), [[0, 5], [1, 5], [3, 5], [4, 5]]);
  for (const [index, expected] of [6, 9, 9, 6].entries()) {
    assert.ok(Math.abs(summary.groups[index].mean.value - expected) < 1e-12);
  }
  assert.deepEqual(summary.best_tested.concentrations, [1, 3]);
  assert.equal(summary.best_tested.mean, 9);
  assert.ok(Math.abs(summary.candidate.concentration - 2) < 1e-12);
  assert.ok(Math.abs(summary.candidate.predicted_yield - 10) < 1e-12);
  assert.match(summary.scientific_result_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(summary.identity_note, /not a production exact-reproduction claim/);
  const readable = formatSyntheticDemo(summary);
  assert.match(readable, /Best tested: 1% and 3% \(tie\); mean yield 9%/);
  assert.match(readable, /Model candidate: 2% NH4Cl; predicted yield 10%/);
  assert.match(readable, /not an established optimum/);
  assert.match(readable, /does not establish independence/);
});

test("demo kills an unresponsive process within its bound and never accepts a partial result", () => {
  fakePython('process.on("SIGTERM", () => {}); process.stdout.write("{\\\"result\\\":"); setInterval(() => {}, 1000);', (python) => {
    const start = Date.now();
    assert.throws(() => runSyntheticDemo({ python, timeoutMs: 150 }), /exceeded its time limit; no result was accepted/);
    assert.ok(Date.now() - start < 5000, "The child process must not outlive the bounded demo call");
  });
});

test("demo rejects invalid or unsuccessful worker output without exposing its contents", () => {
  for (const source of [
    'process.stdout.write("synthetic-private-debug-text");',
    'process.stdout.write(JSON.stringify({result: {}, identity: {}}));',
    'process.stderr.write("synthetic-private-debug-text"); process.exit(2);',
  ]) {
    fakePython(source, (python) => {
      assert.throws(() => runSyntheticDemo({ python }), (error) => {
        assert.match(error.message, /Synthetic demo (returned an invalid result|failed)/);
        assert.doesNotMatch(error.message, /synthetic-private-debug-text/);
        return true;
      });
    });
  }
});

test("demo reports unavailable Python and rejects unknown options before execution", () => {
  assert.throws(() => runSyntheticDemo({ python: path.join(tmpdir(), "echoclass-demo-missing-python", "python") }), /verify the Python environment/);
  const cli = spawnSync(process.execPath, [path.resolve("scripts/scientific-demo.mjs"), "--unknown"], {
    encoding: "utf8",
    env: { ...process.env, ECHOCLASS_PYTHON: "not-a-python-executable" },
    timeout: 5000,
  });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, "");
  assert.match(cli.stderr, /^Usage:/);
});
