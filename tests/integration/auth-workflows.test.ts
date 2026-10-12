import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hashPassword } from "../../src/infrastructure/security/node-security.js";

async function fixture(mode: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "echoclass-auth-http-"));
  await writeFile(
    path.join(directory, "users.json"),
    JSON.stringify([
      {
        id: "synthetic-owner",
        role: "admin",
        username: "owner",
        name: "Synthetic owner",
        class_name: "",
        group_name: "",
        status: "active",
        defaultPassword: false,
        passwordHash: hashPassword("Owner-private-password"),
      },
    ]),
  );
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess;
  async function start() {
    server = spawn(process.execPath, ["dist/src/server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        ECHOCLASS_DATA_DIR: directory,
        STORAGE_MODE: mode,
        ECHOCLASS_SEED_DEMO: "0",
        ECHOCLASS_SCIENTIFIC_ENABLED: "0",
        DEEPSEEK_API_KEY: "",
        LLM_API_KEY: "",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.resume();
    server.stderr?.resume();
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) return;
      } catch {
        // The isolated server may not have bound its port yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Auth fixture did not start");
  }
  async function stop() {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  }
  async function request(route: string, cookie = "", body?: unknown, form = false) {
    return fetch(base + route, {
      redirect: "manual",
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined
          ? {}
          : { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" }),
      },
      body:
        body === undefined
          ? null
          : form
            ? new URLSearchParams(body as Record<string, string>)
            : JSON.stringify(body),
    });
  }
  async function login(role: string, username: string, password: string) {
    const response = await request("/api/auth/login", "", { role, username, password }, true);
    return { response, cookie: (response.headers.get("set-cookie") ?? "").split(";")[0]! };
  }
  await start();
  const owner = await login("admin", "owner", "Owner-private-password");
  assert.equal(owner.response.status, 302);
  async function account(role = "student", username = "new-student") {
    const created = await request("/api/admin/create-user", owner.cookie, {
      role,
      username,
      name: "Synthetic account",
      class_name: "Class A",
      group_name: role === "student" ? "Group A" : "",
      password: "Temporary-private-password",
    });
    assert.equal(created.status, 200, await created.text());
    return login(role, username, "Temporary-private-password");
  }
  return {
    base,
    request,
    login,
    owner,
    account,
    restart: async () => {
      await stop();
      await start();
    },
    close: async () => {
      await stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const mode of ["sqlite", "json"]) {
  test(`${mode}: language persists without scripts and cannot grant classroom access`, async () => {
    const app = await fixture(mode);
    try {
      const initial = await app.request("/");
      assert.equal(initial.headers.get("content-language"), "en");
      assert.match(await initial.text(), /<html lang="en">/);
      const chinese = await app.request("/?lang=zh");
      const locale = (chinese.headers.get("set-cookie") ?? "").split(";")[0]!;
      assert.equal(locale, "echoclass_language=zh");
      assert.match(await chinese.text(), /图表之前/);
      const remembered = await app.request("/engineering", locale);
      assert.equal(remembered.headers.get("content-language"), "zh-CN");
      assert.match(await remembered.text(), /下一次/);
      const override = await app.request("/engineering?lang=en", locale);
      assert.equal(override.headers.get("content-language"), "en");
      assert.match(await override.text(), /Where would you/);
      const trace = await app.request("/walkthrough", locale);
      assert.equal(trace.status, 200);
      assert.equal(trace.headers.get("content-language"), "zh-CN");
      assert.match(await trace.text(), /跟随一条记录/);
      const englishTrace = await app.request("/walkthrough?lang=en", locale);
      assert.equal(englishTrace.headers.get("content-language"), "en");
      assert.match(await englishTrace.text(), /Follow one record/);
      const invalid = await app.request("/?lang=%3Cscript%3E", locale);
      assert.match(await invalid.text(), /<html lang="zh-CN">/);
      const limited = await app.account();
      for (const language of ["en", "zh"]) {
        const denied = await app.request(
          `/api/record-submissions?lang=${language}`,
          limited.cookie + "; " + locale,
        );
        assert.equal(denied.status, 403);
        assert.equal(
          ((await denied.json()) as { error: { code: string } }).error.code,
          "PASSWORD_CHANGE_REQUIRED",
        );
      }
      const failure = await app.request(
        "/api/auth/login?lang=en",
        locale,
        { role: "student", username: "unknown", password: "incorrect" },
        true,
      );
      assert.equal(failure.status, 401);
      assert.match(await failure.text(), /The username or password is incorrect/);
      const out = await app.request("/logout?lang=zh", limited.cookie);
      const cookies = out.headers.getSetCookie();
      assert.ok(cookies.some((cookie) => cookie.startsWith("echoclass_language=zh;")));
      assert.ok(
        cookies.some((cookie) => cookie.startsWith("citrus_sid=;") && cookie.includes("Max-Age=0")),
      );
      assert.equal((await app.request("/api/record-submissions", limited.cookie)).status, 401);
    } finally {
      await app.close();
    }
  });
  test(`${mode}: temporary student, teacher and admin cannot bypass the server password gate`, async () => {
    const app = await fixture(mode);
    try {
      for (const role of ["student", "teacher", "admin"]) {
        const limited = await app.account(role, `new-${role}`);
        assert.equal(limited.response.headers.get("location"), "/account/password");
        const page = await app.request("/account/password", limited.cookie);
        assert.equal(page.headers.get("cache-control"), "no-store");
        assert.match(await page.text(), /Set your own|Temporary password/);
        for (const route of [
          "/api/records?demo=1",
          "/api/record-submissions",
          "/api/analytics",
          "/api/trend-svg",
          "/api/records/reviews",
          "/api/evidence/fake",
          "/api/scientific-analysis",
          "/api/csv/template",
          "/api/practice/results",
        ]) {
          const denied = await app.request(route, limited.cookie);
          assert.equal(denied.status, 403, route);
          const error = (await denied.json()) as { error: { code: string }; request_id: string };
          assert.equal(error.error.code, "PASSWORD_CHANGE_REQUIRED");
          assert.ok(error.request_id);
        }
        for (const route of [
          "/api/records",
          "/api/sync",
          "/api/record-submissions",
          "/api/admin/reset-password",
          "/api/admin/import-users",
          "/api/llm/ask",
          "/api/practice/answer",
          "/api/csv/commit",
          "/api/scientific-analysis",
        ]) {
          const denied = await app.request(route, limited.cookie, {});
          assert.equal(denied.status, 403, route);
          assert.equal(
            ((await denied.json()) as { error: { code: string } }).error.code,
            "PASSWORD_CHANGE_REQUIRED",
          );
        }
        for (const route of ["/submit?demo=1", "/csv", "/scientific-analysis", "/admin/console"]) {
          const denied = await app.request(route, limited.cookie);
          assert.equal(denied.status, 302);
          assert.equal(denied.headers.get("location"), "/account/password");
        }
        assert.equal((await app.request("/engineering", limited.cookie)).status, 200);
        assert.equal((await app.request("/walkthrough", limited.cookie)).status, 200);
      }
    } finally {
      await app.close();
    }
  });

  test(`${mode}: successful native-form change signs out all sessions and requires the new password`, async () => {
    const app = await fixture(mode);
    try {
      const first = await app.account();
      const second = await app.login("student", "new-student", "Temporary-private-password");
      for (const variant of [
        { oldPassword: "wrong-password", newPassword: "New-private-password" },
        { oldPassword: "Temporary-private-password", newPassword: "Temporary-private-password" },
        { oldPassword: "Temporary-private-password", newPassword: "123456" },
        {
          oldPassword: "Temporary-private-password",
          newPassword: "New-private-password",
          confirmPassword: "does-not-match",
        },
      ])
        assert.equal(
          (await app.request("/api/auth/change-password", first.cookie, variant)).status,
          400,
        );
      const changed = await app.request(
        "/api/auth/change-password",
        first.cookie,
        {
          oldPassword: "Temporary-private-password",
          newPassword: "New-private-password",
          confirmPassword: "New-private-password",
        },
        true,
      );
      assert.equal(changed.status, 302);
      assert.equal(changed.headers.get("location"), "/student/login?password=changed");
      assert.match(changed.headers.get("set-cookie") ?? "", /Max-Age=0/);
      for (const cookie of [first.cookie, second.cookie])
        assert.equal((await app.request("/api/record-submissions", cookie)).status, 401);
      assert.equal(
        (await app.login("student", "new-student", "Temporary-private-password")).response.status,
        401,
      );
      const unrestricted = await app.login("student", "new-student", "New-private-password");
      assert.equal(unrestricted.response.headers.get("location"), "/submit");
      assert.equal((await app.request("/api/record-submissions", unrestricted.cookie)).status, 200);
      await app.restart();
      for (const cookie of [first.cookie, second.cookie])
        assert.equal((await app.request("/api/record-submissions", cookie)).status, 401);
      const fresh = await app.login("student", "new-student", "New-private-password");
      assert.equal((await app.request("/api/record-submissions", fresh.cookie)).status, 200);
    } finally {
      await app.close();
    }
  });

  test(`${mode}: administrator reset and explicit import revoke existing sessions and reinstate the gate`, async () => {
    const app = await fixture(mode);
    try {
      const limited = await app.account();
      const changed = await app.request("/api/auth/change-password", limited.cookie, {
        oldPassword: "Temporary-private-password",
        newPassword: "New-private-password",
      });
      assert.equal(changed.status, 200);
      assert.equal(((await changed.json()) as { login_url: string }).login_url, "/student/login");
      const active = await app.login("student", "new-student", "New-private-password");
      const reset = await app.request("/api/admin/reset-password", app.owner.cookie, {
        username: "new-student",
      });
      assert.equal(reset.status, 200);
      const password = ((await reset.json()) as { temporary_password: string }).temporary_password;
      assert.equal((await app.request("/api/record-submissions", active.cookie)).status, 401);
      const resetSession = await app.login("student", "new-student", password);
      assert.equal(resetSession.response.headers.get("location"), "/account/password");
      const imported = await app.request("/api/admin/import-users", app.owner.cookie, {
        text: "student\tnew-student\tSynthetic\tClass A\tGroup A\tImported-private-password",
      });
      assert.equal(imported.status, 200);
      assert.equal(
        (
          await app.request("/api/auth/change-password", resetSession.cookie, {
            oldPassword: password,
            newPassword: "Another-private-password",
          })
        ).status,
        401,
      );
      const newImport = await app.login("student", "new-student", "Imported-private-password");
      assert.equal(newImport.response.headers.get("location"), "/account/password");
      assert.equal((await app.request("/api/record-submissions", app.owner.cookie)).status, 200);
    } finally {
      await app.close();
    }
  });
}
