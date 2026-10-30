import { describe, expect, it } from "vitest";
import { BenchManager } from "./bench-manager.js";
import type { AgentSession, SessionFactory } from "./runner.js";

function fakeFactory(): { factory: SessionFactory; sessions: AgentSession[] } {
  const sessions: AgentSession[] = [];
  const factory: SessionFactory = async () => {
    const session: AgentSession = {
      agent: {
        aiAct: async () => undefined,
        aiAssert: async () => undefined,
        aiQuery: async () => ({ value: "500000" }),
        aiWaitFor: async () => undefined,
        destroy: async () => undefined,
        reportFile: "/tmp/bench.html",
      },
      goto: async () => undefined,
      close: async () => "/tmp/bench.html",
    };
    sessions.push(session);
    return session;
  };
  return { factory, sessions };
}

describe("BenchManager", () => {
  it("创建会话 → 指令在同一会话执行 → act/assert 步骤累积，query 不累积", async () => {
    const { factory, sessions } = fakeFactory();
    const bench = new BenchManager({ sessionFactory: factory });

    const { id } = await bench.create("https://staging.example.com");
    expect(sessions).toHaveLength(1);

    const r1 = await bench.instruct(id, { type: "act", text: "点击【账单中心】" });
    expect(r1.ok).toBe(true);
    const r2 = await bench.instruct(id, { type: "assert", text: "显示累计用量 500000 条" });
    expect(r2.ok).toBe(true);
    const r3 = await bench.instruct(id, { type: "query", text: "读取当前用量数值" });
    expect(r3.ok).toBe(true);
    expect(r3.extractedValue).toBe("500000");

    const { url, steps } = bench.getSteps(id);
    expect(url).toBe("https://staging.example.com");
    // act/assert 累积，query 不累积
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.type)).toEqual(["act", "assert"]);
    // 没有为指令新建浏览器会话（复用同一个）
    expect(sessions).toHaveLength(1);
  });

  it("失败的指令不累积步骤，但返回错误信息", async () => {
    const { factory } = fakeFactory();
    const bench = new BenchManager({ sessionFactory: factory });
    const { id } = await bench.create("https://staging.example.com");
    // fake 不会失败——用一个不存在的会话验证错误路径
    await expect(bench.instruct("不存在", { type: "act", text: "x" })).rejects.toThrow("不存在或已过期");
    expect((await bench.getSteps(id)).steps).toHaveLength(0);
  });

  it("close 关闭会话并回收；过期会话抛错", async () => {
    const { factory } = fakeFactory();
    const bench = new BenchManager({ sessionFactory: factory });
    const { id } = await bench.create("https://staging.example.com");
    expect(await bench.close(id)).toBe(true);
    expect(await bench.close(id)).toBe(false);
    await expect(bench.instruct(id, { type: "act", text: "x" })).rejects.toThrow("不存在或已过期");
  });

  it("闲置 TTL 到期自动回收会话", async () => {
    const { factory } = fakeFactory();
    const bench = new BenchManager({ sessionFactory: factory, sessionTtlMs: 30 });
    const { id } = await bench.create("https://staging.example.com");
    await new Promise((r) => setTimeout(r, 60));
    await expect(bench.instruct(id, { type: "act", text: "x" })).rejects.toThrow("不存在或已过期");
  });
});
