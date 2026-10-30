/** auth 域集成测试：门禁 / 注册登录 / CSRF / 管理员 / 偏好 / 云端模型配置（内存存储 + 真会话中间件）。 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { createSessionMiddleware } from "./migrate.js";
import { createAuthGate, requireAdmin } from "./middleware.js";
import { registerAuthRoutes } from "./routes.js";
import { registerCloudModelConfigRoutes } from "./model-config-routes.js";
import { MemoryAuthStore } from "./repository.js";
import { createSecretCrypto, type SecretCrypto } from "../../shared/secret-crypto.js";

let server: Server;
let base: string;
let store: MemoryAuthStore;
let secret: SecretCrypto;

const SESSION_SECRET = "test-session-secret";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

beforeAll(async () => {
  store = new MemoryAuthStore();
  secret = createSecretCrypto({ masterKeyBase64: MASTER_KEY });

  const app = express();
  app.use(express.json());
  app.use(createSessionMiddleware({ sessionSecret: SESSION_SECRET }));
  app.use(createAuthGate({ store }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/rpc", (_req, res) => res.json({ ok: "mcp" }));
  // 未登记的新路由：验证 default-deny 自动入保
  app.get("/api/brand-new-route", (_req, res) => res.json({ ok: true }));
  // 管理员示例路由
  app.get("/api/admin/ping", requireAdmin, (_req, res) => res.json({ ok: true }));

  registerAuthRoutes(app, store);
  registerCloudModelConfigRoutes(app, store, secret);

  // 全局错误处理（与 express-app 同形）：AppError → {success:false, error:{code,message}}
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err && typeof err === "object" && "httpStatus" in err && "code" in err) {
      const appErr = err as { code: string; httpStatus: number; message: string };
      res.status(appErr.httpStatus).json({ success: false, error: { code: appErr.code, message: appErr.message } });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: { code: "INTERNAL", message } });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

type ApiResult = { status: number; body: Record<string, unknown>; cookie: string | null };

async function api(path: string, init: RequestInit & { cookie?: string; csrf?: string } = {}): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.csrf) headers["x-csrf-token"] = init.csrf;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie };
}

type Session = { cookie: string; csrf: string };

async function registerUser(username: string, password: string): Promise<Session> {
  const res = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) });
  expect(res.status).toBe(201);
  const cookie = res.cookie ?? "";
  const csrf = String((res.body.csrfToken as string) ?? "");
  return { cookie, csrf };
}

async function loginUser(username: string, password: string): Promise<Session> {
  const res = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  expect(res.status).toBe(200);
  return { cookie: res.cookie ?? "", csrf: String(res.body.csrfToken ?? "") };
}

const PW = "correct-horse-battery-1";
const PW2 = "correct-horse-battery-2";

describe("门禁 default-deny", () => {
  it("未登录访问未知新路由自动入保 → 401 UNAUTHORIZED", async () => {
    const res = await api("/api/brand-new-route");
    expect(res.status).toBe(401);
    expect((res.body.error as { code: string }).code).toBe("UNAUTHORIZED");
  });

  it("health 免登", async () => {
    expect((await api("/health")).status).toBe(200);
  });

  it("MCP 端点未配置 MCP_TOKEN 时 fail-closed（503），MCP_TOKEN_OPEN=1 显式放行", async () => {
    delete process.env.MCP_TOKEN;
    delete process.env.MCP_TOKEN_OPEN;
    const closed = await api("/rpc", { method: "POST", body: "{}" });
    expect(closed.status).toBe(503);
    expect((closed.body.error as { code: string }).code).toBe("MCP_TOKEN_UNSET");
    process.env.MCP_TOKEN_OPEN = "1";
    try {
      expect((await api("/rpc", { method: "POST", body: "{}" })).status).toBe(200);
    } finally {
      delete process.env.MCP_TOKEN_OPEN;
    }
  });

  it("MCP 端点配置 MCP_TOKEN 后必须带 token（401/200）", async () => {
    process.env.MCP_TOKEN = "mcp-secret";
    try {
      expect((await api("/rpc", { method: "POST", body: "{}" })).status).toBe(401);
      const ok = await api("/rpc", {
        method: "POST",
        body: "{}",
        headers: { authorization: "Bearer mcp-secret" },
      });
      expect(ok.status).toBe(200);
    } finally {
      delete process.env.MCP_TOKEN;
    }
  });
});

describe("注册 / 登录", () => {
  it("首个注册用户自动成为管理员", async () => {
    const s = await registerUser("admin1", PW);
    const me = await api("/api/auth/me", { cookie: s.cookie });
    expect((me.body.user as { isAdmin: boolean }).isAdmin).toBe(true);
  });

  it("第二个注册用户为普通用户；密码过短 400", async () => {
    const s = await registerUser("user1", PW);
    const me = await api("/api/auth/me", { cookie: s.cookie });
    expect((me.body.user as { isAdmin: boolean }).isAdmin).toBe(false);
    expect((await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: "user9", password: "short" }) })).status).toBe(400);
  });

  it("登录错密码 401；第 3 次失败起指数退避 429", async () => {
    const bad = { method: "POST", body: JSON.stringify({ username: "user1", password: "wrong-password-xxx" }) };
    expect((await api("/api/auth/login", bad)).status).toBe(401);
    expect((await api("/api/auth/login", bad)).status).toBe(401);
    // 第 3 次失败：记录后即进退避窗口（退避只拦错误密码，正确密码仍放行——见 M-3 回归）
    expect((await api("/api/auth/login", bad)).status).toBe(429);
    const locked = await api("/api/auth/login", bad);
    expect(locked.status).toBe(429);
    expect((locked.body.error as { code: string }).code).toBe("RATE_LIMITED");
    // 换用户名不受他人退避影响
    expect((await loginUser("admin1", PW)).csrf).toBeTruthy();
  });

  it("登录成功后可访问 me；登出后 401", async () => {
    const s = await loginUser("admin1", PW);
    expect((await api("/api/auth/me", { cookie: s.cookie })).status).toBe(200);
    const out = await api("/api/auth/logout", { method: "POST", body: "{}", cookie: s.cookie, csrf: s.csrf });
    expect(out.status).toBe(200);
    expect((await api("/api/auth/me", { cookie: s.cookie })).status).toBe(401);
  });
});

describe("CSRF 三件套", () => {
  it("修改型请求缺 CSRF 头 → 403 CSRF_INVALID；带正确 token 过", async () => {
    const s = await loginUser("admin1", PW);
    const noToken = await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: PW, newPassword: PW2 }),
      cookie: s.cookie,
    });
    expect(noToken.status).toBe(403);
    expect((noToken.body.error as { code: string }).code).toBe("CSRF_INVALID");

    // 带 token：先把密码改回去验证通路
    const ok = await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: PW, newPassword: PW2 }),
      cookie: s.cookie,
      csrf: s.csrf,
    });
    expect(ok.status).toBe(200);
    await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: PW2, newPassword: PW }),
      cookie: s.cookie,
      csrf: s.csrf,
    });
  });

  it("跨 Origin 修改型请求 → 403 CSRF_INVALID", async () => {
    const s = await loginUser("admin1", PW);
    const res = await api("/api/preferences/pref-x", {
      method: "PUT",
      body: JSON.stringify({ value: "v" }),
      cookie: s.cookie,
      csrf: s.csrf,
      headers: { origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
  });
});

describe("管理员能力（五件套）", () => {
  it("非管理员打管理路由 → 403 FORBIDDEN", async () => {
    await registerUser("user2", PW);
    const s = await loginUser("user2", PW);
    const res = await api("/api/admin/users", { cookie: s.cookie });
    expect(res.status).toBe(403);
    expect((res.body.error as { code: string }).code).toBe("FORBIDDEN");
  });

  it("注册开关：关闭后注册 403，重开恢复", async () => {
    const admin = await loginUser("admin1", PW);
    await api("/api/admin/registration", { method: "PUT", body: JSON.stringify({ open: false }), cookie: admin.cookie, csrf: admin.csrf });
    expect((await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: "user3", password: PW }) })).status).toBe(403);
    await api("/api/admin/registration", { method: "PUT", body: JSON.stringify({ open: true }), cookie: admin.cookie, csrf: admin.csrf });
    expect((await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: "user3", password: PW }) })).status).toBe(201);
  });

  it("管理员建号 + 重置密码（新密码可登录）", async () => {
    const admin = await loginUser("admin1", PW);
    const created = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: "staff1", password: PW }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(created.status).toBe(201);
    const staffId = (created.body.user as { id: string }).id;

    expect((await loginUser("staff1", PW)).csrf).toBeTruthy();
    const reset = await api(`/api/admin/users/${staffId}`, {
      method: "PATCH",
      body: JSON.stringify({ newPassword: PW2 }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(reset.status).toBe(200);
    expect((await loginUser("staff1", PW2)).csrf).toBeTruthy();
  });

  it("停用账号立即吊销其会话；不能停用自己", async () => {
    const admin = await loginUser("admin1", PW);
    const staff = await loginUser("staff1", PW2);
    expect((await api("/api/auth/me", { cookie: staff.cookie })).status).toBe(200);

    // 找到 staff1 的 id 并停用
    const list = await api("/api/admin/users", { cookie: admin.cookie });
    const users = list.body.users as Array<{ id: string; username: string }>;
    const staffId = users.find((u) => u.username === "staff1")!.id;
    const selfId = users.find((u) => u.username === "admin1")!.id;

    const selfDisable = await api(`/api/admin/users/${selfId}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(selfDisable.status).toBe(400);

    const disable = await api(`/api/admin/users/${staffId}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(disable.status).toBe(200);
    // 既有会话立即失效（每请求回源校验）
    expect((await api("/api/auth/me", { cookie: staff.cookie })).status).toBe(401);
  });
});

describe("个人偏好按用户隔离", () => {
  it("两个用户各记各的", async () => {
    await registerUser("prefA", PW);
    await registerUser("prefB", PW);
    const a = await loginUser("prefA", PW);
    const b = await loginUser("prefB", PW);
    await api("/api/preferences/ai-run-entry:s1", { method: "PUT", body: JSON.stringify({ value: "http://a.example" }), cookie: a.cookie, csrf: a.csrf });
    await api("/api/preferences/ai-run-entry:s1", { method: "PUT", body: JSON.stringify({ value: "http://b.example" }), cookie: b.cookie, csrf: b.csrf });
    const ga = await api("/api/preferences/ai-run-entry:s1", { cookie: a.cookie });
    const gb = await api("/api/preferences/ai-run-entry:s1", { cookie: b.cookie });
    expect(ga.body.value).toBe("http://a.example");
    expect(gb.body.value).toBe("http://b.example");
  });
});

describe("云端模型配置", () => {
  it("密钥别名 api_key/key 直接 400（审查 C-1 回归）", async () => {
    const admin = await loginUser("admin1", PW);
    for (const alias of ["api_key", "key"]) {
      const res = await api("/api/model-configs", {
        method: "POST",
        body: JSON.stringify({
          name: "别名试探",
          baseUrl: "http://127.0.0.1:8317",
          model: "m",
          apiFormat: "openai_chat",
          [alias]: "sk-alias-leak",
        }),
        cookie: admin.cookie,
        csrf: admin.csrf,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("sk-alias-leak");
    }
  });

  it("短钥掩码全遮（审查 L-4 回归）", async () => {
    const admin = await loginUser("admin1", PW);
    const created = await api("/api/model-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "短钥",
        baseUrl: "http://127.0.0.1:8317",
        model: "m",
        apiFormat: "openai_chat",
        apiKey: "sk-short",
      }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect((created.body.config as { apiKeyMask: string }).apiKeyMask).toBe("****");
  });

  it("创建只回掩码不回明文；列表同样掩码", async () => {
    const admin = await loginUser("admin1", PW);
    const created = await api("/api/model-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "我的云端配置",
        providerType: "custom",
        baseUrl: "http://127.0.0.1:8317",
        model: "gemini-3.8-flash-high",
        apiFormat: "openai_chat",
        apiKey: "sk-abcdef123456",
      }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(created.status).toBe(201);
    const config = created.body.config as { id: string; apiKeyMask: string; apiKey?: string; version: number };
    expect(config.apiKey).toBeUndefined();
    expect(config.apiKeyMask).toBe("sk***56");
    expect(config.version).toBe(1);
    expect(JSON.stringify(created.body)).not.toContain("sk-abcdef123456");

    const list = await api("/api/model-configs", { cookie: admin.cookie });
    expect(JSON.stringify(list.body)).not.toContain("sk-abcdef123456");
  });

  it("留空 = 保持密钥不变；带新 key 则换", async () => {
    const admin = await loginUser("admin1", PW);
    const list = await api("/api/model-configs", { cookie: admin.cookie });
    const config = (list.body.configs as Array<Record<string, unknown>>).find((item) => item.name === "我的云端配置")!;

    const keep = await api(`/api/model-configs/${config.id}`, {
      method: "PUT",
      body: JSON.stringify({ baseUrl: config.baseUrl, model: config.model, apiFormat: config.apiFormat, name: "改名", version: config.version }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(keep.status).toBe(200);
    expect((keep.body.config as { apiKeyMask: string }).apiKeyMask).toBe("sk***56");

    const replace = await api(`/api/model-configs/${config.id}`, {
      method: "PUT",
      body: JSON.stringify({ baseUrl: config.baseUrl, model: config.model, apiFormat: config.apiFormat, apiKey: "sk-zzzz9999abcdef", version: (keep.body.config as { version: number }).version }),
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect((replace.body.config as { apiKeyMask: string }).apiKeyMask).toBe("sk***ef");
  });

  it("乐观锁：并发旧版本更新 → 409", async () => {
    const admin = await loginUser("admin1", PW);
    const list = await api("/api/model-configs", { cookie: admin.cookie });
    const config = (list.body.configs as Array<Record<string, unknown>>)[0];
    const body = JSON.stringify({ baseUrl: config.baseUrl, model: config.model, apiFormat: config.apiFormat, version: config.version });

    // 第一次用当前版本：成功并把版本推到 +1
    const first = await api(`/api/model-configs/${config.id}`, { method: "PUT", body, cookie: admin.cookie, csrf: admin.csrf });
    expect(first.status).toBe(200);
    // 第二次仍持旧版本：冲突 409
    const stale = await api(`/api/model-configs/${config.id}`, { method: "PUT", body, cookie: admin.cookie, csrf: admin.csrf });
    expect(stale.status).toBe(409);
    expect((stale.body.error as { message: string }).message).toContain("已被其他设备修改");
  });

  it("删除后列表为空；跨用户不可见", async () => {
    const admin = await loginUser("admin1", PW);
    const list = await api("/api/model-configs", { cookie: admin.cookie });
    for (const config of list.body.configs as Array<Record<string, unknown>>) {
      await api(`/api/model-configs/${config.id}`, { method: "DELETE", cookie: admin.cookie, csrf: admin.csrf });
    }
    expect((await api("/api/model-configs", { cookie: admin.cookie })).body.configs).toEqual([]);

    const other = await loginUser("prefA", PW);
    expect((await api("/api/model-configs", { cookie: other.cookie })).body.configs).toEqual([]);
  });
});

describe("遗留整改回归（M-1/M-2/M-3）", () => {
  it("M-2 并发同名注册：恰一个 201，另一个 409", async () => {
    const username = "raceuser";
    const [a, b] = await Promise.all([
      api("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password: PW }) }),
      api("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password: PW }) }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("M-3 退避窗口内密码正确仍放行（软锁只拦错误密码）", async () => {
    await registerUser("lockme", PW);
    const bad = { method: "POST", body: JSON.stringify({ username: "lockme", password: "wrong-password-xxx" }) };
    await api("/api/auth/login", bad);
    await api("/api/auth/login", bad);
    await api("/api/auth/login", bad);
    // 已进退避窗口：错误密码 → 429
    expect((await api("/api/auth/login", bad)).status).toBe(429);
    // 正确密码 → 放行（真实用户不被恶意失败锁死）
    const good = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "lockme", password: PW }) });
    expect(good.status).toBe(200);
  });

  it("M-1 会话绝对上限纯函数语义", async () => {
    const { isSessionExpired, SESSION_ABSOLUTE_MAX_MS } = await import("./middleware.js");
    const now = Date.now();
    expect(isSessionExpired(undefined, now)).toBe(true);
    expect(isSessionExpired(now, now)).toBe(false);
    expect(isSessionExpired(now - SESSION_ABSOLUTE_MAX_MS - 1, now)).toBe(true);
    expect(isSessionExpired(now - SESSION_ABSOLUTE_MAX_MS + 1000, now)).toBe(false);
  });
});
