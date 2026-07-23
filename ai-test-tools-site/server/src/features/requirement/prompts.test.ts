import { describe, expect, it } from "vitest";
import { buildAnalysisMessages, REQUIREMENT_ANALYSIS_SYSTEM_PROMPT } from "./prompts.js";

describe("requirement analysis prompts", () => {
  it("系统提示词要求严格 JSON：tree + findings 结构", () => {
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("tree");
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("findings");
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("nodeId");
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("risk");
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("ambiguity");
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("clarification");
  });

  it("系统提示词使用领域术语（需求分解树 / 分析结论 / 待澄清问题）", () => {
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("需求分解树");
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("分析结论");
    expect(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT).toContain("待澄清问题");
  });

  it("buildAnalysisMessages 返回 system + user 两条消息，原文包裹在标记中", () => {
    const messages = buildAnalysisMessages("用户登录需求");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(REQUIREMENT_ANALYSIS_SYSTEM_PROMPT);
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("用户登录需求");
    expect(messages[1].content).toContain("【需求文档开始】");
    expect(messages[1].content).toContain("【需求文档结束】");
  });
});
