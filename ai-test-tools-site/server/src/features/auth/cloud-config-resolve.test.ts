/** 云端模型配置按引用解析：信封→明文→AiRequestConfig、非本人 404、缺密钥 400、本地 body 不受影响。 */

import { describe, expect, it } from "vitest";
import { AppError } from "../../app-error.js";
import { createSecretCrypto } from "../../shared/secret-crypto.js";
import {
  cloudConfigIdOf,
  createJobAiConfigResolver,
  resolveAiRequestConfig,
  resolveCloudAiConfigBody,
} from "./cloud-config-resolve.js";
import { MemoryAuthStore } from "./repository.js";
import { maskSecret, type CloudModelConfigRecord, type UserRecord } from "./types.js";

const secret = createSecretCrypto({ masterKeyBase64: Buffer.alloc(32, 9).toString("base64") });

type Fixture = {
  store: MemoryAuthStore;
  owner: UserRecord;
  other: UserRecord;
  record: CloudModelConfigRecord;
};

async function setupFixture(): Promise<Fixture> {
  const store = new MemoryAuthStore();
  const owner = await store.createUser({ username: "owner", passwordHash: "x", isAdmin: false });
  const other = await store.createUser({ username: "other", passwordHash: "x", isAdmin: false });
  const record = await store.createModelConfig(owner.id, {
    payload: {
      name: "云端 Kimi",
      providerType: "kimi",
      baseUrl: "https://api.kimi.com/coding/v1/chat/completions",
      model: "kimi-k2.7-code",
      apiFormat: "openai_chat",
      modelsUrl: "https://api.kimi.com/coding/v1/models",
      contextWindow: 262144,
      maxOutputTokens: 32768,
    },
    apiKeyEnc: secret.encrypt("sk-cloud-key"),
    apiKeyMask: maskSecret("sk-cloud-key"),
  });
  return { store, owner, other, record };
}

describe("cloudConfigIdOf", () => {
  it("从 ai_config / aiConfig 嵌套提取引用；无引用或非法值 → null", () => {
    expect(cloudConfigIdOf({ ai_config: { cloudConfigId: "cfg-1" } })).toBe("cfg-1");
    expect(cloudConfigIdOf({ aiConfig: { cloudConfigId: " cfg-2 " } })).toBe("cfg-2");
    expect(cloudConfigIdOf({ ai_config: { apiKey: "k" } })).toBeNull();
    expect(cloudConfigIdOf({ ai_config: { cloudConfigId: "  " } })).toBeNull();
    expect(cloudConfigIdOf({ ai_config: { cloudConfigId: 42 } })).toBeNull();
    expect(cloudConfigIdOf({ cloudConfigId: "cfg-top" })).toBeNull();
    expect(cloudConfigIdOf({})).toBeNull();
  });
});

