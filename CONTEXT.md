# NexusKit — 智能工具集

## 领域术语

### NexusKit
在线工具平台，提供多种实用工具，无需安装即开即用。

### 工具卡片
首页展示的功能入口，每个卡片代表一个工具。点击后跳转到对应工具页面。

### Jmeter脚本
NexusKit 的性能测试工具，基于 jmeter-mcp 服务。支持三种使用模式：
- **模板选择**：预设 8 种性能测试模板（6 常用 + 2 高级），用户填写参数后生成 .jmx 文件
- **AI 生成**：用户用自然语言描述测试需求，AI 调用 jmeter-mcp 自动生成测试计划
- **自定义脚本**：用户手动编写 Groovy/JS/Python 脚本

### jmeter-mcp
Java 实现的 MCP 服务，暴露 57 个 JMeter 工具，支持创建、编辑、验证、执行 JMeter 测试计划。
- 支持 12 种采样器：HTTP、JDBC、TCP、FTP、JMS、SMTP、LDAP、Mail Reader、System、JSR223、BeanShell、Test Action
- 支持 16 种控制器、13 种断言、12 种监听器、7 种定时器、12 种配置元素
- 输出标准 .jmx 文件，兼容 JMeter GUI

### 模型配置
用户自配的 AI 模型信息，存储在本地（`~/.nexuskit/config.json`），不上传后端。
字段：模型名称、API Base URL、API Key、模型 ID、Temperature。
采用 OpenAI 兼容格式，支持大部分国内外模型。

### 用例生成工具
NexusKit 的高质量测试用例生成工具。用户通过新建入口提供需求描述，由 AI 生成尽量接近测试专家设计结果的测试用例列表。
用例生成工具内部可以执行需求结构化分析、用例生成和覆盖自检补全，但前端只展示生成任务和用例结果。

### 新建用例弹窗
用例生成工具中的创建入口。用户在弹窗中填写功能名称、测试类型、输出语言、覆盖模式、最大条数上限和需求描述。

### 用例列表
AI 生成后的测试用例结果视图。用例列表用于预览和导出，不等同于持久化的用例集合。

### 用例编号
用例列表中每条用例的编号。用例编号由后端在解析完成后统一重排，不依赖 AI 输出。
功能测试使用 `TC001, TC002, TC003...`；API 测试使用 `API-TC001, API-TC002...`。

### 用例质量校验
用例生成工具内部的结果校验机制。用例质量校验用于过滤或修复不符合要求的生成结果，包括列数、用例编号、步骤完整性、预期结果、优先级、标题重复和解释性文本等问题。
当生成结果不合格时，后端可以自动发起一次修复调用；修复后仍不合格时，保留有效用例并记录质量提示。
用例质量校验结果不在前端展示，前端只展示任务状态和有效用例结果。

### 覆盖模式
用例生成工具中的生成策略。覆盖模式用于表达希望 AI 达到的测试覆盖深度，优先级高于固定生成条数。
覆盖模式分为三档：
- **快速覆盖**：覆盖主流程、关键失败场景和基础边界。
- **标准覆盖**：默认模式，覆盖正向、反向、边界、权限、状态、数据校验和异常提示。
- **专家覆盖**：覆盖标准模式内容，并增加组合场景、风险场景、历史缺陷高发点、安全、兼容性和幂等性等扩展维度。
不同覆盖模式对应不同生成深度：
- **快速覆盖**：一次模型调用，速度优先。
- **标准覆盖**：两次模型调用，先做内部需求分析，再生成用例。
- **专家覆盖**：三次模型调用，先做内部需求分析，再生成用例，最后做覆盖自检补全。
覆盖维度不新增为用例列表字段，应体现在“功能测试点”或“用例标题”中，以保持当前 8 列格式和导出格式稳定。

### 最大条数上限
用例生成工具中的数量约束。最大条数上限用于控制生成规模，不要求 AI 必须凑满该数量。
最大条数上限是硬上限，生成结果不能超过该数量；AI 可以少于上限，但不能为了凑满数量牺牲用例质量。
默认上限：
- **快速覆盖**：8 条。
- **标准覆盖**：20 条。
- **专家覆盖**：40 条。
当覆盖维度超过最大条数上限时，优先保留核心主流程、高风险异常、边界、权限/状态、组合场景、兼容/可用性等更高价值场景。

### 性能测试模板
预设的 JMeter 测试计划骨架，用户只需填写关键参数即可生成 .jmx 文件。
- 常用模板：API 压力测试(HTTP)、数据库性能测试(JDBC)、TCP 连接测试、邮件发送测试(SMTP)、文件传输测试(FTP)、LDAP 目录测试
- 高级模板：自定义脚本(JSR223)、系统命令测试(System)
- 空白模板：从零开始自定义

### HTTP 请求类型
JMeter HTTP 请求支持多种请求类型，每种类型有不同的参数格式：
- **Query 参数**：GET/HEAD/DELETE 等，参数通过 URL Query 传递
- **JSON Body**：POST/PUT/PATCH，Content-Type: application/json
- **Form 表单**：POST，Content-Type: application/x-www-form-urlencoded
- **Multipart**：POST，Content-Type: multipart/form-data，支持文件上传
- **XML Body**：POST/PUT，Content-Type: application/xml
- **Raw Body**：POST/PUT，Content-Type: text/plain

Content-Type 通过 HTTP Header Manager 设置，不在 HTTP Request 元素中。

### 参数编辑器
- **CodeMirror JSON 编辑器**：自动格式化 + JSON 校验 + 语法高亮 + 折叠
- **高级参数表格**：key-value 表格 + 增删行 + 启用/禁用 + 编码选项
- **XML/Text 编辑器**：基础语法高亮

### HTTP 方法
支持 21 种：GET, POST, HEAD, PUT, OPTIONS, TRACE, DELETE, PATCH, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK, REPORT, MKCALENDAR, SEARCH

## 架构决策

- 前端：React + TypeScript + TailwindCSS（Vite）
- 后端：Node.js + Express + TypeScript
- AI 调用：SSE 流式输出，实时展示 AI 调用 MCP 工具的过程
- 配置存储：本地 JSON 文件，用户自管
