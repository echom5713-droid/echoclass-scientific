import type { AuthService } from "../../application/auth-service.js";
import { requiresPasswordChange } from "../../domain/authorization.js";
import { authMessage } from "../../shared/auth-language.js";
import { loginPage } from "../../views/password-page.js";
import { AppError } from "../../application/errors.js";
import type { HttpContext } from "../context.js";
import { parseBody } from "../request.js";
import { clearSessionCookie, redirect, sendHtml, sendJson, setSessionCookie } from "../response.js";
import { parseLogin, parsePasswordChange } from "../schemas/common.js";

export async function authRoutes(
  context: HttpContext,
  auth: AuthService,
  demoCredentialsEnabled = false,
): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  if (url.pathname === "/logout") {
    const sid =
      String(req.headers.cookie ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("citrus_sid="))
        ?.slice(11) ?? "";
    await auth.logout(decodeURIComponent(sid));
    clearSessionCookie(req, res);
    redirect(res, "/");
    return true;
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await parseBody(req);
    try {
      const input = parseLogin(body);
      const result = await auth.login(input, { ip, ua, route: url.pathname });
      setSessionCookie(req, res, result.sid);
      redirect(
        res,
        requiresPasswordChange(result.user)
          ? "/account/password"
          : input.role === "student"
            ? "/submit"
            : input.role === "teacher"
              ? "/admin"
              : "/admin/console",
      );
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      sendHtml(
        res,
        loginPage(
          ["teacher", "admin"].includes(String(body.role))
            ? (body.role as "teacher" | "admin")
            : "student",
          context.language ?? "en",
          demoCredentialsEnabled,
          authMessage(error.message, context.language ?? "en"),
        ),
        error.status,
      );
    }
    return true;
  }
  if (url.pathname === "/api/auth/change-password" && req.method === "POST") {
    const input = parsePasswordChange(await parseBody(req));
    await auth.changePassword(session, input.oldPassword, input.newPassword, {
      ip,
      ua,
      route: url.pathname,
    });
    clearSessionCookie(req, res);
    const loginUrl = `/${session!.role}/login`;
    if (String(req.headers["content-type"] ?? "").startsWith("application/json"))
      sendJson(res, {
        ok: true,
        message:
          context.language === "zh"
            ? "密码已修改，请使用新密码重新登录。"
            : "Your password has changed. Sign in again with the new password.",
        login_url: loginUrl,
      });
    else redirect(res, loginUrl + "?password=changed");
    return true;
  }
  return false;
}
