import { logger } from "../../logger.js";
import { resolveSharedChatDb } from "../../shared/db/pool.js";
import { createMysqlTestcaseAdapter, initTestcaseSchema } from "./mysql-persistence.js";
import type { TestCaseStore } from "./store.js";

/**
 * 启动时初始化测试用例域存储：与聊天/报告域共享同一 MySQL 连接池。
 * MySQL 可用 → 初始化 tc_* 四表并把 Store 接入写穿透（存量 JSON 数据自动迁移）；
 * 不可用 → 保持原有 JSON 文件存储，功能不受影响。
 */
export async function bootstrapTestCaseStore(store: TestCaseStore): Promise<void> {
  const handle = await resolveSharedChatDb();
  if (handle.mode === "mysql" && handle.pool) {
    try {
      await initTestcaseSchema(handle.pool);
      await store.attachDb(createMysqlTestcaseAdapter(handle.pool));
      logger.info("测试用例域使用 MySQL 存储（tc_* 表，本地 JSON 文件保留为离线备份）");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, "测试用例域接入 MySQL 失败，回退为本地 JSON 文件存储");
      return;
    }
  }
  logger.warn("未连接 MySQL，测试用例域使用本地 JSON 文件存储");
}
