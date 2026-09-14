import { randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
import express from "express";
import { logger } from "../../logger.js";
import { beginSse, emit, endSse } from "../../shared/sse.js";
import { parseAiRequestConfig } from "../testcase/ai.js";
import { analysisDbMode } from "./migrate.js";
import { analyzeRequirement, AnalysisGenerateError } from "./analyze.js";
import { DocumentParseError, MAX_FILE_BYTES, parseRequirementDocument } from "./parsers.js";
import type {
  AnalysisRepository,
  ConditionKind,
  CriterionStatus,
  IssueSeverity,
  IssueStatus,
  IssueType,
  RelayState,
} from "./types.js";

const ISSUE_TYPES: IssueType[] = ["ambiguity", "missing", "conflict", "untestable"];
const SEVERITIES: IssueSeverity[] = ["high", "medium", "low"];
const ISSUE_STATUSES: IssueStatus[] = ["open", "resolved", "accepted"];
const CRITERION_STATUSES: CriterionStatus[] = ["pending", "confirmed", "rejected"];
const CONDITION_KINDS: ConditionKind[] = ["normal", "boundary", "exception"];
const RELAY_STATES: RelayState[] = ["none", "relayed", "generated"];

function body(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isEnum<T extends string>(value: unknown, allowed: T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message });
}

/** 错误消息 → HTTP 状态：不存在 404，上限 409，其余 500 */
function errorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("不存在")) return 404;
  if (message.includes("已达上限")) return 409;
  return 500;
}

function handleError(res: Response, err: unknown, context: string): void {
  logger.error({ err }, `[requirement-v2] ${context} 失败`);
  fail(res, errorStatus(err), err instanceof Error ? err.message : `${context}失败`);
}

/**
 * 需求分析 v2 路由（/api/requirement-analysis-v2/）。
 * 记录 CRUD + 子资源 patch + 驳回闭环 + 接力/回写 + RTM。
 */
