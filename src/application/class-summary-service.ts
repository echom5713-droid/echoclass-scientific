import { hasRole } from "../domain/authorization.js";
import { analyticsFor } from "../domain/experiments/analytics.js";
import type { AuditRepository } from "../domain/repositories.js";
import type { Session } from "../domain/types.js";
import type { AIService } from "./ai-service.js";
import { AppError } from "./errors.js";
import type { ExperimentService } from "./experiment-service.js";
import type { PracticeService } from "./practice-service.js";

export class ClassSummaryService {
  constructor(
    private readonly experiments: ExperimentService,
    private readonly practice: PracticeService,
    private readonly ai: AIService,
    private readonly audit: AuditRepository,
  ) {}

  async generate(actor: Session | null, meta: { ip: string; ua: string }) {
    if (!hasRole(actor, ["teacher", "admin"])) throw new AppError("FORBIDDEN", "无权限", 403);
    const records = await this.experiments.list(actor);
    const answers = await this.practice.results(actor);
    const analytics = analyticsFor(records);
    const correct = answers.filter((answer) => answer.correct).length;
    const groups = analytics.stats.map(
      (item) =>
        `NH₄Cl ${item.conc}% 组：n=${item.count}，平均得率 ${item.meanYield.toFixed(2)}%，标准差 ${item.stdYield.toFixed(2)}，平均抑菌圈 ${item.meanZone.toFixed(1)}mm`,
    );
    const prompt = [
      `班级数据摘要：提交记录 ${analytics.count} 份，有效 ${analytics.validCount} 份，疑似异常 ${analytics.reviewCount} 份。`,
      ...groups,
      `习题作答：共 ${answers.length} 次，正确 ${correct} 次，正确率 ${answers.length ? ((correct / answers.length) * 100).toFixed(1) : 0}%`,
    ].join("\n");
    const result = await this.ai.askSafely(
      { question: prompt, scene: "_class_summary", history: [] },
      `${meta.ip}:${actor?.id}:summary`,
    );
    await this.audit.write({
      actor: actor ?? undefined,
      action: "ai.class_summary",
      targetType: "class",
      targetId: actor?.class_name ?? "",
      className: actor?.class_name,
      ...meta,
      ok: result.mode === "deepseek-proxy",
      detail: { mode: result.mode, reason: result.reason },
    });
    return { summary: result.answer, mode: result.mode, generated_at: new Date().toISOString() };
  }
}
