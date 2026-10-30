/** 内存仓储：无 MySQL 时的降级形态（与 ra2 的 memory 降级一致，进程重启即失）。 */

import { randomUUID } from "node:crypto";
import { deriveExecutable } from "./plan-validation.js";
import type {
  ActivityAction,
  ActivityEntry,
  AutomationCase,
  AutomationCasePatch,
  AutomationEnvironment,
  AutomationProjectExt,
  AutomationRepository,
  AutomationSet,
  AutomationTestFile,
  CapturedPage,
  CompiledPlan,
  ExploreSource,
  NewAutomationCase,
  NewCapturedPage,
  NewPlanProposal,
  PlanProposal,
  PlanProposalPatch,
  RunInsightRow,
  RunRecord,
  TestList,
  TestListItem,
  TestSchedule,
} from "./types.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 项目扩展默认值（无记录时的形态）。 */
export function defaultProjectExt(projectId: string): AutomationProjectExt {
  return {
    projectId,
    extraInstructions: "",
    prdText: "",
    runBehavior: { loginOncePerRun: false, viewport: "1920x1080", concurrency: 3 },
    updatedAt: new Date().toISOString(),
  };
}

export class MemoryAutomationRepository implements AutomationRepository {
  private sets = new Map<string, AutomationSet>();
  private cases = new Map<string, AutomationCase>();
  private compiledCache = new Map<string, CompiledPlan>();
  private runs = new Map<string, RunRecord>();
  private projectExts = new Map<string, AutomationProjectExt>();
  private environments = new Map<string, AutomationEnvironment>();
  private testFiles = new Map<string, AutomationTestFile>();
  private activities = new Map<string, ActivityEntry>();
  private sources = new Map<string, ExploreSource>();
  private capturedPages = new Map<string, CapturedPage>();
  private proposals = new Map<string, PlanProposal>();
  private testLists = new Map<string, TestList>();
  private testListItems = new Map<string, TestListItem>();
  private schedules = new Map<string, TestSchedule>();

  async listSets(projectId?: string): Promise<AutomationSet[]> {
    const all = [...this.sets.values()];
    const filtered = projectId ? all.filter((s) => s.projectId === projectId) : all;
    return clone(filtered.sort((a, b) => a.name.localeCompare(b.name)));
  }

  async createSet(input: { projectId: string; name: string }): Promise<AutomationSet> {
    const record: AutomationSet = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.sets.set(record.id, record);
    return clone(record);
  }

  async updateSet(id: string, patch: { name: string }): Promise<AutomationSet | null> {
    const existing = this.sets.get(id);
    if (!existing) return null;
    const updated = { ...existing, name: patch.name };
    this.sets.set(id, updated);
    return clone(updated);
  }

  async deleteSet(id: string): Promise<boolean> {
    if (!this.sets.delete(id)) return false;
    for (const [caseId, item] of this.cases) {
      if (item.setId === id) this.cases.set(caseId, { ...item, setId: undefined });
    }
    return true;
  }

  async listCases(projectId?: string, setId?: string): Promise<AutomationCase[]> {
    const all = [...this.cases.values()];
    const filtered = all.filter(
      (c) => (!projectId || c.projectId === projectId) && (!setId || c.setId === setId),
    );
    return clone(filtered.sort((a, b) => a.caseNo.localeCompare(b.caseNo)));
  }

  async getCase(id: string): Promise<AutomationCase | null> {
    const found = this.cases.get(id);
    return found ? clone(found) : null;
  }

  async createCase(input: NewAutomationCase): Promise<AutomationCase> {
    const now = new Date().toISOString();
    const steps = input.steps ?? [];
    const manualItems = input.manualItems ?? [];
    const record: AutomationCase = {
      id: randomUUID(),
      projectId: input.projectId,
      setId: input.setId,
      caseNo: this.nextCaseNo(input.projectId),
      title: input.title,
      source: input.source ?? "manual",
      entryUrl: input.entryUrl ?? "",
      preconditionText: input.preconditionText ?? "",
      varDefs: clone(input.varDefs ?? {}),
      steps: clone(steps),
      manualItems: clone(manualItems),
      executable: deriveExecutable(steps.filter((s) => s.enabled).length, manualItems.length),
      sourceFunctionalCaseId: input.sourceFunctionalCaseId,
      sourceProposalId: input.sourceProposalId,
      compileHash: input.compileHash,
      lastRunStatus: "never",
      createdAt: now,
      updatedAt: now,
    };
    this.cases.set(record.id, record);
    return clone(record);
  }

