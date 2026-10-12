import { hasRole } from "../domain/authorization.js";
import {
  RepositoryConflictError,
  type AuditRepository,
  type UserRepository,
} from "../domain/repositories.js";
import type { Session, User, UserRole } from "../domain/types.js";
import { AppError } from "./errors.js";
import type { IdGenerator, PasswordHasher } from "./ports.js";

export interface ImportedUser {
  role: UserRole;
  username: string;
  name: string;
  class_name: string;
  group_name: string;
  password?: string | undefined;
}

export function normalizeUserRole(value: unknown): UserRole | null {
  const role = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["student", "stu", "学生", "同学"].includes(role)) return "student";
  if (["teacher", "tea", "教师", "老师"].includes(role)) return "teacher";
  if (["admin", "管理员"].includes(role)) return "admin";
  return null;
}

export function parseImportedUsers(
  raw: string,
  fallback?: UserRole,
): { users: ImportedUser[]; errors: string[] } {
  const users: ImportedUser[] = [];
  const errors: string[] = [];
  for (const [index, line] of raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .entries()) {
    const columns = line.includes("\t")
      ? line.split("\t")
      : line.includes(",")
        ? line.split(",")
        : line.includes("，")
          ? line.split("，")
          : line.split(/\s+/);
    const cols = columns.map((item) => item.trim());
    const joined = cols.join("|").toLowerCase();
    if (
      /role|username|账号|姓名|班级|小组|密码|身份|角色/.test(joined) &&
      !/^(student|teacher|admin|学生|老师|教师)/i.test(cols[0] ?? "")
    )
      continue;
    let role = normalizeUserRole(cols[0]);
    const offset = role ? 1 : 0;
    role ??= fallback ?? "student";
    const username = cols[offset] ?? "";
    if (!username) {
      errors.push(`第 ${index + 1} 行缺少账号`);
      continue;
    }
    users.push({
      role,
      username,
      name: cols[offset + 1] || "",
      class_name: cols[offset + 2] || "",
      group_name: role === "student" ? cols[offset + 3] || "" : "",
      password: cols[offset + 4] || (role !== "student" ? cols[offset + 3] : "") || undefined,
    });
  }
  return { users, errors };
}

export class AdminService {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditRepository,
    private readonly passwords: PasswordHasher,
    private readonly ids: IdGenerator,
  ) {}

  async listUsers(actor: Session | null): Promise<User[]> {
    if (!hasRole(actor, ["admin"])) throw new AppError("FORBIDDEN", "无权限", 403);
    return this.users.findAll({ includeAll: true });
  }

  private validateImported(item: ImportedUser, existing: User | undefined): void {
    const fields: Array<{ field: string; message: string }> = [];
    if (!(["student", "teacher", "admin"] as const).includes(item.role))
      fields.push({ field: "role", message: "用户角色无效" });
    if (!item.username || item.username.length > 60)
      fields.push({ field: "username", message: "账号长度必须为 1-60 个字符" });
    if (!item.name || item.name.length > 80)
      fields.push({ field: "name", message: "姓名长度必须为 1-80 个字符" });
    if (item.role !== "admin" && (!item.class_name || item.class_name.length > 80))
      fields.push({ field: "class_name", message: "班级长度必须为 1-80 个字符" });
    if (item.class_name.length > 80) fields.push({ field: "class_name", message: "班级名称过长" });
    if (item.group_name.length > 80) fields.push({ field: "group_name", message: "小组名称过长" });
    if (item.password !== undefined && (item.password.length < 6 || item.password.length > 72))
      fields.push({ field: "password", message: "临时密码长度必须为 6-72 个字符" });
    if (item.password === "123456")
      fields.push({ field: "password", message: "真实账号不能使用隔离演示密码" });
    if (!existing && item.password === undefined)
      fields.push({ field: "password", message: "新用户必须提供明确的临时密码" });
    if (fields.length)
      throw new AppError(
        "VALIDATION_ERROR",
        "导入用户数据无效",
        400,
        fields.map((field) => ({ ...field, code: "INVALID_FIELD" })),
      );
  }

  async upsert(
    actor: Session | null,
    imported: ImportedUser[],
    meta: { ip: string; ua: string },
  ): Promise<{ created: number; updated: number; total: number }> {
    if (!hasRole(actor, ["admin"])) throw new AppError("FORBIDDEN", "无权限", 403);
    const current = await this.users.findAll({ includeAll: true });
    const expectedUsers = current.map((user) => ({ ...user }));
    const byUsername = new Map(current.map((user, index) => [user.username, { user, index }]));
    let created = 0;
    let updated = 0;
    for (const item of imported) {
      const existing = byUsername.get(item.username);
      this.validateImported(item, existing?.user);
      const patch: Partial<User> = {
        role: item.role,
        username: item.username,
        name: item.name || item.username,
        class_name: item.class_name,
        group_name: item.group_name,
        status: "active" as const,
      };
      if (item.password !== undefined) {
        patch.passwordHash = this.passwords.hash(item.password);
        patch.defaultPassword = true;
        patch.password_reset_at = new Date().toISOString();
      }
      if (existing) {
        current[existing.index] = {
          ...existing.user,
          ...patch,
          updated_at: new Date().toISOString(),
        };
        updated += 1;
      } else {
        const user: User = {
          id: `u-${item.role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          role: item.role,
          username: item.username,
          name: item.name,
          class_name: item.class_name,
          group_name: item.group_name,
          status: "active",
          passwordHash: this.passwords.hash(item.password!),
          defaultPassword: true,
          password_reset_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        current.push(user);
        byUsername.set(user.username, { user, index: current.length - 1 });
        created += 1;
      }
    }
    try {
      await this.users.saveAll(current, expectedUsers);
    } catch (error) {
      if (!(error instanceof RepositoryConflictError)) throw error;
      throw new AppError("CONFLICT", "账号状态已改变，请重新读取后再导入。", 409);
    }
    await this.audit.write({
      actor: actor ?? undefined,
      action: "admin.users.upsert",
      targetType: "users",
      className: actor?.class_name,
      ...meta,
      ok: true,
      detail: { created, updated },
    });
    return { created, updated, total: imported.length };
  }

  async resetPassword(
    actor: Session | null,
    username: string,
    meta: { ip: string; ua: string },
  ): Promise<{ temporaryPassword: string }> {
    if (!hasRole(actor, ["admin"])) throw new AppError("FORBIDDEN", "无权限", 403);
    const user = await this.users.findByUsername(username);
    if (!user) throw new AppError("NOT_FOUND", "账号不存在", 404);
    const temporaryPassword = `Tmp-${this.ids.random(10)}`;
    await this.users.update(user.id, {
      passwordHash: this.passwords.hash(temporaryPassword),
      defaultPassword: true,
      password_reset_at: new Date().toISOString(),
    });
    await this.audit.write({
      actor: actor ?? undefined,
      action: "admin.password.reset",
      targetType: "user",
      targetId: user.id,
      className: user.class_name,
      ...meta,
      ok: true,
      detail: { username },
    });
    return { temporaryPassword };
  }
}
