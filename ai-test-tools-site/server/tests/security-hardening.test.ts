/**
 * 安全加固回归（审查 C-1/C-2/H-2/L-4/L-5/M-4 修复钉住）：
 * 密钥剥离全覆盖、payload 白名单、多密钥 keyId 选钥、掩码边界、凭据名黑名单。
 */
import { describe, expect, it } from "vitest";
import { createSecretCrypto } from "../src/shared/secret-crypto.js";
import {
  SECRET_REF_PLACEHOLDER,
  restoreApiKeySecret,
  setJobSecretCrypto,
  stripApiKeySecret,
} from "../src/features/testcase/job-secrets.js";
import { CONFIG_FORBIDDEN_KEYS, maskSecret, pickConfigPayload } from "../src/features/auth/types.js";
import { isDeniedCredentialName } from "../src/features/automation/config-store.js";
import type { JsonObject } from "../src/features/testcase/types.js";

const KEY_A = Buffer.alloc(32, 3).toString("base64");
const KEY_B = Buffer.alloc(32, 4).toString("base64");

describe("stripApiKeySecret 全字段覆盖（审查 C-2）", () => {
  it("嵌套 + 扁平双明文并存：两处全部剥离，enc 只含生效（嵌套）那条，还原后两处同值", () => {
    const secret = createSecretCrypto({ masterKeyBase64: KEY_A });
    const request: JsonObject = {
      ai_config: { baseUrl: "http://x", apiKey: "sk-nested" },
      api_key: "sk-flat",
    };
    const { request: stripped, apiKeyEnc, changed } = stripApiKeySecret(request, null, secret);
    expect(changed).toBe(true);
    expect(JSON.stringify(stripped)).not.toContain("sk-nested");
    expect(JSON.stringify(stripped)).not.toContain("sk-flat");
    expect((stripped.ai_config as JsonObject).apiKey).toBe(SECRET_REF_PLACEHOLDER);
    expect(stripped.api_key).toBe(SECRET_REF_PLACEHOLDER);
    expect(secret.decrypt(apiKeyEnc as string)).toBe("sk-nested");

    const restored = restoreApiKeySecret(stripped, apiKeyEnc, secret);
    expect((restored.ai_config as JsonObject).apiKey).toBe("sk-nested");
    expect(restored.api_key).toBe("sk-nested");
  });

  it("云端引用（嵌套无密钥）+ 扁平明文：扁平照样剥离，enc 沿用 existing（明文不落盘）", () => {
    const secret = createSecretCrypto({ masterKeyBase64: KEY_A });
    const request: JsonObject = {
      ai_config: { cloudConfigId: "cfg-1" },
      api_key: "sk-orphan",
    };
    const { request: stripped, apiKeyEnc } = stripApiKeySecret(request, "existing-enc", secret);
    expect(JSON.stringify(stripped)).not.toContain("sk-orphan");
    expect(stripped.api_key).toBe(SECRET_REF_PLACEHOLDER);
    expect(apiKeyEnc).toBe("existing-enc");
  });

  it("三个别名（api_key/apiKey/key）同时出现：全部剥离", () => {
    const secret = createSecretCrypto({ masterKeyBase64: KEY_A });
    const request: JsonObject = { api_key: "a1", apiKey: "a2", key: "a3" };
    const { request: stripped } = stripApiKeySecret(request, null, secret);
    for (const field of ["api_key", "apiKey", "key"]) {
      expect(stripped[field]).toBe(SECRET_REF_PLACEHOLDER);
    }
    expect(JSON.stringify(stripped)).not.toMatch(/a1|a2|a3/);
  });
});

describe("SecretCrypto 多密钥 keyId（审查 H-2 + L-5）", () => {
  it("历史密钥可解旧信封，needsRewrite 标记懒重写", () => {
    const oldCrypto = createSecretCrypto({ masterKeyBase64: KEY_A, keyId: "k0" });
    const envelope = oldCrypto.encrypt("sk-legacy");
    const rotated = createSecretCrypto({
      masterKeyBase64: KEY_B,
      keyId: "k2",
      previousKeys: { k0: KEY_A },
    });
    expect(rotated.decrypt(envelope)).toBe("sk-legacy");
    expect(rotated.needsRewrite(envelope)).toBe(true);
    expect(rotated.needsRewrite(rotated.encrypt("x"))).toBe(false);
  });

  it("未知 keyId 明确报错（提示配置历史密钥），而非笼统解密失败", () => {
    const oldCrypto = createSecretCrypto({ masterKeyBase64: KEY_A, keyId: "k9" });
    const envelope = oldCrypto.encrypt("x");
    const rotated = createSecretCrypto({ masterKeyBase64: KEY_B, keyId: "k2" });
    expect(() => rotated.decrypt(envelope)).toThrow(/keyId=k9/);
  });

  it("空明文加解密对称（L-5 边界）", () => {
    const secret = createSecretCrypto({ masterKeyBase64: KEY_A });
    expect(secret.decrypt(secret.encrypt(""))).toBe("");
  });
});

describe("payload 白名单与掩码（审查 C-1 / L-4）", () => {
  it("pickConfigPayload 剔除密钥别名与内部字段", () => {
    const payload = pickConfigPayload({
      name: "配置",
      baseUrl: "http://x",
      api_key: "sk-leak",
      key: "sk-leak2",
      apiKeyEnc: "enc",
      apiKeyMask: "mask",
      version: 3,
    });
    expect(payload).toEqual({ name: "配置", baseUrl: "http://x" });
    for (const forbidden of CONFIG_FORBIDDEN_KEYS) {
      expect(forbidden in payload).toBe(false);
    }
  });

  it("短钥全遮，长钥头尾两位", () => {
    expect(maskSecret("sk-short")).toBe("****");
    expect(maskSecret("sk-abcdef123456")).toBe("sk***56");
  });
});

describe("凭据名黑名单（审查 M-4）", () => {
  it("系统保留名拒绝，业务名放行", () => {
    for (const denied of ["NODE_OPTIONS", "PATH", "ComSpec", "LD_PRELOAD", "SECRET_MASTER_KEY", "SESSION_SECRET", "MCP_TOKEN", "MYSQL_PASSWORD", "MIDSCENE_MODEL_API_KEY"]) {
      expect(isDeniedCredentialName(denied), denied).toBe(true);
    }
    for (const allowed of ["E2E_USER", "CRED_TOKEN", "LOGIN_PASSWORD_X", "MY_API_TOKEN"]) {
      expect(isDeniedCredentialName(allowed), allowed).toBe(false);
    }
  });
});

describe("剥离模块级注入还原", () => {
  it("测试后清空注入（防跨文件污染）", () => {
    setJobSecretCrypto(null);
    expect(() =>
      stripApiKeySecret({ apiKey: "sk-x" }, null, null),
    ).toThrow(/拒绝明文落盘/);
  });
});
