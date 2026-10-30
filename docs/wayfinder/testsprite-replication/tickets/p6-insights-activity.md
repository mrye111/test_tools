---
title: P6 Insights 与 Activity Log
type: task
status: done
assignee: ""
blocked_by: [p4-runs-and-map]
---

## Question

- Insights（`/automation/p/:id/insights`）：通过率趋势、引擎分布、耗时分布、失败热点排行
- Activity Log：项目活动审计表（谁/何时/触发了什么——运行、编辑、生成）

## Resolution

### 交付

- **洞察聚合**：纯函数 [insights.ts](../../../ai-test-tools-site/server/src/features/automation/insights.ts) `buildInsights(rows)`（趋势 14 天 / 引擎 / 耗时 5 桶 / 失败热点 Top8 / 汇总），双仓储同构取数（MySQL `at_runs JOIN at_cases` 轻量投影 `RunInsightRow`，内存仓储过滤等价）
- **活动审计**：`at_activity` 表（建表随 schema 自动生效）+ `addActivity/listActivities`；`logActivity` 埋点 7 处（执行、创建/编辑/删除用例、规划生成、采纳提案、批次触发）；动作三分类 run/edit/generate
- **端点**：`GET /api/automation/projects/:id/insights`、`GET /api/automation/projects/:id/activity?limit=`
- **前端**：[InsightsView.tsx](../../../ai-test-tools-site/src/features/automation/InsightsView.tsx)（status 堆叠趋势柱 + 引擎/热点横条 + 耗时柱 + 悬停提示 + details 数据表）、[ActivityLogView.tsx](../../../ai-test-tools-site/src/features/automation/ActivityLogView.tsx)（时间/谁/动作/详情 + 徽章 + 刷新）；工作台新增「活动」页签，洞察占位替换为实装

### 验证

- `server:build` + 两端 `tsc --noEmit` 干净；`npm test` 822/826——4 失败均为已知既有 flake（docling 1 + loadtest k6 并行 3），隔离复跑 23/23 过（含新增 insights 5）
- 预览走查（真实数据）：洞察 4 组件渲染 10→11 次运行、通过率 70%→72.7% 随新运行实时刷新；趋势悬停提示列全系列（10-30：通过 7/失败 3/通过率 70%）；活动表 5 行三类动作齐（生成 1/运行 1/编辑 3）带操作者 preview-check 与时间
- 响应式 375px 无横向溢出

### 走查发现并修复的缺陷

1. 移动端 7px 横向溢出：工作台 8 页签 nowrap 挤爆 → `.at-tabs` 换行
2. 数据表展开撑破网格（grid min-width 爆裂）→ `minmax(0,1fr)` + 卡片 `min-width:0` + 数据表卡内滚动
3. 窄屏去撞规则误藏有数据的 10-30 标签与耗时图全部标签 → 收窄到趋势图（`at-viz-dense`）且保首末
4. 「谁」列 preview-check 折行 → nowrap

### 设计决策

- 耗时桶左闭右开（边界值归上桶）；趋势窗口外的运行计入总量不进趋势
- 跨项目批次每涉及项目各记一条审计；Test List/Schedule 本体 CRUD 不入项目审计（无诚实 projectId），其触发经 `startCaseBatch` 落审计
- 调色板弃品牌绿黄红（相邻对 CVD ΔE 5.2 < 6 不达标），用 dataviz 校验过的 status 三色 `#0ca30c`/`#fab219`/`#d03b3b` + 灰 `#8c939f` + 单系列 `#2366e9`（相邻对 ΔE ≥ 11.3）；`#fab219` 对比度 WARN 由标签 + 数据表救济；站点仅浅色，跳过暗色
- 图表手写 HTML/CSS（与报表特性一致，不引图表库）

### 清理与失误记录

- 走查造的演示用例 ATC-004 与 17 条生成提案已删；ATC-001 新增 1 次真实运行（通过）保留为数据；审计行保留（即本特性数据）
- **失误**：删除提案时清单误收全量 21 个 id，连 P3 走查遗留的 ATP-001..004 一并删除——均为此前会话我自己生成的走查产物，非用户数据，但超出原定清理范围