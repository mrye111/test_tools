/**
 * tc_* 生成任务密钥剥离：request 内**全部** AI apiKey 字段（api_key/apiKey/key 三个别名，
 * 扁平与 ai_config/aiConfig 嵌套两层）落盘/入库前一律剥离为占位串，运行时生效的那条加密入
 * api_key_enc 列/字段；读出时解密回填所有占位。磁盘与库永不落明文。
 */
import { logger } from "../../logger.js";
import type { SecretCrypto } from "../../shared/secret-crypto.js";
import type { JsonObject } from "./types.js";
import { isObject } from "./utils.js";

/** request 内被剥离密钥的占位串。 */
export const SECRET_REF_PLACEHOLDER = "[SECRET_REF]";

/** 与 parseAiRequestConfig 一致的 apiKey 别名（api_key → apiKey → key）。 */
const API_KEY_FIELDS = ["api_key", "apiKey", "key"] as const;

let secretCrypto: SecretCrypto | null = null;

/** 注入进程级 SecretCrypto（bootstrap 用 ensureSecretMasterKey 获取；传 null 供测试还原）。 */
export function setJobSecretCrypto(secret: SecretCrypto | null): void {
  secretCrypto = secret;
}

export function getJobSecretCrypto(): SecretCrypto | null {
  return secretCrypto;
}

type SecretHit = {
  holderKey: "ai_config" | "aiConfig" | null;
  field: string;
  value: string;
};

/** 扫描两层（ai_config/aiConfig 嵌套 + 扁平）收集全部密钥字段命中，嵌套在前（生效语义同 parseAiRequestConfig）。 */
function collectSecretHits(request: JsonObject): SecretHit[] {
  const hits: SecretHit[] = [];
  const scan = (holder: JsonObject, holderKey: "ai_config" | "aiConfig" | null) => {
    for (const field of API_KEY_FIELDS) {
      const value = holder[field];
      if (typeof value === "string" && value.length > 0) {
        hits.push({ holderKey, field, value });
      }
    }
  };
  const nestedKey = isObject(request.ai_config) ? "ai_config" : isObject(request.aiConfig) ? "aiConfig" : null;
  if (nestedKey) scan(request[nestedKey] as JsonObject, nestedKey);
  scan(request, null);
  return hits;
}

/** 不可变替换密钥字段值（嵌套/扁平同路径回写）。 */
function withApiKeyField(request: JsonObject, location: SecretHit, value: string): JsonObject {
  if (location.holderKey === null) return { ...request, [location.field]: value };
  const holder = request[location.holderKey] as JsonObject;
  return { ...request, [location.holderKey]: { ...holder, [location.field]: value } };
}

/**
 * 剥离任务密钥（写入侧）：**全部命中字段**置 [SECRET_REF] 占位；运行时生效的那条（嵌套非空只看嵌套、
 * 否则扁平，与 parseAiRequestConfig 同语义）加密为信封入 apiKeyEnc。非生效的多余明文直接丢弃
 * （它从不参与运行，留着只会泄密）。已是占位或无明文时原样返回并沿用 existingEnc。
 * 存在明文但未注入 SecretCrypto 时抛错——宁可拒绝写入，也不让明文落盘/入库。
 */
export function stripApiKeySecret(
  request: JsonObject,
  existingEnc: string | null | undefined,
  secret: SecretCrypto | null,
): { request: JsonObject; apiKeyEnc: string | null; changed: boolean } {
  const hits = collectSecretHits(request);
  const plaintextHits = hits.filter((hit) => hit.value !== SECRET_REF_PLACEHOLDER);
  if (plaintextHits.length === 0) {
    return { request, apiKeyEnc: existingEnc ?? null, changed: false };
  }
  if (!secret) {
    throw new Error("任务密钥缺少加密上下文（SecretCrypto 未注入），拒绝明文落盘");
  }

  const nestedKey = isObject(request.ai_config) ? "ai_config" : isObject(request.aiConfig) ? "aiConfig" : null;
  const nestedHolder = nestedKey ? (request[nestedKey] as JsonObject) : null;
  const useNested = nestedHolder !== null && Object.keys(nestedHolder).length > 0;
  const effectiveHolderKey = useNested ? nestedKey : null;
  const effectiveHit = plaintextHits.find((hit) => hit.holderKey === effectiveHolderKey) ?? null;

  let next: JsonObject = request;
  for (const hit of plaintextHits) {
    next = withApiKeyField(next, hit, SECRET_REF_PLACEHOLDER);
  }
  return {
    request: next,
    // 生效密钥缺失（如云端引用只有 cloudConfigId、明文只在被丢弃的无效位置）时沿用 existingEnc
    apiKeyEnc: effectiveHit ? secret.encrypt(effectiveHit.value) : (existingEnc ?? null),
    changed: true,
  };
}

/** 还原任务密钥（读出侧，内存态）：**全部**占位串 → 解密明文；无密文/无占位/解密失败保持原样（失败记录日志）。 */
export function restoreApiKeySecret(
  request: JsonObject,
  apiKeyEnc: string | null | undefined,
  secret: SecretCrypto | null,
): JsonObject {
  if (!apiKeyEnc || !secret) return request;
  const placeholderHits = collectSecretHits(request).filter((hit) => hit.value === SECRET_REF_PLACEHOLDER);
  if (placeholderHits.length === 0) return request;
  try {
    const plain = secret.decrypt(apiKeyEnc);
    let next: JsonObject = request;
    for (const hit of placeholderHits) {
      next = withApiKeyField(next, hit, plain);
    }
    return next;
  } catch (error) {
    logger.warn({ err: error }, "[testcase] 任务密钥解密失败，保留占位符");
    return request;
  }
}
