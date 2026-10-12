import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const port = 43_000 + (process.pid % 1_000);
const base = `http://127.0.0.1:${port}`;
let server: ChildProcess;
let dataDirectory = "";

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("integration server did not start");
}

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function login(
  role: string,
  username: string,
): Promise<{ response: Response; cookie: string }> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ role, username, password: "123456" }),
  });
  return { response, cookie: cookieFrom(response) };
}

function scientificPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    student_name: "Synthetic Student",
    class_name: "演示化学班",
    group_name: "G1",
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
    note: "integration",
    ...overrides,
  };
}

before(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "echoclass-m1-"));
  server = spawn(process.execPath, ["dist/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ECHOCLASS_DATA_DIR: dataDirectory,
      ECHOCLASS_SEED_DEMO: "1",
      DEEPSEEK_API_KEY: "",
      LLM_API_KEY: "",
      STORAGE_MODE: "sqlite",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

test("student, teacher, and admin login workflows remain compatible", async () => {
  const student = await login("student", "student001");
  const teacher = await login("teacher", "teacher001");
  const admin = await login("admin", "admin");
  assert.equal(student.response.status, 302);
  assert.equal(student.response.headers.get("location"), "/submit");
  assert.equal(teacher.response.status, 302);
  assert.equal(teacher.response.headers.get("location"), "/admin");
  assert.equal(admin.response.status, 302);
  assert.equal(admin.response.headers.get("location"), "/admin/console");
});

test("record creation/retrieval works and cross-class access is denied", async () => {
  const admin = await login("admin", "admin");
  const student = await login("student", "student001");
  const teacher = await login("teacher", "teacher001");
  const payload = scientificPayload({
    student_name: "Synthetic Other",
    class_name: "Other Class",
  });
  const created = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify(payload),
  });
  assert.equal(created.status, 200);
  const createdBody = (await created.json()) as { record: { id: string } };
  const otherClassId = createdBody.record.id;

  for (const loginResult of [student, teacher]) {
    const listing = await fetch(`${base}/api/records`, { headers: { Cookie: loginResult.cookie } });
    const body = (await listing.json()) as { records: Array<{ id: string }> };
    assert.equal(
      body.records.some((record) => record.id === otherClassId),
      false,
    );
    const manage = await fetch(`${base}/api/records/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: loginResult.cookie },
      body: JSON.stringify({ id: otherClassId, action: "exclude" }),
    });
    assert.equal(manage.status, 403);
    const error = (await manage.json()) as { error: { code: string }; request_id: string };
    assert.equal(error.error.code, "FORBIDDEN");
    assert.ok(error.request_id);
  }

  const ownCreate = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: student.cookie },
    body: JSON.stringify({ ...payload, id: "client-controlled-id", class_name: "Other Class" }),
  });
  assert.equal(ownCreate.status, 200);
  const ownBody = (await ownCreate.json()) as { record: { id: string; class_name: string } };
  assert.equal(ownBody.record.class_name, "演示化学班");
  assert.notEqual(ownBody.record.id, "client-controlled-id");
});

test("HTTP submission preserves complete measurement provenance through database reads", async () => {
  const student = await login("student", "student001");
  const response = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: student.cookie },
    body: JSON.stringify(
      scientificPayload({
        experiment_date: "2026-08-20",
        petri_diameter_mm: 90,
        measurement_method: "manual_local_image_calibrated",
        measurement_image_state: "calibrated_complete",
      }),
    ),
  });
  assert.equal(response.status, 200);
  const created = (await response.json()) as {
    record: {
      id: string;
      experiment_date?: string;
      petri_diameter_mm?: number;
      measurement_method?: string;
    };
  };
  assert.equal(created.record.experiment_date, "2026-08-20");
  assert.equal(created.record.petri_diameter_mm, 90);
  assert.equal(created.record.measurement_method, "manual_local_image_calibrated");

  const listing = await fetch(`${base}/api/records`, { headers: { Cookie: student.cookie } });
  const records = (
    (await listing.json()) as {
      records: Array<{
        id: string;
        experiment_date?: string;
        petri_diameter_mm?: number;
        measurement_method?: string;
      }>;
    }
  ).records;
  const read = records.find((record) => record.id === created.record.id);
  assert.equal(read?.experiment_date, "2026-08-20");
  assert.equal(read?.petri_diameter_mm, 90);
  assert.equal(read?.measurement_method, "manual_local_image_calibrated");
});

test("actual browser form defaults do not claim image-calibrated measurement", async () => {
  const student = await login("student", "student001");
  const page = await fetch(`${base}/submit`, { headers: { Cookie: student.cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  const diameter = html.match(/name="petri_diameter_mm"[^>]*value="([^"]+)"/)?.[1];
  assert.equal(diameter, "90");
  const response = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: student.cookie },
    body: JSON.stringify(scientificPayload({ petri_diameter_mm: diameter })),
  });
  assert.equal(response.status, 200);
  const created = (await response.json()) as { record: { measurement_method?: string } };
  assert.equal(created.record.measurement_method, "manual_direct");
});

test("client ID collision cannot replace or move an existing record", async () => {
  const adminLogin = await login("admin", "admin");
  const studentLogin = await login("student", "student001");
  const originalResponse = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminLogin.cookie },
    body: JSON.stringify(scientificPayload({ class_name: "Private Class B", note: "immutable" })),
  });
  assert.equal(originalResponse.status, 200);
  const original = (await originalResponse.json()) as { record: Record<string, unknown> };
  const id = String(original.record.id);

  const attack = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentLogin.cookie },
    body: JSON.stringify(scientificPayload({ id, note: "replacement attempt" })),
  });
  assert.equal(attack.status, 200);
  const attackBody = (await attack.json()) as { record: { id: string } };
  assert.notEqual(attackBody.record.id, id);

  const listing = await fetch(`${base}/api/records`, { headers: { Cookie: adminLogin.cookie } });
  const records = ((await listing.json()) as { records: Array<Record<string, unknown>> }).records;
  const preserved = records.find((record) => record.id === id);
  assert.deepEqual(preserved, original.record);
});

test("protected review/audit fields are rejected and student identity is session-derived", async () => {
  const studentLogin = await login("student", "student001");
  for (const [field, value] of [
    ["review_status", "included"],
    ["reviewed_by", "admin"],
    ["reviewed_at", "2099-01-01T00:00:00.000Z"],
    ["review_note", "forged"],
    ["created_by", "admin"],
    ["created_at", "2099-01-01T00:00:00.000Z"],
    ["updated_at", "2099-01-01T00:00:00.000Z"],
    ["ai_diagnosis", "approved"],
    ["yield_percent", 99],
  ] as const) {
    const response = await fetch(`${base}/api/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: studentLogin.cookie },
      body: JSON.stringify(scientificPayload({ [field]: value })),
    });
    assert.equal(response.status, 400, `${field} must be rejected`);
    const body = (await response.json()) as {
      error: { code: string; fields: Array<{ field: string }> };
    };
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.ok(body.error.fields.some((finding) => finding.field === field));
  }

  const identity = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentLogin.cookie },
    body: JSON.stringify(
      scientificPayload({
        student_name: "Forged Name",
        class_name: "Forged Class",
        group_name: "Forged Group",
      }),
    ),
  });
  assert.equal(identity.status, 200);
  const identityBody = (await identity.json()) as {
    record: { student_name: string; class_name: string; group_name: string; review_status: string };
  };
  assert.equal(identityBody.record.student_name, "演示学生 01");
  assert.equal(identityBody.record.class_name, "演示化学班");
  assert.equal(identityBody.record.group_name, "演示 3 组");
  assert.notEqual(identityBody.record.review_status, "included");
});

