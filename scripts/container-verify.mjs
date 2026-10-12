/** Isolated packaging acceptance. Never point seed at a classroom database. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../dist/src/infrastructure/database/migrations/index.js";
import { SqliteProvenanceStore } from "../dist/src/infrastructure/database/sqlite-provenance-store.js";
import { hashPassword } from "../dist/src/infrastructure/security/node-security.js";
import { canonicalHash, parseStrictJson } from "../dist/src/domain/scientific/canonical.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.resolve(process.env.ECHOCLASS_DATA_DIR || path.join(root, "data"));
const marker = path.join(directory, "container-synthetic-check.json");
const corpus = path.join(root, "resources/knowledge/echoclass-guide.md");
const teacherId = "container-synthetic-teacher";
const classId = "container-synthetic-class";
const className = "Synthetic container check";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function gate() {
  assert.equal(process.env.ECHOCLASS_CONTAINER_TEST, "1", "Explicit isolated-test flag required");
  for (const name of ["DEEPSEEK_API_KEY", "LLM_API_KEY", "ECHOCLASS_GROUNDED_AI_KEY"])
    assert.ok(!process.env[name], "Container check must not receive provider credentials");
}

export function seed() {
  gate();
  assert.equal(readdirSync(directory).length, 0, "Seed refuses any nonempty data directory");
  const session = randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  const db = new DatabaseSync(path.join(directory, "citrus.db"));
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=5000");
    runMigrations(db);
    db.prepare("INSERT INTO classes(id,name,created_at) VALUES(?,?,?)").run(classId, className, now);
    db.prepare(`INSERT INTO users(id,role,username,password_hash,default_password,name,class_name,group_name,status,data_json,created_at)
      VALUES(?,'teacher',?,?,0,?,?,'','active','{}',?)`).run(
      teacherId, teacherId, hashPassword(randomBytes(32).toString("hex")), teacherId, className, now,
    );
    db.prepare("INSERT INTO sessions(sid_hash,user_id,role,created_at,expires_at) VALUES(?,?,'teacher',?,?)")
      .run(digest(session), teacherId, now, Date.now() + 3_600_000);
    const store = new SqliteProvenanceStore(db);
    const fixture = parseStrictJson(readFileSync(path.join(root, "tests/fixtures/scientific/synthetic-envelope.json"), "utf8"));
    for (const input of fixture.canonical_inputs) {
      const original = parseStrictJson(input.canonical_json).record_snapshot;
      const record = { ...original, class_name: className, class_id: classId,
        created_by: teacherId, created_by_user_id: teacherId, created_at: now,
        metadata: { synthetic_container_check: true }, note: "Synthetic packaging check only" };
      for (const field of ["effective_review_id", "review_status", "review_note", "reviewed_at", "reviewed_by", "updated_at"])
        delete record[field];
      store.add(record);
      store.appendReview({ record_id: record.id, reviewer_user_id: teacherId,
        status: "included", note: "Synthetic review for packaging acceptance", reviewed_by: teacherId });
    }
    writeFileSync(marker, JSON.stringify({ schema: "echoclass.container-check.v1", session }), { flag: "wx", mode: 0o600 });
  } finally { db.close(); }
  console.log("CONTAINER_SYNTHETIC_SEED_READY — generated ephemeral credentials; no real observations");
}

function imageContract() {
  assert.equal(process.getuid(), 1000, "Image runtime must use UID 1000");
  assert.equal(process.getgid(), 1000, "Image runtime must use GID 1000");
  assert.equal(process.version, "v24.19.0");
  assert.equal(directory, "/app/data", "Exercise the actual mounted application data directory");
  assert.equal(statSync(root).uid, 0, "Application code stays owned by root");
  for (const relative of [".env", ".env.local", ".git", "dist/tests", "node_modules/typescript", "node_modules/tsx"])
    assert.equal(existsSync(path.join(root, relative)), false, `Unexpected runtime artifact: ${relative}`);
  const mounts = readFileSync("/proc/self/mountinfo", "utf8").split("\n").map((line) => line.split(" "));
  assert.ok(mounts.some((entry) => entry[4] === "/" && entry[5].split(",").includes("ro")), "Root filesystem must be read-only");
  assert.ok(mounts.some((entry) => entry[4] === directory && entry[5].split(",").includes("rw")), "Application data must use a writable volume");
  assert.equal(mounts.some((entry) => corpus.startsWith(`${entry[4]}/`) && !["/", ""].includes(entry[4])), false,
    "The corpus must remain outside runtime volumes");
  assert.notEqual(readFileSync("/proc/1/cmdline", "utf8").split("\0")[0].split("/").at(-1), "node", "Scientific Node supervisor requires --init");
  const pythonCheck = spawnSync(process.env.ECHOCLASS_PYTHON, ["-c", [
    "import importlib.metadata as m, pathlib, sys",
    "assert sys.version_info[:3] == (3, 12, 13)",
    "pins = [line.split('==') for line in pathlib.Path('analytics/requirements.lock').read_text().splitlines() if line and not line.startswith('#')]",
    "assert len(pins) == 31",
    "assert all(m.version(name) == version for name, version in pins)",
  ].join("\n")], { cwd: root, encoding: "utf8", timeout: 15_000 });
  assert.equal(pythonCheck.status, 0, "Exact Python runtime and all 31 pinned package versions must match");
  assert.equal(statSync(marker).mode & 0o777, 0o600, "Synthetic session file must be private");
}

export async function verify({ inspectImage = true, replay = false } = {}) {
  gate();
  if (inspectImage) imageContract();
  const state = parseStrictJson(readFileSync(marker, "utf8"));
  assert.equal(state.schema, "echoclass.container-check.v1");
  const originalCorpus = digest(readFileSync(corpus));
  const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
  const headers = { Cookie: `citrus_sid=${state.session}`, "Content-Type": "application/json" };
  async function request(route, options = {}, expected = 200) {
    const response = await fetch(`${origin}${route}`, { headers, ...options, signal: AbortSignal.timeout(40_000) });
    assert.equal(response.status, expected, `Unexpected HTTP status for ${route}`);
    return response.json();
  }
  const health = await request("/api/health");
  assert.equal(health.storage, "sqlite");
  assert.equal(health.external_provider_configured, false);
  const available = await request(`/api/scientific-runs?class_id=${classId}`);
  assert.equal(available.available, true, "Real supervised Python worker must be ready");
  const command = { class_id: classId, client_request_id: "container-synthetic-run-v1", policy: "approved_only.v1" };
  const created = await request("/api/scientific-runs", { method: "POST", body: JSON.stringify(command) }, replay ? 200 : 202);
  let run = created.run;
  const deadline = Date.now() + 40_000;
  while (run.status === "pending" || run.status === "running") {
    assert.ok(Date.now() < deadline, "Container scientific calculation exceeded deadline");
    await new Promise((resolve) => setTimeout(resolve, 100));
    run = (await request(`/api/scientific-runs/${run.id}`)).run;
  }
  assert.equal(run.status, "completed", "Scientific run must complete, not fall back");
  assert.equal(run.result.selection.included_count, 20);
  assert.deepEqual(run.result.best_tested.concentrations, [1, 3]);
  assert.ok(Math.abs(run.result.candidate.concentration - 2) < 1e-10);
  assert.equal(run.scientific_result_hash, canonicalHash(run.result));
  assert.equal(run.identity.environment.python.version, "3.12.13");
  if (replay) {
    assert.equal(run.id, state.run_id, "Restart must replay the original sealed run");
    assert.equal(run.scientific_result_hash, state.scientific_result_hash);
  }
  const reproduced = await request(`/api/scientific-runs/${run.id}/reproduce`, { method: "POST" });
  assert.equal(reproduced.reproduction.mode, "exact");
  assert.equal(reproduced.reproduction.matches, true);
  const sources = await request(`/api/grounded-runs/${run.id}/sources`, {
    method: "POST", body: JSON.stringify({ question: "bootstrap" }),
  });
  assert.equal(sources.status, "sources_found");
  assert.ok(sources.citations.some((source) => source.chunk_id === "bootstrap"));
  assert.equal(digest(readFileSync(corpus)), originalCorpus, "Runtime must not rewrite the corpus");
  const demo = spawnSync(process.execPath, ["scripts/scientific-demo.mjs", "--json"], {
    cwd: root, encoding: "utf8", timeout: 35_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(demo.status, 0, "Packaged CLI strict result validation must pass");
  const summary = parseStrictJson(demo.stdout);
  assert.match(summary.label, /synthetic_demo/);
  assert.equal(summary.selection.included_count, 20);
  assert.deepEqual(summary.best_tested.concentrations, [1, 3]);
  assert.ok(Math.abs(summary.candidate.concentration - 2) < 1e-10);
  writeFileSync(marker, JSON.stringify({ ...state, run_id: run.id, scientific_result_hash: run.scientific_result_hash }), { mode: 0o600 });
  console.log(JSON.stringify({ check: inspectImage ? "CONTAINER_SCIENTIFIC_PASS" : "SOURCE_SCIENTIFIC_CONTRACT_PASS",
    replay_after_restart: replay, node: process.version, python: run.identity.environment.python.version,
    included_synthetic_records: 20, scientific_result_hash: run.scientific_result_hash,
    environment_fingerprint: run.identity.environment_fingerprint, corpus_sha256: originalCorpus,
    note: "Synthetic packaging acceptance; not independent scientific validation" }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (process.argv.length !== 3 || !["seed", "verify", "replay"].includes(mode))
      throw new Error("Usage: ECHOCLASS_CONTAINER_TEST=1 node scripts/container-verify.mjs seed|verify|replay");
    if (mode === "seed") seed();
    else await verify({ replay: mode === "replay" });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
