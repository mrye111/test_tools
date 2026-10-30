/** UI 自动化域类型：自动化用例（独立资产）、编译产物 CompiledPlan、仓储契约。 */

import type { FastReplayFrame } from "./fast-replay.js";

export type { FastReplayFrame };

export type AutomationStepType = "act" | "assert" | "extract" | "wait";

export type AutomationStep = {
  id: number;
  type: AutomationStepType;
  text: string;
  /** extract 步骤保存到的变量名（执行期写入 {{var}} 引用表）。 */
  saveAs?: string;
  /** 溯源：原用例步骤编号（经归一化后按 1..N 计）。 */
  fromStep?: number;
  /** 溯源：原用例预期编号。 */
  fromExpected?: number;
  /** 编辑器可禁用单步；编译产物默认 true。 */
  enabled: boolean;
};

export type ManualItem = {
  text: string;
  reason: string;
  fromStep?: number;
};

/** full=无人工项；partial=有可执行步骤亦有人工项；manual=无可自动执行步骤。 */
export type ExecutableLevel = "full" | "partial" | "manual";

export type CompiledVariable = {
  name: string;
  value: string | null;
  source: "extract" | "input";
  fromStep?: number;
};

export type CompiledSetup = {
  type: "navigate" | "external";
  url?: string;
  text?: string;
  reason?: string;
};

/** LLM 预编译产物（票据「功能用例→AI 指令编译策略调研」定稿 schema 的服务端形态）。 */
export type CompiledPlan = {
  caseRef: string;
  executable: ExecutableLevel;
  variables: CompiledVariable[];
  setup: CompiledSetup[];
  instructions: AutomationStep[];
  manualItems: ManualItem[];
  compileNotes: string[];
  /** 编译输入文本 hash（缓存键的一部分）。 */
  compileHash: string;
  /** 两次校验未过、降级为直映（A 模式）时为 true。 */
  compileFailed?: boolean;
};

export type AutomationCaseSource = "manual" | "playground" | "functional-import" | "plan-proposal";

/** 项目扩展（P1 项目化外壳）：入口地址之外的自动化侧配置。 */
export type AutomationProjectExt = {
  projectId: string;
  defaultEnvId?: string;
  /** 生成/规划时附带的额外指令（「避免破坏性操作」等）。 */
  extraInstructions: string;
  /** PRD 原文（规划阶段的上下文输入之一）。 */
  prdText: string;
  runBehavior: {
    /** 每次运行只登录一次，会话复用到每条用例（防限流/锁号）。 */
    loginOncePerRun: boolean;
    /** 视口预设，如 "1920x1080"。 */
    viewport: string;
    /** 同一运行内并行用例数。 */
    concurrency: number;
  };
  updatedAt: string;
};

/** 环境登录方式：凭据（引用凭据键名）/ 免登录 / SSO（占位，人工介入一次）。 */
export type EnvironmentAuth =
  | { kind: "credentials"; usernameKey: string; passwordKey: string }
  | { kind: "none" }
  | { kind: "sso" };

/** 环境：被测系统的一个部署（URL + 登录方式）；首个为默认。 */
export type AutomationEnvironment = {
  id: string;
  projectId: string;
  name: string;
  url: string;
  isDefault: boolean;
  auth: EnvironmentAuth;
  createdAt: string;
};

/** 测试附件：agent 在执行上传类步骤时可用的文件（P5 接入执行）。 */
export type AutomationTestFile = {
  id: string;
  projectId: string;
  filename: string;
  /** 服务端绝对路径（不出 API）。 */
  path: string;
  size: number;
  createdAt: string;
};

/** 探源状态：aborted=用户中止。 */
export type ExploreSourceStatus = "running" | "done" | "failed" | "aborted";

