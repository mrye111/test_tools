import { describe, expect, it } from "vitest";
import {
  DEFAULT_TESTCASE_SYSTEM_PROMPT,
  buildGenerateMessages,
  buildRepairMessages,
} from "../src/features/testcase/prompts.js";

function systemText(messages: ReturnType<typeof buildGenerateMessages>["messages"]): string {
  return String(messages[0]?.content ?? "");
}

describe("测试用例默认系统提示词", () => {
  it("包含六种设计方法、五步工作流和质量标准", () => {
    for (const method of ["等价类划分", "边界值分析", "判定表驱动", "场景法", "错误猜测法", "状态迁移法"]) {
      expect(DEFAULT_TESTCASE_SYSTEM_PROMPT).toContain(method);
    }

    expect(DEFAULT_TESTCASE_SYSTEM_PROMPT).toContain("内部 5 步工作流");
    expect(DEFAULT_TESTCASE_SYSTEM_PROMPT).toContain("独立性");
    expect(DEFAULT_TESTCASE_SYSTEM_PROMPT).toContain("可重复性");
    expect(DEFAULT_TESTCASE_SYSTEM_PROMPT).toContain("可验证性");
    expect(DEFAULT_TESTCASE_SYSTEM_PROMPT).toContain("步骤与结果对应");
  });

  it("功能用例生成使用固定八列且不包含已移除参数", () => {
    const result = buildGenerateMessages({
      featureName: "昵称设置",
      context: "昵称长度为 1 到 20 个字符",
      testType: "functional",
      language: "zh",
    });
    const system = systemText(result.messages);
    const user = String(result.messages[1]?.content ?? "");

    expect(system).toContain("用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果");
    expect(system).toContain("Every row must have exactly 8 columns");
    expect(system).toContain("一一对应");
    expect(user).toContain("Feature Name: 昵称设置");
    expect(user).toContain("昵称长度为 1 到 20 个字符");
    expect(`${system}\n${user}`).not.toMatch(/覆盖模式|最大条数|Coverage Mode|Maximum Test Cases/i);
    expect(system).not.toMatch(/9\s*列|edit_file|testcase目录/i);
  });

  it("API 用例提示词保留接口断言要求", () => {
    const { messages } = buildGenerateMessages({
      featureName: "用户登录接口",
      context: "POST /api/login",
      testType: "api",
      language: "zh",
    });
    const system = systemText(messages);

    expect(system).toContain("请求方法、URL、请求头、请求参数和发送动作");
    expect(system).toContain("HTTP 状态码");
    expect(system).toContain("用例编号,接口名称,请求方式及路径,用例标题,优先级,前置条件,测试步骤,预期结果");
  });

  it("CSV 修复提示词不再截断用例数量", () => {
    const { messages } = buildRepairMessages({ rawCsv: "raw", testType: "functional", language: "zh" });
    const system = String(messages[0]?.content ?? "");

    expect(system).not.toMatch(/最多输出|最大条数/);
    expect(system).toContain("严格 8 列");
    expect(system).toContain("对应的编号列表");
  });
});
