import type { AIProvider } from "../../application/ports.js";
import type { AIQuestion, AIResponse } from "../../domain/types.js";
import type { AppEnv } from "../../config/env.js";

const SCENE_HINTS: Record<string, string> = {
  preview: "当前场景是课前预习。只讲解原理、变量控制和预习要点，不剧透实验结果。",
  review: "当前场景是课后答疑。帮助分析数据、现象、误差与证据链。",
  discuss: "当前场景是拓展探究。保持高中可理解范围并鼓励跨学科思考。",
  _record_diagnosis: "根据学生数据给出2-4句话的个性化诊断，关注得率、分层、乳化、污染与抑菌观察。",
  _class_summary: "根据班级摘要分点说明整体表现、共性问题和下节课建议。",
};

export function localAnswer(question: string): string {
  if (/NH4|NH₄|氯化铵|盐析/i.test(question))
    return "NH₄Cl 会提高水相离子强度，使疏水性的精油成分更易与水相分离。请结合 0% 对照和重复实验判断盐析条件的影响。";
  if (question.includes("乳化"))
    return "乳化表示油滴暂时分散在水相中。可从搅拌强度、静置时间、杂质和乳化剂等因素复核，并与同浓度平行数据比较。";
  if (/抑菌|大肠杆菌|E\. coli|菌/.test(question))
    return "抑菌观察应比较空白、乳化剂和精油乳液对照。抑菌圈大小还受扩散性、边缘清晰度和污染影响，不能据单次结果作绝对结论。";
  if (/得率|偏高|偏低/.test(question))
    return "请先复核原料质量、容器皮重、混入水分、蒸馏时间和分层情况，再结合平行实验与组内数据解释得率。";
  return "建议按“变量—现象—证据—结论”分析：确认改变的条件，描述观察结果，用数据和对照支持判断，并说明可能误差。";
}

interface ProviderPayload {
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class DeepSeekProvider implements AIProvider {
  constructor(private readonly config: AppEnv) {}

  status(): ReturnType<AIProvider["status"]> {
    return {
      configured: Boolean(this.config.deepseekApiKey),
      provider: "deepseek",
      model: this.config.deepseekModel,
      base: this.config.deepseekBaseUrl,
      timeoutMs: this.config.deepseekTimeoutMs,
    };
  }

  async ask(input: AIQuestion): Promise<AIResponse> {
    if (!this.config.deepseekApiKey)
      return {
        answer: localAnswer(input.question),
        mode: "local-fallback",
        reason: "missing_api_key",
      };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.deepseekTimeoutMs);
    try {
      const system = `你是 EchoClass 高中自然科学探究课程助手。用中文准确、简洁、启发式回答；按变量—现象—证据—结论组织；不提供危险微生物培养步骤。${SCENE_HINTS[input.scene] ?? ""}`;
      const response = await fetch(
        `${this.config.deepseekBaseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: this.config.deepseekModel,
            messages: [
              { role: "system", content: system },
              ...input.history,
              { role: "user", content: input.question },
            ],
            temperature: 0.35,
            max_tokens: this.config.deepseekMaxTokens,
          }),
        },
      );
      if (!response.ok)
        return {
          answer: localAnswer(input.question),
          mode: "local-fallback",
          reason: "deepseek_error",
        };
      const payload = (await response.json()) as ProviderPayload;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim())
        return {
          answer: localAnswer(input.question),
          mode: "local-fallback",
          reason: "invalid_provider_response",
        };
      return {
        answer: content.slice(0, 8_000),
        mode: "deepseek-proxy",
        model: this.config.deepseekModel,
      };
    } catch {
      return {
        answer: localAnswer(input.question),
        mode: "local-fallback",
        reason: "deepseek_error",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
