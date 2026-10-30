import { afterEach, describe, expect, it } from "vitest";
import type { Pool, PoolConnection } from "mysql2/promise";
import { createSecretCrypto } from "../src/shared/secret-crypto.js";
import { setJobSecretCrypto, SECRET_REF_PLACEHOLDER } from "../src/features/testcase/job-secrets.js";
import {
  TESTCASE_SCHEMA_STATEMENTS,
  createMysqlTestcaseAdapter,
  initTestcaseSchema,
  migrateGenerationJobSecrets,
} from "../src/features/testcase/mysql-persistence.js";
import type { JsonObject, TestCaseStoreData } from "../src/features/testcase/types.js";

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
        mode: "optimize",
        status: "completed",
        request: { featureName: "登录" },
        generatedCount: 1,
        error: "",
        optimizeStats: { modified: 2, added: 1, removed: 1 },
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
  it("initTestcaseSchema 执行四表 CREATE 并对存量库补列（重复列容忍跳过）", async () => {
    const { pool, calls } = createFakePool();
    await initTestcaseSchema(pool);

    expect(calls).toHaveLength(TESTCASE_SCHEMA_STATEMENTS.length + 5);
    const sql = calls.map((call) => call.sql).join("\n");
    for (const table of ["tc_projects", "tc_test_sets", "tc_test_cases", "tc_generation_jobs"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    for (const column of ["system_url", "icon_key", "icon_color"]) {
      expect(sql).toContain(`ALTER TABLE tc_projects ADD COLUMN ${column}`);
    }
    expect(sql).toContain("ALTER TABLE tc_generation_jobs ADD COLUMN optimize_stats");
    expect(sql).toContain("ALTER TABLE tc_generation_jobs ADD COLUMN api_key_enc");

    // 存量表已带列时 ALTER 报 ER_DUP_FIELDNAME(1060)，应容忍跳过而非失败
    const dupPool = {
      getConnection: async () => ({
        query: async (statement: string) => {
          if (statement.startsWith("ALTER TABLE")) {
            throw Object.assign(new Error("Duplicate column name"), { code: "ER_DUP_FIELDNAME" });
          }
          return [[], []];
        },
        release: () => {},
      }),
    } as unknown as Pool;
    await expect(initTestcaseSchema(dupPool)).resolves.toBeUndefined();

    // 非重复列错误必须上抛，不能吞掉真实故障
    const brokenPool = {
      getConnection: async () => ({
        query: async (statement: string) => {
          if (statement.startsWith("ALTER TABLE")) {
            throw Object.assign(new Error("Too many connections"), { code: "ER_CON_COUNT_ERROR" });
          }
          return [[], []];
        },
        release: () => {},
      }),
    } as unknown as Pool;
    await expect(initTestcaseSchema(brokenPool)).rejects.toThrow("Too many connections");
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
        tc_projects: [
          {
            id: "proj_1",
            name: "项目",
            description: null,
            system_url: "https://staging.shop.com",
            icon_key: "brand:wechat",
            icon_color: "#07C160",
            created_at: createdAt,
            owner_id: null,
          },
        ],
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
    expect(data!.projects[0].systemUrl).toBe("https://staging.shop.com");
    expect(data!.projects[0].iconKey).toBe("brand:wechat");
    expect(data!.projects[0].iconColor).toBe("#07C160");
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

    const jobInsertCall = calls.find((call) => call.sql.includes("INSERT INTO tc_generation_jobs"));
    const jobParams = (jobInsertCall?.params?.[0] as unknown[][]) ?? [];
    expect(jobParams[0][3]).toBe("optimize"); // mode
    expect(JSON.parse(String(jobParams[0][14]))).toEqual({ modified: 2, added: 1, removed: 1 }); // optimize_stats
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

/** 存量密钥迁移用的有状态假连接池：按游标 SELECT 候选行、UPDATE 落回。 */
function createMigrationPool(initial: { id: string; request: JsonObject }[]) {
  const rows = initial.map((item) => ({
    id: item.id,
    request: JSON.stringify(item.request),
    api_key_enc: null as string | null,
  }));
  const updates: { id: string; request: string; apiKeyEnc: string }[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT")) {
        const cursor = String(params?.[0] ?? "");
        const batch = rows
          .filter((row) => row.api_key_enc === null && row.id > cursor)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, 200);
        return [batch.map((row) => ({ ...row })), []];
      }
      if (sql.startsWith("UPDATE")) {
        const [apiKeyEnc, requestJson, id] = params as [string, string, string];
        const row = rows.find((item) => item.id === id);
        if (row) {
          row.api_key_enc = apiKeyEnc;
          row.request = requestJson;
        }
        updates.push({ id, request: requestJson, apiKeyEnc });
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    },
  } as unknown as Pool;
  return { pool, rows, updates };
}

describe("tc_generation_jobs 任务密钥剥离", () => {
  const secret = createSecretCrypto({ masterKeyBase64: Buffer.alloc(32, 7).toString("base64") });

  afterEach(() => setJobSecretCrypto(null));

  it("写穿透剥离 request.ai_config.apiKey：request 只留占位，api_key_enc 是信封不是明文", async () => {
    setJobSecretCrypto(secret);
    const { pool, calls } = createFakePool();
    const adapter = createMysqlTestcaseAdapter(pool);
    const data = sampleData();
    data.generationJobs[0] = {
      ...data.generationJobs[0],
      request: { featureName: "登录", ai_config: { baseUrl: "https://ai.test/v1", apiKey: "sk-plain-4242", model: "m" } },
    };

    await adapter.save(["generationJobs"], data);

    const insertCall = calls.find((call) => call.sql.includes("INSERT INTO tc_generation_jobs"));
    expect(String(insertCall?.sql)).toContain("api_key_enc");
    const params = (insertCall?.params?.[0] as unknown[][]) ?? [];
    const storedRequest = JSON.parse(String(params[0][5])) as JsonObject;
    expect((storedRequest.ai_config as JsonObject).apiKey).toBe(SECRET_REF_PLACEHOLDER);
    expect(String(params[0][5])).not.toContain("sk-plain-4242");
    // api_key_enc 列（INSERT 末位）是 v1 信封
    const apiKeyEnc = String(params[0][19]);
    expect(apiKeyEnc).toMatch(/^v1:/);
    expect(apiKeyEnc).not.toContain("sk-plain-4242");
    expect(secret.decrypt(apiKeyEnc)).toBe("sk-plain-4242");
  });

  it("未注入 SecretCrypto 且存在明文时拒绝写入（不落明文红线）", async () => {
    const { pool } = createFakePool();
    const adapter = createMysqlTestcaseAdapter(pool);
    const data = sampleData();
    data.generationJobs[0] = { ...data.generationJobs[0], request: { ai_config: { apiKey: "sk-plain-4242" } } };
    await expect(adapter.save(["generationJobs"], data)).rejects.toThrow(/SecretCrypto 未注入/);
  });

  it("水合还原：api_key_enc 解密回填 request.ai_config.apiKey（内存态）", async () => {
    setJobSecretCrypto(secret);
    const apiKeyEnc = secret.encrypt("sk-plain-4242");
    const createdAt = new Date("2026-09-11T00:00:00.000Z");
    const updatedAt = new Date("2026-09-11T01:00:00.000Z");
    const { pool } = createFakePool({
      selectRows: {
        tc_generation_jobs: [
          {
            id: "job_1",
            project_id: "proj_1",
            test_set_id: "set_1",
            mode: "create",
            status: "completed",
            request: JSON.stringify({ featureName: "登录", ai_config: { apiKey: SECRET_REF_PLACEHOLDER, model: "m" } }),
            api_key_enc: apiKeyEnc,
            generated_count: 1,
            generated_count_raw: null,
            added_count: null,
            duplicates_filtered: null,
            error: null,
            result_header: JSON.stringify([]),
            result_rows: JSON.stringify([]),
            selected_indices: JSON.stringify([]),
            optimize_stats: null,
            created_at: createdAt,
            updated_at: updatedAt,
            started_at: null,
            finished_at: null,
          },
        ],
      },
    });
    const adapter = createMysqlTestcaseAdapter(pool);
    const data = await adapter.load();

    const job = data!.generationJobs[0];
    expect((job.request.ai_config as JsonObject).apiKey).toBe("sk-plain-4242");
    expect(job.apiKeyEnc).toBe(apiKeyEnc);
  });

  it("一次性迁移幂等：明文一次清零，跑两遍结果一致", async () => {
    const { pool, rows, updates } = createMigrationPool([
      { id: "job_a", request: { ai_config: { apiKey: "sk-a-plain", model: "m" } } },
      { id: "job_b", request: { apiKey: "sk-b-plain", context: "x" } },
      { id: "job_c", request: { context: "no key" } },
    ]);

    const first = await migrateGenerationJobSecrets(pool, secret);
    expect(first).toBe(2);
    expect(updates).toHaveLength(2);

    // 明文一次清零（嵌套与扁平两种形态都剥离）
    for (const row of rows) {
      expect(row.request).not.toContain("sk-a-plain");
      expect(row.request).not.toContain("sk-b-plain");
    }
    const rowA = rows.find((row) => row.id === "job_a")!;
    const rowB = rows.find((row) => row.id === "job_b")!;
    const rowC = rows.find((row) => row.id === "job_c")!;
    const requestA = JSON.parse(rowA.request) as { ai_config: { apiKey: string } };
    expect(requestA.ai_config.apiKey).toBe(SECRET_REF_PLACEHOLDER);
    expect(rowA.api_key_enc).toMatch(/^v1:/);
    expect(secret.decrypt(rowA.api_key_enc!)).toBe("sk-a-plain");
    const requestB = JSON.parse(rowB.request) as { apiKey: string };
    expect(requestB.apiKey).toBe(SECRET_REF_PLACEHOLDER);
    expect(secret.decrypt(rowB.api_key_enc!)).toBe("sk-b-plain");
    // 无密钥行不被迁移（api_key_enc 保持 NULL）
    expect(rowC.api_key_enc).toBeNull();

    // 重跑无新增 UPDATE，行内容不变（幂等）
    const snapshot = rows.map((row) => ({ ...row }));
    const second = await migrateGenerationJobSecrets(pool, secret);
    expect(second).toBe(0);
    expect(updates).toHaveLength(2);
    expect(rows).toEqual(snapshot);
  });
});
