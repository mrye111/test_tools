# AI 测试工具工作台

面向测试工程师的本地一体化 AI 工具平台：把 Jmeter 脚本编写、用例设计、报告整理、数据构造、需求分析这些高频重复劳动，收敛到一个可复用、可验证的工具台中。AI 仅产出结构化草稿，所有结果可预览、可编辑、可导出。

## 功能一览

| 工具 | 路由 | 说明 |
| --- | --- | --- |
| Jmeter脚本 | `/jmeter` | 模板 / AI 生成 JMeter 测试计划，AI 结果实时挂载到计划树，单文件导出 |
| 用例生成 | `/testcase` | 按项目与测试用例集管理，支持补充需求、新增/删除用例、覆盖模式三档策略、多格式导出 |
| 测试报告 | `/test-report` | 导入禅道 CSV，输出质量摘要、趋势图表与多种展示风格 |
| 数据工厂 | `/data-factory` | 测试数据生成、编码解码、字符串处理、加密哈希 |
| 需求分析 | `/requirement-analysis` | 需求文档解析、需求分解树、分析结论、分析记录与脑图导出 |
| 开发工具 | — | 规划中（JSON / 正则 / 颜色拾取，PRD 见 issue #1） |

## 技术架构

- **前端**：React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + ECharts + Framer Motion
- **后端**：Express + TypeScript，工具注册表内置 23 个 MCP 工具，SSE 流式输出
- **双 Copilot**：页面内工具工作流 Copilot + 面向编码代理的 MCP Copilot（Claude Code / Kimi CLI 等，stdio 入口 `server/dist/mcp-stdio.js`）
- **模型接入**：OpenAI 兼容 API（Kimi、DeepSeek、豆包等），模型配置仅保存于浏览器 localStorage，不上传服务端

```
Test_Tools_Demo/
├── ai-test-tools-site/        # 主应用（前端 src/ + 后端 server/）
│   ├── src/                   # 页面、组件、features、hooks、lib
│   └── server/                # Express 后端（src/features、tests）
├── docs/                      # 领域文档
│   ├── adr/                   # 架构决策记录（0001–0004）
│   └── agents/                # 协作约定（issue 跟踪、标签、文档）
├── PRODUCT.md                 # 产品定位、品牌与设计原则
├── CONTEXT.md                 # 领域词汇表
└── all-tools-check.jmx        # JMeter 全元素手工验证资产
```

## 快速开始

要求 Node.js ≥ 20。

```bash
cd ai-test-tools-site
npm install

# 启动后端（默认 3000 端口）
npm run server

# 另开一个终端，启动前端（默认 5173 端口）
npm run dev
```

打开 <http://localhost:5173>，在「设置」页选择模型供应商并填写 API Key（仅保存在浏览器本地）。

前端默认访问 `http://localhost:3000` 的后端 API，可通过环境变量 `VITE_JMETER_API_BASE` 覆盖。

## 常用命令

| 命令（`ai-test-tools-site/` 下） | 作用 |
| --- | --- |
| `npm run dev` | 启动前端开发服务器（Vite） |
| `npm run server` | 编译并启动后端（默认 3000 端口） |
| `npm run build` | 前端生产构建 |
| `npm run test` | 运行全部测试（Vitest） |
| `npm run lint` | ESLint 检查 |

## 测试

Vitest + Testing Library（jsdom），覆盖前端页面/组件与后端路由、store、工具实现：44 个测试文件、300+ 用例，`npm run test` 一键运行。

## 文档

- [PRODUCT.md](PRODUCT.md) — 产品定位、品牌与设计原则
- [CONTEXT.md](CONTEXT.md) — 领域词汇表（项目/测试用例集/覆盖模式等核心概念）
- [docs/adr/](docs/adr/) — 架构决策记录：覆盖模式、结构化追踪、JMeter 工具面对齐、需求分析记录
- [ai-test-tools-site/docs/frontend-integration.md](ai-test-tools-site/docs/frontend-integration.md) — 前后端集成说明
- [ai-test-tools-site/server/README.md](ai-test-tools-site/server/README.md) — 后端与 MCP 工具细节

## 数据与安全

- 模型配置（含 API Key）仅保存在浏览器 localStorage，服务端不落盘
- `server/data/`、`server/generated/` 为运行时数据目录，已排除出版本控制
- 仓库历史经过凭据清理；如发现安全问题，请通过 issue 反馈
