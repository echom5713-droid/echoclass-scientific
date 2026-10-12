import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ExperimentRecord } from "../../src/domain/types.js";
import { DEMO_RECORDS } from "../../src/shared/demo-records.js";
import { views } from "../../src/views/legacy-view-adapter.js";

test("authenticated demo trends remain synthetic while classroom trends keep class scope", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "echoclass-demo-trend-"));
  const port = 47_000 + (process.pid % 1_000);
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  try {
    server = spawn(process.execPath, ["dist/src/server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        ECHOCLASS_DATA_DIR: dataDirectory,
        ECHOCLASS_SEED_DEMO: "1",
        ECHOCLASS_SCIENTIFIC_ENABLED: "0",
        ECHOCLASS_GROUNDED_AI_ENABLED: "0",
        DEEPSEEK_API_KEY: "",
        LLM_API_KEY: "",
        STORAGE_MODE: "sqlite",
        NODE_ENV: "test",
      },
      stdio: "ignore",
    });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        ready = (await fetch(`${base}/api/health`)).ok;
        if (ready) break;
      } catch {
        // Disposable real HTTP server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "disposable server starts");
    async function login(role: string, username: string): Promise<string> {
      const response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ role, username, password: "123456" }),
      });
      assert.equal(response.status, 302);
      return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    }
    const admin = await login("admin", "admin");
    const teacher = await login("teacher", "teacher001");
    for (const className of ["演示化学班", "Synthetic other class"]) {
      const response = await fetch(`${base}/api/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: admin },
        body: JSON.stringify({
          student_name: "Synthetic trend observation",
          class_name: className,
          group_name: "Synthetic trend group",
          nh4cl_concentration: 1,
          peel_mass: 100,
          oil_mass: 1.11,
          distillation_time: 45,
          phase_clarity_score: 4,
          emulsification_level: "轻微乳化",
          emulsion_concentration: 20,
          ecoli_observation_group: "精油乳液组",
          inhibition_zone_diameter: 10,
          colony_growth_score: 3,
          异常标记: false,
          error_source: "",
          note: "synthetic integration fixture",
        }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { record: { id: string } };
      const review = await fetch(`${base}/api/records/manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: admin },
        body: JSON.stringify({ id: body.record.id, action: "include", note: "Synthetic fixture" }),
      });
      assert.equal(review.status, 200);
    }
    const expectedDemo = views.trendSvg([...DEMO_RECORDS], 3, null);
    for (const cookie of [teacher, admin]) {
      for (const query of ["demo=1", "mode=demo"]) {
        const response = await fetch(`${base}/api/trend-svg?${query}`, {
          headers: { Cookie: cookie },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(await response.text(), expectedDemo, `${query} ignores authenticated records`);
      }
    }
    const scopedRecords = await fetch(`${base}/api/records`, { headers: { Cookie: teacher } });
    const { records } = (await scopedRecords.json()) as { records: ExperimentRecord[] };
    assert.ok(records.every((record) => record.class_name === "演示化学班"));
    const ordinary = await fetch(`${base}/api/trend-svg`, { headers: { Cookie: teacher } });
    const ordinarySvg = await ordinary.text();
    assert.equal(ordinarySvg, views.trendSvg(records, 3, null));
    assert.notEqual(ordinarySvg, expectedDemo, "classroom response reflects the private fixture");
    const adminSvg = await (
      await fetch(`${base}/api/trend-svg`, { headers: { Cookie: admin } })
    ).text();
    assert.notEqual(adminSvg, ordinarySvg, "teacher response excludes the second class");
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server!.once("exit", resolve));
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