  async updateCase(id: string, patch: AutomationCasePatch): Promise<AutomationCase | null> {
    const existing = this.cases.get(id);
    if (!existing) return null;
    const steps = patch.steps ?? existing.steps;
    const manualItems = patch.manualItems ?? existing.manualItems;
    const updated: AutomationCase = {
      ...existing,
      ...patch,
      steps,
      manualItems,
      executable: deriveExecutable(steps.filter((s) => s.enabled).length, manualItems.length),
      updatedAt: new Date().toISOString(),
    };
    this.cases.set(id, updated);
    return clone(updated);
  }

  async updateCaseRunStatus(id: string, status: AutomationCase["lastRunStatus"], at: string): Promise<void> {
    const existing = this.cases.get(id);
    if (existing) {
      this.cases.set(id, { ...existing, lastRunStatus: status, lastRunAt: at });
    }
  }

  async deleteCase(id: string): Promise<boolean> {
    return this.cases.delete(id);
  }

  async getCompiledCache(caseRef: string, textHash: string): Promise<CompiledPlan | null> {
    const hit = this.compiledCache.get(`${caseRef}:${textHash}`);
    return hit ? clone(hit) : null;
  }

  async putCompiledCache(caseRef: string, textHash: string, plan: CompiledPlan): Promise<void> {
    this.compiledCache.set(`${caseRef}:${textHash}`, clone(plan));
  }

  async createRunRecord(record: RunRecord): Promise<void> {
    this.runs.set(record.id, clone(record));
  }

  async updateRunRecord(id: string, patch: Partial<RunRecord>): Promise<void> {
    const existing = this.runs.get(id);
    if (existing) {
      this.runs.set(id, clone({ ...existing, ...patch, id }));
    }
  }

  async getRunRecord(id: string): Promise<RunRecord | null> {
    const found = this.runs.get(id);
    return found ? clone(found) : null;
  }

