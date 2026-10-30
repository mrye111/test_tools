import type { Express, Request, Response } from "express";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readFile } from 'node:fs/promises';
import { makeReport, reportHtml, type ReportSeries } from './report.js';
import { querySeries, queryErrorSamples, type MonitorService } from './monitor.js';
import { isObject, text } from "../testcase/utils.js";
import { loadtestDbMode } from "./migrate.js";
import type { RunManager } from "./run-manager.js";
import { beginSse, emit, endSse } from "../../shared/sse.js";
import {
  type CreateProjectInput,
  type LoadTestRepository,
  type UpdateProjectInput,
  MAX_ENV_VARS,
  MAX_PAYLOAD_LENGTH,
  MAX_SCRIPT_SOURCE_LENGTH,
} from "./types.js";

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_TARGET_LENGTH = 500;
const MAX_ENV_VALUE_LENGTH = 2000;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function body(req: Request): Record<string, unknown> {
  return isObject(req.body) ? req.body : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ok(res: Response, data: Record<string, unknown> = {}): void {
  res.json({ success: true, ...data });
}

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ success: false, error: message });
}

function isNotFoundError(message: string): boolean {
  return message.includes("不存在");
}

function isLimitError(message: string): boolean {
  return message.includes("已达上限");
}

/** 目标地址仅允许 http/https，且必须是合法 URL */
function parseTargetBaseUrl(value: unknown): { url?: string; error?: string } {
  const url = text(value).trim();
  if (!url) return { error: "targetBaseUrl 不能为空" };
  if (url.length > MAX_TARGET_LENGTH) return { error: `targetBaseUrl 超过 ${MAX_TARGET_LENGTH} 字上限` };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "targetBaseUrl 仅支持 http/https" };
    }
    return { url: url.replace(/\/+$/, "") };
  } catch {
    return { error: "targetBaseUrl 不是合法 URL" };
  }
}

function parseEnvVars(value: unknown): { envVars?: Record<string, string>; error?: string } {
  if (value === undefined || value === null) return { envVars: {} };
  if (!isObject(value)) return { error: "envVars 必须是对象" };
  const entries = Object.entries(value);
  if (entries.length > MAX_ENV_VARS) return { error: `envVars 最多 ${MAX_ENV_VARS} 条` };
  const envVars: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!ENV_KEY_PATTERN.test(key)) return { error: `环境变量名不合法：${key}` };
    const val = text(item);
    if (val.length > MAX_ENV_VALUE_LENGTH) return { error: `环境变量 ${key} 的值超长` };
    envVars[key] = val;
  }
  return { envVars };
}

function parseCreateInput(req: Request): { input?: CreateProjectInput; error?: string } {
  const raw = body(req);
  const name = text(raw.name).trim();
  if (!name) return { error: "name 不能为空" };
  if (name.length > MAX_NAME_LENGTH) return { error: `name 超过 ${MAX_NAME_LENGTH} 字上限` };
  const target = parseTargetBaseUrl(raw.targetBaseUrl);
  if (target.error) return { error: target.error };
  const scriptSource = text(raw.scriptSource);
  if (!scriptSource.trim()) return { error: "scriptSource 不能为空" };
  if (scriptSource.length > MAX_SCRIPT_SOURCE_LENGTH) return { error: "scriptSource 超过大小上限" };
  const payloadTemplate = raw.payloadTemplate === undefined || raw.payloadTemplate === null
    ? null
    : text(raw.payloadTemplate);
  if (payloadTemplate !== null) {
    if (payloadTemplate.length > MAX_PAYLOAD_LENGTH) return { error: "payloadTemplate 超过大小上限" };
    try {
      JSON.parse(payloadTemplate);
    } catch {
      return { error: "payloadTemplate 必须是合法 JSON" };
    }
  }
  const env = parseEnvVars(raw.envVars);
  if (env.error) return { error: env.error };
  const description = text(raw.description).trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) return { error: `description 超过 ${MAX_DESCRIPTION_LENGTH} 字上限` };
  return {
    input: {
      name,
      description,
      targetBaseUrl: target.url!,
      scriptSource,
      payloadTemplate,
      envVars: env.envVars,
    },
  };
}

