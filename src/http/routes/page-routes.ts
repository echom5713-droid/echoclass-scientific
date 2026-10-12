import type { AdminService } from "../../application/admin-service.js";
import type { ExperimentService } from "../../application/experiment-service.js";
import { hasRole } from "../../domain/authorization.js";
import type { ExperimentRecord, Session, User } from "../../domain/types.js";
import { DEMO_RECORDS } from "../../shared/demo-records.js";
import { engineeringPage, projectPage } from "../../views/project-page.js";
import { loginPage } from "../../views/password-page.js";
import { walkthroughPage } from "../../views/walkthrough-page.js";
import type { HttpContext } from "../context.js";
import { redirect, sendHtml } from "../response.js";

interface PageViews {
  DEMO_RECORDS: ExperimentRecord[];
  homePage(
    session: Session | null,
    records?: ExperimentRecord[],
    demoCredentialsEnabled?: boolean,
  ): string;
  themePage(session: Session | null, records?: ExperimentRecord[]): string;
  demoPage(session: Session | null): string;
  loginPage(role: string, session: Session | null, demoCredentialsEnabled?: boolean): string;
  studentPage(records: ExperimentRecord[], session: Session | null, demo?: boolean): string;
  teacherPage(records: ExperimentRecord[], session: Session | null, demo?: boolean): string;
  adminPage(records: ExperimentRecord[], users: User[], session: Session | null): string;
  practicePage(session: Session): string;
  resourcesPage(session: Session | null): string;
  llmPage(session: Session | null): string;
  curriculumPage(session: Session | null): string;
  reportPage(records: ExperimentRecord[], session: Session | null, demo?: boolean): string;
}

export async function pageRoutes(
  context: HttpContext,
  experiments: ExperimentService,
  admin: AdminService,
  views: PageViews,
  demoCredentialsEnabled: boolean,
): Promise<boolean> {
  const { req, res, url, session } = context;
  if (req.method !== "GET") return false;
  const path = url.pathname;
  const demo = url.searchParams.get("demo") === "1" || url.searchParams.get("mode") === "demo";
  if (path === "/") {
    sendHtml(res, projectPage(context.language ?? "en"));
    return true;
  }
  if (path === "/engineering") {
    sendHtml(res, engineeringPage(context.language ?? "en"));
    return true;
  }
  if (path === "/walkthrough") {
    sendHtml(res, walkthroughPage(context.language ?? "en"));
    return true;
  }
  if (path === "/classroom") {
    sendHtml(res, views.homePage(session, [...DEMO_RECORDS], demoCredentialsEnabled));
    return true;
  }
  if (path === "/theme") {
    sendHtml(res, views.themePage(session, [...DEMO_RECORDS]));
    return true;
  }
  if (path === "/demo") {
    sendHtml(res, views.demoPage(session));
    return true;
  }
  if (path === "/student/login") {
    res.setHeader("Cache-Control", "no-store");
    sendHtml(
      res,
      loginPage(
        "student",
        context.language ?? "en",
        demoCredentialsEnabled,
        "",
        url.searchParams.get("password") === "changed",
      ),
    );
    return true;
  }
  if (path === "/teacher/login") {
    res.setHeader("Cache-Control", "no-store");
    sendHtml(
      res,
      loginPage(
        "teacher",
        context.language ?? "en",
        demoCredentialsEnabled,
        "",
        url.searchParams.get("password") === "changed",
      ),
    );
    return true;
  }
  if (path === "/admin/login") {
    res.setHeader("Cache-Control", "no-store");
    sendHtml(
      res,
      loginPage(
        "admin",
        context.language ?? "en",
        demoCredentialsEnabled,
        "",
        url.searchParams.get("password") === "changed",
      ),
    );
    return true;
  }
  if (path === "/submit") {
    if (!demo && !hasRole(session, ["student"])) {
      redirect(res, "/student/login");
      return true;
    }
    sendHtml(
      res,
      views.studentPage(
        await experiments.list(session, demo ? DEMO_RECORDS : undefined),
        session,
        demo,
      ),
    );
    return true;
  }
  if (path === "/admin") {
    if (!demo && !hasRole(session, ["teacher", "admin"])) {
      redirect(res, "/teacher/login");
      return true;
    }
    sendHtml(
      res,
      views.teacherPage(
        await experiments.list(session, demo ? DEMO_RECORDS : undefined),
        session,
        demo,
      ),
    );
    return true;
  }
  if (path === "/admin/console" || path === "/admin/users") {
    if (!hasRole(session, ["admin"])) {
      redirect(res, "/admin/login");
      return true;
    }
    sendHtml(
      res,
      views.adminPage(await experiments.list(session), await admin.listUsers(session), session),
    );
    return true;
  }
  if (path === "/dashboard") {
    sendHtml(res, views.teacherPage([...DEMO_RECORDS], session, true));
    return true;
  }
  if (path === "/report") {
    if (!demo && !hasRole(session, ["teacher", "admin"])) {
      redirect(res, "/teacher/login");
      return true;
    }
    sendHtml(
      res,
      views.reportPage(
        await experiments.list(session, demo ? DEMO_RECORDS : undefined),
        session,
        demo,
      ),
    );
    return true;
  }
  if (path === "/practice") {
    if (!session) {
      redirect(res, "/student/login");
      return true;
    }
    sendHtml(res, views.practicePage(session));
    return true;
  }
  if (path === "/llm-teaching") {
    sendHtml(res, views.llmPage(session));
    return true;
  }
  if (path === "/curriculum") {
    sendHtml(res, views.curriculumPage(session));
    return true;
  }
  if (path === "/resources") {
    sendHtml(res, views.resourcesPage(session));
    return true;
  }
  return false;
}
