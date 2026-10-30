/** UI 自动化域引导：仓储 + 运行环境（共享浏览器、运行目录、模型配置加载、定位冒烟、运行管理器）。 */

import { resolve } from "node:path";
import { logger } from "../../logger.js";
import { loadDotEnv } from "../../shared/db/config.js";
import { resolveSharedChatDb } from "../../shared/db/pool.js";
import { ensureSecretMasterKey } from "../../shared/secret-crypto.js";
import type { AnalysisRepository } from "../requirement-v2/types.js";
import { callChatCompletion } from "../testcase/ai.js";
import { runGenerationJob } from "../testcase/generation.js";
import { sharedTestCaseStore } from "../testcase/shared-store.js";
import { BenchManager } from "./bench-manager.js";
import { createPlaywrightSessionFactory } from "./browser-pool.js";
import { createMysqlAutomationConfigAdapter, initAutomationConfigSchema } from "./config-mysql.js";
import { applyAutomationConfig, attachAutomationConfigDb, getExecutionSettings, loadAutomationConfig, preloadAutomationConfig } from "./config-store.js";
import { ExploreManager } from "./explore/explore-manager.js";
import { getFastRunner } from "./fast-engine.js";
import { ImportManager } from "./import-manager.js";
import { MemoryAutomationRepository } from "./memory-repository.js";
import { initAutomationSchema, MysqlAutomationRepository } from "./mysql-repository.js";
import { PlanManager } from "./plan-manager.js";
import { RunManager } from "./run-manager.js";
import { locatingSmokeCheck } from "./smoke.js";
import type { AutomationRepository } from "./types.js";

let mode: "mysql" | "memory" = "memory";

export function automationDbMode(): "mysql" | "memory" {
  return mode;
}

export type EngineStatus =
  | { ready: true; tier: "disabled" | "low"; smokeLatencyMs: number }
  | { ready: false; reason: string };

let engineStatus: EngineStatus = { ready: false, reason: "尚未初始化" };

export function automationEngineStatus(): EngineStatus {
  return engineStatus;
}

/** 模型配置变更后重跑冒烟，由路由调用以更新引擎状态。 */
export function engineStatusOverride(next: EngineStatus): void {
  engineStatus = next;
  if (next.ready) {
    logger.info(`[automation] 定位冒烟通过（tier=${next.tier}, ${next.smokeLatencyMs}ms），引擎已按新配置就绪`);
  } else {
    logger.error(`[automation] 引擎降级：${next.reason}`);
  }
}

export type AutomationBootstrap = {
  repo: AutomationRepository;
  runManager: RunManager;
  benchManager: BenchManager;
  importManager: ImportManager;
  exploreManager: ExploreManager;
  planManager: PlanManager;
};

/** 运行产物目录：默认 <repo>/artifacts/automation-run（绝对路径，摆脱 cwd 依赖，票据 07 的坑）。 */
export function automationRunDir(): string {
  return process.env.AUTOMATION_RUN_DIR ?? resolve(process.cwd(), "..", "artifacts", "automation-run");
}

/** 探源截图目录（按 sourceId 分目录存 jpeg）。 */
export function automationExploreDir(): string {
  return process.env.AUTOMATION_EXPLORE_DIR ?? resolve(process.cwd(), "..", "artifacts", "automation-explore");
}

