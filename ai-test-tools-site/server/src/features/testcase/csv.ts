import type { TestCaseRecord } from "./types.js";
import { text } from "./utils.js";

export function parseCsv(textValue: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index];
    const next = textValue[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((item) => item.trim())) rows.push(healCsvRow(row));
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell.trim());
  if (row.some((item) => item.trim())) rows.push(healCsvRow(row));
  return rows;
}

export function healCsvRow(row: string[]): string[] {
  const cells = row.map((item) => item.replace(/^```csv|```$/g, "").trim());
  if (cells.length === 8) return cells;
  if (cells.length < 8) return [...cells, ...Array.from({ length: 8 - cells.length }, () => "")];
  return [...cells.slice(0, 7), cells.slice(7).join(",")];
}

export function isGeneratedCaseRow(row: string[]): boolean {
  const caseId = text(row[0]).trim();
  return /^((api[-_\s]?)?tc[-_\s]?\d+|case[-_\s]?\d+|用例[-_\s]?\d+)/i.test(caseId);
}

function normalizedPriority(priority: string): string {
  const value = priority.trim().toLowerCase();
  if (["高", "high", "p0", "p1"].includes(value)) return priority;
  if (["中", "medium", "mid", "p2"].includes(value)) return priority;
  if (["低", "low", "p3", "p4"].includes(value)) return priority;
  return "";
}

function stepCount(steps: string): number {
  const normalized = steps.replace(/\\n/g, "\n");
  const numbered = normalized.match(/(^|\n)\s*\d+[.、)]\s+/g);
  if (numbered && numbered.length > 0) return numbered.length;
  return normalized.split(/\n|；|;|\u3002/).filter((item) => item.trim()).length;
}

export function isValidGeneratedCaseRow(row: string[]): boolean {
  const healed = healCsvRow(row);
  if (!isGeneratedCaseRow(healed)) return false;
  if (!text(healed[3]).trim()) return false;
  if (!normalizedPriority(text(healed[4]))) return false;
  if (stepCount(text(healed[6])) < 2) return false;
  if (!text(healed[7]).trim()) return false;
  return true;
}

export function renumberCaseRows(rows: string[][], api = false): string[][] {
  const prefix = api ? "API-TC" : "TC";
  return rows.map((row, index) => {
    const next = healCsvRow(row);
    next[0] = `${prefix}${String(index + 1).padStart(3, "0")}`;
    return next;
  });
}

function looksLikeHeader(row: string[], expectedHeader: string[]): boolean {
  const normalized = row.map((item) => item.trim().toLowerCase());
  const expectedMatches = normalized.filter((item, index) => item && item === text(expectedHeader[index]).trim().toLowerCase()).length;
  if (expectedMatches >= 2) return true;

  const joined = normalized.join("|");
  const headerKeywords = ["用例编号", "case id", "功能模块", "module", "用例标题", "case title", "测试步骤", "test steps", "预期结果", "expected"];
  return headerKeywords.filter((keyword) => joined.includes(keyword)).length >= 3;
}

export function normalizeGeneratedRows(csvText: string, expectedHeader: string[], options: { maxRows?: number; api?: boolean } = {}): { header: string[]; rows: string[][] } {
  const parsed = parseCsv(csvText.replace(/```csv|```/g, "").trim());
  if (!parsed.length) return { header: expectedHeader, rows: [] };
  const headerIndex = parsed.findIndex((row) => looksLikeHeader(row, expectedHeader));
  const maxRows = options.maxRows && options.maxRows > 0 ? Math.floor(options.maxRows) : Number.POSITIVE_INFINITY;
  const rows = (headerIndex >= 0 ? parsed.slice(headerIndex + 1) : parsed)
    .map(healCsvRow)
    .filter(isValidGeneratedCaseRow)
    .slice(0, maxRows);
  return { header: expectedHeader, rows: renumberCaseRows(rows, options.api) };
}

export function rowsToCases(testSetId: string, rows: unknown[]): TestCaseRecord[] {
  return rows.map((item, index) => {
    const cells = Array.isArray(item)
      ? item.map((cell) => text(cell))
      : typeof item === "object" && item !== null
        ? objectRowToCells(item as Record<string, unknown>)
        : [];
    const row = healCsvRow(cells);
    return {
      id: `${testSetId}_case_${index + 1}`,
      testSetId,
      caseId: row[0] ?? "",
      module: row[1] ?? "",
      testPoint: row[2] ?? "",
      title: row[3] ?? "",
      priority: row[4] ?? "",
      precondition: row[5] ?? "",
      steps: row[6] ?? "",
      expectedResult: row[7] ?? "",
      row,
    };
  });
}

function objectRowToCells(row: Record<string, unknown>): string[] {
  return [
    text(row.caseId ?? row.id),
    text(row.module ?? row.apiName),
    text(row.testPoint ?? row.requestPath),
    text(row.title ?? row.caseTitle),
    text(row.priority),
    text(row.precondition ?? row.preconditions),
    text(row.steps ?? row.testSteps),
    text(row.expected ?? row.expectedResult ?? row.expectedResults),
  ];
}

export function nextAvailableCaseId(rows: string[][], api = false): string {
  const prefix = api ? "API-TC" : "TC";
  const used = new Set(rows.map((row) => row[0]));
  for (let index = 1; index < 100000; index += 1) {
    const id = `${prefix}${String(index).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}
