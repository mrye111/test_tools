import { describe, expect, it } from "vitest";
import { normalizeGeneratedRows, normalizeGeneratedRowsLenient } from "../src/features/testcase/csv.js";
import { csvRuntime } from "../src/features/testcase/prompts.js";

const header = csvRuntime("functional", "zh").header;

describe("测试用例步骤与预期结果对应", () => {
  it("丢弃步骤和预期结果编号数量不一致的用例", () => {
    const csv = [
      header.join(","),
      'TC001,登录,正常登录,正确账密登录,高,用户已注册,"1.打开页面\\n2.输入账密\\n3.点击登录","1.页面显示\\n2.登录成功"',
    ].join("\n");

    expect(normalizeGeneratedRows(csv, header).rows).toHaveLength(0);
  });

  it("保留编号数量一致且均不少于两项的用例", () => {
    const csv = [
      header.join(","),
      'TC001,登录,正常登录,正确账密登录,高,用户已注册,"1.打开页面\\n2.点击登录","1.页面显示\\n2.登录成功"',
    ].join("\n");

    expect(normalizeGeneratedRows(csv, header).rows).toHaveLength(1);
  });

  it("严格解析全丢弃时宽松兜底保留可用行", () => {
    const csv = [
      header.join(","),
      'TC001,通讯录,成员搜索,按姓名搜索成员,普通,已登录且通讯录存在成员,"1. 输入姓名关键字并搜索","1. 列表展示匹配成员"',
    ].join("\n");

    expect(normalizeGeneratedRows(csv, header).rows).toHaveLength(0);
    const rows = normalizeGeneratedRowsLenient(csv, header).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe("TC001");
    expect(rows[0]?.[4]).toBe("中");
  });
});
