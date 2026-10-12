import type { AuditRepository } from "../domain/repositories.js";
import type { AIHistoryItem, AIQuestion, AIResponse, Session } from "../domain/types.js";
import { AppError } from "./errors.js";
import type { AIProvider, RateLimiter } from "./ports.js";

export function redactSupportedPii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(/\b(?:student|teacher)\d{3,}\b/gi, "[REDACTED_ACCOUNT]")
    .replace(/(?<!\d)\d{6,12}(?!\d)/g, "[REDACTED_ID]");
}

export class AIService {
  constructor(
    private readonly provider: AIProvider,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditRepository,
  ) {}

  status(): { configured: boolean; provider: string; model: string } {
    const { configured, provider, model } = this.provider.status();
    return { configured, provider, model };
  }

  sanitize(input: AIQuestion): AIQuestion {
    const question = redactSupportedPii(input.question.trim()).slice(0, 2000);
    if (!question) throw new AppError("VALIDATION_ERROR", "请输入问题", 400);
    const history: AIHistoryItem[] = input.history.slice(-8).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: redactSupportedPii(item.content).slice(0, 1000),
    }));
    return { question, history, scene: input.scene.slice(0, 50) };
  }

  async askSafely(input: AIQuestion, rateKey: string): Promise<AIResponse> {
    const safe = this.sanitize(input);
    if (!this.limiter.allow(rateKey))
      throw new AppError("RATE_LIMITED", "AI 请求过于频繁，请稍后再试", 429);
    try {
      const result = await this.provider.ask(safe);
      if (!result.answer.trim())
        return {
          answer: "AI 服务暂时不可用，请稍后再试。",
          mode: "local-fallback",
          reason: "invalid_provider_response",
        };
      return result;
    } catch {
      return {
        answer: "AI 服务暂时不可用，请稍后再试。",
        mode: "local-fallback",
        reason: "deepseek_error",
      };
    }
  }

  async ask(
    input: AIQuestion,
    actor: Session | null,
    meta: { ip: string; ua: string },
  ): Promise<AIResponse> {
    const safe = this.sanitize(input);
    const result = await this.askSafely(safe, `${meta.ip}:${actor?.id ?? "guest"}`);
    await this.audit.write({
      actor: actor ?? undefined,
      action: "ai.ask",
      targetType: "question",
      className: actor?.class_name,
      ip: meta.ip,
      ua: meta.ua,
      ok: result.mode === "deepseek-proxy",
      detail: {
        characterCount: safe.question.length,
        scene: safe.scene,
        mode: result.mode,
        reason: result.reason,
      },
    });
    return result;
  }
}
