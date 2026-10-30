import { describe, expect, it } from "vitest";
import { runFastAct, type FastPageAdapter } from "./fast-loop.js";
import type { FastDecision, FastDecisionBackend } from "./decision-backend.js";
import type { FastElement, FastSnapshot } from "./snapshot.js";

const ELEMENT: FastElement = {
  index: 1,
  kind: "click",
  role: "button",
  name: "登录",
  bbox: { x: 100, y: 100, w: 80, h: 32 },
};

const FIELD: FastElement = {
  index: 2,
  kind: "fill",
  role: "textbox",
  name: "账号输入框",
  bbox: { x: 100, y: 50, w: 200, h: 28 },
};

function snapshot(elements: FastElement[] = [ELEMENT, FIELD]): FastSnapshot {
  return { url: "https://app.example.com/login", title: "登录", text: "登录页 账号 密码 登录", elements };
}

function fakeAdapter(snapshots: FastSnapshot[]): { adapter: FastPageAdapter; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const adapter: FastPageAdapter = {
    page: {
      evaluate: async () => snapshots[Math.min(i++, snapshots.length - 1)],
    } as unknown as FastPageAdapter["page"],
    clickElement: async (el) => {
      calls.push(`click:[${el.index}]${el.name}`);
    },
    fillElement: async (el, text) => {
      calls.push(`fill:[${el.index}]${el.name}=${text}`);
    },
    selectOption: async (el, composite) => {
      calls.push(`select:[${el.index}]=${composite}`);
    },
    scroll: async (dir) => {
      calls.push(`scroll:${dir}`);
    },
  };
  return { adapter, calls };
}

function scriptedBackend(decisions: FastDecision[]): FastDecisionBackend & { calls: number } {
  let i = 0;
  return {
    name: "scripted",
    get calls() {
      return i;
    },
    decide: async () => decisions[Math.min(i++, decisions.length - 1)],
  };
}

const CLICK: FastDecision = { operation: "CLICK", target: "1", confidence: 0.9 };
const DONE: FastDecision = { operation: "DONE", confidence: 0.95 };
const BLOCKED: FastDecision = { operation: "BLOCKED", confidence: 0.9 };