function parseUpdateInput(req: Request): { input?: UpdateProjectInput; error?: string } {
  const raw = body(req);
  const input: UpdateProjectInput = {};
  if (raw.name !== undefined) {
    const name = text(raw.name).trim();
    if (!name) return { error: "name 不能为空" };
    if (name.length > MAX_NAME_LENGTH) return { error: `name 超过 ${MAX_NAME_LENGTH} 字上限` };
    input.name = name;
  }
  if (raw.description !== undefined) {
    const description = text(raw.description).trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) return { error: `description 超过 ${MAX_DESCRIPTION_LENGTH} 字上限` };
    input.description = description;
  }
  if (raw.targetBaseUrl !== undefined) {
    const target = parseTargetBaseUrl(raw.targetBaseUrl);
    if (target.error) return { error: target.error };
    input.targetBaseUrl = target.url;
  }
  if (raw.scriptSource !== undefined) {
    const scriptSource = text(raw.scriptSource);
    if (!scriptSource.trim()) return { error: "scriptSource 不能为空" };
    if (scriptSource.length > MAX_SCRIPT_SOURCE_LENGTH) return { error: "scriptSource 超过大小上限" };
    input.scriptSource = scriptSource;
  }
  if (raw.payloadTemplate !== undefined) {
    const payloadTemplate = raw.payloadTemplate === null ? null : text(raw.payloadTemplate);
    if (payloadTemplate !== null) {
      if (payloadTemplate.length > MAX_PAYLOAD_LENGTH) return { error: "payloadTemplate 超过大小上限" };
      try {
        JSON.parse(payloadTemplate);
      } catch {
        return { error: "payloadTemplate 必须是合法 JSON" };
      }
    }
    input.payloadTemplate = payloadTemplate;
  }
  if (raw.envVars !== undefined) {
    const env = parseEnvVars(raw.envVars);
    if (env.error) return { error: env.error };
    input.envVars = env.envVars;
  }
  return { input };
}

/** 目录下多个 k6 脚本时挑主入口：优先与目录同名，其次常见入口名，否则按字母序取第一个 */
export function pickMainScript(dirName: string, scriptNames: string[]): string {
  if (scriptNames.length === 0) throw new Error("目录中未找到 k6 脚本（k6/*.js）");
  const sorted = [...scriptNames].sort();
  const dirEntry = `${dirName}.js`;
  if (sorted.includes(dirEntry)) return dirEntry;
  for (const known of ["main.js", "index.js", "script.js"]) {
    if (sorted.includes(known)) return known;
  }
  return sorted[0];
}

/** data/ 下多个 JSON 时挑请求体：优先文件名含 body/payload，否则按字母序取第一个 */
export function pickPayloadFile(fileNames: string[]): string | undefined {
  if (fileNames.length === 0) return undefined;
  const sorted = [...fileNames].sort();
  return sorted.find((name) => /body|payload/i.test(name)) ?? sorted[0];
}

/** 解析旧框架项目目录（project.env + k6/*.js + data/*.json）为创建入参 */
export function importProjectFromDir(dir: string): CreateProjectInput {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`目录不存在：${dir}`);
  }
  const envVars: Record<string, string> = {};
  const envFile = join(root, "project.env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || line.trimStart().startsWith("#")) continue;
      let value = match[2];
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (ENV_KEY_PATTERN.test(match[1])) envVars[match[1]] = value;
    }
  }
  const k6Dir = join(root, "k6");
  const scriptNames = existsSync(k6Dir)
    ? readdirSync(k6Dir).filter((name) => name.endsWith(".js")).sort()
    : [];
  const scriptName = pickMainScript(basename(root), scriptNames);
  const scriptSource = readFileSync(join(k6Dir, scriptName), "utf8");
  const dataDir = join(root, "data");
  const payloadName = existsSync(dataDir)
    ? pickPayloadFile(readdirSync(dataDir).filter((name) => name.endsWith(".json")))
    : undefined;
  const payloadTemplate = payloadName ? readFileSync(join(dataDir, payloadName), "utf8") : null;
  // 旧框架的双环境键（ONLINE_/LOCAL_ 前缀）拍平为脚本实际读取的键，使导入项目的配置在界面上可改
  if (!envVars.API_BASE && envVars.ONLINE_API_BASE) envVars.API_BASE = envVars.ONLINE_API_BASE;
  if (!envVars.ORIGIN && envVars.ONLINE_ORIGIN) envVars.ORIGIN = envVars.ONLINE_ORIGIN;
  return {
    name: envVars.PROJECT_NAME || basename(root),
    description: "从目录导入",
    targetBaseUrl: envVars.ONLINE_API_BASE || envVars.API_BASE || envVars.ONLINE_ORIGIN || "",
    scriptSource,
    payloadTemplate,
    envVars,
  };
}

