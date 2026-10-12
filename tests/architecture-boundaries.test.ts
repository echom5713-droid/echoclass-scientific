import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
const root = path.resolve(process.cwd(), "src");

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(full)));
    else if (!entry.name.endsWith(".d.ts") && /\.(?:ts|js)$/.test(entry.name)) result.push(full);
  }
  return result;
}

function importedLayers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

test("source layers obey the dependency-direction gate", async () => {
  const forbidden: string[] = [];
  for (const file of await sourceFiles(root)) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (relative === "server.ts") continue;
    const layer = relative.split("/")[0] ?? "";
    const imports = importedLayers(await readFile(file, "utf8"));
    for (const imported of imports) {
      const normalized = path.posix.normalize(
        path.posix.join(path.posix.dirname(relative), imported),
      );
      const target = normalized.split("/")[0] ?? "";
      const invalid =
        (layer === "domain" &&
          ["application", "http", "infrastructure", "views"].includes(target)) ||
        (layer === "application" && ["http", "infrastructure", "views"].includes(target)) ||
        (layer === "infrastructure" && ["http", "views"].includes(target)) ||
        (layer === "http" && target === "infrastructure");
      if (invalid) forbidden.push(`${relative} -> ${imported}`);
    }
  }
  assert.deepEqual(forbidden, []);
});

test("HTTP routes delegate class summary, analytics, practice, and admin queries", async () => {
  const aiRoutes = await readFile(path.join(root, "http/routes/ai-routes.ts"), "utf8");
  const experimentRoutes = await readFile(
    path.join(root, "http/routes/experiment-routes.ts"),
    "utf8",
  );
  const pageRoutes = await readFile(path.join(root, "http/routes/page-routes.ts"), "utf8");
  const router = await readFile(path.join(root, "http/router.ts"), "utf8");
  const storage = await readFile(path.join(root, "infrastructure/database/storage.js"), "utf8");

  assert.doesNotMatch(aiRoutes, /meanYield|correctCount|auditClassSummary|prompt\s*=/);
  assert.doesNotMatch(experimentRoutes, /views\.analyticsFor/);
  assert.doesNotMatch(pageRoutes, /UserRepository|users\.findAll/);
  assert.doesNotMatch(router, /JsonPracticeRepository|audit\.write/);
  assert.doesNotMatch(storage, /views\/pages/);
});

test("record creation is insert-only and ordinary deletion is provenance-preserving", async () => {
  const storage = await readFile(path.join(root, "infrastructure/database/storage.js"), "utf8");
  const provenance = await readFile(
    path.join(root, "infrastructure/database/sqlite-provenance-store.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    storage + provenance,
    /INSERT OR REPLACE INTO (?:records|experiment_records)/,
  );
  assert.match(provenance, /INSERT INTO experiment_records/);
  assert.match(provenance, /UPDATE experiment_records SET/);
  assert.match(provenance, /SET status='deleted'/);
  assert.doesNotMatch(provenance, /DELETE FROM experiment_records WHERE id = \?/);
});

test("legacy views remain rendering-only compatibility code", async () => {
  const pages = await readFile(path.join(root, "views/pages.js"), "utf8");
  const adapter = await readFile(path.join(root, "views/legacy-view-adapter.ts"), "utf8");
  assert.doesNotMatch(
    pages,
    /infrastructure|database\/storage|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/,
  );
  assert.doesNotMatch(pages, /hasRole|canAccessClass|canReviewRecord|canCreateRecord/);
  assert.doesNotMatch(
    pages,
    /function\s+(?:analyticsFor|groupStats|quadraticFit|stddev|yieldPercentFor|recordDiagnostics)\b/,
  );
  assert.match(pages, /domain\/experiments\/analytics/);
  assert.match(adapter, /legacy/);
});
