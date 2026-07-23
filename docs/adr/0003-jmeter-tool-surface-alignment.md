# 0003 — JMeter 工具面对齐：注册模板所需工具，删除零调用方法，冒烟检查迁移至 vitest

## 状态

已接受

## 背景

架构评审（2026-07-17）发现 JMeter 工具面三处失真：

- 前端 8 个性能测试模板中有 5 个（JDBC/TCP/SMTP/FTP/System）调用**未注册**的工具（`add_jdbc_request`、`add_tcp_sampler`、`add_smtp_sampler`、`add_ftp_sampler`、`add_system_sampler`），这些模板在运行时必然失败；对应的 `TestPlanService` 方法存在但从未接线。
- 另有 10 个 public 方法（约 370 行）在全仓库零调用，唯一引用它们的 `server:smoke` 脚本调用的工具名同样未注册，第 8 个调用即失败——唯一的端到端检查静默坏掉。
- 文档声称"57 个工具对齐 Java jmeter-mcp"，实际注册 43 个，说法失真。

## 决策

1. **注册前端模板真实调用的 5 个采样器工具**（注册表 43 → 48），arg 名以前端实际发送为准（含 `dataSource`、`reUseConnection` 两个 camelCase 历史名，同时接受 snake_case 别名）。
2. **删除 10 个零调用方法**及其孤儿私有助手。deletion test：复杂度直接消失，无任何 adapter。
3. **工具面的唯一事实来源是 `tool-registry.ts`**。新增工具必须注册并被 `server/tests/jmeter-tools.test.ts` 覆盖；`server:smoke` 脚本删除，由该 vitest 套件替代。
4. **不以 Java jmeter-mcp 的 57 工具为对齐目标**。进程内 TypeScript 实现是规范后端；Java 服务缺失的工具（如 JMS）在有真实调用方之前不补。未来的架构评审不应再提议"恢复 57 工具对齐"。
5. 配套：`TestPlanService` 全部方法返回 `ToolResult`（`server/src/tool-result.ts`），错误格式化下沉到 MCP/HTTP seam 的 adapter——这是 ADR-0002 错误统一决策的落地完成。

## 影响

- 5 个模板从"运行时必坏"变为可用；集成测试复刻全部 8 个模板的步骤序列防止回归。
- `jmeterBackend.ts` 从 1871 行降至 1453 行，并获得首批真实测试（64 个）。
- `addListener`/`addExtendedListener`、`*AtPath` 家族与各自工厂统一构造逻辑，placement 成为唯一差异。
- 前端模板模式随后迁移为一次 `POST /api/jmeter/build`（PlanBuilder），不再由浏览器编排 9 次工具往返；每次构建使用独立的 `TestPlanService` 实例，消除全局单例的并发交织缺陷。
