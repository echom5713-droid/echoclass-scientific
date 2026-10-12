import type { AuditRepository } from "../domain/repositories.js";
import {
  buildEvidence,
  parseGroundedCommand,
  TOPICS,
  validateCardOrder,
  type GroundedTopic,
} from "../domain/grounded/evidence.js";
import { canonicalHash } from "../domain/scientific/canonical.js";
import type { ScientificContext } from "../domain/scientific/contract.js";
import { AppError } from "./errors.js";
import type { RateLimiter } from "./ports.js";
import type { ScientificService } from "./scientific-service.js";
import {
  parseRetrievalCommand,
  retrieveAnswer,
  type DocumentRetriever,
} from "../domain/grounded/retrieval.js";

export interface GroundedRanker {
  configured(): boolean;
  rank(input: { topic: GroundedTopic; cards: { id: string; title: string }[] }): Promise<string>;
}
export class GroundedService {
  constructor(
    private readonly scientific: Pick<ScientificService, "gate" | "get">,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditRepository,
    private readonly ranker: GroundedRanker | null = null,
    private readonly retriever: DocumentRetriever | null = null,
  ) {}

  context(context: ScientificContext, id: string) {
    const actor = this.scientific.gate(context),
      run = this.scientific.get(context, id);
    if (run.status !== "completed" || !run.result)
      throw new AppError("CONFLICT", "请先选择已完成的科学报告", 409);
    return { actor, run };
  }
  options(context: ScientificContext, id: string) {
    const { actor, run } = this.context(context, id);
    return {
      user_id: actor.id,
      run_id: run.id,
      topics: TOPICS,
      model_available: this.ranker?.configured() === true,
      retrieval_available: this.retriever !== null,
    };
  }
  async sources(context: ScientificContext, id: string, raw: unknown) {
    const { actor } = this.context(context, id);
    let question: string;
    try {
      question = parseRetrievalCommand(raw);
    } catch {
      throw new AppError(
        "VALIDATION_ERROR",
        "请输入 1–500 字的问题，不接受附加资料、控制字符或其他字段",
        400,
      );
    }
    if (!this.limiter.allow(actor.id))
      throw new AppError("RATE_LIMITED", "报告解释请求过于频繁，请稍后重试", 429);
    if (!this.retriever) throw new AppError("STORAGE_UNAVAILABLE", "项目资料检索不可用", 503);
    let result;
    try {
      result = retrieveAnswer(question, this.retriever);
    } catch {
      throw new AppError("STORAGE_UNAVAILABLE", "项目资料完整性检查未通过", 503);
    }
    await this.audit.write({
      actor: context.actor ?? undefined,
      action: "grounded.retrieve",
      targetType: "analysis_run",
      targetId: id,
      ip: context.ip,
      ua: context.ua,
      ok: true,
      detail: {
        status: result.status,
        corpus_version: result.corpus_version,
        answer_hash: result.answer_hash,
        chunk_ids: result.citations.map((source) => source.chunk_id).join(","),
        pii_redacted: result.pii_redacted,
      },
    });
    this.context(context, id);
    return { user_id: actor.id, run_id: id, ...result };
  }
  async explain(context: ScientificContext, id: string, raw: unknown) {
    const { actor, run } = this.context(context, id);
    let command;
    try {
      command = parseGroundedCommand(raw);
    } catch {
      throw new AppError("VALIDATION_ERROR", "请选择支持的报告主题；不接受自由问题或外部证据", 400);
    }
    if (!this.limiter.allow(actor.id))
      throw new AppError("RATE_LIMITED", "报告解释请求过于频繁，请稍后重试", 429);
    let evidence;
    try {
      evidence = buildEvidence(run, command.topic);
    } catch {
      throw new AppError("STORAGE_UNAVAILABLE", "报告证据完整性检查未通过", 503);
    }
    let cards = evidence.cards;
    let mode: "deterministic" | "model-ranked" | "offline-fallback" = "deterministic";
    let reason: "not_requested" | "model_unavailable" | "invalid_or_unavailable_model" | null =
      "not_requested";
    if (command.use_model) {
      mode = "offline-fallback";
      reason = "model_unavailable";
      if (this.ranker?.configured()) {
        try {
          const rawOrder = await this.ranker.rank({
            topic: command.topic,
            cards: cards.map(({ id, title }) => ({ id, title })),
          });
          const order = validateCardOrder(rawOrder, cards);
          cards = order.map((id) => cards.find((card) => card.id === id)!);
          mode = "model-ranked";
          reason = null;
        } catch {
          reason = "invalid_or_unavailable_model";
        }
        // An upstream wait cannot preserve an old authorization decision.
        this.context(context, id);
      }
    }
    const answer_hash = canonicalHash({ evidence_hash: evidence.evidence_hash, cards });
    await this.audit.write({
      actor: context.actor ?? undefined,
      action: "grounded.explain",
      targetType: "analysis_run",
      targetId: id,
      ip: context.ip,
      ua: context.ua,
      ok: true,
      detail: {
        topic: command.topic,
        mode,
        reason,
        evidence_hash: evidence.evidence_hash,
        answer_hash,
      },
    });
    this.context(context, id);
    return { user_id: actor.id, mode, reason, evidence, cards, answer_hash };
  }
}
