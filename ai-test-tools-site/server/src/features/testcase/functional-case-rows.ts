/** 功能用例集行解析：header+rows 表格 → 可编译的五字段用例。批量预编译与需求导入编排共用。 */

export const HEADER_CANDIDATES = {
  caseId: ["用例编号", "编号", "caseId"],
  title: ["标题"],
  precondition: ["前置条件"],
  steps: ["测试步骤", "步骤"],
  expected: ["预期结果", "预期"],
} as const;

export type FunctionalCaseRow = {
  caseId: string;
  title: string;
  precondition: string;
  steps: string;
  expectedResult: string;
};

/** 用例集详情的表格形状（testcase 域对外返回的 header + rows 视图）。 */
export type FunctionalSetDetail = {
  header?: string[];
  rows?: string[][];
};

/**
 * 解析用例集行为可编译用例。列名按候选子串匹配（列序无关）；
 * 缺编号/标题/步骤/预期的行（如 API 用例集）不可编译，直接过滤。
 */
export function parseSetCases(detail: FunctionalSetDetail): FunctionalCaseRow[] {
  const header = (detail.header ?? []).map((h) => h.trim());
  const col = (cands: readonly string[]): number => header.findIndex((h) => cands.some((c) => h.includes(c)));
  const idx = {
    caseId: col(HEADER_CANDIDATES.caseId),
    title: col(HEADER_CANDIDATES.title),
    precondition: col(HEADER_CANDIDATES.precondition),
    steps: col(HEADER_CANDIDATES.steps),
    expected: col(HEADER_CANDIDATES.expected),
  };
  return (detail.rows ?? [])
    .map((row) => ({
      caseId: idx.caseId >= 0 ? String(row[idx.caseId] ?? "") : "",
      title: idx.title >= 0 ? String(row[idx.title] ?? "") : "",
      precondition: idx.precondition >= 0 ? String(row[idx.precondition] ?? "") : "",
      steps: idx.steps >= 0 ? String(row[idx.steps] ?? "") : "",
      expectedResult: idx.expected >= 0 ? String(row[idx.expected] ?? "") : "",
    }))
    .filter((c) => c.caseId && c.title && c.steps && c.expectedResult);
}
