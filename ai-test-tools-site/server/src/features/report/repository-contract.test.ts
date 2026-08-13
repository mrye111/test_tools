import { describe, expect, it, beforeEach } from "vitest";
import { type ReportRepository, type CreateReportInput, MAX_REPORTS } from "./types.js";
import { MemoryReportRepository } from "./repository.js";
import { MysqlReportRepository } from "./mysql-repository.js";

function makeInput(overrides: Partial<CreateReportInput> = {}): CreateReportInput {
  return {
    title: "登录模块测试总结",
    reportType: "summary",
    sourceType: "csv",
    sourceDigest: JSON.stringify({ cases: 20, bugs: 3 }),
    chartKinds: { charts: [{ kind: "F11", title: "通过率" }] },
    html: "<!doctype html><html><body>report</body></html>",
    ...overrides,
  };
}

export function runContractTests(
  name: string,
  factory: () => ReportRepository | Promise<ReportRepository>,
): void {
  describe(`ReportRepository contract (${name})`, () => {
    let repo: ReportRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    describe("创建与读取", () => {
      it("createReport 生成 rpt_ 前缀 id 并记录时间", async () => {
        const report = await repo.createReport(makeInput());
        expect(report.id.startsWith("rpt_")).toBe(true);
        expect(report.title).toBe("登录模块测试总结");
        expect(report.reportType).toBe("summary");
        expect(report.sourceType).toBe("csv");
        expect(report.html).toContain("<!doctype html>");
        expect(report.createdAt).toBeInstanceOf(Date);
        expect(report.updatedAt).toBeInstanceOf(Date);
      });

      it("getReport 完整读回 sourceDigest 与 chartKinds；不存在返回 null", async () => {
        const created = await repo.createReport(makeInput());
        const found = await repo.getReport(created.id);
        expect(found).not.toBeNull();
        expect(found!.sourceDigest).toBe(JSON.stringify({ cases: 20, bugs: 3 }));
        expect(found!.chartKinds).toEqual({ charts: [{ kind: "F11", title: "通过率" }] });
        expect(await repo.getReport("rpt_missing")).toBeNull();
      });

      it("可选字段缺省时存为 null", async () => {
        const report = await repo.createReport(makeInput({ sourceDigest: undefined, chartKinds: undefined }));
        expect(report.sourceDigest).toBeNull();
        expect(report.chartKinds).toBeNull();
      });
    });

    describe("列表与分页", () => {
      it("listReports 按 updatedAt 倒序，且摘要不含 html / sourceDigest", async () => {
        const r1 = await repo.createReport(makeInput({ title: "A" }));
        await new Promise((r) => setTimeout(r, 5));
        const r2 = await repo.createReport(makeInput({ title: "B" }));

        const all = await repo.listReports(20, 0);
        expect(all.map((r) => r.id)).toEqual([r2.id, r1.id]);
        expect(all[0]).not.toHaveProperty("html");
        expect(all[0]).not.toHaveProperty("sourceDigest");
      });

      it("listReports 支持 limit/offset 分页，countReports 返回总数", async () => {
        for (let i = 0; i < 5; i++) {
          await repo.createReport(makeInput({ title: `R${i}` }));
          await new Promise((r) => setTimeout(r, 2));
        }
        const page = await repo.listReports(2, 2);
        expect(page).toHaveLength(2);
        expect(await repo.countReports()).toBe(5);
      });
    });

    describe("更新与删除", () => {
      it("renameReport 更新标题并推动 updatedAt", async () => {
        const created = await repo.createReport(makeInput());
        await new Promise((r) => setTimeout(r, 5));
        const renamed = await repo.renameReport(created.id, "新标题");
        expect(renamed.title).toBe("新标题");
        expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
        await expect(repo.renameReport("rpt_missing", "x")).rejects.toThrow("不存在");
      });

      it("updateReportContent 整体替换 html 与 chartKinds（追改通路）", async () => {
        const created = await repo.createReport(makeInput());
        const updated = await repo.updateReportContent(created.id, {
          html: "<!doctype html><html><body>v2</body></html>",
          chartKinds: { charts: [{ kind: "F5", title: "模块分布" }] },
        });
        expect(updated.html).toContain("v2");
        expect(updated.chartKinds).toEqual({ charts: [{ kind: "F5", title: "模块分布" }] });
        const found = await repo.getReport(created.id);
        expect(found!.html).toContain("v2");
        await expect(repo.updateReportContent("rpt_missing", { html: "x" })).rejects.toThrow("不存在");
      });

      it("deleteReport 删除记录；删除不存在记录抛错", async () => {
        const created = await repo.createReport(makeInput());
        await repo.deleteReport(created.id);
        expect(await repo.getReport(created.id)).toBeNull();
        expect(await repo.countReports()).toBe(0);
        await expect(repo.deleteReport("rpt_missing")).rejects.toThrow("不存在");
      });
    });

    describe("上限", () => {
      it(`超过 ${MAX_REPORTS} 条时 createReport 抛出已达上限`, async () => {
        for (let i = 0; i < MAX_REPORTS; i++) {
          await repo.createReport(makeInput({ title: `R${i}` }));
        }
        await expect(repo.createReport(makeInput())).rejects.toThrow("已达上限");
      }, 30000);
    });
  });
}

describe("MemoryReportRepository contract", () => {
  runContractTests("memory", () => new MemoryReportRepository());
});

if (process.env.TEST_MYSQL === "1") {
  describe("MysqlReportRepository 契约", async () => {
    const { resolveChatDb } = await import("../requirement/db/pool.js");
    const handle = await resolveChatDb();
    if (!handle.pool) {
      throw new Error("TEST_MYSQL 已启用但无法连接 MySQL");
    }
    // 直接建表（不经 bootstrapReports，避免共享池在测试进程中常驻）
    await handle.pool.query(`CREATE TABLE IF NOT EXISTS tr_reports (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      report_type ENUM('summary','brief','defect','free') NOT NULL,
      source_type ENUM('text','csv') NOT NULL,
      source_digest MEDIUMTEXT,
      chart_kinds JSON,
      html MEDIUMTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    beforeEach(async () => {
      await handle.pool!.execute("DELETE FROM tr_reports");
    });

    runContractTests("mysql", () => new MysqlReportRepository(handle.pool!));
  });
} else {
  describe.skip("MysqlReportRepository 契约", () => {});
}
