/** 自动化配置存取：MySQL 单行表 automation_config（密钥字段信封存储）优先；无库时 server/automation.config.json（gitignored，界面写入）+ server/.env 兜底；保存即热生效。 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logger } from "../../logger.js";
import type { SecretCrypto } from "../../shared/secret-crypto.js";

export type AutomationModelConfig = {
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  family?: string;
};

export type AutomationExecutionConfig = {
  modelTimeoutMs?: number;
  concurrency?: number;
  cacheDefault?: boolean;
};

export type FastEngineConfig = {
  /** auto=act 优先极速引擎、失败降级视觉；visual=全部走视觉引擎。 */
  mode?: "auto" | "visual";
  /** 决策后端：openai=复用视觉模型配置做文本决策；jev=TypeSafe Jev API；laya=本地 sidecar（微调自托管）；off=关闭。 */
  backend?: "off" | "openai" | "jev" | "laya";
  jevApiKey?: string;
  jevBaseUrl?: string;
  layaBaseUrl?: string;
};

export type AutomationConfigFile = {
  model?: AutomationModelConfig;
  execution?: AutomationExecutionConfig;
  fastEngine?: FastEngineConfig;
  /** 凭据键名 → 真实值（只进此文件与进程环境，不落库、不回传前端）。 */
  credentials?: Record<string, string>;
};

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_CONCURRENCY = 3;

let configPath = resolve(process.cwd(), "server", "automation.config.json");
let cached: AutomationConfigFile = {};
let loaded = false;

/** 测试可覆盖配置路径（同时清空缓存与加载标记）。 */
export function setAutomationConfigPath(path: string): void {
  configPath = path;
  cached = {};
  loaded = false;
  executionSettingsRef = null;
}

export function getAutomationConfigPath(): string {
  return configPath;
}

export function loadAutomationConfig(): AutomationConfigFile {
  if (loaded) return cached;
  if (!existsSync(configPath)) {
    cached = {};
    loaded = true;
    return cached;
  }
  try {
    cached = JSON.parse(readFileSync(configPath, "utf-8")) as AutomationConfigFile;
  } catch (error) {
    logger.warn({ err: error }, "[automation] 配置文件解析失败，按空配置处理");
    cached = {};
  }
  loaded = true;
  return cached;
}

// ── 入库持久化（automation_config 单行，密钥字段信封存储）───────────────────────

/** automation_config 单行（id='default'）的映射视图：密钥字段存信封，其余字段存明文。 */
export type AutomationConfigDbRow = {
  modelBaseUrl: string | null;
  modelApiKeyEnc: string | null;
  /** apiKey 尾 4 位掩码（DB 侧展示用，不依赖解密）。 */
  modelApiKeyMask: string | null;
  modelName: string | null;
  family: string | null;
  execJson: AutomationExecutionConfig | null;
  fastMode: string | null;
  fastBackend: string | null;
  jevApiKeyEnc: string | null;
  jevBaseUrl: string | null;
  layaBaseUrl: string | null;
  /** 整个 credentials Map 序列化后加密为一条信封。 */
  credentialsEnc: string | null;
};

export type AutomationConfigDbAdapter = {
  /** 读 id='default' 行；空库返回 null。 */
  load(): Promise<AutomationConfigDbRow | null>;
  /** 整行覆盖写入。 */
  save(row: AutomationConfigDbRow): Promise<void>;
};

let db: { adapter: AutomationConfigDbAdapter; secret: SecretCrypto } | null = null;

/** 接入/卸载 MySQL 配置持久化（bootstrap 时调用；传 null 卸载回纯文件模式）。 */
export function attachAutomationConfigDb(adapter: AutomationConfigDbAdapter | null, secret: SecretCrypto | null): void {
  db = adapter && secret ? { adapter, secret } : null;
}

/** 解密失败不致命：记录日志并按缺失处理（密钥轮换/主密钥丢失时配置其余部分仍可用）。 */
function decryptOrNull(secret: SecretCrypto, envelope: string | null, field: string): string | undefined {
  if (!envelope) return undefined;
  try {
    return secret.decrypt(envelope);
  } catch (error) {
    logger.warn({ err: error, field }, "[automation] 配置密钥解密失败，按缺失处理");
    return undefined;
  }
}

