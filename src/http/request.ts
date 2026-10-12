import type { IncomingMessage } from "node:http";
import { AppError } from "../application/errors.js";

export async function parseBody(
  req: IncomingMessage,
  limitBytes = 16_000_000,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) throw new AppError("VALIDATION_ERROR", "请求体过大", 413);
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(raw));
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new AppError("VALIDATION_ERROR", "请求格式不正确", 400);
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION_ERROR", "JSON 请求格式不正确", 400);
  }
}

export function clientIp(req: IncomingMessage): string {
  return (
    String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown")
      .split(",")[0]
      ?.trim() || "unknown"
  );
}

export function userAgent(req: IncomingMessage): string {
  return String(req.headers["user-agent"] ?? "").slice(0, 500);
}

export function cookieMap(req: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) continue;
    try {
      result[decodeURIComponent(part.slice(0, equals).trim())] = decodeURIComponent(
        part.slice(equals + 1),
      );
    } catch {
      // Ignore malformed cookie encoding.
    }
  }
  return result;
}

export function originAllowed(req: IncomingMessage): boolean {
  const source = req.headers.origin ?? req.headers.referer;
  const host = req.headers.host;
  if (!source || !host) return true;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}
