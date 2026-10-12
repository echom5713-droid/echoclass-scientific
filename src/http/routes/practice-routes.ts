import type { PracticeService } from "../../application/practice-service.js";
import { AppError } from "../../application/errors.js";
import type { HttpContext } from "../context.js";
import { parseBody } from "../request.js";
import { sendJson } from "../response.js";

function booleanValue(value: unknown): boolean {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  throw new AppError("VALIDATION_ERROR", "correct 必须是布尔值", 400);
}

export async function practiceRoutes(
  context: HttpContext,
  service: PracticeService,
): Promise<boolean> {
  const { req, res, url, session } = context;
  if (url.pathname === "/api/practice/answer" && req.method === "POST") {
    const body = await parseBody(req);
    await service.save(
      {
        qid: String(body.qid ?? "").trim(),
        level: Number(body.level),
        correct: booleanValue(body.correct),
        selected: Number(body.selected),
      },
      session,
    );
    sendJson(res, { ok: true });
    return true;
  }
  if (url.pathname === "/api/practice/results" && req.method === "GET") {
    sendJson(res, { ok: true, answers: await service.results(session) });
    return true;
  }
  return false;
}
