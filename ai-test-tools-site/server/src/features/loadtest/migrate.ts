import type { Pool } from "mysql2/promise";
import { logger } from "../../logger.js";
import { resolveSharedChatDb } from "../../shared/db/pool.js";
import { MemoryLoadTestRepository } from "./repository.js";
import { MysqlLoadTestRepository } from "./mysql-repository.js";
import type { LoadTestRepository } from "./types.js";

/**
 * lt_projects：压测项目（脚本/请求体/环境变量）；lt_runs：压测执行（快照 + 结果）。
 * 脚本与日志用 MEDIUMTEXT（16MB 上限足够 k6 脚本与日志尾部）。
 */
const LOADTEST_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS lt_projects (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    target_base_url VARCHAR(500) NOT NULL,
    script_source MEDIUMTEXT NOT NULL,
    payload_template MEDIUMTEXT,
    env_vars JSON,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS lt_runs (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    status ENUM('queued','running','succeeded','failed','stopped') NOT NULL DEFAULT 'queued',
    env_snapshot JSON,
    script_snapshot MEDIUMTEXT NOT NULL,
    log_tail MEDIUMTEXT NOT NULL,
    summary_text MEDIUMTEXT,
    exit_code INT,
    error VARCHAR(500),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at DATETIME(3) NULL,
    ended_at DATETIME(3) NULL,
    INDEX idx_lt_runs_project (project_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let currentDbMode: "mysql" | "memory" = "memory";

/** 真库契约测试用建表语句（不经 bootstrap，避免共享池常驻测试进程） */
export const LOADTEST_SCHEMA_STATEMENTS_FOR_TEST = LOADTEST_SCHEMA_STATEMENTS;

/** 返回当前在线压测的存储模式（mysql 或 memory）。 */
export function loadtestDbMode(): "mysql" | "memory" {
  return currentDbMode;
}

async function initLoadTestSchema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of LOADTEST_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

/** 启动时初始化在线压测仓库：与聊天域共享同一 MySQL 连接池，失败降级内存。 */
export async function bootstrapLoadTest(): Promise<LoadTestRepository> {
  const handle = await resolveSharedChatDb();
  if (handle.mode === "mysql" && handle.pool) {
    await initLoadTestSchema(handle.pool);
    currentDbMode = "mysql";
    return new MysqlLoadTestRepository(handle.pool);
  }
  currentDbMode = "memory";
  logger.warn("未连接 MySQL，在线压测使用内存仓库");
  return new MemoryLoadTestRepository();
}
