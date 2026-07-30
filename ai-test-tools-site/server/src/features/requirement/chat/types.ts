/**
 * 需求分析 Chat 域数据类型（按设计文档 §3 四张表定义）
 */

/** 智能体模板：五选一 */
export type AgentTemplate =
  | "mindmap"
  | "cause-effect"
  | "decision-table"
  | "orthogonal"
  | "flowchart";

/** 消息角色 */
export type MessageRole = "user" | "assistant";

/** 消息状态：流式中 / 完成 / 出错 */
export type MessageStatus = "streaming" | "done" | "error";

/** 会话 */
export interface ChatSession {
  id: string;
  title: string;
  agentTemplate: AgentTemplate;
  createdAt: Date;
  updatedAt: Date;
}

/** 消息 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  reasoning: string | null;
  status: MessageStatus;
  createdAt: Date;
}

/** 会话文件：画板直接反序列化 payload */
export interface SessionFile {
  id: string;
  sessionId: string;
  messageId: string;
  kind: AgentTemplate;
  title: string;
  payload: unknown;
  savedToLibrary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 文件库文件：从会话文件深拷贝快照，独立编辑 */
export interface LibraryFile {
  id: string;
  kind: AgentTemplate;
  title: string;
  payload: unknown;
  sourceSessionTitle: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建会话入参 */
export interface CreateSessionInput {
  title: string;
  agentTemplate: AgentTemplate;
}

/** 创建消息入参 */
export interface CreateMessageInput {
  sessionId: string;
  role: MessageRole;
  content: string;
  reasoning?: string | null;
  status: MessageStatus;
}

/** 创建会话文件入参 */
export interface CreateSessionFileInput {
  sessionId: string;
  messageId: string;
  kind: AgentTemplate;
  title: string;
  payload: unknown;
}

/** 上限常量 */
export const MAX_MESSAGES_PER_SESSION = 200;
export const MAX_SESSION_FILES_PER_SESSION = 30;
export const MAX_LIBRARY_FILES = 500;

/** Chat Repository 接口：内存与 MySQL 双实现共用同一契约 */
export interface ChatRepository {
  // 会话
  listSessions(limit?: number): Promise<ChatSession[]>;
  getSession(id: string): Promise<ChatSession | null>;
  createSession(input: CreateSessionInput): Promise<ChatSession>;
  renameSession(id: string, title: string): Promise<ChatSession>;
  deleteSession(id: string): Promise<void>;

  // 消息
  listMessages(sessionId: string): Promise<ChatMessage[]>;
  createMessage(input: CreateMessageInput): Promise<ChatMessage>;
  updateMessageStatus(id: string, status: MessageStatus): Promise<ChatMessage>;

  // 会话文件
  getSessionFile(id: string): Promise<SessionFile | null>;
  createSessionFile(input: CreateSessionFileInput): Promise<SessionFile>;
  updateSessionFileBoard(id: string, board: unknown): Promise<SessionFile>;
  countSessionFiles(sessionId: string): Promise<number>;

  // 文件库
  listLibraryFiles(): Promise<LibraryFile[]>;
  getLibraryFile(id: string): Promise<LibraryFile | null>;
  createLibraryFile(source: SessionFile): Promise<LibraryFile>;
  deleteLibraryFile(id: string): Promise<void>;
  countLibraryFiles(): Promise<number>;
  markSavedToLibrary(sessionFileId: string): Promise<SessionFile>;
}
