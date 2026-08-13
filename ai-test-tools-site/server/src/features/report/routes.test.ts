import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import express from "express";
import { MemoryReportRepository } from "./repository.js";
import { registerReportRoutes } from "./routes.js";
import { MAX_REPORTS } from "./types.js";

// mock AI 模块：streamChatCompletionParts 按脚本产出，其余（含 parseAiRequestConfig）保留真实实现
vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";

const mockStream = vi.mocked(streamChatCompletionParts);

const aiConfigFields: Record<string, unknown> = {
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
};

function createApp(): { app: Express; repo: MemoryReportRepository } {
  const repo = new MemoryReportRepository();
  const app = express();
  app.use(express.json());
  registerReportRoutes(app, repo);
  return { app, repo };
}

/** 最小请求辅助：直接操作 app 的 HTTP 层（起随机端口监听）。 */

/** SSE 变体：返回原始文本，用于解析事件流断言。 */
async function requestRaw(
  app: Express,
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ status: number; text: string }> {
  const server = await new Promise<ReturnType<Express["listen"]>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
async function request(
  app: Express,
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = await new Promise<ReturnType<Express["listen"]>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "登录模块测试总结",
    reportType: "summary",
    sourceType: "csv",
    sourceDigest: JSON.stringify({ cases: 20 }),
    chartKinds: { charts: [{ kind: "F11" }] },
    html: "<!doctype html><html><body>report</body></html>",
    ...overrides,
  };
}

describe("报告记录路由", () => {
  let app: Express;
  let repo: MemoryReportRepository;

  beforeEach(() => {
    ({ app, repo } = createApp());
  });

  it("storage-status 返回当前存储模式", async () => {
    const res = await request(app, "GET", "/api/test-report/storage-status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mode: "memory" });
  });

  it("空列表返回空数组与 total 0", async () => {
    const res = await request(app, "GET", "/api/test-report/reports");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, reports: [], total: 0, page: 1, pageSize: 20 });
  });

  it("创建后可按 id 读回完整记录；列表摘要不含 html", async () => {
    const created = await request(app, "POST", "/api/test-report/reports", validPayload());
    expect(created.status).toBe(200);
    const report = created.body.report as Record<string, unknown>;
    expect(report.id).toMatch(/^rpt_/);

    const detail = await request(app, "GET", `/api/test-report/reports/${report.id}`);
    expect(detail.status).toBe(200);
    expect((detail.body.report as Record<string, unknown>).html).toContain("<!doctype html>");

    const list = await request(app, "GET", "/api/test-report/reports");
    const summaries = list.body.reports as Record<string, unknown>[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).not.toHaveProperty("html");
    expect(summaries[0]).not.toHaveProperty("sourceDigest");
  });

  it("创建时剥离 modelConfig 等凭据字段，落盘记录不含 apiKey", async () => {
    const payload = validPayload({
      modelConfig: { provider: "kimi", apiKey: "sk-should-never-be-persisted" },
    });
    const created = await request(app, "POST", "/api/test-report/reports", payload);
    expect(created.status).toBe(200);
    const reportId = (created.body.report as Record<string, unknown>).id as string;

    const stored = await repo.getReport(reportId);
    expect(JSON.stringify(stored)).not.toContain("sk-should-never-be-persisted");
    expect(JSON.stringify(stored)).not.toContain("apiKey");
  });

  it("参数校验：非法 reportType / 空 html / 缺 title 均返回 400", async () => {
    const badType = await request(app, "POST", "/api/test-report/reports", validPayload({ reportType: "weekly" }));
    expect(badType.status).toBe(400);

    const emptyHtml = await request(app, "POST", "/api/test-report/reports", validPayload({ html: "  " }));
    expect(emptyHtml.status).toBe(400);

    const noTitle = await request(app, "POST", "/api/test-report/reports", validPayload({ title: "" }));
    expect(noTitle.status).toBe(400);
  });

  it("分页：page/pageSize 生效且 total 为全集条数", async () => {
    for (let i = 0; i < 3; i++) {
      await repo.createReport({
        title: `R${i}`,
        reportType: "brief",
        sourceType: "text",
        html: `<html>${i}</html>`,
      });
    }
    const res = await request(app, "GET", "/api/test-report/reports?page=2&pageSize=2");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.reports).toHaveLength(1);
  });

  it("PATCH 重命名与追改内容；不存在返回 404", async () => {
    const created = await repo.createReport({
      title: "旧标题",
      reportType: "defect",
      sourceType: "csv",
      html: "<html>v1</html>",
    });

    const renamed = await request(app, "PATCH", `/api/test-report/reports/${created.id}`, { title: "新标题" });
    expect(renamed.status).toBe(200);
    expect((renamed.body.report as Record<string, unknown>).title).toBe("新标题");

    const revised = await request(app, "PATCH", `/api/test-report/reports/${created.id}`, {
      html: "<html>v2</html>",
      chartKinds: { charts: [{ kind: "F5" }] },
    });
    expect(revised.status).toBe(200);
    expect((revised.body.report as Record<string, unknown>).html).toBe("<html>v2</html>");

    const missing = await request(app, "PATCH", "/api/test-report/reports/rpt_missing", { title: "x" });
    expect(missing.status).toBe(404);
  });

  it("DELETE 删除记录；重复删除返回 404", async () => {
    const created = await repo.createReport({
      title: "待删",
      reportType: "free",
      sourceType: "text",
      html: "<html>x</html>",
    });
    const removed = await request(app, "DELETE", `/api/test-report/reports/${created.id}`);
    expect(removed.status).toBe(200);
    const gone = await request(app, "GET", `/api/test-report/reports/${created.id}`);
    expect(gone.status).toBe(404);
    const again = await request(app, "DELETE", `/api/test-report/reports/${created.id}`);
    expect(again.status).toBe(404);
  });

  it("达到上限时创建返回 409", async () => {
    for (let i = 0; i < MAX_REPORTS; i++) {
      await repo.createReport({ title: `R${i}`, reportType: "brief", sourceType: "text", html: "<html/>" });
    }
    const res = await request(app, "POST", "/api/test-report/reports", validPayload());
    expect(res.status).toBe(409);
  }, 30000);
});

