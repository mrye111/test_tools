import { createPool, createConnection, type Pool } from "mysql2/promise";
import { loadDbConfig, loadDotEnv, type DbConfig } from "./config.js";

export interface SharedDbHandle {
  pool: Pool | null;
  mode: "mysql" | "memory";
}

/** 数据库名仅允许安全字符，防止配置值注入 DDL。 */
function assertSafeDatabaseName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`非法数据库名: ${name}`);
  }
  return name;
}

/** 引导连接：不带 database 连接，确保目标库存在（池连接指定了库名，库不存在时 SELECT 1 会直接失败）。 */
async function ensureDatabaseExists(config: DbConfig): Promise<void> {
  const database = assertSafeDatabaseName(config.database);
  const connection = await createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
}

export async function createSharedPool(config: DbConfig): Promise<Pool | null> {
  try {
    await ensureDatabaseExists(config);
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

export async function resolveSharedDb(): Promise<SharedDbHandle> {
  loadDotEnv();
  let pool: Pool | null = null;
  try {
    pool = await createSharedPool(loadDbConfig(process.env));
    if (!pool) {
      return { pool: null, mode: "memory" };
    }
    return { pool, mode: "mysql" };
  } catch {
    await safeEndPool(pool);
    return { pool: null, mode: "memory" };
  }
}

let sharedHandlePromise: Promise<SharedDbHandle> | null = null;

/**
 * 进程内共享的数据库句柄（memoized resolveSharedDb）。
 * 各域（报告、用例等）复用同一连接池，避免每个域各建一套 pool。
 * 建表由各域自己的 migrate 负责。
 */
export function resolveSharedChatDb(): Promise<SharedDbHandle> {
  if (!sharedHandlePromise) {
    sharedHandlePromise = resolveSharedDb();
  }
  return sharedHandlePromise;
}
