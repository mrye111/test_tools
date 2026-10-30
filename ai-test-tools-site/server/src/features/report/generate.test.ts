import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryReportRepository } from "./repository.js";

// mock AI 模块：streamChatCompletionParts 按脚本队列产出响应
vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { generateReport, reviseReport, ReportGenerateError, type ReportGenerateEvent } from "./generate.js";
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

/** 槽位 JSON（B 层：模型只出这个，HTML 由服务端模板拼装）。 */
const VALID_DRAFT = JSON.stringify({
  title: "登录模块测试总结",
  kicker: ["登录模块 · 测试报告", "测试总结 / 第 1 轮"],
  verdict: { stamp: "good", label: "通过", text: "核心链路无阻塞" },
  meta: [{ label: "Project", value: "登录模块" }],
  findings: [{ tag: "good", label: "达标", text: "核心链路无阻塞" }],
  charts: [
    {
      code: "F11",
      title: "本轮通过率 92%",
      sub: "1 格 = 1% 目标 · 功能用例",
      source: "进度轨 · 用例执行",
      data: { rows: [["用户中心", 92, 95, "warn"]] },
      table: { columns: ["模块", "通过率"], rows: [["用户中心", "92%"]] },
    },
  ],
  sections: [{ num: "§ 02", title: "执行情况", figureIndexes: [0] }],
  colophon: ["NexusKit · 测试报告", "3.2.0 · 第 1 轮", "Generated 2026-09-22"],
});

describe("generateReport 管线（B 层：出稿 → 模板拼装 → 校验 → 落库）", () => {
  let repo: MemoryReportRepository;
  let events: ReportGenerateEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MemoryReportRepository();
    events = [];
  });

  it("完整链路：只调一次 LLM，事件序列完整，报告落库", async () => {
    scriptResponses(VALID_DRAFT);

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
    // 组装阶段不再消耗 LLM 调用
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("版式确定性：同一槽位 JSON 两次生成的 HTML 逐字节一致", async () => {
    scriptResponses(VALID_DRAFT, VALID_DRAFT);
    const a = await generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" });
    const b = await generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" });
    expect(a.html).toBe(b.html);
  });

  it("文本槽位进 HTML 前被转义（模型输出是不可信输入）", async () => {
    scriptResponses(
      JSON.stringify({
        title: `标题<script>alert(1)</script>`,
        findings: [{ tag: "mute", label: "待补", text: "<img onerror=1>" }],
        charts: [{ code: "F11", title: "t", sub: "s", source: "x", data: { rows: [["a", 1, 2, "good"]] } }],
        sections: [{ num: "§ 02", title: "执行情况", figureIndexes: [0] }],
        colophon: ["NexusKit", "3.2.0", "Generated 2026-09-22"],
      }),
    );
    const report = await generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" });
    expect(report.html).not.toContain("<script>alert(1)</script>");
    expect(report.html).not.toContain("<img onerror=1>");
    expect(report.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(report.html).toContain("&lt;img onerror=1&gt;");
  });

  it("出稿首次为非法 JSON 时修复重试一次后成功", async () => {
    scriptResponses("这不是 JSON", VALID_DRAFT);
    const report = await generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" });
    expect(report.id).toMatch(/^rpt_/);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("出稿修复后仍不合格：抛错且不落库", async () => {
    scriptResponses("垃圾1", "垃圾2");
    await expect(
      generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" }),
    ).rejects.toThrow(ReportGenerateError);
    expect(await repo.countReports()).toBe(0);
  });

  it("白名单外图型：修复重试后仍违规则抛错", async () => {
    const bad = JSON.stringify({ title: "x", charts: [{ code: "G16", title: "t", sub: "s", source: "x", data: {} }] });
    scriptResponses(bad, bad);
    await expect(
      generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" }),
    ).rejects.toThrow(/白名单/);
    expect(await repo.countReports()).toBe(0);
  });

  it("内容不诚实：文本素材的编造百分比触发修复，仍编造则失败", async () => {
    // 图标题含 92%，但素材与选型数据均不含 92 → 诚实校验不通过
    const dishonest = JSON.stringify({
      title: "登录测试简报",
      charts: [{ code: "F5", title: "通过率 92%", sub: "s", source: "x", data: { rows: [["启动", 1, true]] } }],
      sections: [{ num: "§ 02", title: "重点", figureIndexes: [0] }],
    });
    scriptResponses(dishonest, dishonest);
    await expect(
      generateReport(aiConfig, repo, { reportType: "brief", sourceType: "text", sourceText: "测试了登录功能的启动与上限" }),
    ).rejects.toThrow(/诚实|百分比|静态校验/);
    expect(await repo.countReports()).toBe(0);
  });

  it("titleHint 优先于 AI 标题", async () => {
    scriptResponses(VALID_DRAFT);
    const report = await generateReport(aiConfig, repo, {
      reportType: "summary",
      sourceType: "csv",
      sourceText: "{}",
      titleHint: "8 月登录模块回归总结",
    });
    expect(report.title).toBe("8 月登录模块回归总结");
  });

  it("缺数占位条目渲染为带补录桥接的占位卡", async () => {
    scriptResponses(
      JSON.stringify({
        title: "缺数报告",
        findings: [{ tag: "mute", label: "待补", text: "缺上一轮模块级数据" }],
        charts: [
          { code: "F11", title: "t", sub: "s", source: "x", data: { rows: [["a", 1, 2, "good"]] } },
          { code: "PLACEHOLDER", missing: "trend", title: "轮次对比（未出图）", need: "需要上一轮模块级数据" },
        ],
        sections: [{ num: "§ 02", title: "执行情况", figureIndexes: [0] }],
        colophon: ["NexusKit", "3.2.0", "Generated 2026-09-22"],
      }),
    );
    const report = await generateReport(aiConfig, repo, { reportType: "summary", sourceType: "csv", sourceText: "{}" });
    expect(report.html).toContain('data-missing="trend"');
    expect(report.html).toContain("nexus-report-supplement");
  });
});

describe("reviseReport 追改", () => {
  let repo: MemoryReportRepository;
  let events: ReportGenerateEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MemoryReportRepository();
    events = [];
  });

  it("整体重生成替换 html 与 chartKinds", async () => {
    const created = await repo.createReport({
      title: "登录总结",
      reportType: "summary",
      sourceType: "csv",
      sourceDigest: JSON.stringify({ total: 100, passed: 92 }),
      chartKinds: { charts: [{ code: "F11" }] },
      html: "<html>v1</html>",
    });
    scriptResponses(VALID_DRAFT);

    const updated = await reviseReport(aiConfig, repo, { reportId: created.id, instruction: "把标题改激进一点" }, (e) => events.push(e));

    expect(updated.id).toBe(created.id);
    expect(updated.html).toContain("<!doctype html>");
    expect(updated.chartKinds).toMatchObject({ charts: [{ code: "F11" }] });
    expect(events.map((e) => (e.type === "progress" ? e.stage : e.type))).toEqual(["select", "assemble", "save", "done"]);
    // 追改装箱应携带修改指令
    const firstCall = mockStream.mock.calls[0][1] as { messages: { content: string }[] };
    expect(firstCall.messages[1].content).toContain("把标题改激进一点");
  });

  it("报告不存在时抛错", async () => {
    await expect(reviseReport(aiConfig, repo, { reportId: "rpt_missing", instruction: "改" })).rejects.toThrow("不存在");
  });
});
