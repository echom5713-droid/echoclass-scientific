import type { IncomingMessage, ServerResponse } from "node:http";
import { requiresPasswordChange } from "../domain/authorization.js";
import { passwordPage } from "../views/password-page.js";
import { languageFor, parseLanguage, localizedOperationPath } from "../shared/language.js";
import { authMessage } from "../shared/auth-language.js";
import { operationErrorText } from "../shared/operation-copy.js";
import type { GroundedService } from "../application/grounded-service.js";
import { groundedRoutes } from "./routes/grounded-routes.js";
import type { CsvService } from "../application/csv-service.js";
import type { EvidenceService } from "../application/evidence-service.js";
import type { ScientificService } from "../application/scientific-service.js";
import { scientificRoutes } from "./routes/scientific-routes.js";
import { evidenceRoutes } from "./routes/evidence-routes.js";
import { csvRoutes } from "./routes/csv-routes.js";
import type { AdminService } from "../application/admin-service.js";
import type { AIService } from "../application/ai-service.js";
import type { AuthService } from "../application/auth-service.js";
import type { ClassSummaryService } from "../application/class-summary-service.js";
import { AppError } from "../application/errors.js";
import type { ExperimentService } from "../application/experiment-service.js";
import type { ReviewService } from "../application/review-service.js";
import type { OperationsService } from "../application/operations-service.js";
import type { PracticeService } from "../application/practice-service.js";
import { log } from "../shared/logger.js";
import { views } from "../views/legacy-view-adapter.js";
import { errorEnvelope } from "./error-mapper.js";
import { clientIp, cookieMap, originAllowed, userAgent } from "./request.js";
import { appendCookie, applySecurityHeaders, redirect, sendHtml, sendJson } from "./response.js";
import { serveStatic } from "./static-files.js";
import { adminRoutes } from "./routes/admin-routes.js";
import { aiRoutes } from "./routes/ai-routes.js";
import { authRoutes } from "./routes/auth-routes.js";
import { experimentRoutes } from "./routes/experiment-routes.js";
import { operationsRoutes } from "./routes/operations-routes.js";
import { pageRoutes } from "./routes/page-routes.js";
import { practiceRoutes } from "./routes/practice-routes.js";

export interface RouterDependencies {
  grounded: GroundedService;
  scientific: ScientificService;
  evidence: EvidenceService;
  csv: CsvService;
  auth: AuthService;
  admin: AdminService;
  ai: AIService;
  experiments: ExperimentService;
  reviews: ReviewService;
  classSummaries: ClassSummaryService;
  operations: OperationsService;
  practice: PracticeService;
  storageMode: string;
  demoSeedEnabled: boolean;
  requestId(): string;
}

