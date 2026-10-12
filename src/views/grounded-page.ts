import { languageSwitch, type Language } from "../shared/language.js";
import { localizeOperationMarkup } from "../shared/operation-copy.js";

export function groundedPage(
  language: Language = "en",
  path = "/grounded-analysis/runs/unknown",
): string {
  return localizeOperationMarkup(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>报告解释 · EchoClass</title><link rel="stylesheet" href="/static/scientific.css"><link rel="stylesheet" href="/static/operation-language.css"><script src="/static/operation-language.js" defer></script><script src="/static/grounded-client.js" defer></script></head><body><main>
  ${languageSwitch(path, language)}
  <script src="/static/retrieval-client.js" defer></script><a id="grounded-back" href="/scientific-analysis">← 返回科学报告</a>
  <header><p class="eyebrow">封存报告 · 可核对的引用</p><h1>读懂这份报告</h1><p>选择一个主题，逐段查看解释和依据。这里不提供开放问答，也不会重新计算或改写报告。</p></header>
  <section><label for="grounded-topic">想了解什么？</label><select id="grounded-topic" disabled></select>
  <p><label><input id="grounded-model" type="checkbox" disabled>允许外部模型调整说明顺序</label></p><p id="grounded-model-note" class="quiet">默认不调用外部模型。启用时只发送主题和固定卡片标题，不发送实验值、姓名、备注或报告标识。文字和数值始终由本地证据生成。</p>
  <button id="grounded-explain" disabled>查看解释与依据</button></section>
  <p id="grounded-status" role="status" aria-live="polite">正在核实报告权限…</p>
  <article id="grounded-answer" aria-label="有来源的报告解释"></article>
  <section aria-labelledby="retrieval-title"><h2 id="retrieval-title">查阅项目资料</h2><p>输入方法或使用问题，例如“bootstrap 区间怎么计算”。仅搜索版本化项目指南并展示原文，不搜索互联网或上传文件，不调用外部模型；不要输入姓名、学号或联系方式。</p>
  <form id="retrieval-form"><label for="retrieval-question">问题（最多 500 字）</label><textarea id="retrieval-question" maxlength="500" rows="3" required disabled></textarea><button id="retrieval-submit" type="submit" disabled>查找资料与引用</button></form>
  <p id="retrieval-status" role="status" aria-live="polite">正在核实检索权限…</p><div id="retrieval-answer" aria-label="项目资料原文"></div></section>
  <p class="quiet">引用证明的是程序使用了哪些保存值与方法，不证明实验真实、独立、显著或最优。统计计算的独立审计和真实模型质量评测尚待完成。</p>
  </main></body></html>`,
    language,
  );
}
