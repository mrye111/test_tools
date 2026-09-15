/** 需求分析 v2 的 MCP 工具：聊天端（Claude Desktop 等）直接发起/查询需求分析，不依赖系统页面 */

import type { JsonObject } from "../../jmx-serializer.js";
import { err, ok, type ToolResult } from "../../tool-result.js";
import type { McpTool } from "../../tool-registry.js";
import { parseAiRequestConfig } from "../testcase/ai.js";
import { getAnalysisJob, startAnalysisJob } from "./jobs.js";

function str(args: JsonObject, key: string, fallback = ""): string {
  const value = args[key];
  return value === undefined || value === null ? fallback : String(value);
}

/**
 * start_requirement_analysis：发起需求分析（后台执行，立即返回 jobId）。
 * 结果出来后自动入库——Web 端分析记录里同样可见、可接力。
 */
const startTool: McpTool = {
  name: "start_requirement_analysis",
  description:
    "分析需求文档（测试视角）：产出需求条目、问题日志（歧义/缺失/冲突/不可测）、可测试化验收准则与测试条件。异步执行——返回 jobId，用 get_requirement_analysis 查询结果。",
  inputSchema: {
    type: "object",
    properties: {
      sourceText: { type: "string", description: "需求文本全文（粘贴或文档内容）" },
      title: { type: "string", description: "分析记录标题（可选）" },
      baseUrl: { type: "string", description: "模型 API 地址" },
      apiKey: { type: "string", description: "模型 API Key" },
      model: { type: "string", description: "模型名" },
    },
    required: ["sourceText", "baseUrl", "apiKey", "model"],
  },
  execute: (args): ToolResult => {
    const sourceText = str(args, "sourceText").trim();
    if (!sourceText) return err("invalid-args", "sourceText 不能为空");
    let config;
    try {
      config = parseAiRequestConfig(args);
    } catch (error) {
      return err("invalid-args", error instanceof Error ? error.message : "模型配置无效（需要 baseUrl/apiKey/model）");
    }
    const job = startAnalysisJob(config, { sourceText, title: str(args, "title") || undefined });
    return ok(`分析任务已发起（jobId: ${job.id}）。用 get_requirement_analysis 查询结果。`, { jobId: job.id, status: job.status });
  },
};

/** get_requirement_analysis：查询任务状态与结果。 */
const getTool: McpTool = {
  name: "get_requirement_analysis",
  description: "查询 start_requirement_analysis 发起的分析任务。返回状态；完成后附完整分析结果（需求条目/问题日志/验收准则/测试条件）与记录 id。",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "start_requirement_analysis 返回的任务 id" },
    },
    required: ["jobId"],
  },
  execute: (args): ToolResult => {
    const jobId = str(args, "jobId").trim();
    const job = getAnalysisJob(jobId);
    if (!job) return err("not-found", `任务不存在: ${jobId}`);
    if (job.status === "running") return ok("分析进行中…", { jobId: job.id, status: "running" });
    if (job.status === "error") return err("execution-error", `${job.error ?? "分析失败"}（jobId: ${job.id}）`);
    const r = job.result!;
    return ok(
      `分析完成：${r.title}（问题 ${r.issueCount} / 准则 ${r.criterionCount} / 条件 ${r.conditionCount}），记录 id：${r.recordId}`,
      {
        jobId: job.id,
        status: "done",
        recordId: r.recordId,
        title: r.title,
        issueCount: r.issueCount,
        criterionCount: r.criterionCount,
        conditionCount: r.conditionCount,
        detail: r.detail as unknown as JsonObject,
      },
    );
  },
};

export function createRequirementV2Tools(): McpTool[] {
  return [startTool, getTool];
}
