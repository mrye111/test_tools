/** 探源引擎测试：BFS 爬站（同域/上限/二进制跳过）、登录态先入、摘要容错、中止、仓储级联删除。 */

// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { MemoryAutomationRepository } from "../memory-repository.js";
import type { AgentSession, SessionFactory } from "../runner.js";
import { ExploreManager, type ExploreEvent } from "./explore-manager.js";
import { crawlSite } from "./crawler.js";

type FakePage = {
  current: string;
  evals: string[];
  page: Page;
};

/** 假 Playwright 页面：脚本串按标记分发（快照/链接/登录），CDP 不可用（直播降级）。 */
function fakePage(initialUrl: string, links: Record<string, string[]>, opts?: { loginResult?: unknown }): FakePage {
  const state = { current: initialUrl, evals: [] as string[] };
  const page = {
    context: () => ({
      newCDPSession: async () => {
        throw new Error("fake 页面不支持 CDP");
      },
    }),
    url: () => state.current,
    evaluate: async (fn: string) => {
      state.evals.push(fn);
      if (fn.includes("data-at-fidx")) {
        return {
          url: state.current,
          title: `标题-${state.current}`,
          text: "页面正文",
          elements: [
            { index: 1, role: "button", name: "登录", kind: "click", bbox: { x: 0, y: 0, w: 1, h: 1 } },
            { index: 2, role: "textbox", name: "用户名", kind: "fill", bbox: { x: 0, y: 0, w: 1, h: 1 } },
          ],
        };
      }
      if (fn.includes("a[href]")) return links[state.current] ?? [];
      if (fn.includes("type=\"password\"") || fn.includes('type=\\"password\\"') || fn.includes("password")) {
        return opts?.loginResult ?? { attempted: true, hadUserField: true };
      }
      return null;
    },
    screenshot: async () => Buffer.from(`jpeg-${state.current}`),
  } as unknown as Page;
  return { get current() { return state.current; }, set current(v: string) { state.current = v; }, evals: state.evals, page } as FakePage;
}

function fakeSession(fp: FakePage): AgentSession {
  return {
    agent: {
      aiAct: async () => undefined,
      aiAssert: async () => undefined,
      aiQuery: async () => ({}),
      aiWaitFor: async () => undefined,
      destroy: async () => undefined,
    },
    goto: async (url: string) => {
      fp.current = url;
    },
    close: async () => undefined,
    page: fp.page,
  };
}

