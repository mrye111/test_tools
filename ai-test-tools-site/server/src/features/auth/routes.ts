/** auth 路由：注册/登录/登出/改密 + 管理员用户管理 + 个人偏好。错误统一走 AppError → 全局处理器。 */

import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import rateLimit from "express-rate-limit";
import type { Express, Request, Response } from "express";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "../../app-error.js";
import { requireAdmin } from "./middleware.js";
import type { AuthStore } from "./repository.js";
import { toUserView, type UserView } from "./types.js";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const PREF_KEY_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const PASSWORD_MIN = 15;
const PASSWORD_MAX = 64;

/** 常见泄露口令小黑名单（离线最小集；完整泄露库接入留待运维层）。 */
const LEAKED_PASSWORDS = new Set([
  "123456789012345",
  "passwordpassword",
  "qwertyuiopasdfghjkl",
  "aaaaaaaaaaaaaaaa",
  "letmeinletmein123",
]);

/** per-账号失败计数 + 指数退避（≥3 次失败起 1s→2s→…→300s 封顶；到点自动解除，不硬锁）。
 * 防定向软锁（审查 M-3）：15 分钟无失败则计数衰减归零；**密码校验正确一律放行**，退避只拦错误密码。 */
const loginFailures = new Map<string, { fails: number; lockedUntil: number; lastFailAt: number }>();

const LOGIN_FAIL_DECAY_MS = 15 * 60 * 1000;

function assertUsername(value: unknown): string {
  const username = typeof value === "string" ? value.trim() : "";
  if (!USERNAME_RE.test(username)) throw badRequest("用户名须为 3–32 位字母/数字/下划线/中划线");
  return username;
}

function assertPassword(value: unknown): string {
  const password = typeof value === "string" ? value : "";
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw badRequest(`密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 字符`);
  }
  if (LEAKED_PASSWORDS.has(password.toLowerCase())) {
    throw badRequest("该密码出现在常见泄露口令中，请更换");
  }
  return password;
}

function csrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve) => {
    req.session?.destroy(() => resolve());
  });
}

function checkLoginLock(username: string): void {
  const entry = loginFailures.get(username);
  if (entry && entry.lockedUntil > Date.now()) {
    const seconds = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    throw new AppError({ code: "RATE_LIMITED", message: `尝试过于频繁，请 ${seconds} 秒后再试`, httpStatus: 429 });
  }
}

function recordLoginFailure(username: string): void {
  const entry = loginFailures.get(username) ?? { fails: 0, lockedUntil: 0, lastFailAt: 0 };
  const now = Date.now();
  if (now - entry.lastFailAt > LOGIN_FAIL_DECAY_MS) entry.fails = 0; // 15 分钟无失败则衰减归零
  entry.lastFailAt = now;
  entry.fails += 1;
  if (entry.fails >= 3) {
    const backoffMs = Math.min(2 ** (entry.fails - 3) * 1000, 300_000);
    entry.lockedUntil = now + backoffMs;
  }
  loginFailures.set(username, entry);
}

function clearLoginFailures(username: string): void {
  loginFailures.delete(username);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "尝试过于频繁，请稍后再试" } },
});

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

async function registrationOpen(store: AuthStore): Promise<boolean> {
  return (await store.getSetting("registration_open")) !== "0";
}

function mePayload(user: UserView, req: Request) {
  return { success: true, user, csrfToken: req.session?.csrfToken ?? "" };
}

/** 首个注册用户自动管理员（并发安全）：插入后回查首行，仅真正的首行自我提升（审查 M-2）。 */
async function promoteIfFirstUser(store: AuthStore, user: { id: string; isAdmin: boolean }): Promise<void> {
  const users = await store.listUsers();
  const first = [...users].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
  if (first && first.id === user.id) {
    await store.updateUser(user.id, { isAdmin: true });
    user.isAdmin = true;
  }
}

