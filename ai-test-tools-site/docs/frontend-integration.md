# JMeter 后端前端接入文档

本文档面向 `ai-test-tools-site` 前端接入当前 TypeScript 后端服务。当前阶段先不约束页面形态，只定义前端和后端之间的接口契约、调用顺序和注意事项。

## 1. 服务概览

后端服务位于 `server/`，由 `Node.js + Express + TypeScript` 实现，负责维护一个内存态 JMeter 测试计划，并通过工具调用生成、修改、保存 `.jmx` 文件。

默认端口：`3000`

启动命令：

```powershell
npm run server:build
node server/dist/src/index.js http 3000
```

也可以使用脚本默认启动：

```powershell
npm run server:start
```

健康检查：

```http
GET http://localhost:3000/health
```

响应示例：

```json
{
  "ok": true,
  "server": "jmeter-mcp-server",
  "version": "1.0.0",
  "tools": 48
}
```

## 2. 推荐接入方式

整计划构建（模板生成、一次出 JMX）优先使用一次构建接口：

```http
POST /api/jmeter/build
```

单步编辑、树操作等细粒度场景使用直接 HTTP 工具接口：

```http
GET /tools
POST /tools/:name
```

原因：

- `/api/jmeter/build` 一次请求完成 create → add_* → validate → save → tree 全链路，返回结构简单，适合 React 页面直接调用；每次构建在服务端独立的 `TestPlanService` 实例上执行，并发构建互不影响。
- `/tools/:name` 和 MCP 工具名、参数保持一致，适合逐步编辑与调试，后续切换 MCP 客户端成本低。
- 两者都不需要维护 SSE 会话。

可选接入方式：

- `POST /rpc`：使用 MCP JSON-RPC 格式，适合需要完整 MCP 协议兼容的前端或调试工具。
- `GET /sse` + `POST /messages?sessionId=...`：使用 MCP SSE 传输，适合接入标准 MCP 客户端。

## 3. 接口清单

### 3.1 获取工具列表

```http
GET /tools
```

响应是工具数组：

```json
[
  {
    "name": "create_test_plan",
    "description": "Create a new JMeter test plan.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Test plan name"
        }
      },
      "required": ["name"]
    }
  }
]
```

前端建议不要硬编码全部参数表，而是：

- 页面初始化时调用 `/tools` 获取工具元信息。
- 根据 `inputSchema.properties` 动态渲染高级参数表。
- 对常用功能使用固定表单，对低频工具保留 JSON 参数输入。

### 3.2 调用单个工具

```http
POST /tools/:name
Content-Type: application/json
```

请求示例：

```http
POST /tools/create_test_plan
Content-Type: application/json

{
  "name": "登录接口压测计划",
  "comments": "由前端页面创建"
}
```

响应示例：

```json
{
  "ok": true,
  "message": "Test plan created: 登录接口压测计划"
}
```

带结构化数据的成功响应（目前为 `save_test_plan` / `load_test_plan`）：

```json
{
  "ok": true,
  "message": "Test plan saved: server/generated/demo.jmx",
  "data": { "path": "server/generated/demo.jmx" }
}
```

错误响应（HTTP 4xx/5xx，状态码由错误码映射）：

```json
{
  "ok": false,
  "error": { "code": "not-found", "message": "Unknown tool: xxx" }
}
```

前端判断规则：

- HTTP 状态码非 `2xx` 或 `ok` 为 `false`：按业务错误处理并展示 `error.message`。
- `error.code` 是稳定错误码：`unknown-type` / `not-found` / `invalid-args` / `invalid-state` / `io-error` / `execution-error` / `internal`。
- `ok` 为 `true`：按成功结果展示 `message` 或进入下一步；保存路径等结构化结果从 `data` 读取，不要再用正则解析文本。

### 3.3 模板计划一次构建

```http
POST /api/jmeter/build
Content-Type: application/json
```

一次请求完成整个测试计划构建：按 `steps` 顺序执行工具调用，任一步骤失败即短路，然后由服务端统一执行 validate → save → tree。保存路径由服务端生成（`server/generated/` 下，文件名 = 净化后的 `seed` + 时间戳），前端不再拼接路径。

