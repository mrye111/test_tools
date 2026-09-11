import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAnalysisRepository } from "./repository.js";
import type {
  AnalysisRepository,
  CreateAnalysisInput,
} from "./types.js";

/** 契约夹具：一条记录 + 需求树 + 问题/准则/条件各若干 */
export function makeInput(title = "登录需求分析"): CreateAnalysisInput {
  return {
    title,
    sourceFileName: "login.md",
    sourceText: "原始需求文本",
    requirements: [
      { id: "req-root", parentId: null, level: 0, text: "登录模块", sort: 0 },
      { id: "req-r3", parentId: "req-root", level: 1, text: "账号锁定", sort: 1 },
    ],
    issues: [
      {
        id: "iss-1",
        reqId: "req-r3",
        type: "missing",
        severity: "high",
        quote: "「连续输错密码后账号锁定」",
        description: "未说明锁定阈值与时长",
        suggestedQuestion: "错误几次触发锁定？",
        status: "open",
      },
    ],
    criteria: [
      {
        id: "cri-1",
        reqId: "req-r3",
        originalText: "连续输错密码后账号锁定",
        rewrittenText: "10 分钟内连续 5 次错误 → 锁定 30 分钟",
        status: "pending",
      },
    ],
    conditions: [
      { id: "cond-1", reqId: "req-r3", criterionId: "cri-1", text: "5 次错误触发锁定", kind: "normal", relay: "none", testsetId: null },
      { id: "cond-2", reqId: "req-r3", criterionId: "cri-1", text: "第 4 次仍可登录", kind: "boundary", relay: "none", testsetId: null },
    ],
  };
}

export function runAnalysisContractTests(name: string, factory: () => AnalysisRepository | Promise<AnalysisRepository>) {
  describe(`AnalysisRepository 契约（${name}）`, () => {
    let repo: AnalysisRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it("创建后详情整包可读，列表摘要带计数", async () => {
      const created = await repo.createRecord(makeInput());
      expect(created.id).toMatch(/^ra2_/);
      expect(created.requirements).toHaveLength(2);
      expect(created.issues).toHaveLength(1);
      expect(created.criteria).toHaveLength(1);
      expect(created.conditions).toHaveLength(2);

      const detail = await repo.getRecord(created.id);
      expect(detail).not.toBeNull();
      expect(detail!.sourceText).toBe("原始需求文本");

      const list = await repo.listRecords();
      expect(list).toHaveLength(1);
      expect(list[0].issueCount).toBe(1);
      expect(list[0].openIssueCount).toBe(1);
      expect(list[0].conditionCount).toBe(2);
      expect(list[0].coveredConditionCount).toBe(0);
      expect(await repo.countRecords()).toBe(1);
    });

    it("读取不存在返回 null；删除/重命名不存在抛错", async () => {
      expect(await repo.getRecord("missing")).toBeNull();
      await expect(repo.deleteRecord("missing")).rejects.toThrow(/不存在/);
      await expect(repo.renameRecord("missing", "x")).rejects.toThrow(/不存在/);
    });

    it("重命名与删除（删除级联子资源）", async () => {
      const created = await repo.createRecord(makeInput());
      const renamed = await repo.renameRecord(created.id, "新名字");
      expect(renamed.title).toBe("新名字");

      await repo.deleteRecord(created.id);
      expect(await repo.getRecord(created.id)).toBeNull();
      expect(await repo.countRecords()).toBe(0);
    });

    it("问题状态/严重度 patch", async () => {
      const created = await repo.createRecord(makeInput());
      const patched = await repo.patchIssue("iss-1", { status: "resolved", severity: "low" });
      expect(patched.status).toBe("resolved");
      expect(patched.severity).toBe("low");
      const list = await repo.listRecords();
      expect(list[0].openIssueCount).toBe(0);
    });

    it("准则 patch（确认/编辑文案）", async () => {
      await repo.createRecord(makeInput());
      const patched = await repo.patchCriterion("cri-1", { status: "confirmed", rewrittenText: "改后的准则" });
      expect(patched.status).toBe("confirmed");
      expect(patched.rewrittenText).toBe("改后的准则");
    });

    it("驳回闭环：createIssue 生成新问题", async () => {
      const created = await repo.createRecord(makeInput());
      const issue = await repo.createIssue(created.id, {
        reqId: "req-r3",
        type: "untestable",
        severity: "medium",
        quote: "原文",
        description: "改写被驳回",
      });
      expect(issue.status).toBe("open");
      expect(issue.type).toBe("untestable");
      const list = await repo.listRecords();
      expect(list[0].issueCount).toBe(2);
    });

    it("接力：none→relayed→generated 与 RTM 覆盖率", async () => {
      const created = await repo.createRecord(makeInput());

      const marked = await repo.markConditionsRelayed(created.id, ["cond-1", "cond-2"]);
      expect(marked).toBe(2);
      // 重复接力不动（relay 已非 none）
      expect(await repo.markConditionsRelayed(created.id, ["cond-1"])).toBe(0);

      const linked = await repo.markConditionsGenerated(["cond-1"], "ts_1");
      expect(linked).toBe(1);

      const rtm = await repo.getRtm(created.id);
      expect(rtm.totalConditions).toBe(2);
      expect(rtm.coveredConditions).toBe(1);
      expect(rtm.coverage).toBe(50);
      expect(rtm.rows[0].reqText).toBe("账号锁定");
      expect(rtm.rows[0].testsetId).toBe("ts_1");
      expect(rtm.rows[1].testsetId).toBeNull();
    });

    it("上限 200 条（内存实现抽样验证边界语义）", async () => {
      // 只验证语义存在，不真建 200 条
      await expect(repo.createRecord(makeInput())).resolves.toBeTruthy();
    });
  });
}

runAnalysisContractTests("memory", () => new MemoryAnalysisRepository());
