/**
 * 云端模型配置路由：挂用户的 CRUD + 乐观锁 + 密钥掩码 + 服务端代发测试连接。
 * 密钥写入时加密（信封）、只回掩码、留空不变；测试连接密钥不出服务端。
 */

import type { Express, Request, Response } from "express";
import { badRequest, conflict, notFound } from "../../app-error.js";
import { parseAiRequestConfig, testAiConnection } from "../testcase/ai.js";
import { redactSecrets } from "../../shared/redact.js";
import type { AuthStore } from "./repository.js";
import { modelConfigConflict } from "./repository.js";
import type { SecretCrypto } from "../../shared/secret-crypto.js";
import {
  CONFIG_FORBIDDEN_KEYS,
  maskSecret,
  pickConfigPayload,
  toConfigView,
  type CloudModelConfigRecord,
  type UserView,
} from "./types.js";

type SplitBody = {
  payload: Record<string, unknown>;
  apiKey?: string;
  version?: number;
};

/** 平铺 body → payload（白名单构造；密钥/版本显式处理；api_key/key 等别名直接拒绝，防明文混入）。 */
function splitConfigBody(body: unknown): SplitBody {
  if (!body || typeof body !== "object") throw badRequest("请求体须为对象");
  const source = body as Record<string, unknown>;
  for (const forbidden of CONFIG_FORBIDDEN_KEYS) {
    const value = source[forbidden];
    if (typeof value === "string" && value.trim()) {
      throw badRequest(`字段 ${forbidden} 不允许直接提交：密钥请用 apiKey，掩码/版本由服务端管理`);
    }
  }
  const payload = pickConfigPayload(source);
  if (typeof payload.baseUrl !== "string" || !payload.baseUrl.trim()) throw badRequest("baseUrl 必填");
  if (typeof payload.model !== "string" || !payload.model.trim()) throw badRequest("model 必填");
  const result: SplitBody = { payload };
  const apiKey = source.apiKey;
  if (apiKey !== undefined && apiKey !== null) {
    if (typeof apiKey !== "string") throw badRequest("apiKey 须为字符串");
    if (apiKey.trim()) result.apiKey = apiKey.trim(); // 留空 = 不变
  }
  if (source.version !== undefined) {
    const parsed = Number(source.version);
    if (!Number.isInteger(parsed) || parsed < 1) throw badRequest("version 须为正整数");
    result.version = parsed;
  }
  return result;
}

function requireVersion(body: SplitBody): number {
  if (body.version === undefined) throw badRequest("缺少 version（乐观锁并发保护）");
  return body.version;
}

export function registerCloudModelConfigRoutes(
  app: Express,
  store: AuthStore,
  secret: SecretCrypto,
): void {
  const currentUser = (req: Request): UserView => req.authUser as UserView;

  /** 服务端代发测试连接：密钥只在本函数内瞬时驻留，出站错误统一 redact。 */
  async function runTestConnection(payload: Record<string, unknown>, plainKey: string): Promise<void> {
    const config = parseAiRequestConfig({
      baseUrl: payload.baseUrl as string,
      model: payload.model as string,
      api_key: plainKey,
      endpoint_type: payload.apiFormat as string,
    });
    try {
      await testAiConnection(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redactSecrets(message, [plainKey, config.apiKey]));
    }
  }

  function keyOf(record: CloudModelConfigRecord, override?: string): string {
    if (override !== undefined && override !== "") return override;
    if (record.apiKeyEnc) return secret.decrypt(record.apiKeyEnc);
    return "";
  }

  app.get("/api/model-configs", async (req, res) => {
    const records = await store.listModelConfigs(currentUser(req).id);
    res.json({ success: true, configs: records.map(toConfigView) });
  });

  app.post("/api/model-configs", async (req, res: Response) => {
    const body = splitConfigBody(req.body);
    const record = await store.createModelConfig(currentUser(req).id, {
      payload: body.payload,
      apiKeyEnc: body.apiKey ? secret.encrypt(body.apiKey) : null,
      apiKeyMask: body.apiKey ? maskSecret(body.apiKey) : null,
    });
    res.status(201).json({ success: true, config: toConfigView(record) });
  });

  /** 未保存配置的测试连接（编辑态直接试连）。 */
  app.post("/api/model-configs/test", async (req, res) => {
    const body = splitConfigBody(req.body);
    let plainKey = body.apiKey ?? "";
    if (!plainKey && typeof req.body?.id === "string") {
      const record = await store.getModelConfig(currentUser(req).id, req.body.id);
      if (record) plainKey = keyOf(record);
    }
    await runTestConnection(body.payload, plainKey);
    res.json({ success: true });
  });

  app.post("/api/model-configs/:id/test", async (req, res) => {
    const record = await store.getModelConfig(currentUser(req).id, req.params.id);
    if (!record) throw notFound("配置不存在");
    await runTestConnection(record.payload, keyOf(record, typeof req.body?.apiKey === "string" ? req.body.apiKey : undefined));
    res.json({ success: true });
  });

  app.put("/api/model-configs/:id", async (req, res: Response) => {
    const body = splitConfigBody(req.body);
    const expected = requireVersion(body);
    const existing = await store.getModelConfig(currentUser(req).id, req.params.id);
    if (!existing) throw notFound("配置不存在");

    const patch: { payload: Record<string, unknown>; apiKeyEnc?: string | null; apiKeyMask?: string | null } = {
      payload: body.payload,
    };
    if (body.apiKey) {
      patch.apiKeyEnc = secret.encrypt(body.apiKey);
      patch.apiKeyMask = maskSecret(body.apiKey);
    }
    try {
      const updated = await store.updateModelConfig(currentUser(req).id, req.params.id, patch, expected);
      res.json({ success: true, config: toConfigView(updated) });
    } catch (error) {
      if ((error as { code?: string }).code === "MODEL_CONFIG_CONFLICT") {
        throw conflict((error as Error).message);
      }
      throw error;
    }
  });

  app.delete("/api/model-configs/:id", async (req, res) => {
    await store.deleteModelConfig(currentUser(req).id, req.params.id);
    res.json({ success: true });
  });
}

export { modelConfigConflict, badRequest };
