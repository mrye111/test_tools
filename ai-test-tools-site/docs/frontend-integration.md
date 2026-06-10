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
  "tools": 57
}
```

## 2. 推荐接入方式

前端优先使用直接 HTTP 工具接口：

```http
GET /tools
POST /tools/:name
```

原因：

- 返回结构简单，适合 React 页面直接调用。
- 不需要维护 SSE 会话。
- 和 MCP 工具名、参数保持一致，后续切换 MCP 客户端成本低。

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
  "content": [
    {
      "type": "text",
      "text": "Test plan created: 登录接口压测计划"
    }
  ]
}
```

错误响应示例：

```json
{
  "error": "Unknown tool: xxx"
}
```

前端判断规则：

- HTTP 状态码非 `2xx`：按接口错误处理。
- `content[0].text` 以 `Error` 开头：按业务错误处理并展示给用户。
- 其它文本：按成功结果展示或进入下一步。

### 3.3 JSON-RPC 调用

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

### 3.4 MCP SSE 调用

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

### 3.5 AI 自然语言生成 JMX

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
- `output_path`：可选，生成文件名或 `server/generated/` 下路径；后端会限制只能写入 `server/generated/`。
- `ai_config.base_url`：OpenAI 兼容接口地址，通常以 `/v1` 结尾。
- `ai_config.api_key`：用户自己的模型密钥，只随本次请求发送。
- `ai_config.model`：模型 ID。
- `temperature`、`max_tokens`：可选，不传时默认 `0.2` 和 `6000`。

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

最小可用调用链：

```text
create_test_plan
add_thread_group
add_http_request
add_listener
validate_test_plan
save_test_plan
```

示例：

```ts
await callTool("create_test_plan", {
  name: "登录接口压测计划",
  comments: "前端生成"
});

await callTool("add_thread_group", {
  name: "主线程组",
  num_threads: 10,
  ramp_up: 5,
  loops: 1
});

await callTool("add_http_request", {
  name: "登录请求",
  method: "POST",
  protocol: "https",
  domain: "example.com",
  path: "/api/login",
  content_type: "application/json",
  body_data: "{\"username\":\"demo\",\"password\":\"secret\"}",
  headers: [
    { "name": "Content-Type", "value": "application/json" }
  ]
});

await callTool("add_listener", {
  type: "view_results_tree"
});

await callTool("validate_test_plan");

await callTool("save_test_plan", {
  path: "server/generated/frontend-login-test.jmx"
});
```

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
export type ToolCallResult = {
  content?: Array<{ type: "text"; text: string }>;
  error?: string;
};

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

  if (!response.ok) {
    throw new Error(data.error ?? `调用 ${name} 失败：${response.status}`);
  }

  const text = data.content?.[0]?.text ?? "";
  if (text.startsWith("Error")) {
    throw new Error(text);
  }

  return text;
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
- 同一个后端进程内，所有工具调用操作的是同一个 `runtime` 实例。
- 前端每次开始新建计划时，应先调用 `create_test_plan` 重置当前计划。
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

1. 调用 `save_test_plan` 获取服务端保存路径。
2. 从返回文本中提取路径，例如 `Test plan saved: server/generated/my-plan.jmx`。
3. 通过 `GET /files?path=...` 拉取 Blob 并触发浏览器下载。

## 9. 错误处理建议

前端统一处理以下错误类型：

```text
网络错误：后端未启动、跨域失败、端口不一致
协议错误：HTTP 非 2xx、JSON 解析失败
业务错误：返回文本以 Error 开头
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
GET /tools 能返回 57 个工具
create_test_plan 能成功
add_thread_group 能成功
add_http_request 能成功
list_test_plan_tree 能看到新增节点
validate_test_plan 能成功
save_test_plan 能生成 .jmx
GET /files?path=... 能下载已生成的 .jmx
生成的 .jmx 能被 JMeter 5.6.3 打开
```

本项目已有全量 smoke 命令：

```powershell
npm run server:smoke
```

该命令会生成包含所有 JMeter 元素的示例文件：

```text
server/generated/all-jmeter-elements.jmx
```

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

### 11.3 同步流式生成

如果前端只想直接拿 CSV 文本，可以调用：

```http
POST /api/generate
Content-Type: application/json
```

请求体和 `/api/generate-jobs` 类似，响应是 `text/plain; charset=utf-8`，内容为 CSV 文本。适合做实时预览；如果要轮询状态或避免长连接，使用异步任务接口。

### 11.4 导出

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

### 11.5 兼容数据接口

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
