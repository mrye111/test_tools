---
title: P3 规划与用例升级
type: task
status: done
assignee: main-session
blocked_by: [p2-explore-engine]
---

## Question

TestSprite 规划与用例环节：探源完成后 LLM 读捕获页 + PRD 产出 useCase 分组的测试提案 → 评审页分组勾选/编辑 → Generate & Run 落成用例并执行（首跑才写步骤）；用例页升级（分组/状态页签/批量勾选/Run All/Re-run Failed）+ 详情抽屉四页签。

## Scope（计划 P3 项 + 两处落地决策）

**落地决策（实现需要，偏离计划字段处已标注）**

1. 提案 schema 在计划字段（useCase/caseNo/title/goal/priority/estSteps/included）外补 `expected: string[]`（预估预期结果）——首跑编译的 CompileInput 需要 expectedResult，缺失则编译产物无断言。
2. **accept 时把 estSteps/expected 直映为 act/assert 占位步骤**（同 compiler.ts A 模式直映），用例落库即 executable 可跑（否则空步骤=manual，Run All/套件执行/批量全被跳过）；**首次执行**时钩子检测 `source==='plan-proposal' && !compileHash` → 走 compileFunctionalCase 用提案文本编译补全真实步骤并回写（对齐 TestSprite「首跑才写步骤」）；无 AI 配置时按占位步骤降级直跑。

**服务端**

- `at_plan_proposals` 表（mysql + memory 双仓储）：id/project_id/batch_id/source_id/use_case/case_no/title/goal/expected JSON/priority/est_steps JSON/included/status(proposed|accepted|rejected)/时间戳；编号 ATP-N 项目内 MAX+1。
- `plan-proposals.ts`：validateProposals 确定性校验（compiler.ts 同款风格：逐项清洗、丢弃非法项、上限封顶、priority 归一）。
- `plan-manager.ts`：生成编排（import-manager 模式：内存任务 + 事件缓冲回放 + SSE + TTL 30min）——输入捕获页摘要 + PRD + extraInstructions → 单次 LLM 调用 → 校验（整体失败带错误重试一次）→ 批量落库。
- 路由：POST plan/generate、GET plan/jobs/:id(+/events SSE)、GET/PUT/DELETE plan/proposals、POST plan/accept（勾选→按 useCase 建/找用例集→落用例→标记 accepted；run:true 则连跑）、POST runs/batch（按 caseIds 批跑，共 batchId，跳过 manual）。
- 首跑编译钩子 ensureCompiled：POST runs / sets/:id/run / runs/batch 三处共用。
- at_cases 增列 source_proposal_id（tolerant ALTER）；AutomationCaseSource += "plan-proposal"。

**前端**

- 规划评审页 PlanReviewView（工作台新分区「规划」）：源选择 + 生成提案（SSE 进度）→ 按 useCase 分组勾选/编辑（标题/目标/步骤/预期/优先级）→ 生成并执行。
- 用例页升级：状态页签（全部/未运行/通过/部分/失败）、按用例集分组、行勾选 + 批量执行/删除、Run All、重跑失败。
- 详情抽屉四页签：基础（步骤/人工项清单）、运行设置（入口/变量/引擎）、预览（最近运行步骤结果 + 报告链接）、代码（步骤 JSON）。
- SourcesView 步进条「规划（P3）」标注移除。

## Resolution

**已交付（2026-10-30）**，按 Scope 全项落地：

- 服务端：`at_plan_proposals` 双仓储、`plan-proposals.ts` 确定性校验、`plan-manager.ts` 生成编排（内存任务 + SSE + TTL）、plan 五组路由 + `POST runs/batch`、首跑编译钩子 `ensureCompiled`（runs / sets/:id/run / runs/batch 三处共用）、`at_cases.source_proposal_id` 列。
- 前端：规划评审页 PlanReviewView（分组勾选/行内编辑/SSE 进度/生成并执行）、用例页升级（状态页签/用例集分组/批量勾选与删除/Run All/重跑失败，Run 均带 aiConfig 以触发首跑编译）、详情抽屉四页签（基础/运行设置/预览/代码）、SourcesView 步进条标注改为指向「规划」页。
- 两处落地决策按 Scope 实现：提案补 `expected` 字段；accept 直映占位步骤 + 首跑编译补全。

**验证**：`server:build` + 两端 `tsc --noEmit` + `npm test` 全绿（800 通过；1 个既有失败 `testcase-reference-parse` 与本票无关）；预览面板全流程实测通过——提案生成（SSE 阶段推进、4 提案 2 用例组）→ 评审勾选/编辑联动 → 生成并执行（3 条用例 ATP 采纳、按 useCase 自动建用例集）→ 用例页页签/分组（失败后自动切计数）→ **首跑编译钩子实测**：批量执行触发 `ensureCompiled`，占位步骤被编译产物（4 act + 2 assert）替换后执行，运行结果回写页签（失败 3）、详情抽屉「预览」出步骤结果 + 回放报告链接、「代码」出编译后步骤 JSON。

**外部阻塞说明**：真实 LLM 生成当时被 Kimi 周额度（429 "7-day usage limit"）阻塞，端到端链路改用本地桩 LLM（OpenAI 兼容测试替身）验证等价通过；验证后已恢复真实模型配置（kimi-for-coding）并删除桩配置，金丝雀冒烟通过。额度恢复后真实生成即用，无需改码。
