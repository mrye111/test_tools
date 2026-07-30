import type { AiRequestConfig } from "../../testcase/types.js";
import { analyzeRequirementText, type RequirementAnalysisEvent } from "../ai.js";
import { generateBoardChartDraft } from "../board-ai.js";
import { parseAiRequestConfig } from "../../testcase/ai.js";
import type {
  AgentTemplate,
  ChatRepository,
  CreateSessionFileInput,
  MessageRole,
  MessageStatus,
  SessionFile,
} from "./types.js";

export type RunChatTurnOptions = {
  repo: ChatRepository;
  sessionId: string | null;
  agentTemplate: AgentTemplate;
  text: string;
  aiConfig: unknown;
  emit: (event: string, data: unknown) => void;
  signal?: AbortSignal;
};

export type RunChatTurnResult = {
  sessionId: string;
  messageId: string;
  file: SessionFile | null;
};

/** 取字符串前 n 字；空字符串则返回占位符。 */
function truncateText(input: string, maxLength: number, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  return [...trimmed].slice(0, maxLength).join("");
}

/** 将分析流事件统一转发为前端可识别的 stream 事件。 */
function forwardAnalysisEvent(
  event: RequirementAnalysisEvent,
  emit: (event: string, data: unknown) => void,
): void {
  if (event.type === "reasoning" || event.type === "content") {
    emit("stream", { kind: event.type, text: event.text });
    return;
  }
  if (event.type === "attempt") {
    emit("stream", { kind: "attempt", reason: event.reason });
  }
}

