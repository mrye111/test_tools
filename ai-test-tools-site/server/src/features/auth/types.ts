/** auth 域类型：用户、个人偏好、云端模型配置。密钥一律信封密文流转，对外只出掩码。 */

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 对外视图：永不携带密码哈希。 */
export type UserView = {
  id: string;
  username: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 云端模型配置：payload = UniversalProvider 去掉 apiKey 的全部字段（迁移保真，未知字段透传）。 */
export type CloudModelConfigRecord = {
  id: string;
  userId: string;
  payload: Record<string, unknown>;
  /** AES-GCM 信封密文（v1:keyId:iv:ct），仅服务端内部流转。 */
  apiKeyEnc: string | null;
  /** 回显掩码（写入时生成，如 sk-***f8），永不回显明文。 */
  apiKeyMask: string | null;
  /** 乐观锁版本号：更新须携带期望版本，不匹配返回 409。 */
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CloudModelConfigInput = {
  payload: Record<string, unknown>;
  apiKeyEnc: string | null;
  apiKeyMask: string | null;
};

export type CloudModelConfigPatch = {
  payload?: Record<string, unknown>;
  apiKeyEnc?: string | null;
  apiKeyMask?: string | null;
};

export type ModelConfigConflictError = Error & { code: "MODEL_CONFIG_CONFLICT" };

export function toUserView(user: UserRecord): UserView {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    disabled: user.disabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** 生成回显掩码：头 2 字符 + *** + 尾 2 字符（如 sk-***f8）；短于 12 字符全遮（短钥暴露过多）。 */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 12) return "****";
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

/**
 * payload 白名单：云端模型配置 payload JSON 列只允许这些字段（迁移保真覆盖 UniversalProvider 全部已知字段）。
 * 密钥与内部字段绝不入列——防 api_key/key 别名明文落库回显（审查 C-1）。
 */
export const CONFIG_PAYLOAD_KEYS = [
  "name", "providerType", "baseUrl", "model", "modelOptions", "apiFormat", "modelsUrl",
  "contextWindow", "maxOutputTokens", "websiteUrl", "apiKeyUrl", "notes", "icon", "iconColor",
  "endpointCandidates", "isOfficial", "isPartner", "primePartner",
] as const;

/** 密钥别名/内部字段：出现在提交体即拒绝（防明文经别名混入 payload）。 */
export const CONFIG_FORBIDDEN_KEYS = ["api_key", "key", "apiKeyEnc", "apiKeyMask", "passwordHash"] as const;

/** 按白名单过滤 payload（读写两侧共用，纵深防御）。 */
export function pickConfigPayload(source: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of CONFIG_PAYLOAD_KEYS) {
    if (source[key] !== undefined) payload[key] = source[key];
  }
  return payload;
}

/** 对外视图：payload 按白名单过滤 + 掩码 + 版本。 */
export function toConfigView(record: CloudModelConfigRecord): Record<string, unknown> {
  return {
    id: record.id,
    ...pickConfigPayload(record.payload),
    apiKeyMask: record.apiKeyMask,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
