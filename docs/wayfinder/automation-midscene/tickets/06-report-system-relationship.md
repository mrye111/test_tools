---
title: 运行报告与现有报告体系的关系
type: grilling
status: closed
assignee: main-session
blocked_by: []
---

## Question

自动化运行的记录与报告在产品形态上如何安放，需要用户定夺：

- **A. 菜单内自含（MVP 推荐）**：运行历史与报告查看都在「自动化测试」菜单内，自成闭环；现有 TestReportPage 不动。
- **B. 自含 + 汇总**：菜单内自含，同时 TestReportPage 增加「自动化」页签/类型，与 JMeter 报告并列（报告体系统一，但要做报告类型抽象）。
- **C. 完全并入现有报告体系**：自动化运行就是 TestReport 的一种，菜单内只做执行不做报告。

附带问题：Midscene 原生 HTML 报告是 iframe 嵌入（信息最全：逐步截图+思考+坐标框）还是抽取数据用现有报告组件重绘（风格统一但丢信息）？默认建议嵌入。

用 /grilling 推进，结论写入 Resolution。

## Resolution

2026-09-21 与用户定稿：

- **菜单内自含（MVP）**：运行历史与报告查看都在「自动化测试」菜单内自成闭环，现有 TestReportPage 不动；后续如需统一汇总（与 JMeter 报告并列页签），另行立项
- **报告呈现**：Midscene 原生 HTML 报告用 iframe 嵌入（信息最全：逐步截图 + 模型思考 + 点击落点坐标）；不重绘
