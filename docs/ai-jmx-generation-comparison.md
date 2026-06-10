# AI 生成 JMX 方案测试

## 用户需求示例
"测试百度首页的并发性能，100个用户同时访问，持续30秒，验证响应状态码为200"

---

## 方案 A：AI 直接输出 JmxBuilder 调用代码

**AI Prompt:**
```
将用户需求转换为 JmxBuilder 的方法调用序列：
- createTestPlan(name, comments?)
- addThreadGroup(name, threads, rampUp, loops)
- addHttpRequest({ name, method, domain, path, protocol?, port?, bodyData?, headers? })
- addResponseAssertion(patterns)
- addListener(type, name)
```

**AI 输出（预期）:**
```typescript
builder.createTestPlan('百度首页并发测试', '100用户并发测试')
builder.addThreadGroup('用户组', 100, 5, -1) // loops=-1 表示持续运行
builder.addHttpRequest({
  name: 'GET 百度首页',
  method: 'GET',
  domain: 'www.baidu.com',
  path: '/',
  protocol: 'https'
})
builder.addResponseAssertion(['200'])
builder.addListener('aggregate_report', '聚合报告')
builder.addListener('view_results_tree', '查看结果树')
```

**优点：**
- 直接可执行，无需额外解析
- AI 完全理解 API

**缺点：**
- AI 需要精确记忆 API 签名
- 容易出现语法错误
- 持续时间（30秒）无法直接表达，需要转换为 loops + duration

**风险评估：高** — AI 生成代码容易有细节错误

---

## 方案 B：AI 输出 MCP 工具调用序列

**AI Prompt:**
```
使用 MCP 工具生成 JMeter 测试计划：
- create_test_plan(name, comments)
- add_thread_group(name, num_threads, ramp_up, loops, duration?)
- add_http_request(name, method, domain, path, protocol, port)
- add_assertion(name, type, patterns)
- add_listener(type, name)
```

**AI 输出（预期）:**
```json
[
  {"tool": "create_test_plan", "args": {"name": "百度首页并发测试"}},
  {"tool": "add_thread_group", "args": {"name": "用户组", "num_threads": 100, "ramp_up": 5, "duration": 30}},
  {"tool": "add_http_request", "args": {"name": "GET 百度首页", "method": "GET", "domain": "www.baidu.com", "path": "/", "protocol": "https"}},
  {"tool": "add_assertion", "args": {"name": "状态码断言", "type": "response", "patterns": ["200"]}},
  {"tool": "add_listener", "args": {"type": "aggregate_report", "name": "聚合报告"}}
]
```

**优点：**
- 结构化，易于验证
- MCP 工具可以自己处理持续时间逻辑

**缺点：**
- 需要独立的 MCP 服务
- 增加架构复杂度

**风险评估：中** — 需要额外服务，但格式清晰

---

## 方案 C：AI 输出高级指令（推荐）

**AI Prompt:**
```
将用户需求转换为测试计划描述（JSON 格式）：
{
  "testPlan": { "name": "...", "comments": "..." },
  "threadGroup": { "name": "...", "threads": N, "rampUp": N, "duration": N },
  "samplers": [
    { "type": "http", "name": "...", "method": "...", "url": "...", ... }
  ],
  "assertions": [
    { "type": "responseCode", "expected": "..." }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**AI 输出（预期）:**
```json
{
  "testPlan": {
    "name": "百度首页并发测试",
    "comments": "测试100个用户并发访问百度首页30秒"
  },
  "threadGroup": {
    "name": "并发用户组",
    "threads": 100,
    "rampUp": 5,
    "duration": 30
  },
  "samplers": [
    {
      "type": "http",
      "name": "访问百度首页",
      "method": "GET",
      "url": "https://www.baidu.com/"
    }
  ],
  "assertions": [
    {
      "type": "responseCode",
      "expected": "200"
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**Node.js 后端翻译逻辑：**
```typescript
function translateToJmxBuilder(plan: TestPlanDescriptor): string {
  const builder = new JmxBuilder()
  
  builder.createTestPlan(plan.testPlan.name, plan.testPlan.comments)
  
  // 持续时间转换：duration (秒) → loops + ThreadGroup.duration
  const loops = plan.threadGroup.duration ? -1 : 10
  builder.addThreadGroup(
    plan.threadGroup.name,
    plan.threadGroup.threads,
    plan.threadGroup.rampUp,
    loops
  )
  
  for (const sampler of plan.samplers) {
    if (sampler.type === 'http') {
      const url = new URL(sampler.url)
      builder.addHttpRequest({
        name: sampler.name,
        method: sampler.method,
        domain: url.hostname,
        path: url.pathname + url.search,
        protocol: url.protocol.replace(':', ''),
        port: url.port ? parseInt(url.port) : undefined
      })
    }
  }
  
  for (const assertion of plan.assertions) {
    if (assertion.type === 'responseCode') {
      builder.addResponseAssertion([assertion.expected])
    }
  }
  
  for (const listener of plan.listeners) {
    builder.addListener(listener as any, listener)
  }
  
  return builder.toJmx()
}
```

**优点：**
- AI 输出高级语义，不关心实现细节
- 后端完全可控，可以处理特殊逻辑（如持续时间转换）
- 易于验证和调试
- 不需要额外服务

**缺点：**
- 需要定义和维护指令格式
- 后端需要翻译逻辑

**风险评估：低** — 最可控，最易维护

---

## 推荐：方案 C

**理由：**
1. **AI 友好** - 输出自然语义，不需要记忆 API 细节
2. **后端可控** - 所有实现逻辑在 Node.js，易于调试
3. **易于扩展** - 添加新的 sampler 类型只需扩展翻译逻辑
4. **无额外依赖** - 直接复用现有 JmxBuilder

**下一步：你同意这个方案吗？如果同意，我立即实现。**
