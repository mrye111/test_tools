export type JsonObject = Record<string, unknown>;

export type TestCaseExecutionItem = {
  status: "untested" | "passed" | "failed" | "blocked";
  bugId?: string;
  note?: string;
  updatedAt?: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  systemUrl?: string;
  iconKey?: string;
  iconColor?: string;
  createdAt: string;
  ownerId?: number | null;
};

export type TestSetRecord = {
  id: string;
  projectId: string;
  name: string;
  featureName: string;
  testType: string;
  language: string;
  promptPreset?: string;
  context: string;
  status: string;
  generationJobId?: string;
  error?: string;
  requirement?: string;
  header: string[];
  rows: string[][];
  executionStatus?: Record<string, TestCaseExecutionItem>;
  createdAt: string;
  updatedAt?: string;
  ownerId?: number | null;
};

export type TestCaseRecord = {
  id: string;
  testSetId: string;
  caseId: string;
  module: string;
  testPoint: string;
  title: string;
  priority: string;
  precondition: string;
  steps: string;
  expectedResult: string;
  row: string[];
  [key: string]: unknown;
};

export type GenerateJobRecord = {
  id: string;
  projectId: string;
  testSetId: string;
  mode: "create" | "regenerate_all" | "supplement" | "regenerate_selected" | "optimize";
  status: "queued" | "running" | "completed" | "failed";
  request: JsonObject;
  /** 任务密钥信封（v1:keyId:iv:ct）：与 request 内 [SECRET_REF] 占位配套，磁盘/库只存本字段不存明文。 */
  apiKeyEnc?: string;
  generatedCount: number;
  generatedCountRaw?: number;
  addedCount?: number;
  duplicatesFiltered?: number;
  /** 优化（optimize）模式的变更统计：修改/新增/删除（按内容指纹计算）。 */
  optimizeStats?: { modified: number; added: number; removed: number };
  error: string;
  streamText?: string;
  resultHeader: string[];
  resultRows: string[][];
  selectedIndices: number[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type TestCaseStoreData = {
  projects: ProjectRecord[];
  testSets: TestSetRecord[];
  testCases: TestCaseRecord[];
  generationJobs: GenerateJobRecord[];
};

export type AiRequestConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  provider: "claude" | "codex" | "gemini";
  endpointType: "anthropic" | "openai_chat" | "openai_responses" | "gemini_native";
  modelsUrl?: string;
  isLocalModel?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
};

export type CsvRuntime = {
  header: string[];
  csvColumns: string;
  exampleRow: string;
  languageInstruction: string;
};
