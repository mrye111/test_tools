import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalysisRepository } from "./repository.js";

vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { createRequirementV2Tools } from "./mcp-tools.js";
import { __setRepoForTest } from "./jobs.js";

const mockStream = vi.mocked(streamChatCompletionParts);
const tools = createRequirementV2Tools();
const startTool = tools.find((t) => t.name === "start_requirement_analysis")!;
const getTool = tools.find((t) => t.name === "get_requirement_analysis")!;

const AI_ARGS = { baseUrl: "http://ai.test/v1", apiKey: "test-key", model: "test-model" };

const PASS_ONE = JSON.stringify({
  title: "登录需求分析",
  requirements: [{ id: "r1", parentId: null, level: 0, text: "账号锁定" }],
  issues: [],
  criteria: [],
});
const BATCH = JSON.stringify({ conditions: [{ reqId: "r1", text: "5 次错误锁定", kind: "normal" }] });

beforeEach(() => {
  mockStream.mockReset();
  __setRepoForTest(new MemoryAnalysisRepository());
});

describe("requirement-v2 MCP 工具", () => {
  it("发起→查询：完成后带完整分析包与记录 id", async () => {
    for (const text of [PASS_ONE, BATCH]) {
      mockStream.mockImplementationOnce(async function* () {
        yield { type: "content" as const, text };
      });
    }

    const started = startTool.execute({ ...AI_ARGS, sourceText: "用户登录：连续输错密码后账号锁定。" }, null as never);
    if (!started.ok || !started.data) throw new Error("发起失败");
    const jobId = (started.data as { jobId: string }).jobId;

    // 后台任务异步完成，轮询直至 done
    let result = getTool.execute({ jobId }, null as never);
    for (let i = 0; i < 50 && result.ok && (result as { data?: { status: string } }).data?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      result = getTool.execute({ jobId }, null as never);
    }

    expect(result.ok).toBe(true);
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("done");
    expect(data.conditionCount).toBe(1);
    expect(typeof data.recordId).toBe("string");
    expect((data.detail as { requirements: unknown[] }).requirements).toHaveLength(1);
  });

  it("参数校验：缺 sourceText / 缺模型配置 / 未知 jobId", () => {
    expect(startTool.execute({ ...AI_ARGS, sourceText: "  " }, null as never)).toMatchObject({ ok: false, error: { code: "invalid-args" } });
    expect(startTool.execute({ sourceText: "x", baseUrl: "", apiKey: "", model: "" }, null as never)).toMatchObject({ ok: false, error: { code: "invalid-args" } });
    expect(getTool.execute({ jobId: "nope" }, null as never)).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("分析失败的任务查询返回 execution-error", async () => {
    mockStream.mockImplementation(async function* () {
      yield { type: "content" as const, text: "不是 JSON" };
    });
    const started = startTool.execute({ ...AI_ARGS, sourceText: "登录" }, null as never);
    if (!started.ok || !started.data) throw new Error("发起失败");
    const jobId = (started.data as { jobId: string }).jobId;
    let result = getTool.execute({ jobId }, null as never);
    for (let i = 0; i < 50 && result.ok && (result as { data?: { status: string } }).data?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      result = getTool.execute({ jobId }, null as never);
    }
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("execution-error");
  });
});
