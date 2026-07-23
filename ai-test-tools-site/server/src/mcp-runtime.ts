import type { JsonObject } from "./jmx-serializer.js";
import type { McpTool } from "./tool-registry.js";
import { createTools } from "./tool-registry.js";
import { err, type ToolResult } from "./tool-result.js";
import { TestPlanService } from "./jmeterBackend.js";
import { withSpanSync } from "./middleware/trace.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "jmeter-mcp-server";
const SERVER_VERSION = "1.0.0";

export class JmeterMcpRuntime {
  // 单例 service 仅服务于 MCP stdio/SSE 会话的交互式编辑场景；
  // Web 端模板/AI 构建一律经 PlanBuilder（server/src/plan-builder.ts）创建每请求独立的 TestPlanService。
  readonly service = new TestPlanService();
  readonly tools = new Map<string, McpTool>();

  constructor() {
    for (const tool of createTools()) this.tools.set(tool.name, tool);
  }

  dispatch(request: JsonObject): JsonObject | null {
    const id = request.id;
    const method = typeof request.method === "string" ? request.method : null;
    if (!method) return id === undefined ? null : this.error(id, -32600, "Missing method");
    if (id === undefined || id === null) return null;
    if (method === "initialize") {
      const params = (request.params as JsonObject | undefined) ?? {};
      return this.success(id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    if (method === "ping") return this.success(id, {});
    if (method === "tools/list") {
      return this.success(id, {
        tools: [...this.tools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }
    if (method === "tools/call") {
      const params = (request.params as JsonObject | undefined) ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const tool = this.tools.get(name);
      if (!tool) return this.error(id, -32602, `Unknown tool: ${name}`);
      try {
        const result = tool.execute(((params.arguments as JsonObject | undefined) ?? {}) as JsonObject, this.service);
        if (!result.ok) {
          return this.success(id, {
            content: [{ type: "text", text: result.error.message }],
            isError: true,
          });
        }
        return this.success(id, {
          content: [{ type: "text", text: result.message }],
          ...(result.data ? { data: result.data } : {}),
        });
      } catch (error) {
        return this.success(id, {
          content: [{ type: "text", text: `Error executing tool '${name}': ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        });
      }
    }
    return this.error(id, -32601, `Method not found: ${method}`);
  }

  callTool(name: string, args: JsonObject = {}): ToolResult {
    return withSpanSync({ name: `tool.${name}`, type: "tool", attributes: { toolName: name, args } }, () => {
      const tool = this.tools.get(name);
      if (!tool) return err("not-found", `Unknown tool: ${name}`);
      return tool.execute(args, this.service);
    });
  }

  private success(id: unknown, result: JsonObject): JsonObject {
    return { jsonrpc: "2.0", id, result };
  }

  private error(id: unknown, code: number, message: string): JsonObject {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}
