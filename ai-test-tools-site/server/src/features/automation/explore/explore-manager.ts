/** 探源任务编排：内存任务 + 事件回放 + SSE 直播 + TTL 逐出（照抄 import-manager 模式）。 */

import { logger } from "../../../logger.js";
import { nowIso } from "../../testcase/utils.js";
import type { AiRequestConfig } from "../../testcase/types.js";
import type { SessionFactory } from "../runner.js";
import type { AutomationRepository, CapturedPage, ExploreSource } from "../types.js";
import { crawlSite, type ExploreCreds, type ExplorePageInput, type ExploreSummarizer } from "./crawler.js";

/** 摘要模型消息（可带截图；生产适配 callChatCompletion，其 ChatMessage.content 为 unknown）。 */
export type ExploreChatMessage = {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};
export type ExploreChatCaller = (messages: ExploreChatMessage[]) => Promise<string>;

export type ExploreStage = "login" | "crawl" | "done";

export type ExploreEvent =
  | { kind: "stage"; stage: ExploreStage; at: string }
  | { kind: "log"; level: "info" | "warn"; text: string; at: string }
  | { kind: "progress"; done: number; total: number; at: string }
  | { kind: "frame"; data: string; at: string }
  | { kind: "page"; page: Pick<CapturedPage, "id" | "url" | "title" | "depth" | "aiSummary">; at: string }
  | { kind: "done"; at: string }
  | { kind: "error"; message: string; at: string };

export type StartExploreInput = {
  projectId: string;
  entryUrl: string;
  maxPages: number;
  /** 视觉摘要模型配置；缺省时跳过摘要（捕获照常，Live log 提示一次）。 */
  aiConfig?: AiRequestConfig | null;
  /** 覆盖环境推断的登录凭据（免登录传 null）。 */
  credentials?: ExploreCreds | null;
};

export type ExploreManagerDeps = {
  repo: Pick<
    AutomationRepository,
    "createSource" | "updateSource" | "getSource" | "addCapturedPage" | "listEnvironments"
  >;
  sessionFactory: SessionFactory;
  createChatCaller: (aiConfig: AiRequestConfig) => ExploreChatCaller;
  /** 截图根目录（源目录由爬站器建）。 */
  artifactDir: string;
  jobTtlMs?: number;
};

const MAX_BUFFERED_EVENTS = 500;
const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000;
/** 直播帧转发节流（缓冲区只留最新一帧，回放不炸）。 */
const FRAME_FORWARD_MS = 500;

type JobState = {
  events: ExploreEvent[];
  listeners: Set<(event: ExploreEvent) => void>;
  abort: AbortController;
  finished: boolean;
};

export class ExploreManager {
  private jobs = new Map<string, JobState>();
  private lastFrameAt = 0;
  private pendingFrame: ExploreEvent | null = null;
  private frameTimer: NodeJS.Timeout | null = null;

  constructor(private deps: ExploreManagerDeps) {}

  /** 探源任务是否仍在跑（路由层据此把「服务重启遗留的 running」改判失败）。 */
  isActive(sourceId: string): boolean {
    return this.jobs.has(sourceId) && !this.jobs.get(sourceId)!.finished;
  }

  getSource(id: string): Promise<ExploreSource | null> {
    return this.deps.repo.getSource(id);
  }

  /** 订阅进度：先回放缓冲事件，再挂直播。返回退订函数。 */
  subscribe(id: string, listener: (event: ExploreEvent) => void): () => void {
    let state = this.jobs.get(id);
    if (!state) {
      // 任务已逐出/不存在：建空壳只用于回放不了时的干净退订
      return () => undefined;
    }
    for (const event of state.events) {
      try {
        listener(event);
      } catch {
        return () => undefined;
      }
    }
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  /** 启动探源（立即返回 source 记录，爬站在后台跑）。 */
  async startExplore(input: StartExploreInput): Promise<ExploreSource> {
    const source = await this.deps.repo.createSource({
      projectId: input.projectId,
      entryUrl: input.entryUrl,
      maxPages: input.maxPages,
    });
    const state: JobState = { events: [], listeners: new Set(), abort: new AbortController(), finished: false };
    this.jobs.set(source.id, state);
    void this.run(source, state, input)
      .catch((error) => this.fail(source.id, state, error))
      .finally(() => {
        state.finished = true;
        const timer = setTimeout(() => this.evict(source.id), this.deps.jobTtlMs ?? DEFAULT_JOB_TTL_MS);
        timer.unref?.();
      });
    return source;
  }

  /** 用户中止：抛中断信号，循环在下一页前退出。 */
  abort(sourceId: string): boolean {
    const state = this.jobs.get(sourceId);
    if (!state || state.finished) return false;
    state.abort.abort();
    return true;
  }

  private async run(source: ExploreSource, state: JobState, input: StartExploreInput): Promise<void> {
    // 摘要调用器：无 AI 配置时返回空摘要（捕获照常），只提示一次
    let summarize: ExploreSummarizer;
    if (input.aiConfig) {
      const callChat = this.deps.createChatCaller(input.aiConfig);
      summarize = async (page: ExplorePageInput) => {
        const answer = await callChat([
          {
            role: "system",
            content:
              "你是测试分析师。用 1-2 句中文概括这个页面（是什么页面、核心功能），再给 1 条测试关注点。只输出这两句，不要标题和列表。",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `页面地址：${page.url}\n标题：${page.title}\n正文摘录：${page.text.slice(0, 1200)}` },
              { type: "image_url", image_url: { url: page.image } },
            ],
          },
        ]);
        return answer.trim().slice(0, 240);
      };
    } else {
      this.emit(source.id, state, { kind: "log", level: "warn", text: "未配置 AI 模型，本次跳过页面摘要", at: nowIso() });
      summarize = async () => "";
    }

