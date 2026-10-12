import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), "echoclass-smoke-"));
process.env.PORT = process.env.PORT || String(3100 + Math.floor(Math.random() * 4000));
process.env.ECHOCLASS_DATA_DIR = runtimeDirectory;
process.env.ECHOCLASS_SEED_DEMO = "1";
process.env.STORAGE_MODE = "json";

const timeout = setTimeout(() => {
  console.error("SMOKE_TEST_TIMEOUT");
  process.exit(2);
}, 25_000);

await import("../dist/src/server.js");
const basePort = Number(process.env.PORT);

function request(requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const headers = { Connection: "close", ...(options.headers || {}) };
    if (body && !headers["Content-Length"])
      headers["Content-Length"] = Buffer.byteLength(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: basePort,
        path: requestPath,
        method: options.method || "GET",
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.setTimeout(5_000, () => req.destroy(new Error(`request timeout: ${requestPath}`)));
    req.on("error", reject);
    req.end(body);
  });
}

function form(value) {
  return new URLSearchParams(value).toString();
}

async function waitReady() {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    try {
      const response = await request("/api/health");
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("server not ready");
}

async function assertPath(requestPath) {
  console.log(`smoke: GET ${requestPath}`);
  const response = await request(requestPath);
  if (response.status < 200 || response.status >= 400)
    throw new Error(`${requestPath} ${response.status}`);
}

let exitCode = 0;
try {
  await waitReady();
  const paths = [
    "/", "/theme", "/demo", "/student/login", "/teacher/login", "/admin/login",
    "/practice", "/resources", "/api/health", "/api/analytics",
    "/static/materials/ir-spectrum.png", "/static/materials/ecoli-inhibition.png",
    "/static/materials/nh4cl-yield-sample.csv", "/static/models/limonene.glb",
  ];
  for (const requestPath of paths) await assertPath(requestPath);

  console.log("smoke: student login");
  const student = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ role: "student", username: "student001", password: "123456" }),
  });
  if (student.status !== 302 || !String(student.headers.location || "").includes("/submit"))
    throw new Error("student login failed");
  const studentCookie = Array.isArray(student.headers["set-cookie"])
    ? student.headers["set-cookie"][0].split(";")[0]
    : String(student.headers["set-cookie"] || "").split(";")[0];
  console.log("smoke: student workspace");
  const submit = await request("/submit", { headers: { Cookie: studentCookie } });
  if (submit.status !== 200 || !submit.body.includes("学生探究工作台"))
    throw new Error("student workspace failed");

  console.log("smoke: teacher login");
  const teacher = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ role: "teacher", username: "teacher001", password: "123456" }),
  });
  if (teacher.status !== 302 || !String(teacher.headers.location || "").includes("/admin"))
    throw new Error("teacher login failed");

  console.log("smoke: admin login");
  const administrator = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ role: "admin", username: "admin", password: "123456" }),
  });
  if (administrator.status !== 302) throw new Error("admin login failed");
  const adminCookie = Array.isArray(administrator.headers["set-cookie"])
    ? administrator.headers["set-cookie"][0].split(";")[0]
    : String(administrator.headers["set-cookie"] || "").split(";")[0];
  console.log("smoke: admin generated password reset");
  const reset = await request("/api/admin/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ username: "student001" }),
  });
  const resetBody = JSON.parse(reset.body || "{}");
  if (reset.status !== 200 || !resetBody.ok || !resetBody.temporary_password)
    throw new Error(`admin reset password failed: ${reset.status}`);
  console.log("SMOKE_TEST_PASS");
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  clearTimeout(timeout);
  await rm(runtimeDirectory, { recursive: true, force: true });
}

process.exit(exitCode);
