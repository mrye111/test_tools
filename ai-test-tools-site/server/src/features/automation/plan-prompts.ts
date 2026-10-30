/** 规划提案 prompt（P3）：捕获页摘要 + PRD → useCase 分组的测试提案 JSON。 */

import type { PlanPageInput } from "./plan-manager.js";

export const PLAN_SYSTEM_PROMPT = `你是资深测试架构师。根据被测站点的页面捕获信息与产品需求文档（PRD），产出一组可执行的测试提案。

只输出一个 JSON 对象，不要输出任何其他文字。结构：
{
  "proposals": [
    {
      "useCase": "用例组名（按业务能力分组，如「登录」「购物车」）",
      "title": "用例标题（一句话，动词开头，含具体场景）",
      "goal": "验证目标（这条用例要证明什么）",
      "expected": ["预期结果 1", "预期结果 2"],
      "priority": "high|medium|low",
      "estSteps": ["预估步骤 1", "预估步骤 2"]
    }
  ]
}

要求：
1. 每个 useCase 分组 2~6 条提案；总提案数 8~30 条，覆盖核心主流程、关键分支与重要异常场景。
2. estSteps 是预估步骤（3~10 步），用自然语言描述动作；expected 是可观察的预期结果（1~3 条），不要写「测试通过」这类空话。
3. priority：high=核心主流程/登录/支付类；medium=重要分支；low=边角与兼容性。
4. 只针对捕获页与 PRD 中出现的功能，不要臆造不存在的页面或业务。
5. 涉及登录/账号的用例，把账号输入写成步骤，不要写死真实密码。`;

export function buildPlanUserMessage(input: {
  entryUrl: string;
  prdText: string;
  extraInstructions: string;
  pages: PlanPageInput[];
}): string {
  const pagesText = input.pages
    .map((page, i) => {
      const elements = page.elementNames.slice(0, 12).join("、");
      return [
        `【页面 ${i + 1}】${page.title || page.url}`,
        `URL: ${page.url}`,
        page.aiSummary ? `摘要: ${page.aiSummary.slice(0, 300)}` : "摘要: （无）",
        elements ? `可交互元素: ${elements}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    `入口地址: ${input.entryUrl}`,
    "",
    "## 页面捕获",
    pagesText || "（无捕获页）",
    "",
    "## PRD",
    input.prdText.slice(0, 6000) || "（无 PRD）",
    input.extraInstructions ? `\n## 额外指令\n${input.extraInstructions.slice(0, 1000)}` : "",
    "",
    "请输出测试提案 JSON。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** 整体校验失败时的重试消息（compiler.ts buildRetryUserMessage 同款）。 */
export function buildPlanRetryMessage(errors: string[]): string {
  return `上一次输出未通过校验：\n${errors.map((e) => `- ${e}`).join("\n")}\n请重新输出完整 JSON（只输出 JSON 对象）。`;
}
