import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRepository, SessionFile } from "./types.js";
import { MemoryChatRepository } from "./repository.js";
import { runChatTurn } from "./service.js";
import type { RequirementNode } from "../types.js";
import type { AgentTemplate } from "./types.js";
import type { AiRequestConfig } from "../../testcase/types.js";

const aiConfig: AiRequestConfig = {
  provider: "codex",
  endpointType: "openai_chat",
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
  isLocalModel: false,
};

// mock AI 模块（参考 board-ai.test.ts 写法）
vi.mock("../ai.js", async () => {
  const actual = await vi.importActual<typeof import("../ai.js")>("../ai.js");
  return { ...actual, analyzeRequirementText: vi.fn() };
});
vi.mock("../board-ai.js", async () => {
  const actual = await vi.importActual<typeof import("../board-ai.js")>(
    "../board-ai.js",
  );
  return { ...actual, generateBoardChartDraft: vi.fn() };
});

import { analyzeRequirementText } from "../ai.js";
import { generateBoardChartDraft } from "../board-ai.js";

type SseEvent = { name: string; data: unknown };

const mockedAnalyze = vi.mocked(analyzeRequirementText);
const mockedBoard = vi.mocked(generateBoardChartDraft);

function makeEmitter() {
  const events: SseEvent[] = [];
  const emit = (name: string, data: unknown) => {
    events.push({ name, data });
  };
  return { events, emit };
}

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

async function streamResultEvents(
  result: ReturnType<typeof makeAnalysisResult>,
  onEvent?: (event: { type: "reasoning" | "content"; text: string }) => void,
) {
  onEvent?.({ type: "reasoning", text: "思考中" });
  onEvent?.({ type: "content", text: JSON.stringify(result) });
  return result;
}

async function streamError(
  error: Error,
  _text: string,
  onEvent?: (event: { type: "reasoning" | "content"; text: string }) => void,
): Promise<never> {
  onEvent?.({ type: "reasoning", text: "思考中" });
  throw error;
}

async function getSessionFilesByMessage(
  repo: ChatRepository,
  sessionId: string,
) {
  if (repo instanceof MemoryChatRepository) {
    return Array.from(
      (repo as unknown as { sessionFiles: Map<string, SessionFile> })
        .sessionFiles.values(),
    ).filter((f) => f.sessionId === sessionId);
  }
  return [];
}

