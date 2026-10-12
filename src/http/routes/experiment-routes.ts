import type { ExperimentService } from "../../application/experiment-service.js";
import { AppError } from "../../application/errors.js";
import type { ReviewAction, ReviewService } from "../../application/review-service.js";
import { analyticsFor } from "../../domain/experiments/analytics.js";
import type { ExperimentRecord, Session } from "../../domain/types.js";
import { DEMO_RECORDS } from "../../shared/demo-records.js";
import type { HttpContext } from "../context.js";
import { parseBody } from "../request.js";
import { sendJson } from "../response.js";
import { parseCreateExperiment, parseOfflineExperiment } from "../schemas/experiment.js";

interface ExperimentViews {
  trendSvg(
    records: ExperimentRecord[],
    concentration?: number,
    currentYield?: number | null,
  ): string;
}

export async function experimentRoutes(
  context: HttpContext,
  experiments: ExperimentService,
  reviews: ReviewService,
  views: ExperimentViews,
  storageMode: string,
  refreshSession: () => Promise<Session | null>,
): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  const demo = url.searchParams.get("demo") === "1" || url.searchParams.get("mode") === "demo";
  if (url.pathname === "/api/record-submissions") {
    if (!session)
      throw new AppError("AUTHENTICATION_REQUIRED", "请先登录后提交或重试课堂数据", 401);
    const submissionContext = {
      user_id: session.id,
      role: session.role,
      class_name: session.class_name,
      group_name: session.group_name ?? "",
      name: session.name,
    };
    async function authorize(): Promise<void> {
      const fresh = await refreshSession();
      if (!fresh)
        throw new AppError("AUTHENTICATION_REQUIRED", "登录已失效；原暂存记录仍保留", 401);
      if (
        fresh.id !== submissionContext.user_id ||
        fresh.role !== submissionContext.role ||
        fresh.class_name !== submissionContext.class_name ||
        (fresh.group_name ?? "") !== submissionContext.group_name ||
        fresh.name !== submissionContext.name
      )
        throw new AppError("CONFLICT", "账号或班级信息已变更；请核对原暂存记录", 409);
    }
    if (req.method === "GET") {
      await authorize();
      sendJson(res, { context: submissionContext });
      return true;
    }
    if (req.method !== "POST") throw new AppError("VALIDATION_ERROR", "请求方法不受支持", 405);
    const body = await parseBody(req, 64 * 1024);
    await authorize();
    const expected = body.context;
    if (
      !expected ||
      typeof expected !== "object" ||
      Array.isArray(expected) ||
      Object.keys(expected).length !== Object.keys(submissionContext).length ||
      Object.entries(submissionContext).some(
        ([key, value]) => (expected as Record<string, unknown>)[key] !== value,
      )
    )
      throw new AppError(
        "CONFLICT",
        "账号或班级信息已变更；原暂存记录保留，请回到原账号核对后重试",
        409,
      );
    if (
      !body.record ||
      typeof body.record !== "object" ||
      Array.isArray(body.record) ||
      (body.record as Record<string, unknown>).mode === "demo"
    )
      throw new AppError("VALIDATION_ERROR", "课堂提交需要一条真实记录", 400);
    // The first send and every retry use the same actor/class-scoped token.
    // /api/records remains compatible with the legacy, non-idempotent API.
    const input = parseOfflineExperiment(body.record as Record<string, unknown>);
    const result = await experiments.sync([input], { actor: session, ip, ua, authorize });
    await authorize();
    sendJson(res, { context: submissionContext, ...result });
    return true;
  }
  if (url.pathname === "/api/records" && req.method === "GET") {
    const records = await experiments.list(session, demo ? DEMO_RECORDS : undefined);
    sendJson(res, { records, mode: demo ? "demo" : storageMode });
    return true;
  }
  if (url.pathname === "/api/records" && req.method === "POST") {
    const body = await parseBody(req, 2_500_000);
    const result = await experiments.create(
      parseCreateExperiment(body),
      { actor: session, ip, ua },
      body.mode === "demo",
    );
    sendJson(res, {
      record: result.record,
      diagnosis: result.diagnosis,
      mode: result.mode === "demo" ? "demo" : storageMode,
    });
    return true;
  }
  if (url.pathname === "/api/records/manage" && req.method === "POST") {
    const body = await parseBody(req);
    const result = await reviews.apply(
      session,
      String(body.id ?? "").trim(),
      String(body.action ?? "") as ReviewAction,
      String(body.note ?? ""),
      { ip, ua },
    );
    sendJson(
      res,
      result.deleted
        ? { ok: true, deleted: true, archived: true }
        : { ok: true, record: result.record },
    );
    return true;
  }
  if (url.pathname === "/api/records/reviews" && req.method === "GET") {
    const history = await reviews.history(session, String(url.searchParams.get("id") ?? "").trim());
    sendJson(res, { reviews: history });
    return true;
  }
  if (url.pathname === "/api/sync" && req.method === "POST") {
    const body = await parseBody(req, 2_500_000);
    const inputs = Array.isArray(body.records)
      ? body.records
          .filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object" && !Array.isArray(item)),
          )
          .map((item) => parseOfflineExperiment(item))
      : [];
    const result = await experiments.sync(inputs, { actor: session, ip, ua });
    sendJson(res, { ok: true, ...result, mode: "offline-sync" });
    return true;
  }
  if (url.pathname === "/api/analytics" && req.method === "GET") {
    const records = await experiments.list(session, demo || !session ? DEMO_RECORDS : undefined);
    sendJson(res, analyticsFor(records));
    return true;
  }
  if (url.pathname === "/api/trend-svg" && req.method === "GET") {
    const records = await experiments.list(session, demo || !session ? DEMO_RECORDS : undefined);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(views.trendSvg(records, 3, null));
    return true;
  }
  return false;
}
