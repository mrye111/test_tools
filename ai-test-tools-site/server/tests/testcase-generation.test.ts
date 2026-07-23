import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeJobRows, streamGenerateCsvText } from "../src/features/testcase/generation.js";
import type { GenerateJobRecord } from "../src/features/testcase/types.js";

const validCsv = [
  "用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
  'TC001,登录,正常登录,正确账密登录,高,用户已注册,"1. 打开登录页\\n2. 输入正确账密","1. 登录页正常显示\\n2. 登录成功"',
].join("\n");

function csvCase(title: string, module = "工作台") {
  return csvCases([title], module);
}

function csvCases(titles: string[], module = "工作台") {
  return [
    "用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
    ...titles.map((title, index) => `TC${String(index + 1).padStart(3, "0")},${module},覆盖点,${title},高,用户已登录,"1. 进入工作台\\n2. 执行操作","1. 页面显示成功\\n2. 结果与需求一致"`),
  ].join("\n");
}

function jsonResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(content: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function generationData() {
  return {
    projectId: "proj_test",
    featureName: "登录",
    context: "用户使用账号密码登录",
    testType: "functional",
    language: "zh",
    baseUrl: "https://api.kimi.com/coding/v1",
    apiKey: "test-key",
    model: "kimi-k2.7-code",
    apiFormat: "openai_chat",
  };
}

describe("Swagger 超限自动分组", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("超限 Swagger 文档按接口分组并行生成，各批只携带本组接口", async () => {
    const paths: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) {
      paths[`/api/v1/resource-${index}`] = {
        get: { summary: `查询资源 ${index}`, description: "描".repeat(2_200), responses: { 200: { description: "OK" } } },
      };
    }
    const swagger = JSON.stringify({ openapi: "3.0.0", info: { title: "资源服务" }, paths });
    const context = `资源服务接口需求\n\n【Swagger/OpenAPI 文档】\n${swagger}`;
    expect(context.length).toBeGreaterThan(80_000);

    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementation(async () => sseResponse(csvCase("查询资源返回列表")));

    const result = await streamGenerateCsvText({ ...generationData(), context }, () => undefined);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String((call[1] as RequestInit | undefined)?.body));
      expect(JSON.stringify(body.messages)).toContain("接口分组");
    }
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]?.[0]).toBe("TC001");
  });
});

describe("测试用例生成空响应兜底", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("流式响应只有推理内容时自动非流式重试", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"reasoning_content":"正在分析"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'
          + "data: [DONE]\n\n",
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: validCsv } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const result = await streamGenerateCsvText(generationData(), () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const streamBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    const fallbackBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body));
    expect(streamBody.max_tokens).toBe(32_768);
    expect(fallbackBody.max_tokens).toBe(32_768);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.[3]).toBe("正确账密登录");
  });

  it("流式和非流式都没有正文时向上抛错", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"reasoning_content":"正在分析"}}]}\n\n'
          + "data: [DONE]\n\n",
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "", reasoning_content: "仍然只有推理" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    await expect(streamGenerateCsvText(generationData(), () => undefined))
      .rejects.toThrow(/未返回.*正文/);
  });

  it("复杂需求结果充足时单轮生成完成", async () => {
    const complexData = {
      ...generationData(),
      featureName: "工作台",
      context: [
        "问候区：按时段问候、当日日期和待关注数量。",
        "工作概览：展示调研、问卷、发送任务和回收数据。",
        "待办列表：按紧急程度排序并支持跳转。",
      ].join("\n"),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse(csvCases(Array.from({ length: 30 }, (_, index) => `工作台覆盖用例 ${index + 1}`))));

    const result = await streamGenerateCsvText(complexData, () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(30);
    expect(result.rows.at(0)?.[0]).toBe("TC001");
    expect(result.rows.at(-1)?.[0]).toBe("TC030");
    const batchBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(batchBody.max_tokens).toBe(32_768);
    expect(JSON.stringify(batchBody.messages)).toContain("问候区");
  });

  it("复杂需求结果明显偏少时仅补充一次", async () => {
    const complexData = {
      ...generationData(),
      featureName: "工作台",
      context: [
        "问候区：按时段问候、当日日期和待关注数量。",
        "工作概览：展示调研、问卷、发送任务和回收数据。",
        "待办列表：按紧急程度排序并支持跳转。",
      ].join("\n"),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse(csvCase("上午时段显示正确问候语")))
      .mockResolvedValueOnce(sseResponse(csvCase("待办按紧急程度排序")));

    const result = await streamGenerateCsvText(complexData, () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.rows.map((row) => row[3])).toEqual([
      "上午时段显示正确问候语",
      "待办按紧急程度排序",
    ]);
    expect(result.rows.map((row) => row[0])).toEqual(["TC001", "TC002"]);
    const supplementBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body));
    expect(JSON.stringify(supplementBody.messages)).toContain("补充覆盖");
    expect(JSON.stringify(supplementBody.messages)).toContain("只输出新增用例");
  });

  it("步骤和预期编号数不一致时修复后再合并", async () => {
    const invalidCsv = [
      "用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
      'TC001,登录,正常登录,正确账密登录,高,用户已注册,"1.打开页面\\n2.输入账密\\n3.点击登录","1.页面显示\\n2.登录成功"',
    ].join("\n");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse(invalidCsv))
      .mockResolvedValueOnce(jsonResponse(validCsv));

    const result = await streamGenerateCsvText(generationData(), () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.[3]).toBe("正确账密登录");
  });

  it("严格解析和修复都失败时使用宽松兜底避免 0 条", async () => {
    const weakCsv = [
      "用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
      'TC001,通讯录,成员搜索,按姓名搜索成员,普通,已登录且通讯录存在成员,"1. 输入姓名关键字并搜索","1. 列表展示匹配成员"',
    ].join("\n");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse(weakCsv))
      .mockResolvedValueOnce(jsonResponse(weakCsv));

    const result = await streamGenerateCsvText({
      ...generationData(),
      featureName: "通讯录",
      context: "通讯录支持成员搜索、组织架构浏览、成员详情查看和权限边界校验。",
    }, () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.[3]).toBe("按姓名搜索成员");
    expect(result.rows[0]?.[4]).toBe("中");
  });
});