    // 登录凭据：请求显式覆盖（含 null=免登录）> 默认环境（credentials 从 process.env 取值，与 resolveVarDefs 同源）
    let credentials: ExploreCreds | null = null;
    if (input.credentials !== undefined) {
      credentials = input.credentials;
    } else {
      const envs = await this.deps.repo.listEnvironments(source.projectId);
      const def = envs.find((e) => e.isDefault) ?? envs[0];
      if (def?.auth.kind === "credentials") {
        const username = process.env[def.auth.usernameKey];
        const password = process.env[def.auth.passwordKey];
        if (username && password) credentials = { username, password };
        else this.emit(source.id, state, { kind: "log", level: "warn", text: "默认环境声明了测试账号，但凭据键未配置，按免登录探索", at: nowIso() });
      }
    }

    this.emit(source.id, state, { kind: "stage", stage: "login", at: nowIso() });
    this.emit(source.id, state, { kind: "stage", stage: "crawl", at: nowIso() });

    const session = await this.deps.sessionFactory({});
    try {
      const result = await crawlSite(
        session,
        {
          sourceId: source.id,
          entryUrl: source.entryUrl,
          maxPages: source.maxPages,
          credentials,
          summarize,
          artifactDir: this.deps.artifactDir,
        },
        {
          onLog: (level, text) => this.emit(source.id, state, { kind: "log", level, text, at: nowIso() }),
          onFrame: (data) => this.pushFrame(source.id, state, data),
          onPage: (page) =>
            this.emit(source.id, state, {
              kind: "page",
              page: { id: page.id, url: page.url, title: page.title, depth: page.depth, aiSummary: page.aiSummary },
              at: nowIso(),
            }),
          onProgress: (done, total) => this.emit(source.id, state, { kind: "progress", done, total, at: nowIso() }),
          isAborted: () => state.abort.signal.aborted,
        },
        { addCapturedPage: (page) => this.deps.repo.addCapturedPage(page) },
      );

      const aborted = state.abort.signal.aborted;
      await this.deps.repo.updateSource(source.id, {
        status: aborted ? "aborted" : "done",
        pageCount: result.pageCount,
        finishedAt: nowIso(),
      });
      this.emit(source.id, state, { kind: "stage", stage: "done", at: nowIso() });
      this.emit(source.id, state, { kind: "done", at: nowIso() });
      logger.info({ sourceId: source.id, pageCount: result.pageCount, aborted }, "[automation] 探源完成");
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  private fail(sourceId: string, state: JobState, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    void this.deps.repo.updateSource(sourceId, { status: "failed", error: message, finishedAt: nowIso() }).catch(() => undefined);
    this.emit(sourceId, state, { kind: "error", message, at: nowIso() });
    this.emit(sourceId, state, { kind: "done", at: nowIso() });
    logger.warn({ sourceId, err: error }, "[automation] 探源失败");
  }

  private emit(sourceId: string, state: JobState, event: ExploreEvent): void {
    if (event.kind === "frame") {
      // 帧不进常规缓冲（pushFrame 专线处理）
      return;
    }
    state.events.push(event);
    if (state.events.length > MAX_BUFFERED_EVENTS) state.events.splice(0, state.events.length - MAX_BUFFERED_EVENTS);
    this.forward(state, event);
  }

  /** 直播帧：缓冲只留最新一帧，转发 2fps 节流（尾沿补发不丢最后一帧）。 */
  private pushFrame(sourceId: string, state: JobState, data: string): void {
    const event: ExploreEvent = { kind: "frame", data, at: nowIso() };
    const idx = state.events.findIndex((e) => e.kind === "frame");
    if (idx >= 0) state.events.splice(idx, 1);
    state.events.push(event);

    const now = Date.now();
    if (now - this.lastFrameAt >= FRAME_FORWARD_MS) {
      this.lastFrameAt = now;
      this.forward(state, event);
      return;
    }
    this.pendingFrame = event;
    if (!this.frameTimer) {
      this.frameTimer = setTimeout(
        () => {
          this.frameTimer = null;
          if (this.pendingFrame) {
            this.lastFrameAt = Date.now();
            this.forward(state, this.pendingFrame);
            this.pendingFrame = null;
          }
        },
        FRAME_FORWARD_MS - (now - this.lastFrameAt),
      );
      this.frameTimer.unref?.();
    }
  }

  private forward(state: JobState, event: ExploreEvent): void {
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ err: error }, "[automation] 探源 SSE 监听器异常");
      }
    }
  }

  private evict(sourceId: string): void {
    const state = this.jobs.get(sourceId);
    if (!state) return;
    if (state.listeners.size > 0) return; // 仍有直播订阅者时推迟逐出
    this.jobs.delete(sourceId);
  }
}