describe("runChatTurn", () => {
  let repo: MemoryChatRepository;

  beforeEach(() => {
    repo = new MemoryChatRepository();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("无 sessionId + mindmap 首轮：依次发出 session/stage/stream/file/message/end，并落库", async () => {
    mockedAnalyze.mockImplementation(async (_config, _text, onEvent) => {
      return streamResultEvents(makeAnalysisResult("登录需求"), onEvent);
    });

    const { events, emit } = makeEmitter();
    const result = await runChatTurn({
      repo,
      sessionId: null,
      agentTemplate: "mindmap",
      text: "用户通过手机号和验证码登录",
      aiConfig,
      emit,
    });

    expect(result.sessionId).toMatch(/^sess_/);
    expect(result.messageId).toMatch(/^msg_/);
    expect(result.file).not.toBeNull();

    const names = events.map((e) => e.name);
    expect(names).toEqual([
      "session",
      "stage",
      "stream",
      "stream",
      "file",
      "message",
      "end",
    ]);

    const sessionEvent = events[0].data as {
      id: string;
      title: string;
      agentTemplate: AgentTemplate;
    };
    expect(sessionEvent.id).toBe(result.sessionId);
    expect(sessionEvent.title).toBe("用户通过手机号和验证码登录");
    expect(sessionEvent.agentTemplate).toBe("mindmap");

    expect(events[1].data).toEqual({ stage: "analyzing" });

    const streamEvents = events.filter((e) => e.name === "stream");
    expect(streamEvents[0].data).toEqual({ kind: "reasoning", text: "思考中" });
    expect(streamEvents[1].data).toEqual({
      kind: "content",
      text: expect.stringContaining("登录需求"),
    });

    const fileEvent = events.find((e) => e.name === "file")!.data as {
      sessionFileId: string;
      kind: AgentTemplate;
      title: string;
    };
    expect(fileEvent.sessionFileId).toBe(result.file!.id);
    expect(fileEvent.kind).toBe("mindmap");
    expect(fileEvent.title).toBe("登录需求");

    const messageEvent = events.find((e) => e.name === "message")!.data as {
      id: string;
      role: "assistant";
      status: "done";
    };
    expect(messageEvent.id).toBe(result.messageId);
    expect(messageEvent.role).toBe("assistant");
    expect(messageEvent.status).toBe("done");

    expect(events[events.length - 1].data).toEqual({ ok: true });

    // 落库断言
    const session = await repo.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session?.title).toBe("用户通过手机号和验证码登录");

    const messages = await repo.listMessages(result.sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("用户通过手机号和验证码登录");
    expect(messages[0].status).toBe("done");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].status).toBe("done");
    expect(messages[1].reasoning).toBe("思考中");

    const files = await getSessionFilesByMessage(repo, result.sessionId);
    expect(files).toHaveLength(1);
    expect(files[0].kind).toBe("mindmap");
    expect(files[0].title).toBe("登录需求");
    expect(files[0].payload).toEqual({
      tree: { id: "n1", title: "登录需求", children: [] },
      findings: [
        { id: "f1", type: "risk", title: "风险", detail: "说明", nodeId: "n1" },
      ],
      sourceText: "用户通过手机号和验证码登录",
      board: null,
    });
  });

  it("有 sessionId + cause-effect 追问：不发 session，产物 kind=cause-effect，上下文含已有文件标题与最近消息", async () => {
    const session = await repo.createSession({
      title: "已有会话",
      agentTemplate: "mindmap",
    });
    await repo.createMessage({
      sessionId: session.id,
      role: "user",
      content: "第一轮需求",
      status: "done",
    });
    const assistantMsg = await repo.createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "已完成分析",
      status: "done",
    });
    const firstFile = await repo.createSessionFile({
      sessionId: session.id,
      messageId: assistantMsg.id,
      kind: "mindmap",
      title: "登录需求",
      payload: { tree: {} },
    });

    mockedBoard.mockResolvedValue({ nodes: [{ id: "c1", text: "原因" }] });

    const { events, emit } = makeEmitter();
    const result = await runChatTurn({
      repo,
      sessionId: session.id,
      agentTemplate: "cause-effect",
      text: "请画因果图",
      aiConfig,
      emit,
    });

    expect(result.sessionId).toBe(session.id);
    expect(result.file).not.toBeNull();

    const names = events.map((e) => e.name);
    expect(names).not.toContain("session");
    expect(names).toContain("file");
    expect(names).toContain("message");
    expect(names[names.length - 1]).toBe("end");

    const fileEvent = events.find((e) => e.name === "file")!.data as {
      sessionFileId: string;
      kind: AgentTemplate;
      title: string;
    };
    expect(fileEvent.kind).toBe("cause-effect");
    expect(fileEvent.sessionFileId).toBe(result.file!.id);

    const callInput = mockedBoard.mock.calls[0][1];
    expect(callInput.chartKind).toBe("cause-effect");
    expect(callInput.nodeTitle).toBe("请画因果图");
    const ctx = callInput.nodeSubtreeText;
    expect(ctx).toContain("登录需求"); // 已有文件标题
    expect(ctx).toContain("user: 第一轮需求");
    expect(ctx).toContain("assistant: 已完成分析");
    expect(ctx).toContain("【本轮】\n请画因果图");

    // 消息关联同一个 session
    const messages = await repo.listMessages(session.id);
    expect(messages.map((m) => m.id)).toContain(result.messageId);
    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toBe("请画因果图");
    expect(messages[3].role).toBe("assistant");
    expect(messages[3].content).toBe("已生成因果图草稿，点击卡片查看。");
    expect(messages[3].status).toBe("done");

    const files = await getSessionFilesByMessage(repo, session.id);
    expect(files).toHaveLength(2);
    const newFile = files.find((f) => f.id !== firstFile.id)!;
    expect(newFile.kind).toBe("cause-effect");
    expect(newFile.payload).toEqual({
      draft: { nodes: [{ id: "c1", text: "原因" }] },
    });
  });

  it("AI 抛错：error 事件 + end{ok:false}，assistant 消息 status=error，错误被 rethrow", async () => {
    mockedAnalyze.mockImplementation(async (_config, _text, onEvent) => {
      return streamError(new Error("AI 服务不可用"), _text, onEvent);
    });

    const { events, emit } = makeEmitter();
    await expect(
      runChatTurn({
        repo,
        sessionId: null,
        agentTemplate: "mindmap",
        text: "需求文本",
        aiConfig,
        emit,
      }),
    ).rejects.toThrow("AI 服务不可用");

    const errorEvent = events.find((e) => e.name === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.data).toMatchObject({
      message: expect.stringContaining("AI 服务不可用"),
    });
    expect(events[events.length - 1].data).toEqual({ ok: false });

    const sessionEvent = events.find((e) => e.name === "session");
    expect(sessionEvent).toBeDefined();
    const sessionId = (sessionEvent?.data as { id: string }).id;

    const messages = await repo.listMessages(sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].status).toBe("error");
    expect(messages[1].content).toContain("AI 服务不可用");
  });

  it("signal abort：消息被标记为 error 并 rethrow AbortError", async () => {
    const abortError = new Error(" aborted");
    abortError.name = "AbortError";
    mockedAnalyze.mockImplementation(async (_config, _text, onEvent, signal) => {
      if (signal?.aborted) throw abortError;
      onEvent?.({ type: "reasoning", text: "开始" });
      throw abortError;
    });

    const controller = new AbortController();
    const { events, emit } = makeEmitter();
    await expect(
      runChatTurn({
        repo,
        sessionId: null,
        agentTemplate: "mindmap",
        text: "需求文本",
        aiConfig,
        emit,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");

    const sessionId = (events.find((e) => e.name === "session")?.data as {
      id: string;
    }).id;
    const messages = await repo.listMessages(sessionId);
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.status).toBe("error");
    expect(events[events.length - 1].data).toEqual({ ok: false });
  });

  it("图表模板：flowchart 生成并发出 file 事件，payload 为 { draft }", async () => {
    const session = await repo.createSession({
      title: "会话",
      agentTemplate: "mindmap",
    });
    await repo.createMessage({
      sessionId: session.id,
      role: "user",
      content: "流程",
      status: "done",
    });
    await repo.createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "好的",
      status: "done",
    });

    mockedBoard.mockResolvedValue({ nodes: [{ id: "start", text: "开始" }] });

    const { events, emit } = makeEmitter();
    const result = await runChatTurn({
      repo,
      sessionId: session.id,
      agentTemplate: "flowchart",
      text: "画流程图",
      aiConfig,
      emit,
    });

    const fileEvent = events.find((e) => e.name === "file")!.data as {
      kind: AgentTemplate;
    };
    expect(fileEvent.kind).toBe("flowchart");
    expect(result.file).not.toBeNull();
    const files = await getSessionFilesByMessage(repo, session.id);
    const flowchartFile = files.find((f) => f.kind === "flowchart")!;
    expect(flowchartFile.payload).toEqual({
      draft: { nodes: [{ id: "start", text: "开始" }] },
    });
  });
});
