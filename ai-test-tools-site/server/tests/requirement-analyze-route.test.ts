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

function aiJsonResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: analysisPayload } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createMcpExpressApp();
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

describe("POST /api/requirement-analysis/analyze（文件上传）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("回归：octet-stream 上传时从 x-ai-config 头读取供应商配置，而不是把文件 Buffer 当作配置", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("ai.test")) return aiJsonResponse();
      return originalFetch(input, init);
    });

    await withServer(async (baseUrl) => {
      const body = await postFileAnalyze(baseUrl, {
        "x-ai-config": encodeURIComponent(JSON.stringify(runtimeConfig)),
      });
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
});
