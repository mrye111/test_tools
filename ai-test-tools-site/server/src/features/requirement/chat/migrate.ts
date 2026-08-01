import { existsSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../../../logger.js";
import { isObject } from "../../testcase/utils.js";
import { resolveChatDb } from "../db/pool.js";
import { MemoryChatRepository } from "./repository.js";
import { MysqlChatRepository } from "./mysql-repository.js";
import type { ChatRepository } from "./types.js";

let currentDbMode: "mysql" | "memory" = "memory";

/** 返回当前 Chat 仓库的存储模式（mysql 或 memory）。 */
export function chatDbMode(): "mysql" | "memory" {
  return currentDbMode;
}

/** 启动时初始化 Chat 仓库并迁移旧数据。 */
export async function bootstrapChat(): Promise<ChatRepository> {
  const handle = await resolveChatDb();
  if (handle.mode === "mysql" && handle.pool) {
    currentDbMode = "mysql";
    const repo = new MysqlChatRepository(handle.pool);
    await migrateLegacyStore(handle.pool, repo);
    return repo;
  }
  currentDbMode = "memory";
  logger.warn("未连接 MySQL，Chat 使用内存仓库");
  return new MemoryChatRepository();
}

type LegacyRecord = {
  id: string;
  name: string;
  chartType: string;
  title: string;
  tree: unknown;
  findings: unknown[];
  sourceText?: string;
  board?: unknown;
  createdAt: string;
  updatedAt: string;
};

/** 构造用于 createLibraryFile 的 SessionFile 快照 */
function toMigrationSessionFile(title: string, payload: unknown): import("./types.js").SessionFile {
  return {
    id: "migration",
    sessionId: "migration",
    messageId: "migration",
    kind: "mindmap",
    title,
    payload,
    savedToLibrary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 迁移旧需求分析 JSON 存储到文件库。
 * 仅在 MySQL 模式调用；内存模式不需要迁移（旧路由仍可读旧 store）。
 */
export async function migrateLegacyStore(_pool: unknown, repo: ChatRepository): Promise<void> {
  const path = resolve(process.cwd(), "server", "data", "requirement-analysis-store.json");
  if (!existsSync(path)) {
    return;
  }

  let data: { records?: unknown[] };
  try {
    data = JSON.parse(readFileSync(path, "utf8")) as { records?: unknown[] };
  } catch (error) {
    logger.warn({ path, error: error instanceof Error ? error.message : String(error) }, "旧需求分析存储文件解析失败，跳过迁移");
    return;
  }

  const records = Array.isArray(data.records) ? data.records : [];
  for (const raw of records) {
    if (!isObject(raw)) {
      logger.warn({ record: raw }, "旧记录格式非法，跳过");
      continue;
    }
    const record = raw as Partial<LegacyRecord>;
    const name = record.name ?? record.title ?? "未命名需求";
    const tree = record.tree;
    if (!isObject(tree)) {
      logger.warn({ record: raw }, "旧记录缺少 tree，跳过");
      continue;
    }

    const title = record.title ?? name;
    const payload = {
      tree,
      findings: Array.isArray(record.findings) ? record.findings : [],
      sourceText: record.sourceText ?? "",
      board: record.board ?? null,
    };

    try {
      await repo.createLibraryFile(toMigrationSessionFile(title, payload));
    } catch (error) {
      logger.warn(
        { recordId: record.id, title, error: error instanceof Error ? error.message : String(error) },
        "单条旧记录迁移失败，继续",
      );
    }
  }

  renameSync(path, `${path}.migrated`);
}
