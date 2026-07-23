import { EmptyAiResponseError, callChatCompletion, parseAiRequestConfig, streamChatCompletion } from "./ai.js";
import { healCsvRow, invalidGeneratedCaseRows, normalizeGeneratedRows, normalizeGeneratedRowsLenient, renumberCaseRows, rowsToCases } from "./csv.js";
import { resolveGenerationMaxTokens } from "./model-capabilities.js";
import {
  buildGenerateMessages,
  buildRepairMessages,
  type CoverageBatchSpec,
} from "./prompts.js";
import { splitSwaggerContext } from "./swagger-split.js";
import type { TestCaseStore } from "./store.js";
import type { AiRequestConfig, CsvRuntime, GenerateJobRecord, JsonObject } from "./types.js";
import { nowIso, rowsInput, text } from "./utils.js";
import { logger } from "../../logger.js";

function isApiRequest(data: JsonObject): boolean {
  return text(data.test_type ?? data.testType).toLowerCase() === "api";
}

async function repairGeneratedCsv(
  data: JsonObject,
  rawCsv: string,
  maxTokens = resolveGenerationMaxTokens(parseAiRequestConfig(data)),
): Promise<{ header: string[]; rows: string[][]; csv: string } | null> {
  if (!rawCsv.trim()) return null;
  try {
    const config = parseAiRequestConfig(data);
    const { runtime, messages } = buildRepairMessages({
      rawCsv,
      testType: text(data.test_type ?? data.testType, "functional"),
      language: text(data.language, "zh"),
    });
    const csv = await callChatCompletion(config, { messages, temperature: 0.1, maxTokens });
    const normalized = normalizeGeneratedRows(csv, runtime.header, { api: isApiRequest(data) });
    return { ...normalized, csv };
  } catch {
    return null;
  }
}

function stableCsvPrefix(csv: string): string {
  let inQuotes = false;
  let lastCompleteIndex = -1;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      lastCompleteIndex = index + 1;
    }
  }
  return lastCompleteIndex >= 0 ? csv.slice(0, lastCompleteIndex) : "";
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function rowsToCsvText(header: string[], rows: string[][]): string {
  return [header, ...rows]
    .map((row) => row.map((cell) => csvEscape(text(cell))).join(","))
    .join("\n");
}

function rowIdentity(row: string[]): string {
  return row
    .slice(1, 4)
    .map((cell) => text(cell).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""))
    .join("|");
}

function mergeUniqueRows(baseRows: string[][], incomingRows: string[][], api: boolean): string[][] {
  const seen = new Set(baseRows.map(rowIdentity));
  const merged = [...baseRows];
  for (const row of incomingRows) {
    const identity = rowIdentity(row);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(healCsvRow(row));
  }
  return renumberCaseRows(merged, api);
}