请求示例：

```json
{
  "planName": "登录接口压测计划 20260717-120000",
  "seed": "http-stress",
  "steps": [
    { "tool": "create_test_plan", "args": { "name": "登录接口压测计划 20260717-120000", "comments": "由前端模板生成" } },
    { "tool": "add_thread_group", "args": { "name": "主线程组", "num_threads": 10, "ramp_up": 5, "loops": 1 } },
    { "tool": "add_http_request", "args": { "name": "登录请求", "method": "POST", "protocol": "https", "domain": "example.com", "path": "/api/login" } },
    { "tool": "add_listener", "args": { "type": "aggregate_report" } }
  ]
}
```

字段说明：

- `planName`：测试计划显示名，必填；必须是纯名称，不能包含路径分隔符或 `..`。
- `seed`：下载文件名种子，必填；同样是纯名称（净化后加时间戳生成 `<seed>-yyyyMMdd-HHmmss.jmx`）。
- `steps`：非空数组，`tool` 为已注册工具名，`args` 可选；`save_test_plan`/`validate_test_plan`/`list_test_plan_tree` 不需要也不应该出现在 steps 里，服务端会自动追加。

成功响应（HTTP 200）：

```json
{
  "ok": true,
  "planName": "登录接口压测计划 20260717-120000",
  "path": "D:\\...\\server\\generated\\http-stress-20260717-120000.jmx",
  "filename": "http-stress-20260717-120000.jmx",
  "saveMessage": "Test plan saved: D:\\...\\server\\generated\\http-stress-20260717-120000.jmx",
  "validation": "Validation summary: errors=0, warnings=0\nNo structural issues found.",
  "tree": "/0 | TestPlan | ... | enabled=true\n...",
  "steps": [
    { "tool": "create_test_plan", "text": "Test plan created: ..." },
    { "tool": "validate_test_plan", "text": "..." },
    { "tool": "save_test_plan", "text": "..." },
    { "tool": "list_test_plan_tree", "text": "..." }
  ]
}
```

错误响应（HTTP 4xx/5xx，状态码由错误码映射，同 `/tools/:name`）：

```json
{
  "ok": false,
  "error": { "code": "not-found", "message": "Unknown tool: nope_tool", "step": "nope_tool" }
}
```

- `error.step` 指出失败步骤的工具名（构建步骤失败、未知工具、denylist 拦截时存在）。
- `seed`/`planName` 含路径穿越特征（`..`、`/`、`\`、盘符）直接 400。
- 下载文件用 `GET /files?path=<响应里的 path>`（见第 8 节）。

### 3.4 JSON-RPC 调用

```http
POST /rpc
Content-Type: application/json
```

列工具：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

调用工具：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "add_thread_group",
    "arguments": {
      "name": "主线程组",
      "num_threads": 10,
      "ramp_up": 5,
      "loops": 1
    }
  }
}
```

### 3.5 MCP SSE 调用

1. 前端创建 SSE 连接：

```ts
const events = new EventSource("http://localhost:3000/sse");
```

2. 监听 `endpoint` 事件，拿到消息投递地址：

```ts
events.addEventListener("endpoint", (event) => {
  const messageEndpoint = event.data;
  // 示例：/messages?sessionId=...
});
```

3. 向该 endpoint 发送 JSON-RPC 请求：

