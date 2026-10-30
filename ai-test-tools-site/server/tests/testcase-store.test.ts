import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app-error.js";
import { createSecretCrypto } from "../src/shared/secret-crypto.js";
import { SECRET_REF_PLACEHOLDER, setJobSecretCrypto } from "../src/features/testcase/job-secrets.js";
import { runGenerationJob } from "../src/features/testcase/generation.js";
import { TestCaseStore, type TestCaseStoreOptions } from "../src/features/testcase/store.js";
import type { GenerateJobRecord, JsonObject, TestSetRecord } from "../src/features/testcase/types.js";

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
  setJobSecretCrypto(null);
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
    // 注入密钥上下文：密钥剥离成功后由写盘失败触发终态失败（测的是写盘失败路径而非缺密钥）
    setJobSecretCrypto(createSecretCrypto({ masterKeyBase64: Buffer.alloc(32, 5).toString("base64") }));
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

  it("upsertTestSet 能够保存并持久化 executionStatus 字典", () => {
    const store = createStore();
    const testSet = makeTestSet();
    store.upsertTestSet(testSet);

    const updated = store.upsertTestSet({
      ...testSet,
      executionStatus: {
        TC001: {
          status: "passed",
          updatedAt: "2026-09-10T10:00:00.000Z",
        },
        TC002: {
          status: "failed",
          bugId: "BUG-001",
          note: "万能密码未被拦截，返回200",
          updatedAt: "2026-09-10T10:05:00.000Z",
        },
      },
    });

    expect(updated.executionStatus?.TC001?.status).toBe("passed");
    expect(updated.executionStatus?.TC002?.status).toBe("failed");
    expect(updated.executionStatus?.TC002?.bugId).toBe("BUG-001");

    const fetched = store.getTestSet("set_1");
    expect(fetched?.executionStatus?.TC001?.status).toBe("passed");
    expect(fetched?.executionStatus?.TC002?.bugId).toBe("BUG-001");
  });
});

describe("任务密钥剥离（JSON 文件持久化）", () => {
  const secret = createSecretCrypto({ masterKeyBase64: Buffer.alloc(32, 9).toString("base64") });

  function createStoreAt(path: string) {
    return new TestCaseStore(path, { persistDebounceMs: 0 });
  }

  it("落盘剥离 request 内 apiKey 明文，重载还原（文件只存占位+信封，重落盘仍无明文）", () => {
    setJobSecretCrypto(secret);
    const dir = mkdtempSync(join(tmpdir(), "testcase-secret-"));
    tempDirs.push(dir);
    const path = join(dir, "store.json");

    const store = createStoreAt(path);
    const job = makeJob();
    job.request = {
      context: "登录",
      ai_config: { baseUrl: "https://ai.test/v1", apiKey: "sk-plain-9999", model: "m" },
    };
    store.createJob(job);

    // 文件侧：无明文、占位串 + api_key_enc 信封随记录存
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain("sk-plain-9999");
    expect(raw).toContain(SECRET_REF_PLACEHOLDER);
    const persisted = JSON.parse(raw) as { generationJobs: GenerateJobRecord[] };
    expect(persisted.generationJobs[0]?.apiKeyEnc).toMatch(/^v1:/);
    expect(persisted.generationJobs[0]?.apiKeyEnc).not.toContain("sk-plain-9999");

    // 重载：内存态还原出明文，文件仍是信封；再次落盘保持剥离
    const reloaded = createStoreAt(path);
    const restored = reloaded.getJob("job_1");
    expect((restored?.request.ai_config as JsonObject).apiKey).toBe("sk-plain-9999");
    reloaded.updateJob("job_1", { status: "completed" });
    const rawAfter = readFileSync(path, "utf8");
    expect(rawAfter).not.toContain("sk-plain-9999");
    expect(rawAfter).toContain(SECRET_REF_PLACEHOLDER);
  });

  it("占位+信封但缺 SecretCrypto 时保留占位（不误报明文，落盘沿用原信封）", () => {
    setJobSecretCrypto(secret);
    const dir = mkdtempSync(join(tmpdir(), "testcase-secret-"));
    tempDirs.push(dir);
    const path = join(dir, "store.json");

    const store = createStoreAt(path);
    const job = makeJob();
    job.request = { aiConfig: { apiKey: "sk-laya-7777", model: "m" } };
    store.createJob(job);
    const firstEnvelope = (JSON.parse(readFileSync(path, "utf8")) as { generationJobs: GenerateJobRecord[] }).generationJobs[0]?.apiKeyEnc;
    expect(firstEnvelope).toMatch(/^v1:/);

    // 未注入密钥时重载：占位保持、信封沿用，再落盘不丢密钥
    setJobSecretCrypto(null);
    const reloaded = createStoreAt(path);
    expect((reloaded.getJob("job_1")?.request.aiConfig as JsonObject).apiKey).toBe(SECRET_REF_PLACEHOLDER);
    reloaded.updateJob("job_1", { status: "failed", error: "x" });
    const persisted = (JSON.parse(readFileSync(path, "utf8")) as { generationJobs: GenerateJobRecord[] }).generationJobs[0];
    expect(persisted?.apiKeyEnc).toBe(firstEnvelope);
    expect((persisted?.request.aiConfig as JsonObject).apiKey).toBe(SECRET_REF_PLACEHOLDER);
  });
});
