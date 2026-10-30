import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretCrypto } from "../../shared/secret-crypto.js";
import {
  applyAutomationConfig,
  attachAutomationConfigDb,
  deleteCredential,
  getExecutionSettings,
  getModelConfig,
  listCredentials,
  loadAutomationConfig,
  preloadAutomationConfig,
  saveExecutionConfig,
  saveFastEngineConfig,
  saveModelConfig,
  setAutomationConfigPath,
  setCredential,
  type AutomationConfigDbAdapter,
  type AutomationConfigDbRow,
  type AutomationConfigFile,
} from "./config-store.js";

let dir: string;
let path: string;

const ENV_KEYS = [
  "MIDSCENE_MODEL_BASE_URL",
  "MIDSCENE_MODEL_API_KEY",
  "MIDSCENE_MODEL_NAME",
  "MIDSCENE_MODEL_FAMILY",
  "MIDSCENE_MODEL_TIMEOUT",
  "TEST_CRED_ALPHA",
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "at-config-"));
  path = join(dir, "automation.config.json");
  setAutomationConfigPath(path);
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  setAutomationConfigPath(join(process.cwd(), "server", "automation.config.json"));
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("config-store - 模型配置", () => {
  it("保存模型四件套并应用到进程环境；apiKey 空值不覆盖现有", () => {
    saveModelConfig({ baseUrl: "https://api.kimi.com/coding/v1", modelName: "kimi-for-coding", family: "kimi", apiKey: "sk-secret-1234" });
    expect(process.env.MIDSCENE_MODEL_BASE_URL).toBe("https://api.kimi.com/coding/v1");
    expect(process.env.MIDSCENE_MODEL_API_KEY).toBe("sk-secret-1234");

    // 只改 modelName，apiKey 保留
    saveModelConfig({ modelName: "k3" });
    expect(process.env.MIDSCENE_MODEL_API_KEY).toBe("sk-secret-1234");
    expect(process.env.MIDSCENE_MODEL_NAME).toBe("k3");

    // 视图：hasApiKey + last4，不回传完整 key
    const view = getModelConfig();
    expect(view.hasApiKey).toBe(true);
    expect(view.apiKeyLast4).toBe("1234");
    expect(JSON.stringify(view)).not.toContain("sk-secret-1234");
  });

  it(".env 兜底：配置文件缺失字段回落到进程环境", () => {
    process.env.MIDSCENE_MODEL_BASE_URL = "https://env.example.com/v1";
    const view = getModelConfig();
    expect(view.baseUrl).toBe("https://env.example.com/v1");
  });
});

describe("config-store - 执行参数（稳定引用热生效）", () => {
  it("getExecutionSettings 返回稳定引用，save 就地改写", () => {
    const settings = getExecutionSettings();
    expect(settings.concurrency).toBe(3);
    expect(settings.cacheDefault).toBe(true);

    saveExecutionConfig({ concurrency: 5, cacheDefault: false, modelTimeoutMs: 60000 });
    // 同一引用被改写（RunManager 按引用持有即热生效）
    expect(settings.concurrency).toBe(5);
    expect(settings.cacheDefault).toBe(false);
    expect(settings.modelTimeoutMs).toBe(60000);
    expect(getExecutionSettings()).toBe(settings);
    // 且持久化到文件
    const file = JSON.parse(readFileSync(path, "utf-8"));
    expect(file.execution.concurrency).toBe(5);
  });
});

describe("config-store - 凭据", () => {
  it("设置/列表/删除；真实值只进文件与进程环境，列表只回掩码", () => {
    setCredential("TEST_CRED_ALPHA", "TopSecret9999");
    expect(process.env.TEST_CRED_ALPHA).toBe("TopSecret9999");

    const list = listCredentials();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("TEST_CRED_ALPHA");
    expect(list[0].last4).toBe("9999");
    expect(JSON.stringify(list)).not.toContain("TopSecret9999");

    expect(deleteCredential("TEST_CRED_ALPHA")).toBe(true);
    expect(deleteCredential("TEST_CRED_ALPHA")).toBe(false);
    expect(process.env.TEST_CRED_ALPHA).toBeUndefined();
  });
});

