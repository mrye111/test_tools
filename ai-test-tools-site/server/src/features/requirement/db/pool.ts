import { createPool, type Pool } from "mysql2/promise";
import { loadDbConfig, loadDotEnv, type DbConfig } from "./config.js";

export interface ChatDbHandle {
  pool: Pool | null;
  mode: "mysql" | "memory";
}

const SCHEMA_STATEMENTS = [
  `CREATE DATABASE IF NOT EXISTS ai_test_tools
   CHARACTER SET utf8mb4
   COLLATE utf8mb4_unicode_ci`,
  `USE ai_test_tools`,
  `CREATE TABLE IF NOT EXISTS ra_sessions (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    agent_template VARCHAR(32) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ra_messages (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    role ENUM('user','assistant') NOT NULL,
    content MEDIUMTEXT NOT NULL,
    reasoning MEDIUMTEXT,
    status ENUM('streaming','done','error') NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_msg_session FOREIGN KEY (session_id)
      REFERENCES ra_sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ra_session_files (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    message_id VARCHAR(36) NOT NULL,
    kind ENUM('mindmap','cause-effect','decision-table','orthogonal','flowchart') NOT NULL,
    title VARCHAR(200) NOT NULL,
    payload JSON NOT NULL,
    saved_to_library TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_sf_session FOREIGN KEY (session_id)
      REFERENCES ra_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_sf_message FOREIGN KEY (message_id)
      REFERENCES ra_messages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ra_library_files (
    id VARCHAR(36) PRIMARY KEY,
    kind ENUM('mindmap','cause-effect','decision-table','orthogonal','flowchart') NOT NULL,
    title VARCHAR(200) NOT NULL,
    payload JSON NOT NULL,
    source_session_title VARCHAR(200),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function initSchema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

export async function createChatPool(config: DbConfig): Promise<Pool | null> {
  try {
    const pool = createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      charset: "utf8mb4_unicode_ci",
    });
    await pool.query("SELECT 1");
    return pool;
  } catch {
    return null;
  }
}

async function safeEndPool(pool: Pool | null): Promise<void> {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    // ignore cleanup errors
  }
}

export async function resolveChatDb(): Promise<ChatDbHandle> {
  loadDotEnv();
  let pool: Pool | null = null;
  try {
    pool = await createChatPool(loadDbConfig(process.env));
    if (!pool) {
      return { pool: null, mode: "memory" };
    }
    await initSchema(pool);
    return { pool, mode: "mysql" };
  } catch {
    await safeEndPool(pool);
    return { pool: null, mode: "memory" };
  }
}

let sharedHandlePromise: Promise<ChatDbHandle> | null = null;

/**
 * 进程内共享的数据库句柄（memoized resolveChatDb）。
 * 聊天域与报告域复用同一连接池，避免每个域各建一套 pool。
 */
export function resolveSharedChatDb(): Promise<ChatDbHandle> {
  if (!sharedHandlePromise) {
    sharedHandlePromise = resolveChatDb();
  }
  return sharedHandlePromise;
}
