import type { AIHistoryItem, UserRole } from "../../domain/types.js";
import { AppError } from "../../application/errors.js";

export type UnknownBody = Record<string, unknown>;

export function asObject(value: unknown): UnknownBody {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("VALIDATION_ERROR", "请求格式不正确", 400);
  return value as UnknownBody;
}

export function stringField(body: UnknownBody, key: string, maximum = 200): string {
  return String(body[key] ?? "")
    .trim()
    .slice(0, maximum);
}

export function parseLogin(body: UnknownBody): {
  role: UserRole;
  username: string;
  password: string;
} {
  const role = stringField(body, "role", 20);
  const username = stringField(body, "username", 60);
  const password = String(body.password ?? "");
  const fields: Array<{ field: string; message: string }> = [];
  if (!(role === "student" || role === "teacher" || role === "admin"))
    fields.push({ field: "role", message: "角色不正确" });
  if (!username) fields.push({ field: "username", message: "请输入账号" });
  if (!password) fields.push({ field: "password", message: "请输入密码" });
  if (fields.length)
    throw new AppError(
      "VALIDATION_ERROR",
      fields.map((item) => item.message).join("；"),
      400,
      fields,
    );
  return { role: role as UserRole, username, password };
}

export function parsePasswordChange(body: UnknownBody): {
  oldPassword: string;
  newPassword: string;
} {
  const oldPassword = String(body.old_password ?? body.oldPassword ?? "");
  const newPassword = String(body.new_password ?? body.newPassword ?? "");
  const fields: Array<{ field: string; message: string }> = [];
  if (!oldPassword) fields.push({ field: "old_password", message: "请输入当前密码" });
  if (newPassword.length < 6) fields.push({ field: "new_password", message: "新密码至少 6 位" });
  if (newPassword.length > 72) fields.push({ field: "new_password", message: "新密码过长" });
  const confirmation = body.confirmPassword ?? body.confirm_password;
  if (confirmation !== undefined && String(confirmation) !== newPassword)
    fields.push({ field: "confirm_password", message: "两次输入的新密码不一致" });
  if (fields.length)
    throw new AppError(
      "VALIDATION_ERROR",
      fields.map((item) => item.message).join("；"),
      400,
      fields,
    );
  return { oldPassword, newPassword };
}

export function parseAiQuestion(body: UnknownBody): {
  question: string;
  scene: string;
  history: AIHistoryItem[];
} {
  const question = String(body.question ?? "").trim();
  if (question.length > 2000)
    throw new AppError("VALIDATION_ERROR", "问题过长，最多 2000 个字符", 413);
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).map((item): AIHistoryItem => {
        const entry = asObject(item);
        return {
          role: entry.role === "assistant" ? "assistant" : "user",
          content: String(entry.content ?? ""),
        };
      })
    : [];
  return { question, scene: String(body.scene ?? ""), history };
}
