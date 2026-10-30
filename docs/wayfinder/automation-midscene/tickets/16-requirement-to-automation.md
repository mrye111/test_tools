---
title: AI 从需求文档生成自动化用例（两段式贯通）
type: task
status: closed
assignee: main-session
blocked_by: []
---

## Question

雾区首条：「AI 从需求文档**直接**生成自动化用例（**与现有 testcase 生成链路打通**）」。现状是三段链路、两处人工接力，每段能力都已完整验证，但串起来要人在中间点三次：

| 段 | 现有能力 | 卡点 |
|---|---|---|
| 需求 → 测试条件 | `requirement-v2`：条件（normal/boundary/exception）+ relay 状态机 + RTM 覆盖率 | — |
| 条件 → 功能用例 | `runGenerationJob` + `linkConditionsToTestset` 回写 RTM | **手动接力①**：localStorage 载荷跳 `/testcase` 再在弹窗点生成 |
| 功能用例 → 自动化用例 | `compileFunctionalCase` + 8 条硬规则 + `validateCompiledPlan` 确定性校验 + 文本 hash 缓存 | **手动接力②**：`?from=functional` 逐条选、逐条编译、再手存 |

**三个岔路口（2026-09-22 用户拍板）**：

1. **生成链路 = 两段式·留功能用例**（❌ 直达式一步生成）。中间产物保留功能用例集资产（可导出 Excel/XMind、可人工审改），复用已验证的确定性编译校验；需求侧 RTM 追溯零改动。代价：每条两次 LLM。
2. **入口 = 需求分析页·测试条件**（❌ 自动化菜单贴文本/选集）。详情页勾选条件 →「生成自动化用例」，输入源是已分析的测试条件。
3. **落库 = 直接落库 + 结果汇总**（❌ 先预览再落库）。对齐票据 11「失败继续」。

**否决直达式的理由**（写下来免得日后重提）：直达要新写生成 prompt + 确定性校验层 + 给 `requirement-v2` 双仓储加「条件↔自动化用例」追溯字段；而 `validateCompiledPlan` 那套确定性校验正是本链路可靠性的来源（票据 10 实测 34/34 零降级），直达等于把它推倒重来。

## Resolution

**只做编排与追溯，不新建生成能力。** 2026-09-22 实现完成，一个按钮跑通全流程并给可自动化率汇总。

**新增**：

| 文件 | 职责 |
|---|---|
| `server/src/features/testcase/functional-case-rows.ts` | 用例集 header+rows → 五字段可编译用例（列名子串匹配、列序无关、缺字段行过滤）。从 `batch-compile.mjs` 抽出，脚本改为 import dist 同一份 |
| `server/src/features/requirement-v2/handoff-text.ts` | 接力文本渲染（需求原文摘要 2000 字 + 逐条测试条件） |
| `server/src/features/automation/import-manager.ts` | 四段编排 `generate → link → compile → done`，内存任务表 + 事件回放 + 30min TTL，全局并发闸 |
| `src/features/automation/RequirementImportDialog.tsx` | 项目/用例集/入口地址/设计规范表单 + SSE 进度 + 结果汇总 |
| `server/src/features/automation/import-manager.test.ts`（7 项）、`server/src/features/testcase/functional-case-rows.test.ts`（6 项） | 四段顺序、回写时序、失败继续、降级计数、进度单调、并发闸、列名别名/过滤 |

**接线**：`POST /api/automation/import-from-requirement`（校验 recordId/projectId/conditionIds 非空 + entryUrl 仅 http(s)）、`GET /api/automation/import-jobs/:id`（断线可查最终汇总）、`GET …/events`（SSE，事件名 `import-event`，`done`/`error` 发 `end` 让前端 close）。`bootstrapAutomation(analysisRepo)` 注入跨域仓储，`express-app.ts` 顺序装配（`sharedTestCaseStore` 跨域单例已有先例）。

**时序决策**：`markConditionsGenerated` 放在 **compile 之前**——生成功能用例集即算 RTM 覆盖（与既有 `onCompleted` 语义一致），自动化用例落库结果只在汇总里单列，不混入覆盖率。因此需求侧 RTM 模型与双仓储**零改动**；条件↔自动化用例用 `condition.testsetId` + `automationCase.sourceFunctionalCaseId` 间接关联，未加直连字段。

**复用而非新建**：`runGenerationJob`（`testcase/generation.ts:349`，进程内调用不绕 HTTP）、`compileFunctionalCase`（`automation/compiler.ts:115`，带缓存 + 失败重试一次 + 降级直映）、`repo.createCase`（已有 `sourceFunctionalCaseId`/`compileHash` 溯源字段）、`beginSse/emit/endSse`、`ModalShell`（沿用 TestCasePage 的 `stopPropagation` 修法）。

**验证**：`npm run server:build` + `npx tsc --noEmit` 干净；`npm test` 68 文件 558 用例全绿（含新增 13 项）。

**已知局限（本次未动，非遗漏）**：

1. **英文用例集编译不出用例** —— 列名候选是中文且 `h.includes(候选)` 区分大小写，`Case ID`/`Case Title` 命不中 `caseId`/`标题`。`KNOWN_HEADERS` 里的 `EN_FUNCTIONAL_HEADER` 走 `?from=functional` 与本次导入都会得到 0 条。已在 `functional-case-rows.test.ts` 钉住该行为作tripwire；要修就往 `HEADER_CANDIDATES` 加英文候选。
2. **接力文本渲染有两份** —— 前端 `handoff.ts` 与服务端 `handoff-text.ts` 同形状（前端无法 import server 代码，项目已有前后端类型各写一份的先例）。后续可上提到 shared。
3. **不做取消**：生成 job 中途取消复杂且未被要求；**不做导入后自动执行冒烟**。
