/** 功能用例文本的确定性预处理：换行归一化 + 编号切分（调研实测两种换行形态并存，必须在编译入口归一，不靠 LLM 识别）。 */

export type NormalizedCaseText = {
  steps: string[];
  expected: string[];
};

/** 字面 "\n" 两字符序列与真实换行统一为真实换行（与 csv.ts:64 同款处理）。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\\n/g, "\n");
}

const NUMBERED_SPLIT = /(?:^|\n)\s*\d+\s*[.、)]\s*/;

/**
 * 按 "1. 2. 3." 编号切分（兼容 1. 1、 1) 三种标记）；无编号时退化为按换行/分号切分。
 * 返回去除编号后的条目，数组顺序即归一化编号 1..N（原编号可能存在 0 起始等错位，不予采信）。
 * 已知边界：行首出现"1000.00元"这类小数会被误当编号切分——与现有 stepCount 行为一致，概率低，接受。
 */
export function splitNumberedItems(text: string): string[] {
  const normalized = normalizeNewlines(text);
  if (NUMBERED_SPLIT.test(normalized)) {
    return normalized
      .split(NUMBERED_SPLIT)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return normalized
    .split(/\n|；|;/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeCaseText(steps: string, expectedResult: string): NormalizedCaseText {
  return { steps: splitNumberedItems(steps), expected: splitNumberedItems(expectedResult) };
}
