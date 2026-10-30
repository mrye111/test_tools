import { describe, expect, it } from "vitest";
import { parseSetCases } from "./functional-case-rows.js";

const FUNCTIONAL_HEADER = ["用例编号", "功能模块", "功能测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"];

describe("parseSetCases", () => {
  it("按标准功能用例表头解析出五字段", () => {
    const rows = parseSetCases({
      header: FUNCTIONAL_HEADER,
      rows: [["TC-001", "登录", "正确账密", "正常登录", "P0", "已注册账号", "1. 输入账号\n2. 点击登录", "1. 进入首页"]],
    });
    expect(rows).toEqual([
      {
        caseId: "TC-001",
        title: "正常登录",
        precondition: "已注册账号",
        steps: "1. 输入账号\n2. 点击登录",
        expectedResult: "1. 进入首页",
      },
    ]);
  });

  it("列名命中候选别名且与列序无关", () => {
    const rows = parseSetCases({
      header: ["预期结果", "测试步骤", "前置条件", "用例编号", "标题"],
      rows: [["显示错误提示", "点击登录", "未注册账号", "TC-002", "未注册登录"]],
    });
    expect(rows).toEqual([
      {
        caseId: "TC-002",
        title: "未注册登录",
        precondition: "未注册账号",
        steps: "点击登录",
        expectedResult: "显示错误提示",
      },
    ]);
  });

  it("英文表头不在中文候选内，解析不出可编译用例（既有行为，已知局限）", () => {
    // 候选匹配是 h.includes(候选) 且区分大小写，"Case ID"/"Case Title" 命不中 caseId/标题。
    // 英文功能用例集（KNOWN_HEADERS 里的 EN_FUNCTIONAL_HEADER）目前编译不出用例，界面会提示「没有可编译的功能用例」。
    const rows = parseSetCases({
      header: ["Case ID", "Module", "Test Point", "Case Title", "Priority", "Preconditions", "Test Steps", "Expected Results"],
      rows: [["TC-003", "login", "ok", "sign in", "P1", "account", "click", "land home"]],
    });
    expect(rows).toEqual([]);
  });

  it("缺编号/标题/步骤/预期的行被过滤（API 用例集不适用）", () => {
    const rows = parseSetCases({
      header: FUNCTIONAL_HEADER,
      rows: [
        ["TC-001", "登录", "点", "正常登录", "P0", "", "步骤", "预期"],
        ["", "登录", "点", "缺编号", "P0", "", "步骤", "预期"],
        ["TC-003", "登录", "点", "", "P0", "", "步骤", "预期"],
        ["TC-004", "登录", "点", "缺步骤", "P0", "", "", "预期"],
        ["TC-005", "登录", "点", "缺预期", "P0", "", "步骤", ""],
      ],
    });
    expect(rows.map((r) => r.caseId)).toEqual(["TC-001"]);
  });

  it("空表头/空行集返回空数组而不抛错", () => {
    expect(parseSetCases({})).toEqual([]);
    expect(parseSetCases({ header: [], rows: [] })).toEqual([]);
    expect(parseSetCases({ header: ["用例编号", "标题", "测试步骤", "预期结果"] })).toEqual([]);
  });

  it("列名对不上（如 API 用例集的请求方式列）时整集解析不出可编译用例", () => {
    const rows = parseSetCases({
      header: ["接口名称", "请求方式及路径", "断言响应", "断言sql"],
      rows: [["下单接口", "POST /orders", "200", "select 1"]],
    });
    expect(rows).toEqual([]);
  });
});