describe("补充需求（supplement）增量生成", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prompt 包含原始完整需求、本次补充重点标注和已有用例摘要", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse(csvCase("密码连续错误 5 次锁定账号", "登录")));

    const result = await streamGenerateCsvText({
      ...generationData(),
      mode: "supplement",
      originalContext: "用户使用账号密码登录系统，支持记住密码。",
      context: "补充密码错误锁定相关用例",
      rows: [["TC001", "登录", "正常登录", "正确账密登录成功", "高", "用户已注册", "1. 输入账密", "1. 登录成功"]],
    }, () => undefined);

    expect(result.rows.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    const promptText = (body.messages as Array<{ content?: string }>).map((message) => message.content ?? "").join("\n");
    expect(promptText).toContain("用户使用账号密码登录系统，支持记住密码。");
    expect(promptText).toContain("【本次补充重点】");
    expect(promptText).toContain("补充密码错误锁定相关用例");
    expect(promptText).toContain("【已有用例摘要（禁止重复）】");
    expect(promptText).toContain("[登录] 正常登录 - 正确账密登录成功");
  });

  it("合并时过滤与已有用例模块+测试点+标题相同的行，编号保持连续", () => {
    const job = {
      id: "job_supplement",
      projectId: "proj_1",
      testSetId: "set_1",
      mode: "supplement",
      status: "running",
      request: {
        testType: "functional",
        rows: [
          ["TC001", "登录", "正常登录", "正确账密登录成功", "高", "用户已注册", "步骤", "预期"],
          ["TC002", "登录", "异常登录", "密码错误提示", "高", "用户已注册", "步骤", "预期"],
        ],
      },
      generatedCount: 0,
      error: "",
      resultHeader: [],
      resultRows: [],
      selectedIndices: [],
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    } satisfies GenerateJobRecord;

    const merged = mergeJobRows(job, [
      ["", "登录", "异常登录", "密码错误提示", "高", "用户已注册", "步骤", "预期"],
      ["", "登录", "安全锁定", "连续错误锁定账号", "中", "用户已注册", "步骤", "预期"],
    ]);

    expect(merged).toHaveLength(3);
    expect(merged.map((row) => row[0])).toEqual(["TC001", "TC002", "TC003"]);
    expect(merged[2]?.[3]).toBe("连续错误锁定账号");
  });
});
