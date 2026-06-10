import type { CsvRuntime } from "./types.js";

const FUNCTIONAL_EXPERT_PROMPT = `你是资深测试专家，擅长根据需求生成完整、可执行、覆盖正反向和边界场景的功能测试用例。

必须输出 CSV，不要输出 Markdown，不要输出解释。
每行必须严格 8 列：用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果。
测试步骤和预期结果必须详细、可执行，并使用 1. 2. 3. 编号。
优先级只能使用：高、中、低。`;

const API_EXPERT_PROMPT = `你是资深接口测试专家，擅长根据接口需求生成覆盖正常、异常、鉴权、参数校验、边界和幂等场景的 API 测试用例。

必须输出 CSV，不要输出 Markdown，不要输出解释。
每行必须严格 8 列：用例编号,接口名称,请求方式及路径,用例标题,优先级,前置条件,测试步骤,预期结果。
测试步骤需要包含请求方法、URL、请求头、请求参数和发送请求动作。
预期结果需要包含 HTTP 状态码、响应字段、错误码或业务结果断言。
优先级只能使用：高、中、低。`;

export function csvRuntime(testType = "functional", language = "zh"): CsvRuntime {
  if (language === "en") {
    if (testType === "api") {
      return {
        header: ["Case ID", "API Name", "Request Method & Path", "Case Title", "Priority", "Preconditions", "Test Steps", "Expected Results"],
        csvColumns: "Case ID,API Name,Request Method & Path,Case Title,Priority,Preconditions,Test Steps,Expected Results",
        exampleRow: 'API-TC001,User Login,POST /api/v1/login,Valid Login - Correct Credentials,High,User is registered,"1. Request Method: POST\\n2. Request URL: /api/v1/login\\n3. Request Body: {\\"username\\": \\"test\\"}","1. HTTP Status: 200\\n2. Response code: 0"',
        languageInstruction: "Generate all test case content in English.",
      };
    }
    return {
      header: ["Case ID", "Module", "Test Point", "Case Title", "Priority", "Preconditions", "Test Steps", "Expected Results"],
      csvColumns: "Case ID,Module,Test Point,Case Title,Priority,Preconditions,Test Steps,Expected Results",
      exampleRow: 'TC001,Login,Username Password Validation,Login with valid credentials,High,User is registered,"1. Open login page\\n2. Enter valid username\\n3. Click login button","1. Login page displayed\\n2. Username accepted\\n3. System validates and redirects to homepage"',
      languageInstruction: "Generate all test case content in English.",
    };
  }

  if (testType === "api") {
    return {
      header: ["用例编号", "接口名称", "请求方式及路径", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"],
      csvColumns: "用例编号,接口名称,请求方式及路径,用例标题,优先级,前置条件,测试步骤,预期结果",
      exampleRow: 'API-TC001,用户登录,POST /api/v1/login,正常登录-有效用户名密码,高,用户已注册,"1. 请求方式: POST\\n2. 请求URL: /api/v1/login\\n3. 请求参数: {\\"username\\": \\"test\\"}","1. HTTP状态码: 200\\n2. 响应code: 0"',
      languageInstruction: "Generate all test case content in Chinese (中文).",
    };
  }

  return {
    header: ["用例编号", "功能模块", "功能测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"],
    csvColumns: "用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
    exampleRow: 'TC001,登录,用户名密码验证,输入正确的用户名和密码登录,高,用户已注册,"1. 打开登录页面\\n2. 输入有效用户名\\n3. 点击登录按钮","1. 登录页面正常显示\\n2. 用户名输入成功\\n3. 系统验证成功并跳转到首页"',
    languageInstruction: "Generate all test case content in Chinese (中文).",
  };
}

export function buildGenerateMessages(args: {
  featureName?: string;
  context?: string;
  testType?: string;
  language?: string;
  maxCases?: number;
  coverageMode?: string;
  analysis?: string;
  image?: string;
}) {
  const testType = args.testType || "functional";
  const runtime = csvRuntime(testType, args.language || "zh");
  const basePrompt = testType === "api" ? API_EXPERT_PROMPT : FUNCTIONAL_EXPERT_PROMPT;
  const coverageMode = (["quick", "standard", "expert"].includes(args.coverageMode || "") ? args.coverageMode : "standard") as "quick" | "standard" | "expert";
  const maxCases = args.maxCases && args.maxCases > 0 ? Math.floor(args.maxCases) : 20;
  const coverageInstruction = {
    quick: "快速覆盖：覆盖核心主流程、关键失败场景和基础边界，避免低价值重复用例。",
    standard: "标准覆盖：覆盖正向、反向、边界、权限、状态、数据校验和异常提示，优先保证场景完整性。",
    expert: "专家覆盖：在标准覆盖基础上增加组合场景、风险场景、历史缺陷高发点、安全、兼容性和幂等性等高价值场景。",
  }[coverageMode];

  const system = `${basePrompt}

[CRITICAL SYSTEM OVERRIDE - CSV FORMAT REQUIREMENTS]
1. DO NOT use tools.
2. DO NOT output markdown or code blocks.
3. DO NOT write explanation text.
4. OUTPUT ONLY raw CSV data starting with the header row.
5. CSV must strictly follow these 8 columns in exact order:
${runtime.csvColumns}
6. Standard CSV example:
${runtime.csvColumns}
${runtime.exampleRow}
7. If a field contains comma, newline, or quotes, wrap the entire field in double quotes.
8. Use \\n characters inside fields, not real newlines, for step lists.
9. Every row must have exactly 8 columns.
10. Every test case must include detailed steps and expected results.
11. Priority must be one of 高, 中, 低 / High, Medium, Low.
12. Language requirement: ${runtime.languageInstruction}
13. Coverage mode: ${coverageInstruction}
14. Generate no more than ${maxCases} test cases. This is a hard upper limit, not a target to fill.
15. Prefer high-value coverage over quantity. Do not create weak or duplicate cases just to approach the upper limit.`;

  const userText = `Generate test cases for:
Feature Name: ${args.featureName || "未命名需求"}
Requirements/Context: ${args.context || ""}
Coverage Mode: ${coverageMode}
Maximum Test Cases: ${maxCases}
${args.analysis ? `\nInternal Test Design Notes:\n${args.analysis}\n` : ""}

Output the CSV content now.`;

  if (args.image) {
    return {
      runtime,
      messages: [
        { role: "system" as const, content: system },
        {
          role: "user" as const,
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: args.image.startsWith("data:") ? args.image : `data:image/jpeg;base64,${args.image}` } },
          ],
        },
      ],
    };
  }

  return {
    runtime,
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: userText },
    ],
  };
}

