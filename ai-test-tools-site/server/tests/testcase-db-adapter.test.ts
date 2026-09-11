import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistTable, TestCasePersistenceAdapter } from "../src/features/testcase/mysql-persistence.js";
import { TestCaseStore } from "../src/features/testcase/store.js";
import type { TestCaseStoreData, TestSetRecord } from "../src/features/testcase/types.js";

const tempDirs: string[] = [];

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), "testcase-db-"));
  tempDirs.push(dir);
  return new TestCaseStore(join(dir, "store.json"), { persistDebounceMs: 0 });
}

function makeTestSet(overrides: Partial<TestSetRecord> = {}): TestSetRecord {
  return {
    id: "set_1",
    projectId: "proj_1",
    name: "登录",
    featureName: "登录",
    testType: "functional",
    language: "zh",
    promptPreset: "standard",
    context: "登录",
    status: "completed",
    header: ["用例编号", "功能模块", "功能测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"],
    rows: [],
    createdAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

function makeJob(updatedAt: string) {
  return {
    id: "job_1",
    projectId: "proj_1",
    testSetId: "set_1",
    mode: "create" as const,
    status: "completed" as const,
    request: {},
    generatedCount: 0,
    error: "",
    resultHeader: [],
    resultRows: [],
    selectedIndices: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

class StubAdapter implements TestCasePersistenceAdapter {
  saves: { tables: PersistTable[]; data: TestCaseStoreData }[] = [];
  failNext = false;

  constructor(private canned: TestCaseStoreData | null) {}

  async load() {
    return this.canned ? JSON.parse(JSON.stringify(this.canned)) as TestCaseStoreData : null;
  }

  async save(tables: PersistTable[], data: TestCaseStoreData) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("MySQL 连接中断");
    }
    this.saves.push({ tables: [...tables], data: JSON.parse(JSON.stringify(data)) as TestCaseStoreData });
  }
}

function emptyData(): TestCaseStoreData {
  return { projects: [], testSets: [], testCases: [], generationJobs: [] };
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("TestCaseStore MySQL 写穿透与水合", () => {
  it("未接入适配器时为 file 模式，接入后为 mysql 模式", async () => {
    const store = createStore();
    expect(store.dbMode()).toBe("file");

    await store.attachDb(new StubAdapter(null));
    expect(store.dbMode()).toBe("mysql");
  });

  it("DB 有更新数据时以 DB 为真相替换内存", async () => {
    const store = createStore();
    store.upsertTestSet(makeTestSet({ name: "本地旧数据" }));

    const dbData: TestCaseStoreData = {
      ...emptyData(),
      projects: [{ id: "proj_1", name: "DB项目", createdAt: "2026-09-11T00:00:00.000Z", ownerId: null }],
      // DB 时间戳显著新于本地（upsert 时的 nowIso），应判定 DB 为权威
      testSets: [makeTestSet({ name: "DB 用例集", updatedAt: "2099-01-01T00:00:00.000Z" })],
    };
    await store.attachDb(new StubAdapter(dbData));

    const sets = store.listTestSets("proj_1");
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe("DB 用例集");
  });

  it("DB 为空而本地文件有数据时，整体迁移写入全部四张表", async () => {
    const store = createStore();
    store.upsertProject({ id: "proj_1", name: "项目", createdAt: "2026-09-10T00:00:00.000Z", ownerId: null });
    store.upsertTestSet(makeTestSet());
    store.createJob(makeJob("2026-09-10T02:00:00.000Z"));

    const adapter = new StubAdapter(null);
    await store.attachDb(adapter);

    expect(adapter.saves).toHaveLength(1);
    expect(new Set(adapter.saves[0].tables)).toEqual(new Set(["projects", "testSets", "testCases", "generationJobs"]));
    expect(adapter.saves[0].data.testSets).toHaveLength(1);
  });

  it("DB 数据旧于本地文件时以文件为真相并迁移回写 DB", async () => {
    const store = createStore();
    store.upsertTestSet(makeTestSet({ name: "本地新数据", updatedAt: "2026-09-11T05:00:00.000Z" }));

    const dbData: TestCaseStoreData = {
      ...emptyData(),
      testSets: [makeTestSet({ name: "DB 旧数据", updatedAt: "2026-09-10T01:00:00.000Z" })],
    };
    const adapter = new StubAdapter(dbData);
    await store.attachDb(adapter);

    expect(store.listTestSets("proj_1")[0].name).toBe("本地新数据");
    expect(adapter.saves).toHaveLength(1);
    expect(new Set(adapter.saves[0].tables)).toEqual(new Set(["projects", "testSets", "testCases", "generationJobs"]));
  });

  it("用例集变更只写穿透 testSets（自动建项目时含 projects），不触碰其他表", async () => {
    const store = createStore();
    const adapter = new StubAdapter(null);
    await store.attachDb(adapter);

    store.upsertTestSet(makeTestSet({ id: "set_new", name: "新用例集" }));
    await store.flushDb();

    expect(adapter.saves.length).toBeGreaterThan(0);
    const last = adapter.saves[adapter.saves.length - 1];
    expect(new Set(last.tables)).toEqual(new Set(["testSets", "projects"]));
    expect(last.data.testSets.some((item) => item.id === "set_new")).toBe(true);
  });

  it("任务状态更新只写穿透 generationJobs 表", async () => {
    const store = createStore();
    const adapter = new StubAdapter(null);
    await store.attachDb(adapter);

    store.createJob(makeJob("2026-09-11T00:00:00.000Z"));
    await store.flushDb();

    expect(adapter.saves).toHaveLength(1);
    expect(adapter.saves[0].tables).toEqual(["generationJobs"]);
  });

  it("DB 写入失败只记录降级，本地文件与后续写入不受影响", async () => {
    const store = createStore();
    const adapter = new StubAdapter(null);
    await store.attachDb(adapter);

    adapter.failNext = true;
    store.upsertTestSet(makeTestSet({ id: "set_after_fail" }));
    await store.flushDb();

    // 失败后再次写入应恢复成功
    store.upsertTestSet(makeTestSet({ id: "set_after_fail", name: "改名" }));
    await store.flushDb();

    const last = adapter.saves[adapter.saves.length - 1];
    expect(last.data.testSets.some((item) => item.name === "改名")).toBe(true);
    expect(store.getTestSet("set_after_fail")?.name).toBe("改名");
  });

  it("水合后可正常执行读侧 API（项目统计依赖列表）", async () => {
    const store = createStore();
    const dbData: TestCaseStoreData = {
      projects: [{ id: "proj_1", name: "项目A", createdAt: "2026-09-11T00:00:00.000Z", ownerId: null }],
      testSets: [
        makeTestSet({
          rows: [["TC001", "登录", "正常登录", "正确账密", "高", "已注册", "步骤", "预期"]],
          updatedAt: "2026-09-11T01:00:00.000Z",
        }),
      ],
      testCases: [],
      generationJobs: [],
    };
    await store.attachDb(new StubAdapter(dbData));

    expect(store.listProjects()).toHaveLength(1);
    expect(store.listTestSets("proj_1")[0].rows).toHaveLength(1);
  });
});

describe("串行化写穿透", () => {
  it("连续多次变更按序入队，flushDb 等待全部完成", async () => {
    const store = createStore();
    const adapter = new StubAdapter(null);
    await store.attachDb(adapter);

    const order: string[] = [];
    const originalSave = adapter.save.bind(adapter);
    vi.spyOn(adapter, "save").mockImplementation(async (tables, data) => {
      order.push(tables.join("+"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      return originalSave(tables, data);
    });

    store.upsertProject({ id: "p1", name: "P1", createdAt: "2026-09-11T00:00:00.000Z", ownerId: null });
    store.upsertTestSet(makeTestSet({ projectId: "p1" }));
    store.createJob({ ...makeJob("2026-09-11T00:00:00.000Z"), projectId: "p1", testSetId: "set_1" });

    await store.flushDb();
    expect(order.length).toBe(3);
    // 按调用顺序串行执行
    expect(order[0]).toBe("projects");
    expect(order[1]).toContain("testSets");
    expect(order[2]).toBe("generationJobs");
  });
});
