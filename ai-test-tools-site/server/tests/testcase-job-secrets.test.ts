/**
 * 钉住云端引用（cloudConfigId）与任务密钥剥离的兼容性契约：
 * ai_config 里只有 id 没有 key 时，strip/restore 均为 no-op——
 * 密钥不经任务 request 落库，也无需进 api_key_enc 列（spec §4 生成时按引用解析）。
 */

import { describe, expect, it } from "vitest";
import {
  SECRET_REF_PLACEHOLDER,
  restoreApiKeySecret,
  stripApiKeySecret,
} from "../src/features/testcase/job-secrets.js";
import { createSecretCrypto } from "../src/shared/secret-crypto.js";

const secret = createSecretCrypto({ masterKeyBase64: Buffer.alloc(32, 3).toString("base64") });

describe("任务密钥剥离 × 云端引用", () => {
  it("ai_config 仅含 cloudConfigId（无 key）时剥离为 no-op：request 不动、无密文产出", () => {
    const request = { mode: "create", context: "需求", ai_config: { cloudConfigId: "cfg-1" } };
    const result = stripApiKeySecret(request, null, secret);
    expect(result.changed).toBe(false);
    expect(result.request).toBe(request);
    expect(result.apiKeyEnc).toBeNull();
  });

  it("aiConfig（camelCase 嵌套）仅含 cloudConfigId 时同样 no-op", () => {
    const request = { mode: "create", aiConfig: { cloudConfigId: "cfg-1" } };
    const result = stripApiKeySecret(request, undefined, secret);
    expect(result.changed).toBe(false);
    expect(result.request).toBe(request);
    expect(result.apiKeyEnc).toBeNull();
  });

  it("未注入 SecretCrypto 时云端引用剥离仍为 no-op（不像明文密钥那样拒绝写入）", () => {
    const request = { ai_config: { cloudConfigId: "cfg-1" } };
    const result = stripApiKeySecret(request, null, null);
    expect(result.changed).toBe(false);
    expect(result.request).toBe(request);
  });

  it("云端引用 request 读出侧还原为 no-op（无占位串可回填）", () => {
    const request = { ai_config: { cloudConfigId: "cfg-1" } };
    expect(restoreApiKeySecret(request, secret.encrypt("sk-any"), secret)).toBe(request);
    expect(restoreApiKeySecret(request, null, secret)).toBe(request);
  });

  it("占位串常量不变（与存量密文列契约一致）", () => {
    expect(SECRET_REF_PLACEHOLDER).toBe("[SECRET_REF]");
  });
});
