import type { Language } from "./language.js";
import { groundedReadingCard } from "./grounded-reading.js";

/** Fixed interface copy only. Never apply this catalog to records or source excerpts. */
export const OPERATION_ENGLISH: Readonly<Record<string, string>> = Object.freeze({
  "单元格不能包含 NUL 字符": "Cells cannot contain NUL characters",
  请填写非空白文本: "Enter text containing a non-whitespace character",
  必须填写完整的有限十进制数字: "Enter a complete finite decimal number",
  "只接受 true 或 false": "Only true or false is accepted",
  "CSV v1 只接受 not_recorded / manual_direct": "CSV v1 accepts only not_recorded / manual_direct",
  学生姓名缺失或过长: "The student name is missing or too long",
  "NH₄Cl 浓度只能为 0%、1%、3%、4%": "NH₄Cl concentration must be 0%, 1%, 3% or 4%",
  橘皮质量不合理: "Peel mass is outside the allowed range",
  精油质量不合理: "Oil mass is outside the allowed range",
  橘皮质量与精油质量计算的产率超出有限数值范围:
    "Yield computed from peel and oil mass is outside the finite numeric range",
  蒸馏时间不合理: "Distillation time is outside the allowed range",
  分层清晰度评分不合理: "Phase clarity score is outside the allowed range",
  乳化情况缺失: "Emulsification level is missing",
  精油乳液浓度不合理: "Emulsion concentration is outside the allowed range",
  观察组别缺失: "Observation group is missing",
  抑菌圈直径不合理: "Inhibition-zone diameter is outside the allowed range",
  菌落生长评分不合理: "Colony growth score is outside the allowed range",
  异常标记类型无效: "Invalid anomaly flag type",
  班级名称缺失或过长: "The class name is missing or too long",
  小组名称类型无效: "Invalid group name type",
  误差来源类型无效: "Invalid error source type",
  备注类型无效: "Invalid note type",
  实验日期无效: "Invalid experiment date",
  培养皿直径不合理: "Petri-dish diameter is outside the allowed range",
  测量方法无效: "Invalid measurement method",
  本地图像校准测量必须提供有效培养皿直径:
    "Local image-calibrated measurement requires a valid Petri-dish diameter",
  "文本最长 40 个字符": "Text is limited to 40 characters",
  "文本最长 80 个字符": "Text is limited to 80 characters",
  "文本最长 500 个字符": "Text is limited to 500 characters",
  "文本最长 2000 个字符": "Text is limited to 2000 characters",
  排队中: "Queued",
  计算中: "Running",
  已完成: "Completed",
  失败: "Failed",
  没有已纳入的记录: "No included records",
  重复记录不足: "Too few replicate records",
  超出可靠数值计算范围: "Outside the reliable numeric range",
  得率没有变化: "Yield does not vary",
  有数据的浓度组不足: "Too few concentration groups with data",
  至少一折无法可靠拟合: "At least one fold cannot be fitted reliably",
  拟合矩阵秩不足: "Rank-deficient fit matrix",
  拟合对微小误差过于敏感: "The fit is too sensitive to small errors",
  "组内数值完全相同，无法估计区间":
    "All values within the group are identical; the interval cannot be estimated",
  "四分位距为零，未应用标记规则": "Zero interquartile range; the flagging rule was not applied",
  曲线没有稳定的内部最大值: "The curve has no stable internal maximum",
  顶点超出已测浓度范围: "The vertex is outside the measured concentration range",
  "删去一组后，候选浓度不再稳定": "The candidate is unstable when a group is omitted",
  教师已排除: "Excluded by the teacher",
  尚未获教师纳入: "Not yet included by the teacher",
  "这是一份探索性分析，不作显著性或因果结论。":
    "This is an exploratory analysis, without significance or causal conclusions.",
  "记录之间是否独立，尚未通过实验设计核实。":
    "The experimental design has not established independence between records.",
  "Bootstrap 区间把每条记录当作独立重复；同一实验的多次读数可能不满足这个假设。":
    "Bootstrap intervals treat each record as an independent replicate; repeated readings of one experiment may violate that assumption.",
  "二次模型只依据四个预设浓度，不能代表完整的浓度—得率关系。":
    "The quadratic model uses only four preset concentrations and does not describe the full concentration–yield relationship.",
  "候选浓度需要新实验验证，不能称为已经证明的最优条件。":
    "The candidate concentration requires a new experiment; it is not a proven optimum.",
  "暂不可用（{0}）": "Unavailable ({0})",
  暂不可用: "Unavailable",
  "读取 / 重试原分析": "Read / retry original analysis",
  分析当前数据: "Analyze current data",
  "无法读取浏览器中的分析标识。请恢复本地存储后重试，当前不会创建分析。":
    "The browser could not read the analysis identifier. Restore local storage and retry; no analysis will be created now.",
  "已保存的分析标识损坏或不匹配。原任务可能已创建；请先检查最近的分析。确认要建立新快照时，再点击“重新分析当前数据”。":
    "The saved analysis identifier is invalid or does not match. The original task may already exist; check recent analyses first. To create a new snapshot, choose “Analyze current data again”.",
  "无法保存分析标识，本地存储可能已满或不可用。已保存的旧标识未清除，请恢复存储后重试。":
    "The analysis identifier could not be saved. Local storage may be full or unavailable. The old identifier remains saved; restore storage and retry.",
  "浏览器无法生成分析标识，请使用 HTTPS 或本机地址打开页面。":
    "This browser cannot generate an analysis identifier. Open the page over HTTPS or on localhost.",
  "本次标识已关联报告：": "This identifier is linked to report: ",
  "已保留本次分析标识；响应未确认时请使用同一标识重试。":
    "The analysis identifier is saved. Retry with the same identifier if the response is uncertain.",
  "尚未创建本次分析。": "No analysis has been created for this attempt.",
  "请求失败（{0}）": "Request failed ({0})",
  "服务器未返回有效的当前账号。": "The server did not return a valid current account.",
  "账号已变更，请刷新页面。原账号的分析标识仍保留。":
    "The account has changed. Refresh the page; the original account’s analysis identifier remains saved.",
  "这个班级还没有可查看的分析。": "No analysis is available for this class yet.",
  "请先选择班级。": "Choose a class first.",
  "当前账号无法访问所选班级，请刷新页面后选择班级。":
    "This account cannot access the selected class. Refresh the page and choose a class.",
  "当前账号没有可分析的班级。": "This account has no class available for analysis.",
  "分析当前记录时，未审阅或未获纳入的记录会保留在封存清单中，并注明未纳入原因。":
    "Records without review or explicit inclusion remain in the snapshot manifest, with reasons for exclusion.",
  "分析服务暂不可用，仍可查看已保存的报告。":
    "The analysis service is unavailable. Saved reports remain readable.",
  分析报告: "Analysis report",
  "报告 {0} · 建立于 {1}": "Report {0} · Created {1}",
  "输入已封存。页面每 2 秒刷新一次，最多自动检查 20 次；之后可手动刷新。":
    "The input is sealed. The page checks every 2 seconds, up to 20 times; then refresh manually.",
  "任务未完成（{0}）。重试原标识会读取同一任务；重新分析当前数据会建立另一份快照。":
    "The task did not complete ({0}). Retrying the original identifier reads the same task; analyzing current data again creates another snapshot.",
  "读懂这份报告：逐段查看解释与依据": "Read this report: explanations and supporting evidence",
  "封存候选 {0} 条；纳入 {1} 条；未纳入 {2} 条。":
    "Snapshot candidates: {0}; included: {1}; not included: {2}.",
  逐条查看纳入情况: "Inspect inclusion record by record",
  纳入: "Included",
  排除: "Excluded",
  正常: "Normal",
  待复核: "Needs review",
  记录按封存时的顺序排列: "Records in their snapshot order",
  记录: "Record",
  封存的审阅状态: "Review status at snapshot time",
  进入本次统计: "Included in this analysis",
  依据: "Basis",
  未审阅: "Not reviewed",
  是: "Yes",
  否: "No",
  教师已纳入: "Included by the teacher",
  各浓度的已纳入记录: "Included records at each concentration",
  "得率单位为 %；最多显示 7 位有效数字": "Yield is in %; displayed to at most 7 significant digits",
  "NH₄Cl 浓度 (%)": "NH₄Cl concentration (%)",
  "记录数 n": "Records, n",
  均值: "Mean",
  "样本 SD": "Sample SD",
  "均值的 95% 区间": "95% interval for the mean",
  "原始 MAD": "Raw MAD",
  "正态修正 MAD": "Normal-scaled MAD",
  "区间使用 10,000 次 percentile bootstrap，并把每条记录当作独立重复。若多条记录只是同一实验的重复读数，这个假设可能不成立；区间仅供探索。":
    "Intervals use 10,000 percentile bootstrap samples and treat each record as an independent replicate. Repeated readings of one experiment may violate this assumption; these intervals are exploratory.",
  "中位数、范围和四分位数": "Median, range and quartiles",
  "SD 使用 n − 1；MAD 是相对中位数的绝对偏差中位数":
    "SD uses n − 1; MAD is the median absolute deviation from the median",
  "浓度 (%)": "Concentration (%)",
  中位数: "Median",
  最小值: "Minimum",
  最大值: "Maximum",
  "IQR 标记：供人工复核": "IQR flags for human review",
  "仅在 n ≥ 4 且 IQR 非零时应用 1.5 × IQR 规则。被标记的记录仍参与统计，不会自动排除。":
    "The 1.5 × IQR rule applies only when n ≥ 4 and IQR is nonzero. Flagged records remain in the analysis and are not automatically excluded.",
  "需复核记录 {0}": "Records to review: {0}",
  没有标记记录: "No flagged records",
  实测结果与下一步实验: "Measured results and the next experiment",
  实测均值得率最高: "Highest measured mean yield",
  "{0} · 平均得率 {1}%": "{0} · Mean yield {1}%",
  "只比较已测浓度；并列时全部保留。":
    "Only measured concentrations are compared; all exact ties are retained.",
  模型建议的待验证浓度: "Model candidate for a new experiment",
  "{0}% · 预测得率 {1}%": "{0}% · Predicted yield {1}%",
  "删去一组后的顶点范围：{0}% 。这是敏感性范围，不是置信区间。":
    "Vertices after omitting one group: {0}%. This is a sensitivity range, not a confidence interval.",
  "仅在完整拟合和四次删组拟合都支持范围内的凹形顶点时显示。需要新实验验证，不能称为已证明的最优浓度。":
    "Shown only when the full fit and all four omitted-group fits support an in-range concave vertex. A new experiment is required; this is not a proven optimal concentration.",
  二次模型与留一浓度验证: "Quadratic model and leave-one-concentration-out validation",
  "模型对各浓度的平均得率等权拟合。每一折留出整个浓度组，再用其余组预测；没有把同浓度记录随机拆到训练和验证两侧。":
    "The model fits concentration means with equal weights. Each fold holds out an entire concentration group and predicts it from the other groups; records from the same concentration are not split across training and validation.",
  "模型不可用：{0}": "Model unavailable: {0}",
  "使用 {0} 个浓度组{1}。": "Uses {0} concentration groups{1}.",
  "；三组二次拟合为饱和描述，不能据此验证预测能力":
    "; a quadratic fit to three groups is saturated and cannot validate predictive ability",
  "留一浓度 RMSE：{0} 个得率百分点。":
    "Leave-one-concentration-out RMSE: {0} yield percentage points.",
  "误差为实测均值减预测均值；各折均使用原始得率单位":
    "Error is observed mean minus predicted mean; every fold uses the original yield units",
  "留出浓度 (%)": "Held-out concentration (%)",
  "实测均值 (%)": "Observed mean (%)",
  "预测均值 (%)": "Predicted mean (%)",
  "误差 (百分点)": "Error (percentage points)",
  预测范围: "Prediction range",
  外推: "Extrapolation",
  训练浓度范围内: "Within the training concentration range",
  "留出 0% 或 4% 时，其余训练浓度不包含该端点，因此这两折属于外推。四折误差也不足以证明模型能泛化到新实验。":
    "Holding out 0% or 4% leaves that endpoint outside the training range, so these two folds are extrapolations. Four fold errors do not establish generalization to new experiments.",
  "留一浓度验证不可用：{0}": "Leave-one-concentration-out validation unavailable: {0}",
  拟合细节: "Fit details",
  模型: "Model",
  "y = a × x² + b × x + c；x 为浓度 (%)，y 为得率 (%)":
    "y = a × x² + b × x + c; x is concentration (%), y is yield (%)",
  "系数 a / b / c": "Coefficients a / b / c",
  不可用: "Unavailable",
  "训练 R²": "Training R²",
  "训练 RMSE": "Training RMSE",
  残差自由度: "Residual degrees of freedom",
  矩阵秩: "Matrix rank",
  条件数: "Condition number",
  "删去一组后的顶点，仅用于敏感性检查":
    "Vertices after omitting one group, for sensitivity checks only",
  "顶点浓度 (%)": "Vertex concentration (%)",
  不可用原因: "Reason unavailable",
  方法与复核: "Methods and review",
  "分析局限（{0}）": "Analysis limitation ({0})",
  "封存摘要、随机种子与版本": "Snapshot hashes, seed and versions",
  数据集摘要: "Dataset hash",
  执行指纹: "Execution fingerprint",
  科学结果摘要: "Scientific result hash",
  随机种子: "Random seed",
  选择规则: "Selection policy",
  算法版本: "Algorithm version",
  应用版本: "Application version",
  "Python 代码摘要": "Python code hash",
  "Node 代码摘要": "Node code hash",
  环境摘要: "Environment hash",
  完成时间: "Completed at",
  完整计算环境与配置: "Full computing environment and configuration",
  "报告标识不一致，请刷新后重试。": "The report identifier does not match. Refresh and retry.",
  "当前账号无法访问报告所属班级。": "This account cannot access the report’s class.",
  "报告与所选班级不一致，请重新选择。":
    "The report does not belong to the selected class. Select the class again.",
  "分析已完成，下面是保存的报告。": "Analysis complete. The saved report is shown below.",
  "分析未完成，原因见报告。": "The analysis did not complete. See the report for its reason.",
  "输入已封存，等待计算完成。": "The input is sealed. Waiting for computation.",
  "已自动检查 20 次，自动刷新已暂停。任务仍保留，可稍后点击“刷新”。":
    "After 20 automatic checks, polling has paused. The task is saved; use “Refresh” later.",
  "响应未确认，请使用原分析标识重试。":
    "The response is uncertain. Retry with the original analysis identifier.",
  "已切换班级。原班级的分析标识仍保留。":
    "Class changed. The previous class’s analysis identifier remains saved.",
  "分析服务暂不可用。": "The analysis service is unavailable.",
  "正在建立或读取分析任务。响应中断后，请使用原标识重试。":
    "Creating or reading the analysis task. If the response is interrupted, retry with the original identifier.",
  "分析响应未确认。原标识已保留，重试不会建立另一份快照。":
    "The analysis response is uncertain. The original identifier is saved; retrying will not create another snapshot.",
  "分析回执与本次请求不一致。请保留原标识并刷新后重试。":
    "The analysis receipt does not match this request. Keep the original identifier, refresh and retry.",
  "已读取原分析任务，封存快照保持不变。":
    "The original analysis task was read; its sealed snapshot is unchanged.",
  "分析任务已建立，输入已封存。": "The analysis task was created and its input sealed.",
  "重新分析会替换这个班级的重试标识，并重新封存当前记录。此前响应未确认的任务可能已经成功。确认建立另一份分析？":
    "Analyzing again replaces this class’s retry identifier and seals the current records again. An earlier task with an uncertain response may already exist. Create another analysis?",
  "已确认使用新的分析标识。点击“读取 / 重试原分析”将为当前记录建立新快照。":
    "A new analysis identifier is ready. “Read / retry original analysis” will create a new snapshot of the current records.",
  "已按当前权限刷新。报告仍对应其建立时的封存输入。":
    "Refreshed with current access permissions. The report still uses its original sealed input.",
  "当前无法复算这份报告。": "This report cannot be reproduced now.",
  "同一环境复算：科学结果摘要一致。":
    "Same-environment reproduction: the scientific result hash matches.",
  "同一环境复算：发现差异。": "Same-environment reproduction: a difference was found.",
  "跨环境数值比较通过；这不等于逐字节一致。":
    "Cross-environment numeric comparison passed; this does not mean byte-for-byte identity.",
  "跨环境数值比较发现差异。": "Cross-environment numeric comparison found a difference.",
  "复算返回了未识别的比较方式，请查看明细。":
    "The reproduction returned an unknown comparison mode. See the details.",
  复算明细: "Reproduction details",
  "复算已结束，原报告未被改写。": "Reproduction finished. The original report was not modified.",
  "分析页面地址无效。": "Invalid analysis page address.",
  "班级参数无效，请从班级或报告入口进入。":
    "Invalid class parameter. Open the page from a class or report link.",
  "已读取保存的分析任务。": "The saved analysis task was read.",
  "选择班级后即可建立分析。只使用教师已纳入的记录。":
    "Choose a class to create an analysis. Only teacher-included records are used.",
  报告地址无效: "Invalid report address",
  报告解释读取失败: "The report explanation could not be read",
  "账号已变更，请刷新页面": "The account has changed. Refresh the page",
  报告引用不匹配: "Report citations do not match",
  缺少报告依据: "Supporting report evidence is missing",
  "查看依据 [{0}]": "Inspect source [{0}]",
  "封存报告字段 {0}": "Sealed report field {0}",
  "本项目版本化方法合同（不是外部实验验证）":
    "Versioned project method contract (not external experimental validation)",
  "证据摘要 {0}": "Evidence hash {0}",
  "证据包 {0}": "Evidence pack {0}",
  "科学结果 {0}": "Scientific result {0}",
  "解释摘要 {0}": "Explanation hash {0}",
  "正在读取封存证据…": "Reading sealed evidence…",
  "模型仅调整了说明顺序；全部文字和数值来自本地证据。":
    "The model only changed the order. All wording and values come from local evidence.",
  "模型不可用或输出未通过检查，已使用本地证据顺序。":
    "The model was unavailable or its output failed validation. Local evidence order was used.",
  "本地证据解释；未调用外部模型。": "Local evidence explanation; no external model was called.",
  "请选择一个报告主题。": "Choose a report topic.",
  "检索失败，请重试": "Retrieval failed. Retry",
  "正在查阅项目资料…": "Searching project documentation…",
  资料引用不匹配: "Documentation citations do not match",
  资料引用不完整: "Documentation citations are incomplete",
  "来源：{0}": "Source: {0}",
  "原文摘要：{0}": "Original excerpt hash: {0}",
  "资料版本：{0}": "Corpus version: {0}",
  "回答摘要：{0}": "Answer hash: {0}",
  "已移除识别到的个人信息；本地检索，未调用外部模型。":
    "Detected personal information was removed. Retrieval was local; no external model was called.",
  "本地检索完成，未调用外部模型。": "Local retrieval complete; no external model was called.",
  项目资料检索不可用: "Project documentation retrieval is unavailable",
  "可输入项目方法或使用问题。": "Enter a question about project methods or usage.",
  "已保存的导入标识损坏。若要创建另一批记录，请点击“开始另一次导入”并确认。":
    "The saved import identifier is invalid. To create another batch, choose “Start another import” and confirm.",
  "无法读取已保存的重试标识。请恢复会话存储后重新预览。":
    "The saved retry identifier could not be read. Restore session storage and preview again.",
  "已保存的导入标识不匹配。若要创建另一批记录，请点击“开始另一次导入”并确认。":
    "The saved import identifier does not match. To create another batch, choose “Start another import” and confirm.",
  "无法保存重试标识，会话存储可能已满或不可用。旧标识未清除；请恢复存储后重试。":
    "The retry identifier could not be saved. Session storage may be full or unavailable. The old identifier remains; restore storage and retry.",
  "目标或文件已变更，请重新预览。原导入标识仍可在重新选择同一文件时恢复。":
    "The target or file changed. Preview again. Reselecting the same file can recover the original import identifier.",
  文件: "File",
  "数据行 {0}": "Data row {0}",
  账号已变更: "Account changed",
  "账号已变更，请刷新页面后重新选择班级和文件。":
    "The account has changed. Refresh the page and select the class and file again.",
  "网络响应不确定，请保留当前文件并使用同一导入标识重试。":
    "The network response is uncertain. Keep this file and retry with the same import identifier.",
  "请选择不超过 1 MiB 的 CSV 文件。": "Choose a CSV file no larger than 1 MiB.",
  数据行: "Data row",
  "{0}：{1} 条全部通过验证（展示前 {2} 条）。全部成功或全部失败。{3}":
    "{0}: all {1} rows passed validation (showing the first {2}). The whole file succeeds or fails together. {3}",
  "已恢复同一导入标识；可安全重试。": "The same import identifier was recovered; retrying is safe.",
  "可以整批提交。": "The whole batch is ready to submit.",
  "{0} 条已全部验证，发现 {1} 个错误{2}。没有导入任何记录，请修正文件。":
    "All {0} rows were checked; {1} errors found{2}. No records were imported. Correct the file.",
  "（仅展示前 100 个）": " (showing the first 100 only)",
  "正在整批提交。若响应中断，请使用当前导入标识重试。":
    "Submitting the whole batch. If the response is interrupted, retry with this import identifier.",
  "已读取原批次回执；本次新增 0 条。":
    "The original batch receipt was read; 0 new records were added.",
  "整批完成，新增 {0} 条。再次点击提交会返回同一回执。":
    "Batch complete: {0} records added. Submitting again returns the same receipt.",
  "开始另一次导入会使用新的导入标识，即使文件相同也会创建另一批记录，可能产生重复观测。继续？":
    "Starting another import uses a new identifier and creates another batch, even for the same file. This may duplicate observations. Continue?",
  "已开始另一次导入，请重新预览。提交后将创建另一批记录。":
    "Another import has started. Preview again; submitting will create another batch.",
  "已按当前权限读取原批次回执。": "The original batch receipt was read with current permissions.",
  "表格 CSV 已下载。text: 标记为导出视图防护，平台内文本保持原值。":
    "Spreadsheet CSV downloaded. The text: prefix protects the exported view; platform text retains its original value.",
  "请选择文件并预览。模板只含表头，需填写真实观测后提交。":
    "Choose a file and preview it. The template contains headers only; enter actual observations before submitting.",
  "当前账号没有可用班级，请先通过现有班级流程建立班级。":
    "This account has no available class. Create one through the existing class workflow first.",
  "文件已变更，请检查文件。原文件的重试标识仍保留。":
    "The file changed. Check it again; the original file’s retry identifier remains saved.",
  "无法读取重试标识，请恢复会话存储后重新检查文件。":
    "The retry identifier could not be read. Restore session storage and check the file again.",
  "已保存的上传标识损坏或不匹配。若要替换，请点击“开始另一次上传”并确认；这可能保存重复附件。":
    "The saved upload identifier is invalid or does not match. To replace it, choose “Start another upload” and confirm; this may save a duplicate attachment.",
  "无法保存重试标识，会话存储可能已满或不可用。旧标识未清除，请恢复存储后重试。":
    "The retry identifier could not be saved. Session storage may be full or unavailable. The old identifier remains saved; restore storage and retry.",
  "已下载经服务器校验的附件。": "The server-verified attachment was downloaded.",
  "当前账号不能归档附件。": "This account cannot archive attachments.",
  "归档后保留文件与接收记录，学生将不能查看；此操作无法撤销。继续？":
    "Archiving retains the file and receipt, but prevents student access. It cannot be undone. Continue?",
  "附件已归档，文件与原接收记录仍保留。":
    "Attachment archived. The file and original receipt remain saved.",
  类型: "Type",
  大小: "Size",
  "{0} 字节": "{0} bytes",
  实际接收时间: "Actually received at",
  上传人: "Uploaded by",
  状态: "Status",
  "已归档 · {0}": "Archived · {0}",
  可用: "Available",
  下载: "Download",
  归档: "Archive",
  "当前没有可查看的附件。": "No attachment is available to this account.",
  "账号已变更，请刷新页面后重新选择文件。原账号的重试标识仍保留。":
    "The account has changed. Refresh and select the file again; the original account’s retry identifier remains saved.",
  "响应未确认，请使用同一文件和上传标识重试。":
    "The response is uncertain. Retry with the same file and upload identifier.",
  "请选择非空且不超过 {0} MiB 的文件。": "Choose a nonempty file no larger than {0} MiB.",
  "请选择原导入的 CSV 文件。": "Choose the original imported CSV file.",
  "请选择扩展名和类型一致的 PNG、JPEG 或 PDF 文件。":
    "Choose a PNG, JPEG or PDF with a matching extension and media type.",
  "文件读取长度不一致，请重新选择文件。":
    "The number of bytes read does not match. Select the file again.",
  "当前浏览器无法计算文件摘要，请使用 HTTPS 或本机地址打开页面。":
    "This browser cannot hash the file. Open the page over HTTPS or on localhost.",
  "{0} · {1} 字节 · {2} · SHA-256 {3}": "{0} · {1} bytes · {2} · SHA-256 {3}",
  "已恢复同一上传标识，可以重试。服务器仍会校验文件和当前权限。":
    "The same upload identifier was recovered. You can retry; the server will still validate the file and current permissions.",
  "文件已检查，可以上传。服务器将校验格式与当前权限。":
    "The file was checked and is ready to upload. The server will validate its format and current permissions.",
  "正在上传。响应中断时，请保留文件并使用同一上传标识重试。":
    "Uploading. If the response is interrupted, keep the file and retry with the same upload identifier.",
  "上传响应未确认。请使用同一文件和上传标识重试，避免重复保存。":
    "The upload response is uncertain. Retry with the same file and identifier to avoid a duplicate.",
  "已读取原上传回执，未新增附件；原接收时间保持不变。":
    "The original upload receipt was read. No new attachment was saved and the original receipt time is unchanged.",
  "附件已保存，实际接收时间：{0}。": "Attachment saved. Actually received at: {0}.",
  "开始另一次上传会替换此文件的重试标识。即使文件相同，也可能保存另一份附件；未确认的旧上传可能已成功。继续？":
    "Starting another upload replaces this file’s retry identifier. Even the same file may be saved again, and an earlier uncertain upload may already have succeeded. Continue?",
  "已确认开始另一次上传。点击上传将使用新标识，可能保存重复附件。":
    "Another upload is ready. Uploading uses a new identifier and may save a duplicate attachment.",
  "已按当前权限刷新附件列表。": "The attachment list was refreshed with current permissions.",
  "附件目标无效，请从实验记录或 CSV 回执进入。":
    "Invalid attachment target. Open this page from an experiment record or CSV receipt.",
  实验记录: "Experiment record",
  "CSV 导入批次": "CSV import batch",
  "PNG、JPEG 或 PDF，每个文件不超过 5 MiB。每条记录最多保留 20 个附件（含已归档）。已归档记录不能添加附件。":
    "PNG, JPEG or PDF; up to 5 MiB per file. Each record retains at most 20 attachments, including archived files. Archived records cannot receive attachments.",
  "请附上导入时的原始 UTF-8 CSV，最多 1 MiB。文件字节须与原回执完全一致；每批最多保留 20 个附件（含已归档）。":
    "Attach the original UTF-8 CSV used for import, up to 1 MiB. Its bytes must exactly match the original receipt. Each batch retains at most 20 attachments, including archived files.",
  "已读取附件。选择文件后先检查，再上传。":
    "Attachments loaded. Select a file, check it, then upload.",
  "科学分析 · EchoClass": "Scientific analysis · EchoClass",
  "实验记录 · 审阅 · 分析": "Experiment records · Review · Analysis",
  科学分析: "Scientific analysis",
  "从班级当前记录建立一份固定快照，只分析教师已纳入的记录。之后修改记录或审阅，不会改写这份报告。":
    "Create a fixed snapshot of current class records and analyze only teacher-included records. Later edits or reviews do not modify this report.",
  选择班级: "Choose a class",
  班级: "Class",
  "正在读取…": "Loading…",
  重新分析当前数据: "Analyze current data again",
  刷新: "Refresh",
  "正在读取分析标识…": "Reading the analysis identifier…",
  "响应中断后，点击重试会读取原任务。只有确认“重新分析当前数据”，才会为当前记录建立另一份快照。":
    "If the response is interrupted, retry reads the original task. Only confirming “Analyze current data again” creates another snapshot of the current records.",
  "正在读取分析记录…": "Reading saved analyses…",
  最近的分析: "Recent analyses",
  复算这份快照: "Reproduce this snapshot",
  复算并核对: "Reproduce and compare",
  "重新读取同一份封存输入和配置。此操作不改写已保存报告；跨环境比较会单独标明。":
    "Read the same sealed input and configuration again. The saved report is not modified; comparisons across environments are identified separately.",
  已保存的科学分析报告: "Saved scientific analysis report",
  "报告解释 · EchoClass": "Report explanation · EchoClass",
  "← 返回科学报告": "← Back to the scientific report",
  "封存报告 · 可核对的引用": "Sealed report · Inspectable citations",
  读懂这份报告: "Read this report",
  "选择一个主题，逐段查看解释和依据。这里不提供开放问答，也不会重新计算或改写报告。":
    "Choose a topic to inspect its explanation and evidence. This is a bounded report reader; it does not recompute or modify the report.",
  "想了解什么？": "What would you like to understand?",
  允许外部模型调整说明顺序: "Allow an external model to reorder explanations",
  "默认不调用外部模型。启用时只发送主题和固定卡片标题，不发送实验值、姓名、备注或报告标识。文字和数值始终由本地证据生成。":
    "No external model is called by default. If enabled, only the topic and fixed card titles are sent; experiment values, names, notes and report identifiers are excluded. Wording and values are always generated from local evidence.",
  查看解释与依据: "Read explanations and evidence",
  "正在核实报告权限…": "Checking report access…",
  查阅项目资料: "Search project documentation",
  "输入方法或使用问题，例如“bootstrap 区间怎么计算”。仅搜索版本化项目指南并展示原文，不搜索互联网或上传文件，不调用外部模型；不要输入姓名、学号或联系方式。":
    "Ask about a method or workflow, for example “How is the bootstrap interval calculated?”. Search covers versioned project guides and shows original excerpts. It does not search the internet, uploaded files or call an external model. Do not enter names, student IDs or contact details.",
  "问题（最多 500 字）": "Question (up to 500 characters)",
  查找资料与引用: "Find documentation and citations",
  "正在核实检索权限…": "Checking retrieval access…",
  "引用证明的是程序使用了哪些保存值与方法，不证明实验真实、独立、显著或最优。统计计算的独立审计和真实模型质量评测尚待完成。":
    "Citations identify saved values and methods used by the program. They do not establish experimental authenticity, independence, significance or optimality. Independent statistical review and evaluation of a real model are still pending.",
  有来源的报告解释: "Report explanation with sources",
  项目资料原文: "Original project documentation",
  "CSV 实验数据 · EchoClass": "CSV experiment data · EchoClass",
  "CSV 实验数据": "CSV experiment data",
  "选择现存班级，下载固定模板并填写观测。每次最多 500 条、1 MiB，整文件全部成功或全部失败。":
    "Choose an existing class, download the fixed template and enter observations. Each file is limited to 500 records and 1 MiB; the whole file succeeds or fails together.",
  目标班级: "Target class",
  下载空白模板: "Download a blank template",
  "UTF-8 CSV 文件": "UTF-8 CSV file",
  验证并预览: "Validate and preview",
  "整批提交 / 重试": "Submit batch / retry",
  开始另一次导入: "Start another import",
  "网络中断或刷新后，请重新选择同一文件并预览，再点击重试；系统会恢复本次导入标识。另一次导入会创建另一批记录，可能产生重复观测。":
    "After an interrupted response or refresh, select the same file, preview it and retry. The same import identifier is recovered. Another import creates another batch and may duplicate observations.",
  "正在加载班级…": "Loading classes…",
  导入回执: "Import receipt",
  尚无回执: "No receipt yet",
  "回执保存摘要与行到记录的映射。导入不会自动保存原始 CSV；可从当前回执随后附上字节完全一致的原文件。文件从实际上传成功时开始保管，不追溯至导入时间。":
    "The receipt stores a hash and row-to-record mapping. Import does not automatically retain the original CSV. You can attach the byte-identical original file to the current receipt later. Custody starts when upload actually succeeds, not at the earlier import time.",
  读取当前回执: "Read the current receipt",
  "查看 / 附上原 CSV 文件": "View / attach the original CSV",
  导出当前班级: "Export the current class",
  "展示 CSV 包含当前有效记录及其实际审阅状态。危险文本带 text: 前缀；它不是导入模板、原件或分析快照。":
    "The spreadsheet CSV contains current active records and their actual review status. Potentially dangerous text has a text: prefix. This is an export view, not an import template, original file or analysis snapshot.",
  "下载表格 CSV": "Download spreadsheet CSV",
  "实验附件 · EchoClass": "Experiment attachments · EchoClass",
  实验附件: "Experiment attachments",
  "平台从文件实际上传成功时开始保管，接收时间见下方列表。后来补交的附件不能证明此前实验或浏览器测量使用了此文件，也不证明实验真实性或素材权利。":
    "Custody starts when a file is actually uploaded successfully; receipt times appear below. A later attachment cannot establish that an earlier experiment or browser measurement used this file, or establish experimental authenticity or asset rights.",
  添加附件: "Add an attachment",
  选择文件: "Choose a file",
  检查文件: "Check file",
  "上传 / 重试": "Upload / retry",
  开始另一次上传: "Start another upload",
  尚未选择文件: "No file selected",
  "响应中断或刷新后，请重新选择同一文件并检查，再点击重试。切换文件不会清除已保存的重试标识。只有确认“开始另一次上传”才会替换该文件的标识，相同文件可能因此保存多份。":
    "After an interrupted response or refresh, select the same file, check it and retry. Changing files does not erase a saved retry identifier. Only confirming “Start another upload” replaces that file’s identifier; the same file may then be saved again.",
  "正在读取附件…": "Loading attachments…",
  已保存附件: "Saved attachments",
  刷新列表: "Refresh list",
  "附件仅供下载，不在此页面预览。归档会保留文件与接收记录，学生无法查看已归档附件。":
    "Attachments are downloaded rather than previewed here. Archiving retains the file and receipt; students cannot view archived attachments.",
  "这份报告说明了什么？": "What does this report show?",
  "哪些记录进入了分析？": "Which records were included?",
  "各浓度的均值和离散程度怎样？": "How do group means and spread compare?",
  "Bootstrap 区间能说明什么？": "What does a bootstrap interval mean?",
  "异常值会被自动删除吗？": "Are outliers removed automatically?",
  "模型怎样做交叉验证？": "How is the model cross-validated?",
  "已测条件中哪一组最好？": "Which measured condition has the highest mean?",
  "候选浓度等于最优条件吗？": "Is the candidate concentration an optimum?",
  "这份报告不能证明什么？": "What cannot this report establish?",
  "封存的原解释（摘要覆盖此原文）": "Canonical explanation (covered by the displayed hashes)",
  "英文阅读说明来自同一组引用字段；展开查看封存原解释和原值。摘要对应原文与原值，不对应英文阅读说明。":
    "The English reading aid uses the same cited fields. Expand to inspect the canonical explanation and original values. The hashes cover that canonical content, not the English reading aid.",
  "引用原文保留其原始语言；摘要对应未翻译的回答与引用。":
    "Excerpts retain their original language. The hash covers the untranslated answer and citations.",
  "封存的检索回答（摘要覆盖此原文）": "Canonical retrieval answer (covered by its hash)",
  "信息不足：本项目指南没有找到足够的词面依据。可尝试具体术语，如 bootstrap、人工审核或 CSV；检索不会猜测答案。":
    "Insufficient evidence: no adequate lexical match was found in the project guides. Try a specific term such as bootstrap or CSV. Retrieval does not guess an answer.",
  "不执行问题中的指令变更、密钥请求或工具操作。这里仅检索版本化项目资料。":
    "Instruction changes, secret requests and tool operations are not executed. This search only retrieves versioned project documentation.",
  "本资料不支持此类操作或决策。请查看安全边界原文。":
    "The documentation does not support these operations or decisions. Inspect the original safety boundary.",
  "先核对前提：现有项目资料不能支持确定性或过度推断的结论。相关限制如下；这不是对问题前提的认可。":
    "Check the premise first: the project documentation does not support certainty or overextended conclusions. Inspect the limitations below; retrieval does not endorse the premise.",
  "找到以下项目指南原文，仅供核对方法和软件行为；这些片段不构成对任意问题的完整回答，也不确认问题前提。具体报告数值请查看上方证据卡片。":
    "The following original project-guide excerpts help inspect methods and software behavior. They are not a complete answer to every question and do not endorse its premise. Report values appear in the evidence cards above.",
  "只检索第一方项目说明；没有外部文献或真实实验验证。":
    "Only first-party project documentation is searched; external literature and actual experimental validation are absent.",
  "词面匹配可能漏检或错配；原文片段不等于完整答案。":
    "Lexical matching can miss or misidentify material; an excerpt is not a complete answer.",
  "未调用语言模型；不评价模型质量。":
    "No language model was called; this does not evaluate model quality.",
});

