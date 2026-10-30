import { describe, expect, it } from "vitest";
import { cronMatches, describeCron, validateCron } from "./cron.js";

/** 构造指定本地时间的 Date（匹配器按本地时间取分/时/日/月/周）。 */
function at(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(y, mo - 1, d, h, mi);
}

// 2026-11-03 是周二（dow=2），此处仅作分/时断言的基准时刻
const MONDAY = at(2026, 11, 3, 9, 30);
const SUNDAY = at(2026, 11, 8, 0, 0);

describe("validateCron", () => {
  it("合法表达式返回 null", () => {
    expect(validateCron("* * * * *")).toBeNull();
    expect(validateCron("0 9 * * 1")).toBeNull();
    expect(validateCron("*/5 8-18 1,15 * *")).toBeNull();
    expect(validateCron("30 22 * * 7")).toBeNull();
  });

  it("段数不对或值越界/语法错返回中文错误", () => {
    expect(validateCron("* * * *")).toMatch(/5 段/);
    expect(validateCron("60 * * * *")).toMatch(/分段/);
    expect(validateCron("* 24 * * *")).toMatch(/时段/);
    expect(validateCron("* * 0 * *")).toMatch(/日段/);
    expect(validateCron("* * * 13 *")).toMatch(/月段/);
    expect(validateCron("* * * * 8")).toMatch(/周段/);
    expect(validateCron("5/10 * * * *")).toMatch(/分段/);
    expect(validateCron("1-0 * * * *")).toMatch(/分段/);
    expect(validateCron("abc * * * *")).toMatch(/分段/);
    expect(validateCron(" 30 9 * * * ")).toBeNull();
  });
});

describe("cronMatches", () => {
  it("全 * 每分钟命中", () => {
    expect(cronMatches("* * * * *", MONDAY)).toBe(true);
    expect(cronMatches("* * * * *", SUNDAY)).toBe(true);
  });

  it("分/时精确匹配", () => {
    expect(cronMatches("30 9 * * *", MONDAY)).toBe(true);
    expect(cronMatches("31 9 * * *", MONDAY)).toBe(false);
    expect(cronMatches("30 10 * * *", MONDAY)).toBe(false);
  });

  it("步长与列表、区间", () => {
    expect(cronMatches("*/15 * * * *", at(2026, 11, 3, 9, 45))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 11, 3, 9, 44))).toBe(false);
    expect(cronMatches("0,30 9 * * *", at(2026, 11, 3, 9, 30))).toBe(true);
    expect(cronMatches("0 9-18 * * *", at(2026, 11, 3, 18, 0))).toBe(true);
    expect(cronMatches("0 9-18 * * *", at(2026, 11, 3, 19, 0))).toBe(false);
  });

  it("周段 0 与 7 都是周日；区间可跨 7", () => {
    expect(cronMatches("0 0 * * 0", SUNDAY)).toBe(true);
    expect(cronMatches("0 0 * * 7", SUNDAY)).toBe(true);
    expect(cronMatches("0 0 * * 5-7", at(2026, 11, 6, 0, 0))).toBe(true); // 周五
    expect(cronMatches("0 0 * * 5-7", SUNDAY)).toBe(true); // 周日（7 端点）
    expect(cronMatches("0 0 * * 5-7", at(2026, 11, 5, 0, 0))).toBe(false); // 周四
  });

  it("全字段 AND 语义（日、周同时限制时须同时命中）", () => {
    const tuesdayNine = at(2026, 11, 3, 9, 0); // 2026-11-03 是周二（dow=2）
    expect(cronMatches("0 9 3 * 2", tuesdayNine)).toBe(true);
    expect(cronMatches("0 9 4 * 2", tuesdayNine)).toBe(false);
    expect(cronMatches("0 9 3 * 1", tuesdayNine)).toBe(false);
  });

  it("非法表达式返回 false 不抛错", () => {
    expect(cronMatches("bad cron", MONDAY)).toBe(false);
    expect(cronMatches("60 * * * *", MONDAY)).toBe(false);
    expect(cronMatches("* * * *", MONDAY)).toBe(false);
  });
});

describe("describeCron", () => {
  it("常见表达式给出中文描述", () => {
    expect(describeCron("* * * * *")).toBe("每分钟");
    expect(describeCron("*/5 * * * *")).toBe("每 5 分钟");
    expect(describeCron("30 9 * * *")).toBe("每天 09:30");
    expect(describeCron("0 9 * * 1")).toBe("每周一 09:00");
    expect(describeCron("0 0 * * 7")).toBe("每周日 00:00");
    expect(describeCron("15 8 1 * *")).toBe("每月1日 08:15");
  });

  it("识别不了的组合返回原表达式", () => {
    expect(describeCron("0 9-18 * * *")).toBe("0 9-18 * * *");
    expect(describeCron("bad")).toBe("bad");
  });
});
