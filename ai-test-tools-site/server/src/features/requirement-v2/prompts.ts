/** 需求分析 v2 AI 提示词：单阶段产出结构化三区分析（需求条目 + 问题日志 + 验收准则 + 测试条件） */

import type { JsonObject } from "../testcase/types.js";

/** 输出规模上限（与 analyze.ts 校验一致） */
export const ANALYSIS_LIMITS = {
  MAX_REQUIREMENTS: 40,
  MAX_ISSUES: 20,
  MAX_CRITERIA: 20,
  MAX_CONDITIONS: 50,
} as const;

const SYSTEM_PROMPT = `你是一名资深测试分析师（ISTQB Test Analyst）。你的任务是把需求文本转化为**可测试、可追溯**的测试依据。

## 输出契约（严格遵守）

只输出一个 JSON 对象，不要任何 Markdown 围栏或额外文字。结构：

{
  "title": "分析记录的简短标题（≤20字）",
  "requirements": [
    { "id": "r1", "parentId": null, "level": 0, "text": "需求条目文本" }
  ],
  "issues": [
    {
      "reqId": "r1 或 null",
      "type": "ambiguity | missing | conflict | untestable",
      "severity": "high | medium | low",
      "quote": "需求原文的逐字引用（必须能在原文中找到）",
      "description": "问题描述",
      "suggestedQuestion": "建议向需求方提的澄清问题"
    }
  ],
  "criteria": [
    { "reqId": "r1", "originalText": "原文表述", "rewrittenText": "可度量的验收准则（含具体阈值/可观察结果）" }
  ],
  "conditions": [
    { "reqId": "r1", "criterionId": null, "text": "待验证点", "kind": "normal | boundary | exception" }
  ]
}

## 分析要求

1. **需求条目**：把需求分解为原子条目（一条只说一件事），可用 parentId/level 表达层级。条目 id 用 r1、r2… 依次编号。
2. **问题日志**（核心价值）：找出歧义（模糊措辞）、缺失（只写正常路径、缺错误处理/异常分支）、冲突（条目间矛盾）、不可测（无客观判定标准）四类问题。quote 必须是原文逐字引用，严禁编造。没有问题的需求不要硬凑。
3. **验收准则**：对模糊但重要的条目，改写为可度量形式（如「响应快」→「P95 响应时间 < 2s」）。originalText 引用原文，rewrittenText 给出可观察、可度量的判定标准。仅对需要可测化的条目产出，不必覆盖全部条目。
4. **测试条件**：每条重要需求导出待验证点，分正常（normal）/边界（boundary）/异常（exception）三类。条件文本要具体到可执行（含具体数值/边界）。
5. **规模上限**：需求条目 ≤ ${ANALYSIS_LIMITS.MAX_REQUIREMENTS}，问题 ≤ ${ANALYSIS_LIMITS.MAX_ISSUES}，准则 ≤ ${ANALYSIS_LIMITS.MAX_CRITERIA}，条件 ≤ ${ANALYSIS_LIMITS.MAX_CONDITIONS}。超出时优先保留高严重度/高风险项。
6. 所有 reqId 引用必须指向 requirements 中存在的条目 id。`;

export const ANALYSIS_REPAIR_INSTRUCTION = `上一次输出未通过校验。请只修正指出的问题并重新输出完整 JSON，不要改变其他内容，不要输出任何 JSON 以外的文字。`;

export function buildAnalysisMessages(sourceText: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `请分析以下需求文本：\n\n${sourceText}` },
  ];
}

export type { JsonObject };