```ts
await fetch(`http://localhost:3000${messageEndpoint}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  })
});
```

4. 监听 `message` 事件获取 JSON-RPC 响应。

普通前端页面通常不需要走 SSE，除非要兼容 MCP 客户端协议。

### 3.6 AI 自然语言生成 JMX

AI 生成接口由前端用户自行配置模型，后端不读取 `ai.md`，也不持久化用户密钥。`ai.md` 只适合开发调试时作为本地测试数据源。

查看 AI 接入模式：

```http
GET /ai/config
```

响应示例：

```json
{
  "ok": true,
  "mode": "client_supplied",
  "serverStoresConfig": false,
  "required": [
    "ai_config.base_url",
    "ai_config.api_key",
    "ai_config.model"
  ]
}
```

生成 JMX：

```http
POST /ai/generate-jmeter
Content-Type: application/json
```

请求示例：

```json
{
  "prompt": "生成一个登录接口性能测试脚本：目标 https://example.com/api/login，POST JSON，10 个线程，10 秒启动，循环 1 次，断言响应码 200，并添加聚合报告和汇总报告。",
  "output_path": "ai-login-test.jmx",
  "ai_config": {
    "base_url": "https://your-openai-compatible-host/v1",
    "api_key": "用户在前端输入的密钥",
    "model": "your-model-id"
  }
}
```

字段说明：

- `prompt`：用户自然语言描述，必填。
- `output_path`：可选，生成文件名或 `server/generated/` 下路径；后端会限制只能写入 `server/generated/`。不传时使用计划名净化生成文件名（前端页面已不传，由服务端命名）。
- `ai_config.base_url`：OpenAI 兼容接口地址，通常以 `/v1` 结尾。
- `ai_config.api_key`：用户自己的模型密钥，只随本次请求发送。
- `ai_config.model`：模型 ID。
- `temperature`、`max_tokens`：可选，不传时默认 `0.2` 和 `6000`。

执行说明：AI 计划的工具执行、校验、保存、读树与模板构建共用同一个服务端 PlanBuilder，每次生成使用独立的 `TestPlanService` 实例（并发 AI 生成/模板构建互不影响），AI denylist 逐步强制校验；SSE 事件格式不变。

响应示例：

```json
{
  "ok": true,
  "model": "your-model-id",
  "summary": "生成登录接口性能测试计划",
  "planName": "登录接口性能测试",
  "outputPath": "D:\\code\\Test_Tools\\ai-test-tools-site\\server\\generated\\ai-login-test.jmx",
  "downloadUrl": "/files?path=...",
  "validation": "Validation summary: errors=0, warnings=0\nNo structural issues found.",
  "saveResult": "Test plan saved: ...",
  "toolCalls": []
}
```

前端安全建议：

- 不要把 `api_key` 写进仓库、构建产物或默认环境变量。
- 如果要记住用户配置，优先让用户明确选择“本机保存”，并说明会存到浏览器侧。
- 接口报错时不要把完整请求体打印到页面或日志里，避免泄露密钥。

## 4. 前端推荐业务流程

### 4.1 新建并生成基础 JMX

整计划一次构建（推荐，原 9 次 `/tools/:name` 往返已收口为一次请求）：

```ts
const result = await buildJmeterPlan({
  planName: "登录接口压测计划 20260717-120000",
  seed: "login-stress",
  steps: [
    { tool: "create_test_plan", args: { name: "登录接口压测计划 20260717-120000", comments: "前端生成" } },
    { tool: "add_thread_group", args: { name: "主线程组", num_threads: 10, ramp_up: 5, loops: 1 } },
    {
      tool: "add_http_request",
      args: {
        name: "登录请求",
        method: "POST",
        protocol: "https",
        domain: "example.com",
        path: "/api/login",
        content_type: "application/json",
        body_data: "{\"username\":\"demo\",\"password\":\"secret\"}",
        headers: [{ name: "Content-Type", value: "application/json" }],
      },
    },
    { tool: "add_listener", args: { type: "view_results_tree" } },
  ],
});
// result.path / result.filename 由服务端生成；validate/save/tree 已在服务端完成
```

服务端执行顺序固定为：`steps` 依次执行 → `validate_test_plan` → `save_test_plan`（保存到 `server/generated/<seed>-<时间戳>.jmx`）→ `list_test_plan_tree`，任一构建步骤失败即短路并返回带 `error.step` 的 typed 错误。

需要逐步编辑已加载的计划时，仍可使用 `/tools/:name` 单步调用（此时操作的是 MCP 会话共享的单例计划，见第 7 节）。

### 4.2 按路径插入元素

如果前端需要在指定节点下插入元素，先调用：

```ts
const tree = await callTool("list_test_plan_tree");
```

返回文本中会包含路径，例如：

```text
/0 | TestPlan | 登录接口压测计划 | enabled=true
/0/0 | ThreadGroup | 主线程组 | enabled=true
```

然后使用 `*_at_path` 系列工具：

```ts
await callTool("add_sampler_at_path", {
  parent_path: "/0/0",
  name: "查询用户",
  sampler_type: "http",
  method: "GET",
  domain: "example.com",
  path: "/api/user"
});
```

常见路径工具：

```text
add_config_at_path
add_sampler_at_path
add_preprocessor_at_path
add_postprocessor_at_path
add_extractor_at_path
add_assertion_at_path
add_timer_at_path
add_listener_at_path
add_controller_at_path
```

## 5. TypeScript Client 示例

建议前端封装一个很薄的 client，统一处理接口地址、错误和文本结果。

```ts
export type ToolCallSuccess = { ok: true; message: string; data?: Record<string, unknown> };
export type ToolCallFailure = { ok: false; error: { code: string; message: string } };
export type ToolCallResult = ToolCallSuccess | ToolCallFailure;

