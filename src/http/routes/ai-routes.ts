import type { AIService } from "../../application/ai-service.js";
import type { ClassSummaryService } from "../../application/class-summary-service.js";
import type { HttpContext } from "../context.js";
import { parseBody } from "../request.js";
import { sendJson } from "../response.js";
import { parseAiQuestion } from "../schemas/common.js";

export async function aiRoutes(
  context: HttpContext,
  ai: AIService,
  summaries: ClassSummaryService,
): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  if (url.pathname === "/api/llm/status" && req.method === "GET") {
    sendJson(res, { ok: true, ...ai.status() });
    return true;
  }
  if (url.pathname === "/api/llm/ask" && req.method === "POST") {
    sendJson(res, await ai.ask(parseAiQuestion(await parseBody(req)), session, { ip, ua }));
    return true;
  }
  if (url.pathname === "/api/llm/class-summary" && req.method === "POST") {
    sendJson(res, { ok: true, ...(await summaries.generate(session, { ip, ua })) });
    return true;
  }
  return false;
}
