import { languageSwitch, type Language } from "../shared/language.js";
import { localizeOperationMarkup } from "../shared/operation-copy.js";

export function evidencePage(language: Language = "en", path = "/evidence"): string {
  return localizeOperationMarkup(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>实验附件 · EchoClass</title><link rel="stylesheet" href="/static/evidence.css"><link rel="stylesheet" href="/static/operation-language.css"><script src="/static/operation-language.js" defer></script><script src="/static/evidence-client.js" defer></script></head><body><main>
  ${languageSwitch(path, language)}
  <a href="/">← EchoClass</a><h1>实验附件</h1><p id="evidence-target"></p>
  <p>平台从文件实际上传成功时开始保管，接收时间见下方列表。后来补交的附件不能证明此前实验或浏览器测量使用了此文件，也不证明实验真实性或素材权利。</p>
  <section><h2>添加附件</h2><p id="evidence-policy"></p><label>选择文件 <input id="evidence-file" type="file" disabled></label>
  <div class="actions"><button id="evidence-prepare" disabled>检查文件</button><button id="evidence-upload" disabled>上传 / 重试</button><button id="evidence-new" disabled>开始另一次上传</button></div>
  <p id="evidence-selection">尚未选择文件</p><p>响应中断或刷新后，请重新选择同一文件并检查，再点击重试。切换文件不会清除已保存的重试标识。只有确认“开始另一次上传”才会替换该文件的标识，相同文件可能因此保存多份。</p></section>
  <p id="evidence-status" role="status" aria-live="polite">正在读取附件…</p>
  <section><div class="actions"><h2>已保存附件</h2><button id="evidence-reload" disabled>刷新列表</button></div><p>附件仅供下载，不在此页面预览。归档会保留文件与接收记录，学生无法查看已归档附件。</p><ul id="evidence-list"></ul></section>
  </main></body></html>`,
    language,
  );
}
