# PRD：在线压测工具（NexusKit /loadtest）

> 版本 V0.1 · 2026-10-15 · 需求共识来自 grilling 会话（10 项已锁定决策）
> 词汇以 [CONTEXT.md](../CONTEXT.md)「在线压测」词条为唯一正本

## 1. 背景与目标

现有 k6 压测框架（D:\code\压力测试）已在问卷系统上跑通完整链路（k6 + Prometheus + 报告），但操作全靠命令行和手工改配置。本工具把它产品化为 NexusKit 的网页工具：图形化配置、在线运行、实时监控、网页报告，且**不绑定特定被测项目**。

目标用户：内网测试工程师（可信环境，无登录体系）。

## 2. 范围

**包含**：压测项目管理、场景可视化编排（k6 全部 6 种执行器）、全参数面板、脚本编辑、原生 k6 在线执行、实时曲线、网页报告与 HTML 导出、AI 生成脚本与解读报告、MCP 工具注册、监控目标向导接入、既有资产一次性导入。

**不包含**：多用户/权限体系、公网部署、JMeter 引擎（已有工具覆盖）、分布式多压测机（后续候选）。

## 3. 页面结构

`/loadtest` 项目列表 → 项目工作区三页签：

| 页签 | 内容 |
|---|---|
| 配置 | 场景构建器（执行器编排）+ 参数面板（常用/高级）+ 脚本编辑器（CodeMirror），表单 ↔ 源码双向同步；AI 生成脚本草稿入口 |
| 运行 | 发起执行（确认弹窗：目标 + 峰值并发）→ 实时曲线（VU/响应时间/错误率/资源）+ 日志流 + 停止按钮；SSE 断线自动恢复 |
| 历史 | 执行记录列表（状态/判定/耗时）→ 报告视图（指标、曲线回放、错误样本、阈值判定、导出 HTML、AI 解读） |

首页加工具卡片；设置页加「监控接入」分区（教程 + 参数 + 三段验证）。

## 4. 功能需求

- FR1 项目 CRUD：名称、目标地址、k6 脚本、场景配置、阈值、监控目标；从目录导入（首个来源：D:\code\压力测试\projects\survey）。
- FR2 场景构建器：6 种执行器全支持；每场景 startTime/gracefulStop/exec/env/tags；executor 专属参数按类型切换表单。
- FR3 参数面板：覆盖 k6 options 全量（执行控制/HTTP/DNS/TLS/阈值/标签/输出），常用组默认展开，高级组折叠；阈值提供预设模板（P95/错误率/成功率）。
- FR4 脚本编辑：CodeMirror，与表单双向同步；同步冲突时以最后一次编辑为准并高亮提示。
- FR5 执行引擎：RunManager 串行队列；spawn 原生 k6（tools/ 内置二进制，版本可配）；SIGTERM 优雅停止；SSE 推送日志与进度；断线重连恢复。
- FR6 监控接入：Prometheus 地址 + node_exporter 目标配置教程；三段验证（`/-/ready` → remote-write 写入/查回 → target 健康）；验证通过才启用监控联动；未接入时报告显式标注缺失。
- FR7 实时曲线：优先 Prometheus range 查询；未接入监控时降级为解析 k6 stdout 摘要行。
- FR8 报告：网页报告（指标汇总/曲线/错误样本/阈值判定）+ 导出单文件 HTML；数据缺失显式标注，禁止以 0 冒充。
- FR9 AI 能力：AI 生成脚本草稿（自然语言 → 脚本，进编辑器可再改）；报告页 AI 解读（指标 + 错误样本 → 结论与排查建议）。均按钮触发，复用浏览器本地模型配置。
- FR10 MCP 注册：`loadtest_list_projects` / `loadtest_get_project` / `loadtest_run` / `loadtest_run_status` / `loadtest_stop` / `loadtest_report`，供编码代理调用。
- FR11 安全护栏：运行前确认弹窗；高级组开放 blockHostnames/blacklistIPs；目标地址必填校验。

## 5. 数据模型草案（MySQL/内存双模）

```
loadtest_project  id, name, description, target_base_url, script_source(TEXT),
                  config_json(scenarios/options/thresholds/env), monitor_targets_json,
                  created_at, updated_at
loadtest_run      id, project_id, test_type, status(queued/running/succeeded/failed/stopped),
                  config_snapshot_json, started_at, ended_at, k6_exit_code,
                  summary_json, report_html_path, ai_analysis(TEXT), trace_id
```

执行的配置按快照存储（config_snapshot_json），项目后续改动不影响历史执行的还原。

## 6. API 草案

```
POST   /api/loadtest/projects                      创建（含目录导入 importFromDir）
GET    /api/loadtest/projects                      列表
GET/PUT/DELETE /api/loadtest/projects/:id          读取/更新/删除
POST   /api/loadtest/runs                          发起执行 {projectId} → runId
GET    /api/loadtest/runs/:id/events               SSE：日志/进度/完成
POST   /api/loadtest/runs/:id/stop                 停止
GET    /api/loadtest/runs?projectId=               执行历史
GET    /api/loadtest/runs/:id/report               报告数据（+ ?format=html 导出）
POST   /api/loadtest/runs/:id/ai-interpret         AI 解读
GET/PUT /api/loadtest/monitor/config               监控配置
POST   /api/loadtest/monitor/verify                三段验证
POST   /api/loadtest/ai-draft                      AI 生成脚本草稿
```

## 7. 分期计划

| 期 | 内容 | 验收 |
|---|---|---|
| M1 骨架 | 项目 CRUD、脚本编辑器、原生 k6 运行、SSE 日志、停止、k6 摘要结果、串行队列 | 导入 survey 项目并成功跑通一轮阶梯压测 |
| M2 监控与报告 | 监控向导+三段验证、实时曲线、网页报告+HTML 导出、历史记录 | 报告与现有框架 build-report 同口径抽查一致 |
| M3 增值 | AI 生成/解读、MCP 注册、阈值模板库、参数面板全量分组 | MCP 代理可独立完成「运行→读报告」闭环 |

## 8. 风险与对策

- **k6 版本漂移**：tools/ 内置固定版本二进制，版本号纳入项目配置；升级走显式替换。
- **表单↔源码双向同步冲突**：以最后编辑为准 + 冲突提示，不做双向 diff 合并。
- **报告口径分裂**：阈值判定逻辑单一来源（后端判定模块），网页与导出 HTML 共用；禁止前端另算。
- **压测机自成为瓶颈**（2000+ VU 时实测发生）：执行页显示压测机自身资源曲线，超标时结果页标注「压测机可能成为干扰项」。
