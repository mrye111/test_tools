import cors from "cors";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { registerTestCaseRoutes } from "./features/testcase/routes.js";
import { registerDataFactoryRoutes } from "./features/datafactory/routes.js";
import { registerRequirementRoutes } from "./features/requirement/routes.js";
import { registerChatRoutes } from "./features/requirement/chat/routes.js";
import { bootstrapChat } from "./features/requirement/chat/migrate.js";
import { bootstrapReports } from "./features/report/migrate.js";
import { registerReportRoutes } from "./features/report/routes.js";
import { registerLogRoutes } from "./log-routes.js";
import { traceMiddleware } from "./middleware/trace.js";
import { AppError, badRequest, internal, notFound } from "./app-error.js";
import { logger } from "./logger.js";
import { type JsonObject } from "./jmx-serializer.js";
import {
  generateJmeterWithAi,
  publicAiConfigStatus,
  sendSseEvent,
  type AiGenerationStreamEvent,
  type SseSession,
} from "./ai-generator.js";
import { JmeterMcpRuntime } from "./mcp-runtime.js";
import { buildFromTemplate, PlanBuildError, type TemplateBuildSpec } from "./plan-builder.js";

const SERVER_NAME = "jmeter-mcp-server";
const SERVER_VERSION = "1.0.0";

/** Map stable tool error codes (ADR-0002) onto AppError HTTP semantics. */
function toolErrorToAppError(code: string, message: string): AppError {
  switch (code) {
    case "unknown-type":
    case "invalid-args":
    case "invalid-state":
      return badRequest(message);
    case "not-found":
      return notFound(message);
    default:
      return internal(message);
  }
}

export async function createMcpExpressApp(runtime = new JmeterMcpRuntime()): Promise<Express> {
  const app = express();
  const sessions = new Map<string, SseSession>();
  const generatedRoot = resolve(process.cwd(), "server", "generated");
  const flushSse = (res: Response) => {
    const maybeFlush = res as Response & { flush?: () => void };
    maybeFlush.flush?.();
  };

  // ── 基础 middleware ──────────────────────────────────────────────────────
  app.use(cors());
  app.use(express.json({ limit: "20mb" }));
  app.use(traceMiddleware);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION, tools: runtime.tools.size });
  });

  app.get("/tools", (_req, res) => {
    res.json([...runtime.tools.values()].map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })));
  });

  registerTestCaseRoutes(app);
  registerDataFactoryRoutes(app);
  const chatRepo = await bootstrapChat();
  registerChatRoutes(app, chatRepo);
  const reportRepo = await bootstrapReports();
  registerReportRoutes(app, reportRepo);
  registerRequirementRoutes(app);
  registerLogRoutes(app);

  app.get("/ai/config", (_req, res) => {
    res.json(publicAiConfigStatus());
  });

  app.post("/ai/generate-jmeter", async (req, res) => {
    try {
      res.json(await generateJmeterWithAi(runtime, (req.body ?? {}) as JsonObject, generatedRoot));
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/ai/generate-jmeter/stream", async (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      await generateJmeterWithAi(
        runtime,
        (req.body ?? {}) as JsonObject,
        generatedRoot,
        (event: AiGenerationStreamEvent) => {
          sendSseEvent(res, "ai-event", JSON.stringify(event));
          flushSse(res);
        },
      );
      res.write("event: end\ndata: done\n\n");
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendSseEvent(res, "ai-event", JSON.stringify({
        type: "error",
        title: "生成失败",
        content: message,
      }));
      res.write("event: end\ndata: error\n\n");
      res.end();
    }
  });

  // 模板构建收口：一次请求完成整个测试计划构建（每请求独立 TestPlanService，见 plan-builder.ts）。
  app.post("/api/jmeter/build", async (req, res) => {
    try {
      const built = await buildFromTemplate((req.body ?? {}) as TemplateBuildSpec, { generatedRoot });
      res.json({ ok: true, ...built });
    } catch (error) {
      if (error instanceof PlanBuildError) {
        const appError = toolErrorToAppError(error.code, error.message);
        res.status(appError.httpStatus).json({
          ok: false,
          error: { code: error.code, message: error.message, ...(error.step ? { step: error.step } : {}) },
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ traceId: (req as Request & { traceId?: string }).traceId, status: 500 }, message);
      res.status(500).json({ ok: false, error: { code: "internal", message } });
    }
  });

  app.post("/tools/:name", (req, res) => {
    const result = runtime.callTool(req.params.name, (req.body ?? {}) as JsonObject);
    if (result.ok) {
      res.json({ ok: true, message: result.message, ...(result.data ? { data: result.data } : {}) });
      return;
    }
    const appError = toolErrorToAppError(result.error.code, result.error.message);
    res.status(appError.httpStatus).json({ ok: false, error: { code: result.error.code, message: result.error.message } });
  });

  app.get("/files", (req, res) => {
    const requested = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!requested) {
      res.status(400).json({ error: "Missing path query parameter" });
      return;
    }

    const filePath = resolve(requested);
    const fileRelativePath = relative(generatedRoot, filePath);
    const insideGeneratedDir = fileRelativePath !== "" && !fileRelativePath.startsWith("..") && !fileRelativePath.includes(":");

    if (!insideGeneratedDir) {
      res.status(403).json({ error: "Only files under server/generated are allowed" });
      return;
    }

    if (!filePath.toLowerCase().endsWith(".jmx")) {
      res.status(400).json({ error: "Only .jmx files can be downloaded" });
      return;
    }

    if (!existsSync(filePath)) {
      res.status(404).json({ error: `File not found: ${requested}` });
      return;
    }

    const filename = basename(filePath).replace(/"/g, "");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  });

  app.get("/sse", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const sessionId = randomUUID();
    sessions.set(sessionId, { id: sessionId, response: res });
    sendSseEvent(res, "endpoint", `/messages?sessionId=${sessionId}`);
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(keepalive);
      sessions.delete(sessionId);
    });
  });

  app.post("/messages", (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid session" }, id: null });
      return;
    }
    res.status(202).end();
    const response = runtime.dispatch(req.body as JsonObject);
    if (response) sendSseEvent(session.response, "message", JSON.stringify(response));
  });

  app.post("/rpc", (req, res) => {
    const response = runtime.dispatch(req.body as JsonObject);
    if (response) res.json(response);
    else res.status(204).end();
  });

  // ── 全局错误处理 ──────────────────────────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      logger.error({ traceId: (res.req as Request & { traceId?: string }).traceId, code: err.code, status: err.httpStatus, cause: err.cause?.message }, err.message);
      res.status(err.httpStatus).json({ success: false, error: err.toJSON() });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ traceId: (res.req as Request & { traceId?: string }).traceId, status: 500, stack: err instanceof Error ? err.stack : undefined }, message);
    res.status(500).json({ success: false, error: { code: "INTERNAL", message } });
  });

  return app;
}

export async function startStdio(runtime = new JmeterMcpRuntime()): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const request = JSON.parse(trimmed) as JsonObject;
      const response = runtime.dispatch(request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse or dispatch error: ${error instanceof Error ? error.message : String(error)}` } }) + "\n");
    }
  }
}