/** 探源记录（P2）：一次站点探索（BFS 爬站）的汇总。 */
export type ExploreSource = {
  id: string;
  projectId: string;
  entryUrl: string;
  status: ExploreSourceStatus;
  /** 捕获页上限（BFS 封顶）。 */
  maxPages: number;
  pageCount: number;
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

/** 捕获页元素清单（规划上下文用的轻量形态）。 */
export type CapturedElement = {
  index: number;
  role: string;
  name: string;
  kind: "click" | "fill" | "select";
};

/** 捕获页（P2）：爬到的一个页面（截图 + AI 摘要 + 元素清单）。 */
export type CapturedPage = {
  id: string;
  sourceId: string;
  url: string;
  title: string;
  /** BFS 深度（入口为 0）。 */
  depth: number;
  aiSummary: string;
  elements: CapturedElement[];
  /** 截图文件名（源目录内，经专用路由出示）。 */
  screenshotFile?: string;
  createdAt: string;
};

export type NewCapturedPage = Omit<CapturedPage, "id" | "createdAt">;

export type PlanProposalPriority = "high" | "medium" | "low";
export type PlanProposalStatus = "proposed" | "accepted" | "rejected";

/** 规划提案（P3）：LLM 读捕获页 + PRD 产出的一条测试提案（useCase 分组）。 */
export type PlanProposal = {
  id: string;
  projectId: string;
  /** 同一次生成的提案共享一个批次。 */
  batchId: string;
  /** 依据的探源记录（可空：人工触发无源生成）。 */
  sourceId?: string;
  useCase: string;
  /** 提案编号（项目内 ATP-N）。 */
  caseNo: string;
  title: string;
  goal: string;
  /** 预估预期结果（首跑编译的 expectedResult 来源）。 */
  expected: string[];
  priority: PlanProposalPriority;
  /** 预估步骤（首跑编译的 steps 来源；accept 时直映为占位步骤）。 */
  estSteps: string[];
  included: boolean;
  status: PlanProposalStatus;
  createdAt: string;
  updatedAt: string;
};

export type NewPlanProposal = Omit<PlanProposal, "id" | "caseNo" | "createdAt" | "updatedAt">;

export type PlanProposalPatch = Partial<
  Pick<PlanProposal, "title" | "goal" | "expected" | "priority" | "estSteps" | "included" | "status">
>;

/** 项目列表行：项目基础信息 + 自动化侧最新结果聚合。 */
export type AutomationProjectSummary = {
  id: string;
  name: string;
  systemUrl: string;
  caseCount: number;
  /** 最近一次运行的时间与结论分布（无运行为空）。 */
  lastRunAt?: string;
  lastRunVerdict?: RunVerdict;
  lastRunStats?: { passed: number; failed: number; partial: number; total: number };
};

export type AutomationRunStatus = "passed" | "partial" | "failed" | "never";

/** 自动化用例集：套件分组容器（票据 11：与功能用例的 项目⊃用例集⊃用例 三级模型对齐）。 */
export type AutomationSet = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
};

