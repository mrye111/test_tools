---
title: P4 运行详情升级与 Agent Action View
type: task
status: done
assignee: ""
blocked_by: [p3-plan-and-cases]
---

## Question

- 运行详情页（`/automation/p/:id/runs/:runId`）：通过率环 + AI 根因摘要（failed/blocked 步骤调 LLM）+ Copy Fix Prompt + 报告链接 + List/Map 双视图
- `at_runs` 增列：rootCause / environmentId / viewport / runGroupId
- Agent Action View：从 run 的 frames/stepResults 聚合站点图——节点=页面 URL（触点统计、失败热点标记）、边=转移；点击节点看该页回放帧

## Resolution

已完成（2026-10-30）。

**交付物**

- 运行详情页 `/automation/p/:projectId/runs/:runId`（`RunDetailView.tsx`）：通过率环（SVG 甜甜圈）、AI 根因卡片（摘要 + Fix Prompt 折叠 + 生成/重新生成 + Copy Fix Prompt）、回放报告链接、List（步骤表）/ Map（Agent Action View）双视图——有轨迹数据时默认进 Map。运行历史展开面板加「运行详情」入口。
- `at_runs` 增列 rootCause / environmentId / viewport / runGroupId（tolerant ALTER ×4），`RunRecord` 落库四字段；帧与页面轨迹体量大不入库，走 **run-data sidecar**（`artifacts/automation-run/run-data/<runId>.json`，`run-insight.ts` 读写，runId 白名单防穿越）。
- Agent Action View：`buildPageMap` 从 pageTrail + fastFrames 聚合——节点=页面 URL（触点数/失败热点/帧数），边=页面转移（带次数），BFS 分层 SVG 布局；点节点加载该页回放帧画廊（步骤/决策/动作 + 截图 + 耗时）。
- AI 根因：`generateRootCause`（失败步骤 + 所在页面 + 错误 → LLM JSON 根因摘要 + Fix Prompt，schema 不符时原文作摘要、模板兜底 Fix Prompt）。自动：运行失败且配置了 AI 时 `onDone` 触发落库 `root_cause`；手动：`POST /api/automation/runs/:id/root-cause`（409 非失败 / 400 无 AI 配置）。
- 新端点：`GET runs/:id/page-map`、`GET runs/:id/frames?node=`（截图转 data URI）、`POST runs/:id/root-cause`。帧采集（`fast-loop.ts` capture 带 url）+ 页面轨迹采样（`runner.ts` 导航与每步开始时取 `page.url()`）。

**验证**

- 门禁：server:build + 前后端 tsc --noEmit 全绿；npm test 800 passed（1 个既有失败 `testcase-reference-parse`，与本票无关）。
- 真实 Kimi 根因三条路径均实测：手动按需（老 run 0eda46b0，"环境问题（非产品缺陷）"）、失败后自动生成（fixPrompt 523 字）、Copy Fix Prompt 剪贴板可用。
- saucedemo 用例（07b46dd9）真实引擎 6/6 全过（run d9588192），详情页实测：环 100%、Map 双节点（www.saucedemo.com 触点 5·8 帧 → /inventory.html 触点 2·2 帧）+ 转移边、点节点出 8 帧画廊（含截图），截图留证。
- 会话级失败（导航失败致 stepResults 为空）也可生成根因——见下。

**走查中发现并修复的两个问题**

1. 根因生成入参缺会话级错误上下文：`page.goto` 失败时无失败步骤，原实现直接抛"无需生成根因"。已给 `RootCauseInput` 加 `error` 字段（"运行未能开始（导航/会话级失败）"入 prompt），routes 传 `record.error`。
2. 前端 localStorage 云配置指针悬空（指向已删配置）时报"未配置可用的 AI 模型"，无自愈提示。属体验问题，验证时手动修正指针至真实 Kimi 配置；后续可在配置页校验悬空指针（不阻塞本票）。

**备注**：Kimi 配额已恢复（真实引擎全链通过）；引擎模型配置现为真实 Kimi，验证用 stub 云配置已删除。
