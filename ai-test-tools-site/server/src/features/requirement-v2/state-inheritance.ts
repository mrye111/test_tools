/** 重新分析的状态继承：保守匹配——需求文本未变 + 问题内容（类型/引用/描述）唯一匹配才继承已处理状态 */

import type { AnalysisIssue, AnalysisRecordDetail, RequirementItem } from "./types.js";

type NewIssue = Omit<AnalysisIssue, "recordId" | "createdAt" | "updatedAt">;

function normalize(text: string): string {
  return text.replace(/\s+/g, "").replace(/^[「『"'"']+|[」』"'"']+$/g, "");
}

/** 需求的稳定身份：规范化文本（跨记录的 id 不同，不能作匹配键） */
function reqKey(text: string): string {
  return normalize(text);
}

/** 问题的稳定身份：需求键 + 类型 + 规范化引用 + 规范化描述 */
function issueKey(reqText: string | null, issue: { type: string; quote: string; description: string }): string {
  return [reqText === null ? "" : normalize(reqText), issue.type, normalize(issue.quote), normalize(issue.description)].join("");
}

/**
 * 继承已处理状态（resolved/accepted）到新分析的问题集。
 * - open 态不继承（本来就是初始态）
 * - 匹配键在旧记录里不唯一时不继承（避免状态串线）
 * - 关联需求文本变化时不继承（旧结论不可信）
 * 返回新问题数组（不可变）与继承计数。
 */
export function inheritIssueStatuses(
  oldDetail: AnalysisRecordDetail,
  newRequirements: Array<Pick<RequirementItem, "id" | "text">>,
  newIssues: NewIssue[],
): { issues: NewIssue[]; inheritedCount: number } {
  const oldReqTextById = new Map(oldDetail.requirements.map((r) => [r.id, r.text]));
  const newReqTextById = new Map(newRequirements.map((r) => [r.id, r.text]));

  // 需求文本未变的集合：新旧同文本
  const unchangedReqTexts = new Set<string>();
  const oldTexts = new Set(oldDetail.requirements.map((r) => reqKey(r.text)));
  for (const req of newRequirements) {
    if (oldTexts.has(reqKey(req.text))) unchangedReqTexts.add(reqKey(req.text));
  }

  // 旧问题按键分桶，识别唯一候选
  const buckets = new Map<string, AnalysisIssue[]>();
  for (const oldIssue of oldDetail.issues) {
    if (oldIssue.status === "open") continue;
    const reqText = oldIssue.reqId ? (oldReqTextById.get(oldIssue.reqId) ?? null) : null;
    const key = issueKey(reqText, oldIssue);
    const bucket = buckets.get(key) ?? [];
    bucket.push(oldIssue);
    buckets.set(key, bucket);
  }

  let inheritedCount = 0;
  const issues = newIssues.map((newIssue) => {
    if (newIssue.status !== "open") return newIssue;
    const reqText = newIssue.reqId ? (newReqTextById.get(newIssue.reqId) ?? null) : null;
    // 关联需求文本变化（或新旧其一为空但键能对上视为未变）不继承
    if (reqText !== null && !unchangedReqTexts.has(reqKey(reqText))) return newIssue;
    const bucket = buckets.get(issueKey(reqText, newIssue));
    if (!bucket || bucket.length !== 1) return newIssue;
    inheritedCount += 1;
    return { ...newIssue, status: bucket[0].status };
  });

  return { issues, inheritedCount };
}
