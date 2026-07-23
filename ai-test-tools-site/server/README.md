# JMeter MCP TypeScript Backend

这个后端用当前项目约定的 `Node.js + Express + TypeScript` 重写 `Tools/publish-jmeter-mcp` 参考服务的后端能力。

## 能力范围

- 兼容 MCP JSON-RPC：`initialize`、`ping`、`tools/list`、`tools/call`
- 兼容 HTTP+SSE MCP 传输：`GET /sse` + `POST /messages?sessionId=...`
- 额外提供直接调试接口：`POST /rpc`、`GET /tools`、`POST /tools/:name`
- 注册参考服务的 48 个工具
- 维护内存中的 JMeter 测试计划树，支持创建、路径插入、更新、移动、删除、保存、加载、验证
- 输出标准 JMeter `.jmx` 的 `TestElement + hashTree` 结构

## 常用命令

```powershell
npm run server:build
npm run server:start
npx vitest run server/tests/
```

`server/tests/jmeter-tools.test.ts` 会对全部 48 个已注册工具做集成冒烟，并覆盖前端模板构建链路。

## 启动方式

HTTP/SSE：

```powershell
npm run server:build
node server/dist/src/index.js http 3000
```

stdio：

```powershell
npm run server:build
node server/dist/src/index.js stdio
```

## 说明

参考 Java 服务依赖 JMeter 内部 Java 类直接序列化对象。TypeScript 版本不能复用这些类，因此采用行为还原：保留工具名、参数默认值、文本响应风格、作用域语义和常见 `guiclass/testclass` 映射，并自行构建 JMX XML。
