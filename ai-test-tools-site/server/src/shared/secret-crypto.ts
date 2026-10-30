/**
 * 入库密钥统一加密（AES-256-GCM 版本化信封）。
 * 密文格式：v1:<keyId>:<b64url(iv)>:<b64url(ct‖tag)>。
 * 主密钥来自环境 SECRET_MASTER_KEY（base64 32 字节），每环境独立、禁入 git/镜像；
 * 未配置时由 ensureSecretMasterKey 生成并写入 gitignore 的 server/.env（开发兜底）。
 * 红线：同钥 IV 复用一票否决（逐条随机 12B）；密钥字段必须可逆加密，单向哈希只留给登录口令。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export const ENVELOPE_VERSION = "v1";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type SecretCrypto = {
  readonly keyId: string;
  /** 加密一条密钥明文，返回信封串（如 v1:k1:<iv>:<ct>）。 */
  encrypt(plaintext: string): string;
  /** 解密信封串：按信封 keyId 选钥（支持轮换期新旧密钥并存）；密文被篡改（GCM tag 校验失败）抛错。 */
  decrypt(envelope: string): string;
  /** 密文是否用旧 keyId 加密（读路径懒重写标记：true 时调用方宜重加密回写）。 */
  needsRewrite(envelope: string): boolean;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function decodeMasterKey(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("SECRET_MASTER_KEY 必须是 base64 编码的 32 字节密钥");
  }
  return key;
}

export function createSecretCrypto(options: {
  masterKeyBase64: string;
  keyId?: string;
  /** 轮换期历史密钥（keyId → base64 32B）：旧信封按 keyId 命中解密，不再「换钥即全库失明」。 */
  previousKeys?: Record<string, string>;
}): SecretCrypto {
  const keyId = options.keyId?.trim() || "k1";
  const keys = new Map<string, Buffer>([[keyId, decodeMasterKey(options.masterKeyBase64)]]);
  for (const [id, raw] of Object.entries(options.previousKeys ?? {})) {
    if (keys.has(id)) throw new Error(`历史密钥 keyId 与主密钥重复: ${id}`);
    keys.set(id, decodeMasterKey(raw));
  }

  function keyOfEnvelope(envelope: string): { key: Buffer; keyId: string } {
    const parts = envelope.split(":");
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
      throw new Error("密文信封格式非法");
    }
    const key = keys.get(parts[1]);
    if (!key) throw new Error(`未知密钥版本 keyId=${parts[1]}，请配置对应历史主密钥（SECRET_MASTER_KEYS）`);
    return { key, keyId: parts[1] };
  }

  return {
    keyId,
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", keys.get(keyId)!, iv);
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${ENVELOPE_VERSION}:${keyId}:${b64url(iv)}:${b64url(Buffer.concat([ct, tag]))}`;
    },
    decrypt(envelope: string): string {
      const parts = envelope.split(":");
      const { key } = keyOfEnvelope(envelope);
      const iv = Buffer.from(parts[2], "base64url");
      const body = Buffer.from(parts[3], "base64url");
      if (iv.length !== IV_BYTES || body.length < TAG_BYTES) {
        throw new Error("密文信封长度非法");
      }
      const ct = body.subarray(0, body.length - TAG_BYTES);
      const tag = body.subarray(body.length - TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    },
    needsRewrite(envelope: string): boolean {
      return keyOfEnvelope(envelope).keyId !== keyId;
    },
  };
}

export function secretCryptoFromEnv(env: NodeJS.ProcessEnv = process.env): SecretCrypto | null {
  const raw = env.SECRET_MASTER_KEY?.trim();
  if (!raw) return null;
  let previousKeys: Record<string, string> | undefined;
  const previousRaw = env.SECRET_MASTER_KEYS?.trim();
  if (previousRaw) {
    try {
      previousKeys = JSON.parse(previousRaw) as Record<string, string>;
    } catch {
      throw new Error("SECRET_MASTER_KEYS 须为 JSON 对象 {\"<keyId>\":\"<base64 32B>\"}");
    }
  }
  return createSecretCrypto({ masterKeyBase64: raw, keyId: env.SECRET_KEY_ID, previousKeys });
}

/**
 * 取进程级 SecretCrypto：环境未配置时生成随机主密钥并追加进 gitignore 的 server/.env（开发兜底，首次即持久）。
 * 生产环境应由部署显式注入 SECRET_MASTER_KEY，此路径仅兜底。
 */
export function ensureSecretMasterKey(envPath = resolve(process.cwd(), "server", ".env")): SecretCrypto {
  const existing = secretCryptoFromEnv();
  if (existing) return existing;

  const masterKeyBase64 = ensureRandomBase64Secret("SECRET_MASTER_KEY", envPath);
  return createSecretCrypto({ masterKeyBase64, keyId: process.env.SECRET_KEY_ID });
}

/** 确保 env 中存在名为 name 的 base64 随机密钥：已有则返回，否则生成并持久化到 server/.env。 */
export function ensureRandomBase64Secret(name: string, envPath = resolve(process.cwd(), "server", ".env")): string {
  const existing = process.env[name]?.trim();
  if (existing) return existing;

  const value = randomBytes(KEY_BYTES).toString("base64");
  const line = `${name}=${value}\n`;
  mkdirSync(dirname(envPath), { recursive: true });
  if (existsSync(envPath)) {
    appendFileSync(envPath, line, "utf8");
  } else {
    writeFileSync(envPath, line, { encoding: "utf8", mode: 0o600 });
  }
  process.env[name] = value;
  return value;
}

/** 读取 .env 中的主密钥是否存在（不返回值，仅探测）。 */
export function hasMasterKeyInEnvFile(envPath = resolve(process.cwd(), "server", ".env")): boolean {
  if (process.env.SECRET_MASTER_KEY?.trim()) return true;
  if (!existsSync(envPath)) return false;
  return readFileSync(envPath, "utf8").split(/\r?\n/).some((line) => line.startsWith("SECRET_MASTER_KEY="));
}
