/**
 * 生成任务运行时按引用解析（spec §4）：
 * request 的 ai_config 只带 cloudConfigId 时，运行起点经注入的解析器重取云端配置——
 * 明文只进内存态有效 request，持久化的 request 与落盘文件里永远只有引用。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGenerationJob, setJobAiConfigResolver } from "../src/features/testcase/generation.js";
import { TestCaseStore } from "../src/features/testcase/store.js";
import type { GenerateJobRecord, TestSetRecord } from "../src/features/testcase/types.js";

const tempDirs: string[] = [];

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), "testcase-gen-resolver-"));
  tempDirs.push(dir);
  return {
    store: new TestCaseStore(join(dir, "store.json"), { persistDebounceMs: 0 }),
    file: join(dir, "store.json"),
  };
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
    status: "queued",
    header: [],
    rows: [],
    createdAt: "2026-07-16T00:00:00.000Z",
    ownerId: null,
  };
}

function makeCloudRefJob(): GenerateJobRecord {
  return {
    id: "job_1",
    projectId: "proj_1",
    testSetId: "set_1",
    mode: "create",
    status: "queued",
    request: {
      mode: "create",
      projectId: "proj_1",
      testSetId: "set_1",
      featureName: "登录",
      context: "用户使用账号密码登录",
      testType: "functional",
      language: "zh",
      ai_config: { cloudConfigId: "cfg_1" },
      cloudConfigUserId: "user_1",
    },
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

const validCsv = [
  "用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
  'TC001,登录,正常登录,正确账密登录,高,用户已注册,"1. 打开登录页\\n2. 输入正确账密","1. 登录页正常显示\\n2. 登录成功"',
].join("\n");

function sseResponse(content: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  setJobAiConfigResolver(null);
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("生成任务云端引用解析", () => {
  it("运行起点按引用解析：AI 用解析出的密钥完成生成，持久化 request 仍只有 cloudConfigId", async () => {
    const { store, file } = createStore();
    store.upsertTestSet(makeTestSet());
    store.createJob(makeCloudRefJob());

    setJobAiConfigResolver(async (request) => ({
      ...request,
      ai_config: {
        baseUrl: "https://api.kimi.com/coding/v1",
        apiKey: "sk-cloud-key",
        model: "kimi-k2.7-code",
        apiFormat: "openai_chat",
      },
    }));

    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(sseResponse(validCsv));

    await runGenerationJob("job_1", store);

    const finished = store.getJob("job_1");
    expect(finished?.status).toBe("completed");
    expect(finished?.generatedCount).toBe(1);

    // AI 调用确实携带了解析出的云端密钥
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-cloud-key");

    // 内存态与落盘文件中的 request 都只有引用，无明文密钥
    expect(finished?.request.ai_config).toEqual({ cloudConfigId: "cfg_1" });
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toContain("sk-cloud-key");
    expect(onDisk).toContain("cfg_1");
  });

  it("解析器抛错（配置已删除/无权）→ 任务标记失败，未发起 AI 请求", async () => {
    const { store } = createStore();
    store.upsertTestSet(makeTestSet());
    store.createJob(makeCloudRefJob());

    setJobAiConfigResolver(async () => {
      throw new Error("云端模型配置不存在或无权使用");
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await runGenerationJob("job_1", store);

    const finished = store.getJob("job_1");
    expect(finished?.status).toBe("failed");
    expect(finished?.error).toContain("云端模型配置不存在或无权使用");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未注入解析器时云端引用任务失败关闭（不会拿空密钥发请求）", async () => {
    const { store } = createStore();
    store.upsertTestSet(makeTestSet());
    store.createJob(makeCloudRefJob());

    const fetchMock = vi.spyOn(globalThis, "fetch");

    await runGenerationJob("job_1", store);

    const finished = store.getJob("job_1");
    expect(finished?.status).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
