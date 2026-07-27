import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerRequirementRoutes } from "../src/features/requirement/routes.js";
import { RequirementAnalysisStore } from "../src/features/requirement/store.js";
import type { AnalysisRecord } from "../src/features/requirement/types.js";

const tempDirs: string[] = [];

/** 注入临时目录 store 的最小 app：与 createMcpExpressApp 走同一组路由处理器，但不碰真实数据文件。 */
function createRecordsApp() {
  const dir = mkdtempSync(join(tmpdir(), "requirement-analysis-routes-"));
  tempDirs.push(dir);
  const storePath = join(dir, "store.json");
  const store = new RequirementAnalysisStore(storePath, { persistDebounceMs: 0 });
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerRequirementRoutes(app, store);
  return { app, store, storePath };
}

async function withServer(run: (baseUrl: string, store: RequirementAnalysisStore, storePath: string) => Promise<void>) {
  const { app, store, storePath } = createRecordsApp();
  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`, store, storePath);
  } finally {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }
}

const validTree = { id: "root", title: "登录需求", children: [{ id: "m1", title: "登录模块", children: [] }] };

function postBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "登录需求",
    tree: validTree,
    findings: [
      { type: "risk", title: "验证码暴力破解", detail: "未说明错误次数限制", nodeId: "m1" },
      { type: "unknown-type", title: "类型会被归一", detail: "", nodeId: "m1" },
      { title: "缺 nodeId 会被丢弃" },
    ],
    sourceText: "用户通过手机号+验证码登录。",
    ...overrides,
  };
}

async function createRecord(baseUrl: string, body: Record<string, unknown> = postBody()) {
  const response = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as { success: boolean; record?: AnalysisRecord; error?: string } };
}

/** 直接写 store 造分页数据：updatedAt 显式递增，排序断言不依赖真实时钟。 */
function seedRecords(store: RequirementAnalysisStore, count: number) {
  for (let index = 0; index < count; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 6, 24, 0, 0, index)).toISOString();
    store.createRecord({
      id: `rec_${String(index).padStart(2, "0")}`,
      name: `记录 ${index}`,
      chartType: "mindmap",
      title: `需求 ${index}`,
      tree: validTree,
      findings: [{ id: "f1", type: "risk", title: "风险", detail: "", nodeId: "m1" }],
      sourceText: "原文",
      truncated: false,
      warnings: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("POST /api/requirement-analysis/records", () => {
  it("创建记录：name 缺省回退 title，chartType 归一化，findings 过滤，id 带 rec_ 前缀", async () => {
    await withServer(async (baseUrl, store) => {
      const { status, body } = await createRecord(baseUrl, postBody({ chartType: "pie" }));

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const record = body.record!;
      expect(record.id).toMatch(/^rec_[a-z0-9]+_[0-9a-f]{8}$/);
      expect(record.name).toBe("登录需求");
      expect(record.chartType).toBe("mindmap");
      expect(record.findings).toHaveLength(2);
      expect(record.findings[1]?.type).toBe("clarification");
      expect(record.createdAt).toBe(record.updatedAt);
      // 立即落盘：store 内存态可读
      expect(store.getRecord(record.id)?.name).toBe("登录需求");
    });
  });

  it("显式 name 去空白后优先于 title，title 缺省回退树根标题", async () => {
    await withServer(async (baseUrl) => {
      const named = await createRecord(baseUrl, postBody({ name: "  我的分析  " }));
      expect(named.body.record?.name).toBe("我的分析");

      const untitled = await createRecord(baseUrl, postBody({ title: "" }));
      expect(untitled.body.record?.title).toBe("登录需求");
      expect(untitled.body.record?.name).toBe("登录需求");
    });
  });

  it("tree 无效时返回 400 与统一错误格式", async () => {
    await withServer(async (baseUrl) => {
      const { status, body } = await createRecord(baseUrl, { title: "x", tree: { children: [] } });
      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("需求分解树");
    });
  });
});

describe("GET /api/requirement-analysis/records（列表分页）", () => {
  it("按 updatedAt 倒序返回摘要，total/page/pageSize 正确", async () => {
    await withServer(async (baseUrl, store) => {
      seedRecords(store, 12);

      const response = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records?page=2&pageSize=5`);
      const body = (await response.json()) as {
        success: boolean;
        records: Array<{ id: string; findingsCount: { risk: number } }>;
        total: number;
        page: number;
        pageSize: number;
      };

      expect(body.success).toBe(true);
      expect(body.total).toBe(12);
      expect(body.page).toBe(2);
      expect(body.pageSize).toBe(5);
      expect(body.records.map((item) => item.id)).toEqual(["rec_06", "rec_05", "rec_04", "rec_03", "rec_02"]);
      // 摘要形态：计数而非 findings 数组
      expect(body.records[0]?.findingsCount).toEqual({ risk: 1, ambiguity: 0, clarification: 0 });
      expect(body.records[0]).not.toHaveProperty("tree");
    });
  });

  it("缺省分页 page=1/pageSize=10，pageSize 超过上限按 50 截断，非法参数回退", async () => {
    await withServer(async (baseUrl, store) => {
      seedRecords(store, 3);

      const defaults = await (await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records`)).json() as {
        page: number; pageSize: number; records: unknown[];
      };
      expect(defaults.page).toBe(1);
      expect(defaults.pageSize).toBe(10);
      expect(defaults.records).toHaveLength(3);

      const capped = await (await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records?pageSize=100`)).json() as { pageSize: number };
      expect(capped.pageSize).toBe(50);

      const invalid = await (await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records?page=-2&pageSize=abc`)).json() as { page: number; pageSize: number };
      expect(invalid.page).toBe(1);
      expect(invalid.pageSize).toBe(10);
    });
  });
});

describe("GET/PATCH/DELETE /api/requirement-analysis/records/:id", () => {
  it("GET 单条返回完整记录，不存在返回 404 统一错误格式", async () => {
    await withServer(async (baseUrl) => {
      const created = await createRecord(baseUrl);
      const id = created.body.record!.id;

      const found = await (await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${id}`)).json() as {
        success: boolean; record: AnalysisRecord;
      };
      expect(found.success).toBe(true);
      expect(found.record.tree.children[0]?.title).toBe("登录模块");
      expect(found.record.sourceText).toContain("验证码");

      const missing = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/rec_missing`);
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { success: boolean }).success).toBe(false);
    });
  });

  it("PATCH 更新名称与图表类型并刷新 updatedAt；空白名不改名；未传 chartType 保持原值", async () => {
    await withServer(async (baseUrl) => {
      const created = await createRecord(baseUrl, postBody({ chartType: "tree" }));
      const record = created.body.record!;

      const patched = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  新名字  ", chartType: "logic" }),
      });
      const patchedBody = (await patched.json()) as { success: boolean; record: AnalysisRecord };
      expect(patchedBody.record.name).toBe("新名字");
      expect(patchedBody.record.chartType).toBe("logic");
      expect(patchedBody.record.updatedAt >= record.updatedAt).toBe(true);
      expect(patchedBody.record.createdAt).toBe(record.createdAt);

      const blank = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      });
      const blankBody = (await blank.json()) as { record: AnalysisRecord };
      expect(blankBody.record.name).toBe("新名字");
      expect(blankBody.record.chartType).toBe("logic");

      const missing = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/rec_missing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      });
      expect(missing.status).toBe(404);
    });
  });

  it("PATCH 非法 chartType 返回 400，不静默覆盖原值", async () => {
    await withServer(async (baseUrl) => {
      const created = await createRecord(baseUrl, postBody({ chartType: "tree" }));
      const record = created.body.record!;

      const invalid = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chartType: "pie" }),
      });
      expect(invalid.status).toBe(400);
      expect(((await invalid.json()) as { success: boolean }).success).toBe(false);

      // 原值未被改写
      const found = await (await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${record.id}`)).json() as { record: AnalysisRecord };
      expect(found.record.chartType).toBe("tree");
    });
  });

  it("DELETE 删除后 GET 返回 404；删除不存在的记录同样 404（与 GET 对齐）", async () => {
    await withServer(async (baseUrl) => {
      const created = await createRecord(baseUrl);
      const id = created.body.record!.id;

      const deleted = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${id}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(((await deleted.json()) as { success: boolean }).success).toBe(true);

      expect((await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${id}`)).status).toBe(404);
      expect((await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${id}`, { method: "DELETE" })).status).toBe(404);
    });
  });

  it("重启后记录仍在（store 从磁盘恢复，路由层无状态）", async () => {
    await withServer(async (baseUrl, _store, storePath) => {
      const created = await createRecord(baseUrl);
      const id = created.body.record!.id;
      // 同一路径新实例即可读到，等价于进程重启后恢复
      const reopened = new RequirementAnalysisStore(storePath, { persistDebounceMs: 0 });
      expect(reopened.getRecord(id)?.name).toBe("登录需求");
    });
  });
});
