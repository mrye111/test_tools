/** 探源爬站器：同域 BFS（上限 N 页、登录态先入），每页截图 + AI 摘要 + 元素清单落库。 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { takeSnapshot } from "../fast/snapshot.js";
import type { AgentSession } from "../runner.js";
import type { CapturedElement, CapturedPage, NewCapturedPage } from "../types.js";
import { startLiveFrames } from "./live-frames.js";

export type ExploreCreds = { username: string; password: string };

export type ExplorePageInput = {
  url: string;
  title: string;
  text: string;
  /** data:image/jpeg;base64,... */
  image: string;
};

/** AI 页面摘要调用器（生产接视觉模型；测试接替身）。 */
export type ExploreSummarizer = (input: ExplorePageInput) => Promise<string>;

export type CrawlHooks = {
  onLog(level: "info" | "warn", text: string): void;
  onFrame(data: string): void;
  onPage(page: CapturedPage): void;
  onProgress(done: number, total: number): void;
  isAborted(): boolean;
};

export type CrawlInput = {
  sourceId: string;
  entryUrl: string;
  maxPages: number;
  /** 有凭据时先尝试表单登录（登录页在入口也会命中）。 */
  credentials?: ExploreCreds | null;
  summarize: ExploreSummarizer;
  /** 截图根目录：<artifactDir>/<sourceId>/<n>.jpg */
  artifactDir: string;
};

export type CrawlDeps = {
  addCapturedPage(input: NewCapturedPage): Promise<CapturedPage>;
};

export type CrawlResult = { pageCount: number };

/** 收集页面上的 http(s) 绝对链接（去 hash），供 BFS 发现后续页面。 */
const LINKS_SCRIPT = `(() => {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      u.hash = '';
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      out.push(u.href);
    } catch {}
  }
  return out;
})()`;

/** 表单登录脚本：找密码框，同表单启发式找用户名框，原生 setter 赋值（React 受控表单可入）后提交。 */
export function loginScript(username: string, password: string): string {
  return `(() => {
  const payload = ${JSON.stringify({ username, password })};
  const pw = document.querySelector('input[type="password"]');
  if (!pw) return { attempted: false };
  const setVal = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const form = pw.form || pw.closest('form');
  const scope = form || document;
  const candidates = [...scope.querySelectorAll('input')].filter((i) =>
    i !== pw && !['hidden', 'password', 'checkbox', 'radio', 'submit', 'button'].includes(i.type) && i.offsetParent !== null);
  const user = candidates.find((i) =>
    /user|login|email|account|mail|手机|用户|账号/i.test((i.name || '') + (i.id || '') + (i.placeholder || ''))) || candidates[0];
  if (user) setVal(user, payload.username);
  setVal(pw, payload.password);
  const btn = scope.querySelector('button[type="submit"], input[type="submit"], button');
  if (btn) btn.click();
  else if (form) form.requestSubmit();
  else pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { attempted: true, hadUserField: !!user };
})()`;
}

/** 视频/图片/样式等静态资源后缀（不是可探索的 HTML 页面）。 */
const BINARY_PATH = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|eot|mp4|webm|mp3|zip|gz|pdf|dmg|exe)(\?|$)/i;

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function toCapturedElements(elements: { index: number; role: string; name: string; kind: string }[]): CapturedElement[] {
  return elements.slice(0, 60).map((e) => ({
    index: e.index,
    role: e.role,
    name: e.name,
    kind: e.kind === "fill" || e.kind === "select" ? e.kind : "click",
  }));
}

const SETTLE_MS = 400;

