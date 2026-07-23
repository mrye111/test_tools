import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app-error.js";
import { runGenerationJob } from "../src/features/testcase/generation.js";
import { TestCaseStore, type TestCaseStoreOptions } from "../src/features/testcase/store.js";
import type { GenerateJobRecord, TestSetRecord } from "../src/features/testcase/types.js";

const tempDirs: string[] = [];

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), "testcase-store-"));
  tempDirs.push(dir);
  return new TestCaseStore(join(dir, "store.json"), { persistDebounceMs: 0 });
}

function createStoreWithWriteSpy(options: { persistDebounceMs?: number; failWrites?: { current: boolean } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "testcase-store-"));
  tempDirs.push(dir);
  const writeFile = vi.fn((path: string, content: string) => {
    if (options.failWrites?.current) {
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    }
    writeFileSync(path, content, "utf8");
  });
  const storeOptions: TestCaseStoreOptions = {
    // 默认给足够长的防抖窗口，测试内的写入次数只受被测行为影响，不受计时器干扰。
    persistDebounceMs: options.persistDebounceMs ?? 10_000,
    writeFile: writeFile as unknown as typeof writeFileSync,
  };
  const store = new TestCaseStore(join(dir, "store.json"), storeOptions);
  return { store, writeFile };
}

function makeTestSet(): TestSetRecord {
  return {
    id: "set_1",
    projectId: "proj_1",
    name: "登录",
    featureName: "登录",
    testType: "functional",
    language: "zh",
    context: "登录",
    status: "completed",
    header: ["用例编号", "功能模块", "功能测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"],
    rows: [],
    createdAt: "2026-07-16T00:00:00.000Z",
    ownerId: null,
  };
}

function makeJob(id = "job_1"): GenerateJobRecord {
  return {
    id,
    projectId: "proj_1",
    testSetId: "set_1",
    mode: "create",
    status: "queued",
    request: { context: "登录" },
    generatedCount: 0,
    error: "",
    streamText: "",
    resultHeader: [],
    resultRows: [],
    selectedIndices: [],
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("测试用例 Store 快照一致性", () => {
  it("新增和删除单条用例时同步用例集 rows 并重排编号", () => {
    const store = createStore();
    store.upsertProject({ id: "proj_1", name: "项目", createdAt: "2026-07-16T00:00:00.000Z", ownerId: null });
    store.upsertTestSet(makeTestSet());

    store.upsertTestCase({
      id: "case_a",
      testSetId: "set_1",
      caseId: "",
      module: "登录",
      testPoint: "正常登录",
      title: "正确账号登录",
      priority: "高",
      precondition: "用户已注册",
      steps: "1. 输入账号",
      expectedResult: "1. 登录成功",
      row: [],
    });
    store.upsertTestCase({
      id: "case_b",
      testSetId: "set_1",
      caseId: "",
      module: "登录",
      testPoint: "异常登录",
      title: "错误密码登录",
      priority: "中",
      precondition: "用户已注册",
      steps: "1. 输入错误密码",
      expectedResult: "1. 提示错误",
      row: [],
    });

    expect(store.getTestSet("set_1")?.rows.map((row) => row[0])).toEqual(["TC001", "TC002"]);

    store.deleteTestCase("TC001", "set_1");

    expect(store.getTestSet("set_1")?.rows).toEqual([
      ["TC001", "登录", "异常登录", "错误密码登录", "中", "用户已注册", "1. 输入错误密码", "1. 提示错误"],
    ]);
    expect(store.getTestCase("TC001", "set_1")?.id).toBe("case_b");
  });
});

describe("测试用例 Store 落盘策略", () => {
  it("运行中的进度更新只驻留内存，终态才同步落盘一次", () => {
    const { store, writeFile } = createStoreWithWriteSpy();
    store.createJob(makeJob());
    writeFile.mockClear();

    for (let index = 0; index < 20; index += 1) {
      store.updateJob("job_1", { streamText: `chunk_${index}`, generatedCount: index + 1 });
    }
    expect(writeFile).not.toHaveBeenCalled();

    store.updateJob("job_1", { status: "completed", finishedAt: "2026-07-16T01:00:00.000Z" });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(String(writeFile.mock.calls[0]?.[1])) as { generationJobs: GenerateJobRecord[] };
    expect(persisted.generationJobs[0]?.status).toBe("completed");
    expect(persisted.generationJobs[0]?.streamText).toBe("chunk_19");
  });

  it("目录写入在防抖窗口内合并，最终落盘内容是最新状态", async () => {
    const { store, writeFile } = createStoreWithWriteSpy({ persistDebounceMs: 30 });
    writeFile.mockClear();

    for (let index = 0; index < 50; index += 1) {
      store.upsertTestSet({ ...makeTestSet(), name: `v${index}` });
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));

    expect(writeFile).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(String(writeFile.mock.calls.at(-1)?.[1])) as { testSets: TestSetRecord[] };
    expect(persisted.testSets[0]?.name).toBe("v49");
  });

  it("终态落盘失败抛出 storeError，内存中的任务状态仍然更新", () => {
    const failWrites = { current: false };
    const { store } = createStoreWithWriteSpy({ failWrites });
    store.createJob(makeJob());
    failWrites.current = true;

    let thrown: unknown;
    try {
      store.updateJob("job_1", { status: "completed" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("STORE_ERROR");
    expect((thrown as AppError).message).toContain("写入本地存储失败");
    expect(store.getJob("job_1")?.status).toBe("completed");
  });

  it("生成任务终态落盘失败时，任务被标记为失败而不是假成功", async () => {
    const failWrites = { current: true };
    const { store } = createStoreWithWriteSpy({ failWrites });
    store.upsertTestSet({ ...makeTestSet(), status: "queued" });
    const job = makeJob();
    job.request = {
      context: "用户使用账号密码登录",
      featureName: "登录",
      testType: "functional",
      language: "zh",
      baseUrl: "https://api.kimi.com/coding/v1",
      apiKey: "test-key",
      model: "kimi-k2.7-code",
      apiFormat: "openai_chat",
    };
    store.createJob(job);

    const validCsv = [
      "用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
      'TC001,登录,正常登录,正确账密登录,高,用户已注册,"1. 打开登录页\\n2. 输入正确账密","1. 登录页正常显示\\n2. 登录成功"',
    ].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: validCsv } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    await runGenerationJob("job_1", store);

    const finished = store.getJob("job_1");
    expect(finished?.status).toBe("failed");
    expect(finished?.error).toContain("写入本地存储失败");
    expect(finished?.generatedCount).toBe(1);
  });

  it("getJob 只克隆目标任务而不是整个 Store，返回值与内部状态隔离", () => {
    const { store } = createStoreWithWriteSpy();
    store.createJob(makeJob());

    const stringifySpy = vi.spyOn(JSON, "stringify");
    const job = store.getJob("job_1");
    const serializedTargets = stringifySpy.mock.calls.map((call) => call[0]);
    stringifySpy.mockRestore();

    expect(serializedTargets).toHaveLength(1);
    expect(serializedTargets[0]).toMatchObject({ id: "job_1" });
    expect(serializedTargets[0]).not.toHaveProperty("generationJobs");

    job!.streamText = "被外部篡改";
    expect(store.getJob("job_1")?.streamText).toBe("");
  });
});
