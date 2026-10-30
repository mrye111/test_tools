import { describe, expect, it } from "vitest";
import { buildDecisionQuestions, buildDecisionSpace, buildDecisionState, targetCandidatesOf, targetHeadKey } from "./questions.js";
import type { FastSnapshot } from "./snapshot.js";

const SNAPSHOT: FastSnapshot = {
  url: "https://app.example.com/login",
  title: "登录",
  text: "登录页 账号 密码 登录",
  elements: [
    { index: 1, kind: "fill", role: "textbox", name: "账号输入框", value: "", bbox: { x: 0, y: 0, w: 100, h: 30 } },
    { index: 2, kind: "fill", role: "textbox", name: "密码框", value: "", bbox: { x: 0, y: 40, w: 100, h: 30 } },
    { index: 3, kind: "click", role: "button", name: "登录", bbox: { x: 0, y: 80, w: 80, h: 30 } },
    {
      index: 4,
      kind: "select",
      role: "combobox",
      name: "语言",
      value: "中文",
      bbox: { x: 0, y: 120, w: 100, h: 30 },
      options: [{ index: "4:1", label: "English", value: "en" }],
    },
  ],
};

describe("buildDecisionSpace", () => {
  it("按元素 kind 启用操作集合；select 展开复合序号目标", () => {
    const space = buildDecisionSpace(SNAPSHOT);
    expect(Object.keys(space.clickTargets)).toEqual(["3"]);
    expect(Object.keys(space.fillTargets)).toEqual(["1", "2"]);
    expect(Object.keys(space.selectTargets)).toEqual(["4:1"]);
    // 常驻操作始终存在
    for (const key of ["SCROLL_UP", "SCROLL_DOWN", "WAIT", "DONE", "BLOCKED"]) {
      expect(space.operations[key]).toBeTruthy();
    }
    // 标签带当前值
    expect(space.selectTargets["4:1"]).toContain("语言");
    expect(space.selectTargets["4:1"]).toContain("English");
  });
});

describe("buildDecisionQuestions", () => {
  it("operation 头 + 各非空目标头，criteria 与 decision space 一致", () => {
    const questions = buildDecisionQuestions(SNAPSHOT, "登录");
    expect(questions.operation.type).toBe("choice");
    expect(Object.keys(questions.operation.criteria)).toContain("CLICK");
    expect(questions.click_target).toBeDefined();
    expect(questions.type_text_target).toBeDefined();
    expect(questions.select_target).toBeDefined();
    expect(questions.select_target.criteria["4:1"]).toContain("English");
    expect(questions.operation.instructions.goal).toBe("登录");
  });

  it("无 fill 元素时不出 type_text_target 头", () => {
    const clickOnly: FastSnapshot = { ...SNAPSHOT, elements: SNAPSHOT.elements.filter((el) => el.kind === "click") };
    const questions = buildDecisionQuestions(clickOnly, "x");
    expect(questions.click_target).toBeDefined();
    expect(questions.type_text_target).toBeUndefined();
    expect(questions.select_target).toBeUndefined();
  });
});

describe("buildDecisionState", () => {
  it("state 含 page/elements/recent_actions（history 截断 10 条）", () => {
    const state = buildDecisionState(SNAPSHOT, Array.from({ length: 12 }, (_, i) => `a${i}`)) as {
      page: { url: string };
      elements: { index: string; label: string }[];
      recent_actions: { action: string }[];
    };
    expect(state.page.url).toBe("https://app.example.com/login");
    expect(state.elements).toHaveLength(4);
    expect(state.elements[0].index).toBe("1");
    expect(state.recent_actions).toHaveLength(10);
    expect(state.recent_actions[0].action).toBe("a2");
  });
});

describe("targetHeadKey / targetCandidatesOf", () => {
  it("映射正确", () => {
    expect(targetHeadKey("CLICK")).toBe("click_target");
    expect(targetHeadKey("TYPE_TEXT")).toBe("type_text_target");
    expect(Object.keys(targetCandidatesOf(SNAPSHOT, "CLICK"))).toEqual(["3"]);
    expect(Object.keys(targetCandidatesOf(SNAPSHOT, "SELECT"))).toEqual(["4:1"]);
  });
});
