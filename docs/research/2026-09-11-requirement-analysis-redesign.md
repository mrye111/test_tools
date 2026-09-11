# 调研：软件测试中的需求分析应该如何进行、应产出什么

日期：2026-09-11
背景：需求分析模块整体下线（提交 0738350），本调研用于指导重建方向。

## 1. 业界共识：测试视角的需求分析是什么

需求分析是 **STLC（软件测试生命周期）的第一阶段**，也是 ISTQB 测试分析师（CTAL-TA）的核心职责域。它的本质不是"读懂需求"，而是：

> 把干系人诉求转化为**清晰的、可测试的、可追溯的**测试依据（test basis），并在写任何测试用例之前，先把需求本身的问题暴露出来。

两个关键认知：

1. **需求分析是测试活动，不是开发活动**。测试工程师分析需求的目标是回答一个问题：*「我将如何测试这个？」*（How Will I Test This?）——每个需求条目都要过这一关，过不去的就打回澄清，而不是硬着头皮写不可执行的用例。
2. **需求缺陷在此阶段修复成本最低**。歧义、缺失、冲突在评审阶段暴露，比在测试执行甚至生产阶段暴露便宜几个数量级。

## 2. 核心活动（怎么做）

1. **收集测试依据**：SRS/BRD/用户故事/验收标准/技术设计文档，旧版本文档（如适用）
2. **可测试性评审**（本阶段的核心技术动作）：
   - 完整性：是否只写了正常路径，缺错误处理与异常分支
   - 歧义性：语义/词法/范围歧义（"快速响应""易于操作"）
   - 可度量性：是否有客观判定标准（"3 秒内"可测，"流畅"不可测）
   - 原子性：一条需求只说一件事
   - 一致性/冲突：条目间是否矛盾
   - 未说明的假设与隐性依赖
3. **优先级与风险分级**：MoSCoW（Must/Should/Could/Won't）+ 基于风险的测试（RBT）——按"失效概率 × 影响面"给需求分级，高风险项获得更多测试深度
4. **识别测试条件**（test conditions）：从每条需求导出"需要被验证什么"，这是测试用例设计的直接输入
5. **建立可追溯性**：需求 ↔ 测试条件 ↔ 用例的双向映射（RTM）

## 3. 应产出的内容（deliverables）

| 产出物 | 内容 | 对下游的价值 |
| --- | --- | --- |
| **需求问题日志** | 歧义/缺失/冲突/不可测试项，每条带责任人与状态 | 直接驱动需求澄清会议 |
| **验收准则（可测化）** | 每条需求的可观察、可度量判定标准 | 用例预期结果的来源 |
| **测试条件清单** | 每条需求导出的待验证点（含边界与异常） | 用例设计的直接输入 |
| **风险分级** | 高/中/低风险需求项及依据 | 测试深度与执行顺序的依据 |
| **需求可追溯矩阵（RTM）** | 需求 → 测试条件 → 用例的映射 | 覆盖率证明、变更影响分析 |
| **测试范围说明** | 测什么/不测什么、质量目标 | 测试计划的输入 |

## 4. 对旧模块的复盘（偏差分析）

旧模块产出的是「需求分解树（脑图）+ 风险/歧义/待澄清结论 + 画板图元」。对照业界标准：

- ✅ 做对的部分：风险点/歧义点/待澄清问题三类发现 ≈ 需求问题日志的雏形
- ❌ 主要偏差：
  - **产出停在"看"的层面**（脑图可视化、导出 XMind），没有产出可测试化的验收准则和测试条件清单——后两者才是用例生成的真正燃料
  - **没有可追溯性**：需求条目与后续用例之间没有映射关系，"覆盖率"无从谈起
  - **接力是原文传递**（把需求原文塞进用例弹窗），等于分析阶段的产出对用例生成零贡献
  - 画板三件套（因果图/判定表/正交表）属于**测试设计**阶段（在需求分析之后），把它塞进需求分析工具是阶段错位

## 5. 对重建的启示

如果重建需求分析工具，建议的产出形态（按价值排序）：

1. **需求问题日志**（AI 最擅长）：粘贴需求文本 → AI 输出结构化的歧义/缺失/冲突/不可测试项清单，每条带原文引用、问题类型、建议澄清问题——可导出、可跟踪状态（待澄清/已澄清）
2. **可测试化验收准则**：AI 把模糊需求改写成可度量形式（"响应快"→"P95 响应 < 2s"），用户确认后入库
3. **测试条件清单**：每条需求导出待验证点（正常/边界/异常），**这才是接力到用例生成工具的正确载荷**——替代旧的原文传递
4. **RTM 雏形**：需求条目 id ↔ 测试条件 ↔ 生成的用例 id，让"需求覆盖率"成为可计算的指标
5. （可选）风险分级：高/中/低 + 一句话依据，驱动用例优先级

输入侧保持旧模块的优点：文档上传 + 粘贴文本双通道。AI 只产出结构化草稿、用户确认/编辑后生效——与平台"草稿可编辑"理念一致。

## 来源

- [Requirements Analysis in Software Testing: Complete STLC Phase Guide — Master Software Testing](https://mastersoftwaretesting.com/testing-fundamentals/software-testing-life-cycle/requirements-analysis)
- [Test Basis: Understanding Specifications as Testing Foundation (ISTQB) — LeadWithSkills](https://www.leadwithskills.com/blogs/test-basis-understanding-specifications-testing-foundation-istqb)
- [Risk Based Testing Approach for Agile Teams — BrowserStack](https://www.browserstack.com/guide/risk-based-testing-in-agile)
- [What is Risk Based Testing: With Best Practices — LambdaTest](https://www.lambdatest.com/learning-hub/risk-based-testing)
- [Understanding the Pros and Cons of Risk-Based Testing — TestRail](https://www.testrail.com/blog/risk-based-testing/)
- [ISTQB 测试分析师（CTAL-TA）体系 — ISTQB 中国](https://www.istqb.org.cn/istqb/istqbshishenme/tixi/ctal/jishuceshifenxi/)
