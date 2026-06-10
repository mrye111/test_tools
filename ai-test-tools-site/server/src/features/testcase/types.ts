export type JsonObject = Record<string, unknown>;

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
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
  context: string;
  status: string;
  requirement?: string;
  header: string[];
  rows: string[][];
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
  mode: "create" | "regenerate_all" | "supplement" | "regenerate_selected";
  status: "queued" | "running" | "completed" | "failed";
  request: JsonObject;
  generatedCount: number;
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
  isLocalModel?: boolean;
};

export type CsvRuntime = {
  header: string[];
  csvColumns: string;
  exampleRow: string;
  languageInstruction: string;
};
