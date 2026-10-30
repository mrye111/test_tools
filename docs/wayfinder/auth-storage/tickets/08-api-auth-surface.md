---
title: API 鉴权面与免登例外
type: grilling
status: closed
assignee: claude
blocked_by: [04]
---

## Question

鉴权面定稿（HITL，用 /grilling 逐题拍板）：

1. **免登录路由白名单**：health 探针、静态资源、MCP 端点、webhook 类入口——逐项裁定免登还是入鉴权
2. **会话中间件的覆盖面与漏网清单**：全站默认拦截 + 白名单例外，还是按路由挂载（给出契约）
3. **管理员授权标记**：关注册等管理路由的 403 契约
4. **401 / 403 / 会话过期**的响应契约（前后端约定）
5. **前端路由守卫行为**：未登录跳转目标、回跳参数

前提（建图已拍板）：强制登录门禁，免登为显式例外。

## Resolution

经用户确认的定稿全集（路由清单经 express-app.ts + 各 feature routes.ts 全量核实）：

1. **免登白名单（仅三项）**：`GET /health` 探针、前端静态资源、MCP 机器端点（`/sse`、`/messages`、`/rpc`）。MCP 免的是会话不是门禁：改走 **`MCP_TOKEN` 静态 token**（请求头携带、环境变量配置），校验不过 401——裸奔免登等于内网任何人可驱动 AI 任务烧 token。
2. **其余全登**：`/api/*` 全部业务路由（含 `/api/test-connection`，配合票 05 服务端代发密钥）、`/tools`、`/ai/*`、`/api/jmeter/build`、`/files`、日志路由——无其他豁免。
3. **覆盖模型 default-deny**：会话中间件置于全部路由之前、白名单显式跳过；新增路由自动入保（fail-safe，忘配不裸奔）。
4. **响应契约**：
   - `401 UNAUTHORIZED`——未登录与会话过期同码不区分；前端全局拦截 → `/login?redirect=原地址`（沿用票 04 定稿的回跳）
   - `403 FORBIDDEN`——已登录越权（如非管理员调管理路由）；管理路由挂载时打 admin 标记
   - `403 CSRF_INVALID`——同步器令牌校验失败
