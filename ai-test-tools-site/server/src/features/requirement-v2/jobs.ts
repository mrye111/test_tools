/** 需求分析 MCP 任务注册表：AI 分析是异步的，而 MCP 运行时同步——发起即返回 jobId，后台跑完缓存结果供查询 */

import { randomUUID } from "crypto";
import { analyzeRequirement } from "./analyze.js";
import { bootstrapRequirementV2 } from "./migrate.js";
import type { AnalysisRepository, AnalysisRecordDetail } from "./types.js";
import type { AiRequestConfig } from "../testcase/types.js";
import { logger } from "../../logger.js";

export interface AnalysisJobResult {
  recordId: string;
  title: string;
  issueCount: number;
  criterionCount: number;
  conditionCount: number;
  /** 完整分析包（聊天端直接展示用） */
  detail: AnalysisRecordDetail;
}

export interface AnalysisJob {
  id: string;
  status: "running" | "done" | "error";
  createdAt: Date;
  result?: AnalysisJobResult;
  error?: string;
}

const jobs = new Map<string, AnalysisJob>();
let repoPromise: Promise<AnalysisRepository> | null = null;

/** 仓储惰性引导：http 模式 express-app 已 bootstrap 过（共享池 memo），stdio 模式此处兜底 */
function getRepo(): Promise<AnalysisRepository> {
  if (!repoPromise) repoPromise = bootstrapRequirementV2();
  return repoPromise;
}

/** 测试钩子：注入仓储并清空任务表 */
export function __setRepoForTest(repo: AnalysisRepository): void {
  repoPromise = Promise.resolve(repo);
  jobs.clear();
}

export function getAnalysisJob(jobId: string): AnalysisJob | null {
  return jobs.get(jobId) ?? null;
}

/** 发起分析任务：立即返回 jobId，分析在后台进行 */
export function startAnalysisJob(config: AiRequestConfig, input: { sourceText: string; title?: string }): AnalysisJob {
  const job: AnalysisJob = { id: `raj_${randomUUID()}`, status: "running", createdAt: new Date() };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const repo = await getRepo();
      const record = await analyzeRequirement(config, repo, { sourceText: input.sourceText, titleHint: input.title });
      jobs.set(job.id, {
        ...job,
        status: "done",
        result: {
          recordId: record.id,
          title: record.title,
          issueCount: record.issues.length,
          criterionCount: record.criteria.length,
          conditionCount: record.conditions.length,
          detail: record,
        },
      });
    } catch (err) {
      logger.error({ err }, "[requirement-v2] MCP 分析任务失败");
      jobs.set(job.id, { ...job, status: "error", error: err instanceof Error ? err.message : "分析失败" });
    }
  })();

  return job;
}