/** 追问上下文：已有文件标题 + 最近 20 条消息截断 + 本轮 text。 */
async function buildFollowUpContext(
  repo: ChatRepository,
  sessionId: string,
  currentText: string,
  maxMessages = 20,
): Promise<{ nodeTitle: string; nodeSubtreeText: string }> {
  // 当前 ChatRepository 已暴露 listSessionFiles，文件标题从本会话已有文件标题聚合。
  const sessionFiles = await repo.listSessionFiles(sessionId).catch(() => []);
  const fileTitles = sessionFiles.map((f) => f.title).filter(Boolean);

  const allMessages = await repo.listMessages(sessionId);
  const recentMessages = allMessages.slice(-maxMessages);
  const messageContext = recentMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const nodeTitle = truncateText(currentText, 50, "追问");
  const nodeSubtreeText = [
    fileTitles.length ? `【已有文件标题】\n${fileTitles.join("\n")}` : "",
    messageContext ? `【历史消息】\n${messageContext}` : "",
    `【本轮】\n${currentText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { nodeTitle, nodeSubtreeText };
}

/** 构建 mindmap 会话文件载荷。 */
function buildMindmapPayload(
  analysis: { title: string; tree: unknown; findings: unknown[] },
  sourceText: string,
): unknown {
  return {
    tree: analysis.tree,
    findings: analysis.findings,
    sourceText,
    board: null,
  };
}

/** 图表模板的中文摘要。 */
function chartTemplateSummary(template: AgentTemplate): string {
  const map: Record<AgentTemplate, string> = {
    mindmap: "已生成需求思维导图，点击卡片查看。",
    "cause-effect": "已生成因果图草稿，点击卡片查看。",
    "decision-table": "已生成判定表草稿，点击卡片查看。",
    orthogonal: "已生成正交试验因子表，点击卡片查看。",
    flowchart: "已生成流程图草稿，点击卡片查看。",
  };
  return map[template];
}

/** 提取错误摘要：避免泄露不可序列化对象。 */
function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "未知错误";
  }
  return "请求处理失败，请重试";
}

/** 是否为取消/中止错误。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
}

/** 主入口：编排一轮对话。 */
export async function runChatTurn(opts: RunChatTurnOptions): Promise<RunChatTurnResult> {
  const { repo, agentTemplate, text, aiConfig, emit, signal } = opts;
  const config = parseAiRequestConfig(
    aiConfig as { ai_config?: unknown; aiConfig?: unknown } & Record<string, unknown>,
  ) as AiRequestConfig;

  let session = opts.sessionId ? await repo.getSession(opts.sessionId) : null;

  // 1. 若缺少会话，创建会话并立即通知客户端
  if (!session) {
    const title = truncateText(text, 20, "新会话");
    session = await repo.createSession({ title, agentTemplate });
    emit("session", { id: session.id, title: session.title, agentTemplate });
  }

  // 2. 写入用户消息（已完成）
  await repo.createMessage({
    sessionId: session.id,
    role: "user" as MessageRole,
    content: text,
    status: "done" as MessageStatus,
  });

  let reasoningText = "";

  try {
    emit("stage", { stage: "analyzing" });

    if (agentTemplate === "mindmap") {
      const analysis = await analyzeRequirementText(
        config,
        text,
        (event) => {
          forwardAnalysisEvent(event, emit);
          if (event.type === "reasoning") {
            reasoningText += event.text;
          }
        },
        signal,
      );

      const summary = `已生成“${analysis.title}”需求分解树，点击卡片查看。`;
      const assistantMessage = await repo.createMessage({
        sessionId: session.id,
        role: "assistant" as MessageRole,
        content: summary,
        reasoning: reasoningText || null,
        status: "done" as MessageStatus,
      });

      const payload = buildMindmapPayload(analysis, text);
      const fileInput: CreateSessionFileInput = {
        sessionId: session.id,
        messageId: assistantMessage.id,
        kind: "mindmap",
        title: analysis.title,
        payload,
      };
      const sessionFile = await repo.createSessionFile(fileInput);

      emit("file", {
        sessionFileId: sessionFile.id,
        kind: sessionFile.kind,
        title: sessionFile.title,
      });
      emit("message", {
        id: assistantMessage.id,
        role: assistantMessage.role,
        status: assistantMessage.status,
      });
      emit("end", { ok: true });

      return {
        sessionId: session.id,
        messageId: assistantMessage.id,
        file: sessionFile,
      };
    }

    // 图表四件套（含 flowchart）追问轮
    const { nodeTitle, nodeSubtreeText } = await buildFollowUpContext(
      repo,
      session.id,
      text,
    );

    const draft = await generateBoardChartDraft(config, {
      nodeTitle,
      nodeSubtreeText,
      chartKind: agentTemplate,
    });

    const summary = chartTemplateSummary(agentTemplate);
    const assistantMessage = await repo.createMessage({
      sessionId: session.id,
      role: "assistant" as MessageRole,
      content: summary,
      reasoning: null,
      status: "done" as MessageStatus,
    });

    const fileInput: CreateSessionFileInput = {
      sessionId: session.id,
      messageId: assistantMessage.id,
      kind: agentTemplate,
      title: nodeTitle,
      payload: { draft },
    };
    const sessionFile = await repo.createSessionFile(fileInput);

    emit("file", {
      sessionFileId: sessionFile.id,
      kind: sessionFile.kind,
      title: sessionFile.title,
    });
    emit("message", {
      id: assistantMessage.id,
      role: assistantMessage.role,
      status: assistantMessage.status,
    });
    emit("end", { ok: true });

    return {
      sessionId: session.id,
      messageId: assistantMessage.id,
      file: sessionFile,
    };
  } catch (error) {
    const summary = isAbortError(error)
      ? "请求已取消。"
      : `处理失败：${summarizeError(error)}`;
    const assistantMessage = await repo.createMessage({
      sessionId: session.id,
      role: "assistant" as MessageRole,
      content: summary,
      reasoning: reasoningText || null,
      status: "error" as MessageStatus,
    });

    emit("error", { message: summarizeError(error) });
    emit("message", {
      id: assistantMessage.id,
      role: assistantMessage.role,
      status: assistantMessage.status,
    });
    emit("end", { ok: false });

    throw error;
  }
}