/** 配置 → 单行映射：apiKey / jevApiKey / credentials 加密为信封，其余字段原样入库。 */
export function configToRow(config: AutomationConfigFile, secret: SecretCrypto): AutomationConfigDbRow {
  return {
    modelBaseUrl: config.model?.baseUrl ?? null,
    modelApiKeyEnc: config.model?.apiKey ? secret.encrypt(config.model.apiKey) : null,
    modelApiKeyMask: config.model?.apiKey ? config.model.apiKey.slice(-4) : null,
    modelName: config.model?.modelName ?? null,
    family: config.model?.family ?? null,
    execJson: config.execution ?? null,
    fastMode: config.fastEngine?.mode ?? null,
    fastBackend: config.fastEngine?.backend ?? null,
    jevApiKeyEnc: config.fastEngine?.jevApiKey ? secret.encrypt(config.fastEngine.jevApiKey) : null,
    jevBaseUrl: config.fastEngine?.jevBaseUrl ?? null,
    layaBaseUrl: config.fastEngine?.layaBaseUrl ?? null,
    credentialsEnc: config.credentials ? secret.encrypt(JSON.stringify(config.credentials)) : null,
  };
}

/** 单行映射 → 配置（内存态还原：信封解密回明文）。 */
export function rowToConfig(row: AutomationConfigDbRow, secret: SecretCrypto): AutomationConfigFile {
  const config: AutomationConfigFile = {};
  const model: AutomationModelConfig = {};
  if (row.modelBaseUrl !== null) model.baseUrl = row.modelBaseUrl;
  const apiKey = decryptOrNull(secret, row.modelApiKeyEnc, "model.apiKey");
  if (apiKey !== undefined) model.apiKey = apiKey;
  if (row.modelName !== null) model.modelName = row.modelName;
  if (row.family !== null) model.family = row.family;
  if (Object.keys(model).length > 0) config.model = model;
  if (row.execJson) config.execution = row.execJson;
  const fastEngine: FastEngineConfig = {};
  if (row.fastMode !== null) fastEngine.mode = row.fastMode as FastEngineConfig["mode"];
  if (row.fastBackend !== null) fastEngine.backend = row.fastBackend as FastEngineConfig["backend"];
  const jevApiKey = decryptOrNull(secret, row.jevApiKeyEnc, "fastEngine.jevApiKey");
  if (jevApiKey !== undefined) fastEngine.jevApiKey = jevApiKey;
  if (row.jevBaseUrl !== null) fastEngine.jevBaseUrl = row.jevBaseUrl;
  if (row.layaBaseUrl !== null) fastEngine.layaBaseUrl = row.layaBaseUrl;
  if (Object.keys(fastEngine).length > 0) config.fastEngine = fastEngine;
  const credentialsRaw = decryptOrNull(secret, row.credentialsEnc, "credentials");
  if (credentialsRaw !== undefined) {
    try {
      config.credentials = JSON.parse(credentialsRaw) as Record<string, string>;
    } catch (error) {
      logger.warn({ err: error }, "[automation] 凭据 JSON 解析失败，按空凭据处理");
    }
  }
  return config;
}

/** 配置文件退位为 .bak（迁移入库后不再读写文件；失败不致命，仅记录——库已是真相）。 */
function retireConfigFile(): void {
  if (!existsSync(configPath)) return;
  try {
    renameSync(configPath, `${configPath}.bak`);
  } catch (error) {
    logger.warn({ err: error }, "[automation] 配置文件退位 .bak 失败（库已是真相，文件残留无碍）");
  }
}

/**
 * 启动时从库预加载（幂等，可重跑）：
 * - 库里有数据 → 读库并还原密钥（同时把残留的配置文件退位 .bak）；
 * - 库里空且文件存在 → 幂等迁移：密钥字段加密入库，原文件退位 .bak；
 * - 都为空 → 无操作。未接入库时不做任何事（保持纯文件现状）。
 */
export async function preloadAutomationConfig(): Promise<void> {
  if (!db) return;
  const { adapter, secret } = db;
  const row = await adapter.load();
  if (row) {
    cached = rowToConfig(row, secret);
    loaded = true;
    retireConfigFile();
    return;
  }
  const fileConfig = loadAutomationConfig();
  if (Object.keys(fileConfig).length === 0) return;
  await adapter.save(configToRow(fileConfig, secret));
  cached = fileConfig;
  loaded = true;
  retireConfigFile();
}

