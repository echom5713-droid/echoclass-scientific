import type { Language } from "../shared/language.js";

// Only the fixed public project pages and their frame use this dictionary. Submitted records,
// scientific inputs, source excerpts and user names never pass through it.
const chinese: Readonly<Record<string, string>> = {
  "Scientific records, made inspectable": "让科学记录可以追问",
  "EchoClass — a small scientific data system for chemistry laboratory records, review and reproducible analysis.":
    "EchoClass：面向化学实验记录、人工审核与可复现分析的小型科学数据系统。",
  "Skip to content": "跳转到正文",
  "EchoClass home": "EchoClass 首页",
  "Main navigation": "主导航",
  "The project": "项目介绍",
  "Engineering notes": "工程说明",
  "Trace a result": "追踪一份结果",
  "Classroom ↗": "课堂入口 ↗",
  "Chemistry, records, and the limits of a conclusion.": "化学、记录，以及结论的边界。",
  "Source · review branch ↗": "源码 · 审阅分支 ↗",
  "A chemistry data project / work in progress": "化学数据项目 / 持续开发中",
  "What happened<br>before the chart?": "图表之前，<br>发生了什么？",
  "A yield is easy to plot. Keeping its original measurement, a teacher’s decision and the exact inputs behind a report takes more care.":
    "画出得率并不难。更需要认真处理的是：保留原始测量、教师的判断，以及报告实际使用的输入。",
  "EchoClass follows citrus-extraction records from collection to review and reproducible analysis.":
    "EchoClass 追踪柑橘精油提取记录，从采集、审核，到可复现分析。",
  "Read the engineering notes": "阅读工程说明",
  "Start with one result ↓": "从一个结果开始 ↓",
  "FIELD NOTE / 01": "研究笔记 / 01",
  "FIELD NOTE / 02": "研究笔记 / 02",
  "Synthetic fixture": "合成测试数据",
  "Best tested does not mean optimum": "已测条件中的最佳，不等于真正最优",
  "Twenty synthetic yields: five each at zero, one, three and four percent ammonium chloride. Mean yields are six, nine, nine and six percent. A quadratic fitted to these group means has a candidate at two percent, where this fixture has no observations.":
    "20 条合成得率：氯化铵浓度 0%、1%、3%、4% 各 5 条，均值为 6%、9%、9%、6%。对这些组均值拟合的二次模型在 2% 附近给出候选，但该浓度没有观测。",
  "Oil yield / %": "精油得率 / %",
  "A candidate, untested": "未经实测的候选",
  "NH₄Cl concentration / %": "NH₄Cl 浓度 / %",
  "Synthetic observations": "合成观测",
  "Quadratic through group means": "组均值的二次拟合",
  "20 invented records; no evidence of extraction efficacy.":
    "20 条虚构记录；不构成提取效果的证据。",
  "01 / A small question": "01 / 一个具体问题",
  "Two groups tie.<br>The model points somewhere else.": "两个组并列。<br>模型却指向别处。",
  "In the synthetic case, 1% and 3% NH₄Cl both have a mean oil yield of 9%. A quadratic fitted to the four group means suggests a candidate near 2%. There are no measurements at 2%.":
    "在合成案例中，1% 和 3% NH₄Cl 的平均精油得率都是 9%。对四个组均值拟合二次模型，得到 2% 附近的候选。2% 处没有测量。",
  "The report keeps those statements separate. The candidate is a reason to design another experiment; it is not an experimentally established optimum.":
    "报告分别保留这些事实。候选可以成为设计下一次实验的理由，但还不是实验确立的最优条件。",
  "The demonstration, at a glance": "案例数据概览",
  Records: "记录数",
  "Mean yield / %": "平均得率 / %",
  "These values belong to the offline scientific fixture. The older classroom demonstration uses a different synthetic dataset.":
    "这些数值来自离线科学测试数据。原课堂演示使用另一份合成数据。",
  "Inspect the fixture and reproduce the calculation ↗": "检查输入并复现计算 ↗",
  "What if the curve is wrong?": "如果曲线本身不合适呢？",
  "Another response can pass through exactly the same four tested means and have a trough at 2%, where this quadratic has its peak. The observations and cross-validation scores alone cannot distinguish them.":
    "另一条响应曲线可以经过完全相同的四个已测均值，却在 2% 处出现低谷；二次曲线在这里是峰顶。仅凭这些观测和交叉验证分数，无法区分它们。",
  "The fixed method study compares constant, linear and quadratic models across five synthetic scenarios and twelve seeds. It retains this counterexample alongside the cases where the quadratic works.":
    "固定方法研究在五种合成情景、十二个种子上比较常数、线性和二次模型。除了二次模型有效的案例，也保留这个反例。",
  "Same observations, different unseen responses ↗": "相同观测，不同的未测响应 ↗",
  "Try a follow-up measurement →": "尝试设计后续测量 →",
  "02 / What is preserved": "02 / 保留什么",
  "A correction should leave a trace.": "修正应该留下痕迹。",
  "The submission": "原始提交",
  "Original values and server-owned identity remain available when a record is corrected or archived.":
    "记录被修正或归档后，仍能查看原始数值及服务器分配的身份。",
  "The decision": "审核判断",
  "Teacher review is recorded separately. A quality flag prompts review; it does not silently decide inclusion.":
    "教师审核单独记录。质量标记用于提示复核，不会暗中决定是否纳入分析。",
  "The calculation": "实际计算",
  "A report seals its inputs and review decisions. Later edits cannot quietly change an earlier result.":
    "报告封存自己的输入和审核决定。后续修改不能悄悄改变已有结果。",
  "Read the choices behind this workflow →": "阅读流程背后的取舍 →",
  "03 / Try the work": "03 / 亲自运行",
  "Read first. Then run it.": "先读，再运行。",
  "The scientific example runs locally without an account or provider key. The classroom demo shows the older collection and descriptive-review workflow in Chinese.":
    "科学案例无需账号或模型密钥即可本地运行。原课堂演示保留中文的采集与描述性审核流程。",
  "Reproduce the example": "复现案例",
  "Classroom demo →": "课堂演示 →",
  "Research prototype. Synthetic demonstrations, developer regression tests, and AI-assisted development are documented in the repository. Independent statistical and deployment review remains open.":
    "研究原型。仓库注明了合成演示、开发者回归测试及 AI 辅助开发的范围。独立统计与部署审查仍未完成。",
  "Engineering notebook / beta review": "工程笔记 / 测试版审阅",
  "Keep the path<br>to a result.": "保留通向结果<br>的那条路径。",
  "The difficult part is preserving what a conclusion depends on when records, reviews and code can change.":
    "记录、审核和代码都会改变。困难之处是保留一项结论当时依赖的证据。",
  "01 / Design decisions": "01 / 设计取舍",
  "Small boundaries, explicit responsibilities.": "边界适度，职责明确。",
  "SQLite owns the record history.": "SQLite 保存记录历史。",
  "Transactions keep a CSV batch and its receipt together. Constraints and append-only review events support provenance below the HTTP layer. The optional JSON adapter has weaker guarantees.":
    "事务让 CSV 批次和回执一起提交。约束与只追加的审核事件在 HTTP 层之下保护数据来源。可选 JSON 适配器的保证较弱。",
  "Python owns the calculation.": "Python 负责计算。",
  "Node seals the selected inputs and supervises a local worker. Python calculates statistics and an exploratory fit. Node validates the returned structure and scientific constraints before saving the report.":
    "Node 封存选定输入并管理本地计算进程。Python 计算统计量和探索性拟合。保存报告前，Node 检查返回结构及科学约束。",
  "The report owns its snapshot.": "报告持有自己的快照。",
  "Reproduction reads the saved inputs, not today’s classroom table. A hash detects a changed representation; it does not prove that a measurement is true.":
    "复算读取当时保存的输入，而不是今天的课堂表。哈希可发现表示发生变化，但不能证明测量真实。",
  "Explanations stay close to evidence.": "解释贴近证据。",
  "Report cards cite saved values and versioned method notes. Local FTS5/BM25 retrieval returns exact excerpts from the project guide. Optional model assistance can reorder cards, not write scientific conclusions.":
    "报告卡片引用已保存数值与版本化方法说明。本地 FTS5/BM25 检索返回项目指南的原文片段。可选模型辅助只重排卡片，不生成科学结论。",
  "This boundary applies to the evidence-linked assistant. The older general classroom chat has a different, less constrained contract.":
    "这个边界适用于关联证据的助手。原通用课堂聊天采用另一套限制较少的合同。",
  "02 / Reproduce a case": "02 / 复现案例",
  "Twenty records. One inspectable calculation.": "二十条记录。一次可追问的计算。",
  "On Linux, use Node.js 24 and Python 3.12.13. Run from the repository root. This command reads a synthetic fixture without importing it into a classroom.":
    "在 Linux 上使用 Node.js 24 与 Python 3.12.13，从仓库根目录运行。命令读取合成测试数据，不会将其导入课堂。",
  "Expect a tie at 1% and 3%, and an exploratory candidate near 2%. The command prints the actual result hash; its default JSON output also includes the observed runtime identity. Fixture identity is synthetic; an offline run is not a production exact-reproduction claim.":
    "预期 1% 与 3% 并列，并出现 2% 附近的探索性候选。命令打印实际结果哈希；默认 JSON 也包含实测运行环境身份。测试身份是合成的，离线运行不构成生产报告的精确复现声明。",
  "Full case, assumptions and commands ↗": "完整案例、假设与命令 ↗",
  "03 / A scientific question": "03 / 科学问题",
  "Can the data identify the curve?": "数据能识别曲线吗？",
  "At 0%, 1%, 3% and 4%, the responses <code>6 + 4x − x²</code> and <code>6 + 4(x − 2)² − (x − 2)⁴</code> are identical. At 2%, they give 10% and 6%. Both curves are invented; the disagreement is deliberate.":
    "在 0%、1%、3%、4% 处，响应 <code>6 + 4x − x²</code> 与 <code>6 + 4(x − 2)² − (x − 2)⁴</code> 完全相同。在 2% 处，它们分别给出 10% 和 6%。两条曲线均为人为构造，差异是特意设计的。",
  "The method study pairs the same synthetic errors across these responses, sends the same sealed observations through the production analysis and compares simpler baselines. A small leave-one-concentration-out error cannot distinguish an unseen peak from an unseen trough.":
    "方法研究给这两条响应配对相同的合成误差，将相同封存观测送入生产分析，并比较更简单的基线。较小的留一浓度误差无法区分未测处的峰顶与低谷。",
  "Five fixed scenarios, twelve fixed seeds and full trial outputs. The held-out grid evaluates known synthetic truth; it does not choose a model or claim a validated chemical optimum.":
    "五个固定情景、十二个固定种子，以及全部试验输出。留出网格用于评价已知合成真值，不用于选择模型，也不声称验证了化学最优条件。",
  "Inspect the design, results and counterexample ↗": "检查设计、结果与反例 ↗",
  "04 / Design the next measurement": "04 / 设计下一次测量",
  "Where would you<br>measure next?": "下一次，<br>你会测哪里？",
  "A disagreement can guide the next experiment. Here, the task is to distinguish two fully specified, invented responses: the quadratic <code>q(x) = 6 + 4x − x²</code> and the quartic <code>f(x) = q(x) − x(x − 1)(x − 3)(x − 4)</code>.":
    "预测分歧可以指导下一次实验。这里的任务是区分两条完全指定的虚构响应：二次函数 <code>q(x) = 6 + 4x − x²</code> 和四次函数 <code>f(x) = q(x) − x(x − 1)(x − 3)(x − 4)</code>。",
  "Two known hypotheses": "两个已知假设",
  "A new concentration can separate these two responses": "新的浓度可以区分这两条响应",
  "The quadratic and quartic agree at the four original concentrations. At the selected 2.00%, they predict 10.00% and 6.00% oil yield, respectively.":
    "二次与四次响应在原来的四个浓度上相同。在当前选择的 2.00% 处，它们分别预测 10.00% 和 6.00% 精油得率。",
  "Quadratic q": "二次函数 q",
  "Quartic f": "四次函数 f",
  "Original tested means": "原已测均值",
  "Choose a follow-up design": "选择后续测量设计",
  "New concentration": "新浓度",
  "Known noise SD": "已知噪声标准差",
  "yield percentage points": "得率的百分点",
  "Independent repeats": "独立重复次数",
  "at the new concentration": "在新浓度处",
  "1 measurement": "1 次测量",
  "3 measurements": "3 次测量",
  "5 measurements": "5 次测量",
  "2.00 percent ammonium chloride": "氯化铵浓度 2.00%",
  "The default design is shown below. Enable JavaScript to change the controls.":
    "下方显示默认设计。启用 JavaScript 后可以调整控件。",
  "Quadratic prediction": "二次响应预测",
  "Quartic prediction": "四次响应预测",
  "Absolute gap": "绝对差值",
  "percentage points": "个百分点",
  "Theoretical probability<br>of choosing the wrong hypothesis": "选错假设的<br>理论概率",
  "At 2.00%, the predictions differ by 4.00 percentage points. With SD 2 and 3 independent measurements, the theoretical error is 4.16%.":
    "在 2.00% 处，两项预测相差 4.00 个百分点。已知标准差为 2、独立测量 3 次时，理论错误概率为 4.16%。",
  "At 1%, both hypotheses predict 9% yield. Any repeat count above gives a 50% theoretical error there: more precision at the same point cannot reveal this disagreement.":
    "在 1% 处，两个假设都预测 9% 得率。上面的任一重复次数都对应 50% 理论错误概率：只提高同一位置的测量精度，不能揭示这项分歧。",
  "This calculation assumes independent Gaussian measurement noise with the selected, known SD; equal prior probabilities and equal error costs; and a decision based on which predicted mean is closer to the new sample mean (balanced assignment on a tie). Its error is Φ(−|q − f|√n / (2σ)), where Φ is the standard normal cumulative distribution function. In the simulation, ties alternate labels by trial index without using the true label. These assumptions differ from the earlier method study’s bounded uniform noise.":
    "计算假设测量噪声是独立高斯噪声，标准差已知且为所选值；两种假设的先验概率及误判代价相同；按照哪个预测均值更接近新样本均值作出判断（平局时均衡分配）。错误概率为 Φ(−|q − f|√n / (2σ))，其中 Φ 是标准正态累积分布函数。模拟中的平局按试验序号交替分配，不使用真实标签。这些假设与此前方法研究的有界均匀噪声不同。",
  "This is a design exercise, not observed confidence, a chemical recommendation or evidence of an optimum. A fifth concentration may distinguish these two curves; it cannot identify an arbitrary response curve.":
    "这是一项设计练习，不是实测置信度、化学操作建议或最优条件证据。第五个浓度可能区分这两条曲线，但不能识别任意响应曲线。",
  "Read the derivation, simulation and remaining ambiguity ↗": "阅读推导、模拟与仍然存在的歧义 ↗",
  "05 / A failure worth keeping": "05 / 值得保留的失败",
  "A retry is the same intent.": "重试仍是同一次提交意图。",
  "A lost response can make a successful submission look like a failure. The older client assigned its retry token too late and shared one browser queue across accounts.":
    "响应丢失会让成功提交看起来像失败。原客户端过晚分配重试标识，还让不同账号共用同一个浏览器队列。",
  "The corrected student path saves an intent identifier before sending, retains it for retries, and checks the current account and class. Unscoped historical drafts are held for manual review. Server validation errors are shown as errors, rather than treated as offline success.":
    "修正后的学生流程在发送前保存意图标识，重试时继续使用，并核对当前账号和班级。归属不明的历史草稿保留给人工检查。服务器校验失败会明确显示，不再被当作离线成功。",
  "The regression tests exercise a lost response and an account switch. The important result is not that the network never fails, but that recovery preserves the original intent.":
    "回归测试覆盖响应丢失与账号切换。它们验证故障恢复时仍保留原始意图，而不是保证网络永不出错。",
  "Implementation notes and remaining boundaries ↗": "实现记录与剩余边界 ↗",
  "06 / What to inspect": "06 / 查看哪里",
  "A short route through the repository.": "一条简短的源码阅读路线。",
  "The synthetic case": "合成案例",
  "Inputs, expected comparisons, assumptions.": "输入、预期比较与假设。",
  "Scientific service": "科学分析服务",
  "Review selection and report lifecycle.": "审核选择与报告生命周期。",
  "Python methods": "Python 方法",
  "Statistics, bootstrap and group-mean fitting.": "统计量、自助法与组均值拟合。",
  "Scientific HTTP tests": "科学分析 HTTP 测试",
  "Run creation, saved evidence and reproduction.": "创建分析、保存证据与复算。",
  "Development notes": "开发说明",
  "Tradeoffs, tool assistance and open work.": "取舍、工具协作与未完成工作。",
  "07 / Limits": "07 / 能力边界",
  "Reproducible is not the same as validated.": "可复现，不等于已验证。",
  "The example is invented. Bootstrap intervals assume independent records; the database cannot establish independence. Four concentration groups give limited evidence for a model. There is no automatic image interpretation, validated extraction optimum, or measured classroom benefit.":
    "案例是虚构的。自助法区间假设记录独立，数据库不能证明独立性。四个浓度组对模型的支持有限。目前没有自动图像解读、经过验证的提取最优条件或实测课堂收益。",
  "Tests cover specific failure cases. Independent scientific and security acceptance is still pending. Public release also requires resolution of the documented credential, asset and historical-data issues.":
    "测试覆盖具体失败情形。独立科学与安全验收仍待完成。公开发布还需要解决已记录的凭据、素材和历史数据问题。",
  "Open risks and release conditions ↗": "未解决风险与发布条件 ↗",
};

export function localizeProjectMarkup(markup: string, language: Language): string {
  if (language === "en") return markup;
  for (const [english, translation] of Object.entries(chinese).sort(
    (a, b) => b[0].length - a[0].length,
  ))
    markup = markup.replaceAll(english, translation);
  return markup;
}
