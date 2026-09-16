import { describe, expect, it } from "vitest";
import { inheritIssueStatuses } from "./state-inheritance.js";
import type { AnalysisIssue, AnalysisRecordDetail, RequirementItem } from "./types.js";

function req(id: string, text: string, sort = 0): RequirementItem {
  return { id, recordId: "ra2_x", parentId: null, level: 0, text, sort };
}

function issue(partial: Partial<AnalysisIssue> & { id: string }): AnalysisIssue {
  return {
    recordId: "ra2_x",
    reqId: null,
    type: "missing",
    severity: "medium",
    quote: "",
    description: "",
    example: "",
    suggestedQuestion: "",
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function detail(requirements: RequirementItem[], issues: AnalysisIssue[]): AnalysisRecordDetail {
  return {
    id: "ra2_old",
    title: "旧记录",
    sourceFileName: null,
    sourceText: "",
    previousRecordId: null,
    inheritedIssueCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    requirements,
    issues,
    criteria: [],
    conditions: [],
  };
}

describe("inheritIssueStatuses（保守继承：唯一匹配 + 需求文本未变）", () => {
  it("唯一匹配且需求未变：resolved/accepted 继承到新问题", () => {
    const old = detail(
      [req("r1", "账号锁定")],
      [issue({ id: "i1", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值", status: "resolved" })],
    );
    const newReqs = [req("r9", "账号锁定")]; // 新记录 id 不同
    const newIssues = [issue({ id: "n1", reqId: "r9", type: "missing", quote: "「连续输错锁定」", description: "缺阈值" })];

    const { issues, inheritedCount } = inheritIssueStatuses(old, newReqs, newIssues);
    expect(inheritedCount).toBe(1);
    expect(issues[0].status).toBe("resolved");
    expect(issues[0].id).toBe("n1");
  });

  it("新问题一律 open；关联需求文本变了不继承", () => {
    const old = detail(
      [req("r1", "账号锁定")],
      [issue({ id: "i1", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值", status: "accepted" })],
    );
    // 需求文本改了
    const changedReq = [req("r9", "账号锁定策略调整")];
    const newIssue = [issue({ id: "n1", reqId: "r9", type: "missing", quote: "「连续输错锁定」", description: "缺阈值" })];
    const { issues, inheritedCount } = inheritIssueStatuses(old, changedReq, newIssue);
    expect(inheritedCount).toBe(0);
    expect(issues[0].status).toBe("open");
  });

  it("问题描述变了不继承（内容已变，旧结论不可信）", () => {
    const old = detail(
      [req("r1", "账号锁定")],
      [issue({ id: "i1", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值", status: "resolved" })],
    );
    const newIssues = [issue({ id: "n1", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值与时长" })];
    const { issues, inheritedCount } = inheritIssueStatuses(old, [req("r1", "账号锁定")], newIssues);
    expect(inheritedCount).toBe(0);
    expect(issues[0].status).toBe("open");
  });

  it("旧侧存在重复候选（同类型同引用同描述）时不继承，避免状态串线", () => {
    const old = detail(
      [req("r1", "账号锁定")],
      [
        issue({ id: "i1", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值", status: "resolved" }),
        issue({ id: "i2", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值", status: "accepted" }),
      ],
    );
    const newIssues = [issue({ id: "n1", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值" })];
    const { issues, inheritedCount } = inheritIssueStatuses(old, [req("r1", "账号锁定")], newIssues);
    expect(inheritedCount).toBe(0);
    expect(issues[0].status).toBe("open");
  });

  it("规范化差异（空白/引号）不影响匹配", () => {
    const old = detail(
      [req("r1", "账号锁定")],
      [issue({ id: "i1", reqId: "r1", type: "missing", quote: "「连续输错 锁定」", description: "缺阈值", status: "resolved" })],
    );
    const newIssues = [issue({ id: "n1", reqId: "r1", type: "missing", quote: "「连续输错锁定」", description: "缺阈值" })];
    const { inheritedCount } = inheritIssueStatuses(old, [req("r1", "账号锁定")], newIssues);
    expect(inheritedCount).toBe(1);
  });
});
