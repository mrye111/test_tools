import type { Pool } from "mysql2/promise";
import { logger } from "../../logger.js";
import { resolveSharedChatDb } from "../requirement/db/pool.js";
import { MemoryReportRepository } from "./repository.js";
import { MysqlReportRepository } from "./mysql-repository.js";
import type { ReportRepository } from "./types.js";

/** tr_reports：报告记录单表。html / source_digest 用 MEDIUMTEXT（16MB 上限足够单文件报告）。 */
const REPORT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tr_reports (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    report_type ENUM('summary','brief','defect','free') NOT NULL,
    source_type ENUM('text','csv') NOT NULL,
    source_digest MEDIUMTEXT,
    chart_kinds JSON,
    html MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let currentDbMode: "mysql" | "memory" = "memory";

/** 返回当前报告记录的存储模式（mysql 或 memory）。 */
export function reportDbMode(): "mysql" | "memory" {
  return currentDbMode;
}

async function initReportSchema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of REPORT_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

/** 启动时初始化报告记录仓库：与聊天域共享同一 MySQL 连接池，失败降级内存。 */
export async function bootstrapReports(): Promise<ReportRepository> {
  const handle = await resolveSharedChatDb();
  if (handle.mode === "mysql" && handle.pool) {
    await initReportSchema(handle.pool);
    currentDbMode = "mysql";
    return new MysqlReportRepository(handle.pool);
  }
  currentDbMode = "memory";
  logger.warn("未连接 MySQL，报告记录使用内存仓库");
  return new MemoryReportRepository();
}
