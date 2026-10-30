#!/usr/bin/env node
/**
 * 密钥轮换批量重加密（幂等可重跑）：把旧 keyId 加密的信封列重写为当前主密钥。
 *
 * 用法：npm run server:build && node server/scripts/reencrypt-secrets.mjs
 *
 * 环境：
 *   SECRET_MASTER_KEY  当前主密钥（base64 32B）
 *   SECRET_KEY_ID      当前 keyId（默认 k1）
 *   SECRET_MASTER_KEYS 历史密钥 JSON map，如 {"k0":"<base64 32B>"}——旧信封按信封内 keyId 命中解密
 *
 * 原则：逐行读 → 解密（按信封 keyId 选钥）→ 用当前主密钥加密 → UPDATE；
 * 只处理 needsRewrite 的行，重复执行零副作用；解密失败的行如实报告（不静默跳过）。
 */
import { createPool } from "mysql2/promise";
import { loadDbConfig, loadDotEnv } from "../dist/src/shared/db/config.js";
import { secretCryptoFromEnv } from "../dist/src/shared/secret-crypto.js";

/** 一切加密列的登记表（spec §6 覆盖清单；新增密钥字段时同步此表）。 */
const TABLES = [
  { table: "auth_model_configs", columns: ["api_key_enc"] },
  { table: "tc_generation_jobs", columns: ["api_key_enc"] },
  { table: "automation_config", columns: ["model_api_key_enc", "jev_api_key_enc", "credentials_enc"] },
];

async function main() {
  loadDotEnv();
  const crypto = secretCryptoFromEnv();
  if (!crypto) {
    console.error("✗ SECRET_MASTER_KEY 未配置");
    process.exit(1);
  }

  const pool = createPool(loadDbConfig(process.env));
  let scanned = 0;
  let rewritten = 0;
  let failed = 0;
  try {
    for (const { table, columns } of TABLES) {
      const [rows] = await pool.query(`SELECT id, ${columns.map((c) => `\`${c}\``).join(", ")} FROM \`${table}\``);
      for (const row of rows) {
        for (const column of columns) {
          const envelope = row[column];
          if (typeof envelope !== "string" || !envelope) continue;
          scanned += 1;
          try {
            if (!crypto.needsRewrite(envelope)) continue;
            const rewrittenEnvelope = crypto.encrypt(crypto.decrypt(envelope));
            await pool.query(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE id = ?`, [rewrittenEnvelope, row.id]);
            rewritten += 1;
          } catch (error) {
            failed += 1;
            console.error(`✗ ${table}.${column} id=${row.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
  } finally {
    await pool.end();
  }
  console.log(`完成：扫描 ${scanned} 条密文，重加密 ${rewritten} 条，失败 ${failed} 条（当前 keyId=${crypto.keyId}）`);
  if (failed > 0) process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