const API_BASE = import.meta.env.VITE_JMETER_API_BASE ?? "http://localhost:3000";

export async function getJmeterTools() {
  const response = await fetch(`${API_BASE}/tools`);
  if (!response.ok) {
    throw new Error(`获取工具列表失败：${response.status}`);
  }
  return response.json();
}

export async function callTool(name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(`${API_BASE}/tools/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });

  const data = (await response.json()) as ToolCallResult;

  if (!response.ok || !data.ok) {
    throw new Error(data.ok === false ? data.error.message : `调用 ${name} 失败：${response.status}`);
  }

  return { text: data.message, data: data.data };
}

// 整计划一次构建（模板生成推荐使用，代替多次 callTool 编排）
export type BuildSpec = {
  planName: string;
  seed: string;
  steps: Array<{ tool: string; args?: Record<string, unknown> }>;
};

export async function buildJmeterPlan(spec: BuildSpec) {
  const response = await fetch(`${API_BASE}/api/jmeter/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec)
  });

  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error?.message ?? `生成 JMX 失败：${response.status}`);
  }

  return data; // { ok, planName, path, filename, saveMessage, validation, tree, steps }
}

export type AiModelConfig = {
  base_url: string;
  api_key: string;
  model: string;
};

export async function generateJmeterWithAi(args: {
  prompt: string;
  ai_config: AiModelConfig;
  output_path?: string;
  temperature?: number;
  max_tokens?: number;
}) {
  const response = await fetch(`${API_BASE}/ai/generate-jmeter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });

  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `AI 生成 JMX 失败：${response.status}`);
  }

  return data;
}
```

前端 `.env` 示例：

```env
VITE_JMETER_API_BASE=http://localhost:3000
```

## 6. 常用工具分组

基础计划：

```text
create_test_plan
add_thread_group
load_test_plan
list_test_plan_tree
validate_test_plan
save_test_plan
run_test_plan
```

采样器：

```text
add_http_request
add_jdbc_request
add_tcp_sampler
add_ftp_sampler
add_jms_sampler
add_smtp_sampler
add_system_sampler
add_ldap_sampler
add_mail_reader_sampler
add_sampler_at_path
```

配置元件：

```text
add_config
add_more_configs
add_counter_config
add_config_at_path
```

控制器：

```text
add_controller
add_controller_at_path
add_include_controller
```

断言、提取器、脚本：

```text
add_assertion
add_extended_assertion
add_more_assertions
add_extractor
add_extractor_at_path
add_script
replace_script
```

定时器和监听器：

```text
add_timer
add_more_timers
add_listener
add_extended_listener
add_more_listeners
add_backend_listener
add_aggregate_graph
```

树操作：

```text
update_element
delete_element
move_element
```

## 7. 前端状态设计建议

推荐前端维护三层状态：

```text
表单态：用户正在编辑的配置
后端态：后端内存中的 JMeter 测试计划
文件态：保存后的 .jmx 路径和生成结果
```

关键点：

- 后端运行时是内存态，刷新后端进程会丢失未保存的测试计划。
- `/tools/:name`、`/rpc`、MCP SSE 会话操作的是同一个 `runtime` 单例计划（交互式编辑场景）。
- `POST /api/jmeter/build` 与 AI 生成（`/ai/generate-jmeter*`）每次请求都在服务端新建的独立 `TestPlanService` 实例上执行，并发构建/生成互不干扰。
- 前端用 `/tools/:name` 逐步编辑时，每次开始新建计划前应先调用 `create_test_plan` 重置当前计划。
- 复杂页面建议在每次关键操作后调用 `list_test_plan_tree` 刷新树视图。
- 保存 JMX 是服务器文件系统行为，`path` 是后端机器上的路径，不是浏览器本地路径。

## 8. 下载 JMX

当前后端已有 `save_test_plan`，可以把 JMX 保存到服务端路径：

```ts
await callTool("save_test_plan", {
  path: "server/generated/my-plan.jmx"
});
```

现在后端也提供了一个受限的浏览器下载接口：

```http
GET /files?path=server/generated/my-plan.jmx
```

约束如下：

- 只允许下载 `server/generated/` 目录下的文件。
- 只允许下载 `.jmx` 后缀文件。
- `path` 既可以传 `save_test_plan` 返回的相对路径，也可以传解析后的绝对路径，只要最终仍位于 `server/generated/` 下。

前端建议流程：

1. 通过 `POST /api/jmeter/build`（或 AI 生成接口）构建计划，从响应中读取 `path`（保存路径）与 `filename`（下载文件名）。
2. 若走单步调用，则调用 `save_test_plan` 并从结构化响应中读取 `data.path`（响应 `message` 仍为 `Test plan saved: server/generated/my-plan.jmx`，仅用于展示）。
3. 通过 `GET /files?path=...` 拉取 Blob 并触发浏览器下载。

## 9. 错误处理建议

前端统一处理以下错误类型：

```text
网络错误：后端未启动、跨域失败、端口不一致
协议错误：HTTP 非 2xx、JSON 解析失败
业务错误：响应 ok=false，按 error.code / error.message 展示
流程错误：未 create_test_plan 就添加元素、路径不存在、保存路径不可写
JMeter 运行错误：run_test_plan 返回 JMeter CLI 错误文本
```

建议 UI 文案：

```text
后端服务未连接，请确认 npm run server:start 已启动。
当前测试计划不存在，请先创建测试计划。
节点路径不存在，请刷新测试计划树后重试。
JMX 保存失败，请检查服务端保存路径是否可写。
```

## 10. 接入检查清单

前端完成接入后，至少验证以下链路：

```text
GET /health 能返回 ok=true
GET /tools 能返回 48 个工具
POST /api/jmeter/build 能一次生成 .jmx（响应含 path/filename/validation/tree/steps）
create_test_plan 能成功
add_thread_group 能成功
add_http_request 能成功
list_test_plan_tree 能看到新增节点
validate_test_plan 能成功
save_test_plan 能生成 .jmx
GET /files?path=... 能下载已生成的 .jmx
生成的 .jmx 能被 JMeter 5.6.3 打开
```

本项目已有覆盖全部已注册工具的集成测试：

```powershell
npx vitest run server/tests/jmeter-tools.test.ts
```

该套件会对每个工具做真实调用，并按前端模板链路端到端构建、保存、校验 .jmx。

## 11. TestCase 用例生成接口

当前后端已按 `Tools/TestCase/` 参考服务还原“测试用例生成相关”能力，但不包含登录、权限、许可证、自动化脚本录制/执行。

实现边界：

- 模型配置沿用当前项目方式：前端随请求传 `ai_config`，后端不保存、不读取 `ai.md`、不提供 `/api/model-config` 持久化。
- 当前能力定位为“测试用例生成工具”，AI 生成结果不会自动写入测试集/用例集合。
- 异步任务只保存任务状态和本次生成结果，前端从 `resultRows` 取数后自行决定预览、下载或保存到自己的业务状态。
- 接口响应尽量保持参考服务风格：`{ "success": true, "data": ... }` 或 `{ "success": false, "error": "..." }`。
- 代码按功能拆在 `server/src/features/testcase/`：AI、CSV、存储、导出、路由分别独立。

### 11.1 AI 配置格式

所有需要模型的 TestCase 接口都使用同一种请求级配置：

```json
{
  "ai_config": {
    "base_url": "https://your-openai-compatible-host/v1",
    "api_key": "用户自己的模型密钥",
    "model": "your-model-id"
  }
}
```

兼容别名：`baseUrl/baseurl/apiUrl/url`、`apiKey/key`、`model_id/modelId/id/selectedModel`。

### 11.2 用例生成主链路

页面行为：

```text
进入页面：只展示一个“新建用例”按钮
点击新建：弹出新建用例弹窗
弹窗提交：创建生成任务并轮询结果
生成完成：关闭弹窗，页面切换为用例列表
列表页面：展示生成的用例，并支持导出 Excel/XMind
```

推荐前端调用顺序：

```text
POST /api/generate-jobs
GET  /api/generate-jobs/:jobId 轮询
从 data.resultRows 或 data.testSetSnapshot.rows 读取生成结果
POST /api/export/excel 或 /api/export/xmind 下载文件
```

异步生成任务：

```http
POST /api/generate-jobs
Content-Type: application/json

{
  "mode": "create",
  "featureName": "登录功能",
  "context": "用户名必填，密码必填，登录成功后跳转首页，失败时展示错误提示。",
  "testType": "functional",
  "language": "zh",
  "count": 5,
  "ai_config": {
    "base_url": "https://your-host/v1",
    "api_key": "sk-xxx",
    "model": "your-model"
  }
}
```

任务响应：

```json
{
  "success": true,
  "data": {
    "jobId": "job_...",
    "status": "queued",
    "testSetId": "tool-result-job_...",
    "mode": "create"
  }
}
```

轮询任务：

```http
GET /api/generate-jobs/job_xxx
```

完成后 `data.resultRows` 会包含 CSV 二维数组，`data.resultHeader` 是表头。为兼容旧前端，`data.testSetSnapshot.rows` 也会返回同样的结果，但不会写入真实测试集。

默认字段顺序为：

```text
用例编号, 功能模块/接口名称, 功能测试点/请求方式及路径, 用例标题, 优先级, 前置条件, 测试步骤, 预期结果
```

### 11.3 导出

查看支持的 Excel 导出格式：

```http
GET /api/export/formats
```

当前支持：

```text
default：默认当前 8 列测试用例格式
jira：Jira 导入常见字段格式
zentao：禅道测试用例导入常见字段格式
```

导出单个测试集 Excel：

```http
POST /api/export/excel
Content-Type: application/json

{
  "featureName": "登录功能",
  "format": "default",
  "rows": [
    ["TC001", "登录", "用户名密码登录", "正确用户名密码登录", "高", "用户已注册", "1. 打开登录页\\n2. 输入用户名密码", "1. 登录成功"]
  ]
}
```

`format`/`platform` 可选，不传默认 `default`。导出 Jira：

```json
{
  "featureName": "登录功能",
  "format": "jira",
  "issueType": "Test",
  "component": "账号中心",
  "labels": "login,smoke",
  "rows": []
}
```

导出禅道：

```json
{
  "featureName": "登录功能",
  "format": "zentao",
  "productName": "用户中心",
  "rows": []
}
```

导出单个测试集 XMind：

```http
POST /api/export/xmind
Content-Type: application/json
```

批量导出：

```http
POST /api/export/excel-all
POST /api/export/xmind-all
```

批量请求体：

```json
{
  "projectName": "登录项目",
  "format": "jira",
  "testSets": [
    {
      "featureName": "登录功能",
      "rows": []
    }
  ]
}
```

### 11.4 兼容数据接口

以下接口保留用于兼容参考服务或旧前端，但当前“用例生成工具”主流程不依赖它们。AI 生成结果不会自动写入这些集合。

```text
GET    /api/projects
PUT    /api/projects/:projectId
DELETE /api/projects/:projectId
GET    /api/test-sets?project_id=...
DELETE /api/test-sets/:testSetId?project_id=...
POST   /api/test-cases
GET    /api/test-cases/:caseId?project_id=...
DELETE /api/test-cases/:caseId
POST   /api/test-sets/:testSetId/test-cases
GET    /api/bootstrap-data
POST   /api/test-connection
```

`POST /api/test-connection` 使用同样的 `ai_config`，成功返回：

```json
{
  "success": true,
  "message": "API 连接成功"
}
```
