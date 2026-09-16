import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { registerRequirementV2Routes } from "./routes.js";
import { MemoryAnalysisRepository } from "./repository.js";
import { makeInput } from "./repository-contract.test.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerRequirementV2Routes(app, new MemoryAnalysisRepository());
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function createRecord(): Promise<string> {
  const { status, body } = await api("/api/requirement-analysis-v2/records", {
    method: "POST",
    body: JSON.stringify(makeInput()),
  });
  expect(status).toBe(201);
  return (body.record as { id: string }).id;
}

/** 创建并返回完整详情（子资源 id 由服务端重映射，必须从返回值取） */
async function createDetail(): Promise<{ id: string; issues: Array<{ id: string }>; criteria: Array<{ id: string }>; conditions: Array<{ id: string }> }> {
  const { body } = await api("/api/requirement-analysis-v2/records", {
    method: "POST",
    body: JSON.stringify(makeInput()),
  });
  return body.record as { id: string; issues: Array<{ id: string }>; criteria: Array<{ id: string }>; conditions: Array<{ id: string }> };
}

describe("requirement-v2 路由", () => {
  it("storage-status 返回 memory 模式", async () => {
    const { status, body } = await api("/api/requirement-analysis-v2/storage-status");
    expect(status).toBe(200);
    expect(body.mode).toBe("memory");
  });

  it("创建校验：缺 title/sourceText 400", async () => {
    expect((await api("/api/requirement-analysis-v2/records", { method: "POST", body: JSON.stringify({ sourceText: "x" }) })).status).toBe(400);
    expect((await api("/api/requirement-analysis-v2/records", { method: "POST", body: JSON.stringify({ title: "x" }) })).status).toBe(400);
  });

  it("创建只取白名单字段，多余字段（如凭据）不落盘", async () => {
    const { body } = await api("/api/requirement-analysis-v2/records", {
      method: "POST",
      body: JSON.stringify({ ...makeInput(), apiKey: "sk-should-not-persist", modelConfig: { apiKey: "sk-x" } }),
    });
    const record = body.record as Record<string, unknown>;
    expect(JSON.stringify(record)).not.toContain("sk-");
  });

  it("列表/详情/重命名/删除闭环，不存在 404", async () => {
    const id = await createRecord();

    const list = await api("/api/requirement-analysis-v2/records");
    expect(list.status).toBe(200);
    expect((list.body.records as unknown[]).length).toBeGreaterThan(0);

    const detail = await api(`/api/requirement-analysis-v2/records/${id}`);
    expect((detail.body.record as { conditions: unknown[] }).conditions).toHaveLength(2);

    const renamed = await api(`/api/requirement-analysis-v2/records/${id}`, { method: "PATCH", body: JSON.stringify({ title: "改名" }) });
    expect((renamed.body.record as { title: string }).title).toBe("改名");

    expect((await api(`/api/requirement-analysis-v2/records/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/requirement-analysis-v2/records/${id}`)).status).toBe(404);
  });

  it("问题 patch 与非法状态 400", async () => {
    const record = await createDetail();
    const issueId = record.issues[0].id;
    const patched = await api(`/api/requirement-analysis-v2/issues/${issueId}`, { method: "PATCH", body: JSON.stringify({ status: "resolved" }) });
    expect((patched.body.issue as { status: string }).status).toBe("resolved");
    expect((await api(`/api/requirement-analysis-v2/issues/${issueId}`, { method: "PATCH", body: JSON.stringify({ status: "weird" }) })).status).toBe(400);
  });

  it("准则驳回闭环：生成不可测问题条目", async () => {
    const record = await createDetail();
    const id = record.id;
    const { status, body } = await api(`/api/requirement-analysis-v2/criteria/${record.criteria[0].id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) });
    expect(status).toBe(200);
    const issue = body.issue as { type: string; status: string };
    expect(issue.type).toBe("untestable");
    expect(issue.status).toBe("open");

    const detail = await api(`/api/requirement-analysis-v2/records/${id}`);
    expect((detail.body.record as { issues: unknown[] }).issues.length).toBe(2);
  });

  it("条件 CRUD：创建/编辑/删除与归属校验", async () => {
    const record = await createDetail();
    const reqId = (await api(`/api/requirement-analysis-v2/records/${record.id}`)).body.record as { requirements: Array<{ id: string }> };
    const targetReqId = reqId.requirements[0].id;

    const created = await api(`/api/requirement-analysis-v2/records/${record.id}/conditions`, {
      method: "POST",
      body: JSON.stringify({ reqId: targetReqId, text: "人工新增", kind: "exception" }),
    });
    expect(created.status).toBe(201);
    const condition = (created.body as { condition: { id: string; relay: string } }).condition;
    expect(condition.relay).toBe("none");

    const edited = await api(`/api/requirement-analysis-v2/records/${record.id}/conditions/${condition.id}`, {
      method: "PATCH",
      body: JSON.stringify({ text: "改后", kind: "boundary" }),
    });
    expect((edited.body as { condition: { text: string } }).condition.text).toBe("改后");

    expect((await api(`/api/requirement-analysis-v2/records/${record.id}/conditions`, { method: "POST", body: JSON.stringify({ reqId: "ghost", text: "x", kind: "normal" }) })).status).toBe(404);

    expect((await api(`/api/requirement-analysis-v2/records/${record.id}/conditions/${condition.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("问题批量更新：状态校验与跨记录拒绝", async () => {
    const record = await createDetail();
    const detail = (await api(`/api/requirement-analysis-v2/records/${record.id}`)).body.record as { issues: Array<{ id: string }> };
    const ids = detail.issues.map((i) => i.id);

    expect((await api(`/api/requirement-analysis-v2/records/${record.id}/issues/bulk`, { method: "POST", body: JSON.stringify({ issueIds: ids, status: "resolved" }) })).status).toBe(200);
    expect((await api(`/api/requirement-analysis-v2/records/${record.id}/issues/bulk`, { method: "POST", body: JSON.stringify({ issueIds: [], status: "resolved" }) })).status).toBe(400);
    expect((await api(`/api/requirement-analysis-v2/records/${record.id}/issues/bulk`, { method: "POST", body: JSON.stringify({ issueIds: ids, status: "weird" }) })).status).toBe(400);
    expect((await api(`/api/requirement-analysis-v2/records/${record.id}/issues/bulk`, { method: "POST", body: JSON.stringify({ issueIds: ["ghost"], status: "resolved" }) })).status).toBe(404);
  });

  it("接力与回写：relay → link-testset → RTM 覆盖率", async () => {
    const record = await createDetail();
    const id = record.id;
    const [cond1, cond2] = record.conditions.map((c) => c.id);

    const relay = await api(`/api/requirement-analysis-v2/records/${id}/relay`, { method: "POST", body: JSON.stringify({ conditionIds: [cond1, cond2] }) });
    expect((relay.body as { marked: number }).marked).toBe(2);

    expect((await api(`/api/requirement-analysis-v2/records/${id}/relay`, { method: "POST", body: JSON.stringify({ conditionIds: "bad" }) })).status).toBe(400);

    const link = await api("/api/requirement-analysis-v2/link-testset", { method: "POST", body: JSON.stringify({ conditionIds: [cond1], testsetId: "ts_9" }) });
    expect((link.body as { linked: number }).linked).toBe(1);

    const rtm = await api(`/api/requirement-analysis-v2/records/${id}/rtm`);
    const view = rtm.body.rtm as { totalConditions: number; coveredConditions: number; coverage: number };
    expect(view.totalConditions).toBe(2);
    expect(view.coveredConditions).toBe(1);
    expect(view.coverage).toBe(50);
  });
});