export function registerRequirementV2Routes(app: Express, repo: AnalysisRepository): void {
  app.get("/api/requirement-analysis-v2/storage-status", (_req, res) => {
    res.json({ success: true, mode: analysisDbMode() });
  });

  app.get("/api/requirement-analysis-v2/records", async (req, res) => {
    try {
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
      const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;
      const [records, total] = await Promise.all([repo.listRecords(limit, offset), repo.countRecords()]);
      res.json({ success: true, records, total, limit, offset });
    } catch (err) {
      handleError(res, err, "获取分析记录列表");
    }
  });

  app.get("/api/requirement-analysis-v2/records/:id", async (req, res) => {
    try {
      const detail = await repo.getRecord(req.params.id);
      if (!detail) return fail(res, 404, "分析记录不存在");
      res.json({ success: true, record: detail });
    } catch (err) {
      handleError(res, err, "获取分析记录");
    }
  });

  /** 创建记录：AI 分析落库整包。只取白名单字段（凭据类字段天然不落盘）。 */
  app.post("/api/requirement-analysis-v2/records", async (req, res) => {
    try {
      const b = body(req);
      const title = asString(b.title)?.trim();
      const sourceText = asString(b.sourceText)?.trim();
      if (!title) return fail(res, 400, "title 不能为空");
      if (!sourceText) return fail(res, 400, "sourceText 不能为空");

      const requirements = Array.isArray(b.requirements) ? b.requirements : [];
      const issues = Array.isArray(b.issues) ? b.issues : [];
      const criteria = Array.isArray(b.criteria) ? b.criteria : [];
      const conditions = Array.isArray(b.conditions) ? b.conditions : [];

      const record = await repo.createRecord({
        title,
        sourceFileName: asString(b.sourceFileName),
        sourceText,
        requirements: requirements.map((r: Record<string, unknown>, index: number) => ({
          id: asString(r.id) ?? randomUUID(),
          parentId: asString(r.parentId),
          level: typeof r.level === "number" ? r.level : 0,
          text: asString(r.text) ?? "",
          sort: typeof r.sort === "number" ? r.sort : index,
        })),
        issues: issues.map((i: Record<string, unknown>) => ({
          id: asString(i.id) ?? randomUUID(),
          reqId: asString(i.reqId),
          type: isEnum(i.type, ISSUE_TYPES) ? i.type : "ambiguity",
          severity: isEnum(i.severity, SEVERITIES) ? i.severity : "medium",
          quote: asString(i.quote) ?? "",
          description: asString(i.description) ?? "",
          suggestedQuestion: asString(i.suggestedQuestion) ?? "",
          status: "open" as const,
        })),
        criteria: criteria.map((c: Record<string, unknown>) => ({
          id: asString(c.id) ?? randomUUID(),
          reqId: asString(c.reqId) ?? "",
          originalText: asString(c.originalText) ?? "",
          rewrittenText: asString(c.rewrittenText) ?? "",
          status: "pending" as const,
        })),
        conditions: conditions.map((c: Record<string, unknown>, index: number) => ({
          id: asString(c.id) ?? randomUUID(),
          reqId: asString(c.reqId),
          criterionId: asString(c.criterionId),
          text: asString(c.text) ?? "",
          kind: isEnum(c.kind, CONDITION_KINDS) ? c.kind : "normal",
          relay: "none" as const,
          testsetId: null,
          sort: index,
        })),
      });
      res.status(201).json({ success: true, record });
    } catch (err) {
      handleError(res, err, "创建分析记录");
    }
  });

  app.patch("/api/requirement-analysis-v2/records/:id", async (req, res) => {
    try {
      const title = asString(body(req).title)?.trim();
      if (!title) return fail(res, 400, "title 不能为空");
      res.json({ success: true, record: await repo.renameRecord(req.params.id, title) });
    } catch (err) {
      handleError(res, err, "重命名分析记录");
    }
  });

  app.delete("/api/requirement-analysis-v2/records/:id", async (req, res) => {
    try {
      await repo.deleteRecord(req.params.id);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, "删除分析记录");
    }
  });

  app.patch("/api/requirement-analysis-v2/issues/:id", async (req, res) => {
    try {
      const b = body(req);
      const patch: { status?: IssueStatus; severity?: IssueSeverity } = {};
      if (b.status !== undefined) {
        if (!isEnum(b.status, ISSUE_STATUSES)) return fail(res, 400, "非法问题状态");
        patch.status = b.status;
      }
      if (b.severity !== undefined) {
        if (!isEnum(b.severity, SEVERITIES)) return fail(res, 400, "非法严重度");
        patch.severity = b.severity;
      }
      res.json({ success: true, issue: await repo.patchIssue(req.params.id, patch) });
    } catch (err) {
      handleError(res, err, "更新问题");
    }
  });

  /** 准则 patch；status=rejected 时闭环生成「不可测」问题条目（#25 决策）。 */
  app.patch("/api/requirement-analysis-v2/criteria/:id", async (req, res) => {
    try {
      const b = body(req);
      const patch: { status?: CriterionStatus; rewrittenText?: string } = {};
      if (b.status !== undefined) {
        if (!isEnum(b.status, CRITERION_STATUSES)) return fail(res, 400, "非法准则状态");
        patch.status = b.status;
      }
      if (b.rewrittenText !== undefined) {
        const text = asString(b.rewrittenText)?.trim();
        if (!text) return fail(res, 400, "rewrittenText 不能为空");
        patch.rewrittenText = text;
      }
      const criterion = await repo.patchCriterion(req.params.id, patch);

      let issue = null;
      if (patch.status === "rejected") {
        issue = await repo.createIssue(criterion.recordId, {
          reqId: criterion.reqId,
          type: "untestable",
          severity: "medium",
          quote: criterion.originalText,
          description: `验收准则改写被驳回：${criterion.rewrittenText}`,
          suggestedQuestion: "该需求的可度量验收标准是什么？",
        });
      }
      res.json({ success: true, criterion, issue });
    } catch (err) {
      handleError(res, err, "更新验收准则");
    }
  });

  app.patch("/api/requirement-analysis-v2/conditions/:id", async (req, res) => {
    try {
      const relay = body(req).relay;
      if (!isEnum(relay, RELAY_STATES)) return fail(res, 400, "非法接力状态");
      res.json({ success: true, condition: await repo.patchCondition(req.params.id, { relay }) });
    } catch (err) {
      handleError(res, err, "更新测试条件");
    }
  });

  /** 接力：勾选条件 → relayed。 */
  app.post("/api/requirement-analysis-v2/records/:id/relay", async (req, res) => {
    try {
      const conditionIds = body(req).conditionIds;
      if (!Array.isArray(conditionIds) || !conditionIds.every((v) => typeof v === "string")) {
        return fail(res, 400, "conditionIds 必须是字符串数组");
      }
      const marked = await repo.markConditionsRelayed(req.params.id, conditionIds);
      res.json({ success: true, marked });
    } catch (err) {
      handleError(res, err, "接力测试条件");
    }
  });

  /** 用例集保存后回写：条件 → generated + testsetId（#26 决策）。 */
  app.post("/api/requirement-analysis-v2/link-testset", async (req, res) => {
    try {
      const b = body(req);
      const conditionIds = b.conditionIds;
      const testsetId = asString(b.testsetId)?.trim();
      if (!Array.isArray(conditionIds) || !conditionIds.every((v) => typeof v === "string")) {
        return fail(res, 400, "conditionIds 必须是字符串数组");
      }
      if (!testsetId) return fail(res, 400, "testsetId 不能为空");
      const linked = await repo.markConditionsGenerated(conditionIds, testsetId);
      res.json({ success: true, linked });
    } catch (err) {
      handleError(res, err, "回写用例集关联");
    }
  });

  app.get("/api/requirement-analysis-v2/records/:id/rtm", async (req, res) => {
    try {
      res.json({ success: true, rtm: await repo.getRtm(req.params.id) });
    } catch (err) {
      handleError(res, err, "获取追溯矩阵");
    }
  });

  /** 文档解析：raw body + ?filename=，返回纯文本与 warning（不落库）。 */
  app.post(
    "/api/requirement-analysis-v2/parse-document",
    express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
    async (req, res) => {
      try {
        const filename = typeof req.query.filename === "string" ? req.query.filename : "";
        if (!filename) return fail(res, 400, "缺少 filename 查询参数");
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
        if (buffer.length === 0) return fail(res, 400, "文件内容为空");
        const parsed = await parseRequirementDocument(filename, buffer);
        res.json({ success: true, text: parsed.text, warnings: parsed.warnings, truncated: parsed.truncated });
      } catch (err) {
        if (err instanceof DocumentParseError) return fail(res, 400, err.message);
        handleError(res, err, "解析文档");
      }
    },
  );

  /** AI 分析（SSE）：分析 → 校验（修复重试一次）→ 完成才落库。 */
  app.post("/api/requirement-analysis-v2/analyze", async (req, res) => {
    const b = body(req);
    const sourceText = asString(b.sourceText)?.trim();
    if (!sourceText) {
      fail(res, 400, "sourceText 不能为空");
      return;
    }
    let config;
    try {
      config = parseAiRequestConfig(b);
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : "AI 配置无效");
      return;
    }

    beginSse(res);
    try {
      await analyzeRequirement(
        config,
        repo,
        { sourceText, titleHint: asString(b.title) ?? undefined, sourceFileName: asString(b.sourceFileName) },
        (event) => {
          if (event.type === "done") {
            emit(res, "done", { record: event.record });
          } else if (event.type === "error") {
            emit(res, "error", { message: event.message });
          } else {
            emit(res, "progress", { stage: event.stage, message: event.message });
          }
        },
      );
      endSse(res, true);
    } catch (err) {
      const message = err instanceof AnalysisGenerateError || err instanceof Error ? err.message : "分析失败";
      logger.error({ err }, "[requirement-v2] 分析失败");
      emit(res, "error", { message });
      endSse(res, false);
    }
  });
}
