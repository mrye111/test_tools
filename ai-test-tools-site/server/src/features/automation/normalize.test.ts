import { describe, expect, it } from "vitest";
import { normalizeCaseText, normalizeNewlines, splitNumberedItems } from "./normalize.js";

describe("normalizeNewlines", () => {
  it("字面 \\n 两字符序列归一为真实换行", () => {
    expect(normalizeNewlines("a\\nb")).toBe("a\nb");
  });

  it("真实换行保持不变", () => {
    expect(normalizeNewlines("a\nb")).toBe("a\nb");
  });
});

describe("splitNumberedItems", () => {
  it("真实换行 + 点号编号（登录集形态）", () => {
    const text = "1. 访问系统登录页面\n2. 在账号输入框输入user_normal\n3. 点击【登录】按钮";
    expect(splitNumberedItems(text)).toEqual([
      "访问系统登录页面",
      "在账号输入框输入user_normal",
      "点击【登录】按钮",
    ]);
  });

  it("字面 \\n + 无空格编号（套餐集形态）", () => {
    const text = "1.确认累计用量500000条\\n2.再发起20000条调用使累计达520000条\\n3.触发结算\\n4.查看账单构成";
    expect(splitNumberedItems(text)).toEqual([
      "确认累计用量500000条",
      "再发起20000条调用使累计达520000条",
      "触发结算",
      "查看账单构成",
    ]);
  });

  it("兼容顿号与括号编号标记", () => {
    expect(splitNumberedItems("1、打开页面\n2) 点击按钮")).toEqual(["打开页面", "点击按钮"]);
  });

  it("文本中的小数不断裂条目", () => {
    const text = "1.确认超出单价0.05元/条\n2.查看账单";
    expect(splitNumberedItems(text)).toEqual(["确认超出单价0.05元/条", "查看账单"]);
  });

  it("无编号时退化为按换行/分号切分", () => {
    expect(splitNumberedItems("打开页面；点击按钮")).toEqual(["打开页面", "点击按钮"]);
    expect(splitNumberedItems("打开页面\n点击按钮")).toEqual(["打开页面", "点击按钮"]);
  });

  it("空段与首尾空白被清理", () => {
    expect(splitNumberedItems("  1. 打开页面 \n\n2.  点击按钮  ")).toEqual(["打开页面", "点击按钮"]);
  });
});

describe("normalizeCaseText", () => {
  it("步骤与预期分别切分且位置对应", () => {
    const { steps, expected } = normalizeCaseText(
      "1.打开A\n2.点击B",
      "1.显示A\n2.跳转C",
    );
    expect(steps).toHaveLength(2);
    expect(expected).toHaveLength(2);
    expect(steps[1]).toBe("点击B");
    expect(expected[1]).toBe("跳转C");
  });
});
