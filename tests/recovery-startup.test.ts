import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

for (const mode of ["sqlite", "json"]) {
  test(`startup refuses incomplete restore before any ${mode} storage initialization`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "echoclass-incomplete-restore-"));
    try {
      writeFileSync(path.join(directory, "RESTORE_IN_PROGRESS"), "synthetic interrupted restore\n");
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "import {ensureData} from './dist/src/infrastructure/database/storage.js'; await ensureData();",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            ECHOCLASS_DATA_DIR: directory,
            ECHOCLASS_SEED_DEMO: "0",
            STORAGE_MODE: mode,
          },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Restore is incomplete/);
      assert.deepEqual(readdirSync(directory), ["RESTORE_IN_PROGRESS"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
