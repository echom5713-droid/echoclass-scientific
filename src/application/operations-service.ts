import { hasRole } from "../domain/authorization.js";
import type { MetricsRepository } from "../domain/repositories.js";
import type { Session } from "../domain/types.js";
import { APP_NAME, APP_VERSION, PROCESS_STARTED_AT } from "../config/constants.js";
import type { AIService } from "./ai-service.js";
import { AppError } from "./errors.js";

export class OperationsService {
  constructor(
    private readonly metrics: MetricsRepository,
    private readonly ai: AIService,
    private readonly storageMode: string,
  ) {}

  health() {
    const provider = this.ai.status();
    return {
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      processStartedAt: PROCESS_STARTED_AT,
      uptime: Number(process.uptime().toFixed(1)),
      storage: this.storageMode,
      dbMode: this.storageMode,
      security: {
        password_hashing: "scrypt",
        persistent_sessions: this.storageMode === "sqlite",
        http_only_cookie: true,
        same_site_cookie: "Lax",
        origin_guard: true,
        login_rate_limit: this.storageMode === "sqlite",
        security_headers: true,
        request_ids: true,
      },
      optional_external_provider: true,
      external_provider_configured: provider.configured,
      external_provider: provider.provider,
      mainland_ready: true,
      generated_at: new Date().toISOString(),
    };
  }

  providerStatus() {
    return this.ai.status();
  }

  async operationalMetrics(actor: Session | null) {
    if (!actor) throw new AppError("AUTHENTICATION_REQUIRED", "请先登录", 401);
    if (!hasRole(actor, ["admin"])) throw new AppError("FORBIDDEN", "无权限", 403);
    return {
      ok: true,
      version: APP_VERSION,
      processStartedAt: PROCESS_STARTED_AT,
      ...(await this.metrics.read()),
    };
  }
}