describe("crawlSite", () => {
  let artifactDir: string;

  beforeEach(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "explore-test-"));
  });

  afterEach(async () => {
    await rm(artifactDir, { recursive: true, force: true });
  });

  it("同域 BFS：跳过外域与二进制链接，捕获页带摘要/元素/截图文件", async () => {
    const repo = new MemoryAutomationRepository();
    const fp = fakePage("https://demo.test/", {
      "https://demo.test/": [
        "https://demo.test/list",
        "https://demo.test/list", // 重复
        "https://other.test/x", // 外域
        "https://demo.test/logo.png", // 二进制
        "https://demo.test/detail?q=1",
      ],
      "https://demo.test/list": ["https://demo.test/"],
      "https://demo.test/detail?q=1": [],
    });
    const events: string[] = [];
    const result = await crawlSite(
      fakeSession(fp),
      {
        sourceId: "src-1",
        entryUrl: "https://demo.test/",
        maxPages: 10,
        credentials: null,
        summarize: async () => "这是列表页。关注分页。",
        artifactDir,
      },
      {
        onLog: () => undefined,
        onFrame: () => undefined,
        onPage: (p) => events.push(`page:${p.url}`),
        onProgress: (done, total) => events.push(`progress:${done}/${total}`),
        isAborted: () => false,
      },
      { addCapturedPage: (input) => repo.addCapturedPage(input) },
    );

    expect(result.pageCount).toBe(3);
    const pages = await repo.listCapturedPages("src-1");
    expect(pages.map((p) => p.url).sort()).toEqual(["https://demo.test/", "https://demo.test/detail?q=1", "https://demo.test/list"]);
    const entry = pages.find((p) => p.url === "https://demo.test/")!;
    expect(entry.aiSummary).toBe("这是列表页。关注分页。");
    expect(entry.elements).toHaveLength(2);
    expect(entry.screenshotFile).toBe("1.jpg");
    // 截图文件真实落盘
    const shot = await readFile(join(artifactDir, "src-1", "1.jpg"));
    expect(shot.toString()).toContain("jpeg-");
    expect(events.filter((e) => e.startsWith("page:"))).toHaveLength(3);
  });

  it("maxPages 封顶：队列再长也只爬 N 页", async () => {
    const repo = new MemoryAutomationRepository();
    const links: Record<string, string[]> = {
      "https://demo.test/": ["https://demo.test/p2", "https://demo.test/p3", "https://demo.test/p4"],
    };
    for (let i = 2; i <= 4; i++) links[`https://demo.test/p${i}`] = [];
    const fp = fakePage("https://demo.test/", links);
    const result = await crawlSite(
      fakeSession(fp),
      { sourceId: "src-2", entryUrl: "https://demo.test/", maxPages: 2, summarize: async () => "s", artifactDir },
      { onLog: () => undefined, onFrame: () => undefined, onPage: () => undefined, onProgress: () => undefined, isAborted: () => false },
      { addCapturedPage: (input) => repo.addCapturedPage(input) },
    );
    expect(result.pageCount).toBe(2);
  });

  it("配置凭据时先尝试表单登录；AI 摘要失败不影响捕获", async () => {
    const repo = new MemoryAutomationRepository();
    const fp = fakePage("https://demo.test/", {});
    const summaries = ["", "ok"];
    let summaryCalls = 0;
    const warnings: string[] = [];
    await crawlSite(
      fakeSession(fp),
      {
        sourceId: "src-3",
        entryUrl: "https://demo.test/",
        maxPages: 5,
        credentials: { username: "u1", password: "p1" },
        summarize: async () => {
          summaryCalls += 1;
          if (summaryCalls === 1) throw new Error("模型超时");
          return "ok";
        },
        artifactDir,
      },
      {
        onLog: (level, text) => {
          if (level === "warn") warnings.push(text);
        },
        onFrame: () => undefined,
        onPage: () => undefined,
        onProgress: () => undefined,
        isAborted: () => false,
      },
      { addCapturedPage: (input) => repo.addCapturedPage(input) },
    );

    // 登录脚本被下发（fake 按 password 标记命中）
    expect(fp.evals.some((fn) => fn.includes("password") && fn.includes("u1"))).toBe(true);
    expect(warnings.some((w) => w.includes("AI 摘要失败"))).toBe(true);
    const pages = await repo.listCapturedPages("src-3");
    expect(pages).toHaveLength(1);
    expect(pages[0].aiSummary).toBe("");
  });

  it("isAborted 中断后停止爬取并返回已捕获数", async () => {
    const repo = new MemoryAutomationRepository();
    const fp = fakePage("https://demo.test/", {
      "https://demo.test/": ["https://demo.test/p2"],
      "https://demo.test/p2": ["https://demo.test/p3"],
      "https://demo.test/p3": [],
    });
    let visited = 0;
    const result = await crawlSite(
      fakeSession(fp),
      { sourceId: "src-4", entryUrl: "https://demo.test/", maxPages: 10, summarize: async () => "s", artifactDir },
      {
        onLog: () => undefined,
        onFrame: () => undefined,
        onPage: () => {
          visited += 1;
        },
        onProgress: () => undefined,
        isAborted: () => visited >= 1,
      },
      { addCapturedPage: (input) => repo.addCapturedPage(input) },
    );
    expect(result.pageCount).toBe(1);
  });
});

