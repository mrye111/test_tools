/** 「优化用例」域逻辑：优化批次 prompt 与优化结果的执行状态指纹合并。 */

import { healCsvRow } from "./csv.js";
import type { CoverageBatchSpec } from "./prompts.js";
import type { TestCaseExecutionItem } from "./types.js";

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function rowsToPromptText(header: string[], rows: string[][]): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(String(cell ?? ""))).join(","));
  }
  return lines.join("\n");
}

function requirementLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•\d.、]+\s*/, ""))
    .filter((line) => line.length > 0);
}

/**
 * 优化批次：用户指令 + 现有全集 → 完整新用例集。
 * 与补充需求（supplementGapBatch）的核心区别：可修改/删除已有行，输出整体替换集合而非纯增量。
 */
export function optimizeGapBatch(
  featureName: string,
  originalContext: string,
  instruction: string,
  existingRows: string[][],
): CoverageBatchSpec {
  const items = requirementLines(instruction);
  return {
    name: `${featureName} 优化改写`,
    scope: `【原始需求（业务约束基准）】
${originalContext}

【本次优化指令（最高优先级，描述界面实际操作逻辑）】
${instruction}

【现有用例集（完整 8 列）】
${rowsToPromptText(["用例编号", "功能模块", "功能测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"], existingRows)}

【改写契约】
1. 基于优化指令对现有用例集做整体改写，输出【完整新用例集】（不是差异或仅变更行）。
2. 未修改的用例：保持用例编号与全部内容完全一致（系统按编号+内容识别未改用例并保留其执行记录）。
3. 需要修改的用例：保持原编号，更新内容以符合界面实际操作逻辑。
4. 新增用例：沿用现有编号前缀与顺序分配新编号。
5. 与界面实际操作逻辑不符、确实不成立的用例：直接不输出（视为删除）。
6. 保持既有 8 列结构、优先级语义（高/中/低）与语言一致。
7. 测试步骤与预期结果编号一一对应，预期结果必须可客观观测，不得使用“操作成功”“显示正常”等模糊断言。`,
    coverageItems:
      items.length > 0
        ? items
        : ["依据优化指令修正与界面实际操作逻辑不符的用例，并补齐缺失的高价值场景。"],
  };
}

export interface OptimizeReconcileResult {
  stats: { modified: number; added: number; removed: number };
  executionStatus: Record<string, TestCaseExecutionItem>;
}

function fingerprint(row: string[]): string {
  return healCsvRow(Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []).join("");
}

/**
 * 优化后执行状态重建（领域规则：通过率必须反映当前内容的真实验证状态）：
 * - caseId 一致且全文未动 → 保留执行记录（含缺陷 ID 与备注）；
 * - caseId 还在但内容变化 → 重置为未执行（内容已变，旧结论失效，需复测）；
 * - 被删除的用例 → 执行记录连同缺陷 ID 一并清除；
 * - 新增用例 → 无记录。
 */
export function reconcileOptimizedRows(
  oldRows: string[][],
  newRows: string[][],
  executionStatus: Record<string, TestCaseExecutionItem> = {},
): OptimizeReconcileResult {
  const oldByCaseId = new Map<string, string>();
  for (const row of oldRows) {
    const caseId = String(row[0] ?? "").trim();
    if (caseId) oldByCaseId.set(caseId, fingerprint(row));
  }

  const stats = { modified: 0, added: 0, removed: 0 };
  const keptStatus: Record<string, TestCaseExecutionItem> = {};
  const newCaseIds = new Set<string>();

  for (const row of newRows) {
    const caseId = String(row[0] ?? "").trim();
    if (!caseId) continue;
    newCaseIds.add(caseId);
    const oldFingerprint = oldByCaseId.get(caseId);
    if (oldFingerprint === undefined) {
      stats.added += 1;
      continue;
    }
    if (oldFingerprint === fingerprint(row)) {
      const item = executionStatus[caseId];
      if (item) keptStatus[caseId] = item;
    } else {
      stats.modified += 1;
    }
  }

  for (const caseId of oldByCaseId.keys()) {
    if (!newCaseIds.has(caseId)) stats.removed += 1;
  }

  return { stats, executionStatus: keptStatus };
}
