import { describe, expect, it } from "vitest";
import { findElementAtPoint, mapActionToLabel } from "./harvest-mapping.js";
import type { FastElement, FastSnapshot } from "./snapshot.js";

const BUTTON: FastElement = {
  index: 1,
  kind: "click",
  role: "button",
  name: "登录",
  bbox: { x: 100, y: 200, w: 80, h: 32 },
};

const FIELD: FastElement = {
  index: 2,
  kind: "fill",
  role: "textbox",
  name: "账号输入框",
  bbox: { x: 100, y: 100, w: 200, h: 28 },
};

const SELECT: FastElement = {
  index: 3,
  kind: "select",
  role: "combobox",
  name: "套餐类型",
  value: "包年",
  bbox: { x: 100, y: 150, w: 120, h: 28 },
  options: [
    { index: "3:1", label: "包年", value: "yearly" },
    { index: "3:2", label: "包月", value: "monthly" },
  ],
};

const SNAPSHOT: FastSnapshot = {
  url: "https://app.example.com",
  title: "登录",
  text: "登录页",
  elements: [BUTTON, FIELD, SELECT],
};

describe("findElementAtPoint", () => {
  it("bbox 精确命中", () => {
    expect(findElementAtPoint(SNAPSHOT, 130, 210)?.index).toBe(1);
  });

  it("多个重叠时取最近中心", () => {
    const overlap: FastSnapshot = {
      ...SNAPSHOT,
      elements: [BUTTON, { ...BUTTON, index: 5, name: "更靠中心" }],
    };
    // 点在 BUTTON 中心与 5 的中心之间，更靠近 5
    const x = BUTTON.bbox.x + BUTTON.bbox.w / 2 + 4;
    expect(findElementAtPoint(overlap, x, 216)?.index).toBe(1);
  });

  it("bbox 外但在阈值内取最近元素；超阈值返回 null", () => {
    // (200,135)：FIELD bbox 下方 7px、距中心 21px（SELECT 距其 ~49px）
    expect(findElementAtPoint(SNAPSHOT, 200, 135)?.index).toBe(2);
    expect(findElementAtPoint(SNAPSHOT, 500, 500)).toBeNull();
  });
});

describe("mapActionToLabel", () => {
  it("Tap@point → CLICK + 元素序号", () => {
    const label = mapActionToLabel(SNAPSHOT, { name: "Tap", point: [140, 216] });
    expect(label).toEqual({ operation: "CLICK", target: "1" });
  });

  it("Input@point + param.value → TYPE_TEXT + 元素序号 + 文本", () => {
    const label = mapActionToLabel(SNAPSHOT, {
      name: "Input",
      point: [200, 114],
      param: { value: "user_normal" },
    });
    expect(label).toEqual({ operation: "TYPE_TEXT", target: "2", text: "user_normal" });
  });

  it("Input 无文本 → null（不产生残缺标签）", () => {
    expect(mapActionToLabel(SNAPSHOT, { name: "Input", point: [200, 114], param: {} })).toBeNull();
  });

  it("SelectOption + 值命中选项 → SELECT + i:j 复合序号", () => {
    const label = mapActionToLabel(SNAPSHOT, {
      name: "SelectOption",
      point: [160, 164],
      param: { value: "monthly" },
    });
    expect(label).toEqual({ operation: "SELECT", target: "3:2" });
  });

  it("SelectOption 值不在候选里 → null", () => {
    const label = mapActionToLabel(SNAPSHOT, {
      name: "SelectOption",
      point: [160, 164],
      param: { value: "weekly" },
    });
    expect(label).toBeNull();
  });

  it("Scroll 默认向下；param.direction=up 向上", () => {
    expect(mapActionToLabel(SNAPSHOT, { name: "Scroll" })).toEqual({ operation: "SCROLL_DOWN" });
    expect(mapActionToLabel(SNAPSHOT, { name: "Scroll", param: { direction: "up" } })).toEqual({ operation: "SCROLL_UP" });
  });

  it("坐标无元素命中 → null；未知动作名 → null", () => {
    expect(mapActionToLabel(SNAPSHOT, { name: "Tap", point: [900, 900] })).toBeNull();
    expect(mapActionToLabel(SNAPSHOT, { name: "KeyboardPress" })).toBeNull();
  });
});
