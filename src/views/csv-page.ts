import { languageSwitch, type Language } from "../shared/language.js";
import { localizeOperationMarkup } from "../shared/operation-copy.js";

export function csvPage(language: Language = "en", path = "/csv"): string {
  return localizeOperationMarkup(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CSV 实验数据 · EchoClass</title><link rel="stylesheet" href="/static/csv.css"><link rel="stylesheet" href="/static/operation-language.css"><script src="/static/operation-language.js" defer></script><script src="/static/csv-client.js" defer></script></head><body><main>
  ${languageSwitch(path, language)}
  <a href="/">← EchoClass</a><h1>CSV 实验数据</h1><p>选择现存班级，下载固定模板并填写观测。每次最多 500 条、1 MiB，整文件全部成功或全部失败。</p>
  <section><label>目标班级 <select id="csv-class" disabled></select></label><a href="/api/csv/template">下载空白模板</a><label>UTF-8 CSV 文件 <input id="csv-file" type="file" accept=".csv,text/csv" disabled></label>
  <div class="actions"><button id="csv-preview" disabled>验证并预览</button><button id="csv-commit" disabled>整批提交 / 重试</button><button id="csv-new" disabled>开始另一次导入</button></div>
  <p>网络中断或刷新后，请重新选择同一文件并预览，再点击重试；系统会恢复本次导入标识。另一次导入会创建另一批记录，可能产生重复观测。</p></section>
  <p id="csv-status" role="status" aria-live="polite">正在加载班级…</p><ul id="csv-errors"></ul><div class="table-wrap"><table id="csv-table"></table></div>
  <section><h2>导入回执</h2><pre id="csv-receipt">尚无回执</pre><p>回执保存摘要与行到记录的映射。导入不会自动保存原始 CSV；可从当前回执随后附上字节完全一致的原文件。文件从实际上传成功时开始保管，不追溯至导入时间。</p><button id="csv-reload-receipt" disabled>读取当前回执</button> <a id="csv-evidence-link" hidden>查看 / 附上原 CSV 文件</a></section>
  <section><h2>导出当前班级</h2><p>展示 CSV 包含当前有效记录及其实际审阅状态。危险文本带 text: 前缀；它不是导入模板、原件或分析快照。</p><button id="csv-export" disabled>下载表格 CSV</button></section>
  </main></body></html>`,
    language,
  );
}
