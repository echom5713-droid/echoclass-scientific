import { languageSwitch, type Language } from "../shared/language.js";
import { localizeOperationMarkup } from "../shared/operation-copy.js";

export function scientificPage(language: Language = "en", path = "/scientific-analysis"): string {
  return localizeOperationMarkup(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>科学分析 · EchoClass</title><link rel="stylesheet" href="/static/scientific.css"><link rel="stylesheet" href="/static/operation-language.css"><script src="/static/operation-language.js" defer></script><script src="/static/scientific-client.js" defer></script></head><body><main>
  ${languageSwitch(path, language)}
  <a href="/">← EchoClass</a>
  <header><p class="eyebrow">实验记录 · 审阅 · 分析</p><h1>科学分析</h1><p>从班级当前记录建立一份固定快照，只分析教师已纳入的记录。之后修改记录或审阅，不会改写这份报告。</p></header>
  <section aria-labelledby="scientific-start-title"><h2 id="scientific-start-title">选择班级</h2>
  <label for="scientific-class">班级</label><select id="scientific-class" disabled><option value="">正在读取…</option></select>
  <p id="scientific-availability"></p><div class="actions"><button id="scientific-create" disabled>分析当前数据</button><button id="scientific-new" class="secondary" disabled>重新分析当前数据</button><button id="scientific-reload" class="secondary" disabled>刷新</button></div>
  <p id="scientific-attempt" class="quiet">正在读取分析标识…</p><p class="quiet">响应中断后，点击重试会读取原任务。只有确认“重新分析当前数据”，才会为当前记录建立另一份快照。</p></section>
  <p id="scientific-status" role="status" aria-live="polite">正在读取分析记录…</p>
  <section aria-labelledby="scientific-history-title"><h2 id="scientific-history-title">最近的分析</h2><ul id="scientific-runs" class="run-list"></ul></section>
  <article id="scientific-report" aria-label="已保存的科学分析报告"></article>
  <section id="scientific-reproduction" hidden><div class="actions"><h2>复算这份快照</h2><button id="scientific-reproduce" class="secondary" disabled>复算并核对</button></div><p class="quiet">重新读取同一份封存输入和配置。此操作不改写已保存报告；跨环境比较会单独标明。</p><div id="scientific-reproduction-result"></div></section>
  </main></body></html>`,
    language,
  );
}
