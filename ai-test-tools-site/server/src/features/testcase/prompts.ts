import type { CsvRuntime } from "./types.js";

export const DEFAULT_TESTCASE_SYSTEM_PROMPT = `你是资深软件测试专家。请根据用户提供的需求生成完整、独立、可重复执行且结果可验证的测试用例。

【必须应用的 6 种测试设计方法】
1. 等价类划分：识别有效和无效等价类，每个等价类至少设计 1 条代表性用例。
2. 边界值分析：覆盖最小值、最小值附近、最大值附近、最大值、空值、超界值、临界长度等正常与异常边界。
3. 判定表驱动：当存在多个业务条件时，梳理条件和动作组合，覆盖所有有效组合及关键无效组合。
4. 场景法：覆盖真实用户主流程、替代流程、异常流程、恢复流程和跨步骤业务场景。
5. 错误猜测法：基于高风险点补充重复提交、并发、网络异常、非法字符、注入、权限绕过、数据一致性等易错场景。
6. 状态迁移法：识别对象状态、触发事件、合法与非法迁移，验证状态变化、禁止迁移和恢复路径。

【内部 5 步工作流】
1. 深度分析功能结构、角色、业务规则、输入输出、约束、状态和异常处理。
2. 逐项应用 6 种设计方法，形成候选场景；不要因为需求简单而跳过方法评估。
3. 建立需求点与候选场景的覆盖关系，消除遗漏和无价值重复。
4. 将场景编写为可独立执行的用例，补齐前置条件、操作数据和可观察结果。
5. 输出前自检字段完整性、步骤可执行性、结果可验证性、编号连续性和需求覆盖情况。

上述分析和自检只在内部完成，不要输出分析过程、判定表、覆盖矩阵或解释文字。

【用例质量要求】
- 完整性：覆盖需求中的全部功能点、业务规则和关键风险。
- 独立性：每条用例可单独执行，不依赖其他用例的执行结果。
- 可重复性：相同前置条件和数据下可以稳定复现。
- 可验证性：预期结果必须具体、可观察、可断言，禁止使用“正常”“符合预期”等模糊表述。
- 清晰性：标题明确描述条件和结果，步骤无歧义并包含必要测试数据。
- 步骤与结果对应：测试步骤和预期结果都必须使用 1. 2. 3. 编号，编号数量及业务逻辑一一对应。
- 不得新增测试状态、备注、设计方法等列；设计方法应体现在测试点、标题、步骤和预期结果中。
- 对需求未明确但执行必需的信息，可在前置条件中写明合理假设，不得虚构确定的业务规则。`;

export const GOOGLE_QA_SYSTEM_PROMPT = `你是遵循 Google 测试标准与 OWASP 安全工程规范的顶级 QA 架构师。请基于用户需求设计世界级的高质量测试用例，严格遵循 AAA 模式（准备-执行-断言）并覆盖安全与极限边界。

【Google AAA 测试模式规范】
1. 前置条件（Arrange / 准备）：
   - 描述测试开始前系统必须处于的已知状态、环境配置与前置依赖。
   - 必须包含测试所需的独立测试数据、用户角色与权限上下文。
   - 测试隔离原则：每条用例必须保持数据与状态独立，不依赖其他用例执行结果。
2. 测试步骤（Act / 执行）：
   - 步骤必须具体明确、可线性执行，包含确切的操作动作与输入数据（如特定字符、边界数值、请求体）。
   - 步骤使用 1. 2. 3. 严格编号。
3. 预期结果（Assert / 断言）：
   - 必须包含具体的、可观测的断言判据（UI 可视元素、状态码、系统状态校验、落库数据或业务错误码）。
   - 严禁使用“操作成功”、“显示正常”、“符合预期”等无法客观断言的模糊词。
   - 预期结果与测试步骤必须保持 1. 2. 3. 编号数量及逻辑一一对应。

【OWASP Top 10 安全与鲁棒性核心覆盖】
在设计用例时，必须系统化覆盖以下安全与韧性维度：
- A01 访问控制（权限提升、垂直/水平越权、未授权访问）
- A02 加密失败与敏感数据（密码明文、Token 泄露、敏感字段脱敏）
- A03 注入攻击（SQL 注入、XSS 跨站脚本、命令注入、特殊非法字符）
- A04 不安全设计与业务逻辑缺陷（负数金额、跳步绕过、时序漏洞）
- A05 安全配置与敏感信息泄露（详细堆栈报错、系统默认敏感配置）
- A07 身份认证与会话（暴力破解防护、Token 过期/失效、并发会话管理）

【优先级评定标准（对齐 Google P0-P4）】
- 高（P0/P1）：阻塞性缺陷、安全漏洞、核心主流程不可用、数据损坏/资损。建议在用例标题加注 [P0] 或 [P1-安全]。
- 中（P2）：次要业务功能异常、常规业务规则与边界值、非关键异常流程。
- 低（P3/P4）：轻微界面外观、极罕见偶现边界、优化建议。

【输出规范】
- 严格遵循指定的 8 列结构，不得擅自增减列。
- 所有设计方法和安全维度必须融合在测试点、标题、前置条件、步骤与预期中。`;