export function registerAuthRoutes(app: Express, store: AuthStore): void {
  // ── 公开入口（default-deny 白名单）────────────────────────────────────────
  app.post("/api/auth/register", authLimiter, async (req, res: Response) => {
    const username = assertUsername(req.body?.username);
    const password = assertPassword(req.body?.password);

    const existingCount = await store.countUsers();
    // 首个用户自动成为管理员；系统无用户时即便开关已关也放行（防空锁死）
    if (existingCount > 0 && !(await registrationOpen(store))) {
      throw forbidden("注册已关闭，请联系管理员创建账号");
    }

    const user = await store.createUser({
      username,
      passwordHash: await hashPassword(password),
      isAdmin: false,
    });
    await promoteIfFirstUser(store, user);

    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.loginAt = Date.now();
    req.session.csrfToken = csrfToken();
    res.status(201).json(mePayload(toUserView(user), req));
  });

  app.post("/api/auth/login", authLimiter, async (req, res: Response) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    const user = await store.findUserByName(username);
    const invalid = unauthorized("用户名或密码错误");
    if (!user) {
      recordLoginFailure(username);
      throw invalid;
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      recordLoginFailure(username);
      checkLoginLock(username); // 退避只拦错误密码
      throw invalid;
    }
    // 密码正确一律放行（含退避窗口内）——防持续故意失败把真实用户锁死（审查 M-3）
    clearLoginFailures(username);
    if (user.disabled) {
      throw forbidden("账号已停用");
    }

    // needsRehash 升级：参数迭代后旧哈希在下次登录时透明重算
    if (argon2.needsRehash(user.passwordHash)) {
      await store.updateUser(user.id, { passwordHash: await hashPassword(password) });
    }

    await regenerateSession(req); // 会话固定防护
    req.session.userId = user.id;
    req.session.loginAt = Date.now();
    req.session.csrfToken = csrfToken();
    res.json(mePayload(toUserView(user), req));
  });

  // ── 登录态基础 ───────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (req, res) => {
    clearLoginFailures(req.authUser?.username ?? "");
    await destroySession(req);
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json(mePayload(req.authUser as UserView, req));
  });

  app.post("/api/me/password", async (req, res) => {
    const user = req.authUser as UserView;
    const current = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const next = assertPassword(req.body?.newPassword);

    const record = await store.findUserById(user.id);
    if (!record || !(await verifyPassword(record.passwordHash, current))) {
      throw unauthorized("当前密码不正确");
    }
    await store.updateUser(user.id, { passwordHash: await hashPassword(next) });
    res.json({ success: true });
  });

  // ── 管理员：用户管理（五能力：注册开关/列表/建号/停用启用/重置密码）──────
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    const users = await store.listUsers();
    res.json({ success: true, users: users.map(toUserView) });
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    const username = assertUsername(req.body?.username);
    const password = assertPassword(req.body?.password);
    if (await store.findUserByName(username)) throw conflict("用户名已存在");
    const user = await store.createUser({ username, passwordHash: await hashPassword(password), isAdmin: false });
    res.status(201).json({ success: true, user: toUserView(user) });
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const admin = req.authUser as UserView;
    const target = await store.findUserById(String(req.params.id));
    if (!target) throw notFound("用户不存在");

    const patch: { passwordHash?: string; disabled?: boolean } = {};
    if (req.body?.disabled !== undefined) {
      const disabled = Boolean(req.body.disabled);
      if (disabled && target.id === admin.id) throw badRequest("不能停用自己的账号");
      patch.disabled = disabled;
    }
    if (req.body?.newPassword !== undefined) {
      patch.passwordHash = await hashPassword(assertPassword(req.body.newPassword));
    }
    await store.updateUser(target.id, patch);
    const updated = await store.findUserById(target.id);
    res.json({ success: true, user: toUserView(updated as Exclude<typeof updated, null>) });
  });

  app.get("/api/admin/registration", requireAdmin, async (_req, res) => {
    res.json({ success: true, open: await registrationOpen(store) });
  });

  app.put("/api/admin/registration", requireAdmin, async (req, res) => {
    if (typeof req.body?.open !== "boolean") throw badRequest("open 须为布尔值");
    await store.setSetting("registration_open", req.body.open ? "1" : "0");
    res.json({ success: true, open: req.body.open });
  });

  // ── 个人偏好（挂用户；入口地址记忆等小偏好）────────────────────────────────
  app.get("/api/preferences/:key", async (req, res) => {
    const key = req.params.key;
    if (!PREF_KEY_RE.test(key)) throw badRequest("偏好键名非法");
    const user = req.authUser as UserView;
    res.json({ success: true, value: (await store.getPreference(user.id, key)) ?? null });
  });

  app.put("/api/preferences/:key", async (req, res) => {
    const key = req.params.key;
    if (!PREF_KEY_RE.test(key)) throw badRequest("偏好键名非法");
    const value = req.body?.value;
    if (typeof value !== "string" || value.length > 2048) throw badRequest("偏好值须为不超过 2048 字符的字符串");
    const user = req.authUser as UserView;
    await store.setPreference(user.id, key, value);
    res.json({ success: true });
  });
}

/** 生成新用户 id（供测试与内部使用）。 */
export function newId(): string {
  return randomUUID();
}