describe("resolveAiRequestConfig（云端引用）", () => {
  it("按 id 取本人云端配置：信封解密出明文，走 parseAiRequestConfig 归一化", async () => {
    const { store, owner, record } = await setupFixture();
    const config = await resolveAiRequestConfig(store, secret, owner.id, {
      ai_config: { cloudConfigId: record.id },
    });
    expect(config.apiKey).toBe("sk-cloud-key");
    // URL 归一化语义保持：payload 里的 /chat/completions 后缀被剥离
    expect(config.baseUrl).toBe("https://api.kimi.com/coding/v1");
    expect(config.model).toBe("kimi-k2.7-code");
    expect(config.endpointType).toBe("openai_chat");
    expect(config.modelsUrl).toBe("https://api.kimi.com/coding/v1/models");
    expect(config.contextWindow).toBe(262144);
    expect(config.maxOutputTokens).toBe(32768);
  });

  it("客户端夹带的同名字段不生效：云端 payload 为唯一权威", async () => {
    const { store, owner, record } = await setupFixture();
    const config = await resolveAiRequestConfig(store, secret, owner.id, {
      ai_config: { cloudConfigId: record.id, apiKey: "sk-evil", baseUrl: "http://evil.example", model: "evil-model" },
    });
    expect(config.apiKey).toBe("sk-cloud-key");
    expect(config.baseUrl).toBe("https://api.kimi.com/coding/v1");
    expect(config.model).toBe("kimi-k2.7-code");
  });

  it("非本人引用 → 404", async () => {
    const { store, other, record } = await setupFixture();
    const error = await resolveAiRequestConfig(store, secret, other.id, {
      ai_config: { cloudConfigId: record.id },
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).httpStatus).toBe(404);
  });

  it("引用不存在的 id → 404", async () => {
    const { store, owner } = await setupFixture();
    const error = await resolveAiRequestConfig(store, secret, owner.id, {
      ai_config: { cloudConfigId: "cfg-missing" },
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).httpStatus).toBe(404);
  });

  it("云端配置缺密钥 → 400 明确报错", async () => {
    const { store, owner } = await setupFixture();
    const noKey = await store.createModelConfig(owner.id, {
      payload: { name: "无密钥配置", baseUrl: "https://api.example.com/v1", model: "m", apiFormat: "openai_chat" },
      apiKeyEnc: null,
      apiKeyMask: null,
    });
    const error = await resolveAiRequestConfig(store, secret, owner.id, {
      ai_config: { cloudConfigId: noKey.id },
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).httpStatus).toBe(400);
    expect((error as AppError).message).toContain("无密钥配置");
  });

  it("密文无法解密（主密钥不符）→ 500", async () => {
    const { store, owner } = await setupFixture();
    const wrong = createSecretCrypto({ masterKeyBase64: Buffer.alloc(32, 1).toString("base64") });
    const record = await store.createModelConfig(owner.id, {
      payload: { baseUrl: "https://api.example.com/v1", model: "m", apiFormat: "openai_chat" },
      apiKeyEnc: wrong.encrypt("sk-other-env"),
      apiKeyMask: "sk-***nv",
    });
    const error = await resolveAiRequestConfig(store, secret, owner.id, {
      ai_config: { cloudConfigId: record.id },
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).httpStatus).toBe(500);
    expect((error as AppError).message).not.toContain("sk-other-env");
  });
});

describe("resolveCloudAiConfigBody（本地 body 回退）", () => {
  it("无 cloudConfigId 时原样返回（同一引用），本地内联配置解析不变", async () => {
    const { store, owner } = await setupFixture();
    const body = {
      ai_config: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-local",
        model: "gpt-5.5",
        apiFormat: "openai_chat",
      },
    };
    const resolved = await resolveCloudAiConfigBody(store, secret, owner.id, body);
    expect(resolved).toBe(body);
    const config = await resolveAiRequestConfig(store, secret, owner.id, body);
    expect(config.apiKey).toBe("sk-local");
    expect(config.model).toBe("gpt-5.5");
  });
});

describe("createJobAiConfigResolver（生成任务运行起点）", () => {
  it("request 含 cloudConfigId + cloudConfigUserId → 运行时重取并解密", async () => {
    const { store, owner, record } = await setupFixture();
    const resolver = createJobAiConfigResolver(store, secret);
    const resolved = await resolver({
      context: "需求",
      ai_config: { cloudConfigId: record.id },
      cloudConfigUserId: owner.id,
    });
    expect((resolved.ai_config as Record<string, unknown>).apiKey).toBe("sk-cloud-key");
    expect((resolved.ai_config as Record<string, unknown>).cloudConfigId).toBeUndefined();
    expect(resolved.context).toBe("需求");
  });

  it("引用缺提交者上下文 → 明确报错（不放行裸引用）", async () => {
    const { store } = await setupFixture();
    const resolver = createJobAiConfigResolver(store, secret);
    await expect(resolver({ ai_config: { cloudConfigId: "cfg-1" } })).rejects.toThrow("cloudConfigUserId");
  });

  it("无引用的 request 原样返回", async () => {
    const { store } = await setupFixture();
    const resolver = createJobAiConfigResolver(store, secret);
    const request = { ai_config: { baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m" } };
    expect(await resolver(request)).toBe(request);
  });
});
