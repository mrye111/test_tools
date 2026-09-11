import { describe, expect, it } from "vitest";
import type { Pool, PoolConnection } from "mysql2/promise";
import {
  TESTCASE_SCHEMA_STATEMENTS,
  createMysqlTestcaseAdapter,
  initTestcaseSchema,
} from "../src/features/testcase/mysql-persistence.js";
import type { TestCaseStoreData } from "../src/features/testcase/types.js";

type QueryCall = { sql: string; params?: unknown };

function createFakePool(options: { selectRows?: Record<string, unknown[][]> } = {}) {
  const calls: QueryCall[] = [];
  const connection = {
    query: async (sql: string, params?: unknown) => {
      calls.push({ sql, params });
      const table = /FROM (\w+)/.exec(sql)?.[1];
      return [options.selectRows?.[table ?? ""] ?? [], []] as unknown;
    },
    execute: async (sql: string, params?: unknown) => {
      calls.push({ sql, params });
      return [[], []] as unknown;
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  const pool = {
    getConnection: async () => connection,
    query: connection.query,
    execute: connection.execute,
  } as unknown as Pool;
  return { pool, calls };
}

function sampleData(): TestCaseStoreData {
  return {
    projects: [{ id: "proj_1", name: "项目", createdAt: "2026-09-11T00:00:00.000Z", ownerId: null }],
    testSets: [
      {
        id: "set_1",
        projectId: "proj_1",
        name: "登录",
        featureName: "登录",
        testType: "functional",
        language: "zh",
        promptPreset: "google_qa",
        context: "登录需求",
        status: "completed",
        header: ["用例编号"],
        rows: [["TC001"]],
        executionStatus: { TC001: { status: "passed", updatedAt: "2026-09-11T01:00:00.000Z" } },
        createdAt: "2026-09-11T00:00:00.000Z",
        updatedAt: "2026-09-11T01:00:00.000Z",
        ownerId: null,
      },
    ],
    testCases: [
      {
        id: "set_1_case_1",
        testSetId: "set_1",
        caseId: "TC001",
        module: "登录",
        testPoint: "正常登录",
        title: "正确账密登录",
        priority: "高",
        precondition: "已注册",
        steps: "1. 输入账密",
        expectedResult: "1. 登录成功",
        row: ["TC001", "登录", "正常登录", "正确账密登录", "高", "已注册", "1. 输入账密", "1. 登录成功"],
      },
    ],
    generationJobs: [
      {
        id: "job_1",
        projectId: "proj_1",
        testSetId: "set_1",
        mode: "create",
        status: "completed",
        request: { featureName: "登录" },
        generatedCount: 1,
        error: "",
        resultHeader: ["用例编号"],
        resultRows: [["TC001"]],
        selectedIndices: [],
        createdAt: "2026-09-11T00:00:00.000Z",
        updatedAt: "2026-09-11T01:00:00.000Z",
        startedAt: "2026-09-11T00:30:00.000Z",
        finishedAt: "2026-09-11T01:00:00.000Z",
      },
    ],
  };
}

describe("testcase MySQL schema 与快照读写", () => {
  it("initTestcaseSchema 按序执行四张表的 CREATE TABLE", async () => {
    const { pool, calls } = createFakePool();
    await initTestcaseSchema(pool);

    expect(calls).toHaveLength(TESTCASE_SCHEMA_STATEMENTS.length);
    const sql = calls.map((call) => call.sql).join("\n");
    for (const table of ["tc_projects", "tc_test_sets", "tc_test_cases", "tc_generation_jobs"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("空库水合返回 null，交由调用方走文件迁移路径", async () => {
    const { pool } = createFakePool();
    const adapter = createMysqlTestcaseAdapter(pool);
    expect(await adapter.load()).toBeNull();
  });

  it("水合将 snake_case 行映射为领域记录（含 JSON 列与执行状态）", async () => {
    const createdAt = new Date("2026-09-11T00:00:00.000Z");
    const updatedAt = new Date("2026-09-11T01:00:00.000Z");
    const { pool } = createFakePool({
      selectRows: {
        tc_projects: [{ id: "proj_1", name: "项目", description: null, created_at: createdAt, owner_id: null }],
        tc_test_sets: [
          {
            id: "set_1",
            project_id: "proj_1",
            name: "登录",
            feature_name: "登录",
            test_type: "functional",
            language: "zh",
            prompt_preset: "google_qa",
            context: "登录需求",
            status: "completed",
            generation_job_id: null,
            error: null,
            requirement: null,
            header: JSON.stringify(["用例编号"]),
            case_rows: JSON.stringify([["TC001"]]),
            execution_status: JSON.stringify({ TC001: { status: "passed" } }),
            created_at: createdAt,
            updated_at: updatedAt,
            owner_id: null,
          },
        ],
        tc_test_cases: [],
        tc_generation_jobs: [],
      },
    });
    const adapter = createMysqlTestcaseAdapter(pool);
    const data = await adapter.load();

    expect(data).not.toBeNull();
    expect(data!.projects[0].name).toBe("项目");
    expect(data!.testSets[0].promptPreset).toBe("google_qa");
    expect(data!.testSets[0].header).toEqual(["用例编号"]);
    expect(data!.testSets[0].rows).toEqual([["TC001"]]);
    expect(data!.testSets[0].executionStatus?.TC001?.status).toBe("passed");
    expect(data!.testSets[0].updatedAt).toBe(updatedAt.toISOString());
  });

  it("写穿透只重写指定表：DELETE + 批量 INSERT 且在单事务内", async () => {
    const { pool, calls } = createFakePool();
    const adapter = createMysqlTestcaseAdapter(pool);

    await adapter.save(["testSets", "generationJobs"], sampleData());

    const sql = calls.map((call) => call.sql).join("\n");
    expect(sql).toContain("DELETE FROM tc_test_sets");
    expect(sql).toContain("DELETE FROM tc_generation_jobs");
    expect(sql).not.toContain("DELETE FROM tc_projects");
    expect(sql).not.toContain("DELETE FROM tc_test_cases");
    expect(sql).toContain("INSERT INTO tc_test_sets");
    expect(sql).toContain("INSERT INTO tc_generation_jobs");

    const insertCall = calls.find((call) => call.sql.includes("INSERT INTO tc_test_sets"));
    const params = (insertCall?.params?.[0] as unknown[][]) ?? [];
    expect(params[0][0]).toBe("set_1");
    expect(params[0][6]).toBe("google_qa"); // prompt_preset
    expect(JSON.parse(String(params[0][14]))).toEqual({ TC001: { status: "passed", updatedAt: "2026-09-11T01:00:00.000Z" } });
  });

  it("目标表无记录时只 DELETE 不 INSERT", async () => {
    const { pool, calls } = createFakePool();
    const adapter = createMysqlTestcaseAdapter(pool);
    await adapter.save(["projects"], { projects: [], testSets: [], testCases: [], generationJobs: [] });

    const sql = calls.map((call) => call.sql).join("\n");
    expect(sql).toContain("DELETE FROM tc_projects");
    expect(sql).not.toContain("INSERT INTO tc_projects");
  });
});