export type CoverageBatchSpec = {
  name: string;
  scope: string;
  coverageItems: string[];
};

const FUNCTIONAL_TEST_INSTRUCTION = `当前任务是功能测试用例设计。重点验证页面或业务功能、角色权限、输入校验、流程状态、异常提示、数据持久化和用户可观察结果。`;

const API_TEST_INSTRUCTION = `当前任务是 API 测试用例设计。除 6 种通用方法外，重点覆盖请求方法与路径、鉴权、Header、路径/查询/Body 参数、数据类型、必填与可选、边界、幂等、重复请求、并发和错误响应。
测试步骤必须明确请求方法、URL、请求头、请求参数和发送动作；预期结果必须包含可验证的 HTTP 状态码、响应字段、业务错误码或数据结果断言。`;

const SECURITY_TEST_INSTRUCTION = `当前任务是 OWASP Top 10 安全渗透与韧性测试用例设计。
必须系统化测试以下安全威胁维度：
1. A01 访问控制失效：垂直越权（普通用户访问管理员接口/数据）、水平越权（通过替换 ID 遍历他人数据）、未授权直接访问；
2. A02 加密失败与敏感数据暴露：明文传输密码/Token、敏感 PII 数据未脱敏、日志或 URL 泄露密钥；
3. A03 注入攻击：SQL 注入（单引号/万能密码 ' OR '1'='1）、XSS 跨站脚本（<script>alert(1)</script>、事件载荷）、命令注入、路径遍历（../../etc/passwd）；
4. A04 不安全设计与业务逻辑滥用：负数/超大金额参数篡改、跳步绕过、并发竞争（Race Condition）；
5. A05 安全配置错误与信息泄漏：异常参数触发的 500 详细堆栈或数据库错误泄露、默认弱口令；
6. A07 认证与会话脆弱性：暴力破解防护（缺少验证码/限流）、弱密码接受度、Token 注销后未失效、并发会话。

【编写标准】
- 用例编号请统一使用 TC-SEC-001、TC-SEC-002 等规范前缀。
- 测试步骤必须包含明确具体的攻击动作与载荷 Payload。
- 预期结果必须包含具体的防御验证断言（如“接口拒绝请求返回 400/401/403，输入被安全转义，无敏感堆栈泄露”）。`;

