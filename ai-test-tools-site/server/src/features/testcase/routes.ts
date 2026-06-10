import type { Express, Request, Response } from "express";
import { callChatCompletion, parseAiRequestConfig, streamChatCompletion, testAiConnection } from "./ai.js";
import { healCsvRow, normalizeGeneratedRows, renumberCaseRows, rowsToCases } from "./csv.js";
import { buildExcelWorkbook, buildXmindWorkbook, type ExcelExportOptions } from "./exporters.js";
import { buildAnalysisMessages, buildGenerateMessages, buildRepairMessages, buildSupplementMessages } from "./prompts.js";
import { TestCaseStore } from "./store.js";
import type { GenerateJobRecord, JsonObject, TestSetRecord } from "./types.js";
import { boolValue, isObject, makeId, nowIso, numberList, parseMaybeJsonObject, safeDownloadName, text } from "./utils.js";

const store = new TestCaseStore();

function ok(res: Response, data: JsonObject = {}): void {
  res.json({ success: true, ...data });
}

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ success: false, error: message });
}

function body(req: Request): JsonObject {
  return isObject(req.body) ? req.body : {};
}

function requireString(value: unknown): string {
  return text(value).trim();
}

function rowsInput(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 0 && !Array.isArray(value[0]) && !isObject(value[0])) return [value];
  return value;
}

function excelExportOptions(data: JsonObject): ExcelExportOptions {
  return {
    format: text(data.format ?? data.platform, "default"),
    projectName: text(data.projectName),
    productName: text(data.productName ?? data.product),
    issueType: text(data.issueType, "Test"),
    component: text(data.component),
    labels: text(data.labels),
  };
}

function projectIdFrom(req: Request, data = body(req)): string {
  return requireString(req.query.project_id ?? data.projectId ?? data.project_id);
}

function jobResultSnapshot(job: GenerateJobRecord): JsonObject {
  return {
    status: job.status,
    header: job.resultHeader ?? [],
    rows: job.resultRows ?? [],
    updatedAt: job.updatedAt,
  };
}

function jobResponse(job: GenerateJobRecord): JsonObject {
  return {
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    testSetId: job.testSetId,
    projectId: job.projectId,
    featureName: text(job.request.featureName ?? job.request.feature_name, "未命名需求"),
    context: text(job.request.context),
    testType: text(job.request.testType ?? job.request.test_type, "functional"),
    language: text(job.request.language, "zh"),
    coverageMode: coverageModeFrom(job.request),
    maxCases: maxCasesFrom(job.request),
    generatedCount: job.generatedCount,
    error: job.error,
    streamText: job.streamText ?? "",
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    testSetSnapshot: jobResultSnapshot(job),
    resultHeader: job.resultHeader,
    resultRows: job.resultRows,
  };
}

function coverageModeFrom(data: JsonObject): string {
  const mode = text(data.coverageMode ?? data.coverage_mode, "standard");
  return ["quick", "standard", "expert"].includes(mode) ? mode : "standard";
}

function maxCasesFrom(data: JsonObject): number {
  const raw = Number(data.maxCases ?? data.max_cases ?? data.count);
  if (!Number.isFinite(raw) || raw <= 0) {
    const mode = coverageModeFrom(data);
    if (mode === "quick") return 8;
    if (mode === "expert") return 40;
    return 20;
  }
  return Math.max(1, Math.min(100, Math.floor(raw)));
}

function isApiRequest(data: JsonObject): boolean {
  return text(data.test_type ?? data.testType).toLowerCase() === "api";
}

function generationRequest(data: JsonObject, analysis = "") {
  const config = parseAiRequestConfig(data);
  const testType = text(data.test_type ?? data.testType, "functional");
  const language = text(data.language, "zh");
  const { runtime, messages } = buildGenerateMessages({
    featureName: text(data.feature_name ?? data.featureName, "未命名需求"),
    context: text(data.context),
    testType,
    language,
    coverageMode: coverageModeFrom(data),
    maxCases: maxCasesFrom(data),
    analysis,
    image: typeof data.image === "string" ? data.image : undefined,
  });
  return { config, runtime, messages };
}

async function runInternalAnalysis(data: JsonObject): Promise<string> {
  const mode = coverageModeFrom(data);
  if (mode === "quick") return "";
  try {
    const config = parseAiRequestConfig(data);
    const { messages } = buildAnalysisMessages({
      featureName: text(data.feature_name ?? data.featureName, "未命名需求"),
      context: text(data.context),
      testType: text(data.test_type ?? data.testType, "functional"),
      language: text(data.language, "zh"),
      coverageMode: mode,
      maxCases: maxCasesFrom(data),
    });
    return await callChatCompletion(config, { messages, temperature: 0.1, maxTokens: 1800, responseJson: true });
  } catch {
    return "";
  }
}

