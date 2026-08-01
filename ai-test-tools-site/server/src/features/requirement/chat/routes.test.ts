import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import express from "express";
import type { ChatRepository } from "./types.js";
import { MemoryChatRepository } from "./repository.js";
import { registerChatRoutes } from "./routes.js";
import type { RequirementNode } from "../types.js";
import type { AiRequestConfig } from "../../testcase/types.js";

const aiConfig: AiRequestConfig = {
  provider: "codex",
  endpointType: "openai_chat",
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
  isLocalModel: false,
};

// mock AI 模块
vi.mock("../ai.js", async () => {
  const actual = await vi.importActual<typeof import("../ai.js")>("../ai.js");
  return { ...actual, analyzeRequirementText: vi.fn() };
});
vi.mock("../board-ai.js", async () => {
  const actual = await vi.importActual<typeof import("../board-ai.js")>("../board-ai.js");
  return { ...actual, generateBoardChartDraft: vi.fn() };
});

import { analyzeRequirementText } from "../ai.js";

const mockedAnalyze = vi.mocked(analyzeRequirementText);

function makeAnalysisResult(title: string) {
  const tree: RequirementNode = { id: "n1", title, children: [] };
  return {
    title,
    tree,
    findings: [
      {
        id: "f1",
        type: "risk" as const,
        title: "风险",
        detail: "说明",
        nodeId: "n1",
      },
    ],
  };
}

async function createApp(repo: ChatRepository): Promise<Express> {
  const app = express();
  app.use(express.json());
  registerChatRoutes(app, repo);
  return app;
}

async function fetchJson(
  app: Express,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      fetch(`http://localhost:${port}${path}`, {
        method: options?.method ?? "GET",
        headers: { "Content-Type": "application/json" },
        body: options?.body ? JSON.stringify(options.body) : undefined,
      })
        .then(async (res) => {
          const json = await res.json();
          server.close(() => resolvePromise({ status: res.status, json }));
        })
        .catch((error) => {
          server.close(() => reject(error));
        });
    });
  });
}

