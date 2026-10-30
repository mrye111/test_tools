import cors from "cors";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { registerTestCaseRoutes } from "./features/testcase/routes.js";
import { bootstrapTestCaseStore } from "./features/testcase/migrate.js";
import { sharedTestCaseStore } from "./features/testcase/shared-store.js";
import { registerDataFactoryRoutes } from "./features/datafactory/routes.js";
import { bootstrapReports } from "./features/report/migrate.js";
import { registerReportRoutes } from "./features/report/routes.js";
import { bootstrapLoadTest } from "./features/loadtest/migrate.js";
import { getLoadTestReport, registerLoadTestRoutes } from "./features/loadtest/routes.js";
import { registerLoadTestAiRoutes } from "./features/loadtest/ai.js";
import { parseAiRequestConfig } from "./features/testcase/ai.js";
import { RunManager } from "./features/loadtest/run-manager.js";
import { ProcessK6Runner } from "./features/loadtest/k6-runner.js";
import { MonitorService } from './features/loadtest/monitor.js';
import { createLoadTestTools } from './features/loadtest/mcp-tools.js';
import { bootstrapRequirementV2 } from "./features/requirement-v2/migrate.js";
import { registerRequirementV2Routes } from "./features/requirement-v2/routes.js";
import { bootstrapAutomation } from "./features/automation/migrate.js";
import { registerAutomationRoutes } from "./features/automation/routes.js";
import { registerLogRoutes } from "./log-routes.js";
import { traceMiddleware } from "./middleware/trace.js";
import { AppError, badRequest, internal, notFound } from "./app-error.js";
import { logger } from "./logger.js";
import { bootstrapAuth, createSessionMiddleware } from "./features/auth/migrate.js";
import { createAuthGate } from "./features/auth/middleware.js";
import { registerAuthRoutes } from "./features/auth/routes.js";
import { registerCloudModelConfigRoutes } from "./features/auth/model-config-routes.js";
import {
  createJobAiConfigResolver,
  resolveAiRequestConfig,
  resolveCloudAiConfigBody,
  type AiConfigResolver,
} from "./features/auth/cloud-config-resolve.js";
import { setJobAiConfigResolver } from "./features/testcase/generation.js";
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

  // ── 会话与鉴权：default-deny 门禁置于全部业务路由之前，新增路由自动入保 ──
  const authRuntime = await bootstrapAuth();
  app.use(createSessionMiddleware(authRuntime));
  app.use(createAuthGate({ store: authRuntime.store }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION, tools: runtime.tools.size });
  });

  app.get("/tools", (_req, res) => {
    res.json([...runtime.tools.values()].map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })));
  });

  await bootstrapTestCaseStore(sharedTestCaseStore);
  registerAuthRoutes(app, authRuntime.store);
  registerCloudModelConfigRoutes(app, authRuntime.store, authRuntime.secret);
  // 云端模型配置按引用解析（spec §4）：路由侧按 req.authUser 实时解析；生成任务运行起点经注入的解析器重取，
  // 明文密钥仅瞬时驻留内存，任务 request 落库的只有 cloudConfigId 引用。
  const resolveAiConfig: AiConfigResolver = (userId, body) =>
    resolveAiRequestConfig(authRuntime.store, authRuntime.secret, userId, body);
  setJobAiConfigResolver(createJobAiConfigResolver(authRuntime.store, authRuntime.secret));
  registerTestCaseRoutes(app, resolveAiConfig);
  registerDataFactoryRoutes(app);
  const reportRepo = await bootstrapReports();
  registerReportRoutes(app, reportRepo, resolveAiConfig);
  // 在线压测：原生 k6 进程执行（ADR 0011），执行产物落在 server/generated/loadtest/
  const loadtestRepo = await bootstrapLoadTest();
  const loadtestDir = resolve(generatedRoot, 'loadtest');
  const loadtestMonitor = new MonitorService(resolve(loadtestDir, 'monitor-config.json'));
  await loadtestMonitor.load();
  const loadtestRunManager = new RunManager({
    repo: loadtestRepo,
    runner: new ProcessK6Runner({ serverCwd: process.cwd() }),
    workDirRoot: loadtestDir,
    monitor: loadtestMonitor,
  });
  registerLoadTestRoutes(app, loadtestRepo, { runManager: loadtestRunManager, monitor: loadtestMonitor, workDirRoot: loadtestDir });
  registerLoadTestAiRoutes(app, {
    resolveConfig: (req, body) => req.authUser?.id ? resolveAiConfig(req.authUser.id, body) : Promise.resolve(parseAiRequestConfig(body)),
    getReport: (id) => getLoadTestReport(loadtestRepo, { runManager: loadtestRunManager, monitor: loadtestMonitor, workDirRoot: loadtestDir }, id),
  });
  runtime.registerAsyncTools(createLoadTestTools(loadtestRepo, { runManager: loadtestRunManager, monitor: loadtestMonitor, workDirRoot: loadtestDir }));
  const analysisRepo = await bootstrapRequirementV2();
  registerRequirementV2Routes(app, analysisRepo, resolveAiConfig);
  const automation = await bootstrapAutomation(analysisRepo);
  registerAutomationRoutes(app, automation.repo, automation.runManager, automation.benchManager, automation.importManager, automation.exploreManager, automation.planManager, resolveAiConfig);
  registerLogRoutes(app);

  app.get("/ai/config", (_req, res) => {
    res.json(publicAiConfigStatus());
  });

  app.post("/ai/generate-jmeter", async (req, res) => {
    try {
      const resolvedBody = await resolveCloudAiConfigBody(authRuntime.store, authRuntime.secret, req.authUser?.id ?? "", (req.body ?? {}) as JsonObject);
      res.json(await generateJmeterWithAi(runtime, resolvedBody, generatedRoot));
    } catch (error) {
      const status = error instanceof AppError ? error.httpStatus : 400;
      res.status(status).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/ai/generate-jmeter/stream", async (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      const resolvedBody = await resolveCloudAiConfigBody(authRuntime.store, authRuntime.secret, req.authUser?.id ?? "", (req.body ?? {}) as JsonObject);
      await generateJmeterWithAi(
        runtime,
        resolvedBody,
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

  app.post("/tools/:name", async (req, res) => {
    const result = await runtime.callToolAsync(req.params.name, (req.body ?? {}) as JsonObject);
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

  app.post("/messages", async (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid session" }, id: null });
      return;
    }
    res.status(202).end();
    const response = await runtime.dispatchAsync(req.body as JsonObject);
    if (response) sendSseEvent(session.response, "message", JSON.stringify(response));
  });

  app.post("/rpc", async (req, res) => {
    const response = await runtime.dispatchAsync(req.body as JsonObject);
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
    // 出站不透传原始错误文案（可能内嵌请求体片段/密钥），细节只进日志（审查 M-5）
    res.status(500).json({ success: false, error: { code: "INTERNAL", message: "服务器内部错误" } });
  });

  return app;
}

export async function startStdio(runtime = new JmeterMcpRuntime()): Promise<void> {
  const repo = await bootstrapLoadTest();
  const dir = resolve(process.cwd(), 'server', 'generated', 'loadtest');
  const monitor = new MonitorService(resolve(dir, 'monitor-config.json'));
  await monitor.load();
  const runManager = new RunManager({ repo, runner: new ProcessK6Runner({ serverCwd: process.cwd() }), workDirRoot: dir, monitor });
  runtime.registerAsyncTools(createLoadTestTools(repo, { runManager, monitor, workDirRoot: dir }));
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const request = JSON.parse(trimmed) as JsonObject;
      const response = await runtime.dispatchAsync(request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse or dispatch error: ${error instanceof Error ? error.message : String(error)}` } }) + "\n");
    }
  }
}
