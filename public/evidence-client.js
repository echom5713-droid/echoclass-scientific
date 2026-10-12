(() => {
  "use strict";
  const ui = globalThis.EchoClassUI.text;
  const el = (name) => document.getElementById(`evidence-${name}`);
  const fileInput = el("file");
  let target = null,
    endpoint = "",
    userId = "",
    role = "",
    prepared = null,
    attempt = null,
    busy = false,
    accountChanged = false,
    actionButtons = [];
  const status = (message) => {
    el("status").textContent = message;
  };
  const controls = () => {
    const ready = Boolean(userId && target && !accountChanged);
    fileInput.disabled = busy || !ready;
    el("prepare").disabled = busy || !ready || !fileInput.files[0];
    el("upload").disabled = busy || !ready || !prepared || !attempt;
    el("new").disabled = busy || !ready || !prepared;
    el("reload").disabled = busy || !target || accountChanged;
    for (const button of actionButtons) button.disabled = busy || !ready;
  };
  const invalidate = () => {
    prepared = null;
    attempt = null;
    el("selection").textContent = ui("文件已变更，请检查文件。原文件的重试标识仍保留。");
    controls();
  };
  const readJson = async (response) => {
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new Error(
        data.error?.message
          ? globalThis.EchoClassUI.error(data.error.message, data.error.code, response.status)
          : ui("请求失败（{0}）", response.status),
      );
    return data;
  };
  const facts = () => ({
    user_id: userId,
    target_kind: target.kind,
    target_id: target.id,
    sha256: prepared.sha256,
  });
  const key = (value) =>
    `echoclass.evidence.attempt.v1:${JSON.stringify([value.user_id, value.target_kind, value.target_id, value.sha256])}`;
  const restoreAttempt = (value) => {
    let raw;
    try {
      raw = sessionStorage.getItem(key(value));
    } catch {
      throw new Error(ui("无法读取重试标识，请恢复会话存储后重新检查文件。"));
    }
    if (raw === null) return null;
    let cached;
    try {
      cached = JSON.parse(raw);
    } catch {
      /* Require an explicit replacement. */
    }
    if (
      !cached ||
      typeof cached !== "object" ||
      Array.isArray(cached) ||
      !Object.keys(value).every((field) => cached[field] === value[field]) ||
      typeof cached.token !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(cached.token)
    )
      throw new Error(
        ui(
          "已保存的上传标识损坏或不匹配。若要替换，请点击“开始另一次上传”并确认；这可能保存重复附件。",
        ),
      );
    return { ...value, token: cached.token };
  };
  const saveAttempt = (value) => {
    try {
      sessionStorage.setItem(key(value), JSON.stringify(value));
    } catch {
      throw new Error(
        ui("无法保存重试标识，会话存储可能已满或不可用。旧标识未清除，请恢复存储后重试。"),
      );
    }
  };
  const download = (item) =>
    run(async () => {
      const response = await fetch(`/api/evidence/${encodeURIComponent(item.id)}/download`, {
        cache: "no-store",
      });
      if (!response.ok) {
        await readJson(response);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `echoclass-evidence.${{ "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf", "text/csv": "csv" }[item.media_type] || "bin"}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(ui("已下载经服务器校验的附件。"));
    });
  const archive = (item) =>
    run(async () => {
      if (role !== "teacher" && role !== "admin") throw new Error(ui("当前账号不能归档附件。"));
      if (!confirm(ui("归档后保留文件与接收记录，学生将不能查看；此操作无法撤销。继续？"))) return;
      await fetch(`/api/evidence/${encodeURIComponent(item.id)}/archive`, { method: "POST" }).then(
        readJson,
      );
      await refresh();
      status(ui("附件已归档，文件与原接收记录仍保留。"));
    });
  const render = (items) => {
    el("list").replaceChildren();
    actionButtons = [];
    for (const item of items) {
      const li = document.createElement("li");
      const title = document.createElement("h3");
      title.textContent = item.original_name;
      li.append(title);
      const details = document.createElement("dl");
      for (const [label, value] of [
        [ui("类型"), item.media_type],
        [ui("大小"), ui("{0} 字节", item.byte_length)],
        ["SHA-256", item.sha256],
        [ui("实际接收时间"), item.received_at],
        [ui("上传人"), item.uploader_label_snapshot],
        [ui("状态"), item.archived_at ? ui("已归档 · {0}", item.archived_at) : ui("可用")],
      ]) {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        details.append(dt, dd);
      }
      li.append(details);
      const actions = document.createElement("div");
      actions.className = "actions";
      const addAction = (label, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", handler);
        actionButtons.push(button);
        actions.append(button);
      };
      addAction(ui("下载"), () => download(item));
      if (!item.archived_at && (role === "teacher" || role === "admin"))
        addAction(ui("归档"), () => archive(item));
      li.append(actions);
      el("list").append(li);
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.textContent = ui("当前没有可查看的附件。");
      el("list").append(li);
    }
    controls();
  };
  const refresh = async () => {
    try {
      const result = await fetch(endpoint, { cache: "no-store" }).then(readJson);
      if (userId && result.user_id !== userId) {
        accountChanged = true;
        invalidate();
        throw new Error(ui("账号已变更，请刷新页面后重新选择文件。原账号的重试标识仍保留。"));
      }
      userId = result.user_id;
      role = result.role;
      render(result.evidence);
    } catch (error) {
      render([]);
      throw error;
    }
  };
  const run = async (action, checkAccount = true) => {
    if (busy || accountChanged) return;
    busy = true;
    controls();
    try {
      if (checkAccount) await refresh();
      await action();
    } catch (error) {
      status(error.message || ui("响应未确认，请使用同一文件和上传标识重试。"));
    } finally {
      busy = false;
      controls();
    }
  };
  fileInput.addEventListener("change", invalidate);
  el("prepare").addEventListener("click", () =>
    run(async () => {
      invalidate();
      const file = fileInput.files[0];
      const csv = target.kind === "csv_batch",
        limit = csv ? 1048576 : 5242880;
      if (!file || file.size < 1 || file.size > limit)
        throw new Error(ui("请选择非空且不超过 {0} MiB 的文件。", csv ? "1" : "5"));
      const extension = file.name.split(".").pop().toLowerCase();
      const mediaType = (
        csv
          ? { csv: "text/csv" }
          : { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf" }
      )[extension];
      if (
        !mediaType ||
        (csv ? !file.name.toLowerCase().endsWith(".csv") : file.type && file.type !== mediaType)
      )
        throw new Error(
          csv
            ? ui("请选择原导入的 CSV 文件。")
            : ui("请选择扩展名和类型一致的 PNG、JPEG 或 PDF 文件。"),
        );
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength !== file.size)
        throw new Error(ui("文件读取长度不一致，请重新选择文件。"));
      if (!crypto.subtle)
        throw new Error(ui("当前浏览器无法计算文件摘要，请使用 HTTPS 或本机地址打开页面。"));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      prepared = { bytes, sha256, filename: file.name, mediaType };
      el("selection").textContent = ui(
        "{0} · {1} 字节 · {2} · SHA-256 {3}",
        file.name,
        file.size,
        mediaType,
        sha256,
      );
      const value = facts(),
        prior = restoreAttempt(value);
      const next = prior ?? { ...value, token: crypto.randomUUID() };
      saveAttempt(next);
      attempt = next;
      status(
        prior
          ? ui("已恢复同一上传标识，可以重试。服务器仍会校验文件和当前权限。")
          : ui("文件已检查，可以上传。服务器将校验格式与当前权限。"),
      );
    }),
  );
  el("upload").addEventListener("click", () =>
    run(async () => {
      if (!prepared || !attempt) return;
      saveAttempt(attempt);
      status(ui("正在上传。响应中断时，请保留文件并使用同一上传标识重试。"));
      let response;
      try {
        response = await fetch(`${endpoint}?filename=${encodeURIComponent(prepared.filename)}`, {
          method: "POST",
          headers: {
            "Content-Type": prepared.mediaType,
            "X-EchoClass-Client-Upload-Id": attempt.token,
          },
          body: prepared.bytes,
        });
      } catch {
        throw new Error(ui("上传响应未确认。请使用同一文件和上传标识重试，避免重复保存。"));
      }
      const result = await readJson(response);
      await refresh();
      status(
        result.replayed
          ? ui("已读取原上传回执，未新增附件；原接收时间保持不变。")
          : ui("附件已保存，实际接收时间：{0}。", result.evidence.received_at),
      );
    }),
  );
  el("new").addEventListener("click", () =>
    run(async () => {
      if (
        !prepared ||
        !confirm(
          ui(
            "开始另一次上传会替换此文件的重试标识。即使文件相同，也可能保存另一份附件；未确认的旧上传可能已成功。继续？",
          ),
        )
      )
        return;
      const next = { ...facts(), token: crypto.randomUUID() };
      saveAttempt(next);
      attempt = next;
      status(ui("已确认开始另一次上传。点击上传将使用新标识，可能保存重复附件。"));
    }),
  );
  el("reload").addEventListener("click", () =>
    run(async () => {
      status(ui("已按当前权限刷新附件列表。"));
    }),
  );
  run(async () => {
    const params = new URLSearchParams(location.search);
    const entries = [...params.entries()].filter(([key]) => key !== "lang");
    if (
      params.getAll("lang").length > 1 ||
      (params.has("lang") && !["en", "zh"].includes(params.get("lang"))) ||
      entries.length !== 1 ||
      !["record_id", "batch_id"].includes(entries[0][0]) ||
      !entries[0][1]
    )
      throw new Error(ui("附件目标无效，请从实验记录或 CSV 回执进入。"));
    target = { kind: entries[0][0] === "record_id" ? "record" : "csv_batch", id: entries[0][1] };
    endpoint =
      target.kind === "record"
        ? `/api/records/${encodeURIComponent(target.id)}/evidence`
        : `/api/csv/imports/${encodeURIComponent(target.id)}/evidence`;
    el("target").textContent =
      `${target.kind === "record" ? ui("实验记录") : ui("CSV 导入批次")}：${target.id}`;
    fileInput.accept =
      target.kind === "record"
        ? ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
        : ".csv,text/csv";
    el("policy").textContent =
      target.kind === "record"
        ? ui(
            "PNG、JPEG 或 PDF，每个文件不超过 5 MiB。每条记录最多保留 20 个附件（含已归档）。已归档记录不能添加附件。",
          )
        : ui(
            "请附上导入时的原始 UTF-8 CSV，最多 1 MiB。文件字节须与原回执完全一致；每批最多保留 20 个附件（含已归档）。",
          );
    await refresh();
    status(ui("已读取附件。选择文件后先检查，再上传。"));
  }, false);
})();
