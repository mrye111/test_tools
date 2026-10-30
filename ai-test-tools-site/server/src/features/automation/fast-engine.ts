/** 极速引擎门面：按配置构建决策后端，向 RunManager/路由提供运行器与可用状态。 */

import type { Page } from "playwright";
import { getFastEngineConfig, getModelConfig, loadAutomationConfig } from "./config-store.js";
import {
  createJevBackend,
  createLayaBackend,
  createOpenAiBackend,
  createOpenAiTextWriter,
  type FastDecisionBackend,
  type FastTextWriter,
} from "./fast/decision-backend.js";
import { createPlaywrightAdapter, runFastAct, type FastLoopResult } from "./fast/fast-loop.js";
import type { FastDecision } from "./fast/decision-backend.js";
import type { FastSnapshot } from "./fast/snapshot.js";

export type FastActRunner = (
  goal: string,
  page: Page,
  opts?: { onDecision?: (decision: FastDecision, snapshot: FastSnapshot) => void },
) => Promise<FastLoopResult>;

export type FastEngineState =
  | { available: true; backendName: string }
  | { available: false; reason: string };

function buildBackend(): { backend: FastDecisionBackend; textWriter?: FastTextWriter } | null {
  const config = getFastEngineConfig();
  if (config.backend === "off") return null;
  if (config.backend === "laya") {
    if (!config.layaBaseUrl) return null;
    return { backend: createLayaBackend({ baseUrl: config.layaBaseUrl }) };
  }
  if (config.backend === "jev") {
    if (!config.jevHasApiKey) return null;
    const full = loadJevKey();
    if (!full) return null;
    const backend = createJevBackend({ apiKey: full, baseUrl: config.jevBaseUrl });
    // Jev 决策与填值分离：文本写手复用视觉模型配置（OpenAI 兼容）
    const model = getModelConfig();
    const textWriter = model.hasApiKey
      ? createOpenAiTextWriter({ baseUrl: model.baseUrl, apiKey: loadModelKey() ?? "", model: model.modelName })
      : undefined;
    return { backend, textWriter };
  }
  // openai：复用视觉模型配置做文本决策
  const model = getModelConfig();
  const key = loadModelKey();
  if (!model.baseUrl || !key || !model.modelName) return null;
  const backend = createOpenAiBackend({ baseUrl: model.baseUrl, apiKey: key, model: model.modelName });
  return { backend };
}

/** apiKey 不进视图层，运行器内部从配置/环境直读。 */
function loadModelKey(): string | null {
  return process.env.MIDSCENE_MODEL_API_KEY ?? null;
}

function loadJevKey(): string | null {
  // jevApiKey 只保存在配置文件（不映射到环境变量、不进任何视图）
  return loadAutomationConfig().fastEngine?.jevApiKey ?? null;
}

export function getFastEngineState(): FastEngineState {
  const config = getFastEngineConfig();
  if (config.mode === "visual") return { available: false, reason: "模式为 visual（未启用极速引擎）" };
  if (config.backend === "off") return { available: false, reason: "后端为 off" };
  if (config.backend === "laya") {
    return layaSidecarState(config.layaBaseUrl);
  }
  const built = buildBackend();
  if (!built) {
    return {
      available: false,
      reason: config.backend === "jev" ? "未配置 Jev API Key" : "视觉模型配置不完整（openai 后端复用其配置）",
    };
  }
  return { available: true, backendName: built.backend.name };
}

// sidecar 健康探测：缓存 30s、后台刷新、不阻塞状态查询
let layaProbeCache: { at: number; baseUrl: string; state: FastEngineState } | null = null;

function layaSidecarState(baseUrl: string): FastEngineState {
  const now = Date.now();
  if (!layaProbeCache || layaProbeCache.baseUrl !== baseUrl || now - layaProbeCache.at > 30_000) {
    void probeLayaSidecar(baseUrl);
  }
  return layaProbeCache?.baseUrl === baseUrl
    ? layaProbeCache.state
    : { available: false, reason: "sidecar 探测中…" };
}

async function probeLayaSidecar(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
    const payload = (await response.json()) as { ok?: boolean; loaded?: boolean; checkpoint?: string; error?: string };
    layaProbeCache = {
      at: Date.now(),
      baseUrl,
      state: payload.ok && payload.loaded
        ? { available: true, backendName: `laya(${payload.checkpoint ?? "local"})` }
        : { available: false, reason: payload.error ? `sidecar 模型未加载: ${payload.error}` : "sidecar 模型加载中或未就绪" },
    };
  } catch (error) {
    layaProbeCache = {
      at: Date.now(),
      baseUrl,
      state: { available: false, reason: `sidecar 不可达（${baseUrl}）：${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/** act 指令的极速执行器；不可用时返回 null（由调用方走视觉引擎）。 */
export function getFastRunner(): FastActRunner | null {
  const config = getFastEngineConfig();
  if (config.mode === "visual") return null;
  const built = buildBackend();
  if (!built) return null;
  return async (goal, page, opts) => {
    const adapter = createPlaywrightAdapter(page);
    return runFastAct(goal, adapter, {
      backend: built.backend,
      textWriter: built.textWriter,
      onDecision: opts?.onDecision,
      // 采集回放帧：极速路径绕过 Midscene agent，过程证据由我们自己生成（fast-replay）
      captureFrames: true,
    });
  };
}