describe("config-store - 其他", () => {
  it("配置文件不存在时按空配置；损坏 JSON 不抛错", () => {
    expect(loadAutomationConfig()).toEqual({});
    const fs = require("node:fs");
    fs.writeFileSync(path, "{bad json", "utf-8");
    expect(loadAutomationConfig()).toEqual({});
    expect(existsSync(path)).toBe(true);
  });

  it("applyAutomationConfig 应用凭据到进程环境", () => {
    applyAutomationConfig({ credentials: { TEST_CRED_ALPHA: "applied-value" } });
    expect(process.env.TEST_CRED_ALPHA).toBe("applied-value");
  });
});

describe("config-store - 配置入库（automation_config 单行）", () => {
  const secret = createSecretCrypto({ masterKeyBase64: Buffer.alloc(32, 3).toString("base64") });

  function createFakeAdapter() {
    let row: AutomationConfigDbRow | null = null;
    const adapter: AutomationConfigDbAdapter = {
      load: async () => (row ? { ...row } : null),
      save: async (next) => {
        row = { ...next };
      },
    };
    return { adapter, getRow: () => row };
  }

  afterEach(() => {
    attachAutomationConfigDb(null, null);
  });

  it("库空且文件存在：幂等迁移——密钥列是信封、load 得等值对象、原文件退位 .bak", async () => {
    // 先以纯文件模式写入三类密钥与执行参数
    saveModelConfig({ baseUrl: "https://api.kimi.com/coding/v1", modelName: "kimi-for-coding", family: "kimi", apiKey: "sk-secret-1234" });
    saveFastEngineConfig({ mode: "auto", backend: "jev", jevApiKey: "jev-secret-5678", jevBaseUrl: "https://api.typesafe.ai" });
    setCredential("TEST_CRED_ALPHA", "TopSecret9999");
    saveExecutionConfig({ modelTimeoutMs: 60000, concurrency: 5, cacheDefault: false });
    const before = JSON.parse(JSON.stringify(loadAutomationConfig())) as AutomationConfigFile;
    expect(before.model?.apiKey).toBe("sk-secret-1234");

    const { adapter, getRow } = createFakeAdapter();
    attachAutomationConfigDb(adapter, secret);
    await preloadAutomationConfig();

    // 密钥列是信封不是明文；掩码列只存尾 4 位
    const row = getRow()!;
    expect(row.modelApiKeyEnc).toMatch(/^v1:/);
    expect(row.modelApiKeyEnc).not.toContain("sk-secret-1234");
    expect(row.jevApiKeyEnc).toMatch(/^v1:/);
    expect(row.jevApiKeyEnc).not.toContain("jev-secret-5678");
    expect(row.credentialsEnc).toMatch(/^v1:/);
    expect(row.credentialsEnc).not.toContain("TopSecret9999");
    expect(row.modelApiKeyMask).toBe("1234");

    // 迁移后 load 得等值对象（内存态还原出明文）
    expect(loadAutomationConfig()).toEqual(before);

    // 原文件退位 .bak
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.bak`)).toBe(true);

    // 幂等：清缓存重跑 preload（库已有数据走读库分支），load 结果一致
    setAutomationConfigPath(path);
    await preloadAutomationConfig();
    expect(loadAutomationConfig()).toEqual(before);
    expect(existsSync(path)).toBe(false);
  });

  it("入库模式保存走库：缓存同步更新、库行是信封、文件不再写入", async () => {
    const { adapter, getRow } = createFakeAdapter();
    attachAutomationConfigDb(adapter, secret);
    await preloadAutomationConfig(); // 空库 + 空文件 → 无操作

    saveModelConfig({ baseUrl: "https://ai.test/v1", modelName: "m", family: "kimi", apiKey: "sk-db-4242" });
    expect(loadAutomationConfig().model?.apiKey).toBe("sk-db-4242"); // 缓存同步生效
    expect(existsSync(path)).toBe(false); // 保存走库，不再写文件

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0)); // 等库异步写
    const row = getRow()!;
    expect(row.modelApiKeyEnc).toMatch(/^v1:/);
    expect(row.modelApiKeyEnc).not.toContain("sk-db-4242");
    expect(secret.decrypt(row.modelApiKeyEnc!)).toBe("sk-db-4242");
  });
});
