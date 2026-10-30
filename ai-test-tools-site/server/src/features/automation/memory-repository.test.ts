import { describe, expect, it } from "vitest";
import { MemoryAutomationRepository } from "./memory-repository.js";
import type { AutomationStep } from "./types.js";

const STEPS: AutomationStep[] = [
  { id: 1, type: "act", text: "点击【登录】", enabled: true },
  { id: 2, type: "assert", text: "显示首页昵称", enabled: true },
];

describe("MemoryAutomationRepository", () => {
  it("创建用例：自动编号、推导 executable、默认 never 运行", async () => {
    const repo = new MemoryAutomationRepository();
    const created = await repo.createCase({
      projectId: "p1",
      title: "正常账号密码登录",
      steps: STEPS,
      manualItems: [],
    });
    expect(created.caseNo).toBe("ATC-001");
    expect(created.executable).toBe("full");
    expect(created.lastRunStatus).toBe("never");
    expect(created.id).toBeTruthy();

    const second = await repo.createCase({
      projectId: "p1",
      title: "超量阶梯计费",
      steps: STEPS,
      manualItems: [{ text: "触发结算", reason: "后端批处理" }],
    });
    expect(second.caseNo).toBe("ATC-002");
    expect(second.executable).toBe("partial");

    const otherProject = await repo.createCase({ projectId: "p2", title: "另一项目", steps: [], manualItems: [] });
    expect(otherProject.caseNo).toBe("ATC-001");
    expect(otherProject.executable).toBe("manual");
  });

  it("list/get/update/delete 全流程", async () => {
    const repo = new MemoryAutomationRepository();
    const a = await repo.createCase({ projectId: "p1", title: "A 用例", steps: STEPS });
    await repo.createCase({ projectId: "p2", title: "B 用例", steps: STEPS });

    expect(await repo.listCases()).toHaveLength(2);
    expect(await repo.listCases("p1")).toHaveLength(1);

    const got = await repo.getCase(a.id);
    expect(got?.title).toBe("A 用例");

    const updated = await repo.updateCase(a.id, {
      title: "A 用例（改）",
      manualItems: [{ text: "看日志", reason: "浏览器不可执行" }],
    });
    expect(updated?.title).toBe("A 用例（改）");
    expect(updated?.executable).toBe("partial");
    expect(updated?.caseNo).toBe(a.caseNo);

    expect(await repo.updateCase("不存在", { title: "x" })).toBeNull();

    expect(await repo.deleteCase(a.id)).toBe(true);
    expect(await repo.deleteCase(a.id)).toBe(false);
    expect(await repo.listCases("p1")).toHaveLength(0);
  });

  it("返回副本：外部修改不污染仓储", async () => {
    const repo = new MemoryAutomationRepository();
    const created = await repo.createCase({ projectId: "p1", title: "原始", steps: STEPS });
    created.title = "被外部篡改";
    created.steps[0].text = "被篡改";
    const got = await repo.getCase(created.id);
    expect(got?.title).toBe("原始");
    expect(got?.steps[0].text).toBe("点击【登录】");
  });

  it("编译缓存：put/get 往返", async () => {
    const repo = new MemoryAutomationRepository();
    const plan = {
      caseRef: "TC001",
      executable: "full" as const,
      variables: [],
      setup: [],
      instructions: STEPS,
      manualItems: [],
      compileNotes: [],
      compileHash: "h1",
    };
    expect(await repo.getCompiledCache("TC001", "h1")).toBeNull();
    await repo.putCompiledCache("TC001", "h1", plan);
    const hit = await repo.getCompiledCache("TC001", "h1");
    expect(hit?.caseRef).toBe("TC001");
    expect(hit?.instructions).toHaveLength(2);
    // 不同 hash 不命中
    expect(await repo.getCompiledCache("TC001", "h2")).toBeNull();
  });
});

