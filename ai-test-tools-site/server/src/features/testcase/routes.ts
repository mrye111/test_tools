import type { Express, Request, Response } from "express";
import { callChatCompletion, fetchAvailableModels, parseAiRequestConfig, testAiConnection } from "./ai.js";
import { healCsvRow, rowsToCases } from "./csv.js";
import { buildExcelExport, buildXmindWorkbook, type ExcelExportOptions } from "./exporters.js";
import { runGenerationJob } from "./generation.js";
import { TestCaseStore } from "./store.js";
import type { GenerateJobRecord, JsonObject, TestSetRecord } from "./types.js";
import { boolValue, isObject, makeId, nowIso, numberList, parseMaybeJsonObject, rowsInput, safeDownloadName, text } from "./utils.js";

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
    generatedCount: job.generatedCount,
    generatedCountRaw: job.generatedCountRaw,
    addedCount: job.addedCount,
    duplicatesFiltered: job.duplicatesFiltered,
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

export function registerTestCaseRoutes(app: Express): void {
  app.get("/api/projects", (_req, res) => {
    ok(res, {
      data: store.listProjects().map((project) => {
        const testSets = store.listTestSets(project.id);
        return {
          ...project,
          testSetCount: testSets.length,
          testCaseCount: testSets.reduce((total, testSet) => total + testSet.rows.length, 0),
        };
      }),
    });
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
    if (!testSetId) return fail(res, "testSetId is required");
    const testSet = store.getTestSet(testSetId);
    if (!testSet) return fail(res, "测试用例集不存在", 404);
    const row = healCsvRow(Array.isArray(data.row) ? data.row.map((cell) => text(cell)) : []);
    const id = text(data.id, `${testSetId}_case_${Date.now()}`);
    store.upsertTestCase({
      id,
      testSetId,
      caseId: text(data.caseId ?? data.id ?? row[0]),
      module: text(data.module ?? row[1]),
      testPoint: text(data.testPoint ?? row[2]),
      title: text(data.title ?? row[3]),
      priority: text(data.priority ?? row[4], "中"),
      precondition: text(data.precondition ?? data.preconditions ?? row[5]),
      steps: text(data.steps ?? row[6]),
      expectedResult: text(data.expectedResult ?? data.expected ?? row[7]),
      row,
      ...data,
    });
    ok(res, { data: store.getTestSet(testSetId) ?? testSet });
  });

  app.delete("/api/test-cases/:caseId", (req, res) => {
    const requestedTestSetId = text(req.query.test_set_id ?? req.query.testSetId);
    const testSetId = store.getTestSetIdForCase(req.params.caseId, requestedTestSetId || undefined);
    if (!testSetId) return fail(res, "测试用例不存在", 404);
    store.deleteTestCase(req.params.caseId, testSetId);
    ok(res, { data: store.getTestSet(testSetId) });
  });

  app.get("/api/test-cases/:caseId", (req, res) => {
    const data = body(req);
    if (!projectIdFrom(req, data)) return fail(res, "project_id is required");
    const requestedTestSetId = text(req.query.test_set_id ?? req.query.testSetId);
    const testCase = store.getTestCase(req.params.caseId, requestedTestSetId || undefined);
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

  app.post("/api/model-config/models", async (req, res) => {
    try {
      const models = await fetchAvailableModels(parseAiRequestConfig(body(req)));
      ok(res, { data: models });
    } catch (error) {
      fail(res, error instanceof Error ? error.message : String(error), 500);
    }
  });

  app.post("/api/generate-jobs", (req, res) => {
    const data = body(req);
    const id = makeId("job");
    const projectId = projectIdFrom(req, data);
    if (!projectId || !store.projectExists(projectId)) return fail(res, "项目不存在", 404);
    const testSetId = text(data.testSetId ?? data.test_set_id, `tool-result-${id}`);
    const mode = text(data.mode, "create") as GenerateJobRecord["mode"];
    if (!["create", "regenerate_all", "supplement", "regenerate_selected"].includes(mode)) return fail(res, "mode 参数无效");
    if (!text(data.context).trim()) return fail(res, "context 不能为空");
    const existing = text(data.testSetId ?? data.test_set_id) ? store.findActiveJob(testSetId) : undefined;
    if (existing) return ok(res, { data: { jobId: existing.id, status: existing.status, testSetId, mode: existing.mode } });
    const selectedIndices = numberList(data.selectedIndices);
    if (mode === "regenerate_selected" && selectedIndices.length === 0) return fail(res, "selectedIndices 不能为空");
    const now = nowIso();
    if (mode === "create") {
      const testSetName = text(data.testSetName ?? data.featureName, "未命名用例集").trim();
      store.upsertTestSet({
        id: testSetId,
        projectId,
        name: testSetName,
        featureName: testSetName,
        testType: text(data.testType, "functional"),
        language: text(data.language, "zh"),
        context: text(data.context),
        status: "queued",
        generationJobId: id,
        error: "",
        header: [],
        rows: [],
        createdAt: now,
        updatedAt: now,
        ownerId: null,
      });
    }
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
    void runGenerationJob(id, store);
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
    const workbook = buildExcelExport([{ name: "测试用例", rows }], excelExportOptions(data));
    res.setHeader("Content-Type", workbook.contentType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeDownloadName(featureName)}.${workbook.extension}`);
    res.send(workbook.buffer);
  });

  app.post("/api/export/excel-all", (req, res) => {
    const data = body(req);
    const projectName = text(data.projectName, "测试用例");
    const testSets = Array.isArray(data.testSets) ? data.testSets.filter(isObject) : [];
    const workbook = buildExcelExport(
      testSets.map((set) => ({ name: text(set.featureName, "测试用例"), rows: rowsInput(set.rows) as never[] })),
      excelExportOptions(data),
    );
    res.setHeader("Content-Type", workbook.contentType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeDownloadName(projectName)}.${workbook.extension}`);
    res.send(workbook.buffer);
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