describe("AI 报告生成路由（SSE）", () => {
  let app: Express;
  let repo: MemoryReportRepository;

  const SELECTION = JSON.stringify({
    title: "登录测试简报",
    charts: [
      { code: "F5", title: "重点条目", sub: "1 tick = 1 条", source: "TICK ROWS", data: { items: ["启动", "上限"] } },
    ],
  });
  const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>登录测试简报</title></head>
<body><div class="grid2">
<div class="card"><h2>重点条目</h2><div class="sub">1 tick = 1 条</div><svg id="c1"></svg><div class="src">TICK ROWS</div></div>
</div><script>const D=[2];</script></body></html>`;

  function scriptResponses(...responses: string[]) {
    for (const text of responses) {
      mockStream.mockImplementationOnce(async function* () {
        yield { type: "content" as const, text };
      });
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, repo } = createApp());
  });

  it("生成成功：SSE 事件序列完整且报告落库", async () => {
    scriptResponses(SELECTION, HTML);
    const res = await requestRaw(app, "POST", "/api/test-report/reports/generate", {
      ...aiConfigFields,
      reportType: "brief",
      sourceType: "text",
      sourceText: "测试了登录功能的启动与上限两个点",
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain("event: progress");
    expect(res.text).toContain("event: report");
    expect(res.text).toContain('"ok":true');
    expect(await repo.countReports()).toBe(1);
  });

  it("参数缺失：非法 reportType / 空 sourceText 返回 400", async () => {
    const badType = await request(app, "POST", "/api/test-report/reports/generate", {
      ...aiConfigFields,
      reportType: "weekly",
      sourceType: "text",
      sourceText: "x",
    });
    expect(badType.status).toBe(400);

    const emptyText = await request(app, "POST", "/api/test-report/reports/generate", {
      ...aiConfigFields,
      reportType: "brief",
      sourceType: "text",
      sourceText: "  ",
    });
    expect(emptyText.status).toBe(400);
  });

  it("CSV 输入缺少结构化 JSON 返回 400", async () => {
    const res = await request(app, "POST", "/api/test-report/reports/generate", {
      ...aiConfigFields,
      reportType: "summary",
      sourceType: "csv",
    });
    expect(res.status).toBe(400);
  });

  it("AI 失败：发出 error 事件且不落库", async () => {
    scriptResponses("垃圾", "垃圾");
    const res = await requestRaw(app, "POST", "/api/test-report/reports/generate", {
      ...aiConfigFields,
      reportType: "summary",
      sourceType: "csv",
      csvData: { cases: [] },
    });

    expect(res.text).toContain("event: error");
    expect(res.text).toContain('"ok":false');
    expect(await repo.countReports()).toBe(0);
  });

  it("追改成功：整体重生成并替换落库内容", async () => {
    const created = await repo.createReport({
      title: "登录测试简报",
      reportType: "brief",
      sourceType: "text",
      sourceDigest: "测试了登录功能",
      chartKinds: null,
      html: "<html>v1</html>",
    });
    scriptResponses(SELECTION, HTML);

    const res = await requestRaw(app, "POST", `/api/test-report/reports/${created.id}/revise`, {
      ...aiConfigFields,
      instruction: "把重点条目换成层级图",
    });

    expect(res.text).toContain("event: report");
    expect(res.text).toContain('"ok":true');
    const stored = await repo.getReport(created.id);
    expect(stored!.html).toContain("<!doctype html>");
  });

  it("追改参数校验：空 instruction 返回 400；不存在记录走 error 事件", async () => {
    const empty = await request(app, "POST", "/api/test-report/reports/rpt_x/revise", {
      ...aiConfigFields,
      instruction: " ",
    });
    expect(empty.status).toBe(400);

    const missing = await requestRaw(app, "POST", "/api/test-report/reports/rpt_missing/revise", {
      ...aiConfigFields,
      instruction: "改一下",
    });
    expect(missing.text).toContain("event: error");
    expect(missing.text).toContain("NOT_FOUND");
  });
});