function persist(next: AutomationConfigFile): void {
  cached = next;
  loaded = true;
  if (db) {
    // 入库模式：缓存同步生效，库异步写（失败记录日志，下次保存覆盖重试）
    const { adapter, secret } = db;
    void adapter.save(configToRow(next, secret)).catch((error) => {
      logger.warn({ err: error }, "[automation] 配置写入 MySQL 失败，已保留内存状态，将在下次保存时重试");
    });
    return;
  }
  mkdirSync(dirname(configPath), { recursive: true });
  const temp = `${configPath}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2), "utf-8");
  renameSync(temp, configPath);
}

/**
 * 凭据名黑名单：applyAutomationConfig 会把凭据写进 process.env，若允许 NODE_OPTIONS/PATH 之类
 * 的系统保留名，任何登录用户可借此在 spawn 的 node 子进程里执行任意代码（审查 M-4）。
 * 业务凭据走常规大写下划线名即可，永不落在这些保留模式上。
 */
const DENIED_CREDENTIAL_NAME_PATTERNS = [
  /^NODE_/i,
  /^(PATH|PATHEXT|COMSPEC|PROMPT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|LOCALAPPDATA|APPDATA|PROGRAMFILES.*)$/i,
  /^LD_PRELOAD$/i,
  /^DYLD_[A-Z_]+$/i,
  /^(PYTHON|PERL|RUBY|JAVA)_[A-Z_]+$/i,
  /^(SECRET|SESSION|MCP|MYSQL|POSTGRES|PG)[A-Z_]*_/i,
  /^(SECRET_MASTER_KEY|SESSION_SECRET|MCP_TOKEN|MYSQL_[A-Z_]+)$/i,
  /^MIDSCENE_/i,
];

export function isDeniedCredentialName(name: string): boolean {
  return DENIED_CREDENTIAL_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** 把配置应用到进程环境（Midscene 与 varDefs 解析都读 process.env）：.env 兜底，配置文件覆盖。 */
export function applyAutomationConfig(config: AutomationConfigFile): void {
  if (config.model?.baseUrl) process.env.MIDSCENE_MODEL_BASE_URL = config.model.baseUrl;
  if (config.model?.apiKey) process.env.MIDSCENE_MODEL_API_KEY = config.model.apiKey;
  if (config.model?.modelName) process.env.MIDSCENE_MODEL_NAME = config.model.modelName;
  if (config.model?.family) process.env.MIDSCENE_MODEL_FAMILY = config.model.family;
  if (config.execution?.modelTimeoutMs) {
    process.env.MIDSCENE_MODEL_TIMEOUT = String(config.execution.modelTimeoutMs);
  }
  for (const [name, value] of Object.entries(config.credentials ?? {})) {
    if (isDeniedCredentialName(name)) {
      logger.warn({ name }, "[automation] 凭据名为系统保留，已跳过应用到进程环境");
      continue;
    }
    process.env[name] = value;
  }
}

export function getModelConfig(): Required<Pick<AutomationModelConfig, "baseUrl" | "modelName" | "family">> & { hasApiKey: boolean; apiKeyLast4?: string } {
  const config = loadAutomationConfig();
  const apiKey = config.model?.apiKey ?? process.env.MIDSCENE_MODEL_API_KEY ?? "";
  return {
    baseUrl: config.model?.baseUrl ?? process.env.MIDSCENE_MODEL_BASE_URL ?? "",
    modelName: config.model?.modelName ?? process.env.MIDSCENE_MODEL_NAME ?? "",
    family: config.model?.family ?? process.env.MIDSCENE_MODEL_FAMILY ?? "kimi",
    hasApiKey: Boolean(apiKey),
    apiKeyLast4: apiKey ? apiKey.slice(-4) : undefined,
  };
}

export function saveModelConfig(patch: AutomationModelConfig): void {
  const config = loadAutomationConfig();
  const model: AutomationModelConfig = { ...(config.model ?? {}) };
  if (patch.baseUrl !== undefined) model.baseUrl = patch.baseUrl.trim();
  if (patch.modelName !== undefined) model.modelName = patch.modelName.trim();
  if (patch.family !== undefined) model.family = patch.family.trim();
  // apiKey 只在显式提供非空值时更新（空前端不传，保留现有）
  if (patch.apiKey?.trim()) model.apiKey = patch.apiKey.trim();
  persist({ ...config, model });
  applyAutomationConfig(loadAutomationConfig());
}

export type ExecutionSettings = { modelTimeoutMs: number; concurrency: number; cacheDefault: boolean };

let executionSettingsRef: ExecutionSettings | null = null;

/** 稳定引用：RunManager 按引用持有，saveExecutionConfig 就地改写实现热生效。 */
export function getExecutionSettings(): ExecutionSettings {
  if (!executionSettingsRef) {
    const config = loadAutomationConfig();
    executionSettingsRef = {
      modelTimeoutMs: config.execution?.modelTimeoutMs ?? (Number(process.env.MIDSCENE_MODEL_TIMEOUT ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
      concurrency: config.execution?.concurrency ?? DEFAULT_CONCURRENCY,
      cacheDefault: config.execution?.cacheDefault ?? true,
    };
  }
  return executionSettingsRef;
}

export function saveExecutionConfig(patch: AutomationExecutionConfig): void {
  const config = loadAutomationConfig();
  persist({ ...config, execution: { ...(config.execution ?? {}), ...patch } });
  // 就地改写稳定引用，运行中的 RunManager 下一泵即生效
  const settings = getExecutionSettings();
  if (patch.modelTimeoutMs !== undefined) settings.modelTimeoutMs = patch.modelTimeoutMs;
  if (patch.concurrency !== undefined) settings.concurrency = patch.concurrency;
  if (patch.cacheDefault !== undefined) settings.cacheDefault = patch.cacheDefault;
  applyAutomationConfig(loadAutomationConfig());
}

/** 凭据名列表（只暴露键名与掩码尾 4 位，绝不回传真实值）。 */
export function listCredentials(): { name: string; last4: string }[] {
  const config = loadAutomationConfig();
  return Object.entries(config.credentials ?? {})
    .map(([name, value]) => ({ name, last4: value ? value.slice(-4) : "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setCredential(name: string, value: string): void {
  if (isDeniedCredentialName(name)) {
    throw new Error(`凭据名 ${name} 为系统保留，禁止写入`);
  }
  const config = loadAutomationConfig();
  persist({ ...config, credentials: { ...(config.credentials ?? {}), [name]: value } });
  applyAutomationConfig(loadAutomationConfig());
}

export function deleteCredential(name: string): boolean {
  const config = loadAutomationConfig();
  if (!config.credentials || !(name in config.credentials)) return false;
  const credentials = { ...config.credentials };
  delete credentials[name];
  persist({ ...config, credentials });
  // 保留名只清配置不碰进程环境（防误删 PATH/COMSPEC 之类把进程搞死）
  if (!isDeniedCredentialName(name)) {
    delete process.env[name];
  }
  return true;
}

// ── 极速引擎配置 ───────────────────────────────────────────────────────────

export type FastEngineView = {
  mode: "auto" | "visual";
  backend: "off" | "openai" | "jev" | "laya";
  jevBaseUrl: string;
  jevHasApiKey: boolean;
  jevApiKeyLast4?: string;
  layaBaseUrl: string;
};

export function getFastEngineConfig(): FastEngineView {
  const config = loadAutomationConfig();
  const jevKey = config.fastEngine?.jevApiKey ?? "";
  return {
    mode: config.fastEngine?.mode ?? "auto",
    backend: config.fastEngine?.backend ?? "openai",
    jevBaseUrl: config.fastEngine?.jevBaseUrl ?? "https://api.typesafe.ai",
    jevHasApiKey: Boolean(jevKey),
    jevApiKeyLast4: jevKey ? jevKey.slice(-4) : undefined,
    layaBaseUrl: config.fastEngine?.layaBaseUrl ?? "http://127.0.0.1:8765",
  };
}

export function saveFastEngineConfig(patch: FastEngineConfig): void {
  const config = loadAutomationConfig();
  const fastEngine: FastEngineConfig = { ...(config.fastEngine ?? {}) };
  if (patch.mode !== undefined) fastEngine.mode = patch.mode;
  if (patch.backend !== undefined) fastEngine.backend = patch.backend;
  if (patch.jevBaseUrl !== undefined) fastEngine.jevBaseUrl = patch.jevBaseUrl.trim();
  if (patch.jevApiKey?.trim()) fastEngine.jevApiKey = patch.jevApiKey.trim();
  if (patch.layaBaseUrl !== undefined) fastEngine.layaBaseUrl = patch.layaBaseUrl.trim();
  persist({ ...config, fastEngine });
}
