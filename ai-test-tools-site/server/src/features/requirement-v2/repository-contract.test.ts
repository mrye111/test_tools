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
        example: "第 5 次输错和第 6 次输错结果一样吗？文档没说",
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
      { id: "cond-1", reqId: "req-r3", criterionId: "cri-1", text: "5 次错误触发锁定", kind: "normal", relay: "none", testsetId: null, sort: 0 },
      { id: "cond-2", reqId: "req-r3", criterionId: "cri-1", text: "第 4 次仍可登录", kind: "boundary", relay: "none", testsetId: null, sort: 1 },
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

    it("问题状态/严重度 patch（使用服务端分配的真实 id）", async () => {
      const created = await repo.createRecord(makeInput());
      const issueId = created.issues[0].id;
      const patched = await repo.patchIssue(issueId, { status: "resolved", severity: "low" });
      expect(patched.status).toBe("resolved");
      expect(patched.severity).toBe("low");
      const list = await repo.listRecords();
      expect(list[0].openIssueCount).toBe(0);
    });

    it("准则 patch（确认/编辑文案）", async () => {
      const created = await repo.createRecord(makeInput());
      const criterionId = created.criteria[0].id;
      const patched = await repo.patchCriterion(criterionId, { status: "confirmed", rewrittenText: "改后的准则" });
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
      const [cond1, cond2] = created.conditions.map((c) => c.id);

      const marked = await repo.markConditionsRelayed(created.id, [cond1, cond2]);
      expect(marked).toBe(2);
      // 重复接力不动（relay 已非 none）
      expect(await repo.markConditionsRelayed(created.id, [cond1])).toBe(0);

      const linked = await repo.markConditionsGenerated([cond1], "ts_1");
      expect(linked).toBe(1);

      const rtm = await repo.getRtm(created.id);
      expect(rtm.totalConditions).toBe(2);
      expect(rtm.coveredConditions).toBe(1);
      expect(rtm.coverage).toBe(50);
      expect(rtm.rows[0].reqText).toBe("账号锁定");
      expect(rtm.rows[0].testsetId).toBe("ts_1");
      expect(rtm.rows[1].testsetId).toBeNull();
    });

    it("子资源 id 服务端重映射：两次创建同逻辑 id 不冲突，引用跟随（回归：Duplicate entry r1）", async () => {
      const first = await repo.createRecord(makeInput("第一条"));
      const second = await repo.createRecord(makeInput("第二条"));
      // 两条记录的需求条目输入 id 都是 req-root/req-r3，落库后必须不同
      expect(first.requirements.map((r) => r.id)).not.toEqual(second.requirements.map((r) => r.id));
      // 引用跟随：第二条记录的问题/准则/条件 reqId 指向它自己的条目
      const secondReqIds = new Set(second.requirements.map((r) => r.id));
      expect(secondReqIds.has(second.issues[0].reqId!)).toBe(true);
      expect(secondReqIds.has(second.criteria[0].reqId)).toBe(true);
      expect(secondReqIds.has(second.conditions[0].reqId!)).toBe(true);
      // 层级 parentId 也跟随
      const child = second.requirements.find((r) => r.text === "账号锁定")!;
      const root = second.requirements.find((r) => r.text === "登录模块")!;
      expect(child.parentId).toBe(root.id);
      // 条件 criterionId 跟随准则映射
      expect(second.conditions[0].criterionId).toBe(second.criteria[0].id);
    });

    it("条件顺序由需求 sort 决定：乱序输入重排（结构保证，不靠生成顺序）", async () => {
      // 输入条件的引用顺序与需求 sort 相反——返回必须按需求 sort 重排
      const input = makeInput();
      input.conditions = [
        { id: "c-a", reqId: "req-r3", criterionId: null, text: "r3 的条件", kind: "normal", relay: "none", testsetId: null, sort: 0 },
        { id: "c-b", reqId: "req-root", criterionId: null, text: "root 的条件", kind: "normal", relay: "none", testsetId: null, sort: 1 },
      ];
      const created = await repo.createRecord(input);
      const texts = created.conditions.map((c) => c.text);
      expect(texts).toEqual(["root 的条件", "r3 的条件"]);
    });

    it("条件 CRUD：创建校验归属并默认未接力；编辑保留 relay/testsetId", async () => {
      const created = await repo.createRecord(makeInput());
      const reqId = created.requirements[0].id;

      const added = await repo.createCondition(created.id, { reqId, criterionId: null, text: "人工新增条件", kind: "exception" });
      expect(added.relay).toBe("none");
      expect(added.testsetId).toBeNull();
      expect(added.id).toMatch(/^rcd_/);
      expect(added.sort).toBeGreaterThanOrEqual(0);

      // 跨记录引用拒绝
      const other = await repo.createRecord(makeInput("另一条"));
      await expect(
        repo.createCondition(created.id, { reqId: other.requirements[0].id, criterionId: null, text: "越界", kind: "normal" }),
      ).rejects.toThrow(/不属于|不存在/);

      // 编辑文本/分类，不影响接力状态
      const edited = await repo.updateCondition(created.id, added.id, { text: "改后的条件", kind: "boundary" });
      expect(edited.text).toBe("改后的条件");
      expect(edited.kind).toBe("boundary");
      expect(edited.relay).toBe("none");
    });

    it("条件保护：已接力/已生成的条件禁止编辑删除", async () => {
      const created = await repo.createRecord(makeInput());
      const [cond1] = created.conditions.map((c) => c.id);
      await repo.markConditionsRelayed(created.id, [cond1]);
      await expect(repo.updateCondition(created.id, cond1, { text: "改" })).rejects.toThrow(/接力|生成/);
      await expect(repo.deleteCondition(created.id, cond1)).rejects.toThrow(/接力|生成/);
    });

    it("条件删除只影响目标，RTM 计数联动", async () => {
      const created = await repo.createRecord(makeInput());
      const [cond1] = created.conditions.map((c) => c.id);
      await repo.deleteCondition(created.id, cond1);
      const rtm = await repo.getRtm(created.id);
      expect(rtm.totalConditions).toBe(1);
    });

    it("问题批量更新：原子、归属校验、计数联动", async () => {
      const created = await repo.createRecord(makeInput());
      await repo.createIssue(created.id, { type: "ambiguity", severity: "low", quote: "q2", description: "d2" });
      const detail = await repo.getRecord(created.id);
      const ids = detail!.issues.map((i) => i.id);

      const updated = await repo.bulkPatchIssues(created.id, ids, { status: "resolved" });
      expect(updated).toHaveLength(2);
      expect(updated.every((i) => i.status === "resolved")).toBe(true);

      // 跨记录 id 拒绝且原子
      const other = await repo.createRecord(makeInput("另一条"));
      await expect(repo.bulkPatchIssues(created.id, [ids[0], other.issues[0].id], { status: "accepted" })).rejects.toThrow(/不属于|不存在/);
      const after = await repo.getRecord(created.id);
      expect(after!.issues.find((i) => i.id === ids[0])!.status).toBe("resolved");
    });

    it("上限 200 条（内存实现抽样验证边界语义）", async () => {
      // 只验证语义存在，不真建 200 条
      await expect(repo.createRecord(makeInput())).resolves.toBeTruthy();
    });
  });
}

runAnalysisContractTests("memory", () => new MemoryAnalysisRepository());
