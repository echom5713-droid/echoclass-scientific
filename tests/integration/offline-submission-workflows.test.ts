import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const record = {
  student_name: "Synthetic untrusted name",
  class_name: "Synthetic untrusted class",
  group_name: "Synthetic untrusted group",
  nh4cl_concentration: 3,
  peel_mass: 100,
  oil_mass: 1,
  distillation_time: 45,
  phase_clarity_score: 4,
  emulsification_level: "轻微乳化",
  emulsion_concentration: 20,
  ecoli_observation_group: "精油乳液组",
  inhibition_zone_diameter: 10,
  colony_growth_score: 3,
  异常标记: false,
  error_source: "",
  note: "Synthetic outbox test; not experimental observations",
};

test("account-bound outbox uses real HTTP identity, durable idempotency and revocation checks", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-outbox-"));
  const base = `http://127.0.0.1:${50_000 + (process.pid % 1000)}`;
  let server: ChildProcess | undefined;
  try {
    server = spawn(process.execPath, ["dist/src/server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: new URL(base).port,
        ECHOCLASS_DATA_DIR: directory,
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
        // Disposable HTTP server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    async function login(username: string): Promise<string> {
      const response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ role: "student", username, password: "123456" }),
      });
      assert.equal(response.status, 302);
      return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    }
    const cookie = await login("student001");
    const peer = await login("student002");
    const identity = await fetch(`${base}/api/record-submissions`, { headers: { Cookie: cookie } });
    assert.equal(identity.status, 200);
    assert.equal(identity.headers.get("cache-control"), "no-store");
    const { context } = (await identity.json()) as { context: Record<string, string> };
    const body = {
      context,
      record: {
        ...record,
        client_submission_id: "submission-12345678-1234-1234-1234-123456789012",
      },
    };
    const post = (value: unknown, actor = cookie, extra: Record<string, string> = {}) =>
      fetch(`${base}/api/record-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: actor, ...extra },
        body: JSON.stringify(value),
      });
    const records = async () => {
      const response = await fetch(`${base}/api/records`, { headers: { Cookie: peer } });
      return ((await response.json()) as { records: Array<Record<string, unknown>> }).records;
    };

    await t.test(
      "a lost first receipt and repeated retries resolve to one server-owned record",
      async () => {
        const before = (await records()).length;
        const initial = await post(body);
        assert.equal(initial.status, 200);
        await initial.body?.cancel(); // Intentionally discard the first receipt after commit.
        const replay = await post(body);
        const data = (await replay.json()) as {
          added: number;
          records: Array<{ record_id: string; client_submission_id: string; created: boolean }>;
        };
        assert.equal(replay.status, 200);
        assert.equal(data.added, 0);
        assert.equal(data.records[0]?.created, false);
        const all = await records();
        assert.equal(all.length, before + 1);
        const stored = all.find((item) => item.id === data.records[0]?.record_id);
        assert.equal(stored?.student_name, context.name);
        assert.equal(stored?.class_name, context.class_name);
        assert.equal(stored?.group_name, context.group_name);
        assert.equal(stored?.client_submission_id, body.record.client_submission_id);
      },
    );

    await t.test(
      "another account, changed class and cross-site requests fail without writes",
      async () => {
        const before = (await records()).length;
        assert.equal((await post(body, peer)).status, 409);
        assert.equal(
          (await post({ ...body, context: { ...context, class_name: "Wrong class" } })).status,
          409,
        );
        assert.equal(
          (await post(body, cookie, { Origin: "https://untrusted.invalid" })).status,
          403,
        );
        assert.equal((await records()).length, before);
      },
    );

    await t.test(
      "missing identity, invalid input, demo payload and oversized body fail explicitly",
      async () => {
        const before = (await records()).length;
        assert.equal((await fetch(`${base}/api/record-submissions`)).status, 401);
        assert.equal((await post(body, "")).status, 401);
        assert.equal((await post({ record: body.record })).status, 409);
        assert.equal(
          (await post({ ...body, record: { ...body.record, mode: "demo" } })).status,
          400,
        );
        const invalid = await post({
          ...body,
          record: { ...body.record, client_submission_id: "new-invalid-number", peel_mass: "NaN" },
        });
        assert.equal(invalid.status, 400);
        assert.match(
          ((await invalid.json()) as { error: { message: string } }).error.message,
          /验证/,
        );
        assert.equal((await post({ ...body, extra: "x".repeat(70 * 1024) })).status, 413);
        assert.equal((await records()).length, before);
      },
    );

    await t.test(
      "logout while a body is streaming prevents persistence under the old session",
      async () => {
        const before = (await records()).length;
        const raw = JSON.stringify({
          ...body,
          record: { ...body.record, client_submission_id: "slow-body-revocation" },
        });
        let finishBody: (() => void) | undefined;
        const result = new Promise<number>((resolve, reject) => {
          const pending = request(
            `${base}/api/record-submissions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookie,
                "Content-Length": Buffer.byteLength(raw),
              },
            },
            (response) => {
              response.resume();
              response.once("end", () => resolve(response.statusCode ?? 0));
            },
          );
          pending.once("error", reject);
          pending.write(raw.slice(0, 10));
          finishBody = () => pending.end(raw.slice(10));
        });
        const logout = await fetch(`${base}/logout`, {
          headers: { Cookie: cookie },
          redirect: "manual",
        });
        assert.equal(logout.status, 302);
        finishBody?.();
        assert.equal(await result, 401);
        assert.equal((await records()).length, before);
      },
    );
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server!.once("exit", resolve));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
