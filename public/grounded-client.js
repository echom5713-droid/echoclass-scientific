(() => {
  "use strict";
  const ui = globalThis.EchoClassUI.text;
  const el = (id) => document.getElementById(`grounded-${id}`);
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const match = /^\/grounded-analysis\/runs\/([A-Za-z0-9_-]{1,128})$/.exec(location.pathname);
  if (!match) {
    el("status").textContent = ui("报告地址无效");
    return;
  }
  const id = match[1],
    endpoint = `/api/grounded-runs/${encodeURIComponent(id)}`;
  el("back").href = `/scientific-analysis/runs/${encodeURIComponent(id)}`;
  let userId = "",
    generation = 0,
    busy = false,
    blocked = false,
    modelAvailable = false;
  const controls = () => {
    el("explain").disabled = busy || blocked || !userId;
    el("topic").disabled = busy || blocked || !userId;
    el("model").disabled = busy || blocked || !modelAvailable;
  };
  const read = async (response) => {
    const value = await response.json();
    if (!response.ok || !value.ok)
      throw Error(
        value?.error?.message
          ? globalThis.EchoClassUI.error(value.error.message, value.error.code, response.status)
          : ui("报告解释读取失败"),
      );
    if (
      typeof value.user_id !== "string" ||
      !value.user_id ||
      (userId && value.user_id !== userId)
    ) {
      blocked = true;
      throw Error(ui("账号已变更，请刷新页面"));
    }
    userId = value.user_id;
    return value;
  };
  const clear = () => {
    generation++;
    el("answer").replaceChildren();
  };
  const render = (data) => {
    if (
      data.evidence?.run_id !== id ||
      !Array.isArray(data.cards) ||
      !Array.isArray(data.evidence.sources)
    )
      throw Error(ui("报告引用不匹配"));
    const sources = new Map(data.evidence.sources.map((source) => [source.id, source]));
    const sections = [];
    if (globalThis.EchoClassUI.language === "en")
      sections.push(
        node(
          "p",
          ui(
            "英文阅读说明来自同一组引用字段；展开查看封存原解释和原值。摘要对应原文与原值，不对应英文阅读说明。",
          ),
        ),
      );
    for (const card of data.cards) {
      if (
        !Array.isArray(card.citations) ||
        !card.citations.length ||
        card.citations.some((citation) => !sources.has(citation))
      )
        throw Error(ui("缺少报告依据"));
      const section = node("section");
      const reading =
        globalThis.EchoClassUI.language === "en"
          ? globalThis.EchoClassUI.readingCard(data.evidence, card)
          : card;
      section.append(node("h2", reading.title), node("p", reading.text));
      if (globalThis.EchoClassUI.language === "en") {
        const canonical = node("details");
        canonical.className = "canonical-copy";
        canonical.append(
          node("summary", ui("封存的原解释（摘要覆盖此原文）")),
          node("h3", card.title),
          node("p", card.text),
        );
        canonical.children[1].lang = "zh-CN";
        canonical.children[2].lang = "zh-CN";
        section.append(canonical);
      }
      for (const citation of card.citations) {
        const source = sources.get(citation),
          detail = node("details");
        detail.append(
          node("summary", ui("查看依据 [{0}]", citation)),
          node(
            "p",
            source.kind === "report"
              ? ui("封存报告字段 {0}", source.pointer)
              : ui("本项目版本化方法合同（不是外部实验验证）"),
          ),
          node("pre", JSON.stringify(source.value, null, 2)),
          node("p", ui("证据摘要 {0}", source.hash)),
        );
        section.append(detail);
      }
      sections.push(section);
    }
    sections.push(
      node("p", ui("证据包 {0}", data.evidence.evidence_hash)),
      node("p", ui("科学结果 {0}", data.evidence.scientific_result_hash)),
      node("p", ui("解释摘要 {0}", data.answer_hash)),
    );
    el("answer").replaceChildren(...sections);
  };
  el("topic").addEventListener("change", clear);
  el("model").addEventListener("change", clear);
  el("explain").addEventListener("click", async () => {
    if (busy || blocked || !userId) return;
    clear();
    const token = generation;
    busy = true;
    controls();
    el("status").textContent = ui("正在读取封存证据…");
    try {
      const data = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: el("topic").value, use_model: el("model").checked === true }),
      }).then(read);
      if (token !== generation) return;
      render(data);
      el("status").textContent =
        data.mode === "model-ranked"
          ? ui("模型仅调整了说明顺序；全部文字和数值来自本地证据。")
          : data.mode === "offline-fallback"
            ? ui("模型不可用或输出未通过检查，已使用本地证据顺序。")
            : ui("本地证据解释；未调用外部模型。");
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
      for (const [key, label] of Object.entries(data.topics)) {
        const option = node("option", ui(label));
        option.value = key;
        el("topic").append(option);
      }
      modelAvailable = data.model_available === true;
      el("model").checked = false;
      el("status").textContent = ui("请选择一个报告主题。");
      controls();
    })
    .catch((error) => {
      blocked = true;
      el("answer").replaceChildren();
      el("status").textContent = error.message;
      controls();
    });
})();
