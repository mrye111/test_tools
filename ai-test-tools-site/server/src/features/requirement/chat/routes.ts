import type { Express, Request, Response } from "express";
import { parseAiRequestConfig } from "../../testcase/ai.js";
import { isObject, text } from "../../testcase/utils.js";
import type { AgentTemplate, ChatRepository, ChatSession, LibraryFile, SessionFile } from "./types.js";
import { runChatTurn } from "./service.js";
import { beginSse, emit, endSse } from "./sse.js";

const AGENT_TEMPLATES: AgentTemplate[] = [
  "mindmap",
  "cause-effect",
  "decision-table",
  "orthogonal",
  "flowchart",
];

const MAX_CHAT_TEXT_LENGTH = 20000;

function body(req: Request): Record<string, unknown> {
  return isObject(req.body) ? req.body : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ok(res: Response, data: Record<string, unknown> = {}): void {
  res.json({ success: true, ...data });
}

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ success: false, error: message });
}

function isAgentTemplate(value: unknown): value is AgentTemplate {
  return typeof value === "string" && (AGENT_TEMPLATES as string[]).includes(value);
}

async function withSessionAndMessages(repo: ChatRepository, id: string): Promise<{ session: ChatSession; messages: unknown[] } | null> {
  const session = await repo.getSession(id);
  if (!session) return null;
  const rawMessages = await repo.listMessages(id);
  const files = await repo.listSessionFiles(id);
  const fileByMessageId = new Map(files.map((f) => [f.messageId, f]));
  const messages = rawMessages.map((m) => {
    const file = fileByMessageId.get(m.id);
    return {
      ...m,
      files: file ? [file] : [],
    };
  });
  return { session, messages };
}