export function createRouter(dependencies: RouterDependencies) {
  return async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    const requestId = dependencies.requestId();
    let routePath = "/";
    let actorRole: string | undefined;
    let language: "en" | "zh" = "en";
    let result = "ok";
    applySecurityHeaders(req, res);
    res.setHeader("X-Request-Id", requestId);
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      routePath = url.pathname;
      if (url.pathname.startsWith("/static/") && (await serveStatic(url.pathname, res, req)))
        return;
      if (req.method === "POST" && !originAllowed(req))
        throw new AppError("FORBIDDEN", "疑似跨站请求，已拒绝", 403);
      const cookies = cookieMap(req);
      language = languageFor(url, cookies);
      if (
        [
          "/",
          "/engineering",
          "/walkthrough",
          "/account/password",
          "/student/login",
          "/teacher/login",
          "/admin/login",
          "/api/auth/login",
          "/api/auth/change-password",
        ].includes(url.pathname) ||
        localizedOperationPath(url.pathname)
      )
        res.setHeader("Content-Language", language === "zh" ? "zh-CN" : "en");
      res.setHeader("Vary", "Cookie");
      if (
        req.method === "GET" &&
        url.searchParams.getAll("lang").length === 1 &&
        parseLanguage(url.searchParams.get("lang"))
      )
        appendCookie(res, `echoclass_language=${language}; Path=/; SameSite=Lax; Max-Age=31536000`);
      const sid = cookies.citrus_sid ?? "";
      const session = await dependencies.auth.sessionFor(sid);
      actorRole = session?.role;
      if (url.pathname === "/account/password" && req.method === "GET") {
        res.setHeader("Cache-Control", "no-store");
        if (!session) redirect(res, "/student/login");
        else sendHtml(res, passwordPage(session, language));
        return;
      }
      const passwordAllowed =
        (req.method === "POST" &&
          ["/api/auth/login", "/api/auth/change-password"].includes(url.pathname)) ||
        (req.method === "GET" &&
          [
            "/logout",
            "/",
            "/engineering",
            "/walkthrough",
            "/api/health",
            "/student/login",
            "/teacher/login",
            "/admin/login",
          ].includes(url.pathname));
      if (requiresPasswordChange(session) && !passwordAllowed) {
        res.setHeader("Content-Language", language === "zh" ? "zh-CN" : "en");
        if (url.pathname.startsWith("/api/"))
          throw new AppError(
            "PASSWORD_CHANGE_REQUIRED",
            language === "zh"
              ? "请先修改临时密码再访问课堂数据。"
              : "Change your temporary password before accessing classroom data.",
            403,
          );
        res.setHeader("Cache-Control", "no-store");
        redirect(res, "/account/password");
        return;
      }
      const context = {
        req,
        res,
        url,
        session,
        language,
        requestId,
        ip: clientIp(req),
        ua: userAgent(req),
      };
      if (await groundedRoutes(context, dependencies.grounded)) return;
      if (await evidenceRoutes(context, dependencies.evidence)) return;
      if (await scientificRoutes(context, dependencies.scientific)) return;
      if (await csvRoutes(context, dependencies.csv)) return;
      if (await operationsRoutes(context, dependencies.operations)) return;
      if (await authRoutes(context, dependencies.auth, dependencies.demoSeedEnabled)) return;
      if (await adminRoutes(context, dependencies.admin)) return;
      if (
        await experimentRoutes(
          context,
          dependencies.experiments,
          dependencies.reviews,
          views,
          dependencies.storageMode,
          () => dependencies.auth.sessionFor(sid),
        )
      )
        return;
      if (await aiRoutes(context, dependencies.ai, dependencies.classSummaries)) return;
      if (await practiceRoutes(context, dependencies.practice)) return;
      if (
        await pageRoutes(
          context,
          dependencies.experiments,
          dependencies.admin,
          views,
          dependencies.demoSeedEnabled,
        )
      )
        return;
      redirect(res, "/");
    } catch (error) {
      result = "error";
      const localized =
        error instanceof AppError &&
        (routePath.startsWith("/api/auth/") || localizedOperationPath(routePath))
          ? new AppError(
              error.code,
              routePath.startsWith("/api/auth/")
                ? authMessage(error.message, language)
                : operationErrorText(language, error.message, error.code, error.status),
              error.status,
              error.fields.map((field) => ({
                ...field,
                message: routePath.startsWith("/api/auth/")
                  ? authMessage(field.message, language)
                  : operationErrorText(language, field.message, error.code, error.status),
              })),
            )
          : error;
      const mapped = errorEnvelope(localized, requestId);
      sendJson(res, mapped.body, mapped.status);
      if (!(error instanceof AppError))
        log({
          level: "error",
          request_id: requestId,
          event: "request.unhandled_error",
          route: routePath,
          actor_role: actorRole,
          result,
          status: mapped.status,
        });
    } finally {
      log({
        level: result === "ok" ? "info" : "warn",
        request_id: requestId,
        event: "http.request",
        route: routePath,
        actor_role: actorRole,
        result,
        status: res.statusCode,
        duration_ms: Number((performance.now() - started).toFixed(1)),
      });
    }
  };
}
