import { randomUUID } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  type AgentTemplate,
  type ChatMessage,
  type ChatRepository,
  type ChatSession,
  type CreateLibraryFileInput,
  type CreateMessageInput,
  type CreateSessionFileInput,
  type CreateSessionInput,
  type LibraryFile,
  type MessageRole,
  type MessageStatus,
  type SessionFile,
  MAX_LIBRARY_FILES,
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSION_FILES_PER_SESSION,
} from "./types.js";

/** 深拷贝对象，保留 Date 实例（仅支持 JSON 可序列化结构 + Date） */
function deepClone<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    result[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

function now(): Date {
  return new Date();
}

function newId(prefix: string): string {
  // Schema 中 id 列为 VARCHAR(36)，前缀 5 字符 + 31 字符 UUID 截断，确保符合约束
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 31)}`;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof value === "number") return new Date(value);
  return new Date();
}

function toPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  // mysql2 对 JSON 列可能返回已解析对象，直接返回（每次查询为新对象）
  return value;
}

interface SessionRow extends RowDataPacket {
  id: string;
  title: string;
  agent_template: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MessageRow extends RowDataPacket {
  id: string;
  session_id: string;
  role: string;
  content: string;
  reasoning: string | null;
  status: string;
  created_at: Date | string;
}

interface SessionFileRow extends RowDataPacket {
  id: string;
  session_id: string;
  message_id: string;
  kind: string;
  title: string;
  payload: unknown;
  saved_to_library: number | boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LibraryFileRow extends RowDataPacket {
  id: string;
  kind: string;
  title: string;
  payload: unknown;
  source_session_title: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toSession(row: SessionRow): ChatSession {
  return deepClone({
    id: row.id,
    title: row.title,
    agentTemplate: row.agent_template as AgentTemplate,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  });
}

function toMessage(row: MessageRow): ChatMessage {
  return deepClone({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MessageRole,
    content: row.content,
    reasoning: row.reasoning ?? null,
    status: row.status as MessageStatus,
    createdAt: toDate(row.created_at),
  });
}

function toSessionFile(row: SessionFileRow): SessionFile {
  return deepClone({
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind as AgentTemplate,
    title: row.title,
    payload: toPayload(row.payload),
    savedToLibrary: Boolean(row.saved_to_library),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  });
}

function toLibraryFile(row: LibraryFileRow): LibraryFile {
  return deepClone({
    id: row.id,
    kind: row.kind as AgentTemplate,
    title: row.title,
    payload: toPayload(row.payload),
    sourceSessionTitle: row.source_session_title ?? null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  });
}

export class MysqlChatRepository implements ChatRepository {
  constructor(private readonly pool: Pool) {}

  // 会话
  async listSessions(limit = 50): Promise<ChatSession[]> {
    const [rows] = await this.pool.query<SessionRow[]>(
      "SELECT id, title, agent_template, created_at, updated_at FROM ra_sessions ORDER BY updated_at DESC LIMIT ?",
      [limit],
    );
    return rows.map(toSession);
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const [rows] = await this.pool.execute<SessionRow[]>(
      "SELECT id, title, agent_template, created_at, updated_at FROM ra_sessions WHERE id = ?",
      [id],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async createSession(input: CreateSessionInput): Promise<ChatSession> {
    const id = newId("sess_");
    const time = now();
    await this.pool.execute(
      "INSERT INTO ra_sessions (id, title, agent_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [id, input.title, input.agentTemplate, time, time],
    );
    const session = await this.getSession(id);
    if (!session) {
      throw new Error("创建会话后读取失败");
    }
    return session;
  }

  async renameSession(id: string, title: string): Promise<ChatSession> {
    const time = now();
    const [result] = await this.pool.execute(
      "UPDATE ra_sessions SET title = ?, updated_at = ? WHERE id = ?",
      [title, time, id],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new Error(`会话不存在: ${id}`);
    }
    const session = await this.getSession(id);
    if (!session) {
      throw new Error(`会话不存在: ${id}`);
    }
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await this.pool.execute("DELETE FROM ra_sessions WHERE id = ?", [id]);
  }

  // 消息
  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const [rows] = await this.pool.execute<MessageRow[]>(
      "SELECT id, session_id, role, content, reasoning, status, created_at FROM ra_messages WHERE session_id = ? ORDER BY created_at ASC",
      [sessionId],
    );
    return rows.map(toMessage);
  }

  async createMessage(input: CreateMessageInput): Promise<ChatMessage> {
    const session = await this.getSession(input.sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${input.sessionId}`);
    }
    const count = await this.countMessages(input.sessionId);
    if (count >= MAX_MESSAGES_PER_SESSION) {
      throw new Error(
        `会话消息数已达上限 ${MAX_MESSAGES_PER_SESSION}，无法继续创建`,
      );
    }
    const id = newId("msg_");
    const time = now();
    await this.pool.execute(
      "INSERT INTO ra_messages (id, session_id, role, content, reasoning, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.sessionId,
        input.role,
        input.content,
        input.reasoning ?? null,
        input.status,
        time,
      ],
    );
    const message = await this.getMessage(id);
    if (!message) {
      throw new Error("创建消息后读取失败");
    }
    return message;
  }

  async updateMessageStatus(
    id: string,
    status: MessageStatus,
  ): Promise<ChatMessage> {
    const [result] = await this.pool.execute(
      "UPDATE ra_messages SET status = ? WHERE id = ?",
      [status, id],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new Error(`消息不存在: ${id}`);
    }
    const message = await this.getMessage(id);
    if (!message) {
      throw new Error(`消息不存在: ${id}`);
    }
    return message;
  }

  private async getMessage(id: string): Promise<ChatMessage | null> {
    const [rows] = await this.pool.execute<MessageRow[]>(
      "SELECT id, session_id, role, content, reasoning, status, created_at FROM ra_messages WHERE id = ?",
      [id],
    );
    return rows[0] ? toMessage(rows[0]) : null;
  }

  private async countMessages(sessionId: string): Promise<number> {
    const [rows] = await this.pool.execute<
      Array<{ count: number } & RowDataPacket>
    >(
      "SELECT COUNT(*) AS count FROM ra_messages WHERE session_id = ?",
      [sessionId],
    );
    return Number(rows[0].count);
  }

  // 会话文件
  async getSessionFile(id: string): Promise<SessionFile | null> {
    const [rows] = await this.pool.execute<SessionFileRow[]>(
      "SELECT id, session_id, message_id, kind, title, payload, saved_to_library, created_at, updated_at FROM ra_session_files WHERE id = ?",
      [id],
    );
    return rows[0] ? toSessionFile(rows[0]) : null;
  }

  async listSessionFiles(sessionId: string): Promise<SessionFile[]> {
    const [rows] = await this.pool.execute<SessionFileRow[]>(
      "SELECT id, session_id, message_id, kind, title, payload, saved_to_library, created_at, updated_at FROM ra_session_files WHERE session_id = ? ORDER BY created_at ASC",
      [sessionId],
    );
    return rows.map(toSessionFile);
  }

  async createSessionFile(
    input: CreateSessionFileInput,
  ): Promise<SessionFile> {
    const session = await this.getSession(input.sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${input.sessionId}`);
    }
    const message = await this.getMessage(input.messageId);
    if (!message) {
      throw new Error(`消息不存在: ${input.messageId}`);
    }
    const count = await this.countSessionFiles(input.sessionId);
    if (count >= MAX_SESSION_FILES_PER_SESSION) {
      throw new Error(
        `会话文件数已达上限 ${MAX_SESSION_FILES_PER_SESSION}，无法继续创建`,
      );
    }
    const id = newId("sf_");
    const time = now();
    await this.pool.execute(
      "INSERT INTO ra_session_files (id, session_id, message_id, kind, title, payload, saved_to_library, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.sessionId,
        input.messageId,
        input.kind,
        input.title,
        JSON.stringify(input.payload),
        false,
        time,
        time,
      ],
    );
    const file = await this.getSessionFile(id);
    if (!file) {
      throw new Error("创建会话文件后读取失败");
    }
    return file;
  }

  async updateSessionFileBoard(
    id: string,
    board: unknown,
  ): Promise<SessionFile> {
    const time = now();
    const [result] = await this.pool.execute(
      "UPDATE ra_session_files SET payload = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(board), time, id],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new Error(`会话文件不存在: ${id}`);
    }
    const file = await this.getSessionFile(id);
    if (!file) {
      throw new Error(`会话文件不存在: ${id}`);
    }
    return file;
  }

  async countSessionFiles(sessionId: string): Promise<number> {
    const [rows] = await this.pool.execute<
      Array<{ count: number } & RowDataPacket>
    >(
      "SELECT COUNT(*) AS count FROM ra_session_files WHERE session_id = ?",
      [sessionId],
    );
    return Number(rows[0].count);
  }

  // 文件库
  async listLibraryFiles(): Promise<LibraryFile[]> {
    const [rows] = await this.pool.execute<LibraryFileRow[]>(
      "SELECT id, kind, title, payload, source_session_title, created_at, updated_at FROM ra_library_files ORDER BY updated_at DESC",
    );
    return rows.map(toLibraryFile);
  }

  async getLibraryFile(id: string): Promise<LibraryFile | null> {
    const [rows] = await this.pool.execute<LibraryFileRow[]>(
      "SELECT id, kind, title, payload, source_session_title, created_at, updated_at FROM ra_library_files WHERE id = ?",
      [id],
    );
    return rows[0] ? toLibraryFile(rows[0]) : null;
  }

  async createLibraryFile(source: SessionFile | CreateLibraryFileInput): Promise<LibraryFile> {
    const count = await this.countLibraryFiles();
    if (count >= MAX_LIBRARY_FILES) {
      throw new Error(
        `文件库数量已达上限 ${MAX_LIBRARY_FILES}，无法继续创建`,
      );
    }
    const session = "sessionId" in source ? await this.getSession(source.sessionId) : null;
    const sourceSessionTitle = "sourceSessionTitle" in source
      ? source.sourceSessionTitle
      : session?.title ?? null;
    const id = newId("lf_");
    const time = now();
    await this.pool.execute(
      "INSERT INTO ra_library_files (id, kind, title, payload, source_session_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        source.kind,
        source.title,
        JSON.stringify(source.payload),
        sourceSessionTitle,
        time,
        time,
      ],
    );
    const library = await this.getLibraryFile(id);
    if (!library) {
      throw new Error("创建文件库文件后读取失败");
    }
    return library;
  }

  async updateLibraryFileBoard(id: string, board: unknown): Promise<LibraryFile> {
    const time = now();
    const [result] = await this.pool.execute(
      "UPDATE ra_library_files SET payload = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(board), time, id],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new Error(`文件库文件不存在: ${id}`);
    }
    const file = await this.getLibraryFile(id);
    if (!file) {
      throw new Error(`文件库文件不存在: ${id}`);
    }
    return file;
  }

  async deleteLibraryFile(id: string): Promise<void> {
    await this.pool.execute("DELETE FROM ra_library_files WHERE id = ?", [id]);
  }

  async countLibraryFiles(): Promise<number> {
    const [rows] = await this.pool.execute<
      Array<{ count: number } & RowDataPacket>
    >("SELECT COUNT(*) AS count FROM ra_library_files");
    return Number(rows[0].count);
  }

  async markSavedToLibrary(sessionFileId: string): Promise<SessionFile> {
    const [result] = await this.pool.execute(
      "UPDATE ra_session_files SET saved_to_library = 1 WHERE id = ?",
      [sessionFileId],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new Error(`会话文件不存在: ${sessionFileId}`);
    }
    const file = await this.getSessionFile(sessionFileId);
    if (!file) {
      throw new Error(`会话文件不存在: ${sessionFileId}`);
    }
    return file;
  }
}
