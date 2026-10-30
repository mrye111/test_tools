# 地图：TestSprite 全功能复刻（自动化测试模块项目化）

`wayfinder:map` · local-markdown tracker · 创建于 2026-10-20

## Destination

把 TestSprite 的界面菜单与结构完整复刻进「自动化测试」模块（项目化形态），含三个新引擎能力（站点探索、AI 根因分析、Agent Action View）与差异化能力（Test Files / 跨项目用例集 / 定时）。

完整决策与映射见 [docs/wayfinder/testsprite-replication 的批准计划]：载体 = `/automation` 项目化（不动全站导航）；跳过 AI chat（票据 13 否决）、Slack/Linear/Jira、Billing/Members。

侦察依据（2026-10-20 实操）：建项目三步向导（类型+URL → 登录方式[凭据/OTP/SSO BETA/免登录] → PRD+Test Files+指令）→ 自动探索直播（登录→爬站→规划，直播画面+Live log）→ 规划评审（staged 提案，分组勾选，首跑才写步骤）→ 用例页（分组+状态页签+Form/YAML 编辑）→ 详情抽屉（Basics/Run Settings/Preview/Code/Run log/History）→ 运行详情（通过率+AI 根因+Fix Prompt+报告+Agent Action View 站点地图）→ 设置（General/环境/运行行为/测试文件/通知）。

## Notes

- 引擎底座不动：runner / fast-loop / fast-replay / compiler 全部复用
- 编排模式照抄 automation/import-manager.ts（内存任务 + SSE + TTL）
- PRD 上传复用 requirement-v2 分析记录，不另建文档库
- 演练项目已在 TestSprite 侧删除（侦察用，账号是叶旺林的，探源花了约 3 credits）

## Decisions so far

<!-- 每关闭一张票据追加一行 -->

## Tickets

- [P1 项目化外壳与建项目向导](tickets/p1-project-shell.md)
- [P2 探源引擎与 Sources 页](tickets/p2-explore-engine.md)
- [P3 规划评审与用例体系升级](tickets/p3-plan-and-cases.md)
- [P4 运行详情升级与 Agent Action View](tickets/p4-runs-and-map.md)
- [P5 Test Files / 跨项目用例集 / 定时](tickets/p5-lists-schedules-files.md)
- [P6 Insights 与 Activity Log](tickets/p6-insights-activity.md)

## Out of scope

- TestSprite CLI / GitHub Action / 隧道 / MCP（云客户端形态）
- AI chat 面板（票据 13 否决）
- Slack / Linear / Jira 通知工单（用户明确跳过）
- Billing / Members / Integrations / API Keys 工作区页
