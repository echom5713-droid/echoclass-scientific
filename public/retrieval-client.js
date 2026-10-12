(() => {
  "use strict";
  const ui = globalThis.EchoClassUI.text;
  const el = (id) => document.getElementById(`retrieval-${id}`);
  const node = (tag, text) => {
    const item = document.createElement(tag);
    item.textContent = String(text);
    return item;
  };
  const match = /^\/grounded-analysis\/runs\/([A-Za-z0-9_-]{1,128})$/.exec(location.pathname);
  if (!match) {
    el("status").textContent = ui("报告地址无效");
    return;
  }
  const id = match[1],
    endpoint = `/api/grounded-runs/${encodeURIComponent(id)}`;
  let user = "",
    busy = false,
    blocked = false,
    generation = 0;
  const controls = () => {
    el("submit").disabled = busy || blocked || !user;
    el("question").disabled = blocked || !user;
  };
  const clear = () => {
    generation++;
    el("answer").replaceChildren();
  };
  const read = async (response) => {
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw Error(
        data?.error?.message
          ? globalThis.EchoClassUI.error(data.error.message, data.error.code, response.status)
          : ui("检索失败，请重试"),
      );
    if (!data.user_id || typeof data.user_id !== "string" || (user && data.user_id !== user)) {
      blocked = true;
      throw Error(ui("账号已变更，请刷新页面"));
    }
    user = data.user_id;
    return data;
  };
  el("question").addEventListener("input", clear);
  el("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || blocked || !user) return;
    clear();
    const token = generation;
    busy = true;
    controls();
    el("status").textContent = ui("正在查阅项目资料…");
    try {
      const data = await fetch(`${endpoint}/sources`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: el("question").value }),
      }).then(read);
      if (token !== generation) return;
      if (
        data.run_id !== id ||
        data.provider !== "local-extractive" ||
        !Array.isArray(data.citations) ||
        !data.corpus_version ||
        !data.answer_hash
      )
        throw Error(ui("资料引用不匹配"));
      const items = [node("p", ui(data.answer))];
      if (globalThis.EchoClassUI.language === "en") {
        items.push(node("p", ui("引用原文保留其原始语言；摘要对应未翻译的回答与引用。")));
        const canonical = document.createElement("details");
        canonical.className = "canonical-copy";
        canonical.append(
          node("summary", ui("封存的检索回答（摘要覆盖此原文）")),
          node("p", data.answer),
        );
        items.push(canonical);
      }
      for (const source of data.citations) {
        if (
          !source.document_id ||
          !source.chunk_id ||
          !source.content_hash ||
          typeof source.content !== "string"
        )
          throw Error(ui("资料引用不完整"));
        const section = document.createElement("section");
        section.append(
          node("h3", source.title),
          node("blockquote", source.content),
          node("p", `${source.document_id} / ${source.chunk_id} · v${source.version}`),
          node("p", ui("来源：{0}", source.source)),
          node("p", ui("原文摘要：{0}", source.content_hash)),
        );
        items.push(section);
      }
      for (const limitation of data.limitations || []) items.push(node("p", ui(limitation)));
      items.push(
        node("p", ui("资料版本：{0}", data.corpus_version)),
        node("p", ui("回答摘要：{0}", data.answer_hash)),
      );
      el("answer").replaceChildren(...items);
      el("status").textContent = data.pii_redacted
        ? ui("已移除识别到的个人信息；本地检索，未调用外部模型。")
        : ui("本地检索完成，未调用外部模型。");
    } catch (error) {
      if (token === generation) {
        el("answer").replaceChildren();
        el("status").textContent = error.message;
      }
    } finally {
      busy = false;
      controls();
    }
  });
  fetch(endpoint, { cache: "no-store" })
    .then(read)
    .then((data) => {
      if (!data.retrieval_available) throw Error(ui("项目资料检索不可用"));
      el("status").textContent = ui("可输入项目方法或使用问题。");
      controls();
    })
    .catch((error) => {
      blocked = true;
      clear();
      el("status").textContent = error.message;
      controls();
    });
})();