/** BFS 爬站主循环。逐页容错：单页失败只记日志继续。 */
export async function crawlSite(
  session: AgentSession,
  input: CrawlInput,
  hooks: CrawlHooks,
  deps: CrawlDeps,
): Promise<CrawlResult> {
  const page = session.page;
  if (!page) throw new Error("探源需要真实浏览器页面（当前会话没有 page）");

  const entry = normalizeUrl(input.entryUrl);
  if (!entry) throw new Error(`入口地址无效: ${input.entryUrl}`);
  const entryHost = new URL(entry).host;
  const dir = join(input.artifactDir, input.sourceId);
  await mkdir(dir, { recursive: true });

  const stopFrames = await startLiveFrames(page as Page, hooks.onFrame);
  try {
    // 登录态先入：先到入口（可能是登录页），有密码框则填表提交
    await session.goto(entry);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (input.credentials) {
      hooks.onLog("info", "尝试表单登录…");
      try {
        const result = (await (page as Page).evaluate(loginScript(input.credentials.username, input.credentials.password))) as {
          attempted: boolean;
          hadUserField?: boolean;
        };
        if (result.attempted) {
          await new Promise((r) => setTimeout(r, 1500));
          hooks.onLog("info", result.hadUserField ? "已提交登录表单" : "已提交登录（未识别到用户名框）");
        } else {
          hooks.onLog("info", "入口页没有密码框，按免登录继续");
        }
      } catch (error) {
        hooks.onLog("warn", `登录尝试失败（继续探索）：${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      hooks.onLog("info", "环境未配置测试账号，按免登录探索");
    }

    const queue: Array<{ url: string; depth: number }> = [];
    const visited = new Set<string>();
    let pageCount = 0;

    const captureCurrent = async (urlHint: string, depth: number): Promise<void> => {
      const snapshot = await takeSnapshot(page as Page);
      const shot = await (page as Page).screenshot({ type: "jpeg", quality: 60 });
      const image = `data:image/jpeg;base64,${shot.toString("base64")}`;

      let links: string[] = [];
      try {
        links = (await (page as Page).evaluate<string[]>(LINKS_SCRIPT)) ?? [];
      } catch {
        // 链接收集失败不影响本页捕获
      }

      pageCount += 1;
      const screenshotFile = `${pageCount}.jpg`;
      await writeFile(join(dir, screenshotFile), shot);

      let aiSummary = "";
      try {
        aiSummary = await input.summarize({ url: snapshot.url || urlHint, title: snapshot.title, text: snapshot.text, image });
      } catch (error) {
        hooks.onLog("warn", `AI 摘要失败（不影响捕获）：${error instanceof Error ? error.message : String(error)}`);
      }

      const captured = await deps.addCapturedPage({
        sourceId: input.sourceId,
        url: snapshot.url || urlHint,
        title: snapshot.title || urlHint,
        depth,
        aiSummary,
        elements: toCapturedElements(snapshot.elements),
        screenshotFile,
      });
      hooks.onPage(captured);
      hooks.onProgress(pageCount, input.maxPages);

      for (const link of links) {
        const normalized = normalizeUrl(link);
        if (!normalized) continue;
        if (new URL(normalized).host !== entryHost) continue;
        if (BINARY_PATH.test(new URL(normalized).pathname)) continue;
        if (visited.has(normalized.replace(/\/$/, ""))) continue;
        queue.push({ url: normalized, depth: depth + 1 });
      }
    };

    // 首页直接捕获「当前页」（登录可能已重定向到登录后落地页），不回访入口——SPA 的入口 URL 往往永远渲染登录视图
    const firstUrl = normalizeUrl((page as Page).url()) ?? entry;
    visited.add(firstUrl.replace(/\/$/, ""));
    await captureCurrent(firstUrl, 0);

    while (queue.length > 0 && pageCount < input.maxPages) {
      if (hooks.isAborted()) return { pageCount };
      const item = queue.shift() as { url: string; depth: number };
      const key = item.url.replace(/\/$/, "");
      if (visited.has(key)) continue;
      visited.add(key);
      if (new URL(item.url).host !== entryHost || BINARY_PATH.test(new URL(item.url).pathname)) continue;

      try {
        await session.goto(item.url);
        await new Promise((r) => setTimeout(r, SETTLE_MS));
      } catch (error) {
        hooks.onLog("warn", `打开失败：${item.url}（${error instanceof Error ? error.message : String(error)}）`);
        continue;
      }
      await captureCurrent(item.url, item.depth);
    }

    return { pageCount };
  } finally {
    stopFrames();
  }
}