async function fetchSse(
  app: Express,
  path: string,
  body: unknown,
): Promise<{ status: number; events: Array<{ event: string; data: unknown }> }> {
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      fetch(`http://localhost:${port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const text = await res.text();
          const events: Array<{ event: string; data: unknown }> = [];
          const chunks = text.split("\n\n").filter(Boolean);
          for (const chunk of chunks) {
            const lines = chunk.split("\n");
            let event = "";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) event = line.slice(7);
              else if (line.startsWith("data: ")) data += (data ? "\n" : "") + line.slice(6);
            }
            if (event) {
              try {
                events.push({ event, data: data ? JSON.parse(data) : null });
              } catch {
                events.push({ event, data });
              }
            }
          }
          server.close(() => resolvePromise({ status: res.status, events }));
        })
        .catch((error) => {
          server.close(() => reject(error));
        });
    });
  });
}

describe("registerChatRoutes", () => {
  let repo: MemoryChatRepository;

  beforeEach(() => {
    repo = new MemoryChatRepository();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET /sessions 按 updatedAt 倒序返回前 50", async () => {
    const s1 = await repo.createSession({ title: "A", agentTemplate: "mindmap" });
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await repo.createSession({ title: "B", agentTemplate: "mindmap" });

    const app = await createApp(repo);
    const { status, json } = await fetchJson(app, "/api/requirement-analysis/sessions");

    expect(status).toBe(200);
    const response = json as { success: boolean; sessions: Array<{ id: string; title: string }> };
    expect(response.success).toBe(true);
    expect(response.sessions.map((s) => s.id)).toEqual([s2.id, s1.id]);
  });

  it("POST /chat 无 sessionId 创建新会话并返回 SSE 事件序列", async () => {
    mockedAnalyze.mockImplementation(async (_config, _text, onEvent) => {
      onEvent?.({ type: "reasoning", text: "思考中" });
      onEvent?.({ type: "content", text: JSON.stringify(makeAnalysisResult("登录需求")) });
      return makeAnalysisResult("登录需求");
    });

    const app = await createApp(repo);
    const { status, events } = await fetchSse(app, "/api/requirement-analysis/chat", {
      agentTemplate: "mindmap",
      text: "用户通过手机号登录",
      ai_config: aiConfig,
    });

    expect(status).toBe(200);
    const names = events.map((e) => e.event);
    expect(names).toContain("session");
    expect(names).toContain("stage");
    expect(names).toContain("stream");
    expect(names).toContain("file");
    expect(names).toContain("message");
    expect(names[names.length - 1]).toBe("end");
    const endEvent = events[events.length - 1];
    expect(endEvent.data).toEqual({ ok: true });
  });

  it("POST /chat 无 sessionId 但 text 超长返回 400", async () => {
    const app = await createApp(repo);
    const { status, json } = await fetchJson(app, "/api/requirement-analysis/chat", {
      method: "POST",
      body: { agentTemplate: "mindmap", text: "x".repeat(20001), ai_config: aiConfig },
    });
    expect(status).toBe(400);
    const response = json as { success: boolean; error: string };
    expect(response.success).toBe(false);
    expect(response.error).toContain("20000");
  });

  it("POST /chat 非法 agentTemplate 返回 400", async () => {
    const app = await createApp(repo);
    const { status, json } = await fetchJson(app, "/api/requirement-analysis/chat", {
      method: "POST",
      body: { agentTemplate: "invalid", text: "需求", ai_config: aiConfig },
    });
    expect(status).toBe(400);
    const response = json as { success: boolean; error: string };
    expect(response.success).toBe(false);
    expect(response.error).toContain("agentTemplate");
  });

  it("POST /chat sessionId 不存在返回 404", async () => {
    const app = await createApp(repo);
    const { status, json } = await fetchJson(app, "/api/requirement-analysis/chat", {
      method: "POST",
      body: { sessionId: "sess_missing", agentTemplate: "mindmap", text: "需求", ai_config: aiConfig },
    });
    expect(status).toBe(404);
    const response = json as { success: boolean; error: string };
    expect(response.success).toBe(false);
    expect(response.error).toContain("会话不存在");
  });

  it("GET /session-files/:id 返回 payload", async () => {
    const session = await repo.createSession({ title: "S", agentTemplate: "mindmap" });
    const msg = await repo.createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "x",
      status: "done",
    });
    const file = await repo.createSessionFile({
      sessionId: session.id,
      messageId: msg.id,
      kind: "mindmap",
      title: "M",
      payload: { board: { a: 1 } },
    });

    const app = await createApp(repo);
    const { status, json } = await fetchJson(app, `/api/requirement-analysis/session-files/${file.id}`);

    expect(status).toBe(200);
    const response = json as { success: boolean; file: { payload: unknown } };
    expect(response.success).toBe(true);
    expect(response.file.payload).toEqual({ board: { a: 1 } });
  });

  it("POST save-to-library 幂等：二次 200 + count 不变", async () => {
    const session = await repo.createSession({ title: "S", agentTemplate: "mindmap" });
    const msg = await repo.createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "x",
      status: "done",
    });
    const file = await repo.createSessionFile({
      sessionId: session.id,
      messageId: msg.id,
      kind: "mindmap",
      title: "M",
      payload: { tree: {} },
    });

    const app = await createApp(repo);
    const first = await fetchJson(app, `/api/requirement-analysis/session-files/${file.id}/save-to-library`, {
      method: "POST",
    });
    expect(first.status).toBe(200);
    const firstJson = first.json as { success: boolean; libraryFileId: string; libraryCount: number };
    expect(firstJson.success).toBe(true);
    expect(firstJson.libraryCount).toBe(1);

    const second = await fetchJson(app, `/api/requirement-analysis/session-files/${file.id}/save-to-library`, {
      method: "POST",
    });
    expect(second.status).toBe(200);
    const secondJson = second.json as { success: boolean; libraryCount: number };
    expect(secondJson.success).toBe(true);
    expect(secondJson.libraryCount).toBe(1);
  });

  it("DELETE /sessions/:id 后 GET /library/files 仍在", async () => {
    const session = await repo.createSession({ title: "S", agentTemplate: "mindmap" });
    const msg = await repo.createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "x",
      status: "done",
    });
    const file = await repo.createSessionFile({
      sessionId: session.id,
      messageId: msg.id,
      kind: "mindmap",
      title: "M",
      payload: { tree: {} },
    });
    await repo.createLibraryFile(file);
    await repo.markSavedToLibrary(file.id);

    const app = await createApp(repo);
    await fetchJson(app, `/api/requirement-analysis/sessions/${session.id}`, { method: "DELETE" });

    const { status, json } = await fetchJson(app, "/api/requirement-analysis/library/files");
    expect(status).toBe(200);
    const response = json as { success: boolean; files: unknown[] };
    expect(response.success).toBe(true);
    expect(response.files).toHaveLength(1);
  });
});