test("authorized review history is append-only and students cannot create it", async () => {
  const studentLogin = await login("student", "student001");
  const teacherLogin = await login("teacher", "teacher001");
  const created = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentLogin.cookie },
    body: JSON.stringify(scientificPayload()),
  });
  assert.equal(created.status, 200);
  const recordId = ((await created.json()) as { record: { id: string } }).record.id;
  const manage = (cookie: string, action: string, note: string) =>
    fetch(`${base}/api/records/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ id: recordId, action, note }),
    });
  assert.equal((await manage(studentLogin.cookie, "include", "forged")).status, 403);
  assert.equal((await manage(teacherLogin.cookie, "include", "first")).status, 200);
  assert.equal((await manage(teacherLogin.cookie, "exclude", "second")).status, 200);
  const response = await fetch(`${base}/api/records/reviews?id=${encodeURIComponent(recordId)}`, {
    headers: { Cookie: teacherLogin.cookie },
  });
  assert.equal(response.status, 200);
  const history = (await response.json()) as {
    reviews: Array<{ status: string; note: string }>;
  };
  assert.deepEqual(
    history.reviews.map((review) => [review.status, review.note]),
    [
      ["included", "first"],
      ["excluded", "second"],
    ],
  );

  assert.equal((await manage(teacherLogin.cookie, "delete", "archive after review")).status, 200);
  const archivedHistory = await fetch(
    `${base}/api/records/reviews?id=${encodeURIComponent(recordId)}`,
    { headers: { Cookie: teacherLogin.cookie } },
  );
  assert.equal(archivedHistory.status, 200);
  const archivedBody = (await archivedHistory.json()) as {
    reviews: Array<{ status: string; note: string }>;
  };
  assert.deepEqual(
    archivedBody.reviews.map((review) => [review.status, review.note]),
    [
      ["included", "first"],
      ["excluded", "second"],
    ],
  );
  const forbiddenHistory = await fetch(
    `${base}/api/records/reviews?id=${encodeURIComponent(recordId)}`,
    { headers: { Cookie: studentLogin.cookie } },
  );
  assert.equal(forbiddenHistory.status, 403);
});

test("scientific transport parsing is strict and booleans/yield are server-derived", async () => {
  const studentLogin = await login("student", "student001");
  const numericFields = [
    "nh4cl_concentration",
    "peel_mass",
    "oil_mass",
    "distillation_time",
    "phase_clarity_score",
    "emulsion_concentration",
    "inhibition_zone_diameter",
    "colony_growth_score",
  ];
  for (const field of numericFields) {
    for (const payload of [
      scientificPayload({ [field]: "not-a-number" }),
      (() => {
        const missing = scientificPayload();
        delete missing[field];
        return missing;
      })(),
    ]) {
      const response = await fetch(`${base}/api/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: studentLogin.cookie },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 400, `${field} must be strictly required and numeric`);
    }
  }

  const falseFlag = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentLogin.cookie },
    body: JSON.stringify(scientificPayload({ 异常标记: "false", peel_mass: 50, oil_mass: 0.5 })),
  });
  assert.equal(falseFlag.status, 200);
  const body = (await falseFlag.json()) as { record: { 异常标记: boolean; yield_percent: number } };
  assert.equal(body.record.异常标记, false);
  assert.equal(body.record.yield_percent, 1);
});

