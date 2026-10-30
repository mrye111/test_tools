/** 共享浏览器池：全局一个 headless Chromium，每次执行新建 BrowserContext 隔离（票据 01 定稿模型）。 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import { PlaywrightAgent } from "@midscene/web/playwright";
import { logger } from "../../logger.js";
import type { AgentSession, ExecutionAgent, SessionFactory } from "./runner.js";

const VIEWPORT = { width: 1440, height: 900 };

let browserPromise: Promise<Browser> | null = null;

/** 惰性启动共享 Browser；启动失败或运行中断连时重置 promise 以便下次自愈（评审 M8）。 */
export function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
    browserPromise
      .then((browser) => {
        browser.on("disconnected", () => {
          logger.warn("[automation] 共享浏览器断连，下次执行将重新拉起");
          browserPromise = null;
        });
      })
      .catch((error) => {
        logger.error({ err: error }, "[automation] 共享浏览器启动失败");
        browserPromise = null;
      });
  }
  return browserPromise;
}

export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  const promise = browserPromise;
  browserPromise = null;
  try {
    await (await promise).close();
  } catch {
    // 关闭失败不影响进程退出
  }
}

/** PlaywrightAgent 的 ExecutionAgent 适配（reportFile 在 destroy 后读取，票据 01）。 */
function toExecutionAgent(agent: PlaywrightAgent): ExecutionAgent {
  return {
    aiAct: (text, opts) => agent.aiAct(text, opts),
    // aiAssert(assertion, message?, options?)：abortSignal 在第三个参数
    aiAssert: (text, opts) => agent.aiAssert(text, undefined, opts as Parameters<PlaywrightAgent["aiAssert"]>[2]),
    // aiQuery(demand, opt)：形状与要求合并为单一 demand 串
    aiQuery: (shape, demand) => agent.aiQuery(`${demand}，返回 JSON 形状 ${shape}`),
    aiWaitFor: (text, opts) => agent.aiWaitFor(text, opts),
    addProgressListener: (listener) =>
      agent.addProgressListener((event) => listener(event as unknown as import("./runner.js").AgentProgressLike)),
    destroy: () => agent.destroy(),
    get reportFile() {
      return agent.reportFile ?? undefined;
    },
  };
}

/**
 * 生产 SessionFactory：每次执行新建 Context+Page+Agent（Agent 纯包装，destroy 不关页面）；
 * cacheId 存在时开启执行缓存（read-write，票据 03：每用例/用例集一个 id，同 id 串行由 RunManager 保证）。
 */
export function createPlaywrightSessionFactory(): SessionFactory {
  return async ({ cacheId, onProgress }) => {
    const browser = await getSharedBrowser();
    const context: BrowserContext = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      const agent = new PlaywrightAgent(
        page,
        cacheId ? { cache: { id: cacheId, strategy: "read-write" } } : undefined,
      );
      const wrapped = toExecutionAgent(agent);
      const unsubscribe = onProgress ? wrapped.addProgressListener?.(onProgress) : undefined;
      const session: AgentSession = {
        agent: wrapped,
        page,
        goto: async (url) => {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        },
        close: async () => {
          unsubscribe?.();
          let reportFile: string | undefined;
          try {
            await wrapped.destroy();
            reportFile = wrapped.reportFile;
          } catch (error) {
            logger.warn({ err: error }, "[automation] agent destroy/报告 flush 失败");
          }
          await context.close().catch(() => undefined);
          return reportFile;
        },
      };
      return session;
    } catch (error) {
      // newPage/Agent/监听器任一失败都不能漏掉已建的 context（评审 M9）
      await context.close().catch(() => undefined);
      throw error;
    }
  };
}