export async function bootstrapAutomation(analysisRepo: AnalysisRepository): Promise<AutomationBootstrap> {
  // server/.env → MIDSCENE_MODEL_* 等注入（key 只进进程环境，不落库不落前端）
  loadDotEnv();

  const handle = await resolveSharedChatDb();

  // automation 配置入库：MySQL 可用则读库/迁移文件（密钥字段信封存储），之后保存走库；不可用保持纯文件现状
  if (handle.pool) {
    try {
      await initAutomationConfigSchema(handle.pool);
      attachAutomationConfigDb(createMysqlAutomationConfigAdapter(handle.pool), ensureSecretMasterKey());
      await preloadAutomationConfig();
      logger.info("[automation] 配置已接入 MySQL（automation_config 单行，密钥字段信封存储）");
    } catch (error) {
      attachAutomationConfigDb(null, null);
      logger.warn({ err: error }, "[automation] 配置入库初始化失败，保持纯文件配置");
    }
  }

  // 库/文件加载的配置覆盖 .env（.env 兜底），并应用到进程环境
  applyAutomationConfig(loadAutomationConfig());
  process.env.MIDSCENE_RUN_DIR ??= automationRunDir();
  process.env.MIDSCENE_MODEL_TIMEOUT ??= "180000";

  let repo: AutomationRepository;
  if (handle.pool) {
    try {
      await initAutomationSchema(handle.pool);
      mode = "mysql";
      logger.info("[automation] MySQL 持久化已就绪（at_cases / at_compiled_cache / at_runs）");
      repo = new MysqlAutomationRepository(handle.pool);
    } catch (error) {
      logger.warn({ err: error }, "[automation] MySQL 初始化失败，降级内存仓储");
      mode = "memory";
      repo = new MemoryAutomationRepository();
    }
  } else {
    mode = "memory";
    logger.warn("[automation] 未连接 MySQL，使用内存仓储（重启即失）");
    repo = new MemoryAutomationRepository();
  }

  // 定位冒烟：模型配置缺失 → 引擎降级（拒绝执行但 CRUD 可用）；配置在 → 金丝雀验证档位
  if (!process.env.MIDSCENE_MODEL_NAME || !process.env.MIDSCENE_MODEL_API_KEY) {
    engineStatus = { ready: false, reason: "未配置 MIDSCENE_MODEL_*（server/.env）" };
    logger.warn(`[automation] ${engineStatus.reason}，执行服务不可用`);
  } else {
    try {
      const smoke = await locatingSmokeCheck();
      engineStatus = { ready: true, tier: smoke.tier, smokeLatencyMs: smoke.latencyMs };
      logger.info(`[automation] 定位冒烟通过（tier=${smoke.tier}, ${smoke.latencyMs}ms）`);
    } catch (error) {
      engineStatus = {
        ready: false,
        reason: `定位冒烟失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      logger.error({ err: error }, "[automation] 定位冒烟失败，执行服务不可用");
    }
  }

  const sessionFactory = createPlaywrightSessionFactory();
  const runManager = new RunManager({
    repo,
    sessionFactory,
    settings: getExecutionSettings(),
    fastRunner: getFastRunner(),
    runDir: automationRunDir(),
  });
  const benchManager = new BenchManager({ sessionFactory });
  // 需求导入编排：串起 requirement-v2（回写 RTM）/ testcase（生成）/ automation（编译落库）三域
  const importManager = new ImportManager({
    analysisRepo,
    automationRepo: repo,
    testcaseStore: sharedTestCaseStore,
    runGeneration: runGenerationJob,
    createChatCaller: (aiConfig) => (messages) => callChatCompletion(aiConfig, { messages, maxTokens: 8192 }),
  });
  // 探源编排（P2）：BFS 爬站 + 逐页视觉摘要，截图落 automation-explore 目录
  const exploreManager = new ExploreManager({
    repo,
    sessionFactory,
    createChatCaller: (aiConfig) => (messages) => callChatCompletion(aiConfig, { messages, maxTokens: 400 }),
    artifactDir: automationExploreDir(),
  });
  // 规划编排（P3）：捕获页 + PRD → 提案 JSON（单次调用，输出长，maxTokens 放大）
  const planManager = new PlanManager({
    automationRepo: repo,
    createChatCaller: (aiConfig) => (messages) => callChatCompletion(aiConfig, { messages, maxTokens: 8192 }),
  });
  return { repo, runManager, benchManager, importManager, exploreManager, planManager };
}
