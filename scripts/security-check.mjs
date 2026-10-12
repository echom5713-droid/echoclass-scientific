import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temporaryData = await mkdtemp(path.join(os.tmpdir(), "echoclass-security-"));
process.env.ECHOCLASS_DATA_DIR = temporaryData;
process.env.ECHOCLASS_SEED_DEMO = "1";
process.env.STORAGE_MODE = "json";

try {
  const { ensureData, readUsers } = await import("../dist/src/infrastructure/database/storage.js");
  const { NodeSecurity, verifyPassword } = await import("../dist/src/infrastructure/security/node-security.js");
  const { cookieMap } = await import("../dist/src/http/request.js");
  const { setSessionCookie } = await import("../dist/src/http/response.js");
  const { serveStatic } = await import("../dist/src/http/static-files.js");

  await ensureData();
  const users = await readUsers();
  for (const user of users) {
    if (user.password) throw new Error(`Plaintext password found for ${user.username}`);
    if (!String(user.passwordHash || "").startsWith("scrypt$"))
      throw new Error(`Missing scrypt passwordHash for ${user.username}`);
  }
  const student = users.find((user) => user.username === "student001");
  if (!student || !verifyPassword("123456", student.passwordHash))
    throw new Error("Default student password verification failed");
  const security = new NodeSecurity();
  const hash = security.hashPassword("runtime-password-check");
  if (!security.verify("runtime-password-check", hash) || security.verify("wrong", hash))
    throw new Error("Runtime password hash verification failed");

  const malformedCookies = cookieMap({
    headers: { cookie: "safe=ok; broken=%E0%A4%A; citrus_sid=abc123" },
  });
  if (malformedCookies.safe !== "ok" || malformedCookies.citrus_sid !== "abc123")
    throw new Error("Malformed cookie handling failed");

  const outsideServed = await serveStatic(
    "/static/..%2Fpackage.json",
    {
      writeHead() { throw new Error("Path traversal unexpectedly wrote headers"); },
      end() { throw new Error("Path traversal unexpectedly wrote body"); },
    },
    { headers: {} },
  );
  if (outsideServed) throw new Error("Static path traversal was served");

  const headers = new Map();
  setSessionCookie(
    { headers: { "x-forwarded-proto": "https" }, socket: {} },
    { setHeader: (name, value) => headers.set(name, value), getHeader: (name) => headers.get(name) },
    "session-value",
  );
  const cookie = String(headers.get("Set-Cookie") ?? "");
  if (!cookie.includes("HttpOnly") || !cookie.includes("SameSite=Lax") || !cookie.includes("Secure"))
    throw new Error("Runtime session cookie attributes are incomplete");

  const staticSource = await readFile(new URL("../src/http/static-files.ts", import.meta.url), "utf8");
  if (!staticSource.includes("path.relative(root, file)"))
    throw new Error("Static path boundary check is not using path.relative");
  const requestSource = await readFile(new URL("../src/http/request.ts", import.meta.url), "utf8");
  if (!requestSource.includes("decodeURIComponent") || !requestSource.includes("catch"))
    throw new Error("Runtime cookie decode guard not found");
  const responseSource = await readFile(new URL("../src/http/response.ts", import.meta.url), "utf8");
  if (!responseSource.includes("HttpOnly") || !responseSource.includes("SameSite=Lax"))
    throw new Error("Runtime response cookie protection missing");
  const securitySource = await readFile(
    new URL("../src/infrastructure/security/node-security.ts", import.meta.url),
    "utf8",
  );
  if (!securitySource.includes("timingSafeEqual") || !securitySource.includes("scryptSync"))
    throw new Error("Runtime password implementation is not the expected hardened implementation");

  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (pkg.name !== "echoclass" || pkg.version !== "3.0.0-beta.25")
    throw new Error("Package identity/version mismatch");
  if (pkg.scripts?.start?.includes("NODE_ENV=production"))
    throw new Error("Non-cross-platform start script found");
  if (!existsSync(new URL("./backup-db.mjs", import.meta.url)))
    throw new Error("Cross-platform backup script missing");
  if (!existsSync(new URL("./restore-db.mjs", import.meta.url)))
    throw new Error("Cross-platform restore script missing");

  const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  if (server.includes("x.password===body.password") || server.includes("password:'123456'"))
    throw new Error("Unsafe password comparison pattern found");
  if (!/server\.on\(["']error["']/.test(server) || !server.includes("EADDRINUSE"))
    throw new Error("Friendly port error handler missing");
  const aiService = await readFile(new URL("../src/application/ai-service.ts", import.meta.url), "utf8");
  if (!aiService.includes("redactSupportedPii") || !aiService.includes("RateLimiter"))
    throw new Error("AI PII/rate-limit guard missing");

  const storage = await readFile(new URL("../src/infrastructure/database/storage.js", import.meta.url), "utf8");
  if (/const base\s*=\s*\{[^}]*dbFile/s.test(storage))
    throw new Error("Public metrics expose database path");
  if (/INSERT OR REPLACE INTO records/.test(storage))
    throw new Error("Record persistence still permits replacement");

  const pages = await readFile(new URL("../src/views/pages.js", import.meta.url), "utf8");
  if (/\.length\s*\+\s*[124]/.test(pages)) throw new Error("Fabricated analytics offset found");
  if (/Digital Twin|数字孪生/.test(pages)) throw new Error("Unsupported digital-twin claim found");

  const client = await readFile(new URL("../public/client.js", import.meta.url), "utf8");
  if (/data\.answer\.replace\(\/\\n\/g/.test(client) || /ai_diagnosis\.replace\(\/\\n\/g/.test(client))
    throw new Error("Unescaped AI output rendering found");
  if (!client.includes("escapeHtml(data.answer)")) throw new Error("Escaped AI output rendering missing");
  if (!client.includes("validLocalImage") || client.includes("document.getElementById('image_data').value"))
    throw new Error("Unsafe image persistence path found");

  console.log("SECURITY_CHECK_PASS");
} finally {
  await rm(temporaryData, { recursive: true, force: true });
}