export function buildAnalysisMessages(args: {
  featureName?: string;
  context?: string;
  testType?: string;
  language?: string;
  coverageMode?: string;
  maxCases?: number;
}) {
  const testType = args.testType || "functional";
  const coverageMode = args.coverageMode || "standard";
  const maxCases = args.maxCases && args.maxCases > 0 ? Math.floor(args.maxCases) : 20;
  const system = `你是资深测试架构师。请在生成测试用例前，内部分析需求并给出测试设计草案。

只输出简洁 JSON，不要 Markdown，不要解释。JSON 字段：
{
  "businessRules": ["业务规则"],
  "inputs": ["输入或参数"],
  "states": ["状态或流程节点"],
  "roles": ["角色或权限"],
  "risks": ["高风险点"],
  "coverageDimensions": ["需要覆盖的测试维度"],
  "priorityGuidance": ["当最大条数不足时的取舍建议"]
}`;

  const user = `功能名称：${args.featureName || "未命名需求"}
测试类型：${testType}
覆盖模式：${coverageMode}
最大条数上限：${maxCases}
输出语言：${args.language || "zh"}
需求描述：
${args.context || ""}`;

  return {
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ],
  };
}

export function buildRepairMessages(args: {
  rawCsv: string;
  testType?: string;
  language?: string;
  maxCases?: number;
}) {
  const runtime = csvRuntime(args.testType || "functional", args.language || "zh");
  const maxCases = args.maxCases && args.maxCases > 0 ? Math.floor(args.maxCases) : 20;
  return {
    runtime,
    messages: [
      {
        role: "system" as const,
        content: `你是测试用例 CSV 修复器。把输入内容修复成严格 CSV。

要求：
1. 只输出 CSV，不要 Markdown，不要解释。
2. 表头必须是：${runtime.csvColumns}
3. 最多输出 ${maxCases} 条用例。
4. 丢弃非用例内容、解释文本、重复标题、空步骤、空预期。
5. 每条用例必须 8 列，步骤至少 2 步，预期结果明确。
6. 用例编号可以临时填写，后端会统一重排。`,
      },
      {
        role: "user" as const,
        content: `需要修复的原始内容：\n${args.rawCsv}`,
      },
    ],
  };
}

export function buildSupplementMessages(args: {
  analysis: string;
  existingRowsCsv: string;
  featureName?: string;
  context?: string;
  testType?: string;
  language?: string;
  remaining: number;
}) {
  const runtime = csvRuntime(args.testType || "functional", args.language || "zh");
  return {
    runtime,
    messages: [
      {
        role: "system" as const,
        content: `你是资深测试专家。请检查已有用例相对测试设计草案是否漏掉高价值场景。

要求：
1. 只输出需要补充的 CSV 行，包含表头。
2. 如果没有高价值缺口，只输出表头，不要解释。
3. 最多补充 ${Math.max(0, args.remaining)} 条。
4. 不要重复已有用例标题或等价场景。
5. 表头必须是：${runtime.csvColumns}
6. 每条用例必须 8 列，步骤至少 2 步，预期结果明确。`,
      },
      {
        role: "user" as const,
        content: `功能名称：${args.featureName || "未命名需求"}
需求描述：
${args.context || ""}

内部测试设计草案：
${args.analysis}

已有用例：
${args.existingRowsCsv}

请补充缺失的高价值用例。`,
      },
    ],
  };
}
