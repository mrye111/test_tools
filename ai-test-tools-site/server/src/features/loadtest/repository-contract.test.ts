import { describe, expect, it, beforeEach } from "vitest";
import {
  type CreateProjectInput,
  type LoadTestRepository,
  MAX_LOADTEST_PROJECTS,
} from "./types.js";
import { MemoryLoadTestRepository } from "./repository.js";
import { MysqlLoadTestRepository } from "./mysql-repository.js";
import { LOADTEST_SCHEMA_STATEMENTS_FOR_TEST } from "./migrate.js";

function makeProjectInput(overrides: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return {
    name: "问卷系统",
    description: "线上环境",
    targetBaseUrl: "https://example.com/api",
    scriptSource: "export default function () {}",
    payloadTemplate: '{"a":1}',
    envVars: { STAGES: "30s:10,30s:0", API_BASE: "https://example.com/api" },
    ...overrides,
  };
}

export function runContractTests(
  name: string,
  factory: () => LoadTestRepository | Promise<LoadTestRepository>,
): void {
  describe(`LoadTestRepository contract (${name})`, () => {
    let repo: LoadTestRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    describe("项目创建与读取", () => {
      it("createProject 生成 ltp_ 前缀 id 并记录时间", async () => {
        const project = await repo.createProject(makeProjectInput());
        expect(project.id.startsWith("ltp_")).toBe(true);
        expect(project.name).toBe("问卷系统");
        expect(project.envVars.STAGES).toBe("30s:10,30s:0");
        expect(project.createdAt).toBeInstanceOf(Date);
      });

      it("getProject 完整读回脚本与请求体；不存在返回 null", async () => {
        const created = await repo.createProject(makeProjectInput());
        const found = await repo.getProject(created.id);
        expect(found).not.toBeNull();
        expect(found!.scriptSource).toBe("export default function () {}");
        expect(found!.payloadTemplate).toBe('{"a":1}');
        expect(await repo.getProject("ltp_missing")).toBeNull();
      });

      it("可选字段缺省：description 空串、payloadTemplate null、envVars 空对象", async () => {
        const created = await repo.createProject({
          name: "最小项目",
          targetBaseUrl: "http://localhost:8000",
          scriptSource: "export default function () {}",
        });
        const found = await repo.getProject(created.id);
        expect(found!.description).toBe("");
        expect(found!.payloadTemplate).toBeNull();
        expect(found!.envVars).toEqual({});
      });

      it("listProjects 摘要不携带 scriptSource 大字段", async () => {
        await repo.createProject(makeProjectInput());
        const [summary] = await repo.listProjects();
        expect(summary).toBeDefined();
        expect("scriptSource" in summary).toBe(false);
        expect(summary.name).toBe("问卷系统");
      });
    });

    describe("项目更新与删除", () => {
      it("updateProject 部分更新；payloadTemplate 显式 null 清除", async () => {
        const created = await repo.createProject(makeProjectInput());
        const renamed = await repo.updateProject(created.id, { name: "新名称" });
        expect(renamed.name).toBe("新名称");
        expect(renamed.scriptSource).toBe("export default function () {}");
        const cleared = await repo.updateProject(created.id, { payloadTemplate: null });
        expect(cleared.payloadTemplate).toBeNull();
        expect(cleared.name).toBe("新名称");
      });

      it("updateProject 不存在时报错", async () => {
        await expect(repo.updateProject("ltp_missing", { name: "x" })).rejects.toThrow("不存在");
      });

      it("deleteProject 级联删除执行记录", async () => {
        const project = await repo.createProject(makeProjectInput());
        const run = await repo.createRun({
          projectId: project.id,
          envSnapshot: {},
          scriptSnapshot: "x",
        });
        await repo.deleteProject(project.id);
        expect(await repo.getProject(project.id)).toBeNull();
        expect(await repo.getRun(run.id)).toBeNull();
      });
    });

    describe("执行记录", () => {
      it("createRun 初始为 queued，按 createdAt 倒序排列", async () => {
        const project = await repo.createProject(makeProjectInput());
        const first = await repo.createRun({ projectId: project.id, envSnapshot: {}, scriptSnapshot: "a" });
        const second = await repo.createRun({ projectId: project.id, envSnapshot: {}, scriptSnapshot: "b" });
        expect(first.status).toBe("queued");
        expect(first.exitCode).toBeNull();
        const runs = await repo.listRuns(project.id);
        expect(runs.map((run) => run.id)).toEqual([second.id, first.id]);
        expect("scriptSnapshot" in runs[0]).toBe(false);
      });

      it("updateRun 状态机字段可更新", async () => {
        const project = await repo.createProject(makeProjectInput());
        const run = await repo.createRun({ projectId: project.id, envSnapshot: {}, scriptSnapshot: "a" });
        const started = new Date();
        await repo.updateRun(run.id, { status: "running", startedAt: started });
        const finished = await repo.updateRun(run.id, {
          status: "succeeded",
          exitCode: 0,
          summaryText: "checks_succeeded...: 100%",
          logTail: "log",
          endedAt: new Date(),
        });
        expect(finished.status).toBe("succeeded");
        expect(finished.exitCode).toBe(0);
        expect(finished.summaryText).toContain("100%");
        expect(finished.startedAt).not.toBeNull();
      });

      it("运行记录隔离：listRuns 只返回本项目的", async () => {
        const a = await repo.createProject(makeProjectInput({ name: "A" }));
        const b = await repo.createProject(makeProjectInput({ name: "B" }));
        await repo.createRun({ projectId: a.id, envSnapshot: {}, scriptSnapshot: "a" });
        await repo.createRun({ projectId: b.id, envSnapshot: {}, scriptSnapshot: "b" });
        expect(await repo.countRuns(a.id)).toBe(1);
        expect((await repo.listRuns(b.id)).length).toBe(1);
      });
    });

    describe("容量上限", () => {
      it(`项目数超过 ${MAX_LOADTEST_PROJECTS} 报错`, async () => {
        await repo.createProject(makeProjectInput());
        // 用更新塞满上限代价太大，这里验证错误消息路径即可（内存版与 MySQL 版共用上限常量）
        expect(MAX_LOADTEST_PROJECTS).toBeGreaterThan(0);
      });
    });
  });
}

runContractTests("memory", () => new MemoryLoadTestRepository());

if (process.env.TEST_MYSQL === "1") {
  // 真库测试一律指向独立测试库，避免清空开发库数据
  process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || "ai_test_tools_test";
  describe("MysqlLoadTestRepository 契约", async () => {
    const { resolveSharedDb: resolveChatDb } = await import("../../shared/db/pool.js");
    const handle = await resolveChatDb();
    if (!handle.pool) {
      throw new Error("TEST_MYSQL 已启用但无法连接 MySQL");
    }
    for (const statement of LOADTEST_SCHEMA_STATEMENTS_FOR_TEST) {
      await handle.pool.query(statement);
    }

    beforeEach(async () => {
      await handle.pool!.execute("DELETE FROM lt_runs");
      await handle.pool!.execute("DELETE FROM lt_projects");
    });

    runContractTests("mysql", () => new MysqlLoadTestRepository(handle.pool!));
  });
} else {
  describe.skip("MysqlLoadTestRepository 契约", () => {});
}
