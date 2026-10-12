(() => {
  "use strict";
  const ui = globalThis.EchoClassUI.text;
  const listSeparator = globalThis.EchoClassUI.language === "en" ? ", " : "、";
  const el = (name) => document.getElementById(`scientific-${name}`);
  const node = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = String(text);
    if (className) item.className = className;
    return item;
  };
  const status = (message) => {
    el("status").textContent = message;
  };
  const stateLabels = {
    pending: ui("排队中"),
    running: ui("计算中"),
    completed: ui("已完成"),
    failed: ui("失败"),
  };
  const reasons = {
    no_approved_records: ui("没有已纳入的记录"),
    insufficient_replicates: ui("重复记录不足"),
    numeric_unavailable: ui("超出可靠数值计算范围"),
    constant_response: ui("得率没有变化"),
    insufficient_groups: ui("有数据的浓度组不足"),
    fold_failure: ui("至少一折无法可靠拟合"),
    rank_deficient: ui("拟合矩阵秩不足"),
    ill_conditioned: ui("拟合对微小误差过于敏感"),
    degenerate_empirical_distribution: ui("组内数值完全相同，无法估计区间"),
    zero_iqr: ui("四分位距为零，未应用标记规则"),
    not_concave: ui("曲线没有稳定的内部最大值"),
    vertex_outside_range: ui("顶点超出已测浓度范围"),
    fold_unstable: ui("删去一组后，候选浓度不再稳定"),
    review_excluded: ui("教师已排除"),
    not_approved: ui("尚未获教师纳入"),
  };
  const limitations = {
    exploratory_analysis: ui("这是一份探索性分析，不作显著性或因果结论。"),
    record_independence_unverified: ui("记录之间是否独立，尚未通过实验设计核实。"),
    bootstrap_assumes_independent_records: ui(
      "Bootstrap 区间把每条记录当作独立重复；同一实验的多次读数可能不满足这个假设。",
    ),
    four_concentration_model: ui("二次模型只依据四个预设浓度，不能代表完整的浓度—得率关系。"),
    candidate_requires_new_experiment: ui("候选浓度需要新实验验证，不能称为已经证明的最优条件。"),
  };
  const reason = (code) =>
    reasons[code] || (code ? ui("暂不可用（{0}）", String(code)) : ui("暂不可用"));
  const number = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    if (value !== 0 && (Math.abs(value) >= 1e7 || Math.abs(value) < 1e-4))
      return value.toExponential(6);
    return value.toLocaleString(globalThis.EchoClassUI.language === "en" ? "en-US" : "zh-CN", {
      maximumSignificantDigits: 7,
    });
  };
  const metric = (value) =>
    value && value.value !== null ? number(value.value) : reason(value?.reason);
  const linkToRun = (id, label) => {
    const link = node("a", label);
    link.href = `/scientific-analysis/runs/${encodeURIComponent(id)}`;
    return link;
  };
  const section = (title) => {
    const item = node("section");
    item.append(node("h2", title));
    return item;
  };
  const details = (title) => {
    const item = node("details");
    item.append(node("summary", title));
    return item;
  };
  const facts = (entries) => {
    const list = node("dl");
    for (const [label, value] of entries) list.append(node("dt", label), node("dd", value ?? "—"));
    return list;
  };
  const table = (caption, headings, rows) => {
    const wrap = node("div", undefined, "table-wrap"),
      item = node("table");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", caption);
    item.append(node("caption", caption));
    const head = node("thead"),
      title = node("tr"),
      body = node("tbody");
    for (const label of headings) {
      const cell = node("th", label);
      cell.scope = "col";
      title.append(cell);
    }
    head.append(title);
    for (const row of rows) {
      const tr = node("tr");
      for (const value of row) tr.append(node("td", value));
      body.append(tr);
    }
    item.append(head, body);
    wrap.append(item);
    return wrap;
  };

  let userId = "",
    classId = "",
    classes = [],
    available = false,
    accountChanged = false;
  let attempt = null,
    storageError = "",
    currentRun = null,
    busy = false;
  let pollTimer = null,
    pollsRemaining = 0;
  const activeRun = () => currentRun && ["pending", "running"].includes(currentRun.status);
  const controls = () => {
    const ready = Boolean(userId && classId && !accountChanged);
    el("class").disabled = busy || accountChanged || !classes.length;
    el("create").disabled = busy || !ready || (!available && !attempt) || Boolean(storageError);
    el("new").disabled = busy || !ready || !available;
    el("reload").disabled = busy || !userId || accountChanged;
    el("reproduce").disabled = busy || !ready || !available || currentRun?.status !== "completed";
    el("create").textContent = attempt ? ui("读取 / 重试原分析") : ui("分析当前数据");
  };
  const stopPolling = () => {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
  };
  const clearReport = () => {
    currentRun = null;
    stopPolling();
    el("report").replaceChildren();
    el("reproduction").hidden = true;
    el("reproduction-result").replaceChildren();
  };
  const key = () => `echoclass.scientific.attempt.v1:${JSON.stringify([userId, classId])}`;
  const readAttempt = () => {
    let raw;
    try {
      raw = localStorage.getItem(key());
    } catch {
      throw new Error(ui("无法读取浏览器中的分析标识。请恢复本地存储后重试，当前不会创建分析。"));
    }
    if (raw === null) return null;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      /* Do not overwrite an uncertain prior intent. */
    }
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      Object.keys(value).sort().join(",") !== "class_id,policy,run_id,token,user_id,version" ||
      value.version !== 1 ||
      value.user_id !== userId ||
      value.class_id !== classId ||
      value.policy !== "approved_only.v1" ||
      typeof value.token !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(value.token) ||
      !(
        value.run_id === null ||
        (typeof value.run_id === "string" && value.run_id.length > 0 && value.run_id.length <= 128)
      )
    ) {
      throw new Error(
        ui(
          "已保存的分析标识损坏或不匹配。原任务可能已创建；请先检查最近的分析。确认要建立新快照时，再点击“重新分析当前数据”。",
        ),
      );
    }
    return value;
  };
  const saveAttempt = (value) => {
    try {
      localStorage.setItem(key(), JSON.stringify(value));
    } catch {
      throw new Error(
        ui("无法保存分析标识，本地存储可能已满或不可用。已保存的旧标识未清除，请恢复存储后重试。"),
      );
    }
  };
  const freshAttempt = () => {
    if (!crypto.randomUUID)
      throw new Error(ui("浏览器无法生成分析标识，请使用 HTTPS 或本机地址打开页面。"));
    return {
      version: 1,
      user_id: userId,
      class_id: classId,
      policy: "approved_only.v1",
      token: crypto.randomUUID(),
      run_id: null,
    };
  };
  const showAttempt = () => {
    el("attempt").replaceChildren();
    if (storageError) {
      el("attempt").append(node("span", storageError));
    } else if (attempt?.run_id) {
      el("attempt").append(
        node("span", ui("本次标识已关联报告：")),
        linkToRun(attempt.run_id, attempt.run_id),
      );
    } else {
      el("attempt").append(
        node(
          "span",
          attempt
            ? ui("已保留本次分析标识；响应未确认时请使用同一标识重试。")
            : ui("尚未创建本次分析。"),
        ),
      );
    }
  };
  const syncAttempt = () => {
    attempt = null;
    storageError = "";
    if (userId && classId) {
      try {
        attempt = readAttempt();
      } catch (error) {
        storageError = error.message;
      }
    }
    showAttempt();
    controls();
  };
  const readJson = async (response) => {
    const data = await response.json();
    if (!response.ok || !data?.ok)
      throw new Error(
        typeof data?.error?.message === "string"
          ? globalThis.EchoClassUI.error(data.error.message, data.error.code, response.status)
          : ui("请求失败（{0}）", response.status),
      );
    return data;
  };
  const checkUser = (id) => {
    if (typeof id !== "string" || !id) throw new Error(ui("服务器未返回有效的当前账号。"));
    if (userId && userId !== id) {
      accountChanged = true;
      clearReport();
      el("runs").replaceChildren();
      attempt = null;
      storageError = ui("账号已变更，请刷新页面。原账号的分析标识仍保留。");
      showAttempt();
      throw new Error(storageError);
    }
    userId = id;
  };
  const renderRuns = (runs) => {
    el("runs").replaceChildren();
    for (const run of runs) {
      const row = node("li");
      row.append(
        linkToRun(run.id, `${run.created_at} · ${stateLabels[run.status] || run.status}`),
        node("span", run.id, "quiet"),
      );
      el("runs").append(row);
    }
    if (!runs.length)
      el("runs").append(
        node("li", classId ? ui("这个班级还没有可查看的分析。") : ui("请先选择班级。")),
      );
  };
  const refreshContext = async () => {
    try {
      const query = classId ? `?class_id=${encodeURIComponent(classId)}` : "";
      const data = await fetch(`/api/scientific-runs${query}`, { cache: "no-store" }).then(
        readJson,
      );
      checkUser(data.user_id);
      classes = data.classes;
      available = data.available === true;
      if (classId && !classes.some((item) => item.id === classId))
        throw new Error(ui("当前账号无法访问所选班级，请刷新页面后选择班级。"));
      if (!classId && classes.length) classId = classes[0].id;
      el("class").replaceChildren();
      for (const item of classes) {
        const option = node("option", item.name);
        option.value = item.id;
        el("class").append(option);
      }
      el("class").value = classId;
      el("availability").textContent = !classes.length
        ? ui("当前账号没有可分析的班级。")
        : available
          ? ui("分析当前记录时，未审阅或未获纳入的记录会保留在封存清单中，并注明未纳入原因。")
          : ui("分析服务暂不可用，仍可查看已保存的报告。");
      renderRuns(data.runs);
      syncAttempt();
    } catch (error) {
      clearReport();
      el("runs").replaceChildren();
      throw error;
    }
  };

  const renderRun = (run) => {
    currentRun = run;
    el("report").replaceChildren();
    el("reproduction").hidden = run.status !== "completed";
    el("reproduction-result").replaceChildren();
    const overview = section(ui("分析报告"));
    overview.append(
      node("p", `${run.class_name} · ${stateLabels[run.status] || run.status}`),
      node("p", ui("报告 {0} · 建立于 {1}", run.id, run.created_at), "quiet run-identity"),
    );
    if (run.status === "pending" || run.status === "running")
      overview.append(
        node(
          "p",
          ui("输入已封存。页面每 2 秒刷新一次，最多自动检查 20 次；之后可手动刷新。"),
          "quiet",
        ),
      );
    if (run.status === "failed")
      overview.append(
        node(
          "p",
          ui(
            "任务未完成（{0}）。重试原标识会读取同一任务；重新分析当前数据会建立另一份快照。",
            run.error_code || "unknown_error",
          ),
          "notice",
        ),
      );
    el("report").append(overview);
    const result = run.result;
    if (run.status !== "completed" || !result) {
      overview.append(provenance(run));
      controls();
      return;
    }
    const selection = result.selection;
    const explanation = node("a", ui("读懂这份报告：逐段查看解释与依据"));
    explanation.href = `/grounded-analysis/runs/${encodeURIComponent(run.id)}`;
    overview.append(explanation);
    overview.append(
      node(
        "p",
        ui(
          "封存候选 {0} 条；纳入 {1} 条；未纳入 {2} 条。",
          selection.candidate_count,
          selection.included_count,
          selection.excluded_count,
        ),
      ),
    );
    const selected = details(ui("逐条查看纳入情况"));
    const reviewLabels = {
      included: ui("纳入"),
      excluded: ui("排除"),
      normal: ui("正常"),
      review: ui("待复核"),
    };
    selected.append(
      table(
        ui("记录按封存时的顺序排列"),
        [ui("记录"), ui("封存的审阅状态"), ui("进入本次统计"), ui("依据")],
        selection.records.map((row) => [
          row.record_id,
          reviewLabels[row.review_status] || row.review_status || ui("未审阅"),
          row.included ? ui("是") : ui("否"),
          row.included ? ui("教师已纳入") : reason(row.reason),
        ]),
      ),
    );
    overview.append(selected);

    const descriptive = section(ui("各浓度的已纳入记录"));
    descriptive.append(
      table(
        ui("得率单位为 %；最多显示 7 位有效数字"),
        [
          ui("NH₄Cl 浓度 (%)"),
          ui("记录数 n"),
          ui("均值"),
          ui("样本 SD"),
          ui("均值的 95% 区间"),
          ui("原始 MAD"),
          ui("正态修正 MAD"),
        ],
        result.groups.map((group) => [
          number(group.concentration),
          String(group.n),
          metric(group.statistics.mean),
          metric(group.statistics.sd),
          group.ci.lower !== null && group.ci.upper !== null
            ? `${number(group.ci.lower)} – ${number(group.ci.upper)}`
            : reason(group.ci.reason),
          metric(group.statistics.mad),
          metric(group.statistics.mad_normal),
        ]),
      ),
    );
    descriptive.append(
      node(
        "p",
        ui(
          "区间使用 10,000 次 percentile bootstrap，并把每条记录当作独立重复。若多条记录只是同一实验的重复读数，这个假设可能不成立；区间仅供探索。",
        ),
        "notice",
      ),
    );
    const spread = details(ui("中位数、范围和四分位数"));
    spread.append(
      table(
        ui("SD 使用 n − 1；MAD 是相对中位数的绝对偏差中位数"),
        [ui("浓度 (%)"), ui("中位数"), ui("最小值"), ui("最大值"), "Q1", "Q3", "IQR"],
        result.groups.map((group) => [
          number(group.concentration),
          ...["median", "min", "max", "q1", "q3", "iqr"].map((field) =>
            metric(group.statistics[field]),
          ),
        ]),
      ),
    );
    descriptive.append(spread);
    const flags = details(ui("IQR 标记：供人工复核"));
    flags.append(
      node(
        "p",
        ui("仅在 n ≥ 4 且 IQR 非零时应用 1.5 × IQR 规则。被标记的记录仍参与统计，不会自动排除。"),
        "quiet",
      ),
    );
    const flagList = node("ul");
    for (const group of result.groups)
      flagList.append(
        node(
          "li",
          `${number(group.concentration)}%：${group.iqr_flags.reason ? reason(group.iqr_flags.reason) : group.iqr_flags.record_ids.length ? ui("需复核记录 {0}", group.iqr_flags.record_ids.join(listSeparator)) : ui("没有标记记录")}`,
        ),
      );
    flags.append(flagList);
    descriptive.append(flags);
    el("report").append(descriptive);

    const findings = section(ui("实测结果与下一步实验"));
    const cards = node("div", undefined, "findings"),
      best = node("div", undefined, "finding"),
      candidate = node("div", undefined, "finding");
    best.append(node("h3", ui("实测均值得率最高")));
    best.append(
      node(
        "p",
        result.best_tested.mean === null
          ? reason(result.best_tested.reason)
          : ui(
              "{0} · 平均得率 {1}%",
              result.best_tested.concentrations
                .map((value) => `${number(value)}%`)
                .join(listSeparator),
              number(result.best_tested.mean),
            ),
      ),
    );
    best.append(node("p", ui("只比较已测浓度；并列时全部保留。"), "quiet"));
    candidate.append(node("h3", ui("模型建议的待验证浓度")));
    candidate.append(
      node(
        "p",
        result.candidate.concentration === null
          ? reason(result.candidate.reason)
          : ui(
              "{0}% · 预测得率 {1}%",
              number(result.candidate.concentration),
              number(result.candidate.predicted_yield),
            ),
      ),
    );
    if (result.candidate.leave_one_out_vertex_range)
      candidate.append(
        node(
          "p",
          ui(
            "删去一组后的顶点范围：{0}% 。这是敏感性范围，不是置信区间。",
            result.candidate.leave_one_out_vertex_range.map(number).join(" – "),
          ),
          "quiet",
        ),
      );
    candidate.append(
      node(
        "p",
        ui(
          "仅在完整拟合和四次删组拟合都支持范围内的凹形顶点时显示。需要新实验验证，不能称为已证明的最优浓度。",
        ),
        "quiet",
      ),
    );
    cards.append(best, candidate);
    findings.append(cards);
    el("report").append(findings);

    const regression = result.regression,
      fitting = section(ui("二次模型与留一浓度验证"));
    fitting.append(
      node(
        "p",
        ui(
          "模型对各浓度的平均得率等权拟合。每一折留出整个浓度组，再用其余组预测；没有把同浓度记录随机拆到训练和验证两侧。",
        ),
        "quiet",
      ),
    );
    if (!regression.available)
      fitting.append(node("p", ui("模型不可用：{0}", reason(regression.reason))));
    else
      fitting.append(
        node(
          "p",
          ui(
            "使用 {0} 个浓度组{1}。",
            regression.n_groups,
            regression.saturated ? ui("；三组二次拟合为饱和描述，不能据此验证预测能力") : "",
          ),
        ),
      );
    if (regression.loocv.available) {
      fitting.append(
        node("p", ui("留一浓度 RMSE：{0} 个得率百分点。", metric(regression.loocv.rmse))),
      );
      fitting.append(
        table(
          ui("误差为实测均值减预测均值；各折均使用原始得率单位"),
          [
            ui("留出浓度 (%)"),
            ui("实测均值 (%)"),
            ui("预测均值 (%)"),
            ui("误差 (百分点)"),
            ui("预测范围"),
          ],
          regression.loocv.folds.map((fold) => [
            number(fold.held_out_concentration),
            number(fold.observed_mean),
            number(fold.predicted_mean),
            number(fold.residual),
            fold.extrapolation ? ui("外推") : ui("训练浓度范围内"),
          ]),
        ),
      );
      fitting.append(
        node(
          "p",
          ui(
            "留出 0% 或 4% 时，其余训练浓度不包含该端点，因此这两折属于外推。四折误差也不足以证明模型能泛化到新实验。",
          ),
          "notice",
        ),
      );
    } else
      fitting.append(node("p", ui("留一浓度验证不可用：{0}", reason(regression.loocv.reason))));
    const fitDetails = details(ui("拟合细节"));
    fitDetails.append(
      facts([
        [ui("模型"), ui("y = a × x² + b × x + c；x 为浓度 (%)，y 为得率 (%)")],
        [
          ui("系数 a / b / c"),
          regression.coefficients
            ? [regression.coefficients.a, regression.coefficients.b, regression.coefficients.c]
                .map(number)
                .join(" / ")
            : ui("不可用"),
        ],
        [ui("训练 R²"), metric(regression.training_r_squared)],
        [ui("训练 RMSE"), metric(regression.training_rmse)],
        [ui("残差自由度"), regression.residual_df],
        [ui("矩阵秩"), regression.rank],
        [ui("条件数"), number(regression.condition_number)],
      ]),
    );
    if (regression.loocv.folds.length)
      fitDetails.append(
        table(
          ui("删去一组后的顶点，仅用于敏感性检查"),
          [ui("留出浓度 (%)"), ui("顶点浓度 (%)"), ui("不可用原因")],
          regression.loocv.folds.map((fold) => [
            number(fold.held_out_concentration),
            number(fold.vertex),
            fold.vertex_reason ? reason(fold.vertex_reason) : "—",
          ]),
        ),
      );
    fitting.append(fitDetails);
    el("report").append(fitting);
    const methods = section(ui("方法与复核"));
    const notes = node("ul");
    for (const code of result.limitations)
      notes.append(node("li", limitations[code] || ui("分析局限（{0}）", String(code))));
    methods.append(notes, provenance(run));
    el("report").append(methods);
    controls();
  };
  const provenance = (run) => {
    const item = details(ui("封存摘要、随机种子与版本"));
    item.append(
      facts([
        [ui("数据集摘要"), run.dataset_hash],
        [ui("执行指纹"), run.execution_fingerprint],
        [ui("科学结果摘要"), run.scientific_result_hash],
        [ui("随机种子"), run.configuration.seed_hex],
        [ui("选择规则"), run.configuration.selection_policy],
        [ui("算法版本"), run.identity.algorithm_version],
        [ui("应用版本"), run.identity.app_version],
        [ui("Python 代码摘要"), run.identity.code_version],
        [ui("Node 代码摘要"), run.identity.node_code_version],
        [ui("环境摘要"), run.identity.environment_fingerprint],
        [ui("完成时间"), run.completed_at],
      ]),
    );
    const environment = details(ui("完整计算环境与配置"));
    environment.append(
      node(
        "pre",
        JSON.stringify(
          { environment: run.identity.environment, configuration: run.configuration },
          null,
          2,
        ),
      ),
    );
    item.append(environment);
    return item;
  };
  const loadRun = async (id, selectClass = false) => {
    try {
      const data = await fetch(`/api/scientific-runs/${encodeURIComponent(id)}`, {
        cache: "no-store",
      }).then(readJson);
      checkUser(data.user_id);
      if (data.run.id !== id) throw new Error(ui("报告标识不一致，请刷新后重试。"));
      if (selectClass) {
        if (!classes.some((item) => item.id === data.run.class_id))
          throw new Error(ui("当前账号无法访问报告所属班级。"));
        classId = data.run.class_id;
        el("class").value = classId;
      } else if (data.run.class_id !== classId)
        throw new Error(ui("报告与所选班级不一致，请重新选择。"));
      renderRun(data.run);
    } catch (error) {
      clearReport();
      throw error;
    }
  };
  const schedulePolling = () => {
    if (!activeRun() || !pollsRemaining || pollTimer !== null || accountChanged) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (busy || !activeRun() || accountChanged) return;
      const id = currentRun.id;
      pollsRemaining--;
      const succeeded = await action(async () => {
        await refreshContext();
        await loadRun(id);
        status(
          currentRun.status === "completed"
            ? ui("分析已完成，下面是保存的报告。")
            : currentRun.status === "failed"
              ? ui("分析未完成，原因见报告。")
              : ui("输入已封存，等待计算完成。"),
        );
      });
      if (succeeded && !pollsRemaining && activeRun())
        status(ui("已自动检查 20 次，自动刷新已暂停。任务仍保留，可稍后点击“刷新”。"));
    }, 2000);
  };
  const action = async (callback) => {
    if (busy || accountChanged) return false;
    stopPolling();
    busy = true;
    controls();
    try {
      await callback();
      return true;
    } catch (error) {
      pollsRemaining = 0;
      status(error.message || ui("响应未确认，请使用原分析标识重试。"));
      return false;
    } finally {
      busy = false;
      controls();
      schedulePolling();
    }
  };
  el("class").addEventListener("change", () =>
    action(async () => {
      classId = el("class").value;
      clearReport();
      await refreshContext();
      status(ui("已切换班级。原班级的分析标识仍保留。"));
    }),
  );
  el("create").addEventListener("click", () =>
    action(async () => {
      await refreshContext();
      if ((!available && !attempt) || storageError)
        throw new Error(storageError || ui("分析服务暂不可用。"));
      const prior = readAttempt(),
        intent = prior || freshAttempt();
      try {
        saveAttempt(intent);
      } catch (error) {
        storageError = error.message;
        showAttempt();
        throw error;
      }
      attempt = intent;
      showAttempt();
      status(ui("正在建立或读取分析任务。响应中断后，请使用原标识重试。"));
      let response;
      try {
        response = await fetch("/api/scientific-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_id: classId,
            client_request_id: intent.token,
            policy: "approved_only.v1",
          }),
        });
      } catch {
        throw new Error(ui("分析响应未确认。原标识已保留，重试不会建立另一份快照。"));
      }
      const data = await readJson(response);
      if (
        data.run.class_id !== classId ||
        data.run.client_request_id !== intent.token ||
        data.run.requester_user_id !== userId
      )
        throw new Error(ui("分析回执与本次请求不一致。请保留原标识并刷新后重试。"));
      renderRun(data.run);
      pollsRemaining = 20;
      const known = { ...intent, run_id: data.run.id };
      try {
        saveAttempt(known);
      } catch (error) {
        storageError = error.message;
        showAttempt();
        throw error;
      }
      attempt = known;
      showAttempt();
      status(
        data.replayed
          ? ui("已读取原分析任务，封存快照保持不变。")
          : ui("分析任务已建立，输入已封存。"),
      );
    }),
  );
  el("new").addEventListener("click", () =>
    action(async () => {
      await refreshContext();
      if (!available) throw new Error(ui("分析服务暂不可用。"));
      if (
        !confirm(
          ui(
            "重新分析会替换这个班级的重试标识，并重新封存当前记录。此前响应未确认的任务可能已经成功。确认建立另一份分析？",
          ),
        )
      )
        return;
      const next = freshAttempt();
      try {
        saveAttempt(next);
      } catch (error) {
        storageError = error.message;
        showAttempt();
        throw error;
      }
      attempt = next;
      storageError = "";
      showAttempt();
      status(ui("已确认使用新的分析标识。点击“读取 / 重试原分析”将为当前记录建立新快照。"));
    }),
  );
  el("reload").addEventListener("click", () =>
    action(async () => {
      const id = currentRun?.id;
      await refreshContext();
      if (id) {
        await loadRun(id);
        pollsRemaining = 20;
      }
      status(ui("已按当前权限刷新。报告仍对应其建立时的封存输入。"));
    }),
  );
  el("reproduce").addEventListener("click", () =>
    action(async () => {
      const id = currentRun?.id;
      if (!id) return;
      await refreshContext();
      await loadRun(id);
      if (!available || currentRun.status !== "completed")
        throw new Error(ui("当前无法复算这份报告。"));
      const data = await fetch(`/api/scientific-runs/${encodeURIComponent(id)}/reproduce`, {
        method: "POST",
      }).then(readJson);
      const result = data.reproduction;
      el("reproduction-result").replaceChildren();
      const heading =
        result.mode === "exact"
          ? result.matches === true
            ? ui("同一环境复算：科学结果摘要一致。")
            : ui("同一环境复算：发现差异。")
          : result.mode === "numerical_comparison"
            ? result.matches === true
              ? ui("跨环境数值比较通过；这不等于逐字节一致。")
              : ui("跨环境数值比较发现差异。")
            : ui("复算返回了未识别的比较方式，请查看明细。");
      el("reproduction-result").append(node("p", heading));
      const more = details(ui("复算明细"));
      more.append(node("pre", JSON.stringify(result, null, 2)));
      el("reproduction-result").append(more);
      status(ui("复算已结束，原报告未被改写。"));
    }),
  );
  action(async () => {
    const params = new URLSearchParams(location.search),
      entries = [...params.entries()].filter(([key]) => key !== "lang");
    const match = location.pathname.match(/^\/scientific-analysis\/runs\/([^/]+)$/);
    if (location.pathname !== "/scientific-analysis" && !match)
      throw new Error(ui("分析页面地址无效。"));
    if (
      params.getAll("lang").length > 1 ||
      (params.has("lang") && !["en", "zh"].includes(params.get("lang"))) ||
      entries.length > 1 ||
      (entries.length === 1 && (match || entries[0][0] !== "class_id" || !entries[0][1]))
    )
      throw new Error(ui("班级参数无效，请从班级或报告入口进入。"));
    classId = params.get("class_id") || "";
    const requestedClass = classId;
    await refreshContext();
    if (match) {
      await loadRun(decodeURIComponent(match[1]), true);
      pollsRemaining = 20;
    }
    if (classId && (!requestedClass || match)) await refreshContext();
    status(
      currentRun
        ? ui("已读取保存的分析任务。")
        : ui("选择班级后即可建立分析。只使用教师已纳入的记录。"),
    );
  });
})();
