import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpExpressApp } from "../src/express-app.js";

const runtimeConfig = {
  provider: "codex",
  endpointType: "openai_chat",
  baseUrl: "http://ai.test/v1",
  apiKey: "secret-key",
  model: "test-model",
};

const analysisPayload = JSON.stringify({
  title: "登录需求",
  tree: { id: "root", title: "登录需求", children: [{ id: "m1", title: "登录模块", children: [] }] },
  findings: [{ type: "risk", title: "验证码暴力破解", detail: "未说明错误次数限制", nodeId: "m1" }],
});

/** 新管道走流式 SSE 解析：mock 统一供应商返回 chat.completion chunk 帧序列。 */
function aiSseResponse(deltas: Array<Record<string, unknown>> = [{ content: analysisPayload }]) {
  const frames = deltas
    .map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
    .join("");
  return new Response(`${frames}data: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function anthropicJsonResponse() {
  return new Response(JSON.stringify({ content: [{ type: "text", text: analysisPayload }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  // express-app 工厂在 T6 改为 async（chat 域启动接线），需 await 后再 listen
  const app = await createMcpExpressApp();
  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }
}

async function postFileAnalyze(baseUrl: string, headers: Record<string, string>) {
  const response = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-file-name": encodeURIComponent("PRD(1).md"),
      ...headers,
    },
    body: "# 登录需求\n用户通过手机号+验证码登录，验证码 5 分钟内有效。",
  });
  return response.text();
}

function aiConfigHeader(config: Record<string, unknown>) {
  return { "x-ai-config": encodeURIComponent(JSON.stringify(config)) };
}

describe("POST /api/requirement-analysis/analyze（文件上传）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("回归：octet-stream 上传时从 x-ai-config 头读取供应商配置，而不是把文件 Buffer 当作配置", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("ai.test")) return aiSseResponse();
      return originalFetch(input, init);
    });

    await withServer(async (baseUrl) => {
      const body = await postFileAnalyze(baseUrl, aiConfigHeader(runtimeConfig));
      // 修复前：文件 Buffer 被误当配置对象，apiKey 丢失，报 api_key is required
      expect(body).not.toContain("api_key is required");
      expect(body).toContain('"stage":"analyzing"');
      expect(body).toContain("event: result");
      expect(body).toContain("登录模块");
    });

    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("ai.test"))).toBe(true);
  });

  it("缺少 x-ai-config 头时返回 api_key 错误事件", async () => {
    await withServer(async (baseUrl) => {
      const body = await postFileAnalyze(baseUrl, {});
      expect(body).toContain("api_key is required");
    });
  });

  it("流式片段桥接为 stream 事件并按 kind 合帧（多个 delta 合并为少量 SSE 帧）", async () => {
    const originalFetch = globalThis.fetch;
    const reasoningChunks = ["先", "拆", "解", "需", "求"];
    const splitAt = Math.floor(analysisPayload.length / 2);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("ai.test")) {
        return aiSseResponse([
          ...reasoningChunks.map((text) => ({ reasoning_content: text })),
          { content: analysisPayload.slice(0, splitAt) },
          { content: analysisPayload.slice(splitAt) },
        ]);
      }
      return originalFetch(input, init);
    });

    await withServer(async (baseUrl) => {
      const body = await postFileAnalyze(baseUrl, aiConfigHeader(runtimeConfig));
      expect(body).toContain("event: stream");
      expect(body).toContain('"kind":"reasoning"');
      expect(body).toContain('"kind":"content"');
      // 7 个上游 delta 经 ~90ms 合帧后远少于 7 个 SSE 帧。
      const streamFrameCount = (body.match(/event: stream/g) ?? []).length;
      expect(streamFrameCount).toBeGreaterThan(0);
      expect(streamFrameCount).toBeLessThan(7);
      expect(body).toContain("event: result");
    });
  });

  it("空正文（只有 reasoning）重试时发出 attempt 分隔事件", async () => {
    const originalFetch = globalThis.fetch;
    let aiCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("ai.test")) {
        aiCalls += 1;
        return aiCalls === 1
          ? aiSseResponse([{ reasoning_content: "思考占满了输出额度……" }])
          : aiSseResponse();
      }
      return originalFetch(input, init);
    });

    await withServer(async (baseUrl) => {
      const body = await postFileAnalyze(baseUrl, aiConfigHeader(runtimeConfig));
      expect(body).toContain("event: attempt");
      expect(body).toContain("输出不完整，正在提高额度重试");
      expect(body).toContain("event: result");
    });
  });

  it("anthropic 格式在分析阶段发一次不支持过程输出的 notice，结果不受影响", async () => {
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("ai.test")) return anthropicJsonResponse();
      return originalFetch(input, init);
    });

    await withServer(async (baseUrl) => {
      const body = await postFileAnalyze(baseUrl, aiConfigHeader({
        ...runtimeConfig,
        provider: "claude",
        endpointType: "anthropic",
        model: "claude-test",
      }));
      expect(body).toContain('"kind":"notice"');
      expect(body).toContain("当前模型格式不支持过程输出，请耐心等待");
      expect(body).toContain("event: result");
      expect(body).toContain("登录模块");
    });
  });
});
