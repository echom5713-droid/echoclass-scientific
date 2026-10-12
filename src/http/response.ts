import type { IncomingMessage, ServerResponse } from "node:http";

export function sendHtml(res: ServerResponse, html: string, status = 200): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function secureCookie(req: IncomingMessage): string {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwarded === "https" || Boolean((req.socket as { encrypted?: boolean }).encrypted)
    ? "; Secure"
    : "";
}

export function setSessionCookie(req: IncomingMessage, res: ServerResponse, sid: string): void {
  appendCookie(
    res,
    `citrus_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureCookie(req)}`,
  );
}

export function clearSessionCookie(req: IncomingMessage, res: ServerResponse): void {
  appendCookie(res, `citrus_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie(req)}`);
}

export function appendCookie(res: ServerResponse, cookie: string): void {
  const current = res.getHeader("Set-Cookie");
  if (current === undefined) res.setHeader("Set-Cookie", cookie);
  else
    res.setHeader("Set-Cookie", [
      ...(Array.isArray(current) ? current.map(String) : [String(current)]),
      cookie,
    ]);
}

export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  const proto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  if (process.env.NODE_ENV === "production" && proto === "https")
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
}
