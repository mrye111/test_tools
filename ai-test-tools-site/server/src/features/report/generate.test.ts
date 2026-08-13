import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryReportRepository } from "./repository.js";

// mock AI 模块：streamChatCompletionParts 按脚本队列产出响应
vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { generateReport, ReportGenerateError, extractHtml, type ReportGenerateEvent } from "./generate.js";
import type { AiRequestConfig } from "../testcase/types.js";

const mockStream = vi.mocked(streamChatCompletionParts);

const aiConfig: AiRequestConfig = {
  provider: "codex",
  endpointType: "openai_chat",
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
  isLocalModel: false,
};

/** 把一串文本响应排入 mock 队列（每次调用 streamChatCompletionParts 出队一个）。 */
function scriptResponses(...responses: string[]) {
  for (const text of responses) {
    mockStream.mockImplementationOnce(async function* () {
      yield { type: "content" as const, text };
    });
  }
}

const VALID_SELECTION = JSON.stringify({
  title: "登录模块测试总结",
  charts: [
    { code: "F11", title: "本轮通过率 92%", sub: "1 tick = 1% · 功能用例", source: "TICK GAUGE · 用例执行", data: { value: 92 } },
  ],
});

const VALID_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>登录模块测试总结</title></head>
<body><div class="grid2">
<div class="card"><h2>本轮通过率 92%</h2><div class="sub">1 tick = 1% · 功能用例</div><svg id="c1"></svg><div class="src">TICK GAUGE · 用例执行</div></div>
</div><script>const D=[92];</script></body></html>`;

describe("generateReport 管线", () => {
  let repo: MemoryReportRepository;
  let events: ReportGenerateEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MemoryReportRepository();
    events = [];
  });

  it("完整链路：选图 → 组装 → 校验 → 落库，事件序列完整", async () => {
    scriptResponses(VALID_SELECTION, VALID_HTML);

    const report = await generateReport(
      aiConfig,
      repo,
      { reportType: "summary", sourceType: "csv", sourceText: JSON.stringify({ total: 100, passed: 92 }) },
      (e) => events.push(e),
    );

    expect(report.id).toMatch(/^rpt_/);
    expect(report.title).toBe("登录模块测试总结");
    expect(report.html).toContain("<!doctype html>");
    expect(report.chartKinds).toMatchObject({ charts: [{ code: "F11" }] });
    expect(await repo.countReports()).toBe(1);
    expect(events.map((e) => (e.type === "progress" ? e.stage : e.type))).toEqual(["select", "assemble", "validate", "done"]);
  });

  it("选图首次输出非法 JSON 时修复重试一次后成功", async () => {
    scriptResponses("这不是 JSON", VALID_SELECTION, VALID_HTML);

    const report = await generateReport(aiConfig, repo, {
      reportType: "summary",
      sourceType: "csv",
      sourceText: "{}",
    });
    expect(report.id).toMatch(/^rpt_/);
    expect(mockStream).toHaveBeenCalledTimes(3);
  });

  it("选图修复后仍不合格：抛 SELECT 错误且不落库", async () => {
    scriptResponses("垃圾1", "垃圾2");

    await expect(
      generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" }),
    ).rejects.toThrow(ReportGenerateError);
    expect(await repo.countReports()).toBe(0);
  });

  it("选图使用了白名单外图型：修复重试后仍违规则抛错", async () => {
    const badSelection = JSON.stringify({
      title: "x",
      charts: [{ code: "G16", title: "t", sub: "s", source: "x", data: {} }],
    });
    scriptResponses(badSelection, badSelection);

    await expect(
      generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" }),
    ).rejects.toThrow(/白名单/);
  });

  it("组装 HTML 校验失败时携带问题清单修复重试", async () => {
    const brokenHtml = VALID_HTML.replace('<div class="src">TICK GAUGE · 用例执行</div>', "");
    scriptResponses(VALID_SELECTION, brokenHtml, VALID_HTML);

    const report = await generateReport(aiConfig, repo, {
      reportType: "summary",
      sourceType: "csv",
      sourceText: "{}",
    });
    expect(report.html).toContain("TICK GAUGE");
    expect(mockStream).toHaveBeenCalledTimes(3);
  });

  it("组装修复后仍不合格：抛 VALIDATION 错误且不落库", async () => {
    const brokenHtml = "<!doctype html><html><body>no cards</body></html>";
    scriptResponses(VALID_SELECTION, brokenHtml, brokenHtml);

    await expect(
      generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" }),
    ).rejects.toThrow(/静态校验/);
    expect(await repo.countReports()).toBe(0);
  });

  it("诚实校验：文本素材的编造百分比触发修复，仍编造则失败", async () => {
    // VALID_HTML 含 92%，但素材与选型均不含 92 → 诚实校验不通过
    const selectionWithout92 = JSON.stringify({
      title: "登录测试简报",
      charts: [{ code: "F5", title: "重点条目", sub: "s", source: "x", data: { items: ["启动", "上限"] } }],
    });
    scriptResponses(selectionWithout92, VALID_HTML, VALID_HTML);

    await expect(
      generateReport(aiConfig, repo, { reportType: "brief", sourceType: "text", sourceText: "测试了登录功能的启动与上限" }),
    ).rejects.toThrow(ReportGenerateError);
    expect(await repo.countReports()).toBe(0);
  });

  it("titleHint 优先于 AI 标题", async () => {
    scriptResponses(VALID_SELECTION, VALID_HTML);
    const report = await generateReport(aiConfig, repo, {
      reportType: "summary",
      sourceType: "csv",
      sourceText: "{}",
      titleHint: "8 月登录模块回归总结",
    });
    expect(report.title).toBe("8 月登录模块回归总结");
  });
});

describe("extractHtml", () => {
  it("剥离 Markdown 围栏与前后杂散文本", () => {
    expect(extractHtml("前言\n```html\n<!doctype html><html><body>x</body></html>\n```\n后记")).toBe(
      "<!doctype html><html><body>x</body></html>",
    );
  });

  it("无围栏时从 <!doctype 截到 </html>", () => {
    expect(extractHtml("AI 说：<!doctype html><html><body>x</body></html>以上")).toBe(
      "<!doctype html><html><body>x</body></html>",
    );
  });
});
