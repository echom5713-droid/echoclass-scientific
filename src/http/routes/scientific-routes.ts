import type { ScientificService } from "../../application/scientific-service.js";
import { AppError } from "../../application/errors.js";
import { scientificPage } from "../../views/scientific-page.js";
import { validPresentationQuery } from "../../shared/language.js";
import type { HttpContext } from "../context.js";
import { sendHtml, sendJson } from "../response.js";
import {
  readScientificCommand,
  requireEmptyScientificBody,
  scientificInput,
} from "../scientific-body.js";

export async function scientificRoutes(
  context: HttpContext,
  service: ScientificService,
): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  const path = url.pathname;
  if (!/^\/(?:api\/scientific-runs|scientific-analysis)(?:\/|$)/.test(path)) return false;
  const actor = { actor: session, ip, ua };
  const identity = service.gate(actor);
  res.setHeader("Cache-Control", "no-store");
  const report = /^\/scientific-analysis\/runs\/([A-Za-z0-9_-]+)$/.exec(path);
  const item = /^\/api\/scientific-runs\/([A-Za-z0-9_-]+)(?:\/(reproduce))?$/.exec(path);
  const list = path === "/api/scientific-runs";
  if (path === "/scientific-analysis" || report) {
    if (req.method !== "GET") throw scientificInput("科学分析页面仅支持读取", 405);
    if (report) {
      if (!validPresentationQuery(url)) throw scientificInput("科学报告不接受额外参数");
      service.get(actor, report[1]!);
    } else if (
      !validPresentationQuery(url, ["class_id"]) ||
      (url.searchParams.has("class_id") && !url.searchParams.get("class_id"))
    )
      throw scientificInput("班级参数无效");
    sendHtml(res, scientificPage(context.language, url.pathname + url.search));
    return true;
  }
  if (!list && !item) throw new AppError("NOT_FOUND", "科学分析接口不存在", 404);
  if (list && req.method === "GET") {
    const keys = [...url.searchParams.keys()];
    if (keys.length > 1 || keys.some((key) => key !== "class_id"))
      throw scientificInput("班级参数重复或未知");
    const classes = service.classes(actor);
    const classId = url.searchParams.get("class_id");
    sendJson(res, {
      ok: true,
      user_id: identity.id,
      classes,
      available: service.available(),
      runs: classId ? service.list(actor, classId) : [],
    });
    return true;
  }
  if (url.search) throw scientificInput("科学分析接口不接受这些参数");
  if (list && req.method === "POST") {
    const command = await readScientificCommand(req);
    const result = service.create(actor, command);
    sendJson(res, { ok: true, ...result }, result.replayed ? 200 : 202);
    return true;
  }
  if (item && item[2] === "reproduce" && req.method === "POST") {
    requireEmptyScientificBody(req);
    const result = await service.reproduce(actor, item[1]!);
    service.get(actor, item[1]!);
    sendJson(res, { ok: true, reproduction: result });
    return true;
  }
  if (item && !item[2] && req.method === "GET") {
    sendJson(res, { ok: true, user_id: identity.id, run: service.get(actor, item[1]!) });
    return true;
  }
  throw scientificInput("科学分析请求方法不受支持", 405);
}