  async listRunRecords(caseId?: string, limit = 50): Promise<RunRecord[]> {
    const all = [...this.runs.values()]
      .filter((r) => !caseId || r.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return clone(all);
  }

  async listRunsByBatch(batchId: string): Promise<RunRecord[]> {
    const all = [...this.runs.values()]
      .filter((r) => r.batchId === batchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return clone(all);
  }

  /** 取该项目现有 ATC-N 编号的最大值 +1（COUNT 法在删除中间记录后会重复，评审 H1）。 */
  private nextCaseNo(projectId: string): string {
    let maxNo = 0;
    for (const c of this.cases.values()) {
      if (c.projectId !== projectId) continue;
      const match = /^ATC-(\d+)$/.exec(c.caseNo);
      if (match) maxNo = Math.max(maxNo, Number(match[1]));
    }
    return `ATC-${String(maxNo + 1).padStart(3, "0")}`;
  }

  // ── P1 项目化外壳 ────────────────────────────────────────────────────────

  async getProjectExt(projectId: string): Promise<AutomationProjectExt> {
    return clone(this.projectExts.get(projectId) ?? defaultProjectExt(projectId));
  }

  async upsertProjectExt(input: Omit<AutomationProjectExt, "updatedAt">): Promise<AutomationProjectExt> {
    const record: AutomationProjectExt = { ...clone(input), updatedAt: new Date().toISOString() };
    this.projectExts.set(input.projectId, record);
    return clone(record);
  }

  async listEnvironments(projectId: string): Promise<AutomationEnvironment[]> {
    return clone(
      [...this.environments.values()]
        .filter((e) => e.projectId === projectId)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async createEnvironment(input: Omit<AutomationEnvironment, "id" | "createdAt">): Promise<AutomationEnvironment> {
    const record: AutomationEnvironment = { ...clone(input), id: randomUUID(), createdAt: new Date().toISOString() };
    this.environments.set(record.id, record);
    return clone(record);
  }

  async updateEnvironment(
    id: string,
    patch: Partial<Omit<AutomationEnvironment, "id" | "projectId" | "createdAt">>,
  ): Promise<AutomationEnvironment | null> {
    const existing = this.environments.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.environments.set(id, updated);
    return clone(updated);
  }

  async deleteEnvironment(id: string): Promise<boolean> {
    return this.environments.delete(id);
  }

  async setDefaultEnvironment(projectId: string, id: string): Promise<void> {
    for (const [envId, env] of this.environments) {
      if (env.projectId !== projectId) continue;
      this.environments.set(envId, { ...env, isDefault: envId === id });
    }
  }

  async listTestFiles(projectId: string): Promise<AutomationTestFile[]> {
    return clone(
      [...this.testFiles.values()]
        .filter((f) => f.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async addTestFile(input: Omit<AutomationTestFile, "id" | "createdAt">): Promise<AutomationTestFile> {
    const record: AutomationTestFile = { ...clone(input), id: randomUUID(), createdAt: new Date().toISOString() };
    this.testFiles.set(record.id, record);
    return clone(record);
  }

  async deleteTestFile(id: string): Promise<AutomationTestFile | null> {
    const found = this.testFiles.get(id);
    if (!found) return null;
    this.testFiles.delete(id);
    return clone(found);
  }

  // ── P2 探源 ──────────────────────────────────────────────────────────────

  async createSource(input: { projectId: string; entryUrl: string; maxPages: number }): Promise<ExploreSource> {
    const record: ExploreSource = {
      id: randomUUID(),
      projectId: input.projectId,
      entryUrl: input.entryUrl,
      status: "running",
      maxPages: input.maxPages,
      pageCount: 0,
      createdAt: new Date().toISOString(),
    };
    this.sources.set(record.id, record);
    return clone(record);
  }

  async getSource(id: string): Promise<ExploreSource | null> {
    const found = this.sources.get(id);
    return found ? clone(found) : null;
  }

  async listSources(projectId: string): Promise<ExploreSource[]> {
    return clone(
      [...this.sources.values()].filter((s) => s.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async updateSource(
    id: string,
    patch: Partial<Pick<ExploreSource, "status" | "pageCount" | "error" | "finishedAt">>,
  ): Promise<ExploreSource | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.sources.set(id, updated);
    return clone(updated);
  }

  async deleteSource(id: string): Promise<{ source: ExploreSource; screenshots: string[] } | null> {
    const found = this.sources.get(id);
    if (!found) return null;
    this.sources.delete(id);
    const screenshots: string[] = [];
    for (const [pageId, page] of [...this.capturedPages]) {
      if (page.sourceId !== id) continue;
      if (page.screenshotFile) screenshots.push(page.screenshotFile);
      this.capturedPages.delete(pageId);
    }
    return { source: clone(found), screenshots };
  }

  async addCapturedPage(input: NewCapturedPage): Promise<CapturedPage> {
    const record: CapturedPage = { ...clone(input), id: randomUUID(), createdAt: new Date().toISOString() };
    this.capturedPages.set(record.id, record);
    return clone(record);
  }

  async listCapturedPages(sourceId: string): Promise<CapturedPage[]> {
    return clone(
      [...this.capturedPages.values()]
        .filter((p) => p.sourceId === sourceId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async getCapturedPage(id: string): Promise<CapturedPage | null> {
    const found = this.capturedPages.get(id);
    return found ? clone(found) : null;
  }

  // ── P3 规划提案 ──────────────────────────────────────────────────────────

  async createProposals(inputs: NewPlanProposal[]): Promise<PlanProposal[]> {
    let nextNo = this.nextProposalNo(inputs[0]?.projectId ?? "");
    const now = new Date().toISOString();
    return inputs.map((input) => {
      const record: PlanProposal = {
        ...clone(input),
        id: randomUUID(),
        caseNo: `ATP-${String(nextNo++).padStart(3, "0")}`,
        createdAt: now,
        updatedAt: now,
      };
      this.proposals.set(record.id, record);
      return clone(record);
    });
  }

  async listProposals(projectId: string): Promise<PlanProposal[]> {
    return clone(
      [...this.proposals.values()]
        .filter((p) => p.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.caseNo.localeCompare(b.caseNo)),
    );
  }

  async getProposal(id: string): Promise<PlanProposal | null> {
    const found = this.proposals.get(id);
    return found ? clone(found) : null;
  }

  async updateProposal(id: string, patch: PlanProposalPatch): Promise<PlanProposal | null> {
    const existing = this.proposals.get(id);
    if (!existing) return null;
    const updated: PlanProposal = { ...existing, ...clone(patch), updatedAt: new Date().toISOString() };
    this.proposals.set(id, updated);
    return clone(updated);
  }

  async deleteProposal(id: string): Promise<boolean> {
    return this.proposals.delete(id);
  }

  private nextProposalNo(projectId: string): number {
    const max = [...this.proposals.values()]
      .filter((p) => p.projectId === projectId)
      .map((p) => (p.caseNo.startsWith("ATP-") ? Number(p.caseNo.slice(4)) : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    return max + 1;
  }

  // ── P5 Test Lists / Schedules ────────────────────────────────────────────

  async listTestLists(): Promise<TestList[]> {
    return clone([...this.testLists.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async getTestList(id: string): Promise<TestList | null> {
    const found = this.testLists.get(id);
    return found ? clone(found) : null;
  }

  async createTestList(input: { name: string; description?: string }): Promise<TestList> {
    const record: TestList = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? "",
      createdAt: new Date().toISOString(),
    };
    this.testLists.set(record.id, record);
    return clone(record);
  }

  async deleteTestList(id: string): Promise<boolean> {
    const deleted = this.testLists.delete(id);
    if (!deleted) return false;
    for (const [itemId, item] of this.testListItems) {
      if (item.listId === id) this.testListItems.delete(itemId);
    }
    for (const [scheduleId, schedule] of this.schedules) {
      if (schedule.listId === id) this.schedules.delete(scheduleId);
    }
    return true;
  }

  async listTestListItems(listId: string): Promise<TestListItem[]> {
    return clone(
      [...this.testListItems.values()]
        .filter((item) => item.listId === listId)
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
    );
  }

  async addTestListItem(input: { listId: string; caseId: string }): Promise<TestListItem> {
    const existing = [...this.testListItems.values()].find((item) => item.listId === input.listId && item.caseId === input.caseId);
    if (existing) return clone(existing);
    const record: TestListItem = { id: randomUUID(), listId: input.listId, caseId: input.caseId, addedAt: new Date().toISOString() };
    this.testListItems.set(record.id, record);
    return clone(record);
  }

  async removeTestListItem(id: string): Promise<boolean> {
    return this.testListItems.delete(id);
  }

  async listSchedules(listId?: string): Promise<TestSchedule[]> {
    return clone(
      [...this.schedules.values()]
        .filter((s) => !listId || s.listId === listId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async createSchedule(input: { listId: string; cron: string; enabled?: boolean }): Promise<TestSchedule> {
    const record: TestSchedule = {
      id: randomUUID(),
      listId: input.listId,
      cron: input.cron,
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString(),
    };
    this.schedules.set(record.id, record);
    return clone(record);
  }

  async updateSchedule(id: string, patch: Partial<Pick<TestSchedule, "cron" | "enabled" | "lastRunAt">>): Promise<TestSchedule | null> {
    const existing = this.schedules.get(id);
    if (!existing) return null;
    const updated: TestSchedule = { ...existing, ...clone(patch) };
    this.schedules.set(id, updated);
    return clone(updated);
  }

  async deleteSchedule(id: string): Promise<boolean> {
    return this.schedules.delete(id);
  }

  // ── P6 Insights / Activity ───────────────────────────────────────────────

  async listRunsForProject(projectId: string, limit = 500): Promise<RunInsightRow[]> {
    const caseIds = new Set([...this.cases.values()].filter((c) => c.projectId === projectId).map((c) => c.id));
    return clone(
      [...this.runs.values()]
        .filter((r) => r.caseId && caseIds.has(r.caseId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          caseId: r.caseId,
          caseNo: r.caseNo,
          title: r.title,
          engine: r.engine,
          verdict: r.verdict,
          durationMs: r.durationMs,
          createdAt: r.createdAt,
        })),
    );
  }

  async addActivity(input: { projectId: string; actor: string; action: ActivityAction; detail: string }): Promise<void> {
    const record: ActivityEntry = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
    this.activities.set(record.id, record);
  }

  async listActivities(projectId: string, limit = 50): Promise<ActivityEntry[]> {
    return clone(
      [...this.activities.values()]
        .filter((a) => a.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  }
}