describe("MemoryAutomationRepository - 用例集与批次", () => {
  it("用例集 CRUD + 删除集时成员用例 setId 置空", async () => {
    const repo = new MemoryAutomationRepository();
    const set = await repo.createSet({ projectId: "p1", name: "百度搜索" });
    expect(set.name).toBe("百度搜索");

    const renamed = await repo.updateSet(set.id, { name: "百度搜索（改）" });
    expect(renamed?.name).toBe("百度搜索（改）");
    expect(await repo.updateSet("不存在", { name: "x" })).toBeNull();

    const item = await repo.createCase({ projectId: "p1", setId: set.id, title: "首页进入", steps: STEPS });
    expect(item.setId).toBe(set.id);
    expect(await repo.listCases("p1", set.id)).toHaveLength(1);
    expect(await repo.listCases("p1", "其他集")).toHaveLength(0);

    expect(await repo.deleteSet(set.id)).toBe(true);
    expect(await repo.deleteSet(set.id)).toBe(false);
    // 用例还在但 setId 已置空
    const after = await repo.getCase(item.id);
    expect(after).not.toBeNull();
    expect(after?.setId).toBeUndefined();
  });

  it("listRunsByBatch 按批次返回成员运行", async () => {
    const repo = new MemoryAutomationRepository();
    const base = {
      caseNo: "ATC-001",
      title: "t",
      engine: "visual" as const,
      status: "done" as const,
      stepResults: [],
      manualItems: [],
      entryUrl: "",
      createdAt: new Date().toISOString(),
    };
    await repo.createRunRecord({ ...base, id: "r1", batchId: "b1" });
    await repo.createRunRecord({ ...base, id: "r2", batchId: "b1" });
    await repo.createRunRecord({ ...base, id: "r3", batchId: "b2" });
    await repo.createRunRecord({ ...base, id: "r4" });

    const batch = await repo.listRunsByBatch("b1");
    expect(batch.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(await repo.listRunsByBatch("不存在")).toHaveLength(0);
  });

  // ── P1 项目化外壳 ────────────────────────────────────────────────────────

  it("项目扩展：无记录返回默认值，upsert 后读回", async () => {
    const repo = new MemoryAutomationRepository();
    const initial = await repo.getProjectExt("p1");
    expect(initial.projectId).toBe("p1");
    expect(initial.runBehavior).toEqual({ loginOncePerRun: false, viewport: "1920x1080", concurrency: 3 });

    const saved = await repo.upsertProjectExt({
      projectId: "p1",
      extraInstructions: "避免破坏性操作",
      prdText: "PRD 原文",
      runBehavior: { loginOncePerRun: true, viewport: "1440x900", concurrency: 2 },
    });
    expect(saved.defaultEnvId).toBeUndefined();
    const reread = await repo.getProjectExt("p1");
    expect(reread.extraInstructions).toBe("避免破坏性操作");
    expect(reread.runBehavior.loginOncePerRun).toBe(true);
  });

  it("环境：CRUD + 默认切换互斥 + 排序默认在前", async () => {
    const repo = new MemoryAutomationRepository();
    const a = await repo.createEnvironment({
      projectId: "p1",
      name: "default",
      url: "https://staging.example.com",
      isDefault: true,
      auth: { kind: "credentials", usernameKey: "U", passwordKey: "P" },
    });
    const b = await repo.createEnvironment({
      projectId: "p1",
      name: "prod",
      url: "https://example.com",
      isDefault: false,
      auth: { kind: "none" },
    });
    await repo.createEnvironment({ projectId: "p2", name: "其他项目", url: "https://other.example.com", isDefault: true, auth: { kind: "none" } });

    expect((await repo.listEnvironments("p1")).map((e) => e.name)).toEqual(["default", "prod"]);

    await repo.setDefaultEnvironment("p1", b.id);
    const after = await repo.listEnvironments("p1");
    expect(after[0].id).toBe(b.id);
    expect(after.find((e) => e.id === a.id)?.isDefault).toBe(false);

    const renamed = await repo.updateEnvironment(a.id, { name: "default（改）", auth: { kind: "sso" } });
    expect(renamed?.name).toBe("default（改）");
    expect(renamed?.auth).toEqual({ kind: "sso" });
    expect(await repo.updateEnvironment("不存在", { name: "x" })).toBeNull();

    expect(await repo.deleteEnvironment(b.id)).toBe(true);
    expect(await repo.deleteEnvironment(b.id)).toBe(false);
  });

  it("测试附件：add/list/delete，delete 返回被删记录供路由删磁盘文件", async () => {
    const repo = new MemoryAutomationRepository();
    const f = await repo.addTestFile({ projectId: "p1", filename: "users.csv", path: "/tmp/f1-users.csv", size: 1234 });
    expect(f.id).toBeTruthy();
    expect((await repo.listTestFiles("p1")).map((x) => x.filename)).toEqual(["users.csv"]);
    expect(await repo.listTestFiles("p2")).toHaveLength(0);

    const deleted = await repo.deleteTestFile(f.id);
    expect(deleted?.path).toBe("/tmp/f1-users.csv");
    expect(await repo.deleteTestFile(f.id)).toBeNull();
  });

  it("规划提案（P3）：批量建（ATP 项目内编号）/ 列表 / 更新 / 删除", async () => {
    const repo = new MemoryAutomationRepository();
    const base = {
      projectId: "p1",
      batchId: "batch-1",
      sourceId: "src-1",
      useCase: "登录",
      goal: "验证登录",
      expected: ["进入首页"],
      priority: "high" as const,
      estSteps: ["打开登录页", "登录"],
      included: true,
      status: "proposed" as const,
    };
    const created = await repo.createProposals([
      { ...base, title: "标准用户登录" },
      { ...base, title: "锁定用户报错", useCase: "登录" },
    ]);
    expect(created.map((p) => p.caseNo)).toEqual(["ATP-001", "ATP-002"]);
    // 第二批续编号、跨项目独立编号
    const more = await repo.createProposals([{ ...base, title: "加购" }]);
    expect(more[0].caseNo).toBe("ATP-003");
    const other = await repo.createProposals([{ ...base, projectId: "p2", title: "另一项目" }]);
    expect(other[0].caseNo).toBe("ATP-001");

    expect((await repo.listProposals("p1")).map((p) => p.caseNo).sort()).toEqual(["ATP-001", "ATP-002", "ATP-003"]);

    const updated = await repo.updateProposal(created[0].id, { included: false, status: "accepted", title: "改名" });
    expect(updated).toMatchObject({ included: false, status: "accepted", title: "改名" });
    expect(await repo.updateProposal("不存在", { title: "x" })).toBeNull();

    expect(await repo.deleteProposal(created[1].id)).toBe(true);
    expect(await repo.deleteProposal(created[1].id)).toBe(false);
    expect((await repo.listProposals("p1")).map((p) => p.caseNo).sort()).toEqual(["ATP-001", "ATP-003"]);
  });
});
