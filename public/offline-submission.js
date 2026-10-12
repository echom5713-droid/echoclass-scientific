(function () {
  const form = document.getElementById("student-form");
  if (!form) return;
  const result = document.getElementById("submit-result");
  const status = document.getElementById("sync-status");
  const button = form.querySelector('button[type="submit"]');
  const demo = form.dataset.demo === "1";
  const endpoint = "/api/record-submissions";
  const version = "echoclass.record-intent.v1";
  const contextKeys = ["user_id", "role", "class_name", "group_name", "name"];
  let busy = false;
  let pageContext;
  let newSubmission = false;
  let activeToken;
  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn btn-secondary";
  next.textContent = "开始下一条记录";
  next.disabled = true;
  if (!demo) form.append(next);
  next.addEventListener("click", () => {
    if (busy || next.disabled) return;
    newSubmission = true;
    next.disabled = true;
    message("下一次提交将作为一条新观测；请核对实验条件。", true);
  });

  function message(text, ok = false) {
    result.textContent = text;
    result.style.color = ok ? "#047857" : "#b45309";
    result.style.whiteSpace = "pre-line";
  }

  function errorMessage(body, fallback) {
    return typeof body?.error === "string"
      ? body.error
      : typeof body?.error?.message === "string"
        ? body.error.message
        : fallback;
  }

  function validContext(value) {
    return (
      value &&
      Object.keys(value).length === contextKeys.length &&
      contextKeys.every((key) => typeof value[key] === "string") &&
      value.user_id &&
      ["student", "teacher", "admin"].includes(value.role)
    );
  }

  function sameContext(a, b) {
    return validContext(a) && validContext(b) && contextKeys.every((key) => a[key] === b[key]);
  }

  function prefix() {
    return `${version}:${encodeURIComponent(pageContext.user_id)}:`;
  }

  function keyFor(intent) {
    return `${prefix()}${intent.record.client_submission_id}`;
  }

  function intents() {
    const values = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix())) continue;
      let intent;
      try {
        intent = JSON.parse(localStorage.getItem(key));
      } catch {
        throw Error("本账号的暂存记录无法读取；请保留本地数据，核对后再提交。");
      }
      if (
        !intent ||
        intent.schema !== version ||
        !validContext(intent.context) ||
        intent.context.user_id !== pageContext.user_id ||
        !intent.record ||
        typeof intent.record !== "object" ||
        !/^submission-[a-f0-9-]{36}$/.test(intent.record.client_submission_id) ||
        key !== keyFor(intent) ||
        !["pending", "blocked", "confirmed"].includes(intent.state)
      )
        throw Error("本账号的暂存标识损坏；原记录已保留，请核对后再提交。");
      values.push(intent);
    }
    return values;
  }

  function save(intent) {
    const raw = JSON.stringify(intent);
    try {
      localStorage.setItem(keyFor(intent), raw);
      if (localStorage.getItem(keyFor(intent)) !== raw) throw Error("Storage verification failed");
    } catch {
      throw Error("本地存储不可用或已满；请保留当前表单和暂存记录，恢复后用原标识重试。");
    }
  }

  function updateStatus() {
    if (demo) {
      status.textContent = "体验提交不会写入课堂数据库，也不会进入离线队列。";
      return;
    }
    const own = intents().filter((intent) => sameContext(intent.context, pageContext));
    const pending = own.filter((intent) => intent.state === "pending").length;
    const blocked = own.filter((intent) => intent.state === "blocked").length;
    status.textContent = `${navigator.onLine ? "在线" : "离线"} · 本账号待确认 ${pending} 条${blocked ? `，需核对 ${blocked} 条` : ""}`;
  }

  async function freshContext() {
    let response, body;
    try {
      response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
      body = await response.json();
    } catch {
      throw Error("无法核对当前登录状态；记录仍保留，联网并登录原账号后再试。");
    }
    if (!response.ok) throw Error(errorMessage(body, "请先登录原账号后重试；暂存记录仍保留。"));
    if (!sameContext(body?.context, pageContext))
      throw Error("账号或班级信息已变更；原记录仍保留，请刷新页面并核对账号。");
  }

  function withoutToken(record) {
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => key !== "client_submission_id")
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  function activeKey() {
    return `${version}.active:${encodeURIComponent(JSON.stringify(contextKeys.map((key) => pageContext[key])))}`;
  }

  function activeIntent(all) {
    if (activeToken === undefined) {
      try {
        activeToken = sessionStorage.getItem(activeKey());
      } catch {
        throw Error("无法读取本页提交标识；请保留暂存记录，恢复浏览器存储后再试。");
      }
    }
    if (activeToken === null) return undefined;
    const active = all.find((item) => item.record.client_submission_id === activeToken);
    if (!active || !sameContext(active.context, pageContext))
      throw Error("本页提交标识与暂存记录不匹配；请保留原记录并核对，未发起新的提交。");
    return active;
  }

  function pin(intent) {
    // This tab keeps the exact token even if another tab adds equal-valued data.
    // Retain it in memory if this write fails; no POST occurs until it is saved.
    activeToken = intent.record.client_submission_id;
    try {
      sessionStorage.setItem(activeKey(), activeToken);
      if (sessionStorage.getItem(activeKey()) !== activeToken) throw Error("Pointer not saved");
    } catch {
      throw Error("本页提交标识无法保存；记录仍保留，恢复浏览器存储后用原标识重试。");
    }
  }

  function selectIntent(all, signature) {
    if (newSubmission) return undefined;
    const matching = all.filter(
      (item) =>
        sameContext(item.context, pageContext) &&
        JSON.stringify(withoutToken(item.record)) === signature,
    );
    const active = activeIntent(all);
    const sameActive = matching.find(
      (item) => item.record.client_submission_id === active?.record.client_submission_id,
    );
    if (sameActive && sameActive.state !== "confirmed") return sameActive;
    const unresolved = matching.filter((item) => item.state !== "confirmed");
    if (unresolved.length > 1)
      throw Error("相同内容有多条待确认记录；请先联网核对暂存记录，当前表单未发起新的提交。");
    if (unresolved.length === 1) return unresolved[0];
    if (sameActive) return sameActive;
    // Historical receipts have no implicit chronological order. Any confirmed
    // match is a duplicate guard; choosing one never hides an unresolved intent.
    return matching.sort((a, b) =>
      a.record.client_submission_id.localeCompare(b.record.client_submission_id),
    )[0];
  }

  async function send(intent) {
    // A fresh identity check limits stale tabs; the POST checks the same context
    // again so an account switch between these two requests cannot reassign data.
    await freshContext();
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: intent.context, record: intent.record }),
      });
    } catch {
      message("服务器是否收到尚未确认；记录已保留，联网后将用同一提交标识重试。");
      return;
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      // Validation and authorization failures are actionable, not offline success.
      // 5xx and 408 may follow a commit; keep the original token for reconciliation.
      if (response.status < 500 && response.status !== 408) {
        intent.state = "blocked";
        intent.error = errorMessage(body, `提交被拒绝（HTTP ${response.status}）`);
        intent.error_status = response.status;
        save(intent);
      }
      message(errorMessage(body, `提交尚未确认（HTTP ${response.status}）；原记录已保留。`));
      return;
    }
    const receipt = body?.records?.[0];
    if (
      !sameContext(body?.context, intent.context) ||
      !Array.isArray(body.records) ||
      body.records.length !== 1 ||
      receipt.client_submission_id !== intent.record.client_submission_id ||
      typeof receipt.record_id !== "string" ||
      !receipt.record_id
    ) {
      message("服务器回执不完整；记录仍保留，将用原提交标识重试。");
      return;
    }
    intent.state = "confirmed";
    intent.record_id = receipt.record_id;
    save(intent);
    await freshContext();
    message(`提交已确认 · 记录 ${receipt.record_id}`, true);
    next.disabled = false;
  }

  async function exclusive(action) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      await action();
      updateStatus();
    } catch (error) {
      message(error.message || "操作未完成；请保留当前表单和暂存记录。");
      try {
        updateStatus();
      } catch {
        // Keep the actionable storage failure above; do not replace or clear data.
      }
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  async function sync() {
    if (!navigator.onLine || demo || !validContext(pageContext)) return;
    return exclusive(async () => {
      const pending = intents().filter(
        (intent) => intent.state === "pending" && sameContext(intent.context, pageContext),
      );
      if (!pending.length) return;
      for (const intent of pending) await send(intent);
      const own = intents().filter((intent) => sameContext(intent.context, pageContext));
      const confirmed = new Set(
        own
          .filter((intent) => intent.state === "confirmed")
          .map((intent) => intent.record.client_submission_id),
      );
      const acknowledged = pending.filter((intent) =>
        confirmed.has(intent.record.client_submission_id),
      ).length;
      const remaining = own.filter((intent) => intent.state === "pending").length;
      const blocked = own.filter((intent) => intent.state === "blocked").length;
      message(
        `本轮已确认 ${acknowledged} 条；本账号仍有 ${remaining} 条待确认${blocked ? `，${blocked} 条需核对` : ""}。`,
        remaining === 0 && blocked === 0,
      );
    });
  }

  if (!demo) {
    try {
      pageContext = JSON.parse(form.dataset.submissionContext);
      if (!validContext(pageContext)) throw Error("Missing submission context");
    } catch {
      message("页面身份信息不完整；请重新登录并刷新后提交。原暂存数据不会发送。");
      button.disabled = true;
      form.addEventListener("submit", (event) => event.preventDefault());
      return;
    }
    // Old records have no verifiable owner. Keep the exact bytes untouched and
    // make manual recovery possible; never infer ownership from a typed name.
    try {
      if (localStorage.getItem("citrus_offline_records") !== null) {
        const warning = document.createElement("p");
        warning.textContent =
          "发现旧版暂存记录，无法确认所属账号，已停止自动发送。请导出后核对原始记录。";
        const download = document.createElement("button");
        download.type = "button";
        download.className = "btn btn-secondary";
        download.textContent = "导出旧版暂存记录";
        download.addEventListener("click", () => {
          try {
            const raw = localStorage.getItem("citrus_offline_records");
            if (raw === null) return;
            const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "echoclass-legacy-unverified-records.json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch {
            message("无法读取旧版暂存记录；请保留此浏览器的数据后再核对。");
          }
        });
        warning.append(download);
        status.insertAdjacentElement("afterend", warning);
      }
    } catch {
      message("本地存储不可用；当前表单不会自动提交。");
    }
    window.addEventListener("online", sync);
    window.addEventListener("offline", () => {
      try {
        updateStatus();
      } catch (error) {
        message(error.message);
      }
    });
    setTimeout(sync, 500);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    return exclusive(async () => {
      const data = new FormData(form);
      const record = Object.fromEntries(data.entries());
      record["异常标记"] = data.get("异常标记") === "on";
      if (demo) {
        const response = await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...record, mode: "demo" }),
        });
        const body = await response.json();
        if (!response.ok) throw Error(errorMessage(body, "体验提交失败，请重试。"));
        message("体验提交成功；未写入课堂数据库。", true);
        return;
      }
      const signature = JSON.stringify(withoutToken(record));
      let intent = selectIntent(intents(), signature);
      if (!intent) {
        intent = {
          schema: version,
          context: pageContext,
          record: { ...record, client_submission_id: `submission-${crypto.randomUUID()}` },
          state: "pending",
        };
        save(intent);
      }
      newSubmission = false;
      pin(intent);
      if (intent.state === "confirmed") {
        await freshContext();
        message(
          `这份表单已提交 · 记录 ${intent.record_id}；另一次观测请点“开始下一条记录”。`,
          true,
        );
        next.disabled = false;
        return;
      }
      if (intent.state === "blocked") {
        if ([401, 403, 409, 429].includes(intent.error_status)) {
          // This is an explicit retry, after the user has restored access.
          // Reconnection alone never retries rejected submissions.
          await freshContext();
          intent.state = "pending";
          save(intent);
        } else {
          message(`${intent.error}。原记录仍保留；请先修正表单。`);
          return;
        }
      }
      if (!navigator.onLine) {
        message("已保存在本账号的暂存记录中；联网并核对身份后再提交。");
        return;
      }
      await send(intent);
    });
  });
  try {
    updateStatus();
  } catch (error) {
    message(error.message);
  }
})();
