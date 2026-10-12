(() => {
  "use strict";
  const ui = globalThis.EchoClassUI.text;
  const schema = "echoclass.csv.experiment.v1";
  const el = (name) => document.getElementById(`csv-${name}`);
  const classSelect = el("class");
  const fileInput = el("file");
  let userId = "",
    bytes = null,
    preview = null,
    attempt = null,
    receipt = null,
    busy = false;
  const status = (message) => {
    el("status").textContent = message;
  };
  const controls = () => {
    const ready = Boolean(userId && classSelect.value);
    classSelect.disabled = busy || !userId;
    fileInput.disabled = busy || !ready;
    el("preview").disabled = busy || !ready || !fileInput.files[0];
    el("commit").disabled = busy || !preview?.valid || !attempt || !bytes;
    el("new").disabled = busy || !preview?.valid || !bytes;
    el("export").disabled = busy || !ready;
    el("reload-receipt").disabled = busy || !receipt;
  };
  const legacyKey = () => `echoclass.csv.attempt.v1:${userId}`;
  const attemptFacts = () => ({
    user_id: userId,
    class_id: preview.class_id,
    schema,
    sha: preview.raw_sha256,
  });
  const key = (value) =>
    `echoclass.csv.attempt.v2:${JSON.stringify([value.user_id, value.class_id, value.schema, value.sha])}`;
  const matches = (prior, facts) =>
    prior.user_id === userId &&
    prior.class_id === facts.class_id &&
    prior.schema === facts.schema &&
    prior.sha === facts.sha;
  const cachedAttempt = (raw) => {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      /* A damaged cache must not silently become a new import. */
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !["user_id", "class_id", "schema"].every(
        (field) => typeof value[field] === "string" && value[field],
      ) ||
      typeof value.sha !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.sha) ||
      typeof value.token !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(value.token)
    )
      throw new Error(
        ui("已保存的导入标识损坏。若要创建另一批记录，请点击“开始另一次导入”并确认。"),
      );
    return value;
  };
  const restoreAttempt = (facts) => {
    let current, legacy;
    try {
      current = sessionStorage.getItem(key(facts));
      if (current === null) legacy = sessionStorage.getItem(legacyKey());
    } catch {
      throw new Error(ui("无法读取已保存的重试标识。请恢复会话存储后重新预览。"));
    }
    if (current !== null) {
      const value = cachedAttempt(current);
      if (!matches(value, facts))
        throw new Error(
          ui("已保存的导入标识不匹配。若要创建另一批记录，请点击“开始另一次导入”并确认。"),
        );
      return { ...facts, token: value.token };
    }
    if (legacy !== null) {
      const value = cachedAttempt(legacy);
      if (matches(value, facts)) return { ...facts, token: value.token };
    }
    return null;
  };
  const saveAttempt = (value = attempt) => {
    try {
      sessionStorage.setItem(key(value), JSON.stringify(value));
    } catch {
      throw new Error(
        ui("无法保存重试标识，会话存储可能已满或不可用。旧标识未清除；请恢复存储后重试。"),
      );
    }
  };
  const invalidate = () => {
    bytes = null;
    preview = null;
    attempt = null;
    el("errors").replaceChildren();
    el("table").replaceChildren();
    status(ui("目标或文件已变更，请重新预览。原导入标识仍可在重新选择同一文件时恢复。"));
    controls();
  };
  const showErrors = (errors) => {
    el("errors").replaceChildren();
    for (const error of errors ?? []) {
      const li = document.createElement("li");
      li.textContent = `${error.row_number == null ? ui("文件") : ui("数据行 {0}", error.row_number)} · ${error.field}: ${globalThis.EchoClassUI.error(error.message, error.code)}`;
      el("errors").append(li);
    }
  };
  const readJson = async (response) => {
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showErrors(data.error?.fields);
      throw new Error(
        data.error?.message
          ? globalThis.EchoClassUI.error(data.error.message, data.error.code, response.status)
          : ui("请求失败（{0}）", response.status),
      );
    }
    return data;
  };
  const run = async (action) => {
    if (busy) return;
    busy = true;
    controls();
    try {
      if (userId) {
        const current = await fetch("/api/csv/classes").then(readJson);
        if (current.user_id !== userId) {
          invalidate();
          userId = "";
          receipt = null;
          el("receipt").textContent = ui("账号已变更");
          if (el("evidence-link")) el("evidence-link").hidden = true;
          throw new Error(ui("账号已变更，请刷新页面后重新选择班级和文件。"));
        }
      }
      await action();
    } catch (error) {
      status(error.message || ui("网络响应不确定，请保留当前文件并使用同一导入标识重试。"));
    } finally {
      busy = false;
      controls();
    }
  };
  const request = (path, extra = {}) =>
    fetch(`/api/csv/${path}?class_id=${encodeURIComponent(classSelect.value)}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "X-EchoClass-Csv-Schema": schema,
        ...extra,
      },
      body: bytes,
    }).then(readJson);
  const showReceipt = (value) => {
    receipt = value;
    el("receipt").textContent = JSON.stringify(value, null, 2);
    const evidenceLink = el("evidence-link");
    if (evidenceLink) {
      evidenceLink.href = `/evidence?batch_id=${encodeURIComponent(value.batch_id)}`;
      evidenceLink.hidden = false;
    }
  };
  classSelect.addEventListener("change", invalidate);
  fileInput.addEventListener("change", invalidate);
  el("preview").addEventListener("click", () =>
    run(async () => {
      preview = null;
      attempt = null;
      bytes = null;
      showErrors([]);
      el("table").replaceChildren();
      const file = fileInput.files[0];
      if (!file || file.size > 1048576) throw new Error(ui("请选择不超过 1 MiB 的 CSV 文件。"));
      bytes = await file.arrayBuffer();
      const result = await request("preview");
      preview = result;
      showErrors(result.errors);
      const head = document.createElement("tr");
      for (const value of [ui("数据行"), ...result.headers]) {
        const cell = document.createElement("th");
        cell.textContent = value;
        head.append(cell);
      }
      el("table").append(head);
      for (const row of result.preview) {
        const tr = document.createElement("tr");
        for (const value of [row.row_number, ...row.values]) {
          const td = document.createElement("td");
          td.textContent = String(value);
          tr.append(td);
        }
        el("table").append(tr);
      }
      if (result.valid) {
        const facts = attemptFacts();
        const prior = restoreAttempt(facts);
        attempt = prior ?? { ...facts, token: crypto.randomUUID() };
        try {
          saveAttempt();
        } catch (error) {
          attempt = null;
          throw error;
        }
        status(
          ui(
            "{0}：{1} 条全部通过验证（展示前 {2} 条）。全部成功或全部失败。{3}",
            result.class_name,
            result.row_count,
            result.preview.length,
            prior ? ui("已恢复同一导入标识；可安全重试。") : ui("可以整批提交。"),
          ),
        );
      } else
        status(
          ui(
            "{0} 条已全部验证，发现 {1} 个错误{2}。没有导入任何记录，请修正文件。",
            result.row_count,
            result.error_count,
            result.errors_truncated ? ui("（仅展示前 100 个）") : "",
          ),
        );
    }),
  );
  el("commit").addEventListener("click", () =>
    run(async () => {
      if (!preview?.valid || !attempt) return;
      saveAttempt();
      status(ui("正在整批提交。若响应中断，请使用当前导入标识重试。"));
      const result = await request("import", {
        "X-EchoClass-Client-Import-Id": attempt.token,
        "X-EchoClass-Expected-SHA256": attempt.sha,
      });
      showReceipt(result.receipt);
      status(
        result.replayed
          ? ui("已读取原批次回执；本次新增 0 条。")
          : ui("整批完成，新增 {0} 条。再次点击提交会返回同一回执。", result.added_this_request),
      );
    }),
  );
  el("new").addEventListener("click", () => {
    if (!preview?.valid || !bytes) return;
    if (
      !confirm(
        ui(
          "开始另一次导入会使用新的导入标识，即使文件相同也会创建另一批记录，可能产生重复观测。继续？",
        ),
      )
    )
      return;
    try {
      saveAttempt({ ...attemptFacts(), token: crypto.randomUUID() });
    } catch (error) {
      status(error.message);
      return;
    }
    invalidate();
    status(ui("已开始另一次导入，请重新预览。提交后将创建另一批记录。"));
  });
  el("reload-receipt").addEventListener("click", () =>
    run(async () => {
      const result = await fetch(`/api/csv/imports/${encodeURIComponent(receipt.batch_id)}`).then(
        readJson,
      );
      showReceipt(result.receipt);
      status(ui("已按当前权限读取原批次回执。"));
    }),
  );
  el("export").addEventListener("click", () =>
    run(async () => {
      const response = await fetch(
        `/api/csv/export?class_id=${encodeURIComponent(classSelect.value)}`,
      );
      if (!response.ok) {
        await readJson(response);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "echoclass-experiments-spreadsheet-v1.csv";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(ui("表格 CSV 已下载。text: 标记为导出视图防护，平台内文本保持原值。"));
    }),
  );
  run(async () => {
    const result = await fetch("/api/csv/classes").then(readJson);
    userId = result.user_id;
    for (const item of result.classes) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      classSelect.append(option);
    }
    status(
      result.classes.length
        ? ui("请选择文件并预览。模板只含表头，需填写真实观测后提交。")
        : ui("当前账号没有可用班级，请先通过现有班级流程建立班级。"),
    );
  });
})();