function requirementLines(context: string): string[] {
  return context.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function primaryCoverageBatch(featureName: string, context: string): CoverageBatchSpec {
  const lines = requirementLines(context);
  return {
    name: featureName,
    scope: context,
    coverageItems: lines.length > 0 ? lines : [context].filter(Boolean),
  };
}

function caseSummary(rows: string[][]): string {
  return rows
    .slice(0, 500)
    .map((row, index) => `${index + 1}. [${text(row[1])}] ${text(row[2])} - ${text(row[3])}`)
    .join("\n")
    .slice(0, 40_000);
}

function minimumUsefulCaseCount(context: string): number {
  const lines = requirementLines(context).length;
  const length = context.trim().length;
  if (lines >= 8 || length >= 700) return 60;
  if (lines >= 4 || length >= 320) return 30;
  if (lines >= 2 || length >= 160) return 12;
  return 1;
}

function needsSupplementalBatch(data: JsonObject, context: string, rows: string[][]): boolean {
  const mode = text(data.mode);
  if (mode === "regenerate_selected" || mode === "supplement") return false;
  return rows.length > 0 && rows.length < minimumUsefulCaseCount(context);
}

function supplementalCoverageBatch(featureName: string, context: string, rows: string[][]): CoverageBatchSpec {
  return {
    name: `${featureName} 补充覆盖`,
    scope: `${context}

已生成用例摘要：
${caseSummary(rows)}

请只补充明显遗漏的高价值用例，避免重复上述模块、测试点和标题。`,
    coverageItems: [
      "补充未覆盖的等价类、边界值、判定表条件组合、异常流程、状态迁移、权限、安全、并发和数据一致性场景。",
      "只输出新增用例，不要重复已有用例，不要为了凑数量制造低价值重复。",
    ],
  };
}

function supplementGapBatch(
  featureName: string,
  originalContext: string,
  supplementText: string,
  existingRows: string[][],
): CoverageBatchSpec {
  const items = requirementLines(supplementText);
  return {
    name: `${featureName} 增量补充`,
    scope: `【完整需求（业务约束基准）】
${originalContext}

【本次补充重点】
${supplementText}

【已有用例摘要（禁止重复）】
${caseSummary(existingRows)}

只生成上述摘要未覆盖的缺失用例，避免重复已有的功能模块、测试点和用例标题；优先覆盖【本次补充重点】中的内容。`,
    coverageItems: items.length > 0
      ? items
      : ["补充完整需求中未覆盖的等价类、边界值、异常流程、权限、状态迁移等高价值场景。"],
  };
}

type GenerateMessages = ReturnType<typeof buildGenerateMessages>["messages"];

async function streamCsvBatch(
  config: AiRequestConfig,
  runtime: CsvRuntime,
  messages: GenerateMessages,
  maxTokens: number,
  api: boolean,
  onPartial: (rows: string[][]) => void,
): Promise<{ header: string[]; rows: string[][]; csv: string; invalidRows: string[][] }> {
  let csv = "";
  let lastSignature = "";
  try {
    for await (const chunk of streamChatCompletion(config, { messages, temperature: 0.7, maxTokens })) {
      csv += chunk;
      const stableCsv = stableCsvPrefix(csv);
      if (!stableCsv) continue;
      const partial = normalizeGeneratedRows(stableCsv, runtime.header, { api });
      const lastRow = partial.rows.at(-1)?.join("|") ?? "";
      const signature = `${partial.rows.length}::${lastRow}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        onPartial(partial.rows);
      }
    }
  } catch (error) {
    if (!(error instanceof EmptyAiResponseError)) throw error;
    csv = await callChatCompletion(config, { messages, temperature: 0.7, maxTokens });
  }

  const normalized = normalizeGeneratedRows(csv, runtime.header, { api });
  if (normalized.rows.length > 0) {
    onPartial(normalized.rows);
  }
  return { ...normalized, csv, invalidRows: invalidGeneratedCaseRows(csv) };
}

type CsvBatchResult = { header: string[]; rows: string[][]; csv: string; invalidRows: string[][] };

// 统一的用例质量修复策略：严格解析无有效行时先做一次 AI 修复；salvage 开启时修复仍失败再宽松兜底，尽量避免整批 0 条。
async function repairOrSalvageCsv(
  data: JsonObject,
  result: CsvBatchResult,
  runtime: CsvRuntime,
  maxTokens: number,
  api: boolean,
  { salvage = true }: { salvage?: boolean } = {},
): Promise<CsvBatchResult> {
  if (result.rows.length > 0 || !result.csv.trim()) return result;
  const repaired = await repairGeneratedCsv(data, result.csv, maxTokens);
  if (repaired?.rows.length) return { ...repaired, invalidRows: [] };
  if (!salvage) return result;
  const salvaged = normalizeGeneratedRowsLenient(repaired?.csv || result.csv, runtime.header, { api });
  if (salvaged.rows.length > 0) {
    return { ...salvaged, csv: rowsToCsvText(runtime.header, salvaged.rows), invalidRows: [] };
  }
  return result;
}

export function mergeJobRows(job: GenerateJobRecord, generatedRows: string[][]): string[][] {
  const oldRows = rowsInput(job.request.rows).map((row) => healCsvRow(Array.isArray(row) ? row.map((cell) => text(cell)) : []));
  if (job.mode === "supplement") return mergeUniqueRows(oldRows, generatedRows, isApiRequest(job.request));
  if (job.mode === "regenerate_selected") {
    const nextRows = [...oldRows];
    generatedRows.forEach((row, index) => {
      const target = job.selectedIndices[index];
      if (target !== undefined) nextRows[target] = row;
    });
    return renumberCaseRows(nextRows, isApiRequest(job.request));
  }
  return renumberCaseRows(generatedRows, isApiRequest(job.request));
}

export async function streamGenerateCsvText(
  data: JsonObject,
  onProgress: (snapshot: { csv: string; header: string[]; rows: string[][] }) => void,
): Promise<{ header: string[]; rows: string[][]; csv: string }> {
  const config = parseAiRequestConfig(data);
  const testType = text(data.test_type ?? data.testType, "functional");
  const language = text(data.language, "zh");
  const featureName = text(data.feature_name ?? data.featureName, "未命名需求");
  const context = text(data.context);
  const supplementMode = text(data.mode) === "supplement";
  // 超限 Swagger 文档自动按接口分组：分组后每批只携带需求描述 + 本组接口定义，避免整份文档挤爆上下文。
  const swaggerSplit = supplementMode ? null : splitSwaggerContext(context);
  const effectiveContext = swaggerSplit ? swaggerSplit.requirement : context;
  const { runtime } = buildGenerateMessages({
    featureName,
    context: effectiveContext,
    testType,
    language,
    image: typeof data.image === "string" ? data.image : undefined,
  });
  const api = isApiRequest(data);
  const maxTokens = resolveGenerationMaxTokens(config);
  const batches = supplementMode
    ? [supplementGapBatch(
        featureName,
        text(data.originalContext ?? data.original_context),
        context,
        rowsInput(data.rows).map((row) => healCsvRow(Array.isArray(row) ? row.map((cell) => text(cell)) : [])),
      )]
    : swaggerSplit
      ? swaggerSplit.groups.map((group) => ({
          name: `${featureName} ${group.name}`,
          scope: `【Swagger/OpenAPI ${group.name}】
${group.document}

只生成上述分组内接口的用例，不要生成其他接口的用例。`,
          coverageItems: group.endpoints,
        }))
      : [primaryCoverageBatch(featureName, effectiveContext)];
  const batchSnapshots: string[][][] = Array.from({ length: batches.length }, () => []);
  const invalidRowsByBatch: string[][][] = Array.from({ length: batches.length }, () => []);
  const rawCsvByBatch: string[] = Array.from({ length: batches.length }, () => "");

  const mergedSnapshot = () => batchSnapshots.reduce(
    (rows, batchRows) => mergeUniqueRows(rows, batchRows, api),
    [] as string[][],
  );

  const emitProgress = () => {
    const rows = mergedSnapshot();
    if (rows.length === 0) return;
    onProgress({
      csv: rowsToCsvText(runtime.header, rows),
      header: runtime.header,
      rows,
    });
  };

  const generateBatch = async (batch: CoverageBatchSpec, batchIndex: number) => {
    const { messages } = buildGenerateMessages({
      featureName,
      context: effectiveContext,
      testType,
      language,
      image: typeof data.image === "string" ? data.image : undefined,
      batch,
    });
    let batchResult = await streamCsvBatch(config, runtime, messages, maxTokens, api, (partialRows) => {
      batchSnapshots[batchIndex] = partialRows;
      emitProgress();
    });
    batchResult = await repairOrSalvageCsv(data, batchResult, runtime, maxTokens, api);
    batchSnapshots[batchIndex] = batchResult.rows;
    invalidRowsByBatch[batchIndex] = batchResult.invalidRows;
    rawCsvByBatch[batchIndex] = batchResult.rows.length > 0 ? rowsToCsvText(runtime.header, batchResult.rows) : batchResult.csv;
    emitProgress();
  };

  await Promise.all(batches.map((batch, index) => generateBatch(batch, index)));
  const invalidRows = invalidRowsByBatch.flat();
  if (invalidRows.length > 0) {
    const repaired = await repairOrSalvageCsv(
      data,
      { header: runtime.header, rows: [], csv: rowsToCsvText(runtime.header, invalidRows), invalidRows: [] },
      runtime,
      maxTokens,
      api,
      { salvage: false },
    );
    if (repaired.rows.length > 0) {
      batchSnapshots.push(repaired.rows);
      emitProgress();
    }
  }
  let mergedRows = mergedSnapshot();

  if (needsSupplementalBatch(data, effectiveContext, mergedRows)) {
    const batchIndex = batchSnapshots.length;
    batchSnapshots.push([]);
    await generateBatch(supplementalCoverageBatch(featureName, effectiveContext, mergedRows), batchIndex);
    mergedRows = mergedSnapshot();
  }

  const csv = mergedRows.length > 0
    ? rowsToCsvText(runtime.header, mergedRows)
    : rawCsvByBatch.filter((item) => item.trim()).join("\n");
  return { header: runtime.header, rows: mergedRows, csv };
}

export async function runGenerationJob(jobId: string, store: TestCaseStore): Promise<void> {
  const job = store.getJob(jobId);
  if (!job) return;
  store.updateJob(jobId, { status: "running", startedAt: nowIso(), streamText: "" });
  if (job.mode === "supplement" && !text(job.request.originalContext)) {
    const originalContext = store.getTestSet(job.testSetId)?.context ?? "";
    job.request = { ...job.request, originalContext };
    store.updateJob(jobId, { request: job.request });
  }
  const initialTestSet = store.getTestSet(job.testSetId);
  if (initialTestSet) store.upsertTestSet({ ...initialTestSet, status: "running", error: "" });
  try {
    const result = await streamGenerateCsvText(job.request, (snapshot) => {
      const liveRows = mergeJobRows(job, snapshot.rows);
      store.updateJob(jobId, {
        streamText: snapshot.csv,
        generatedCount: liveRows.length,
        resultHeader: snapshot.header,
        resultRows: liveRows,
      });
      const liveTestSet = store.getTestSet(job.testSetId);
      if (liveTestSet) {
        store.upsertTestSet({
          ...liveTestSet,
          status: "running",
          header: snapshot.header,
          rows: liveRows,
          error: "",
        });
      }
    });

    if (result.rows.length === 0) {
      throw new Error("AI 未返回可解析的测试用例，任务已标记为失败，请重试。");
    }

    const nextRows = mergeJobRows(job, result.rows);
    const supplementStats = job.mode === "supplement"
      ? (() => {
          const oldRowCount = rowsInput(job.request.rows).length;
          const addedCount = Math.max(0, nextRows.length - oldRowCount);
          return {
            generatedCountRaw: result.rows.length,
            addedCount,
            duplicatesFiltered: Math.max(0, result.rows.length - addedCount),
          };
        })()
      : {};

    const completedTestSet = store.getTestSet(job.testSetId);
    if (completedTestSet) {
      store.upsertTestSet({
        ...completedTestSet,
        status: "completed",
        header: result.header,
        rows: nextRows,
        error: "",
      });
      store.replaceTestSetCases(job.testSetId, rowsToCases(job.testSetId, nextRows));
    }
    // 终态最后落盘：一次写入带上用例集最终状态；持久化失败会抛 storeError，
    // 由下方 catch 把任务标记为失败，避免“数据没落盘却显示完成”。
    store.updateJob(jobId, {
      status: "completed",
      generatedCount: nextRows.length,
      resultHeader: result.header,
      resultRows: nextRows,
      streamText: result.csv,
      finishedAt: nowIso(),
      error: "",
      ...supplementStats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 终态落盘本身也可能失败（如磁盘写错误）：仍要保证内存中的任务状态被标记为 failed，让轮询方能感知。
    try {
      const failedTestSet = store.getTestSet(job.testSetId);
      if (failedTestSet) store.upsertTestSet({ ...failedTestSet, status: "failed", error: message });
      store.updateJob(jobId, { status: "failed", error: message, finishedAt: nowIso() });
    } catch (persistError) {
      logger.warn({ jobId, error: persistError instanceof Error ? persistError.message : String(persistError) }, "任务终态写入本地存储失败，已保留内存状态");
    }
  }
}
