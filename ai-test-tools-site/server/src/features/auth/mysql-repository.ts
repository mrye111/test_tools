/** auth 域 MySQL 实现：auth_users / auth_settings / auth_preferences / auth_model_configs。 */

import type { Pool } from "mysql2/promise";
import { conflict } from "../../app-error.js";
import type { AuthStore } from "./repository.js";
import { modelConfigConflict } from "./repository.js";
import type {
  CloudModelConfigInput,
  CloudModelConfigPatch,
  CloudModelConfigRecord,
  UserRecord,
} from "./types.js";

export const AUTH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS auth_users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    disabled TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS auth_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS auth_preferences (
    user_id VARCHAR(36) NOT NULL,
    pref_key VARCHAR(128) NOT NULL,
    pref_value TEXT NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, pref_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS auth_model_configs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    payload JSON NOT NULL,
    api_key_enc TEXT,
    api_key_mask VARCHAR(32),
    version INT NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_auth_model_configs_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function initAuthSchema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of AUTH_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

function toUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    isAdmin: Number(row.is_admin) === 1,
    disabled: Number(row.disabled) === 1,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toConfig(row: Record<string, unknown>): CloudModelConfigRecord {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload ?? {});
  return {
    id: String(row.id),
    userId: String(row.user_id),
    payload: payload as Record<string, unknown>,
    apiKeyEnc: row.api_key_enc === null || row.api_key_enc === undefined ? null : String(row.api_key_enc),
    apiKeyMask: row.api_key_mask === null || row.api_key_mask === undefined ? null : String(row.api_key_mask),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class MysqlAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  mode(): "mysql" {
    return "mysql";
  }

  async countUsers(): Promise<number> {
    const [rows] = await this.pool.query("SELECT COUNT(*) AS c FROM auth_users");
    return Number((rows as Array<Record<string, unknown>>)[0]?.c ?? 0);
  }

  async findUserByName(username: string): Promise<UserRecord | null> {
    const [rows] = await this.pool.query("SELECT * FROM auth_users WHERE username = ?", [username]);
    const list = rows as Array<Record<string, unknown>>;
    return list.length ? toUser(list[0]) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const [rows] = await this.pool.query("SELECT * FROM auth_users WHERE id = ?", [id]);
    const list = rows as Array<Record<string, unknown>>;
    return list.length ? toUser(list[0]) : null;
  }

  async listUsers(): Promise<UserRecord[]> {
    const [rows] = await this.pool.query("SELECT * FROM auth_users ORDER BY created_at, username");
    return (rows as Array<Record<string, unknown>>).map(toUser);
  }

  async createUser(input: { username: string; passwordHash: string; isAdmin: boolean }): Promise<UserRecord> {
    const id = crypto.randomUUID();
    try {
      await this.pool.query(
        "INSERT INTO auth_users (id, username, password_hash, is_admin, disabled) VALUES (?, ?, ?, ?, 0)",
        [id, input.username, input.passwordHash, input.isAdmin ? 1 : 0],
      );
    } catch (error) {
      // 唯一索引冲突 → 409（同名并发注册的确定性收敛，审查 M-2）
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw conflict("用户名已存在");
      throw error;
    }
    const created = await this.findUserById(id);
    if (!created) throw new Error("创建用户失败");
    return created;
  }

  async updateUser(id: string, patch: { passwordHash?: string; disabled?: boolean; isAdmin?: boolean }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.passwordHash !== undefined) {
      sets.push("password_hash = ?");
      params.push(patch.passwordHash);
    }
    if (patch.disabled !== undefined) {
      sets.push("disabled = ?");
      params.push(patch.disabled ? 1 : 0);
    }
    if (patch.isAdmin !== undefined) {
      sets.push("is_admin = ?");
      params.push(patch.isAdmin ? 1 : 0);
    }
    if (!sets.length) return;
    params.push(id);
    await this.pool.query(`UPDATE auth_users SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  async getSetting(key: string): Promise<string | null> {
    const [rows] = await this.pool.query("SELECT setting_value FROM auth_settings WHERE setting_key = ?", [key]);
    const list = rows as Array<Record<string, unknown>>;
    return list.length ? String(list[0].setting_value) : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO auth_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [key, value],
    );
  }

  async getPreference(userId: string, key: string): Promise<string | null> {
    const [rows] = await this.pool.query(
      "SELECT pref_value FROM auth_preferences WHERE user_id = ? AND pref_key = ?",
      [userId, key],
    );
    const list = rows as Array<Record<string, unknown>>;
    return list.length ? String(list[0].pref_value) : null;
  }

  async setPreference(userId: string, key: string, value: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO auth_preferences (user_id, pref_key, pref_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE pref_value = VALUES(pref_value)",
      [userId, key, value],
    );
  }

  async listModelConfigs(userId: string): Promise<CloudModelConfigRecord[]> {
    const [rows] = await this.pool.query(
      "SELECT * FROM auth_model_configs WHERE user_id = ? ORDER BY created_at",
      [userId],
    );
    return (rows as Array<Record<string, unknown>>).map(toConfig);
  }

  async getModelConfig(userId: string, id: string): Promise<CloudModelConfigRecord | null> {
    const [rows] = await this.pool.query(
      "SELECT * FROM auth_model_configs WHERE id = ? AND user_id = ?",
      [id, userId],
    );
    const list = rows as Array<Record<string, unknown>>;
    return list.length ? toConfig(list[0]) : null;
  }

  async createModelConfig(userId: string, input: CloudModelConfigInput): Promise<CloudModelConfigRecord> {
    const id = crypto.randomUUID();
    await this.pool.query(
      "INSERT INTO auth_model_configs (id, user_id, payload, api_key_enc, api_key_mask, version) VALUES (?, ?, ?, ?, ?, 1)",
      [id, userId, JSON.stringify(input.payload ?? {}), input.apiKeyEnc, input.apiKeyMask],
    );
    const created = await this.getModelConfig(userId, id);
    if (!created) throw new Error("创建模型配置失败");
    return created;
  }

  async updateModelConfig(
    userId: string,
    id: string,
    patch: CloudModelConfigPatch,
    expectedVersion: number,
  ): Promise<CloudModelConfigRecord> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.payload !== undefined) {
      sets.push("payload = ?");
      params.push(JSON.stringify(patch.payload ?? {}));
    }
    if (patch.apiKeyEnc !== undefined) {
      sets.push("api_key_enc = ?");
      params.push(patch.apiKeyEnc);
    }
    if (patch.apiKeyMask !== undefined) {
      sets.push("api_key_mask = ?");
      params.push(patch.apiKeyMask);
    }
    sets.push("version = version + 1");
    params.push(id, userId, expectedVersion);
    const [result] = await this.pool.query(
      `UPDATE auth_model_configs SET ${sets.join(", ")} WHERE id = ? AND user_id = ? AND version = ?`,
      params,
    );
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
    if (!affected) {
      const current = await this.getModelConfig(userId, id);
      throw modelConfigConflict(current ? undefined : "配置不存在");
    }
    const updated = await this.getModelConfig(userId, id);
    if (!updated) throw new Error("更新模型配置失败");
    return updated;
  }

  async deleteModelConfig(userId: string, id: string): Promise<void> {
    await this.pool.query("DELETE FROM auth_model_configs WHERE id = ? AND user_id = ?", [id, userId]);
  }
}
