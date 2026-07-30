import { randomUUID } from "crypto";
import {
  type ChatMessage,
  type ChatRepository,
  type ChatSession,
  type CreateMessageInput,
  type CreateSessionFileInput,
  type CreateSessionInput,
  type LibraryFile,
  type MessageStatus,
  type SessionFile,
  MAX_LIBRARY_FILES,
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSION_FILES_PER_SESSION,
} from "./types.js";

/** 深拷贝对象（仅支持 JSON 可序列化结构） */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function now(): Date {
  return new Date();
}

function newId(prefix: string): string {
  return `${prefix}${randomUUID()}`;
}

/**
 * 内存版 ChatRepository：Map 存储四组实体，deleteSession 手动级联，
 * createLibraryFile 深拷贝快照。
 */
export class MemoryChatRepository implements ChatRepository {
  private sessions = new Map<string, ChatSession>();
  private messages = new Map<string, ChatMessage>();
  private sessionFiles = new Map<string, SessionFile>();
  private libraryFiles = new Map<string, LibraryFile>();

  // 会话
  async listSessions(limit = 50): Promise<ChatSession[]> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
      .map((s) => deepClone(s));
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const found = this.sessions.get(id);
    return found ? deepClone(found) : null;
  }

  async createSession(input: CreateSessionInput): Promise<ChatSession> {
    const time = now();
    const session: ChatSession = {
      id: newId("sess_"),
      title: input.title,
      agentTemplate: input.agentTemplate,
      createdAt: time,
      updatedAt: time,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async renameSession(id: string, title: string): Promise<ChatSession> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new Error(`会话不存在: ${id}`);
    }
    const updated: ChatSession = { ...existing, title, updatedAt: now() };
    this.sessions.set(id, updated);
    return updated;
  }

  async deleteSession(id: string): Promise<void> {
    // 手动级联：先删本会话的消息，再删本会话的会话文件，不碰文件库
    for (const [msgId, msg] of this.messages) {
      if (msg.sessionId === id) {
        this.messages.delete(msgId);
      }
    }
    for (const [fileId, file] of this.sessionFiles) {
      if (file.sessionId === id) {
        this.sessionFiles.delete(fileId);
      }
    }
    this.sessions.delete(id);
  }

  // 消息
  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => deepClone(m));
  }

  async createMessage(input: CreateMessageInput): Promise<ChatMessage> {
    if (!this.sessions.has(input.sessionId)) {
      throw new Error(`会话不存在: ${input.sessionId}`);
    }
    const count = await this.countMessages(input.sessionId);
    if (count >= MAX_MESSAGES_PER_SESSION) {
      throw new Error(
        `会话消息数已达上限 ${MAX_MESSAGES_PER_SESSION}，无法继续创建`,
      );
    }
    const message: ChatMessage = {
      id: newId("msg_"),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      reasoning: input.reasoning ?? null,
      status: input.status,
      createdAt: now(),
    };
    this.messages.set(message.id, message);
    return message;
  }

  async updateMessageStatus(
    id: string,
    status: MessageStatus,
  ): Promise<ChatMessage> {
    const existing = this.messages.get(id);
    if (!existing) {
      throw new Error(`消息不存在: ${id}`);
    }
    const updated: ChatMessage = { ...existing, status };
    this.messages.set(id, updated);
    return updated;
  }

  private async countMessages(sessionId: string): Promise<number> {
    return Array.from(this.messages.values()).filter(
      (m) => m.sessionId === sessionId,
    ).length;
  }

  // 会话文件
  async getSessionFile(id: string): Promise<SessionFile | null> {
    const found = this.sessionFiles.get(id);
    return found ? deepClone(found) : null;
  }

  async createSessionFile(
    input: CreateSessionFileInput,
  ): Promise<SessionFile> {
    if (!this.sessions.has(input.sessionId)) {
      throw new Error(`会话不存在: ${input.sessionId}`);
    }
    if (!this.messages.has(input.messageId)) {
      throw new Error(`消息不存在: ${input.messageId}`);
    }
    const count = await this.countSessionFiles(input.sessionId);
    if (count >= MAX_SESSION_FILES_PER_SESSION) {
      throw new Error(
        `会话文件数已达上限 ${MAX_SESSION_FILES_PER_SESSION}，无法继续创建`,
      );
    }
    const time = now();
    const file: SessionFile = {
      id: newId("sf_"),
      sessionId: input.sessionId,
      messageId: input.messageId,
      kind: input.kind,
      title: input.title,
      payload: deepClone(input.payload),
      savedToLibrary: false,
      createdAt: time,
      updatedAt: time,
    };
    this.sessionFiles.set(file.id, file);
    return file;
  }

  async updateSessionFileBoard(
    id: string,
    board: unknown,
  ): Promise<SessionFile> {
    const existing = this.sessionFiles.get(id);
    if (!existing) {
      throw new Error(`会话文件不存在: ${id}`);
    }
    const updated: SessionFile = {
      ...existing,
      payload: deepClone(board),
      updatedAt: now(),
    };
    this.sessionFiles.set(id, updated);
    return updated;
  }

  async countSessionFiles(sessionId: string): Promise<number> {
    return Array.from(this.sessionFiles.values()).filter(
      (f) => f.sessionId === sessionId,
    ).length;
  }

  // 文件库
  async listLibraryFiles(): Promise<LibraryFile[]> {
    return Array.from(this.libraryFiles.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((f) => deepClone(f));
  }

  async getLibraryFile(id: string): Promise<LibraryFile | null> {
    const found = this.libraryFiles.get(id);
    return found ? deepClone(found) : null;
  }

  async createLibraryFile(source: SessionFile): Promise<LibraryFile> {
    if (this.libraryFiles.size >= MAX_LIBRARY_FILES) {
      throw new Error(
        `文件库数量已达上限 ${MAX_LIBRARY_FILES}，无法继续创建`,
      );
    }
    const session = this.sessions.get(source.sessionId);
    const time = now();
    const library: LibraryFile = {
      id: newId("lf_"),
      kind: source.kind,
      title: source.title,
      payload: deepClone(source.payload),
      sourceSessionTitle: session?.title ?? null,
      createdAt: time,
      updatedAt: time,
    };
    this.libraryFiles.set(library.id, library);
    return deepClone(library);
  }

  async deleteLibraryFile(id: string): Promise<void> {
    this.libraryFiles.delete(id);
  }

  async countLibraryFiles(): Promise<number> {
    return this.libraryFiles.size;
  }

  async markSavedToLibrary(sessionFileId: string): Promise<SessionFile> {
    const existing = this.sessionFiles.get(sessionFileId);
    if (!existing) {
      throw new Error(`会话文件不存在: ${sessionFileId}`);
    }
    const updated: SessionFile = { ...existing, savedToLibrary: true };
    this.sessionFiles.set(sessionFileId, updated);
    return updated;
  }
}