export type AutomationCase = {
  id: string;
  projectId: string;
  /** 所属用例集（未分组为空）。 */
  setId?: string;
  caseNo: string;
  title: string;
  source: AutomationCaseSource;
  entryUrl: string;
  preconditionText: string;
  /** 凭据等变量占位：值是服务端配置里的键名，不是真实秘密（票据「登录态与账号凭据策略」定稿）。 */
  varDefs: Record<string, string>;
  steps: AutomationStep[];
  manualItems: ManualItem[];
  executable: ExecutableLevel;
  sourceFunctionalCaseId?: string;
  /** 规划提案来源（P3）：首跑编译的文本取自该提案。 */
  sourceProposalId?: string;
  compileHash?: string;
  lastRunStatus: AutomationRunStatus;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type NewAutomationCase = {
  projectId: string;
  setId?: string;
  title: string;
  source?: AutomationCaseSource;
  entryUrl?: string;
  preconditionText?: string;
  varDefs?: Record<string, string>;
  steps?: AutomationStep[];
  manualItems?: ManualItem[];
  sourceFunctionalCaseId?: string;
  sourceProposalId?: string;
  compileHash?: string;
};

export type AutomationCasePatch = Partial<
  Omit<AutomationCase, "id" | "projectId" | "caseNo" | "createdAt" | "updatedAt">
>;

/** 运行结论：passed=全部自动步骤通过且无人工项；partial=自动步骤通过但含人工项（最高结论）；failed=有步骤失败；aborted=人工中止。 */
export type RunVerdict = "passed" | "partial" | "failed" | "aborted";

export type RunStatus = "queued" | "running" | "done";

export type StepResultStatus = "passed" | "failed" | "skipped" | "skipped-manual";

export type StepResult = {
  stepId: number;
  type: AutomationStepType | "external";
  text: string;
  status: StepResultStatus;
  durationMs: number;
  error?: string;
  /** extract 步骤提取到的值（同时写入运行变量表）。 */
  extractedValue?: string;
  /** 该步实际由哪个引擎执行（极速 fast / 视觉 visual）。 */
  engine?: "fast" | "visual";
};

/** 进度事件（SSE 直播与回放的数据源）。 */
export type RunEvent =
  | { kind: "status"; status: RunStatus; at: string }
  | { kind: "step-start"; stepId: number; stepType: AutomationStepType; text: string; at: string }
  | { kind: "step-done"; stepId: number; status: StepResultStatus; durationMs: number; error?: string; engine?: "fast" | "visual"; at: string }
  | { kind: "thought"; text: string; at: string }
  | { kind: "action"; name: string; point?: [number, number]; phase: "start" | "done" | "failed"; durationMs?: number; at: string }
  | { kind: "screenshot"; data: string; at: string }
  | { kind: "variable"; name: string; value: string; at: string }
  | { kind: "verdict"; verdict: RunVerdict; durationMs: number; reportFile?: string; at: string }
  | { kind: "error"; message: string; at: string };

/** 页面轨迹条目（P4）：步骤边界采样的页面 URL，Agent Action View 站点图的边/触点来源。 */
export type PageTrailEntry = {
  stepId: number;
  url: string;
  at: string;
  status?: StepResultStatus;
};

/** AI 根因（P4）：运行失败后的根因摘要 + 修复提示词（JSON 存 at_runs.root_cause）。 */
export type RootCauseInfo = {
  summary: string;
  fixPrompt: string;
  generatedAt: string;
  model?: string;
};

export type RunRecord = {
  id: string;
  caseId?: string;
  /** 套件批次：同一次"全部执行"产生的所有成员运行共享一个 batchId。 */
  batchId?: string;
  caseNo: string;
  title: string;
  /** 运行模式：visual=纯视觉；auto=act 优先极速、失败降级视觉（混合）。 */
  engine: "visual" | "auto";
  status: RunStatus;
  verdict?: RunVerdict;
  stepResults: StepResult[];
  manualItems: ManualItem[];
  entryUrl: string;
  cacheId?: string;
  reportFile?: string;
  error?: string;
  durationMs?: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** AI 根因（P4，failed 运行生成）。 */
  rootCause?: RootCauseInfo;
  /** 运行环境引用（P4）：项目环境表 id。 */
  environmentId?: string;
  /** 执行视口（P4）：对齐 browser-pool VIEWPORT。 */
  viewport?: string;
  /** 运行组（P4）：批量/调度一次触发的多条运行共享。 */
  runGroupId?: string;
  /** 运行期暂存（不入库）：帧序列与页面轨迹，finish 时写 run-data sidecar 供站点图/帧画廊查询。 */
  fastFrames?: FastReplayFrame[];
  pageTrail?: PageTrailEntry[];
};

export interface AutomationRepository {
  listSets(projectId?: string): Promise<AutomationSet[]>;
  createSet(input: { projectId: string; name: string }): Promise<AutomationSet>;
  updateSet(id: string, patch: { name: string }): Promise<AutomationSet | null>;
  /** 删除用例集；成员用例的 setId 置空（不删用例）。 */
  deleteSet(id: string): Promise<boolean>;
  listCases(projectId?: string, setId?: string): Promise<AutomationCase[]>;
  getCase(id: string): Promise<AutomationCase | null>;
  createCase(input: NewAutomationCase): Promise<AutomationCase>;
  updateCase(id: string, patch: AutomationCasePatch): Promise<AutomationCase | null>;
  /** 执行完成后定点回写最近运行状态（不整行覆盖，避免与用户并发编辑互相丢失）。 */
  updateCaseRunStatus(id: string, status: AutomationRunStatus, at: string): Promise<void>;
  deleteCase(id: string): Promise<boolean>;
  getCompiledCache(caseRef: string, textHash: string): Promise<CompiledPlan | null>;
  putCompiledCache(caseRef: string, textHash: string, plan: CompiledPlan): Promise<void>;
  createRunRecord(record: RunRecord): Promise<void>;
  updateRunRecord(id: string, patch: Partial<RunRecord>): Promise<void>;
  getRunRecord(id: string): Promise<RunRecord | null>;
  listRunRecords(caseId?: string, limit?: number): Promise<RunRecord[]>;
  listRunsByBatch(batchId: string): Promise<RunRecord[]>;

  // ── P1 项目化外壳 ────────────────────────────────────────────────────────
  /** 项目扩展（无记录时返回默认值）。 */
  getProjectExt(projectId: string): Promise<AutomationProjectExt>;
  upsertProjectExt(input: Omit<AutomationProjectExt, "updatedAt">): Promise<AutomationProjectExt>;
  listEnvironments(projectId: string): Promise<AutomationEnvironment[]>;
  createEnvironment(input: Omit<AutomationEnvironment, "id" | "createdAt">): Promise<AutomationEnvironment>;
  updateEnvironment(id: string, patch: Partial<Omit<AutomationEnvironment, "id" | "projectId" | "createdAt">>): Promise<AutomationEnvironment | null>;
  deleteEnvironment(id: string): Promise<boolean>;
  /** 设为默认：同项目其余环境置非默认。 */
  setDefaultEnvironment(projectId: string, id: string): Promise<void>;
  listTestFiles(projectId: string): Promise<AutomationTestFile[]>;
  addTestFile(input: Omit<AutomationTestFile, "id" | "createdAt">): Promise<AutomationTestFile>;
  /** 返回被删记录（路由层负责删磁盘文件）。 */
  deleteTestFile(id: string): Promise<AutomationTestFile | null>;

  // ── P2 探源 ──────────────────────────────────────────────────────────────
  createSource(input: { projectId: string; entryUrl: string; maxPages: number }): Promise<ExploreSource>;
  getSource(id: string): Promise<ExploreSource | null>;
  listSources(projectId: string): Promise<ExploreSource[]>;
  updateSource(
    id: string,
    patch: Partial<Pick<ExploreSource, "status" | "pageCount" | "error" | "finishedAt">>,
  ): Promise<ExploreSource | null>;
  /** 删除探源记录；连带删除捕获页（截图文件由路由层清）。返回被删源与其截图文件名。 */
  deleteSource(id: string): Promise<{ source: ExploreSource; screenshots: string[] } | null>;
  addCapturedPage(input: NewCapturedPage): Promise<CapturedPage>;
  listCapturedPages(sourceId: string): Promise<CapturedPage[]>;
  getCapturedPage(id: string): Promise<CapturedPage | null>;

  // ── P3 规划提案 ──────────────────────────────────────────────────────────
  /** 批量落提案（caseNo 按项目内 ATP-N 顺序分配）。 */
  createProposals(inputs: NewPlanProposal[]): Promise<PlanProposal[]>;
  listProposals(projectId: string): Promise<PlanProposal[]>;
  getProposal(id: string): Promise<PlanProposal | null>;
  updateProposal(id: string, patch: PlanProposalPatch): Promise<PlanProposal | null>;
  deleteProposal(id: string): Promise<boolean>;

  // ── P5 Test Lists / Schedules ────────────────────────────────────────────
  listTestLists(): Promise<TestList[]>;
  getTestList(id: string): Promise<TestList | null>;
  createTestList(input: { name: string; description?: string }): Promise<TestList>;
  /** 删除用例集；连带删除成员项与定时。 */
  deleteTestList(id: string): Promise<boolean>;
  listTestListItems(listId: string): Promise<TestListItem[]>;
  /** 同列表重复 caseId 幂等返回既有项。 */
  addTestListItem(input: { listId: string; caseId: string }): Promise<TestListItem>;
  removeTestListItem(id: string): Promise<boolean>;
  listSchedules(listId?: string): Promise<TestSchedule[]>;
  createSchedule(input: { listId: string; cron: string; enabled?: boolean }): Promise<TestSchedule>;
  updateSchedule(id: string, patch: Partial<Pick<TestSchedule, "cron" | "enabled" | "lastRunAt">>): Promise<TestSchedule | null>;
  deleteSchedule(id: string): Promise<boolean>;

  // ── P6 Insights / Activity ───────────────────────────────────────────────
  /** 项目维度的运行轻量行（洞察聚合入参；按创建时间倒序）。 */
  listRunsForProject(projectId: string, limit?: number): Promise<RunInsightRow[]>;
  addActivity(input: { projectId: string; actor: string; action: ActivityAction; detail: string }): Promise<void>;
  listActivities(projectId: string, limit?: number): Promise<ActivityEntry[]>;
}

// ── P5 Test Lists / Schedules ──────────────────────────────────────────────

/** 跨项目用例集（Test List）：一组用例的集合，可整集执行、可定时。 */
export type TestList = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

export type TestListItem = {
  id: string;
  listId: string;
  caseId: string;
  addedAt: string;
};

/** 定时：5 段 cron（分 时 日 月 周，分钟粒度），到点触发整集执行（失败继续）。 */
export type TestSchedule = {
  id: string;
  listId: string;
  cron: string;
  enabled: boolean;
  /** 最近触发时刻（扫描器分钟级去重用）。 */
  lastRunAt?: string;
  createdAt: string;
};

// ── P6 Insights / Activity ─────────────────────────────────────────────────

/** 洞察聚合入参：运行记录的轻量投影。 */
export type RunInsightRow = {
  id: string;
  caseId?: string;
  caseNo: string;
  title: string;
  engine: "visual" | "auto";
  verdict?: RunVerdict;
  durationMs?: number;
  createdAt: string;
};

/** 活动审计动作三类（票据口径）：运行 / 编辑 / 生成。 */
export type ActivityAction = "run" | "edit" | "generate";

/** 项目活动审计条目：谁/何时/触发了什么。 */
export type ActivityEntry = {
  id: string;
  projectId: string;
  actor: string;
  action: ActivityAction;
  detail: string;
  createdAt: string;
};
