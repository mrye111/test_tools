/**
 * 云端模型配置按引用解析（spec §4「密钥不出服务端，生成时按引用解析」）。
 * body 的 ai_config/aiConfig 含 cloudConfigId 时：按 id 取当前用户的云端配置，
 * payload + 瞬时解密的 apiKey 组装后走 parseAiRequestConfig（URL/格式归一化语义不变）；
 * 否则原样回退现状解析。找不到/非本人 → 404；密钥缺失 → 400。
 * 明文密钥仅瞬时驻留内存：不进任务 request 落库、不回显、不写日志。
 */

import { badRequest, internal, notFound } from "../../app-error.js";
import type { SecretCrypto } from "../../shared/secret-crypto.js";
import { parseAiRequestConfig } from "../testcase/ai.js";
import type { AiRequestConfig, JsonObject } from "../testcase/types.js";
import { isObject } from "../testcase/utils.js";
import type { AuthStore } from "./repository.js";
import { pickConfigPayload } from "./types.js";

/** 路由侧注入：按 req.authUser.id 解析请求体中的 AI 配置（云端引用 / 本地内联同一入口）。 */
export type AiConfigResolver = (userId: string, body: JsonObject) => Promise<AiRequestConfig>;

/** 提取 body 中的云端配置引用（ai_config/aiConfig 嵌套内的 cloudConfigId）；无 → null。 */
export function cloudConfigIdOf(body: JsonObject): string | null {
  const nested = isObject(body.ai_config) ? body.ai_config : isObject(body.aiConfig) ? body.aiConfig : null;
  if (!nested) return null;
  const raw = (nested as JsonObject).cloudConfigId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * 含 cloudConfigId 时返回有效 body：嵌套配置整体替换为「云端 payload + 解密 apiKey」
 * （引用字段与客户端夹带的同名字段一并丢弃，云端配置为唯一权威）；否则原样返回。
 */
export async function resolveCloudAiConfigBody(
  store: AuthStore,
  secret: SecretCrypto,
  userId: string,
  body: JsonObject,
): Promise<JsonObject> {
  const cloudConfigId = cloudConfigIdOf(body);
  if (!cloudConfigId) return body;

  const record = await store.getModelConfig(userId, cloudConfigId);
  if (!record) throw notFound("云端模型配置不存在或无权使用");
  if (!record.apiKeyEnc) {
    const name = typeof record.payload.name === "string" && record.payload.name.trim()
      ? record.payload.name.trim()
      : record.id;
    throw badRequest(`云端模型配置「${name}」未保存 API Key，请先在设置中补全`);
  }
  let apiKey: string;
  try {
    apiKey = secret.decrypt(record.apiKeyEnc);
  } catch (error) {
    throw internal("云端模型配置密钥解密失败", error instanceof Error ? error : undefined);
  }

  const holderKey = isObject(body.ai_config) ? "ai_config" : "aiConfig";
  // payload 经白名单重建（纵深防御：即便存量行被污染过，api_key/key 等别名也进不了运行时）
  return { ...body, [holderKey]: { ...pickConfigPayload(record.payload), apiKey } };
}

/** 解析请求体为运行时 AI 配置：云端引用先还原成本地等价 body，再走现状归一化解析。 */
export async function resolveAiRequestConfig(
  store: AuthStore,
  secret: SecretCrypto,
  userId: string,
  body: JsonObject,
): Promise<AiRequestConfig> {
  return parseAiRequestConfig(await resolveCloudAiConfigBody(store, secret, userId, body));
}

/**
 * 生成任务运行时解析器（bootstrap 注入 generation.ts）：
 * request 含 cloudConfigId 时按提交者（路由写入的 cloudConfigUserId）实时重取云端配置，
 * 明文只进内存态有效 request，持久化的 request 永远只有引用。
 */
export function createJobAiConfigResolver(
  store: AuthStore,
  secret: SecretCrypto,
): (request: JsonObject) => Promise<JsonObject> {
  return async (request) => {
    if (!cloudConfigIdOf(request)) return request;
    const userId = typeof request.cloudConfigUserId === "string" ? request.cloudConfigUserId.trim() : "";
    if (!userId) throw new Error("云端模型配置引用缺少提交者上下文（cloudConfigUserId）");
    return resolveCloudAiConfigBody(store, secret, userId, request);
  };
}
