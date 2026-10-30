/** UI 自动化路由（/api/automation/）：项目化外壳（聚合/向导/环境/附件）+ 用例集 CRUD 与套件执行、用例 CRUD + 功能用例编译 + 运行（发起/查询/中止/SSE 直播/报告）+ 功能用例直跑 + 需求导入编排。 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Express, Request, Response } from "express";
import { AppError } from "../../app-error.js";
import { logger } from "../../logger.js";
import { beginSse, emit, endSse } from "../../shared/sse.js";
import { callChatCompletion, parseAiRequestConfig } from "../testcase/ai.js";
import { cloudConfigIdOf, type AiConfigResolver } from "../auth/cloud-config-resolve.js";
import type { AiRequestConfig, JsonObject } from "../testcase/types.js";
import { sharedTestCaseStore } from "../testcase/shared-store.js";
import type { BenchManager } from "./bench-manager.js";
import { compileFunctionalCase, type ChatMessage } from "./compiler.js";
import {
  deleteCredential,
  getExecutionSettings,
  getFastEngineConfig,
  getModelConfig,
  isDeniedCredentialName,
  listCredentials,
  saveExecutionConfig,
  saveFastEngineConfig,
  saveModelConfig,
  setCredential,
} from "./config-store.js";
import { getFastEngineState } from "./fast-engine.js";
import type { ExploreManager } from "./explore/explore-manager.js";
import { automationDbMode, automationEngineStatus, automationExploreDir, automationRunDir, engineStatusOverride } from "./migrate.js";
import type { ImportManager } from "./import-manager.js";
import type { PlanManager, PlanPageInput } from "./plan-manager.js";
import { estimatePlanSteps } from "./plan-proposals.js";
import { buildPageMap, generateRootCause, readRunInsight } from "./run-insight.js";
import type { RunManager } from "./run-manager.js";
import { describeCron, validateCron } from "./cron.js";
import { startScheduleScanner } from "./scheduler.js";
import { buildInsights } from "./insights.js";
import { locatingSmokeCheck } from "./smoke.js";
import type { ActivityAction, AutomationCase, AutomationCasePatch, AutomationEnvironment, AutomationProjectExt, AutomationRepository, AutomationStep, ExploreSource, ManualItem, PlanProposalPatch, RunRecord } from "./types.js";

function body(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message });
}

const VAR_DEF_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CASE_SOURCES = ["manual", "playground", "functional-import", "plan-proposal"] as const;

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** varDefs 只接受 plain object + 全字符串值 + 合法键名（"凭据只存配置键名"的服务端防线，评审 H2）。 */
function parseVarDefs(raw: unknown): Record<string, string> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VAR_DEF_KEY.test(key) || typeof value !== "string") return null;
    result[key] = value;
  }
  return result;
}

/** 写入面协议白名单：仅 http(s)（javascript:/data:/file: 在执行期才是实际风险，修复点在写入口，评审 M2）。 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function handleError(res: Response, err: unknown, context: string): void {
  // AppError（如云端模型配置引用 404/400）保留自身 HTTP 语义，且客户端错误不打错误日志
  if (err instanceof AppError) {
    fail(res, err.httpStatus, err.message);
    return;
  }
  logger.error({ err }, `[automation] ${context} 失败`);
  const message = err instanceof Error ? err.message : `${context}失败`;
  const status = message.includes("不存在") ? 404 : message.includes("仍在执行中") || message.includes("不能关闭") ? 409 : 500;
  fail(res, status, message);
}

const STEP_TYPES = new Set(["act", "assert", "extract", "wait"]);

/** 编辑器保存时的步骤形状校验（宽松：id 由服务端按顺序重排）。 */
function parseSteps(raw: unknown): AutomationStep[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const steps: AutomationStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>;
    if (typeof item !== "object" || item === null) return null;
    if (typeof item.type !== "string" || !STEP_TYPES.has(item.type)) return null;
    if (typeof item.text !== "string" || !item.text.trim()) return null;
    steps.push({
      id: i + 1,
      type: item.type as AutomationStep["type"],
      text: item.text.trim(),
      saveAs: typeof item.saveAs === "string" ? item.saveAs : undefined,
      fromStep: typeof item.fromStep === "number" ? item.fromStep : undefined,
      fromExpected: typeof item.fromExpected === "number" ? item.fromExpected : undefined,
      enabled: item.enabled !== false,
    });
  }
  return steps;
}

function parseManualItems(raw: unknown): ManualItem[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const items: ManualItem[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (typeof item !== "object" || item === null) return null;
    if (typeof item.text !== "string" || !item.text.trim()) return null;
    items.push({
      text: item.text.trim(),
      reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "需人工执行",
      fromStep: typeof item.fromStep === "number" ? item.fromStep : undefined,
    });
  }
  return items;
}

