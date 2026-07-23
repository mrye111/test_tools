# 0002 — 结构化全链路追踪日志系统

## 状态

已接受

## 背景

后端当前仅有零散的 `console.error` / `console.warn`（共 3 处），无请求日志、无结构化日志、无链路追踪。错误处理模式割裂：`jmeterBackend.ts` 返回 `"Error: ..."` 字符串，testcase 模块返回 `{ success: false, error }` JSON，`ai-generator.ts` 抛异常。排查线上问题时无法还原请求链路。

## 决策

### 1. 上下文传递：AsyncLocalStorage

选择 Node.js 原生 `AsyncLocalStorage` 而非手动传参或 OpenTelemetry SDK。

**理由：**
- 零外部依赖，Node.js v16+ 原生支持
- 对业务代码透明，Express middleware 包一层即可自动传播 traceId
- 天然穿透 `async/await` 和 async generator（AI 流式调用）
- OpenTelemetry 对当前项目体量偏重；手动传参侵入性过高

**代价：**
- unhandled rejection 等边界情况下可能丢失上下文（可接受，非关键路径）

### 2. 输出策略：开发 console + 生产文件 JSON

- 开发环境：console 彩色美化输出，便于实时调试
- 生产环境：结构化 JSON 写入 `server/logs/` 目录，按天轮转，保留 7 天，单文件 50MB 上限

**理由：** 项目为本地/小规模部署，不需要外部日志服务；混合模式兼顾开发体验和生产可采集性。

### 3. 查询方式：文件 + API

文件为主存储，额外提供 `/api/logs` 接口支持按 traceId/时间/级别查询结构化链路。

**理由：** 纯文件 grep 效率低，API 查询让前端或 curl 即可排查，不需要 SSH 到服务器。

### 4. 统一错误处理：AppError + 全局 middleware

定义 `AppError` 类（code、message、httpStatus、cause），Express 末尾加全局 error-handling middleware 统一捕获并格式化，错误自动关联到 trace span。

**理由：** 统一错误出口是 trace 日志有效性的前提，否则错误信息格式不一致、散落多处。

### 5. Span 粒度

```
HTTP 请求 (根 span)
  ├─ JMeter 内存操作 (子 span)
  ├─ AI 模型调用 (子 span，含 model/tokens/耗时)
  ├─ Store 写入 (子 span)
  └─ Export 生成 (子 span)
```

- SSE 连接：HTTP 请求一个 span + 内部 AI 调用独立子 span
- 异步 Job：创建请求的 traceId 传递到 job 内部所有操作
- JMeter 微秒级操作也记录（用于调试参数传递）

### 6. 保留策略

- 路径：`server/logs/`（gitignore）
- 轮转：按天
- 保留：7 天
- 单文件上限：50MB
- 最大文件数：10 个

## 备选方案

| 方案 | 否决理由 |
|------|---------|
| 手动传参 traceCtx | 侵入性极强，所有函数签名需改 |
| OpenTelemetry SDK | 依赖链重，当前项目体量不需要 |
| 纯 stdout JSON | 开发时不友好 |
| 数据库存储日志 | 引入重依赖，当前项目过大 |
| 纯文件 grep 查询 | 排查效率低 |

## 影响

- 新增文件：`server/src/logger.ts`（核心）、`server/src/app-error.ts`、`server/src/middleware/trace.ts`
- 修改文件：`index.ts`（加 middleware）、各路由/服务文件（加 span 埋点）
- 新增接口：`GET /api/logs`
- 依赖：`pino` + `pino-pretty`（日志库）+ 日志轮转由 pino 配置或 `file-stream-rotator` 处理