describe("ExploreManager", () => {
  let artifactDir: string;

  beforeEach(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "explore-mgr-"));
  });

  afterEach(async () => {
    await rm(artifactDir, { recursive: true, force: true });
  });

  function harness(opts?: { gotoDelayMs?: number }) {
    const repo = new MemoryAutomationRepository();
    const fp = fakePage("https://demo.test/", {
      "https://demo.test/": ["https://demo.test/a"],
      "https://demo.test/a": [],
    });
    const sessionFactory: SessionFactory = async () => {
      const session = fakeSession(fp);
      if (opts?.gotoDelayMs) {
        const original = session.goto;
        session.goto = async (url: string) => {
          await new Promise((r) => setTimeout(r, opts.gotoDelayMs));
          await original(url);
        };
      }
      return session;
    };
    const manager = new ExploreManager({
      repo,
      sessionFactory,
      createChatCaller: () => async () => "AI 概括。测试关注点。",
      artifactDir,
      jobTtlMs: 60_000,
    });
    return { repo, manager };
  }

  async function waitDone(manager: ExploreManager, sourceId: string, timeoutMs = 8000): Promise<ExploreEvent[]> {
    const events: ExploreEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待探源完成超时")), timeoutMs);
      manager.subscribe(sourceId, (event) => {
        events.push(event);
        if (event.kind === "done") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return events;
  }

  it("startExplore 全流程：stage 顺序、page/progress 事件、源状态落库", async () => {
    const { repo, manager } = harness();
    await repo.createEnvironment({
      projectId: "proj-1",
      name: "默认",
      url: "https://demo.test/",
      isDefault: true,
      auth: { kind: "none" },
    });
    const source = await manager.startExplore({
      projectId: "proj-1",
      entryUrl: "https://demo.test/",
      maxPages: 10,
      aiConfig: { provider: "openai", apiKey: "k", model: "m" } as never,
    });
    expect(source.status).toBe("running");

    const events = await waitDone(manager, source.id);
    const stages = events.filter((e) => e.kind === "stage").map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(["login", "crawl", "done"]);
    expect(events.filter((e) => e.kind === "page")).toHaveLength(2);
    expect(events.some((e) => e.kind === "progress")).toBe(true);

    const stored = await repo.getSource(source.id);
    expect(stored?.status).toBe("done");
    expect(stored?.pageCount).toBe(2);
    expect(stored?.finishedAt).toBeTruthy();
  });

  it("默认环境为 credentials 时从 process.env 解析登录凭据（缺失则告警免登录）", async () => {
    const { repo, manager } = harness();
    await repo.createEnvironment({
      projectId: "proj-2",
      name: "默认",
      url: "https://demo.test/",
      isDefault: true,
      auth: { kind: "credentials", usernameKey: "EXPLORE_T_USER", passwordKey: "EXPLORE_T_PASS" },
    });
    process.env.EXPLORE_T_USER = "u1";
    process.env.EXPLORE_T_PASS = "p1";
    try {
      const source = await manager.startExplore({
        projectId: "proj-2",
        entryUrl: "https://demo.test/",
        maxPages: 10,
        aiConfig: {} as never,
      });
      const events = await waitDone(manager, source.id);
      expect(events.some((e) => e.kind === "log" && e.text.includes("已提交登录"))).toBe(true);
    } finally {
      delete process.env.EXPLORE_T_USER;
      delete process.env.EXPLORE_T_PASS;
    }
  });

  it("abort 中止：源状态 aborted，任务收尾出 done", async () => {
    const { repo, manager } = harness({ gotoDelayMs: 300 });
    const source = await manager.startExplore({
      projectId: "proj-3",
      entryUrl: "https://demo.test/",
      maxPages: 10,
      aiConfig: {} as never,
    });
    // 等第一页开爬后中止
    await new Promise((r) => setTimeout(r, 80));
    expect(manager.abort(source.id)).toBe(true);
    const events = await waitDone(manager, source.id);
    expect(events.some((e) => e.kind === "done")).toBe(true);
    const stored = await repo.getSource(source.id);
    expect(stored?.status).toBe("aborted");
  });

  it("爬站异常：源状态 failed 并带 error 事件", async () => {
    const repo = new MemoryAutomationRepository();
    const sessionFactory: SessionFactory = async () => {
      throw new Error("浏览器起不来");
    };
    const manager = new ExploreManager({
      repo,
      sessionFactory,
      createChatCaller: () => async () => "",
      artifactDir,
      jobTtlMs: 60_000,
    });
    const source = await manager.startExplore({
      projectId: "proj-4",
      entryUrl: "https://demo.test/",
      maxPages: 5,
      aiConfig: {} as never,
    });
    const events = await waitDone(manager, source.id);
    expect(events.some((e) => e.kind === "error" && e.message.includes("浏览器起不来"))).toBe(true);
    const stored = await repo.getSource(source.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toContain("浏览器起不来");
  });
});

describe("MemoryAutomationRepository 探源存储", () => {
  it("源与捕获页 CRUD，deleteSource 级联删页并回收截图文件名", async () => {
    const repo = new MemoryAutomationRepository();
    const source = await repo.createSource({ projectId: "p1", entryUrl: "https://demo.test/", maxPages: 5 });
    expect(source.status).toBe("running");
    await repo.addCapturedPage({
      sourceId: source.id,
      url: "https://demo.test/",
      title: "首页",
      depth: 0,
      aiSummary: "首页",
      elements: [],
      screenshotFile: "1.jpg",
    });
    await repo.addCapturedPage({
      sourceId: source.id,
      url: "https://demo.test/x",
      title: "X",
      depth: 1,
      aiSummary: "",
      elements: [],
    });

    const updated = await repo.updateSource(source.id, { status: "done", pageCount: 2 });
    expect(updated?.status).toBe("done");
    expect((await repo.listCapturedPages(source.id))).toHaveLength(2);
    expect((await repo.listSources("p1")).map((s) => s.id)).toEqual([source.id]);

    const removed = await repo.deleteSource(source.id);
    expect(removed?.screenshots).toEqual(["1.jpg"]);
    expect(await repo.getSource(source.id)).toBeNull();
    expect(await repo.listCapturedPages(source.id)).toHaveLength(0);
  });
});