describe("runFastAct", () => {
  it("CLICK → DONE：执行动作并成功收尾", async () => {
    const { adapter, calls } = fakeAdapter([snapshot(), snapshot()]);
    const backend = scriptedBackend([CLICK, DONE]);
    const result = await runFastAct("点击【登录】", adapter, { backend });
    expect(result.ok).toBe(true);
    expect(result.fallback).toBe(false);
    expect(calls).toEqual(["click:[1]登录"]);
    expect(backend.calls).toBe(2);
  });

  it("BLOCKED → fallback（由视觉引擎接手）", async () => {
    const { adapter } = fakeAdapter([snapshot()]);
    const result = await runFastAct("点击不存在的东西", adapter, { backend: scriptedBackend([BLOCKED]) });
    expect(result.ok).toBe(false);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe("blocked");
  });

  it("低置信 → fallback", async () => {
    const { adapter } = fakeAdapter([snapshot()]);
    const result = await runFastAct("x", adapter, {
      backend: scriptedBackend([{ ...CLICK, confidence: 0.3 }]),
      minConfidence: 0.5,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("low-confidence");
    expect(result.fallback).toBe(true);
  });

  it("开局 DONE（无动作）→ 不信任，fallback", async () => {
    const { adapter } = fakeAdapter([snapshot()]);
    const result = await runFastAct("x", adapter, { backend: scriptedBackend([DONE]) });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("done-without-action");
    expect(result.fallback).toBe(true);
  });

  it("超过迭代上限 → fallback", async () => {
    const { adapter } = fakeAdapter([snapshot(), snapshot(), snapshot(), snapshot()]);
    const scroll: FastDecision = { operation: "SCROLL_DOWN", confidence: 0.9 };
    const result = await runFastAct("x", adapter, {
      backend: scriptedBackend([scroll]),
      maxIterations: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("iteration-limit");
    expect(result.fallback).toBe(true);
  });

  it("TYPE_TEXT 用决策自带的值填充", async () => {
    const { adapter, calls } = fakeAdapter([snapshot(), snapshot()]);
    const backend = scriptedBackend([
      { operation: "TYPE_TEXT", target: "2", text: "user_normal", confidence: 0.9 },
      DONE,
    ]);
    const result = await runFastAct("在账号输入框输入user_normal", adapter, { backend });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["fill:[2]账号输入框=user_normal"]);
  });

  it("TYPE_TEXT 无值时用 textWriter 补；无 writer 则 fallback(no-text-value)", async () => {
    const { adapter, calls } = fakeAdapter([snapshot(), snapshot()]);
    const backend = scriptedBackend([{ operation: "TYPE_TEXT", target: "2", confidence: 0.9 }, DONE]);
    const withWriter = await runFastAct("输入用户名", adapter, {
      backend,
      textWriter: async () => "user_normal",
    });
    expect(withWriter.ok).toBe(true);
    expect(calls).toEqual(["fill:[2]账号输入框=user_normal"]);

    const { adapter: adapter2 } = fakeAdapter([snapshot()]);
    const backend2 = scriptedBackend([{ operation: "TYPE_TEXT", target: "2", confidence: 0.9 }]);
    const noWriter = await runFastAct("输入用户名", adapter2, { backend: backend2 });
    expect(noWriter.ok).toBe(false);
    expect(noWriter.reason).toBe("no-text-value");
  });

  it("决策指向不存在的元素 → fallback", async () => {
    const { adapter } = fakeAdapter([snapshot()]);
    const result = await runFastAct("x", adapter, {
      backend: scriptedBackend([{ operation: "CLICK", target: "99", confidence: 0.9 }]),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("99");
    expect(result.fallback).toBe(true);
  });
});

describe("runFastAct - 回放帧采集", () => {
  function adapterWithScreenshot(snapshots: FastSnapshot[]): FastPageAdapter {
    const { adapter } = fakeAdapter(snapshots);
    (adapter.page as { screenshot?: unknown }).screenshot = async () => Buffer.from("fake-jpeg-bytes");
    return adapter;
  }

  it("captureFrames 开启：决策帧 + 动作帧 + DONE 决策帧，含截图与目标信息", async () => {
    const result = await runFastAct("点击【登录】", adapterWithScreenshot([snapshot(), snapshot()]), {
      backend: scriptedBackend([CLICK, DONE]),
      captureFrames: true,
    });
    expect(result.ok).toBe(true);
    expect(result.frames.map((f) => f.phase)).toEqual(["decision", "action", "decision"]);
    const action = result.frames[1];
    expect(action.operation).toBe("CLICK");
    expect(action.targetLabel).toBe("[1] 登录");
    expect(action.targetBox).toEqual(ELEMENT.bbox);
    expect(action.screenshot.length).toBeGreaterThan(0);
    expect(result.frames[0].confidence).toBe(0.9);
    expect(result.frames[2].operation).toBe("DONE");
  });

  it("默认不采集（frames 为空）", async () => {
    const result = await runFastAct("点击【登录】", adapterWithScreenshot([snapshot(), snapshot()]), {
      backend: scriptedBackend([CLICK, DONE]),
    });
    expect(result.frames).toEqual([]);
  });

  it("动作失败记录失败现场帧（含原因）", async () => {
    const adapter = adapterWithScreenshot([snapshot()]);
    adapter.clickElement = async () => {
      throw new Error("被遮挡");
    };
    const result = await runFastAct("点击", adapter, { backend: scriptedBackend([CLICK]), captureFrames: true });
    expect(result.ok).toBe(false);
    const last = result.frames.at(-1);
    expect(last?.phase).toBe("failed");
    expect(last?.reason).toContain("被遮挡");
  });
});
