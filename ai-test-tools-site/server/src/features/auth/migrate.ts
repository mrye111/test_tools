/** auth 域启动引导：建表、会话存储、SecretCrypto。MySQL 不可用降级内存（与其他域一致）。 */

import session from "express-session";
import type { RequestHandler } from "express";
import mysqlSessionFactory from "express-mysql-session";
import type { Pool } from "mysql2/promise";
import { logger } from "../../logger.js";
import { loadDotEnv } from "../../shared/db/config.js";
import { resolveSharedChatDb } from "../../shared/db/pool.js";
import { ensureRandomBase64Secret, ensureSecretMasterKey, type SecretCrypto } from "../../shared/secret-crypto.js";
import { initAuthSchema, MysqlAuthStore } from "./mysql-repository.js";
import { MemoryAuthStore, type AuthStore } from "./repository.js";

export type AuthRuntime = {
  store: AuthStore;
  secret: SecretCrypto;
  sessionStore?: session.Store;
  sessionSecret: string;
};

export function createSessionMiddleware(runtime: Pick<AuthRuntime, "sessionStore" | "sessionSecret">): RequestHandler {
  return session({
    name: "sid",
    secret: runtime.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // 滑动续期：每个响应重置 Cookie 寿命（8h 绝对上限由门禁的 loginAt 校验收口）
    store: runtime.sessionStore, // 未提供时 express-session 用内置 MemoryStore（开发降级）
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // __Host- 前缀要求 Secure，内网 http 部署（http://192.168.x.x）会拒收 Cookie；
      // 改为 secure:"auto"（https 下自动置 Secure），域名钉死由部署层 TLS 保证。
      secure: "auto",
      maxAge: 8 * 60 * 60 * 1000, // 8h 绝对上限（滑动续期在 gate 中按剩余寿命推进）
    },
  });
}

function createMysqlSessionStore(pool: Pool): session.Store {
  const MySQLStore = mysqlSessionFactory(session);
  return new MySQLStore(
    {
      schema: {
        tableName: "auth_sessions",
        columnNames: {
          session_id: "session_id",
          expires: "expires",
          data: "data",
        },
      },
      // 与绝对上限配套：过期会话由库侧清扫
      expiration: 8 * 60 * 60 * 1000,
    },
    pool,
  );
}

export async function bootstrapAuth(): Promise<AuthRuntime> {
  // 必须先加载 server/.env：主密钥/会话密钥要复用已持久化的值。
  // 否则 ensureSecretMasterKey 见 env 为空就重新生成并追加，每次启动换钥，
  // automation_config 的信封密钥全部解不开（凭据/模型 Key 静默丢失）。
  loadDotEnv();
  const secret = ensureSecretMasterKey();
  const sessionSecret = ensureRandomBase64Secret("SESSION_SECRET");
  const handle = await resolveSharedChatDb();
  if (handle.mode === "mysql" && handle.pool) {
    try {
      await initAuthSchema(handle.pool);
      const store = new MysqlAuthStore(handle.pool);
      const sessionStore = createMysqlSessionStore(handle.pool);
      logger.info("auth 域使用 MySQL 存储（auth_* 表 + auth_sessions 会话表）");
      return { store, secret, sessionStore, sessionSecret };
    } catch (error) {
      logger.warn({ err: error }, "auth 域接入 MySQL 失败，降级为内存存储");
    }
  }
  logger.warn("未连接 MySQL，auth 域使用内存存储（重启丢用户，仅限开发）");
  return { store: new MemoryAuthStore(), secret, sessionSecret };
}
