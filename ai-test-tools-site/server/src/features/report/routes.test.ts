import { beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import express from "express";
import { MemoryReportRepository } from "./repository.js";
import { registerReportRoutes } from "./routes.js";
import { MAX_REPORTS } from "./types.js";

function createApp(): { app: Express; repo: MemoryReportRepository } {
  const repo = new MemoryReportRepository();
  const app = express();
  app.use(express.json());
  registerReportRoutes(app, repo);
  return { app, repo };
}

/** 最小请求辅助：直接操作 app 的 HTTP 层（起随机端口监听）。 */
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