export function registerAutomationRoutes(
  app: Express,
  repo: AutomationRepository,
  runManager: RunManager,
  benchManager: BenchManager,
  importManager: ImportManager,
  exploreManager: ExploreManager,
  planManager: PlanManager,
  resolveAiConfig?: AiConfigResolver,
): void {
  /** 解析请求体 AI 配置：云端引用（cloudConfigId）按 req.authUser 实时解析，否则回退现状本地解析。 */
  const resolveConfig = (req: Request, b: JsonObject): Promise<AiRequestConfig> => {
    const userId = req.authUser?.id;
    if (resolveAiConfig && userId) return resolveAiConfig(userId, b);
    return Promise.resolve(parseAiRequestConfig(b));
  };

  /** 请求带 AI 配置（显式对象或云端引用）才解析；缺省返回 null（调用方决定降级语义）。 */
  const resolveOptionalConfig = async (req: Request, b: JsonObject): Promise<AiRequestConfig | null> => {
    const hasAi = b.aiConfig !== undefined || b.ai_config !== undefined || b.cloudConfigId !== undefined;
    return hasAi ? await resolveConfig(req, b) : null;
  };

  /** 首跑编译补全（P3）：plan-proposal 用例首跑前用提案文本编译真实步骤并回写；无 AI 配置按占位步骤直跑。 */
  const ensureCompiled = async (automationCase: AutomationCase, aiConfig: AiRequestConfig | null): Promise<AutomationCase> => {
    if (automationCase.source !== "plan-proposal" || automationCase.compileHash || !automationCase.sourceProposalId) {
      return automationCase;
    }
    const proposal = await repo.getProposal(automationCase.sourceProposalId);
    if (!proposal || !aiConfig) return automationCase;
    const callChat = (messages: ChatMessage[]) => callChatCompletion(aiConfig, { messages, maxTokens: 8192 });
    const compiled = await compileFunctionalCase(
      {
        caseRef: automationCase.caseNo,
        title: proposal.title,
        precondition: proposal.goal,
        steps: proposal.estSteps.join("\n"),
        expectedResult: proposal.expected.join("\n"),
        env: { entryUrl: automationCase.entryUrl },
      },
      { callChat, cache: repo },
    );
    const updated = await repo.updateCase(automationCase.id, {
      steps: compiled.plan.instructions,
      manualItems: compiled.plan.manualItems,
      compileHash: compiled.plan.compileHash,
    });
    return updated ?? automationCase;
  };

  /** 运行环境（P4）：显式指定优先，否则取项目默认环境（P1 配置）。 */
  const resolveRunEnvironment = async (projectId: string | undefined, override: string | null | undefined): Promise<string | undefined> => {
    if (override) return override;
    if (!projectId) return undefined;
    try {
      return (await repo.getProjectExt(projectId)).defaultEnvId ?? undefined;
    } catch {
      return undefined;
    }
  };

  /** P4 AI 根因：生成并落库（失败运行；入参含失败步骤 + 所在页面）。 */
  const generateAndPersistRootCause = async (record: RunRecord, aiConfig: AiRequestConfig) => {
    const insight = (await readRunInsight(automationRunDir(), record.id).catch(() => null)) ?? {
      pageTrail: record.pageTrail ?? [],
      frames: [],
    };
    const callChat = (messages: ChatMessage[]) => callChatCompletion(aiConfig, { messages, maxTokens: 4096 });
    const rootCause = await generateRootCause(
      {
        caseNo: record.caseNo,
        title: record.title,
        entryUrl: record.entryUrl,
        stepResults: record.stepResults,
        pageTrail: insight.pageTrail.length > 0 ? insight.pageTrail : record.pageTrail,
        error: record.error,
      },
      callChat,
    );
    await repo.updateRunRecord(record.id, { rootCause });
    return rootCause;
  };

  /** 运行完成回调：failed 且带 AI 配置 → 异步生成根因（不阻塞收尾，失败只记日志）。 */
  const rootCauseOnDone = (aiConfig: AiRequestConfig | null) => (done: RunRecord): void => {
    if (done.verdict !== "failed" || !aiConfig) return;
    void generateAndPersistRootCause(done, aiConfig).catch((error) =>
      logger.warn({ err: error }, "[automation] 运行根因自动生成失败"),
    );
  };

  /** P6 活动审计：谁/何时/触发了什么（fire-and-forget，失败只记日志不影响主流程）。 */
  const logActivity = (
    req: { authUser?: { username?: string } },
    projectId: string,
    action: ActivityAction,
    detail: string,
    actorOverride?: string,
  ): void => {
    void repo
      .addActivity({ projectId, actor: actorOverride ?? req.authUser?.username ?? "系统", action, detail })
      .catch((error) => logger.warn({ err: error }, "[automation] 活动审计写入失败"));
  };

  /** 批量启动用例运行（Run All / Test List 整集执行 / 定时触发共用）：共 batchId，跳过需人工项，失败继续。 */
  const startCaseBatch = async (
    caseIds: string[],
    opts: {
      aiConfig: AiRequestConfig | null;
      engine?: "auto" | "visual";
      useCache?: boolean;
      environmentId?: string | null;
      /** 审计文案：触发来源（批量执行/列表运行/定时到点…）。 */
      trigger?: string;
      /** 审计操作者（定时触发传「系统」类）。 */
      actor?: string;
    },
  ): Promise<{ batchId: string; runs: RunRecord[]; skippedManual: string[]; failed: Array<{ caseId: string; error: string }> }> => {
    const batchId = randomUUID();
    const runs: RunRecord[] = [];
    const skippedManual: string[] = [];
    const failed: Array<{ caseId: string; error: string }> = [];
    const touchedProjects = new Map<string, number>();
    for (const caseId of caseIds) {
      try {
        let automationCase = await repo.getCase(caseId);
        if (!automationCase) {
          failed.push({ caseId, error: "用例不存在" });
          continue;
        }
        automationCase = await ensureCompiled(automationCase, opts.aiConfig);
        if (automationCase.executable === "manual" || !automationCase.steps.some((s) => s.enabled)) {
          skippedManual.push(automationCase.caseNo);
          continue;
        }
        runs.push(
          await runManager.startRun({
            kind: "case",
            automationCase,
            batchId,
            engine: opts.engine,
            useCache: opts.useCache,
            environmentId: await resolveRunEnvironment(automationCase.projectId, opts.environmentId),
            onDone: rootCauseOnDone(opts.aiConfig),
          }),
        );
        touchedProjects.set(automationCase.projectId, (touchedProjects.get(automationCase.projectId) ?? 0) + 1);
      } catch (error) {
        failed.push({ caseId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    // 批次可跨项目（Test List 跨项目）：每个涉及项目各记一条审计
    for (const [projectId, count] of touchedProjects) {
      logActivity(
        { authUser: opts.actor ? { username: opts.actor } : undefined },
        projectId,
        "run",
        `${opts.trigger ?? "整集执行"}：发起 ${count} 条运行（批次 #${batchId.slice(0, 8)}）`,
      );
    }
    return { batchId, runs, skippedManual, failed };
  };

  app.get("/api/automation/storage-status", (_req, res) => {
    res.json({ success: true, data: { mode: automationDbMode(), engine: automationEngineStatus() } });
  });

  // ── 用例集与套件 ─────────────────────────────────────────────────────────

  app.get("/api/automation/sets", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      res.json({ success: true, data: await repo.listSets(projectId) });
    } catch (err) {
      handleError(res, err, "列出用例集");
    }
  });

  app.post("/api/automation/sets", async (req, res) => {
    try {
      const projectId = asString(body(req).projectId);
      const name = asString(body(req).name);
      if (!projectId || !name?.trim()) {
        fail(res, 400, "projectId 与 name 不能为空");
        return;
      }
      res.json({ success: true, data: await repo.createSet({ projectId, name: name.trim() }) });
    } catch (err) {
      handleError(res, err, "新建用例集");
    }
  });

  app.put("/api/automation/sets/:id", async (req, res) => {
    try {
      const name = asString(body(req).name);
      if (!name?.trim()) {
        fail(res, 400, "name 不能为空");
        return;
      }
      const updated = await repo.updateSet(req.params.id, { name: name.trim() });
      if (!updated) {
        fail(res, 404, "用例集不存在");
        return;
      }
      res.json({ success: true, data: updated });
    } catch (err) {
      handleError(res, err, "更新用例集");
    }
  });

  app.delete("/api/automation/sets/:id", async (req, res) => {
    try {
      const deleted = await repo.deleteSet(req.params.id);
      if (!deleted) {
        fail(res, 404, "用例集不存在");
        return;
      }
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "删除用例集");
    }
  });

  /** 套件执行：对集内全部可执行用例发起运行（失败继续——每例独立，互不影响）。 */
  app.post("/api/automation/sets/:id/run", async (req, res) => {
    try {
      const engine = automationEngineStatus();
      if (!engine.ready) {
        fail(res, 503, `执行引擎不可用：${engine.reason}`);
        return;
      }
      const sets = await repo.listSets();
      const target = sets.find((s) => s.id === req.params.id);
      if (!target) {
        fail(res, 404, "用例集不存在");
        return;
      }
      const entryUrlOverride = asString(body(req).entryUrl);
      if (entryUrlOverride && !isHttpUrl(entryUrlOverride)) {
        fail(res, 400, "entryUrl 仅支持 http/https 协议");
        return;
      }
      const cases = await repo.listCases(undefined, req.params.id);
      const runnable = cases.filter((c) => c.executable !== "manual" && c.steps.some((s) => s.enabled));
      const skippedManual = cases.filter((c) => !runnable.includes(c)).map((c) => c.caseNo);
      if (runnable.length === 0) {
        fail(res, 409, "集内没有可执行的用例");
        return;
      }
      const batchId = randomUUID();
      const rawEngine: unknown = body(req).engine;
      const engineMode = isEnum(rawEngine, ["auto", "visual"] as const) ? rawEngine : undefined;
      // 首跑编译（P3）：plan-proposal 用例带提案文本，套件执行前逐条补全真实步骤
      const aiConfig = await resolveOptionalConfig(req, body(req) as JsonObject);
      const runs = [];
      for (const automationCase of runnable) {
        const compiledCase = await ensureCompiled(automationCase, aiConfig);
        runs.push(
          await runManager.startRun({
            kind: "case",
            automationCase: entryUrlOverride ? { ...compiledCase, entryUrl: entryUrlOverride } : compiledCase,
            batchId,
            engine: engineMode,
            useCache: body(req).useCache !== false,
            environmentId: await resolveRunEnvironment(compiledCase.projectId, asString(body(req).environmentId)),
            onDone: rootCauseOnDone(aiConfig),
          }),
        );
      }
      res.json({ success: true, data: { batchId, setName: target.name, started: runs.length, skippedManual, runs } });
    } catch (err) {
      handleError(res, err, "套件执行");
    }
  });

  /** 批次聚合视图：N 通过/M 失败/K 部分 + 成员运行列表。 */
  app.get("/api/automation/batches/:batchId", async (req, res) => {
    try {
      const runs = await repo.listRunsByBatch(req.params.batchId);
      if (runs.length === 0) {
        fail(res, 404, "批次不存在");
        return;
      }
      const done = runs.filter((r) => r.status === "done");
      const aggregate = {
        batchId: req.params.batchId,
        total: runs.length,
        running: runs.length - done.length,
        passed: done.filter((r) => r.verdict === "passed").length,
        partial: done.filter((r) => r.verdict === "partial").length,
        failed: done.filter((r) => r.verdict === "failed").length,
        aborted: done.filter((r) => r.verdict === "aborted").length,
        createdAt: runs[0].createdAt,
        runs,
      };
      res.json({ success: true, data: aggregate });
    } catch (err) {
      handleError(res, err, "获取批次");
    }
  });

  app.get("/api/automation/cases", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const setId = typeof req.query.setId === "string" ? req.query.setId : undefined;
      res.json({ success: true, data: await repo.listCases(projectId, setId) });
    } catch (err) {
      handleError(res, err, "列出自动化用例");
    }
  });

  app.get("/api/automation/cases/:id", async (req, res) => {
    try {
      const found = await repo.getCase(req.params.id);
      if (!found) {
        fail(res, 404, "用例不存在");
        return;
      }
      res.json({ success: true, data: found });
    } catch (err) {
      handleError(res, err, "获取自动化用例");
    }
  });

  app.post("/api/automation/cases", async (req, res) => {
    try {
      const b = body(req);
      const projectId = asString(b.projectId);
      const title = asString(b.title);
      if (!projectId || !title?.trim()) {
        fail(res, 400, "projectId 与 title 不能为空");
        return;
      }
      const steps = parseSteps(b.steps);
      const manualItems = parseManualItems(b.manualItems);
      if (!steps || !manualItems) {
        fail(res, 400, "steps/manualItems 形状非法");
        return;
      }
      if (b.source !== undefined && !isEnum(b.source, CASE_SOURCES)) {
        fail(res, 400, `source 必须是 ${CASE_SOURCES.join("/")}`);
        return;
      }
      const entryUrl = asString(b.entryUrl);
      if (entryUrl && !isHttpUrl(entryUrl)) {
        fail(res, 400, "entryUrl 仅支持 http/https 协议");
        return;
      }
      const varDefs = parseVarDefs(b.varDefs);
      if (!varDefs) {
        fail(res, 400, "varDefs 必须是键名合法、值全为字符串的对象（只存配置键名，不存秘密）");
        return;
      }
      const created = await repo.createCase({
        projectId,
        setId: asString(b.setId) ?? undefined,
        title: title.trim(),
        source: isEnum(b.source, CASE_SOURCES) ? b.source : undefined,
        entryUrl: entryUrl ?? undefined,
        preconditionText: asString(b.preconditionText) ?? undefined,
        varDefs,
        steps,
        manualItems,
        sourceFunctionalCaseId: asString(b.sourceFunctionalCaseId) ?? undefined,
        sourceProposalId: asString(b.sourceProposalId) ?? undefined,
        compileHash: asString(b.compileHash) ?? undefined,
      });
      logActivity(req, projectId, "edit", `创建用例 ${created.caseNo} · ${created.title}`);
      res.json({ success: true, data: created });
    } catch (err) {
      handleError(res, err, "新建自动化用例");
    }
  });

  app.put("/api/automation/cases/:id", async (req, res) => {
    try {
      const b = body(req);
      const patch: AutomationCasePatch = {};
      if (b.title !== undefined) {
        const title = asString(b.title);
        if (!title?.trim()) {
          fail(res, 400, "title 不能为空");
          return;
        }
        patch.title = title.trim();
      }
      if (b.entryUrl !== undefined) {
        const entryUrl = asString(b.entryUrl) ?? "";
        if (entryUrl && !isHttpUrl(entryUrl)) {
          fail(res, 400, "entryUrl 仅支持 http/https 协议");
          return;
        }
        patch.entryUrl = entryUrl;
      }
      if (b.preconditionText !== undefined) patch.preconditionText = asString(b.preconditionText) ?? "";
      if (b.setId !== undefined) patch.setId = asString(b.setId) ?? undefined;
      if (b.varDefs !== undefined) {
        const varDefs = parseVarDefs(b.varDefs);
        if (!varDefs) {
          fail(res, 400, "varDefs 必须是键名合法、值全为字符串的对象（只存配置键名，不存秘密）");
          return;
        }
        patch.varDefs = varDefs;
      }
      if (b.steps !== undefined) {
        const steps = parseSteps(b.steps);
        if (!steps) {
          fail(res, 400, "steps 形状非法");
          return;
        }
        patch.steps = steps;
      }
      if (b.manualItems !== undefined) {
        const manualItems = parseManualItems(b.manualItems);
        if (!manualItems) {
          fail(res, 400, "manualItems 形状非法");
          return;
        }
        patch.manualItems = manualItems;
      }
      const updated = await repo.updateCase(req.params.id, patch);
      if (!updated) {
        fail(res, 404, "用例不存在");
        return;
      }
      logActivity(req, updated.projectId, "edit", `编辑用例 ${updated.caseNo} · ${updated.title}`);
      res.json({ success: true, data: updated });
    } catch (err) {
      handleError(res, err, "更新自动化用例");
    }
  });

  app.delete("/api/automation/cases/:id", async (req, res) => {
    try {
      const existing = await repo.getCase(req.params.id);
      const deleted = await repo.deleteCase(req.params.id);
      if (!deleted) {
        fail(res, 404, "用例不存在");
        return;
      }
      if (existing) logActivity(req, existing.projectId, "edit", `删除用例 ${existing.caseNo} · ${existing.title}`);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "删除自动化用例");
    }
  });

  /** 编译功能用例 → CompiledPlan（带缓存；执行服务在后续阶段消费该产物）。 */
  app.post("/api/automation/compile", async (req, res) => {
    try {
      const b = body(req);
      const title = asString(b.title);
      const steps = asString(b.steps);
      const expectedResult = asString(b.expectedResult);
      if (!title?.trim() || !steps?.trim() || !expectedResult?.trim()) {
        fail(res, 400, "title、steps、expectedResult 不能为空");
        return;
      }
      const env = typeof b.env === "object" && b.env !== null ? (b.env as Record<string, unknown>) : {};
      const envEntryUrl = asString(env.entryUrl);
      if (envEntryUrl && !isHttpUrl(envEntryUrl)) {
        fail(res, 400, "env.entryUrl 仅支持 http/https 协议");
        return;
      }
      const envVariables = parseVarDefs(env.variables);
      if (!envVariables) {
        fail(res, 400, "env.variables 必须是键名合法、值全为字符串的对象");
        return;
      }
      const aiConfig = await resolveConfig(req, b);
      const callChat = (messages: ChatMessage[]) =>
        callChatCompletion(aiConfig, { messages, maxTokens: 8192 });
      const result = await compileFunctionalCase(
        {
          caseRef: asString(b.caseRef) ?? title.trim(),
          title: title.trim(),
          precondition: asString(b.precondition) ?? "",
          steps,
          expectedResult,
          env: {
            entryUrl: envEntryUrl ?? undefined,
            appBrief: asString(env.appBrief) ?? undefined,
            variables: envVariables,
          },
        },
        { callChat, cache: repo },
      );
      res.json({ success: true, data: result });
    } catch (err) {
      handleError(res, err, "编译功能用例");
    }
  });

  // ── 运行 ────────────────────────────────────────────────────────────────

  /** 发起一次用例执行（异步，返回 runId；进度走 SSE）。 */
  app.post("/api/automation/runs", async (req, res) => {
    try {
      const engine = automationEngineStatus();
      if (!engine.ready) {
        fail(res, 503, `执行引擎不可用：${engine.reason}`);
        return;
      }
      const b = body(req);
      const caseId = asString(b.caseId);
      if (!caseId) {
        fail(res, 400, "caseId 不能为空");
        return;
      }
      let automationCase = await repo.getCase(caseId);
      if (!automationCase) {
        fail(res, 404, "用例不存在");
        return;
      }
      // 首跑编译（P3）：plan-proposal 用例先用提案文本补全真实步骤
      const aiConfig = await resolveOptionalConfig(req, b);
      automationCase = await ensureCompiled(automationCase, aiConfig);
      if (automationCase.executable === "manual") {
        fail(res, 409, "该用例无可自动执行步骤（需人工），不能发起执行");
        return;
      }
      const entryUrlOverride = asString(b.entryUrl);
      if (entryUrlOverride && !isHttpUrl(entryUrlOverride)) {
        fail(res, 400, "entryUrl 仅支持 http/https 协议");
        return;
      }
      const engineMode = b.engine !== undefined ? (isEnum(b.engine, ["auto", "visual"] as const) ? b.engine : null) : undefined;
      if (engineMode === null) {
        fail(res, 400, "engine 必须是 auto|visual");
        return;
      }
      const record = await runManager.startRun({
        kind: "case",
        automationCase: entryUrlOverride ? { ...automationCase, entryUrl: entryUrlOverride } : automationCase,
        engine: engineMode,
        useCache: b.useCache !== false,
        environmentId: await resolveRunEnvironment(automationCase.projectId, asString(b.environmentId)),
        onDone: rootCauseOnDone(aiConfig),
      });
      logActivity(req, automationCase.projectId, "run", `执行 ${automationCase.caseNo} · ${automationCase.title}`);
      res.json({ success: true, data: record });
    } catch (err) {
      handleError(res, err, "发起执行");
    }
  });

  /** 按用例 ID 批量执行（Run All / 批量勾选 / 重跑失败共用；共 batchId，跳过需人工项）。 */
  app.post("/api/automation/runs/batch", async (req, res) => {
    try {
      const engine = automationEngineStatus();
      if (!engine.ready) {
        fail(res, 503, `执行引擎不可用：${engine.reason}`);
        return;
      }
      const b = body(req) as JsonObject;
      const rawIds: unknown = b.caseIds;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        fail(res, 400, "caseIds 不能为空");
        return;
      }
      const caseIds = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
      const engineMode = b.engine !== undefined ? (isEnum(b.engine, ["auto", "visual"] as const) ? b.engine : null) : undefined;
      if (engineMode === null) {
        fail(res, 400, "engine 必须是 auto|visual");
        return;
      }
      const aiConfig = await resolveOptionalConfig(req, b);
      const result = await startCaseBatch(caseIds, {
        aiConfig,
        engine: engineMode,
        useCache: b.useCache !== false,
        environmentId: asString(b.environmentId),
        trigger: "批量执行",
        actor: req.authUser?.username,
      });
      if (result.runs.length === 0) {
        fail(res, 409, result.failed.length > 0 ? `批量执行失败：${result.failed[0].error}` : "没有可执行的用例（均需人工）");
        return;
      }
      res.json({ success: true, data: { ...result, started: result.runs.length } });
    } catch (err) {
      handleError(res, err, "批量执行");
    }
  });

  app.get("/api/automation/runs", async (req, res) => {
    try {
      const caseId = typeof req.query.caseId === "string" ? req.query.caseId : undefined;
      // limit 夹取：NaN/负数/超大值回落到安全范围（评审 LOW-13）
      const parsed = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
      res.json({ success: true, data: await runManager.listRuns(caseId, limit) });
    } catch (err) {
      handleError(res, err, "列出运行");
    }
  });

  app.get("/api/automation/runs/:id", async (req, res) => {
    try {
      // 完成态以持久化为准（根因等后置字段只落库，内存副本可能滞后）；进行中读内存
      const live = runManager.getRun(req.params.id);
      const record = live && live.status !== "done" ? live : ((await repo.getRunRecord(req.params.id)) ?? live);
      if (!record) {
        fail(res, 404, "运行不存在");
        return;
      }
      res.json({ success: true, data: record });
    } catch (err) {
      handleError(res, err, "获取运行");
    }
  });

  app.post("/api/automation/runs/:id/abort", (req, res) => {
    const aborted = runManager.abortRun(req.params.id);
    if (!aborted) {
      fail(res, 409, "运行不存在或已结束");
      return;
    }
    res.json({ success: true });
  });

  /** SSE 直播：缓冲回放（截图只最新一帧）+ 实时进度。 */
  app.get("/api/automation/runs/:id/events", async (req, res) => {
    const record = runManager.getRun(req.params.id);
    if (!record) {
      // 内存已被 TTL 逐出/进程重启：历史运行合成 status+verdict 两条回放事件（评审 LOW-14）
      const persisted = await repo.getRunRecord(req.params.id).catch(() => null);
      if (!persisted) {
        fail(res, 404, "运行不存在");
        return;
      }
      beginSse(res);
      emit(res, "run-event", { kind: "status", status: "done", at: persisted.finishedAt ?? persisted.createdAt });
      if (persisted.verdict) {
        emit(res, "run-event", { kind: "verdict", verdict: persisted.verdict, durationMs: persisted.durationMs ?? 0, reportFile: persisted.reportFile, at: persisted.finishedAt ?? persisted.createdAt });
      }
      endSse(res, true);
      return;
    }
    beginSse(res);
    const unsubscribe = runManager.subscribe(req.params.id, (event) => {
      emit(res, "run-event", event);
    });
    let ended = false;
    const endOnce = (ok: boolean) => {
      if (ended) return;
      ended = true;
      unsubscribe();
      endSse(res, ok);
    };
    // 已完成的运行回放完直接收尾；进行中的等 verdict 事件收尾
    if (record.status === "done") {
      endOnce(true);
      return;
    }
    const stopAtVerdict = runManager.subscribe(req.params.id, (event) => {
      if (event.kind === "verdict" || (event.kind === "status" && event.status === "done")) {
        stopAtVerdict();
        endOnce(true);
      }
    });
    req.on("close", () => {
      stopAtVerdict();
      ended = true;
      unsubscribe();
    });
  });

  /** Midscene 原生 HTML 报告（前端 iframe 嵌入，票据 06）。 */
  app.get("/api/automation/runs/:id/report", async (req, res) => {
    try {
      const record = runManager.getRun(req.params.id) ?? (await repo.getRunRecord(req.params.id));
      if (!record?.reportFile) {
        fail(res, 404, "报告不存在");
        return;
      }
      const runDir = resolve(automationRunDir());
      const reportPath = resolve(record.reportFile);
      // relative 前缀边界 + 双方小写归一（兼容 Windows 盘符/大小写，评审 M7）
      const rel = relative(runDir.toLowerCase(), reportPath.toLowerCase());
      const insideRunDir = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      if (!insideRunDir || !reportPath.toLowerCase().endsWith(".html")) {
        fail(res, 403, "非法报告路径");
        return;
      }
      res.sendFile(reportPath);
    } catch (err) {
      handleError(res, err, "获取运行报告");
    }
  });

  /** P4 Agent Action View：站点图聚合（节点=页面 URL，触点/失败热点/帧数；边=页面转移）。 */
  app.get("/api/automation/runs/:id/page-map", async (req, res) => {
    try {
      const record = runManager.getRun(req.params.id) ?? (await repo.getRunRecord(req.params.id));
      if (!record) {
        fail(res, 404, "运行不存在");
        return;
      }
      const insight =
        (await readRunInsight(automationRunDir(), record.id).catch(() => null)) ??
        { pageTrail: record.pageTrail ?? [], frames: record.fastFrames ?? [] };
      res.json({ success: true, data: buildPageMap(insight, record.stepResults) });
    } catch (err) {
      handleError(res, err, "获取站点图");
    }
  });

  /** P4 帧画廊：节点页面的回放帧（截图 data URI）；node 缺省返回全部帧。 */
  app.get("/api/automation/runs/:id/frames", async (req, res) => {
    try {
      const record = runManager.getRun(req.params.id) ?? (await repo.getRunRecord(req.params.id));
      if (!record) {
        fail(res, 404, "运行不存在");
        return;
      }
      const insight =
        (await readRunInsight(automationRunDir(), record.id).catch(() => null)) ??
        { pageTrail: record.pageTrail ?? [], frames: record.fastFrames ?? [] };
      const node = typeof req.query.node === "string" ? req.query.node : undefined;
      const frames = insight.frames
        .filter((f) => !node || (f.url ?? "").split("#")[0] === node)
        .map((f) => ({
          stepId: f.stepId,
          at: f.at,
          phase: f.phase,
          operation: f.operation,
          targetLabel: f.targetLabel,
          reason: f.reason,
          durationMs: f.durationMs,
          screenshot: f.screenshot
            ? f.screenshot.startsWith("data:")
              ? f.screenshot
              : `data:image/jpeg;base64,${f.screenshot}`
            : "",
        }));
      res.json({ success: true, data: { frames } });
    } catch (err) {
      handleError(res, err, "获取回放帧");
    }
  });

  /** P4 AI 根因（按需补生成）：请求带 AI 配置，生成后落库并返回。 */
  app.post("/api/automation/runs/:id/root-cause", async (req, res) => {
    try {
      const record = runManager.getRun(req.params.id) ?? (await repo.getRunRecord(req.params.id));
      if (!record) {
        fail(res, 404, "运行不存在");
        return;
      }
      if (record.verdict !== "failed") {
        fail(res, 409, "仅失败运行需要生成根因");
        return;
      }
      const aiConfig = await resolveOptionalConfig(req, body(req) as JsonObject);
      if (!aiConfig) {
        fail(res, 400, "需要 AI 配置（aiConfig 或 cloudConfigId）");
        return;
      }
      res.json({ success: true, data: await generateAndPersistRootCause(record, aiConfig) });
    } catch (err) {
      handleError(res, err, "生成根因");
    }
  });

  /** 功能用例直跑：编译（带缓存）→ 执行 → 结果回写用例集 executionStatus。 */
  app.post("/api/automation/run-functional", async (req, res) => {
    try {
      const engine = automationEngineStatus();
      if (!engine.ready) {
        fail(res, 503, `执行引擎不可用：${engine.reason}`);
        return;
      }
      const b = body(req);
      const testSetId = asString(b.testSetId);
      const caseId = asString(b.caseId);
      if (!testSetId || !caseId) {
        fail(res, 400, "testSetId 与 caseId 不能为空");
        return;
      }
      const testSet = sharedTestCaseStore.getTestSet(testSetId);
      const testCase = sharedTestCaseStore.getTestCase(caseId, testSetId);
      if (!testSet || !testCase) {
        fail(res, 404, "用例集或用例不存在");
        return;
      }
      const entryUrl = asString(b.entryUrl);
      if (!entryUrl || !isHttpUrl(entryUrl)) {
        fail(res, 400, "必须提供 http/https 的入口地址 entryUrl（用例文本不含 URL）");
        return;
      }
      const aiConfig = await resolveConfig(req, b);
      const callChat = (messages: ChatMessage[]) => callChatCompletion(aiConfig, { messages, maxTokens: 8192 });
      const compiled = await compileFunctionalCase(
        {
          caseRef: testCase.caseId || caseId,
          title: testCase.title,
          precondition: testCase.precondition,
          steps: testCase.steps,
          expectedResult: testCase.expectedResult,
          env: { entryUrl },
        },
        { callChat, cache: repo },
      );
      if (compiled.plan.executable === "manual") {
        fail(res, 409, "编译后无可自动执行步骤（需人工），未发起执行");
        return;
      }
      const record = await runManager.startRun({
        kind: "plan",
        plan: compiled.plan,
        entryUrl,
        cacheId: `functional-${testSetId}`,
        onDone: async (done) => {
          // verdict → testcase 执行状态：passed→passed；partial→blocked（部分通过·含人工项）；failed→failed；aborted→blocked
          const status = done.verdict === "passed" ? "passed" : done.verdict === "failed" ? "failed" : "blocked";
          const note =
            done.verdict === "partial"
              ? `部分通过：${done.manualItems.length} 项人工项未执行`
              : done.verdict === "aborted"
                ? "执行被中止"
                : (done.error ?? "");
          const latest = sharedTestCaseStore.getTestSet(testSetId);
          if (!latest) return;
          sharedTestCaseStore.upsertTestSet({
            ...latest,
            executionStatus: {
              ...(latest.executionStatus ?? {}),
              [caseId]: { status, note, updatedAt: done.finishedAt ?? new Date().toISOString() },
            },
          });
        },
      });
      res.json({ success: true, data: { run: record, compile: { executable: compiled.plan.executable, usedFallback: compiled.usedFallback, cacheHit: compiled.cacheHit, validationErrors: compiled.validationErrors } } });
    } catch (err) {
      handleError(res, err, "功能用例直跑");
    }
  });

  // ── 需求导入：测试条件 → 生成功能用例集 → 回写 RTM → 批量编译落库 ──────────

  /** 发起需求导入（后台编排，立即返回 importId）。 */
  app.post("/api/automation/import-from-requirement", async (req, res) => {
    try {
      const b = body(req);
      const recordId = asString(b.recordId);
      const projectId = asString(b.projectId);
      const entryUrl = asString(b.entryUrl);
      const conditionIds = b.conditionIds;
      if (!recordId) {
        fail(res, 400, "recordId 不能为空");
        return;
      }
      if (!projectId) {
        fail(res, 400, "projectId 不能为空");
        return;
      }
      if (!Array.isArray(conditionIds) || conditionIds.length === 0 || !conditionIds.every((v) => typeof v === "string")) {
        fail(res, 400, "conditionIds 必须是非空字符串数组");
        return;
      }
      if (!entryUrl || !isHttpUrl(entryUrl)) {
        fail(res, 400, "必须提供 http/https 的入口地址 entryUrl（用例文本不含 URL）");
        return;
      }
      // 云端引用：aiConfig 解析出内存态明文供编译用；aiConfigRef 让生成任务 request 只留引用（不落密钥）。
      const cloudConfigId = cloudConfigIdOf(b);
      const job = importManager.startImport({
        recordId,
        conditionIds: conditionIds as string[],
        projectId,
        setId: asString(b.setId) ?? undefined,
        entryUrl,
        testType: asString(b.testType) ?? undefined,
        language: asString(b.language) ?? undefined,
        promptPreset: asString(b.promptPreset) ?? undefined,
        aiConfig: await resolveConfig(req, b),
        aiConfigRef: cloudConfigId && req.authUser?.id ? { cloudConfigId, userId: req.authUser.id } : undefined,
      });
      res.json({ success: true, data: { importId: job.id } });
    } catch (err) {
      handleError(res, err, "发起需求导入");
    }
  });

  /** 导入任务现状（断线后可查最终汇总）。 */
  app.get("/api/automation/import-jobs/:id", (req, res) => {
    const job = importManager.getJob(req.params.id);
    if (!job) {
      fail(res, 404, "导入任务不存在");
      return;
    }
    res.json({ success: true, data: job });
  });

  /** 导入进度直播：先回放缓冲再挂直播；done/error 发 end 让前端 close（避免重连回放死循环）。 */
  app.get("/api/automation/import-jobs/:id/events", (req, res) => {
    const id = req.params.id;
    if (!importManager.getJob(id)) {
      fail(res, 404, "导入任务不存在");
      return;
    }
    beginSse(res);
    let closed = false;
    const close = (ok: boolean): void => {
      if (closed) return;
      closed = true;
      endSse(res, ok);
    };
    // 回放段可能同步触发 done/error，此时返回值尚未拿到——结束后再退订
    const off = importManager.subscribe(id, (event) => {
      emit(res, "import-event", event);
      if (event.kind === "done") close(true);
      if (event.kind === "error") close(false);
    });
    if (closed) off();
    res.on("close", () => {
      closed = true;
      off();
    });
  });

  // ── 探源（站点探索，P2）────────────────────────────────────────────────────

  /** 服务重启后遗留的 running 源：无在跑任务即改判失败（防僵尸进行中徽章）。 */
  const normalizeStaleSource = async (source: ExploreSource): Promise<ExploreSource> => {
    if (source.status !== "running" || exploreManager.isActive(source.id)) return source;
    const updated = await repo.updateSource(source.id, {
      status: "failed",
      error: "服务重启，探索中断",
      finishedAt: new Date().toISOString(),
    });
    return updated ?? source;
  };

  /** 发起探源（后台 BFS 爬站，立即返回 sourceId）。 */
  app.post("/api/automation/explore/sources", async (req, res) => {
    try {
      const b = body(req) as JsonObject;
      const projectId = asString(b.projectId);
      const entryUrl = asString(b.entryUrl);
      const maxPagesRaw = Number(b.maxPages);
      if (!projectId) {
        fail(res, 400, "projectId 不能为空");
        return;
      }
      if (!entryUrl || !isHttpUrl(entryUrl)) {
        fail(res, 400, "必须提供 http/https 的入口地址 entryUrl");
        return;
      }
      const maxPages = Number.isFinite(maxPagesRaw) ? Math.min(Math.max(Math.round(maxPagesRaw), 1), 50) : 50;
      // AI 配置可缺省：没有就跳过页面摘要（捕获照常）
      const hasAi = b.aiConfig !== undefined || b.ai_config !== undefined || b.cloudConfigId !== undefined;
      const source = await exploreManager.startExplore({
        projectId,
        entryUrl,
        maxPages,
        aiConfig: hasAi ? await resolveConfig(req, b) : undefined,
      });
      res.json({ success: true, data: source });
    } catch (err) {
      handleError(res, err, "发起探源");
    }
  });

  /** 项目探源记录（新→旧）。 */
  app.get("/api/automation/explore/sources", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
      if (!projectId) {
        fail(res, 400, "projectId 不能为空");
        return;
      }
      const sources = await repo.listSources(projectId);
      res.json({ success: true, data: await Promise.all(sources.map(normalizeStaleSource)) });
    } catch (err) {
      handleError(res, err, "列出探源记录");
    }
  });

  /** 探源记录详情。 */
  app.get("/api/automation/explore/sources/:id", async (req, res) => {
    try {
      const source = await repo.getSource(req.params.id);
      if (!source) {
        fail(res, 404, "探源记录不存在");
        return;
      }
      res.json({ success: true, data: await normalizeStaleSource(source) });
    } catch (err) {
      handleError(res, err, "查询探源记录");
    }
  });

  /** 捕获页列表（截图经 /pages/:id/screenshot 单独出示）。 */
  app.get("/api/automation/explore/sources/:id/pages", async (req, res) => {
    try {
      res.json({ success: true, data: await repo.listCapturedPages(req.params.id) });
    } catch (err) {
      handleError(res, err, "列出捕获页");
    }
  });

  /** 捕获页截图（jpeg）。 */
  app.get("/api/automation/explore/pages/:id/screenshot", async (req, res) => {
    try {
      const page = await repo.getCapturedPage(req.params.id);
      if (!page?.screenshotFile || !/^\d+\.jpg$/.test(page.screenshotFile)) {
        fail(res, 404, "截图不存在");
        return;
      }
      const file = join(automationExploreDir(), page.sourceId, page.screenshotFile);
      const data = await readFile(file);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(data);
    } catch (err) {
      handleError(res, err, "读取探源截图");
    }
  });

  /** 探源进度直播：先回放缓冲再挂直播；done 发 end 让前端 close（任务已结束的连上即回放收尾）。 */
  app.get("/api/automation/explore/sources/:id/events", async (req, res) => {
    const id = req.params.id;
    const source = await repo.getSource(id).catch(() => null);
    if (!source) {
      fail(res, 404, "探源任务不存在");
      return;
    }
    beginSse(res);
    let closed = false;
    const close = (ok: boolean): void => {
      if (closed) return;
      closed = true;
      endSse(res, ok);
    };
    const off = exploreManager.subscribe(id, (event) => {
      emit(res, "explore-event", event);
      if (event.kind === "done") close(true);
      if (event.kind === "error") close(false);
    });
    // 已结束（或事件已逐出）：回放段不会补 done，直接收尾防前端挂死
    if (!exploreManager.isActive(id)) close(true);
    if (closed) off();
    res.on("close", () => {
      closed = true;
      off();
    });
  });

  /** 中止探源（爬站循环在下一页前退出）。 */
  app.post("/api/automation/explore/sources/:id/abort", (req, res) => {
    const stopped = exploreManager.abort(req.params.id);
    if (!stopped) {
      fail(res, 409, "探源任务已结束或不存在");
      return;
    }
    res.json({ success: true, data: { stopped: true } });
  });

  /** 删除探源记录（连带捕获页与截图文件）。 */
  app.delete("/api/automation/explore/sources/:id", async (req, res) => {
    try {
      const removed = await repo.deleteSource(req.params.id);
      if (!removed) {
        fail(res, 404, "探源记录不存在");
        return;
      }
      await rm(join(automationExploreDir(), removed.source.id), { recursive: true, force: true }).catch(() => undefined);
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      handleError(res, err, "删除探源记录");
    }
  });

  // ── P3 规划提案 ──────────────────────────────────────────────────────────

  /** 发起规划提案生成（后台编排：捕获页 + PRD → LLM 提案 → 确定性校验落库，立即返回 jobId）。 */
  app.post("/api/automation/plan/generate", async (req, res) => {
    try {
      const b = body(req) as JsonObject;
      const projectId = asString(b.projectId);
      if (!projectId) {
        fail(res, 400, "projectId 不能为空");
        return;
      }
      const entryUrl = asString(b.entryUrl);
      if (entryUrl && !isHttpUrl(entryUrl)) {
        fail(res, 400, "entryUrl 仅支持 http/https 协议");
        return;
      }
      // 提案只能由 LLM 产出，无配置时由 resolveConfig 报错（无降级路径）
      const aiConfig = await resolveConfig(req, b);

      // 页面上下文：显式 sourceId，否则取该项目最近一次有捕获页的探源
      const explicitSource = asString(b.sourceId);
      let source: ExploreSource | null = null;
      if (explicitSource) {
        source = await repo.getSource(explicitSource);
        if (!source) {
          fail(res, 404, "探源记录不存在");
          return;
        }
      } else {
        const sources = await repo.listSources(projectId);
        source = sources.find((s) => s.pageCount > 0) ?? null;
      }
      const captured = source ? await repo.listCapturedPages(source.id) : [];
      const pages: PlanPageInput[] = captured.map((p) => ({
        url: p.url,
        title: p.title,
        aiSummary: p.aiSummary,
        elementNames: p.elements.slice(0, 12).map((e) => e.name || e.role),
      }));

      const ext = await repo.getProjectExt(projectId);
      if (pages.length === 0 && !ext.prdText.trim()) {
        fail(res, 400, "没有捕获页或 PRD：先到探源页捕获页面，或在项目设置里填写 PRD");
        return;
      }
      const job = planManager.startGenerate({
        projectId,
        sourceId: source?.id,
        entryUrl: entryUrl || source?.entryUrl || "",
        prdText: ext.prdText,
        extraInstructions: ext.extraInstructions,
        pages,
        aiConfig,
      });
      logActivity(req, projectId, "generate", "发起规划提案生成");
      res.json({ success: true, data: job });
    } catch (err) {
      handleError(res, err, "生成规划提案");
    }
  });

  /** 规划任务查询。 */
  app.get("/api/automation/plan/jobs/:id", (req, res) => {
    const job = planManager.getJob(req.params.id);
    if (!job) {
      fail(res, 404, "规划任务不存在");
      return;
    }
    res.json({ success: true, data: job });
  });

  /** 规划进度直播：回放 + 直播（plan-event）；done/error 收尾，已结束的连上即回放收尾防挂死。 */
  app.get("/api/automation/plan/jobs/:id/events", (req, res) => {
    const id = req.params.id;
    if (!planManager.getJob(id)) {
      fail(res, 404, "规划任务不存在");
      return;
    }
    beginSse(res);
    let closed = false;
    const close = (ok: boolean): void => {
      if (closed) return;
      closed = true;
      endSse(res, ok);
    };
    const off = planManager.subscribe(id, (event) => {
      emit(res, "plan-event", event);
      if (event.kind === "done") close(true);
      if (event.kind === "error") close(false);
    });
    if (!planManager.isActive(id)) close(true);
    if (closed) off();
    res.on("close", () => {
      closed = true;
      off();
    });
  });

  /** 提案列表（新批次在前）。 */
  app.get("/api/automation/plan/proposals", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
      if (!projectId) {
        fail(res, 400, "projectId 不能为空");
        return;
      }
      res.json({ success: true, data: await repo.listProposals(projectId) });
    } catch (err) {
      handleError(res, err, "列出规划提案");
    }
  });

  /** 编辑提案（评审页勾选/改写）。 */
  app.put("/api/automation/plan/proposals/:id", async (req, res) => {
    try {
      const b = body(req) as JsonObject;
      const patch: PlanProposalPatch = {};
      if (b.title !== undefined) {
        const title = asString(b.title)?.trim();
        if (!title) {
          fail(res, 400, "title 不能为空");
          return;
        }
        patch.title = title;
      }
      if (b.goal !== undefined) {
        const goal = asString(b.goal)?.trim();
        if (!goal) {
          fail(res, 400, "goal 不能为空");
          return;
        }
        patch.goal = goal;
      }
      for (const key of ["expected", "estSteps"] as const) {
        const raw: unknown = b[key];
        if (raw === undefined) continue;
        if (!Array.isArray(raw)) {
          fail(res, 400, `${key} 必须是字符串数组`);
          return;
        }
        const list = raw.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
        if (list.length === 0) {
          fail(res, 400, `${key} 至少一条`);
          return;
        }
        patch[key] = list;
      }
      if (b.priority !== undefined) {
        if (!isEnum(b.priority, ["high", "medium", "low"] as const)) {
          fail(res, 400, "priority 必须是 high|medium|low");
          return;
        }
        patch.priority = b.priority;
      }
      if (b.included !== undefined) {
        if (typeof b.included !== "boolean") {
          fail(res, 400, "included 必须是布尔值");
          return;
        }
        patch.included = b.included;
      }
      if (b.status !== undefined) {
        if (!isEnum(b.status, ["proposed", "accepted", "rejected"] as const)) {
          fail(res, 400, "status 必须是 proposed|accepted|rejected");
          return;
        }
        patch.status = b.status;
      }
      const updated = await repo.updateProposal(req.params.id, patch);
      if (!updated) {
        fail(res, 404, "提案不存在");
        return;
      }
      res.json({ success: true, data: updated });
    } catch (err) {
      handleError(res, err, "编辑规划提案");
    }
  });

  /** 删除提案。 */
  app.delete("/api/automation/plan/proposals/:id", async (req, res) => {
    try {
      const removed = await repo.deleteProposal(req.params.id);
      if (!removed) {
        fail(res, 404, "提案不存在");
        return;
      }
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      handleError(res, err, "删除规划提案");
    }
  });

  /** 评审采纳：勾选提案 → 按 useCase 建/找用例集落成用例（占位步骤），run=true 连带执行（首跑编译）。 */
  app.post("/api/automation/plan/accept", async (req, res) => {
    try {
      const b = body(req) as JsonObject;
      const rawIds: unknown = b.proposalIds;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        fail(res, 400, "proposalIds 不能为空");
        return;
      }
      const proposalIds = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
      const shouldRun = b.run === true;
      const entryUrl = asString(b.entryUrl);
      if (!entryUrl || !isHttpUrl(entryUrl)) {
        fail(res, 400, "必须提供 http/https 的入口地址 entryUrl");
        return;
      }
      const aiConfig = shouldRun ? await resolveOptionalConfig(req, b) : null;

      const created: AutomationCase[] = [];
      const skipped: string[] = [];
      const setCache = new Map<string, string>();
      for (const id of proposalIds) {
        const proposal = await repo.getProposal(id);
        if (!proposal || proposal.status !== "proposed") {
          skipped.push(id);
          continue;
        }
        let setId = setCache.get(proposal.useCase);
        if (!setId) {
          const sets = await repo.listSets(proposal.projectId);
          const existing = sets.find((s) => s.name === proposal.useCase);
          setId = existing?.id ?? (await repo.createSet({ projectId: proposal.projectId, name: proposal.useCase })).id;
          setCache.set(proposal.useCase, setId);
        }
        const automationCase = await repo.createCase({
          projectId: proposal.projectId,
          setId,
          title: proposal.title,
          source: "plan-proposal",
          entryUrl,
          preconditionText: proposal.goal,
          steps: estimatePlanSteps(proposal.estSteps, proposal.expected),
          sourceProposalId: proposal.id,
        });
        await repo.updateProposal(proposal.id, { status: "accepted", included: false });
        created.push(automationCase);
      }
      if (created.length === 0) {
        fail(res, 409, "没有可采纳的提案（均已被采纳或删除）");
        return;
      }

      const runs: RunRecord[] = [];
      let batchId: string | undefined;
      let warning: string | undefined;
      if (shouldRun) {
        if (automationEngineStatus().ready) {
          batchId = randomUUID();
          for (const automationCase of created) {
            const compiledCase = await ensureCompiled(automationCase, aiConfig);
            if (compiledCase.executable === "manual") continue;
            runs.push(
              await runManager.startRun({
                kind: "case",
                automationCase: compiledCase,
                batchId,
                useCache: true,
                environmentId: await resolveRunEnvironment(compiledCase.projectId, asString(b.environmentId)),
                onDone: rootCauseOnDone(aiConfig),
              }),
            );
          }
        } else {
          warning = "执行引擎不可用，用例已生成但未执行";
        }
      }
      if (created.length > 0) {
        const projectId = created[0]!.projectId;
        logActivity(
          req,
          projectId,
          "generate",
          `采纳提案生成 ${created.length} 条用例${runs.length > 0 ? `，并发起 ${runs.length} 条运行` : ""}`,
        );
      }
      res.json({
        success: true,
        data: { created, runs, batchId, skipped, ...(warning ? { warning } : {}) },
      });
    } catch (err) {
      handleError(res, err, "采纳规划提案");
    }
  });

  // ── 交互执行台 ───────────────────────────────────────────────────────────

  /** 创建执行台会话（打开持久浏览器到目标 URL）。 */
  app.post("/api/automation/bench/sessions", async (req, res) => {
    try {
      const engine = automationEngineStatus();
      if (!engine.ready) {
        fail(res, 503, `执行引擎不可用：${engine.reason}`);
        return;
      }
      const url = asString(body(req).url);
      if (!url || !isHttpUrl(url)) {
        fail(res, 400, "必须提供 http/https 的目标地址 url");
        return;
      }
      const session = await benchManager.create(url);
      res.json({ success: true, data: session });
    } catch (err) {
      handleError(res, err, "创建执行台会话");
    }
  });

  /** 在执行台会话中执行一条指令（同步返回事件与结果；步骤累积）。 */
  app.post("/api/automation/bench/sessions/:id/instructions", async (req, res) => {
    try {
      const b = body(req);
      const type = asString(b.type);
      const text = asString(b.text);
      if (!isEnum(type, ["act", "assert", "query"] as const)) {
        fail(res, 400, "type 必须是 act/assert/query");
        return;
      }
      if (!text?.trim()) {
        fail(res, 400, "指令文本不能为空");
        return;
      }
      const result = await benchManager.instruct(req.params.id, { type, text: text.trim() });
      res.json({ success: true, data: result });
    } catch (err) {
      handleError(res, err, "执行台指令");
    }
  });

  /** 把执行台累积步骤存为自动化用例（来源 playground）。 */
  app.post("/api/automation/bench/sessions/:id/save", async (req, res) => {
    try {
      const b = body(req);
      const projectId = asString(b.projectId);
      const title = asString(b.title);
      if (!projectId || !title?.trim()) {
        fail(res, 400, "projectId 与 title 不能为空");
        return;
      }
      const { url, steps } = benchManager.getSteps(req.params.id);
      if (steps.length === 0) {
        fail(res, 409, "会话中还没有可保存的步骤（先成功执行若干 act/assert 指令）");
        return;
      }
      const created = await repo.createCase({
        projectId,
        setId: asString(b.setId) ?? undefined,
        title: title.trim(),
        source: "playground",
        entryUrl: url,
        steps,
      });
      res.json({ success: true, data: created });
    } catch (err) {
      handleError(res, err, "存为用例");
    }
  });

  app.delete("/api/automation/bench/sessions/:id", async (req, res) => {
    try {
      const closed = await benchManager.close(req.params.id);
      if (!closed) {
        fail(res, 404, "执行台会话不存在或已过期");
        return;
      }
      res.json({ success: true, data: { closed } });
    } catch (err) {
      handleError(res, err, "关闭执行台会话");
    }
  });

  // ── 配置（模型/执行参数/凭据）───────────────────────────────────────────

  /** 模型与执行参数视图（apiKey 只回显"已设置"与尾 4 位，永不回传真实值）。 */
  app.get("/api/automation/config", (_req, res) => {
    res.json({
      success: true,
      data: {
        model: getModelConfig(),
        execution: getExecutionSettings(),
        engine: automationEngineStatus(),
        fastEngine: { ...getFastEngineConfig(), state: getFastEngineState() },
      },
    });
  });

  app.put("/api/automation/config/model", async (req, res) => {
    try {
      const b = body(req);
      const baseUrl = asString(b.baseUrl);
      const modelName = asString(b.modelName);
      const family = asString(b.family);
      if (baseUrl !== null && baseUrl !== "" && !isHttpUrl(baseUrl)) {
        fail(res, 400, "baseUrl 仅支持 http/https 协议");
        return;
      }
      saveModelConfig({
        baseUrl: baseUrl ?? undefined,
        modelName: modelName ?? undefined,
        family: family ?? undefined,
        apiKey: asString(b.apiKey) ?? undefined,
      });
      // 模型变更后重跑定位冒烟，引擎状态即时反映新配置
      try {
        const smoke = await locatingSmokeCheck();
        engineStatusOverride({ ready: true, tier: smoke.tier, smokeLatencyMs: smoke.latencyMs });
      } catch (error) {
        engineStatusOverride({ ready: false, reason: `定位冒烟失败: ${error instanceof Error ? error.message : String(error)}` });
      }
      res.json({ success: true, data: { model: getModelConfig(), engine: automationEngineStatus() } });
    } catch (err) {
      handleError(res, err, "保存模型配置");
    }
  });

  app.put("/api/automation/config/execution", (req, res) => {    const b = body(req);
    const patch: { modelTimeoutMs?: number; concurrency?: number; cacheDefault?: boolean } = {};
    if (b.modelTimeoutMs !== undefined) {
      const value = Number(b.modelTimeoutMs);
      if (!Number.isFinite(value) || value < 10_000 || value > 1_800_000) {
        fail(res, 400, "modelTimeoutMs 需在 10s–1800s 之间");
        return;
      }
      patch.modelTimeoutMs = Math.round(value);
    }
    if (b.concurrency !== undefined) {
      const value = Number(b.concurrency);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        fail(res, 400, "concurrency 需为 1–5 的整数");
        return;
      }
      patch.concurrency = value;
    }
    if (b.cacheDefault !== undefined) patch.cacheDefault = Boolean(b.cacheDefault);
    saveExecutionConfig(patch);
    res.json({ success: true, data: getExecutionSettings() });
  });

  app.put("/api/automation/config/fast-engine", (req, res) => {
    const b = body(req);
    const patch: Parameters<typeof saveFastEngineConfig>[0] = {};
    if (b.mode !== undefined) {
      if (!isEnum(b.mode, ["auto", "visual"] as const)) {
        fail(res, 400, "mode 必须是 auto|visual");
        return;
      }
      patch.mode = b.mode;
    }
    if (b.backend !== undefined) {
      if (!isEnum(b.backend, ["off", "openai", "jev", "laya"] as const)) {
        fail(res, 400, "backend 必须是 off|openai|jev|laya");
        return;
      }
      patch.backend = b.backend;
    }
    if (b.jevBaseUrl !== undefined) {
      const url = asString(b.jevBaseUrl);
      if (url && !isHttpUrl(url)) {
        fail(res, 400, "jevBaseUrl 仅支持 http/https 协议");
        return;
      }
      patch.jevBaseUrl = url ?? undefined;
    }
    if (b.layaBaseUrl !== undefined) {
      const url = asString(b.layaBaseUrl);
      if (url && !isHttpUrl(url)) {
        fail(res, 400, "layaBaseUrl 仅支持 http/https 协议");
        return;
      }
      patch.layaBaseUrl = url ?? undefined;
    }
    if (b.jevApiKey !== undefined) patch.jevApiKey = asString(b.jevApiKey) ?? undefined;
    saveFastEngineConfig(patch);
    res.json({ success: true, data: { ...getFastEngineConfig(), state: getFastEngineState() } });
  });

  /** 凭据键名列表（只键名与尾 4 位掩码）。 */
  app.get("/api/automation/credentials", (_req, res) => {
    res.json({ success: true, data: listCredentials() });
  });

  const CREDENTIAL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

  app.put("/api/automation/credentials/:name", (req, res) => {
    const name = req.params.name;
    const value = asString(body(req).value);
    if (!CREDENTIAL_NAME.test(name)) {
      fail(res, 400, "凭据键名必须是合法标识符（字母/数字/下划线，字母开头）");
      return;
    }
    if (isDeniedCredentialName(name)) {
      fail(res, 400, "该键名为系统保留（NODE_*/PATH/SECRET_* 等），禁止作为凭据名");
      return;
    }
    if (!value) {
      fail(res, 400, "value 不能为空");
      return;
    }
    setCredential(name, value);
    res.json({ success: true });
  });

  app.delete("/api/automation/credentials/:name", (req, res) => {
    const deleted = deleteCredential(req.params.name);
    if (!deleted) {
      fail(res, 404, "凭据不存在");
      return;
    }
    res.json({ success: true });
  });

  // ── P1 项目化外壳：项目聚合 / 向导 / 扩展 / 环境 / 测试附件 ───────────────

  /** 项目列表：基础信息 + 自动化用例数 + 最近一次运行结论分布。 */
  app.get("/api/automation/projects", async (_req, res) => {
    try {
      const projects = sharedTestCaseStore.listProjects();
      const [cases, runs] = await Promise.all([repo.listCases(), repo.listRunRecords(undefined, 500)]);
      const caseIdToProject = new Map(cases.map((c) => [c.id, c.projectId]));
      const data = projects.map((p) => {
        const caseCount = cases.filter((c) => c.projectId === p.id).length;
        const latest = runs.find((r) => r.caseId && caseIdToProject.get(r.caseId) === p.id);
        let lastRunStats: { passed: number; failed: number; partial: number; total: number } | undefined;
        let lastRunVerdict: RunRecord["verdict"];
        if (latest) {
          // 批次运行按批聚合，单跑按单条计
          const members = latest.batchId ? runs.filter((r) => r.batchId === latest.batchId) : [latest];
          lastRunStats = {
            passed: members.filter((r) => r.verdict === "passed").length,
            failed: members.filter((r) => r.verdict === "failed").length,
            partial: members.filter((r) => r.verdict === "partial" || r.verdict === "aborted").length,
            total: members.length,
          };
          lastRunVerdict = latest.verdict;
        }
        return {
          id: p.id,
          name: p.name,
          systemUrl: p.systemUrl ?? "",
          caseCount,
          lastRunAt: latest?.createdAt,
          lastRunVerdict,
          lastRunStats,
        };
      });
      res.json({ success: true, data });
    } catch (err) {
      handleError(res, err, "列出项目");
    }
  });

  const VIEWPORTS = new Set(["1280x720", "1440x900", "1920x1080", "375x812"]);

  function parseRunBehavior(raw: unknown): AutomationProjectExt["runBehavior"] | null {
    if (raw === undefined || raw === null) return { loginOncePerRun: false, viewport: "1920x1080", concurrency: 3 };
    if (typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const viewport = asString(r.viewport) ?? "1920x1080";
    if (!VIEWPORTS.has(viewport)) return null;
    const concurrency = Number(r.concurrency ?? 3);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) return null;
    return { loginOncePerRun: r.loginOncePerRun === true, viewport, concurrency };
  }

  /** 建项目向导：一步建项目（testcase 域）+ 扩展 + 默认环境 + 登录凭据。 */
  app.post("/api/automation/projects", async (req, res) => {
    try {
      const b = body(req);
      const name = asString(b.name)?.trim();
      const url = asString(b.url)?.trim();
      if (!name) {
        fail(res, 400, "name 不能为空");
        return;
      }
      if (!url || !isHttpUrl(url)) {
        fail(res, 400, "url 必须是 http/https 地址");
        return;
      }
      const authKind = asString(b.authKind) ?? "none";
      let auth: AutomationEnvironment["auth"] = { kind: "none" };
      const projectId = `proj_${Date.now()}`;
      if (authKind === "credentials") {
        const username = asString(b.username)?.trim();
        const password = asString(b.password);
        if (!username || !password) {
          fail(res, 400, "凭据登录需要 username 与 password");
          return;
        }
        // 凭据真实值只进服务端配置；环境里存键名（评审 H2 同防线）
        const suffix = projectId.slice(-8).toUpperCase().replace(/[^A-Z0-9]/g, "X");
        const usernameKey = `PROJ_${suffix}_USERNAME`;
        const passwordKey = `PROJ_${suffix}_PASSWORD`;
        setCredential(usernameKey, username);
        setCredential(passwordKey, password);
        auth = { kind: "credentials", usernameKey, passwordKey };
      } else if (authKind !== "none" && authKind !== "sso") {
        fail(res, 400, "authKind 必须是 credentials|none|sso");
        return;
      } else if (authKind === "sso") {
        auth = { kind: "sso" };
      }
      const runBehavior = parseRunBehavior(b.runBehavior);
      if (!runBehavior) {
        fail(res, 400, "runBehavior 非法（viewport 限预设值，concurrency 限 1-5）");
        return;
      }
      sharedTestCaseStore.upsertProject({
        id: projectId,
        name,
        description: "",
        systemUrl: url,
        iconKey: "",
        iconColor: "",
        createdAt: new Date().toISOString(),
        ownerId: null,
      });
      const ext = await repo.upsertProjectExt({
        projectId,
        extraInstructions: asString(b.extraInstructions) ?? "",
        prdText: asString(b.prdText) ?? "",
        runBehavior,
      });
      const env = await repo.createEnvironment({ projectId, name: "default", url, isDefault: true, auth });
      await repo.upsertProjectExt({ ...ext, defaultEnvId: env.id });
      res.status(201).json({ success: true, data: { projectId, environmentId: env.id } });
    } catch (err) {
      handleError(res, err, "创建项目");
    }
  });

  app.get("/api/automation/projects/:projectId/ext", async (req, res) => {
    try {
      res.json({ success: true, data: await repo.getProjectExt(req.params.projectId) });
    } catch (err) {
      handleError(res, err, "获取项目扩展");
    }
  });

  app.put("/api/automation/projects/:projectId/ext", async (req, res) => {
    try {
      const b = body(req);
      const runBehavior = parseRunBehavior(b.runBehavior);
      if (!runBehavior) {
        fail(res, 400, "runBehavior 非法（viewport 限预设值，concurrency 限 1-5）");
        return;
      }
      const existing = await repo.getProjectExt(req.params.projectId);
      const data = await repo.upsertProjectExt({
        projectId: req.params.projectId,
        defaultEnvId: b.defaultEnvId !== undefined ? (asString(b.defaultEnvId) ?? undefined) : existing.defaultEnvId,
        extraInstructions: b.extraInstructions !== undefined ? (asString(b.extraInstructions) ?? "") : existing.extraInstructions,
        prdText: b.prdText !== undefined ? (asString(b.prdText) ?? "") : existing.prdText,
        runBehavior,
      });
      res.json({ success: true, data });
    } catch (err) {
      handleError(res, err, "保存项目扩展");
    }
  });

  app.get("/api/automation/projects/:projectId/environments", async (req, res) => {
    try {
      res.json({ success: true, data: await repo.listEnvironments(req.params.projectId) });
    } catch (err) {
      handleError(res, err, "列出环境");
    }
  });

  function parseEnvironmentAuth(raw: unknown): AutomationEnvironment["auth"] | null {
    if (raw === undefined || raw === null) return { kind: "none" };
    if (typeof raw !== "object" || Array.isArray(raw)) return null;
    const a = raw as Record<string, unknown>;
    if (a.kind === "none" || a.kind === "sso") return { kind: a.kind };
    if (a.kind === "credentials") {
      const usernameKey = asString(a.usernameKey);
      const passwordKey = asString(a.passwordKey);
      if (!usernameKey || !passwordKey) return null;
      if (!CREDENTIAL_NAME.test(usernameKey) || !CREDENTIAL_NAME.test(passwordKey)) return null;
      return { kind: "credentials", usernameKey, passwordKey };
    }
    return null;
  }

  app.post("/api/automation/projects/:projectId/environments", async (req, res) => {
    try {
      const b = body(req);
      const name = asString(b.name)?.trim();
      const url = asString(b.url)?.trim();
      if (!name) {
        fail(res, 400, "name 不能为空");
        return;
      }
      if (!url || !isHttpUrl(url)) {
        fail(res, 400, "url 必须是 http/https 地址");
        return;
      }
      const auth = parseEnvironmentAuth(b.auth);
      if (!auth) {
        fail(res, 400, "auth 非法（kind: credentials|none|sso；credentials 需合法键名）");
        return;
      }
      const isFirst = (await repo.listEnvironments(req.params.projectId)).length === 0;
      const created = await repo.createEnvironment({
        projectId: req.params.projectId,
        name,
        url,
        isDefault: b.isDefault === true || isFirst,
        auth,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      handleError(res, err, "新建环境");
    }
  });

  app.put("/api/automation/environments/:id", async (req, res) => {
    try {
      const b = body(req);
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) {
        const name = asString(b.name)?.trim();
        if (!name) {
          fail(res, 400, "name 不能为空");
          return;
        }
        patch.name = name;
      }
      if (b.url !== undefined) {
        const url = asString(b.url)?.trim();
        if (!url || !isHttpUrl(url)) {
          fail(res, 400, "url 必须是 http/https 地址");
          return;
        }
        patch.url = url;
      }
      if (b.auth !== undefined) {
        const auth = parseEnvironmentAuth(b.auth);
        if (!auth) {
          fail(res, 400, "auth 非法");
          return;
        }
        patch.auth = auth;
      }
      const updated = await repo.updateEnvironment(req.params.id, patch);
      if (!updated) {
        fail(res, 404, "环境不存在");
        return;
      }
      res.json({ success: true, data: updated });
    } catch (err) {
      handleError(res, err, "更新环境");
    }
  });

  app.delete("/api/automation/environments/:id", async (req, res) => {
    try {
      const deleted = await repo.deleteEnvironment(req.params.id);
      if (!deleted) {
        fail(res, 404, "环境不存在");
        return;
      }
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "删除环境");
    }
  });

  app.post("/api/automation/environments/:id/default", async (req, res) => {
    try {
      const b = body(req);
      const projectId = asString(b.projectId);
      if (!projectId) {
        fail(res, 400, "projectId 不能为空");
        return;
      }
      await repo.setDefaultEnvironment(projectId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "设为默认环境");
    }
  });

  const MAX_TEST_FILE_BYTES = 10 * 1024 * 1024;

  app.get("/api/automation/projects/:projectId/test-files", async (req, res) => {
    try {
      const files = (await repo.listTestFiles(req.params.projectId)).map((f) => ({ ...f, path: undefined }));
      res.json({ success: true, data: files });
    } catch (err) {
      handleError(res, err, "列出测试附件");
    }
  });

  /** 上传测试附件（base64 JSON，10MB 上限——express.json 全局上限 20MB 内）。 */
  app.post("/api/automation/projects/:projectId/test-files", async (req, res) => {
    try {
      const b = body(req);
      const filename = asString(b.filename)?.trim();
      const contentBase64 = asString(b.contentBase64);
      if (!filename || !contentBase64) {
        fail(res, 400, "filename 与 contentBase64 不能为空");
        return;
      }
      const buffer = Buffer.from(contentBase64, "base64");
      if (buffer.length === 0 || buffer.length > MAX_TEST_FILE_BYTES) {
        fail(res, 400, "文件大小超限（最大 10MB）或内容不是合法 base64");
        return;
      }
      const safeName = basename(filename).replace(/[^\w.一-鿿-]+/g, "_");
      const id = randomUUID();
      const dir = resolve(automationRunDir(), "..", "automation-files", req.params.projectId);
      await mkdir(dir, { recursive: true });
      const filePath = resolve(dir, `${id}-${safeName}`);
      await writeFile(filePath, buffer);
      const created = await repo.addTestFile({ projectId: req.params.projectId, filename: safeName, path: filePath, size: buffer.length });
      res.status(201).json({ success: true, data: { ...created, path: undefined } });
    } catch (err) {
      handleError(res, err, "上传测试附件");
    }
  });

  app.delete("/api/automation/test-files/:id", async (req, res) => {
    try {
      const deleted = await repo.deleteTestFile(req.params.id);
      if (!deleted) {
        fail(res, 404, "附件不存在");
        return;
      }
      await unlink(deleted.path).catch(() => undefined);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "删除测试附件");
    }
  });

  // ── P5 Test Lists / Schedules ────────────────────────────────────────────

  /** 列表详情：成员项带用例摘要（已删用例留 null 占位）+ 定时（带中文描述）。 */
  const listDetail = async (id: string) => {
    const list = await repo.getTestList(id);
    if (!list) return null;
    const [items, schedules] = await Promise.all([repo.listTestListItems(id), repo.listSchedules(id)]);
    return {
      ...list,
      items: await Promise.all(
        items.map(async (item) => {
          const found = await repo.getCase(item.caseId);
          return {
            ...item,
            case: found
              ? { id: found.id, caseNo: found.caseNo, title: found.title, projectId: found.projectId, entryUrl: found.entryUrl, lastRunStatus: found.lastRunStatus }
              : null,
          };
        }),
      ),
      schedules: schedules.map((s) => ({ ...s, cronText: describeCron(s.cron) })),
    };
  };

  app.get("/api/automation/test-lists", async (_req, res) => {
    try {
      const lists = await repo.listTestLists();
      const data = await Promise.all(
        lists.map(async (list) => ({
          ...list,
          itemCount: (await repo.listTestListItems(list.id)).length,
          scheduleCount: (await repo.listSchedules(list.id)).filter((s) => s.enabled).length,
        })),
      );
      res.json({ success: true, data });
    } catch (err) {
      handleError(res, err, "列出用例集列表");
    }
  });

  app.get("/api/automation/test-lists/:id", async (req, res) => {
    try {
      const detail = await listDetail(req.params.id);
      if (!detail) {
        fail(res, 404, "用例集列表不存在");
        return;
      }
      res.json({ success: true, data: detail });
    } catch (err) {
      handleError(res, err, "获取用例集列表");
    }
  });

  app.post("/api/automation/test-lists", async (req, res) => {
    try {
      const b = body(req);
      const name = asString(b.name)?.trim();
      if (!name) {
        fail(res, 400, "name 不能为空");
        return;
      }
      const list = await repo.createTestList({ name, description: asString(b.description) ?? "" });
      const caseIds = Array.isArray(b.caseIds) ? b.caseIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
      for (const caseId of caseIds) await repo.addTestListItem({ listId: list.id, caseId });
      res.status(201).json({ success: true, data: await listDetail(list.id) });
    } catch (err) {
      handleError(res, err, "创建用例集列表");
    }
  });

  app.delete("/api/automation/test-lists/:id", async (req, res) => {
    try {
      const deleted = await repo.deleteTestList(req.params.id);
      if (!deleted) {
        fail(res, 404, "用例集列表不存在");
        return;
      }
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "删除用例集列表");
    }
  });

  app.post("/api/automation/test-lists/:id/items", async (req, res) => {
    try {
      const list = await repo.getTestList(req.params.id);
      if (!list) {
        fail(res, 404, "用例集列表不存在");
        return;
      }
      const caseId = asString(body(req).caseId);
      if (!caseId) {
        fail(res, 400, "caseId 不能为空");
        return;
      }
      if (!(await repo.getCase(caseId))) {
        fail(res, 404, "用例不存在");
        return;
      }
      await repo.addTestListItem({ listId: list.id, caseId });
      res.json({ success: true, data: await listDetail(list.id) });
    } catch (err) {
      handleError(res, err, "添加用例到列表");
    }
  });

  app.delete("/api/automation/test-lists/items/:itemId", async (req, res) => {
    try {
      const removed = await repo.removeTestListItem(req.params.itemId);
      if (!removed) {
        fail(res, 404, "列表项不存在");
        return;
      }
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "移除列表项");
    }
  });

  /** 整集执行（Run List）：共 batchId 逐个发起，失败继续；body 可带 aiConfig/engine。 */
  app.post("/api/automation/test-lists/:id/run", async (req, res) => {
    try {
      const engine = automationEngineStatus();
      if (!engine.ready) {
        fail(res, 503, `执行引擎不可用：${engine.reason}`);
        return;
      }
      const b = body(req) as JsonObject;
      const list = await repo.getTestList(req.params.id);
      if (!list) {
        fail(res, 404, "用例集列表不存在");
        return;
      }
      const items = await repo.listTestListItems(list.id);
      if (items.length === 0) {
        fail(res, 409, "列表为空，无可执行用例");
        return;
      }
      const engineMode = b.engine !== undefined ? (isEnum(b.engine, ["auto", "visual"] as const) ? b.engine : null) : undefined;
      if (engineMode === null) {
        fail(res, 400, "engine 必须是 auto|visual");
        return;
      }
      const aiConfig = await resolveOptionalConfig(req, b);
      const result = await startCaseBatch(items.map((item) => item.caseId), {
        aiConfig,
        engine: engineMode,
        useCache: b.useCache !== false,
        environmentId: asString(b.environmentId),
        trigger: `Test List「${list.name}」整集执行`,
        actor: req.authUser?.username,
      });
      if (result.runs.length === 0) {
        fail(res, 409, result.failed.length > 0 ? `整集执行失败：${result.failed[0].error}` : "没有可执行的用例（均需人工）");
        return;
      }
      res.json({ success: true, data: { ...result, started: result.runs.length } });
    } catch (err) {
      handleError(res, err, "整集执行");
    }
  });

  /** Make a list from last run：把一次运行（批次运行则整组）的用例收进新列表。 */
  app.post("/api/automation/test-lists/from-run", async (req, res) => {
    try {
      const runId = asString(body(req).runId);
      if (!runId) {
        fail(res, 400, "runId 不能为空");
        return;
      }
      const run = await repo.getRunRecord(runId);
      if (!run) {
        fail(res, 404, "运行不存在");
        return;
      }
      const runs = run.batchId ? await repo.listRunsByBatch(run.batchId) : [run];
      const caseIds = [...new Set(runs.map((r) => r.caseId).filter((id): id is string => typeof id === "string" && id.length > 0))];
      if (caseIds.length === 0) {
        fail(res, 409, "该运行没有关联用例（plan 直跑不支持建列表）");
        return;
      }
      const stamp = new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const list = await repo.createTestList({
        name: `运行 #${run.id.slice(0, 8)} 回归集 ${stamp}`,
        description: `来自运行 ${run.caseNo} · ${run.title}`,
      });
      for (const caseId of caseIds) await repo.addTestListItem({ listId: list.id, caseId });
      res.status(201).json({ success: true, data: await listDetail(list.id) });
    } catch (err) {
      handleError(res, err, "从运行建列表");
    }
  });

  // ── Schedules ────────────────────────────────────────────────────────────

  app.get("/api/automation/schedules", async (req, res) => {
    try {
      const listId = typeof req.query.listId === "string" ? req.query.listId : undefined;
      const schedules = await repo.listSchedules(listId);
      res.json({ success: true, data: schedules.map((s) => ({ ...s, cronText: describeCron(s.cron) })) });
    } catch (err) {
      handleError(res, err, "列出定时");
    }
  });

  app.post("/api/automation/schedules", async (req, res) => {
    try {
      const b = body(req);
      const listId = asString(b.listId);
      const cron = asString(b.cron)?.trim();
      if (!listId || !cron) {
        fail(res, 400, "listId 与 cron 不能为空");
        return;
      }
      if (!(await repo.getTestList(listId))) {
        fail(res, 404, "用例集列表不存在");
        return;
      }
      const cronError = validateCron(cron);
      if (cronError) {
        fail(res, 400, `cron 不合法：${cronError}`);
        return;
      }
      const created = await repo.createSchedule({ listId, cron, enabled: b.enabled !== false });
      res.status(201).json({ success: true, data: { ...created, cronText: describeCron(created.cron) } });
    } catch (err) {
      handleError(res, err, "创建定时");
    }
  });

  app.patch("/api/automation/schedules/:id", async (req, res) => {
    try {
      const b = body(req);
      const patch: { cron?: string; enabled?: boolean } = {};
      const cron = asString(b.cron);
      if (cron) {
        const trimmed = cron.trim();
        const cronError = validateCron(trimmed);
        if (cronError) {
          fail(res, 400, `cron 不合法：${cronError}`);
          return;
        }
        patch.cron = trimmed;
      }
      if (b.enabled !== undefined) patch.enabled = b.enabled === true;
      const updated = await repo.updateSchedule(req.params.id, patch);
      if (!updated) {
        fail(res, 404, "定时不存在");
        return;
      }
      res.json({ success: true, data: { ...updated, cronText: describeCron(updated.cron) } });
    } catch (err) {
      handleError(res, err, "更新定时");
    }
  });

  app.delete("/api/automation/schedules/:id", async (req, res) => {
    try {
      const deleted = await repo.deleteSchedule(req.params.id);
      if (!deleted) {
        fail(res, 404, "定时不存在");
        return;
      }
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "删除定时");
    }
  });

  /** 立即执行一次（不等 cron 到点）；手动触发带 aiConfig，根因生成与首跑编译与普通执行一致。 */
  app.post("/api/automation/schedules/:id/run", async (req, res) => {
    try {
      const engine = automationEngineStatus();
      if (!engine.ready) {
        fail(res, 503, `执行引擎不可用：${engine.reason}`);
        return;
      }
      const schedule = (await repo.listSchedules()).find((s) => s.id === req.params.id);
      if (!schedule) {
        fail(res, 404, "定时不存在");
        return;
      }
      const b = body(req) as JsonObject;
      const items = await repo.listTestListItems(schedule.listId);
      if (items.length === 0) {
        fail(res, 409, "列表为空，无可执行用例");
        return;
      }
      const aiConfig = await resolveOptionalConfig(req, b);
      const result = await startCaseBatch(items.map((item) => item.caseId), {
        aiConfig,
        engine: isEnum(b.engine, ["auto", "visual"] as const) ? b.engine : undefined,
        useCache: b.useCache !== false,
        trigger: `定时「${schedule.cron}」立即执行`,
        actor: req.authUser?.username,
      });
      await repo.updateSchedule(schedule.id, { lastRunAt: new Date().toISOString() }).catch(() => undefined);
      if (result.runs.length === 0) {
        fail(res, 409, result.failed.length > 0 ? `整集执行失败：${result.failed[0].error}` : "没有可执行的用例（均需人工）");
        return;
      }
      res.json({ success: true, data: { ...result, started: result.runs.length } });
    } catch (err) {
      handleError(res, err, "立即执行定时");
    }
  });

  // P5 定时扫描：分钟粒度到点触发整集执行。定时触发无用户会话，aiConfig 为 null——
  // 已编译用例照常跑，未编译提案用例按占位步骤直跑（失败继续）；unref 定时器不阻止进程退出
  // ── P6 Insights / Activity ───────────────────────────────────────────────

  /** 项目洞察：近 14 天通过率趋势 + 引擎分布 + 耗时分布 + 失败热点（聚合自项目运行）。 */
  app.get("/api/automation/projects/:projectId/insights", async (req, res) => {
    try {
      const rows = await repo.listRunsForProject(req.params.projectId);
      res.json({ success: true, data: buildInsights(rows) });
    } catch (err) {
      handleError(res, err, "计算项目洞察");
    }
  });

  /** 项目活动审计：谁/何时/触发了什么（运行/编辑/生成），新到旧。 */
  app.get("/api/automation/projects/:projectId/activity", async (req, res) => {
    try {
      const parsed = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
      res.json({ success: true, data: await repo.listActivities(req.params.projectId, limit) });
    } catch (err) {
      handleError(res, err, "列出项目活动");
    }
  });

  startScheduleScanner({
    repo,
    triggerListRun: async (listId) => {
      const items = await repo.listTestListItems(listId);
      if (items.length === 0) return;
      await startCaseBatch(items.map((item) => item.caseId), {
        aiConfig: null,
        useCache: true,
        trigger: "定时到点触发",
        actor: "系统（定时）",
      });
    },
  });
}
