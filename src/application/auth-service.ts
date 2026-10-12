import { AppError } from "./errors.js";
import { RepositoryConflictError } from "../domain/repositories.js";
import type { IdGenerator, PasswordHasher } from "./ports.js";
import type {
  AuditRepository,
  LoginAttemptRepository,
  SessionRepository,
  UserRepository,
} from "../domain/repositories.js";
import type { Session, User, UserRole } from "../domain/types.js";

export interface RequestMetadata {
  ip: string;
  ua: string;
  route: string;
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly attempts: LoginAttemptRepository,
    private readonly audit: AuditRepository,
    private readonly passwords: PasswordHasher,
    private readonly ids: IdGenerator,
  ) {}

  async login(
    input: { role: UserRole; username: string; password: string },
    meta: RequestMetadata,
  ): Promise<{ user: User; sid: string }> {
    const key = `${meta.ip}:${input.username.toLowerCase()}:${meta.route}`;
    const limit = await this.attempts.check(key);
    if (!limit.ok) {
      await this.audit.write({
        action: "auth.login.rate_limited",
        targetType: "user",
        targetId: input.username,
        ip: meta.ip,
        ua: meta.ua,
        ok: false,
        detail: { retryAfter: limit.retryAfter },
      });
      throw new AppError(
        "RATE_LIMITED",
        `尝试次数过多，请 ${limit.retryAfter ?? 1} 秒后再试。`,
        429,
      );
    }

    const user = await this.users.findByUsername(input.username);
    if (
      !user ||
      user.role !== input.role ||
      user.status === "disabled" ||
      !this.passwords.verify(input.password, user.passwordHash)
    ) {
      await this.attempts.register({
        key,
        ip: meta.ip,
        route: meta.route,
        username: input.username,
      });
      await this.audit.write({
        action: "auth.login.failed",
        targetType: "user",
        targetId: input.username,
        ip: meta.ip,
        ua: meta.ua,
        ok: false,
        detail: { role: input.role },
      });
      throw new AppError("AUTHENTICATION_REQUIRED", "账号或密码不正确。", 401);
    }

    await this.attempts.clear(key);
    const sid = this.ids.random(32);
    try {
      await this.sessions.create({
        sidHash: this.ids.hashSession(sid),
        user,
        ip: meta.ip,
        ua: meta.ua,
      });
    } catch (error) {
      if (!(error instanceof RepositoryConflictError)) throw error;
      throw new AppError("AUTHENTICATION_REQUIRED", "账号状态已改变，请重新登录。", 401);
    }
    await this.audit.write({
      actor: user,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      className: user.class_name,
      ip: meta.ip,
      ua: meta.ua,
      ok: true,
    });
    return { user, sid };
  }

  async logout(sid: string): Promise<void> {
    if (sid) await this.sessions.revoke(this.ids.hashSession(sid));
  }

  async sessionFor(sid: string): Promise<Session | null> {
    return sid ? this.sessions.find(this.ids.hashSession(sid)) : null;
  }

  async changePassword(
    actor: Session | null,
    oldPassword: string,
    newPassword: string,
    meta: RequestMetadata,
  ): Promise<void> {
    const currentSession = actor?.sidHash ? await this.sessions.find(actor.sidHash) : null;
    if (!actor || !currentSession || currentSession.id !== actor.id)
      throw new AppError("AUTHENTICATION_REQUIRED", "登录已失效，请重新登录", 401);
    const user = await this.users.findById(actor.id);
    if (
      !user ||
      user.status === "disabled" ||
      !this.passwords.verify(oldPassword, user.passwordHash)
    ) {
      await this.audit.write({
        actor,
        action: "auth.password.change_failed",
        targetType: "user",
        targetId: actor.id,
        ip: meta.ip,
        ua: meta.ua,
        ok: false,
      });
      throw new AppError("VALIDATION_ERROR", "当前密码不正确", 400);
    }
    if (
      newPassword.length < 6 ||
      newPassword.length > 72 ||
      newPassword === oldPassword ||
      (user.status !== "demo" && newPassword === "123456")
    )
      throw new AppError(
        "VALIDATION_ERROR",
        "请设置与当前密码不同的 6–72 位新密码，不能使用演示密码。",
        400,
      );
    const changed = await this.users.changePassword({
      userId: user.id,
      sidHash: actor.sidHash!,
      expectedPasswordHash: user.passwordHash,
      passwordHash: this.passwords.hash(newPassword),
      changedAt: new Date().toISOString(),
    });
    if (!changed) throw new AppError("CONFLICT", "账号凭据已改变，请重新登录后再试。", 409);
    await this.audit.write({
      actor,
      action: "auth.password.changed",
      targetType: "user",
      targetId: user.id,
      className: user.class_name,
      ip: meta.ip,
      ua: meta.ua,
      ok: true,
    });
  }
}
