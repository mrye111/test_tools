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
    await createRecord();
    const patched = await api("/api/requirement-analysis-v2/issues/iss-1", { method: "PATCH", body: JSON.stringify({ status: "resolved" }) });
    expect((patched.body.issue as { status: string }).status).toBe("resolved");
    expect((await api("/api/requirement-analysis-v2/issues/iss-1", { method: "PATCH", body: JSON.stringify({ status: "weird" }) })).status).toBe(400);
  });

  it("准则驳回闭环：生成不可测问题条目", async () => {
    const id = await createRecord();
    const { status, body } = await api("/api/requirement-analysis-v2/criteria/cri-1", { method: "PATCH", body: JSON.stringify({ status: "rejected" }) });
    expect(status).toBe(200);
    const issue = body.issue as { type: string; status: string };
    expect(issue.type).toBe("untestable");
    expect(issue.status).toBe("open");

    const detail = await api(`/api/requirement-analysis-v2/records/${id}`);
    expect((detail.body.record as { issues: unknown[] }).issues.length).toBe(2);
  });

  it("接力与回写：relay → link-testset → RTM 覆盖率", async () => {
    const id = await createRecord();

    const relay = await api(`/api/requirement-analysis-v2/records/${id}/relay`, { method: "POST", body: JSON.stringify({ conditionIds: ["cond-1", "cond-2"] }) });
    expect((relay.body as { marked: number }).marked).toBe(2);

    expect((await api(`/api/requirement-analysis-v2/records/${id}/relay`, { method: "POST", body: JSON.stringify({ conditionIds: "bad" }) })).status).toBe(400);

    const link = await api("/api/requirement-analysis-v2/link-testset", { method: "POST", body: JSON.stringify({ conditionIds: ["cond-1"], testsetId: "ts_9" }) });
    expect((link.body as { linked: number }).linked).toBe(1);

    const rtm = await api(`/api/requirement-analysis-v2/records/${id}/rtm`);
    const view = rtm.body.rtm as { totalConditions: number; coveredConditions: number; coverage: number };
    expect(view.totalConditions).toBe(2);
    expect(view.coveredConditions).toBe(1);
    expect(view.coverage).toBe(50);
  });
});