async function repairGeneratedCsv(data: JsonObject, rawCsv: string): Promise<{ header: string[]; rows: string[][]; csv: string } | null> {
  if (!rawCsv.trim()) return null;
  try {
    const config = parseAiRequestConfig(data);
    const { runtime, messages } = buildRepairMessages({
      rawCsv,
      testType: text(data.test_type ?? data.testType, "functional"),
      language: text(data.language, "zh"),
      maxCases: maxCasesFrom(data),
    });
    const csv = await callChatCompletion(config, { messages, temperature: 0.1, maxTokens: 6000 });
    const normalized = normalizeGeneratedRows(csv, runtime.header, { maxRows: maxCasesFrom(data), api: isApiRequest(data) });
    return { ...normalized, csv };
  } catch {
    return null;
  }
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function rowsToCsvText(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map((cell) => csvEscape(text(cell))).join(",")).join("\n");
}

function appendUniqueRows(baseRows: string[][], extraRows: string[][], maxRows: number, api: boolean): string[][] {
  const seen = new Set(baseRows.map((row) => text(row[3]).trim().toLowerCase()).filter(Boolean));
  const nextRows = [...baseRows];
  for (const row of extraRows) {
    const title = text(row[3]).trim().toLowerCase();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    nextRows.push(row);
    if (nextRows.length >= maxRows) break;
  }
  return renumberCaseRows(nextRows.slice(0, maxRows), api);
}

