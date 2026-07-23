import type { Express, Request, Response } from "express";
import type { JsonObject } from "./types.js";
import { categories, findTool, buildToolResponse, tools } from "./tools.js";

function ok(res: Response, data: JsonObject = {}): void {
  res.json({ success: true, ...data });
}

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ success: false, error: message });
}

function body(req: Request): JsonObject {
  return typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body : {};
}

function text(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function registerDataFactoryRoutes(app: Express): void {
  app.get("/api/data-factory/categories", (_req, res) => {
    ok(res, {
      data: categories.map((c) => ({
        ...c,
        tools: c.tools.map((id) => {
          const tool = findTool(id);
          return tool ? buildToolResponse(tool) : { id };
        }),
      })),
    });
  });

  app.get("/api/data-factory/tools", (_req, res) => {
    ok(res, { data: tools.map(buildToolResponse) });
  });

  app.post("/api/data-factory/execute", async (req, res) => {
    const data = body(req);
    const toolId = text(data.tool).trim();
    if (!toolId) return fail(res, "tool 参数不能为空");
    const tool = findTool(toolId);
    if (!tool) return fail(res, `工具 ${toolId} 不存在`, 404);
    const args = typeof data.args === "object" && data.args !== null && !Array.isArray(data.args) ? data.args : {};
    try {
      const result = await tool.execute(args);
      ok(res, { data: result });
    } catch (error) {
      fail(res, error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/api/data-factory/batch", async (req, res) => {
    const data = body(req);
    const toolId = text(data.tool).trim();
    const count = Math.max(1, Math.min(100, Math.floor(num(data.count, 10))));
    if (!toolId) return fail(res, "tool 参数不能为空");
    const tool = findTool(toolId);
    if (!tool) return fail(res, `工具 ${toolId} 不存在`, 404);
    const args = typeof data.args === "object" && data.args !== null && !Array.isArray(data.args) ? data.args : {};
    try {
      const results: JsonObject[] = [];
      for (let i = 0; i < count; i += 1) {
        const item = await tool.execute(args);
        results.push(typeof item === "object" && item !== null ? (item as JsonObject) : { value: item });
      }
      ok(res, { data: { count, results } });
    } catch (error) {
      fail(res, error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/api/data-factory/variable-functions", (_req, res) => {
    ok(res, {
      data: tools.map((t) => ({
        name: t.id,
        syntax: `{{${t.id}(...)}}`,
        description: t.description,
        category: t.category,
      })),
    });
  });
}