test("offline idempotency returns canonical ID mappings and remains scoped to actor", async () => {
  const firstStudent = await login("student", "student001");
  const secondStudent = await login("student", "student002");
  const payload = scientificPayload({ client_submission_id: "offline-001" });
  const sync = (cookie: string) =>
    fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ records: [payload] }),
    });
  const first = (await (await sync(firstStudent.cookie)).json()) as {
    added: number;
    records: Array<{ client_submission_id: string; record_id: string; created: boolean }>;
  };
  const duplicate = (await (await sync(firstStudent.cookie)).json()) as {
    added: number;
    records: Array<{ client_submission_id: string; record_id: string; created: boolean }>;
  };
  const otherActor = (await (await sync(secondStudent.cookie)).json()) as { added: number };
  assert.equal(first.added, 1);
  assert.equal(duplicate.added, 0);
  assert.equal(otherActor.added, 1);
  assert.equal(first.records[0]?.client_submission_id, "offline-001");
  assert.notEqual(first.records[0]?.record_id, "offline-001");
  assert.equal(first.records[0]?.created, true);
  assert.equal(duplicate.records[0]?.record_id, first.records[0]?.record_id);
  assert.equal(duplicate.records[0]?.created, false);

  const listing = await fetch(`${base}/api/records`, { headers: { Cookie: firstStudent.cookie } });
  const records = (
    (await listing.json()) as { records: Array<{ id: string; metadata?: Record<string, unknown> }> }
  ).records;
  const offline = records.find((record) => record.metadata?.client_submission_id === "offline-001");
  assert.ok(offline);
  assert.notEqual(offline.id, "offline-001");
});

