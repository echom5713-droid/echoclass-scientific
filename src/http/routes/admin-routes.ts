import type { AdminService, ImportedUser } from "../../application/admin-service.js";
import { normalizeUserRole, parseImportedUsers } from "../../application/admin-service.js";
import { AppError } from "../../application/errors.js";
import type { HttpContext } from "../context.js";
import { parseBody } from "../request.js";
import { sendJson } from "../response.js";

export async function adminRoutes(context: HttpContext, service: AdminService): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  if (req.method !== "POST") return false;
  if (url.pathname === "/api/admin/reset-password") {
    const body = await parseBody(req);
    const username = String(body.username ?? "").trim();
    const result = await service.resetPassword(session, username, { ip, ua });
    sendJson(res, {
      ok: true,
      message: `${username} 已生成一次性临时密码`,
      temporary_password: result.temporaryPassword,
    });
    return true;
  }
  if (url.pathname === "/api/admin/create-user") {
    const body = await parseBody(req);
    const role = normalizeUserRole(body.role);
    const username = String(body.username ?? "").trim();
    if (!role || !username) throw new AppError("VALIDATION_ERROR", "请填写角色和账号", 400);
    const imported: ImportedUser = {
      role,
      username,
      name: String(body.name ?? username).trim(),
      class_name: String(body.class_name ?? "").trim(),
      group_name: String(body.group_name ?? "").trim(),
      password: String(body.password ?? "").trim() || undefined,
    };
    const result = await service.upsert(session, [imported], { ip, ua });
    sendJson(res, { ok: true, ...result, message: `${username} 已保存` });
    return true;
  }
  if (url.pathname === "/api/admin/import-users") {
    const body = await parseBody(req, 800_000);
    const fallback = normalizeUserRole(body.role) ?? undefined;
    const parsed = parseImportedUsers(String(body.text ?? body.raw ?? ""), fallback);
    if (!parsed.users.length)
      throw new AppError("VALIDATION_ERROR", parsed.errors[0] ?? "没有识别到账号数据", 400);
    const result = await service.upsert(session, parsed.users, { ip, ua });
    sendJson(res, {
      ok: true,
      ...result,
      errors: parsed.errors,
      message: `导入完成：新增 ${result.created} 个，更新 ${result.updated} 个`,
    });
    return true;
  }
  return false;
}