async function supplementExpertRows(data: JsonObject, analysis: string, header: string[], rows: string[][]): Promise<string[][]> {
  const maxRows = maxCasesFrom(data);
  const remaining = maxRows - rows.length;
  if (coverageModeFrom(data) !== "expert" || remaining <= 0 || !analysis.trim()) return rows;
  try {
    const config = parseAiRequestConfig(data);
    const { runtime, messages } = buildSupplementMessages({
      analysis,
      existingRowsCsv: rowsToCsvText(header, rows),
      featureName: text(data.feature_name ?? data.featureName, "未命名需求"),
      context: text(data.context),
      testType: text(data.test_type ?? data.testType, "functional"),
      language: text(data.language, "zh"),
      remaining,
    });
    const csv = await callChatCompletion(config, { messages, temperature: 0.2, maxTokens: 5000 });
    const normalized = normalizeGeneratedRows(csv, runtime.header, { maxRows: remaining, api: isApiRequest(data) });
    return appendUniqueRows(rows, normalized.rows, maxRows, isApiRequest(data));
  } catch {
    return rows;
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

function mergeJobRows(job: GenerateJobRecord, generatedRows: string[][]): string[][] {
  const oldRows = rowsInput(job.request.rows).map((row) => healCsvRow(Array.isArray(row) ? row.map((cell) => text(cell)) : []));
  if (job.mode === "supplement") return renumberCaseRows([...oldRows, ...generatedRows], isApiRequest(job.request));
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

async function streamGenerateCsvText(
  data: JsonObject,
  onProgress: (snapshot: { csv: string; header: string[]; rows: string[][] }) => void,
): Promise<{ header: string[]; rows: string[][]; csv: string; analysis: string }> {
  const analysis = await runInternalAnalysis(data);
  const { config, runtime, messages } = generationRequest(data, analysis);
  let csv = "";
  let lastSignature = "";

  for await (const chunk of streamChatCompletion(config, { messages, temperature: 0.7, maxTokens: 6000 })) {
    csv += chunk;
    const stableCsv = stableCsvPrefix(csv);
    if (!stableCsv) {
      continue;
    }

    const partial = normalizeGeneratedRows(stableCsv, runtime.header, { maxRows: maxCasesFrom(data), api: isApiRequest(data) });
    const lastRow = partial.rows.at(-1)?.join("|") ?? "";
    const signature = `${partial.header.join("|")}::${partial.rows.length}::${lastRow}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      onProgress({ csv, header: partial.header, rows: partial.rows });
    }
  }

  const normalized = normalizeGeneratedRows(csv, runtime.header, { maxRows: maxCasesFrom(data), api: isApiRequest(data) });
  return { ...normalized, csv, analysis };
}

async function runGenerationJob(jobId: string): Promise<void> {
  const job = store.getJob(jobId);
  if (!job) return;
  store.updateJob(jobId, { status: "running", startedAt: nowIso(), streamText: "" });
  try {
    let result = await streamGenerateCsvText(job.request, (snapshot) => {
      const liveRows = mergeJobRows(job, snapshot.rows);
      store.updateJob(jobId, {
        streamText: snapshot.csv,
        generatedCount: liveRows.length,
        resultHeader: snapshot.header,
        resultRows: liveRows,
      });
    });
    if (result.rows.length === 0 && result.csv.trim()) {
      const repaired = await repairGeneratedCsv(job.request, result.csv);
      if (repaired && repaired.rows.length > 0) result = { ...repaired, analysis: result.analysis };
    }

    const supplementedRows = await supplementExpertRows(job.request, result.analysis, result.header, result.rows);
    const nextRows = mergeJobRows(job, supplementedRows);

    store.updateJob(jobId, {
      status: "completed",
      generatedCount: nextRows.length,
      resultHeader: result.header,
      resultRows: nextRows,
      streamText: result.csv,
      finishedAt: nowIso(),
      error: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateJob(jobId, { status: "failed", error: message, finishedAt: nowIso() });
  }
}

export function registerTestCaseRoutes(app: Express): void {
  app.get("/api/projects", (_req, res) => {
    ok(res, { data: store.listProjects() });
  });

  app.post("/api/projects", (req, res) => {
    const data = body(req);
    const project = {
      id: text(data.id, `proj_${Date.now()}`),
      name: text(data.name, "未命名项目").trim(),
      description: text(data.description),
      createdAt: text(data.createdAt, nowIso()),
      ownerId: null,
    };
    ok(res, { data: store.upsertProject(project) });
  });

  app.put("/api/projects/:projectId", (req, res) => {
    const existing = store.listProjects().find((item) => item.id === req.params.projectId);
    if (!existing) return fail(res, "项目不存在", 404);
    const data = body(req);
    store.upsertProject({ ...existing, name: text(data.name, existing.name).trim(), description: text(data.description, existing.description ?? "") });
    ok(res);
  });

  app.delete("/api/projects/:projectId", (req, res) => {
    store.deleteProject(req.params.projectId);
    ok(res);
  });

  app.get("/api/test-sets", (req, res) => {
    const projectId = projectIdFrom(req);
    if (!projectId) return fail(res, "project_id is required");
    ok(res, { data: store.listTestSets(projectId) });
  });

  app.post("/api/test-sets", (req, res) => {
    const data = body(req);
    const projectId = projectIdFrom(req, data);
    if (!projectId) return fail(res, "projectId is required");
    const now = nowIso();
    const testSet: TestSetRecord = {
      id: text(data.id, String(Date.now())),
      projectId,
      name: text(data.name, "未命名测试集"),
      featureName: text(data.featureName ?? data.name, "未命名测试集"),
      testType: text(data.testType, "functional"),
      language: text(data.language, "zh"),
      context: text(data.context),
      status: text(data.status, "completed"),
      requirement: text(data.requirement),
      header: Array.isArray(data.header) ? data.header.map((item) => text(item)) : [],
      rows: rowsInput(data.rows).map((row) => healCsvRow(Array.isArray(row) ? row.map((cell) => text(cell)) : [])),
      createdAt: text(data.createdAt, now),
      updatedAt: now,
      ownerId: null,
    };
    store.upsertTestSet(testSet);
    if (testSet.rows.length) store.replaceTestSetCases(testSet.id, rowsToCases(testSet.id, testSet.rows));
    ok(res, { data: { id: testSet.id } });
  });

  app.delete("/api/test-sets/:testSetId", (req, res) => {
    const projectId = projectIdFrom(req);
    if (!projectId) return fail(res, "project_id is required");
    const testSet = store.getTestSet(req.params.testSetId);
    if (testSet && testSet.projectId !== projectId) return fail(res, "测试集不属于该项目", 403);
    store.deleteTestSet(req.params.testSetId);
    ok(res);
  });

  app.post("/api/test-cases", (req, res) => {
    const data = body(req);
    const testSetId = requireString(data.testSetId);
    if (!requireString(data.id) || !testSetId) return fail(res, "id and testSetId are required");
    store.upsertTestCase({
      id: text(data.id),
      testSetId,
      caseId: text(data.caseId ?? data.id),
      module: text(data.module),
      testPoint: text(data.testPoint),
      title: text(data.title),
      priority: text(data.priority),
      precondition: text(data.precondition ?? data.preconditions),
      steps: text(data.steps),
      expectedResult: text(data.expectedResult ?? data.expected),
      row: healCsvRow(Array.isArray(data.row) ? data.row.map((cell) => text(cell)) : []),
      ...data,
    });
    ok(res);
  });

  app.delete("/api/test-cases/:caseId", (req, res) => {
    store.deleteTestCase(req.params.caseId);
    ok(res);
  });

  app.get("/api/test-cases/:caseId", (req, res) => {
    if (!projectIdFrom(req)) return fail(res, "project_id is required");
    const testCase = store.getTestCase(req.params.caseId);
    if (!testCase) return fail(res, "测试用例不存在", 404);
    ok(res, { data: testCase });
  });

  app.post("/api/test-sets/:testSetId/test-cases", (req, res) => {
    const data = body(req);
    if (!projectIdFrom(req, data)) return fail(res, "projectId is required");
    const rows = rowsInput(data.rows);
    const cases = rowsToCases(req.params.testSetId, rows);
    if (boolValue(data.replace, true)) store.replaceTestSetCases(req.params.testSetId, cases);
    else cases.forEach((item) => store.upsertTestCase(item));
    ok(res, { count: cases.length });
  });

  app.get("/api/bootstrap-data", (_req, res) => {
    ok(res, {
      data: {
        projects: store.listProjects(),
        currentUser: null,
        permissions: [],
        permissionBindings: {},
        featureDefs: [],
      },
    });
  });

  app.post("/api/test-connection", async (req, res) => {
    try {
      await testAiConnection(parseAiRequestConfig(body(req)));
      ok(res, { message: "API 连接成功" });
    } catch (error) {
      fail(res, error instanceof Error ? error.message : String(error), 500);
    }
  });

  app.post("/api/generate", async (req, res) => {
    try {
      const data = body(req);
      const config = parseAiRequestConfig(data);
      const testType = text(data.test_type ?? data.testType, "functional");
      const language = text(data.language, "zh");
      const { messages } = buildGenerateMessages({
        featureName: text(data.feature_name ?? data.featureName, "未命名需求"),
        context: text(data.context),
        testType,
        language,
        coverageMode: coverageModeFrom(data),
        maxCases: maxCasesFrom(data),
        image: typeof data.image === "string" ? data.image : undefined,
      });
      res.status(200);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      let lineBuffer = "";
      for await (const chunk of streamChatCompletion(config, { messages, temperature: 0.7, maxTokens: 6000 })) {
        lineBuffer += chunk;
        while (lineBuffer.includes("\n")) {
          const index = lineBuffer.indexOf("\n");
          res.write(lineBuffer.slice(0, index + 1));
          lineBuffer = lineBuffer.slice(index + 1);
        }
      }
      if (lineBuffer) res.write(lineBuffer);
      res.end();
    } catch (error) {
      res.status(400).type("text/plain; charset=utf-8").send(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  app.post("/api/generate-jobs", (req, res) => {
    const data = body(req);
    const id = makeId("job");
    const projectId = projectIdFrom(req, data) || "tool-project";
    const testSetId = text(data.testSetId ?? data.test_set_id, `tool-result-${id}`);
    const mode = text(data.mode, "create") as GenerateJobRecord["mode"];
    if (!["create", "regenerate_all", "supplement", "regenerate_selected"].includes(mode)) return fail(res, "mode 参数无效");
    if (!text(data.context).trim()) return fail(res, "context 不能为空");
    const existing = text(data.testSetId ?? data.test_set_id) ? store.findActiveJob(testSetId) : undefined;
    if (existing) return ok(res, { data: { jobId: existing.id, status: existing.status, testSetId, mode: existing.mode } });
    const selectedIndices = numberList(data.selectedIndices);
    if (mode === "regenerate_selected" && selectedIndices.length === 0) return fail(res, "selectedIndices 不能为空");
    const now = nowIso();
    const job: GenerateJobRecord = {
      id,
      projectId,
      testSetId,
      mode,
      status: "queued",
      request: data,
      generatedCount: 0,
      error: "",
      streamText: "",
      resultHeader: [],
      resultRows: [],
      selectedIndices,
      createdAt: now,
      updatedAt: now,
    };
    store.createJob(job);
    void runGenerationJob(id);
    ok(res, { data: { jobId: id, status: "queued", testSetId, mode } });
  });

  app.get("/api/generate-jobs/active", (req, res) => {
    const projectId = typeof req.query.project_id === "string" ? req.query.project_id : undefined;
    const testSetId = typeof req.query.test_set_id === "string" ? req.query.test_set_id : undefined;
    ok(res, {
      data: store.listActiveJobs(projectId, testSetId).map(jobResponse),
    });
  });

  app.get("/api/generate-jobs/:jobId", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return fail(res, "任务不存在", 404);
    ok(res, { data: jobResponse(job) });
  });

  app.post("/api/ocr", async (req, res) => {
    try {
      const data = body(req);
      const images = Array.isArray(data.images) ? data.images : data.image ? [data.image] : [];
      if (!images.length) return fail(res, "No image data provided");
      const config = parseAiRequestConfig(data);
      const describe = text(data.mode, "extract") === "describe";
      const prompt = describe
        ? `请详细描述图片中的内容。${text(data.userDescription) ? `用户补充说明：${text(data.userDescription)}` : ""}`
        : `请分析图片中的需求文档，提取所有功能需求，严格返回 JSON：{"features":[{"name":"功能名称","description":"详细需求描述"}]}。${text(data.userDescription)}`;
      const content = await callChatCompletion(config, {
        messages: [
          { role: "system", content: "你是专业需求分析师，擅长识别图片中的软件需求。" },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...images.map((img) => ({ type: "image_url", image_url: { url: text(img).startsWith("data:") ? text(img) : `data:image/jpeg;base64,${text(img)}` } })),
            ],
          },
        ],
        temperature: 0.1,
        maxTokens: 4096,
        responseJson: !describe,
      });
      if (describe) return ok(res, { text: content });
      const parsed = parseMaybeJsonObject(content);
      const features = parsed && Array.isArray(parsed.features) ? parsed.features : [{ name: "需求提取", description: content }];
      ok(res, { features, rawText: content });
    } catch (error) {
      fail(res, error instanceof Error ? error.message : String(error), 500);
    }
  });

  app.get("/api/export/formats", (_req, res) => {
    ok(res, {
      data: [
        {
          key: "default",
          name: "默认测试用例格式",
          description: "当前系统 8 列格式：用例编号、模块、测试点、标题、优先级、前置条件、步骤、预期结果。",
        },
        {
          key: "jira",
          name: "Jira 导入格式",
          description: "面向 Jira CSV/Excel 导入的常见字段：Summary、Issue Type、Description、Priority、Labels、Component/s、Test Steps、Expected Result。",
        },
        {
          key: "zentao",
          name: "禅道导入格式",
          description: "面向禅道测试用例导入的常见字段：所属产品、所属模块、用例标题、前置条件、步骤、预期、优先级、用例类型、适用阶段、关键词。",
        },
      ],
    });
  });

  app.post("/api/export/excel", (req, res) => {
    const data = body(req);
    const featureName = text(data.featureName, "测试用例");
    const rows = rowsInput(data.rows) as never[];
    const workbook = buildExcelWorkbook([{ name: "测试用例", rows }], excelExportOptions(data));
    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeDownloadName(featureName)}.xls`);
    res.send(workbook);
  });

  app.post("/api/export/excel-all", (req, res) => {
    const data = body(req);
    const projectName = text(data.projectName, "测试用例");
    const testSets = Array.isArray(data.testSets) ? data.testSets.filter(isObject) : [];
    const workbook = buildExcelWorkbook(
      testSets.map((set) => ({ name: text(set.featureName, "测试用例"), rows: rowsInput(set.rows) as never[] })),
      excelExportOptions(data),
    );
    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeDownloadName(projectName)}.xls`);
    res.send(workbook);
  });

  app.post("/api/export/xmind", (req, res) => {
    const data = body(req);
    const title = text(data.featureName ?? data.title, "测试用例库");
    const collections = Array.isArray(data.collections)
      ? data.collections.filter(isObject).map((item) => ({ name: text(item.name), rows: rowsInput(item.rows) as never[] }))
      : [{ rows: rowsInput(data.rows) as never[] }];
    const workbook = buildXmindWorkbook(title, collections);
    res.setHeader("Content-Type", "application/vnd.xmind.workbook");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeDownloadName(title)}.xmind`);
    res.send(workbook);
  });

  app.post("/api/export/xmind-all", (req, res) => {
    const data = body(req);
    const projectName = text(data.projectName, "测试用例库");
    const testSets = Array.isArray(data.testSets) ? data.testSets.filter(isObject) : [];
    const workbook = buildXmindWorkbook(projectName, testSets.map((set) => ({ name: text(set.featureName, "测试用例"), rows: rowsInput(set.rows) as never[] })));
    res.setHeader("Content-Type", "application/vnd.xmind.workbook");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeDownloadName(projectName)}.xmind`);
    res.send(workbook);
  });

}
