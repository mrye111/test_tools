import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

function createRecordDirectly(store: RequirementAnalysisStore, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  store.createRecord({
    id: `rec_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    name: "登录需求",
    chartType: "mindmap",
    title: "登录需求",
    tree: validTree,
    findings: [
      { id: "f1", type: "risk", title: "验证码暴力破解", detail: "未说明错误次数限制", nodeId: "m1" },
    ],
    sourceText: "用户通过手机号+验证码登录。",
    truncated: false,
    warnings: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as AnalysisRecord);
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET/PATCH/DELETE /api/requirement-analysis/records/:id", () => {
  it("GET 单条返回完整记录，不存在返回 404 统一错误格式", async () => {
    await withServer(async (baseUrl, store) => {
      createRecordDirectly(store);
      const records = store.listRecords();
      expect(records).toHaveLength(1);
      const id = records[0].id;

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
    await withServer(async (baseUrl, store) => {
      createRecordDirectly(store, { chartType: "tree" });
      const record = store.listRecords()[0];

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
    await withServer(async (baseUrl, store) => {
      createRecordDirectly(store, { chartType: "tree" });
      const record = store.listRecords()[0];

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
    await withServer(async (baseUrl, store) => {
      createRecordDirectly(store);
      const id = store.listRecords()[0].id;

      const deleted = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${id}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(((await deleted.json()) as { success: boolean }).success).toBe(true);

      expect((await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${id}`)).status).toBe(404);
      expect((await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records/${id}`, { method: "DELETE" })).status).toBe(404);
    });
  });

  it("重启后记录仍在（store 从磁盘恢复，路由层无状态）", async () => {
    await withServer(async (baseUrl, store, storePath) => {
      createRecordDirectly(store);
      const id = store.listRecords()[0].id;
      // 同一路径新实例即可读到，等价于进程重启后恢复
      const reopened = new RequirementAnalysisStore(storePath, { persistDebounceMs: 0 });
      expect(reopened.getRecord(id)?.name).toBe("登录需求");
    });
  });
});

/**
 * 退役旧路由回归：POST /records 与 GET /records 列表已删除，应返回 404。
 */
describe("退役旧记录路由", () => {
  it("POST /api/requirement-analysis/records 返回 404", async () => {
    await withServer(async (baseUrl) => {
      const response = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x", tree: validTree }),
      });
      expect(response.status).toBe(404);
    });
  });

  it("GET /api/requirement-analysis/records 列表返回 404", async () => {
    await withServer(async (baseUrl) => {
      const response = await globalThis.fetch(`${baseUrl}/api/requirement-analysis/records`);
      expect(response.status).toBe(404);
    });
  });
});
