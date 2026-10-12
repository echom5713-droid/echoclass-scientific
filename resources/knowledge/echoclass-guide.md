# EchoClass project guide

Document: echoclass-guide
Version: 1
Rights: First-party project documentation; no third-party laboratory manual is reproduced.

## scope | 资料范围与实验原理 / Scope

EchoClass 管理实验数据、人工审核与可复现分析。这份资料说明软件中的 NH4Cl（氯化铵）浓度与得率字段，不包含实验反应机理、试剂配方或操作协议。不能从字段名称推断化学机理；原理问题需要另行核实的实验协议。This guide documents the software, not a validated laboratory protocol or reaction mechanism.

## dictionary | 字段与单位 / Data dictionary

nh4cl_concentration 是氯化铵浓度字段，当前分析仅支持 0、1、3、4 四个浓度条件；CSV 将其标为 %。peel_mass（橘皮质量）与 oil_mass（精油质量） 单位为 g；yield_percent 的单位为 %。单位由固定 schema 解释，不会自动把 mg 转成 g。Data dictionary: concentration in %, peel_mass and oil_mass in g, yield_percent in %; no automatic unit conversion.

## yield | 得率重算 / Yield calculation

软件按 oil_mass / peel_mass × 100 计算得率，要求 peel_mass > 0，计算结果必须有限且满足领域校验。客户端提交的得率不是权威值。这是本项目记录的质量比指标，不自动等同于按限制试剂计算的理论化学产率。Yield is a server-derived mass ratio, not a verified theoretical chemical yield.

## sample | 示例来源 / Synthetic sample

data/sample/nh4cl_yield.csv 是匿名合成演示数据，用于测试软件工作流。它不是实际课堂测量，不证明教学效果、反应机理或工艺性能。Synthetic sample observations are demonstration fixtures, not real experiments or evidence of efficacy.

## review | 人工审核与纳入 / Human review

科学报告封存全部当前有效候选记录和当时的审核决定；只有人工标为 included 的记录参与计算。pending、flagged 或 excluded 记录不进入当前 approved_only 分析。IQR 标记不会自动删除数据或替代教师决定。Human review is append-only; automated flags do not authorize exclusion. An IQR flag does not automatically delete data.

## descriptive | 描述性统计 / Descriptive statistics

每个浓度组显示样本量 n、均值 mean、中位数 median、最小值、最大值、样本标准差 sample SD、IQR 和 MAD。样本标准差使用 n−1 作分母；n < 2 时不可用。空组的统计量返回不可用原因，不伪造零。Statistics describe the included records and do not establish independent replication.

## bootstrap | 自助法区间 / Bootstrap interval

均值的 95% bootstrap 区间使用组内记录重采样，10,000 次，percentile 方法与 PCG64 随机数生成器。种子从封存数据和设置确定。记录独立性是未经数据库证明的假设；n < 2 或常数组的区间不可用。区间不是下次实验结果的保证。Bootstrap intervals assume independent records; they are not prediction guarantees.

## iqr | 四分位异常标记 / IQR

IQR 是 Q3−Q1。当前规则在 n ≥ 4 且 IQR 非零时，标记低于 Q1−1.5×IQR 或高于 Q3+1.5×IQR 的观测。标记是复核提示，不能证明记录错误，不能自动排除数据。IQR flags are review prompts, not automatic deletion decisions.

## mad | 中位绝对偏差 / MAD

MAD 是各观测与中位数距离的中位数；报告同时给出原始 MAD 和正态一致性缩放值 mad_normal。MAD 为零可能来自相同观测，不代表所有实验没有误差。当前报告没有输出独立的 MAD robust z-score 异常列表。MAD is a robust dispersion summary; no MAD z-score detector is claimed.

## regression | 二次拟合 / Quadratic regression

当前二次回归对各浓度组均值等权拟合，使用训练数据确定数值缩放。四个浓度不足以确立可靠响应面；拟合可能不可用。它不是机器学习突破，也不是对所有平行记录直接等权拟合。Quadratic regression uses equally weighted group means, an explicit departure from the initial plan to fit all records.

## metrics | 拟合指标 / R squared and RMSE

R²（R squared）描述训练组均值中的解释变异比例；RMSE 是预测残差平方平均值的平方根，使用原得率单位。训练指标衡量拟合表现，不能代替独立测试集、科学显著性或未来表现。Training fit metrics do not establish generalisation or causality.

## loocv | 留一浓度验证 / LOOCV

LOOCV 每次留出一个浓度组，用其余组重新拟合，再预测被留出组的均值。它不是每次留出一条平行记录。端点 0 与 4 的折属于外推，报告单独标记；不把部分成功折平均为完整验证。Leave-one-concentration-out validation has four folds and extrapolation warnings.

## candidate | 实测最佳与模型候选 / Best tested versus candidate

best_tested 是已纳入数据中均值最高的实测浓度，精确均值并列时保留全部并列组。model candidate 仅在完整拟合和所有留一折均为凹形、顶点位于范围内且数值稳定时显示；它需要新实验验证。留一顶点范围是敏感性范围，不是 bootstrap 置信区间。Neither the observed winner nor a model candidate establishes a confirmed optimum.

## provenance | 哈希与追溯 / Hash and provenance

报告绑定封存的记录与审核快照、dataset_hash、代码/环境标识、设置和 scientific_result_hash。SHA-256 检查内容是否一致，不证明实验真实、测量正确或记录彼此独立。Hashes provide content integrity, not scientific truth or authorship authentication.

## reproduce | 复现与修改 / Reproduction

复现使用报告原有封存输入；之后修改或归档记录不会改写旧报告。精确比较要求相同代码与环境；允许的不同环境比较必须标为数值比较。需要分析更正后的数据时创建新报告。Reproduction preserves historical inputs; rerunning a new cohort creates a distinct report.

## csv | CSV 导入 / CSV import

在 CSV 页面下载固定模板、预览逐行错误，再确认导入。整个批次、映射、完成标记和成功审计同事务提交；任一失败回滚。相同原始字节与幂等标识可取回原回执；换字节复用标识会冲突。CSV preview does not write records; atomic import and idempotent retries prevent partial batches.

## evidence | 附件与来源 / Evidence files

附件以服务器生成的 storage key 保存在受控目录，数据库记录 MIME、大小、SHA-256、上传者和实际接收时间。后来上传的匹配 CSV 只能证明现在收到与回执相同的字节，不能证明当时已经保存原文件。Attachments do not certify observation truth or historical custody.

## safety | 安全边界 / Safety

本资料不提供微生物培养操作、病原体处理、临床诊断、药敏判断或工业放大结论。不要依据软件解释实施这些操作；相关问题应交由负责实验室的合资格人员处理。This guide excludes microbial culture procedures, clinical decisions, antimicrobial susceptibility interpretation and industrial process recommendations.

## limitations | 小样本与结论边界 / Limitations

当前分析是探索性的，四个浓度、小样本和未经证明的记录独立性限制推断。不能据此宣称已确认最优条件、显著改善、因果关系、临床效果或适用工业生产。模型候选需要新的独立实验验证。引用项目说明不等于外部文献支持；检索命中不证明问题的前提成立。Small samples do not establish significance, causality, confirmed optimality or efficacy.

## retrieval | 资料检索 / Retrieval

资料检索只返回这个版本化项目指南的原文片段，采用 SQLite FTS5 与 BM25；英文词与中文双字片段用于匹配。它不会搜索互联网、阅读上传附件、回答具体报告数值或调用外部模型。找不到足够的词面证据时返回信息不足。BM25 ranks lexical relevance, not factual truth or answer confidence.