function interpolate(source: string, values: unknown[]): string {
  return source.replace(/\{(\d+)\}/g, (slot, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : slot,
  );
}

export function operationText(language: Language, source: string, ...values: unknown[]): string {
  return interpolate(
    language === "en" && Object.hasOwn(OPERATION_ENGLISH, source)
      ? OPERATION_ENGLISH[source]!
      : source,
    values,
  );
}

/** Accept only trusted static page markup: records and citations are rendered separately. */
export function localizeOperationMarkup(markup: string, language: Language): string {
  if (language === "zh") return markup;
  const text = (value: string) => {
    const trimmed = value.trim();
    return Object.hasOwn(OPERATION_ENGLISH, trimmed)
      ? value.replace(trimmed, OPERATION_ENGLISH[trimmed]!)
      : value;
  };
  return markup
    .replace('<html lang="zh-CN">', '<html lang="en">')
    .replace(/>([^<>]*)</g, (_match, value: string) => `>${text(value)}<`)
    .replace(/aria-label="([^"]*)"/g, (_match, value: string) => `aria-label="${text(value)}"`);
}

export function operationErrorText(
  language: Language,
  message: string,
  code: string,
  status?: number,
): string {
  if (language === "zh") return message;
  if (Object.hasOwn(OPERATION_ENGLISH, message)) return OPERATION_ENGLISH[message]!;
  const labels: Readonly<Record<string, string>> = {
    UNAUTHENTICATED: "Sign in again",
    AUTHENTICATION_REQUIRED: "Sign in again",
    FORBIDDEN: "Access denied",
    VALIDATION_ERROR: "Check the request",
    CONFLICT: "The request conflicts with the saved state",
    RATE_LIMITED: "Too many requests; try later",
    STORAGE_UNAVAILABLE: "The service is unavailable",
    NOT_FOUND: "Not found",
    PAYLOAD_TOO_LARGE: "The file is too large",
    PASSWORD_CHANGE_REQUIRED: "Change your temporary password first",
  };
  return (
    (labels[code] || "Request failed") +
    " (" +
    (code || status || "unknown") +
    "). Server detail (original language): " +
    message
  );
}

/** A same-origin classic script keeps one catalog shared by server and browser views. */
export function operationLanguageScript(): string {
  return `(() => {
    "use strict";
    const OPERATION_ENGLISH = Object.freeze(${JSON.stringify(OPERATION_ENGLISH)});
    const interpolate = ${interpolate.toString()};
    const readingCard = ${groundedReadingCard.toString()};
    const language = document.documentElement.lang.startsWith("zh") ? "zh" : "en";
    const text = (source, ...values) => interpolate(language === "en" && Object.hasOwn(OPERATION_ENGLISH, source) ? OPERATION_ENGLISH[source] : source, values);
    const operationErrorText = ${operationErrorText.toString()};
    const error = (message, code, status) => operationErrorText(language, message, code, status);
    globalThis.EchoClassUI = Object.freeze({language, text, error, readingCard});
  })();`;
}