export function registerChatRoutes(app: Express, repo: ChatRepository): void {
  // 会话列表
  app.get("/api/requirement-analysis/sessions", async (_req, res) => {
    try {
      const sessions = await repo.listSessions(50);
      ok(res, { sessions });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 会话详情（含消息 + 每条消息的 files）
  app.get("/api/requirement-analysis/sessions/:id", async (req, res) => {
    try {
      const result = await withSessionAndMessages(repo, req.params.id);
      if (!result) {
        fail(res, "会话不存在", 404);
        return;
      }
      ok(res, { session: result.session, messages: result.messages });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 重命名会话
  app.patch("/api/requirement-analysis/sessions/:id", async (req, res) => {
    try {
      const title = text(body(req).title).trim();
      if (!title) {
        fail(res, "title 不能为空");
        return;
      }
      const session = await repo.renameSession(req.params.id, title);
      ok(res, { session });
    } catch (error) {
      if (errorMessage(error).includes("会话不存在")) {
        fail(res, "会话不存在", 404);
        return;
      }
      fail(res, errorMessage(error), 500);
    }
  });

  // 删除会话（级联消息与会话文件，不碰文件库）
  app.delete("/api/requirement-analysis/sessions/:id", async (req, res) => {
    try {
      await repo.deleteSession(req.params.id);
      ok(res);
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 新建对话轮（SSE）
  app.post("/api/requirement-analysis/chat", async (req, res) => {
    const data = body(req);
    const textValue = text(data.text).trim();
    if (!textValue) {
      fail(res, "text 不能为空");
      return;
    }
    if (textValue.length > MAX_CHAT_TEXT_LENGTH) {
      fail(res, `text 长度不能超过 ${MAX_CHAT_TEXT_LENGTH} 字符`);
      return;
    }
    if (!isAgentTemplate(data.agentTemplate)) {
      fail(res, "agentTemplate 必须是 mindmap / cause-effect / decision-table / orthogonal / flowchart 之一");
      return;
    }

    // sessionId 校验：存在性
    let sessionId: string | null = null;
    if (data.sessionId !== undefined && data.sessionId !== null) {
      sessionId = String(data.sessionId);
      const session = await repo.getSession(sessionId);
      if (!session) {
        fail(res, "会话不存在", 404);
        return;
      }
    }

    beginSse(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    try {
      await runChatTurn({
        repo,
        sessionId,
        agentTemplate: data.agentTemplate,
        text: textValue,
        aiConfig: data.provider ?? data.ai_config ?? data.aiConfig ?? {},
        emit: (event, eventData) => emit(res, event, eventData),
        signal: abort.signal,
      });
      endSse(res, true);
    } catch (error) {
      emit(res, "error", { message: errorMessage(error) });
      endSse(res, false);
    }
  });

  // 取单个会话文件
  app.get("/api/requirement-analysis/session-files/:id", async (req, res) => {
    try {
      const file = await repo.getSessionFile(req.params.id);
      if (!file) {
        fail(res, "会话文件不存在", 404);
        return;
      }
      ok(res, { file });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 更新会话文件 board（整 payload 覆盖）
  app.patch("/api/requirement-analysis/session-files/:id", async (req, res) => {
    try {
      const board = body(req).board;
      if (board === undefined) {
        fail(res, "board 字段不能为空");
        return;
      }
      const file = await repo.updateSessionFileBoard(req.params.id, board);
      ok(res, { file });
    } catch (error) {
      if (errorMessage(error).includes("会话文件不存在")) {
        fail(res, "会话文件不存在", 404);
        return;
      }
      fail(res, errorMessage(error), 500);
    }
  });

  // 保存会话文件到文件库（幂等）
  app.post("/api/requirement-analysis/session-files/:id/save-to-library", async (req, res) => {
    try {
      const sessionFile = await repo.getSessionFile(req.params.id);
      if (!sessionFile) {
        fail(res, "会话文件不存在", 404);
        return;
      }
      if (sessionFile.savedToLibrary) {
        const count = await repo.countLibraryFiles();
        ok(res, { libraryCount: count });
        return;
      }
      const library = await repo.createLibraryFile({
        id: sessionFile.id,
        sessionId: sessionFile.sessionId,
        messageId: sessionFile.messageId,
        kind: sessionFile.kind,
        title: sessionFile.title,
        payload: sessionFile.payload,
        savedToLibrary: false,
        createdAt: sessionFile.createdAt,
        updatedAt: sessionFile.updatedAt,
      });
      await repo.markSavedToLibrary(sessionFile.id);
      const count = await repo.countLibraryFiles();
      ok(res, { libraryFileId: library.id, libraryCount: count });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 文件库列表
  app.get("/api/requirement-analysis/library/files", async (_req, res) => {
    try {
      const files = await repo.listLibraryFiles();
      ok(res, { files });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 文件库文件数量
  app.get("/api/requirement-analysis/library/count", async (_req, res) => {
    try {
      const count = await repo.countLibraryFiles();
      ok(res, { count });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 文件库详情
  app.get("/api/requirement-analysis/library/files/:id", async (req, res) => {
    try {
      const file = await repo.getLibraryFile(req.params.id);
      if (!file) {
        fail(res, "文件库文件不存在", 404);
        return;
      }
      ok(res, { file });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 更新文件库文件 board（整 payload 覆盖）
  app.patch("/api/requirement-analysis/library/files/:id", async (req, res) => {
    try {
      const board = body(req).board;
      if (board === undefined) {
        fail(res, "board 字段不能为空");
        return;
      }
      const file = await repo.updateLibraryFileBoard(req.params.id, board);
      ok(res, { file });
    } catch (error) {
      if (errorMessage(error).includes("文件库文件不存在")) {
        fail(res, "文件库文件不存在", 404);
        return;
      }
      fail(res, errorMessage(error), 500);
    }
  });

  // 删除文件库文件
  app.delete("/api/requirement-analysis/library/files/:id", async (req, res) => {
    try {
      await repo.deleteLibraryFile(req.params.id);
      ok(res);
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });
}
