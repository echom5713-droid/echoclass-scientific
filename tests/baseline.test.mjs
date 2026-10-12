import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function text(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("package and runtime identity are aligned", async () => {
  const pkg = JSON.parse(await text("package.json"));
  const server = await text("src/server.ts");
  const constants = await text("src/config/constants.ts");
  assert.equal(pkg.name, "echoclass");
  assert.equal(pkg.version, "3.0.0-beta.25");
  assert.match(constants, /APP_VERSION = ["']3\.0\.0-beta\.25["']/);
  assert.match(constants, /APP_NAME = ["']echoclass["']/);
  assert.match(server, /server\.started/);
});

test("runtime and secret files are ignored", async () => {
  const ignore = await text(".gitignore");
  for (const rule of [
    ".env.*",
    "!.env.example",
    "data/*.db",
    "data/*.db-wal",
    "data/*.db-shm",
    "uploads/",
    "backups/",
    "coverage/",
    "dist/",
    "__pycache__/",
    ".pytest_cache/",
    "*.log",
  ]) assert.ok(ignore.includes(rule), `missing ignore rule: ${rule}`);
});

test("smoke verification uses isolated disposable runtime data", async () => {
  const smoke = await text("scripts/smoke-test.mjs");
  assert.match(smoke, /mkdtemp/);
  assert.match(smoke, /ECHOCLASS_DATA_DIR/);
  assert.match(smoke, /ECHOCLASS_SEED_DEMO/);
  assert.match(smoke, /rm\(/);
});

test("sample data is anonymous and explicitly synthetic", async () => {
  const csv = await text("data/sample/nh4cl_yield.csv");
  assert.match(csv, /synthetic_demo/);
  assert.doesNotMatch(csv, /[\u4e00-\u9fff]{2,4}(?:同学|老师)?/);
});

test("fabricated analytics offsets and unsafe model rendering are absent", async () => {
  const pages = await text("src/views/pages.js");
  const client = await text("public/client.js");
  assert.doesNotMatch(pages, /\.length\s*\+\s*[124]/);
  assert.doesNotMatch(pages, /Digital Twin|数字孪生/);
  assert.doesNotMatch(client, /data\.answer\.replace\(\/\\n\/g/);
  assert.match(client, /escapeHtml\(data\.answer\)/);
  assert.doesNotMatch(client, /ai_diagnosis\.replace\(\/\\n\/g/);
  assert.match(client, /await import\('\/static\/offline-submission\.js'\)/);
  assert.doesNotMatch(client, /citrus_offline_(?:records|id_map)/);
});

test("source baseline contains no provider-shaped key", async () => {
  const forbidden = new Set([".env", "citrus.db", "citrus.db-wal", "citrus.db-shm", "records.json", "users.json", "practice_answers.json"]);
  const keyPattern = /\bsk-[A-Za-z0-9_-]{20,}\b/;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const relative = path.relative(root, full).replaceAll("\\", "/");
        if (forbidden.has(entry.name)) continue;
        const statText = await readFile(full).catch(() => null);
        if (statText && statText.length < 5_000_000) assert.doesNotMatch(statText.toString("utf8"), keyPattern, `provider-shaped key in ${relative}`);
      }
    }
  }
  await walk(root);
});