test("browser-compatible password change and generated administrator reset both work", async () => {
  const adminLogin = await login("admin", "admin");
  const username = "closure-user";
  const create = await fetch(`${base}/api/admin/create-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminLogin.cookie },
    body: JSON.stringify({
      role: "student",
      username,
      name: "Closure User",
      class_name: "演示化学班",
      group_name: "Closure Group",
      password: "Temporary-A1!",
    }),
  });
  assert.equal(create.status, 200);
  const initial = await login("student", username);
  assert.equal(initial.response.status, 401, "login helper uses demo password and must not work");
  const loginResponse = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ role: "student", username, password: "Temporary-A1!" }),
  });
  assert.equal(loginResponse.status, 302);
  const userCookie = cookieFrom(loginResponse);
  const changed = await fetch(`${base}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: userCookie },
    body: JSON.stringify({ oldPassword: "Temporary-A1!", newPassword: "Changed-A2!" }),
  });
  assert.equal(changed.status, 200);

  const reset = await fetch(`${base}/api/admin/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminLogin.cookie },
    body: JSON.stringify({ username }),
  });
  assert.equal(reset.status, 200);
  const resetBody = (await reset.json()) as { temporary_password: string };
  assert.ok(resetBody.temporary_password.length >= 12);
  assert.notEqual(resetBody.temporary_password, "123456");
  const resetLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      role: "student",
      username,
      password: resetBody.temporary_password,
    }),
  });
  assert.equal(resetLogin.status, 302);
});

test("public pages remain immutable demo views when private records change", async () => {
  const before = await (await fetch(`${base}/theme`)).text();
  const adminLogin = await login("admin", "admin");
  const created = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminLogin.cookie },
    body: JSON.stringify(scientificPayload({ class_name: "Private Analytics Class", oil_mass: 9 })),
  });
  assert.equal(created.status, 200);
  const after = await (await fetch(`${base}/theme`)).text();
  assert.equal(after, before);

  const authorized = await fetch(`${base}/api/records`, { headers: { Cookie: adminLogin.cookie } });
  const records = ((await authorized.json()) as { records: Array<{ class_name: string }> }).records;
  assert.ok(records.some((record) => record.class_name === "Private Analytics Class"));
});

test("operational metadata is protected and public provider status is minimal", async () => {
  const guestMetrics = await fetch(`${base}/api/metrics`);
  assert.equal(guestMetrics.status, 401);

  const status = (await (await fetch(`${base}/api/llm/status`)).json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(status).sort(), ["configured", "model", "ok", "provider"]);
  assert.equal("base" in status, false);
  assert.equal("timeoutMs" in status, false);

  const adminLogin = await login("admin", "admin");
  const adminMetrics = await fetch(`${base}/api/metrics`, {
    headers: { Cookie: adminLogin.cookie },
  });
  assert.equal(adminMetrics.status, 200);

  const health = (await (await fetch(`${base}/api/health`)).json()) as {
    processStartedAt?: string;
    buildTime?: string;
    security: { login_rate_limit: boolean };
    optional_external_provider?: boolean;
  };
  assert.ok(health.processStartedAt);
  assert.equal(health.buildTime, undefined);
  assert.equal(health.security.login_rate_limit, true);
  assert.equal(health.optional_external_provider, true);
});

test("fallback-mode health does not claim absent login throttling", async () => {
  const fallbackPort = port + 1;
  const fallbackData = await mkdtemp(path.join(os.tmpdir(), "echoclass-m1-fallback-"));
  const fallback = spawn(process.execPath, ["dist/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(fallbackPort),
      ECHOCLASS_DATA_DIR: fallbackData,
      ECHOCLASS_SEED_DEMO: "1",
      DEEPSEEK_API_KEY: "",
      LLM_API_KEY: "",
      STORAGE_MODE: "json",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let health: Response | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        health = await fetch(`http://127.0.0.1:${fallbackPort}/api/health`);
        if (health.ok) break;
      } catch {
        // Starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(health?.ok);
    const body = (await health.json()) as {
      storage: string;
      security: { login_rate_limit: boolean };
    };
    assert.equal(body.storage, "local-json-adapter");
    assert.equal(body.security.login_rate_limit, false);
  } finally {
    fallback.kill("SIGTERM");
    await new Promise((resolve) => fallback.once("exit", resolve));
    await rm(fallbackData, { recursive: true, force: true });
  }
});

test("AI endpoint provides a safe local fallback when provider is unavailable", async () => {
  const response = await fetch(`${base}/api/llm/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "NH₄Cl 为什么有盐析作用？", scene: "preview" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { answer: string; mode: string; reason: string };
  assert.equal(body.mode, "local-fallback");
  assert.equal(body.reason, "missing_api_key");
  assert.ok(body.answer.length > 10);
});

test("public project and engineering pages are identical across account scopes", async () => {
  const teacher = await login("teacher", "teacher001");
  for (const route of ["/", "/engineering"]) {
    const guest = await fetch(`${base}${route}`);
    const signedIn = await fetch(`${base}${route}`, { headers: { Cookie: teacher.cookie } });
    assert.equal(guest.status, 200);
    assert.equal(signedIn.status, 200);
    const html = await guest.text();
    assert.equal(await signedIn.text(), html);
    assert.match(html, /synthetic/i);
    assert.doesNotMatch(html, /演示教师|Private Analytics Class|\son[a-z]+\s*=/i);
    if (route === "/engineering") {
      assert.deepEqual(html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g), [
        '<script type="module" src="/static/followup-design.js"></script>',
      ]);
    } else {
      assert.doesNotMatch(html, /<script/);
    }
  }
  const classroom = await fetch(`${base}/classroom`);
  assert.equal(classroom.status, 200);
  assert.match(await classroom.text(), /柑橘精油综合探究平台/);
});
