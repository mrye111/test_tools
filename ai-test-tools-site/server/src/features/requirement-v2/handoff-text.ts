/** 需求分析 → 用例生成的接力文本。前端 handoff.ts 保持同形状（前端无法 import server 代码）。 */

import type { AnalysisRecord, ConditionKind, TestCondition } from "./types.js";

export const CONDITION_KIND_LABEL: Record<ConditionKind, string> = {
  normal: "正常",
  boundary: "边界",
  exception: "异常",
};

/** 需求原文摘要上限：超长文档只取头部，避免挤爆生成上下文。 */
export const SOURCE_TEXT_SUMMARY_LIMIT = 2000;

/** 渲染接力文本：需求原文摘要 + 逐条测试条件（需逐条覆盖）。 */
export function buildConditionsHandoffText(
  record: Pick<AnalysisRecord, "title" | "sourceText">,
  conditions: Array<Pick<TestCondition, "kind" | "text">>,
): string {
  return [
    `【需求分析接力】${record.title}`,
    "",
    "需求原文摘要：",
    record.sourceText.slice(0, SOURCE_TEXT_SUMMARY_LIMIT),
    "",
    "测试条件（需逐条覆盖）：",
    ...conditions.map((c) => `- [${CONDITION_KIND_LABEL[c.kind]}] ${c.text}`),
  ].join("\n");
}