export interface LoadTestRouteDeps {
  runManager: RunManager;
  monitor?: MonitorService;
  workDirRoot?: string;
}

export async function getLoadTestReport(repo: LoadTestRepository, deps: LoadTestRouteDeps, runId: string) {
    const run = await repo.getRun(runId);
    if (!run) return null;
    const dir = join(deps.workDirRoot ?? '', run.id);
    let summary = null;
    let series: ReportSeries[] = [];
    let monitoring = '未采集监控数据';
    let errors: string[] = [];
    try { summary = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8')); } catch { /* old or incomplete run */ }
    try {
      const config = JSON.parse(await readFile(join(dir, 'monitor.json'), 'utf8')) as { prometheusUrl: string; targets?: string[]; loadGeneratorTarget?: string | null };
      if (run.status === 'running' && run.startedAt) {
        [series, errors] = await Promise.all([querySeries(config.prometheusUrl, run.id, run.startedAt, new Date(), config.targets), queryErrorSamples(config.prometheusUrl, run.id, new Date())]);
      } else {
        series = JSON.parse(await readFile(join(dir, 'series.json'), 'utf8')) as ReportSeries[];
        try { errors = JSON.parse(await readFile(join(dir, 'errors.json'), 'utf8')) as string[]; } catch { /* unavailable */ }
      }
      monitoring = series.length ? `Prometheus 指标已采集；${series.some(s => s.name.includes('CPU') || s.name.includes('内存')) ? '主机资源已采集' : '主机资源未采集'}` : '监控已接入，但当前无可用曲线数据';
      const loadgenIndex = config.targets?.indexOf(config.loadGeneratorTarget ?? '') ?? -1;
      const loadgen = series.filter(s => s.name.startsWith(`监控目标 ${loadgenIndex + 1} `));
      monitoring += loadgenIndex < 0 ? '；未配置压测机角色' : !loadgen.length ? '；压测机资源未采集' : loadgen.some(s => s.points.some(p => p.value >= 80)) ? '；压测机 CPU 或内存达到 80%，可能干扰压测结果' : '；已采集压测机资源';
    } catch { /* no monitoring snapshot */ }
    if (!series.some(s => s.name.includes('虚拟用户')) && run.status === 'running') {
      const points = deps.runManager.progress(run.id);
      if (points.length) series.push({ name: '虚拟用户（k6 进度）', unit: 'VU', points });
    }
    if (!series.some(s => s.name.includes('虚拟用户'))) try {
      const points = JSON.parse(await readFile(join(dir, 'progress.json'), 'utf8')) as ReportSeries['points'];
      if (points.length) series.push({ name: '虚拟用户（k6 进度）', unit: 'VU', points });
    } catch { /* no progress samples */ }
    const collecting = deps.runManager.isCollecting(run.id);
    if (collecting) monitoring += '；监控数据正在采集';
    const report = makeReport(run, summary, series, monitoring, errors, collecting);
    return report;
}

export function registerLoadTestRoutes(app: Express, repo: LoadTestRepository, deps: LoadTestRouteDeps): void {
  app.get('/api/loadtest/monitor/config', (_req, res) => ok(res, deps.monitor?.get() ?? { config: { prometheusUrl: '', targets: [] }, verified: false }));
  app.put('/api/loadtest/monitor/config', async (req, res) => {
    try { if (!deps.monitor) return fail(res, '监控不可用', 503); ok(res, await deps.monitor.set(body(req) as never)); }
    catch (error) { fail(res, errorMessage(error)); }
  });
  app.post('/api/loadtest/monitor/verify', async (_req, res) => {
    if (!deps.monitor) return fail(res, '监控不可用', 503);
    ok(res, { verification: await deps.monitor.verify() });
  });
  app.get('/api/loadtest/runs/:id/report', async (req, res) => {
    const report = await getLoadTestReport(repo, deps, req.params.id);
    if (!report) return fail(res, '压测执行不存在', 404);
    if (req.query.format === 'html') { res.type('html').attachment(`loadtest-${req.params.id}.html`).send(reportHtml(report)); return; }
    ok(res, { report });
  });
  app.get("/api/loadtest/storage-status", (_req, res) => {
    ok(res, { mode: loadtestDbMode() });
  });

  app.get("/api/loadtest/projects", async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const [projects, total] = await Promise.all([repo.listProjects(limit, offset), repo.countProjects()]);
    ok(res, { projects, total });
  });

  app.post("/api/loadtest/projects", async (req, res) => {
    const { input, error } = parseCreateInput(req);
    if (error) return fail(res, error);
    try {
      const project = await repo.createProject(input!);
      ok(res, { project });
    } catch (error) {
      const message = errorMessage(error);
      fail(res, message, isLimitError(message) ? 429 : 500);
    }
  });

  app.post("/api/loadtest/projects/import", async (req, res) => {
    const dir = text(body(req).dir).trim();
    if (!dir) return fail(res, "dir 不能为空");
    try {
      const input = importProjectFromDir(dir);
      const target = parseTargetBaseUrl(input.targetBaseUrl);
      if (target.error) return fail(res, `导入失败：${target.error}（目录内未配置 ONLINE_API_BASE/API_BASE）`);
      input.targetBaseUrl = target.url!;
      const project = await repo.createProject(input);
      ok(res, { project });
    } catch (error) {
      const message = errorMessage(error);
      fail(res, message, isLimitError(message) ? 429 : 400);
    }
  });

  app.get("/api/loadtest/projects/:id", async (req, res) => {
    const project = await repo.getProject(req.params.id);
    if (!project) return fail(res, "压测项目不存在", 404);
    ok(res, { project });
  });

  app.put("/api/loadtest/projects/:id", async (req, res) => {
    const { input, error } = parseUpdateInput(req);
    if (error) return fail(res, error);
    try {
      const project = await repo.updateProject(req.params.id, input!);
      ok(res, { project });
    } catch (error) {
      const message = errorMessage(error);
      fail(res, message, isNotFoundError(message) ? 404 : 500);
    }
  });

  app.delete("/api/loadtest/projects/:id", async (req, res) => {
    try {
      await repo.deleteProject(req.params.id);
      ok(res);
    } catch (error) {
      const message = errorMessage(error);
      fail(res, message, isNotFoundError(message) ? 404 : 500);
    }
  });

  // ── 执行 ─────────────────────────────────────────────────────────────────

  app.post("/api/loadtest/projects/:id/runs", async (req, res) => {
    const project = await repo.getProject(req.params.id);
    if (!project) return fail(res, "压测项目不存在", 404);
    const env = parseEnvVars(body(req).env);
    if (env.error) return fail(res, env.error);
    try {
      const run = await deps.runManager.enqueue(project, env.envVars ?? {});
      ok(res, { run });
    } catch (error) {
      fail(res, errorMessage(error));
    }
  });

  app.get("/api/loadtest/projects/:id/runs", async (req, res) => {
    const project = await repo.getProject(req.params.id);
    if (!project) return fail(res, "压测项目不存在", 404);
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const [runs, total] = await Promise.all([repo.listRuns(req.params.id, limit, offset), repo.countRuns(req.params.id)]);
    ok(res, { runs, total });
  });

  app.get("/api/loadtest/runs/active", (_req, res) => {
    ok(res, deps.runManager.activeRunIds());
  });

  app.get("/api/loadtest/runs/:id", async (req, res) => {
    const run = await repo.getRun(req.params.id);
    if (!run) return fail(res, "压测执行不存在", 404);
    ok(res, { run });
  });

  app.post("/api/loadtest/runs/:id/stop", async (req, res) => {
    try {
      const run = await deps.runManager.stop(req.params.id);
      ok(res, { run });
    } catch (error) {
      const message = errorMessage(error);
      fail(res, message, isNotFoundError(message) ? 404 : 400);
    }
  });

  /** SSE：执行事件流（日志行 / 状态迁移 / 摘要）。重连后自动回放缓冲。 */
  app.get("/api/loadtest/runs/:id/events", async (req, res) => {
    const run = await repo.getRun(req.params.id);
    if (!run) return fail(res, "压测执行不存在", 404);
    beginSse(res);
    const unsubscribe = deps.runManager.subscribe(run.id, (event) => {
      emit(res, event.type, event);
      if (event.type === "status" && ["succeeded", "failed", "stopped"].includes(event.status)) {
        endSse(res, event.status === "succeeded");
      }
    });
    req.on("close", unsubscribe);
  });
}
