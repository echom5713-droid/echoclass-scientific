import type { Session, UserRole } from "../domain/types.js";
import { requiresPasswordChange } from "../domain/authorization.js";
import { languageSwitch, type Language } from "../shared/language.js";

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function frame(
  title: string,
  body: string,
  language: Language,
  route: string,
  signedIn: boolean,
): string {
  const t = (en: string, zh: string) => (language === "zh" ? zh : en);
  return `<!doctype html><html lang="${language === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · EchoClass</title><link rel="stylesheet" href="/static/project.css"><link rel="stylesheet" href="/static/password.css">${signedIn ? '<script src="/static/password-client.js" defer></script>' : ""}</head><body><header class="password-header"><a href="/">EchoClass<span>${t("A chemistry data project", "化学数据项目")}</span></a><div class="header-actions">${languageSwitch(route, language)}${signedIn ? `<a href="/logout">${t("Sign out", "退出登录")}</a>` : ""}</div></header><main class="password-main">${body}</main></body></html>`;
}

export function passwordPage(session: Session, language: Language = "en"): string {
  const required = requiresPasswordChange(session);
  const t = (en: string, zh: string) => (language === "zh" ? zh : en);
  return frame(
    t("Change password", "修改密码"),
    `<p class="eyebrow">${t("Account access", "账号访问")}</p><h1>${required ? t("Set your own<br>password.", "设置你自己的<br>密码。") : t("Change your<br>password.", "修改你的<br>密码。")}</h1><p class="password-intro">${required ? t("Replace the temporary password supplied by your administrator before entering the classroom.", "进入课堂前，请先替换管理员提供的临时密码。") : t("Changing your password signs you out of every session. Sign in again with the new password.", "改密后所有会话都会退出，请使用新密码重新登录。")}</p><p class="password-account">${t("Signed in as", "当前账号")} <strong>${escape(session.username)}</strong></p><form id="password-change-form" method="POST" action="/api/auth/change-password?lang=${language}"><label for="current-password">${required ? t("Temporary password", "临时密码") : t("Current password", "当前密码")}</label><input id="current-password" name="oldPassword" type="password" autocomplete="current-password" required><label for="new-password">${t("New password", "新密码")}</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="72" aria-describedby="password-hint" required><p id="password-hint" class="password-hint">${t("6–72 characters. Choose a different password and keep it private.", "6–72 个字符；请设置不同于当前密码的新密码，并妥善保管。")}</p><label for="confirm-password">${t("Confirm new password", "确认新密码")}</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="72" required><button type="submit">${t("Save password and sign out", "保存新密码并退出")}</button><p id="password-feedback" class="password-feedback" role="status" aria-live="polite"></p></form><p class="password-help">${t("Your administrator can issue a new temporary password if you cannot sign in.", "如果无法登录，可以请管理员重新提供临时密码。")} <a href="/${session.role}/login">${t("Return to sign in", "返回登录")}</a></p>`,
    language,
    "/account/password",
    true,
  );
}

export function loginPage(
  role: UserRole,
  language: Language = "en",
  demoEnabled = false,
  error = "",
  changed = false,
): string {
  const t = (en: string, zh: string) => (language === "zh" ? zh : en);
  const label =
    role === "student"
      ? t("Student", "学生")
      : role === "teacher"
        ? t("Teacher", "教师")
        : t("Administrator", "管理员");
  const username = role === "admin" ? "admin" : `${role}001`;
  return frame(
    `${label} · ${t("Sign in", "登录")}`,
    `<p class="eyebrow">${t("Classroom access", "课堂访问")}</p><h1>${label}<br>${t("sign in.", "登录。")}</h1><p class="password-intro">${t("Use the account supplied by your administrator. Temporary credentials lead to a password change before classroom access.", "请使用管理员提供的账号。临时密码登录后，需要先改密才能访问课堂。")}</p>${demoEnabled ? `<p class="demo-account-note">${t("Disposable demo accounts are enabled here. These credentials are for synthetic demonstrations only.", "当前启用了隔离演示账号，以下凭据仅用于合成数据演示。")}</p>` : ""}${changed ? `<p class="password-success" role="status">${t("Password saved. Sign in again with your new password.", "密码已保存，请使用新密码重新登录。")}</p>` : ""}${error ? `<p class="password-feedback" role="alert">${escape(error)}</p>` : ""}<form method="POST" action="/api/auth/login?lang=${language}"><input name="role" type="hidden" value="${role}"><label for="login-username">${t("Username", "账号")}</label><input id="login-username" name="username" autocomplete="username"${demoEnabled ? ` value="${username}"` : ""} required><label for="login-password">${t("Password", "密码")}</label><input id="login-password" name="password" type="password" autocomplete="current-password"${demoEnabled ? ' value="123456"' : ""} required><button type="submit">${t("Sign in", "登录")}</button></form><nav class="login-roles" aria-label="${t("Account role", "账号角色")}"><a href="/student/login">${t("Student", "学生")}</a><a href="/teacher/login">${t("Teacher", "教师")}</a><a href="/admin/login">${t("Administrator", "管理员")}</a></nav><p class="password-help"><a href="/">${t("Read the project without an account →", "无需账号，直接阅读项目 →")}</a></p>`,
    language,
    `/${role}/login`,
    false,
  );
}
