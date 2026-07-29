import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeTextFileWithRetry } from "../testcase/store.js";
import { isObject, nowIso } from "../testcase/utils.js";
import { withSpanSync } from "../../middleware/trace.js";
import { logger } from "../../logger.js";
import { storeError } from "../../app-error.js";
import type { AnalysisRecord, AnalysisRecordSummary } from "./types.js";

/** writeTextFileWithRetry 的写入选项（沿用测试用例 store 的可注入 writeFile 等测试钩子）。 */
type WriteTextFileOptions = NonNullable<Parameters<typeof writeTextFileWithRetry>[2]>;

export type RequirementAnalysisStoreOptions = WriteTextFileOptions & {
  /** 目录类写入的合并落盘间隔（毫秒）；<= 0 表示每次变更立即同步落盘（测试用）。 */
  persistDebounceMs?: number;
};

const DEFAULT_PERSIST_DEBOUNCE_MS = 250;

type RequirementAnalysisStoreData = {
  records: AnalysisRecord[];
};

function cloneEntity<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 列表页摘要：结论按类型计数，不回传树/原文等大字段。 */
export function toAnalysisRecordSummary(record: AnalysisRecord): AnalysisRecordSummary {
  const findingsCount = { risk: 0, ambiguity: 0, clarification: 0 };
  for (const finding of record.findings) {
    findingsCount[finding.type] += 1;
  }
  return {
    id: record.id,
    name: record.name,
    chartType: record.chartType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    findingsCount,
    truncated: record.truncated,
  };
}

/**
 * 分析记录 JSON store（ADR-0004）：内存 Map + 启动读盘 + 重试/防抖落盘，
 * 与测试用例 store 同一落盘模式（writeTextFileWithRetry 临时文件 + rename）。
 * 只保存完成态记录，没有任务状态机，因此全部变更走合并落盘（schedulePersist）。
 */
export class RequirementAnalysisStore {
  private readonly path: string;
  private readonly writeOptions: WriteTextFileOptions;
  private readonly persistDebounceMs: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly records = new Map<string, AnalysisRecord>();

  constructor(
    path = resolve(process.cwd(), "server", "data", "requirement-analysis-store.json"),
    options: RequirementAnalysisStoreOptions = {},
  ) {
    this.path = path;
    const { persistDebounceMs, ...writeOptions } = options;
    this.persistDebounceMs = Math.max(0, Math.floor(persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS));
    this.writeOptions = writeOptions;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) {
      this.persistQuietly();
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<RequirementAnalysisStoreData>;
      for (const record of parsed.records ?? []) {
        // 最低限度结构校验：坏记录（手工编辑/旧格式）跳过而非拖垮整个列表接口
        // （toAnalysisRecordSummary 依赖 findings 数组，缺字段会抛 TypeError 导致列表 500）。
        if (
          record &&
          typeof record.id === "string" &&
          record.id &&
          Array.isArray(record.findings) &&
          isObject(record.tree)
        ) {
          this.records.set(record.id, record);
        }
      }
    } catch {
      // 损坏的存储文件按空库启动，保留原文件以便人工排查。
    }
  }

  private persistNow(): void {
    withSpanSync({ name: "store.write", type: "store", attributes: { file: this.path } }, () => {
      try {
        const data: RequirementAnalysisStoreData = { records: [...this.records.values()] };
        writeTextFileWithRetry(this.path, JSON.stringify(data, null, 2), this.writeOptions);
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw storeError(`写入本地存储失败：${cause.message}`, cause);
      }
    });
  }

  /** 合并落盘路径的失败无法抛给调用方，记录日志并保留内存状态，等待下一次写入带上全量数据。 */
  private persistQuietly(): void {
    try {
      this.persistNow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ file: this.path, error: message }, "写入本地存储失败，已保留内存状态，将在下次写入时重试");
    }
  }

  /**
   * 记录 CRUD 合并落盘：同一防抖窗口内的多次变更只写一次磁盘。
   * 持久化折衷：进程崩溃最多丢失最近 persistDebounceMs 毫秒的写入。
   */
  private schedulePersist(): void {
    if (this.persistDebounceMs <= 0) {
      this.persistQuietly();
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistQuietly();
    }, this.persistDebounceMs);
    this.persistTimer.unref?.();
  }

  listRecords(): AnalysisRecord[] {
    return cloneEntity([...this.records.values()]);
  }

  getRecord(id: string): AnalysisRecord | undefined {
    const found = this.records.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  createRecord(record: AnalysisRecord): AnalysisRecord {
    this.records.set(record.id, record);
    this.schedulePersist();
    return cloneEntity(record);
  }

  updateRecord(id: string, patch: Partial<Pick<AnalysisRecord, "name" | "chartType" | "board">>): AnalysisRecord | undefined {
    const existing = this.records.get(id);
    if (!existing) return undefined;
    const next: AnalysisRecord = { ...existing, ...patch, updatedAt: nowIso() };
    this.records.set(id, next);
    this.schedulePersist();
    return cloneEntity(next);
  }

  /** 幂等语义由路由层决定：返回是否确实删掉了记录，便于 404 对齐 GET。 */
  deleteRecord(id: string): boolean {
    const existed = this.records.delete(id);
    if (existed) this.schedulePersist();
    return existed;
  }
}
