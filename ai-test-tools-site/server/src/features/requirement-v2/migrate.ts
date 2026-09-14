import type { Pool } from "mysql2/promise";
import { logger } from "../../logger.js";
import { resolveSharedChatDb } from "../../shared/db/pool.js";
import { MemoryAnalysisRepository } from "./repository.js";
import { MysqlAnalysisRepository } from "./mysql-repository.js";
import type { AnalysisRepository } from "./types.js";

/** ra2_*：需求分析 v2 五表。外键级联删除子资源。 */
const RA2_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ra2_records (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    source_file_name VARCHAR(255),
    source_text MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ra2_requirements (
    id VARCHAR(36) PRIMARY KEY,
    record_id VARCHAR(36) NOT NULL,
    parent_id VARCHAR(36),
    level INT NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    sort INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_ra2req_record FOREIGN KEY (record_id) REFERENCES ra2_records(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ra2_issues (
    id VARCHAR(36) PRIMARY KEY,
    record_id VARCHAR(36) NOT NULL,
    req_id VARCHAR(36),
    type ENUM('ambiguity','missing','conflict','untestable') NOT NULL,
    severity ENUM('high','medium','low') NOT NULL,
    quote TEXT NOT NULL,
    description TEXT NOT NULL,
    suggested_question TEXT NOT NULL,
    status ENUM('open','resolved','accepted') NOT NULL DEFAULT 'open',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_ra2issue_record FOREIGN KEY (record_id) REFERENCES ra2_records(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ra2_criteria (
    id VARCHAR(36) PRIMARY KEY,
    record_id VARCHAR(36) NOT NULL,
    req_id VARCHAR(36) NOT NULL,
    original_text TEXT NOT NULL,
    rewritten_text TEXT NOT NULL,
    status ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_ra2crit_record FOREIGN KEY (record_id) REFERENCES ra2_records(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ra2_conditions (
    id VARCHAR(36) PRIMARY KEY,
    record_id VARCHAR(36) NOT NULL,
    req_id VARCHAR(36),
    criterion_id VARCHAR(36),
    text TEXT NOT NULL,
    kind ENUM('normal','boundary','exception') NOT NULL,
    relay ENUM('none','relayed','generated') NOT NULL DEFAULT 'none',
    testset_id VARCHAR(36),
    sort INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_ra2cond_record FOREIGN KEY (record_id) REFERENCES ra2_records(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let currentDbMode: "mysql" | "memory" = "memory";

/** 返回当前需求分析 v2 的存储模式（mysql 或 memory）。 */
export function analysisDbMode(): "mysql" | "memory" {
  return currentDbMode;
}

async function initRa2Schema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of RA2_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
    // 存量表补列（幂等）：sort 列 2026-09-14 引入，老库 ALTER 一次；重复列错误吞掉
    try {
      await connection.query("ALTER TABLE ra2_conditions ADD COLUMN sort INT NOT NULL DEFAULT 0");
    } catch {
      // 列已存在
    }
  } finally {
    connection.release();
  }
}

/** 启动时初始化需求分析 v2 仓库：共享 MySQL 连接池，失败降级内存。 */
export async function bootstrapRequirementV2(): Promise<AnalysisRepository> {
  const handle = await resolveSharedChatDb();
  if (handle.mode === "mysql" && handle.pool) {
    await initRa2Schema(handle.pool);
    currentDbMode = "mysql";
    return new MysqlAnalysisRepository(handle.pool);
  }
  currentDbMode = "memory";
  logger.warn("未连接 MySQL，需求分析 v2 使用内存仓库");
  return new MemoryAnalysisRepository();
}
