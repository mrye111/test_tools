import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RequirementAnalysisStore,
  toAnalysisRecordSummary,
  type RequirementAnalysisStoreOptions,
} from "../src/features/requirement/store.js";
import type { AnalysisRecord } from "../src/features/requirement/types.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "requirement-analysis-store-"));
  tempDirs.push(dir);
  return dir;
}

function createStore(dir = tempDir()) {
  return new RequirementAnalysisStore(join(dir, "store.json"), { persistDebounceMs: 0 });
}

function createStoreWithWriteSpy(options: { persistDebounceMs?: number } = {}) {
  const dir = tempDir();
  const writeFile = vi.fn((path: string, content: string) => {
    writeFileSync(path, content, "utf8");
  });
  const storeOptions: RequirementAnalysisStoreOptions = {
    // 默认给足够长的防抖窗口，测试内的写入次数只受被测行为影响，不受计时器干扰。
    persistDebounceMs: options.persistDebounceMs ?? 10_000,
    writeFile: writeFile as unknown as typeof writeFileSync,
  };
  const store = new RequirementAnalysisStore(join(dir, "store.json"), storeOptions);
  return { store, writeFile };
}

function makeRecord(id = "rec_test_1", overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    id,
    name: "登录需求分析",
    chartType: "mindmap",
    title: "登录需求",
    tree: { id: "root", title: "登录需求", children: [{ id: "m1", title: "登录模块", children: [] }] },
    findings: [
      { id: "f1", type: "risk", title: "验证码暴力破解", detail: "未说明错误次数限制", nodeId: "m1" },
      { id: "f2", type: "ambiguity", title: "有效期口径", detail: "5 分钟从何时起算不明确", nodeId: "m1" },
      { id: "f3", type: "clarification", title: "是否支持第三方登录", detail: "需确认范围", nodeId: "m1" },
    ],
    sourceText: "用户通过手机号+验证码登录，验证码 5 分钟内有效。",
    truncated: false,
    warnings: [],
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("分析记录 Store 内存态 CRUD", () => {
  it("创建后可按 id 读取与列表返回，返回值是克隆（外部篡改不影响内部状态）", () => {
    const store = createStore();
    store.createRecord(makeRecord());

    expect(store.getRecord("rec_test_1")?.name).toBe("登录需求分析");
    expect(store.listRecords()).toHaveLength(1);

    const record = store.getRecord("rec_test_1");
    record!.name = "被外部篡改";
    record!.tree.children = [];
    expect(store.getRecord("rec_test_1")?.name).toBe("登录需求分析");
    expect(store.getRecord("rec_test_1")?.tree.children).toHaveLength(1);
  });

  it("更新名称/图表类型并刷新 updatedAt，createdAt 不变", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:00:00.000Z"));
    const store = createStore();
    store.createRecord(makeRecord());

    vi.setSystemTime(new Date("2026-07-24T01:30:00.000Z"));
    const updated = store.updateRecord("rec_test_1", { name: "改名后", chartType: "logic" });

    expect(updated?.name).toBe("改名后");
    expect(updated?.chartType).toBe("logic");
    expect(updated?.updatedAt).toBe("2026-07-24T01:30:00.000Z");
    expect(updated?.createdAt).toBe("2026-07-24T00:00:00.000Z");
  });

  it("更新不存在的记录返回 undefined", () => {
    const store = createStore();
    expect(store.updateRecord("rec_missing", { name: "x" })).toBeUndefined();
  });

  it("删除返回是否存在，删除后读取不到", () => {
    const store = createStore();
    store.createRecord(makeRecord());

    expect(store.deleteRecord("rec_test_1")).toBe(true);
    expect(store.getRecord("rec_test_1")).toBeUndefined();
    expect(store.deleteRecord("rec_test_1")).toBe(false);
  });
});

describe("分析记录 Store 落盘策略", () => {
  it("persistDebounceMs <= 0 时每次变更立即同步落盘", () => {
    const dir = tempDir();
    const path = join(dir, "store.json");
    const store = new RequirementAnalysisStore(path, { persistDebounceMs: 0 });
    store.createRecord(makeRecord());

    const persisted = JSON.parse(readFileSync(path, "utf8")) as { records: AnalysisRecord[] };
    expect(persisted.records).toHaveLength(1);
    expect(persisted.records[0]?.id).toBe("rec_test_1");

    store.deleteRecord("rec_test_1");
    const afterDelete = JSON.parse(readFileSync(path, "utf8")) as { records: AnalysisRecord[] };
    expect(afterDelete.records).toHaveLength(0);
  });

  it("记录写入在防抖窗口内合并，最终落盘内容是最新状态", async () => {
    const { store, writeFile } = createStoreWithWriteSpy({ persistDebounceMs: 30 });
    writeFile.mockClear();

    for (let index = 0; index < 20; index += 1) {
      store.createRecord(makeRecord(`rec_${index}`));
    }
    expect(writeFile).not.toHaveBeenCalled();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));

    expect(writeFile).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(String(writeFile.mock.calls.at(-1)?.[1])) as { records: AnalysisRecord[] };
    expect(persisted.records).toHaveLength(20);
  });

  it("重启后从磁盘恢复记录（新实例读同一文件）", () => {
    const dir = tempDir();
    const path = join(dir, "store.json");
    const first = new RequirementAnalysisStore(path, { persistDebounceMs: 0 });
    first.createRecord(makeRecord("rec_a"));
    first.createRecord(makeRecord("rec_b", { name: "第二条" }));

    const reopened = new RequirementAnalysisStore(path, { persistDebounceMs: 0 });
    expect(reopened.listRecords()).toHaveLength(2);
    expect(reopened.getRecord("rec_b")?.name).toBe("第二条");
  });

  it("存储文件损坏时按空库启动", () => {
    const dir = tempDir();
    const path = join(dir, "store.json");
    writeFileSync(path, "{ 这不是合法 JSON", "utf8");

    const store = new RequirementAnalysisStore(path, { persistDebounceMs: 0 });
    expect(store.listRecords()).toHaveLength(0);
    expect(existsSync(path)).toBe(true);
  });

  it("单条记录缺字段结构时跳过该条，不影响其它记录加载", () => {
    const dir = tempDir();
    const path = join(dir, "store.json");
    const good = makeRecord("rec_good");
    // 手工编辑/旧格式导致的坏记录：缺 findings 数组、缺 tree
    const bad = { id: "rec_bad", name: "坏记录" };
    writeFileSync(path, JSON.stringify({ records: [bad, good] }), "utf8");

    const store = new RequirementAnalysisStore(path, { persistDebounceMs: 0 });
    expect(store.listRecords().map((record) => record.id)).toEqual(["rec_good"]);
    expect(() => store.listRecords().map(toAnalysisRecordSummary)).not.toThrow();
  });
});

describe("分析记录摘要", () => {
  it("按结论类型计数，且不带树/原文等大字段", () => {
    const summary = toAnalysisRecordSummary(makeRecord());
    expect(summary).toEqual({
      id: "rec_test_1",
      name: "登录需求分析",
      chartType: "mindmap",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
      findingsCount: { risk: 1, ambiguity: 1, clarification: 1 },
      truncated: false,
    });
    expect(summary).not.toHaveProperty("tree");
    expect(summary).not.toHaveProperty("sourceText");
  });
});
