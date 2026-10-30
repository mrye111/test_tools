/** automation 域配置入库适配器：automation_config 单行（id='default'）的 DDL 与读写。 */

import type { Pool, RowDataPacket } from "mysql2/promise";
import type {
  AutomationConfigDbAdapter,
  AutomationConfigDbRow,
  AutomationExecutionConfig,
} from "./config-store.js";

const ROW_ID = "default";

export const AUTOMATION_CONFIG_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS automation_config (
    id VARCHAR(16) PRIMARY KEY,
    model_base_url TEXT,
    model_api_key_enc TEXT,
    model_api_key_mask VARCHAR(16),
    model_name VARCHAR(200),
    family VARCHAR(32),
    exec_json JSON,
    fast_mode VARCHAR(16),
    fast_backend VARCHAR(16),
    jev_api_key_enc TEXT,
    jev_base_url TEXT,
    laya_base_url TEXT,
    credentials_enc TEXT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function initAutomationConfigSchema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of AUTOMATION_CONFIG_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

interface ConfigRow extends RowDataPacket {
  id: string;
  model_base_url: string | null;
  model_api_key_enc: string | null;
  model_api_key_mask: string | null;
  model_name: string | null;
  family: string | null;
  exec_json: unknown;
  fast_mode: string | null;
  fast_backend: string | null;
  jev_api_key_enc: string | null;
  jev_base_url: string | null;
  laya_base_url: string | null;
  credentials_enc: string | null;
}

/** mysql2 对 JSON 列可能返回已解析对象或字符串，统一为对象。 */
function toJsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function toDbRow(row: ConfigRow): AutomationConfigDbRow {
  return {
    modelBaseUrl: row.model_base_url,
    modelApiKeyEnc: row.model_api_key_enc,
    modelApiKeyMask: row.model_api_key_mask,
    modelName: row.model_name,
    family: row.family,
    execJson: toJsonValue<AutomationExecutionConfig | null>(row.exec_json, null),
    fastMode: row.fast_mode,
    fastBackend: row.fast_backend,
    jevApiKeyEnc: row.jev_api_key_enc,
    jevBaseUrl: row.jev_base_url,
    layaBaseUrl: row.laya_base_url,
    credentialsEnc: row.credentials_enc,
  };
}

/** 基于共享连接池构造 automation 配置单行适配器（REPLACE 整行覆盖，天然幂等）。 */
export function createMysqlAutomationConfigAdapter(pool: Pool): AutomationConfigDbAdapter {
  return {
    async load(): Promise<AutomationConfigDbRow | null> {
      const [rows] = await pool.query<ConfigRow[]>("SELECT * FROM automation_config WHERE id = ?", [ROW_ID]);
      return rows[0] ? toDbRow(rows[0]) : null;
    },
    async save(row: AutomationConfigDbRow): Promise<void> {
      await pool.query(
        `REPLACE INTO automation_config (
          id, model_base_url, model_api_key_enc, model_api_key_mask, model_name, family,
          exec_json, fast_mode, fast_backend, jev_api_key_enc, jev_base_url, laya_base_url, credentials_enc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ROW_ID,
          row.modelBaseUrl,
          row.modelApiKeyEnc,
          row.modelApiKeyMask,
          row.modelName,
          row.family,
          row.execJson ? JSON.stringify(row.execJson) : null,
          row.fastMode,
          row.fastBackend,
          row.jevApiKeyEnc,
          row.jevBaseUrl,
          row.layaBaseUrl,
          row.credentialsEnc,
        ],
      );
    },
  };
}