export function csvRuntime(testType = "functional", language = "zh"): CsvRuntime {
  if (language === "en") {
    if (testType === "security") {
      return {
        header: ["Case ID", "Security Category", "Attack Test Point", "Case Title", "Priority", "Preconditions", "Test Steps", "Expected Results"],
        csvColumns: "Case ID,Security Category,Attack Test Point,Case Title,Priority,Preconditions,Test Steps,Expected Results",
        exampleRow: 'TC-SEC-001,A03 Injection,SQL Injection Login Bypass,Login with SQL injection payload,High,Application running without WAF,"1. Navigate to login page\\n2. Enter username: admin\' OR \'1\'=\'1\\n3. Enter password: anything\\n4. Submit form","1. Login rejected with HTTP 401\\n2. Generic error message displayed\\n3. No SQL error or stack trace exposed in response"',
        languageInstruction: "Generate all test case content in English.",
      };
    }
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

  if (testType === "security") {
    return {
      header: ["用例编号", "安全分类", "攻击测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"],
      csvColumns: "用例编号,安全分类,攻击测试点,用例标题,优先级,前置条件,测试步骤,预期结果",
      exampleRow: 'TC-SEC-001,A03 注入攻击,SQL注入绕过登录,在用户名处输入SQL万能密码登录,高,应用处于运行状态且未开WAF,"1. 访问登录页面\\n2. 在用户名输入框注入: admin\' OR \'1\'=\'1\\n3. 密码栏输入任意字符\\n4. 提交登录请求","1. 系统拒绝登录请求\\n2. 响应状态码为 400 或 401 且提示凭据无效\\n3. 响应中严禁包含任何 SQL 语法错误或数据库堆栈信息"',
      languageInstruction: "Generate all test case content in Chinese (中文).",
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
  image?: string;
  batch?: CoverageBatchSpec;
  promptPreset?: string;
}) {
  const testType = args.testType || "functional";
  const runtime = csvRuntime(testType, args.language || "zh");
  const testInstruction = testType === "api"
    ? API_TEST_INSTRUCTION
    : testType === "security"
      ? SECURITY_TEST_INSTRUCTION
      : FUNCTIONAL_TEST_INSTRUCTION;
  const isGoogleQa = args.promptPreset === "google_qa";
  const baseSystemPrompt = isGoogleQa ? GOOGLE_QA_SYSTEM_PROMPT : DEFAULT_TESTCASE_SYSTEM_PROMPT;

  const batchInstruction = args.batch
    ? `
【当前覆盖批次】
- 批次名称：${args.batch.name}
- 范围：${args.batch.scope}
- 必须覆盖：${args.batch.coverageItems.join("；") || args.batch.scope}
- 只生成当前批次范围的用例，但必须使用完整需求作为业务约束。
- 每个独立可验证的条件、边界、角色、状态迁移和异常结果应单独成例，不得只输出少量代表样例。`
    : "";

  const system = `${baseSystemPrompt}${batchInstruction}

${testInstruction}

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
13. Cover every requirement and all six design methods with high-value, non-duplicate cases.
14. Test steps and expected results must use matching numbered lists with one-to-one logical correspondence.
15. Do not stop at a small representative sample. Output one separate case for every independently verifiable rule, condition, role, boundary, state transition and failure result in the assigned scope.`;

  const userText = `Generate test cases for:
Feature Name: ${args.featureName || "未命名需求"}
Requirements/Context: ${args.context || ""}

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

export function buildRepairMessages(args: {
  rawCsv: string;
  testType?: string;
  language?: string;
}) {
  const runtime = csvRuntime(args.testType || "functional", args.language || "zh");
  return {
    runtime,
    messages: [
      {
        role: "system" as const,
        content: `你是测试用例 CSV 修复器。把输入内容修复成严格 CSV。

要求：
1. 只输出 CSV，不要 Markdown，不要解释。
2. 表头必须是：${runtime.csvColumns}
3. 丢弃非用例内容、解释文本、重复标题、空步骤、空预期。
4. 每条用例必须严格 8 列，不能增加测试状态、备注或设计方法列。
5. 测试步骤和预期结果必须使用对应的编号列表，内容明确且可验证。
6. 用例编号可以临时填写，后端会统一重排。`,
      },
      {
        role: "user" as const,
        content: `需要修复的原始内容：\n${args.rawCsv}`,
      },
    ],
  };
}
