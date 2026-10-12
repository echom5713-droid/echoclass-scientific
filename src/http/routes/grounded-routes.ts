import type { GroundedService } from "../../application/grounded-service.js";
import { AppError } from "../../application/errors.js";
import { groundedPage } from "../../views/grounded-page.js";
import { validPresentationQuery } from "../../shared/language.js";
import type { HttpContext } from "../context.js";
import { sendHtml, sendJson } from "../response.js";
import { readBoundedScientificJson } from "../scientific-body.js";

export async function groundedRoutes(
  context: HttpContext,
  service: GroundedService,
): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  if (!/^\/(?:api\/grounded-runs|grounded-analysis)(?:\/|$)/.test(url.pathname)) return false;
  res.setHeader("Cache-Control", "no-store");
  const match =
    /^\/(api\/grounded-runs|grounded-analysis\/runs)\/([A-Za-z0-9_-]{1,128})(\/sources)?$/.exec(
      url.pathname,
    );
  if (
    !match ||
    (match[1] === "grounded-analysis/runs" && !match[3]
      ? !validPresentationQuery(url)
      : Boolean(url.search))
  )
    throw new AppError("VALIDATION_ERROR", "报告解释地址无效", 400);
  const actor = { actor: session, ip, ua },
    id = match[2]!;
  const options = service.options(actor, id);
  if (match[3]) {
    if (req.method !== "POST" || match[1] !== "api/grounded-runs")
      throw new AppError("VALIDATION_ERROR", "资料检索请求方法不受支持", 405);
    const result = await service.sources(actor, id, await readBoundedScientificJson(req));
    service.context(actor, id);
    sendJson(res, { ok: true, ...result });
    return true;
  }
  if (req.method === "GET") {
    if (match[1] === "api/grounded-runs") sendJson(res, { ok: true, ...options });
    else sendHtml(res, groundedPage(context.language, url.pathname + url.search));
    return true;
  }
  if (req.method === "POST" && match[1] === "api/grounded-runs") {
    const answer = await service.explain(actor, id, await readBoundedScientificJson(req));
    // Keep the final scope check synchronous and adjacent to the response.
    service.context(actor, id);
    sendJson(res, { ok: true, ...answer });
    return true;
  }
  throw new AppError("VALIDATION_ERROR", "报告解释请求方法不受支持", 405);
}
