/** 鉴权面：default-deny 会话门禁 + 免登白名单 + MCP token + CSRF 三件套 + 管理员标记。 */

import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "../../logger.js";
import type { AuthStore } from "./repository.js";
import { toUserView, type UserView } from "./types.js";

declare module "express-serve-static-core" {
  interface Request {
    authUser?: UserView;
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    /** 登录时刻（epoch ms）：8h 绝对上限的锚点，登录/注册时写入。 */
    loginAt?: number;
  }
}

/** 会话绝对寿命：登录后 8h 强制过期（滑动续期由 session rolling 负责，到期不续）。 */
export const SESSION_ABSOLUTE_MAX_MS = 8 * 60 * 60 * 1000;

export function isSessionExpired(loginAt: number | undefined, now = Date.now()): boolean {
  return typeof loginAt !== "number" || now - loginAt > SESSION_ABSOLUTE_MAX_MS;
}

/** 免登白名单：探针与登录入口。本 API 服务不托管前端静态资源，静态免登由部署层（nginx/CDN）承担。 */
const PUBLIC_PATHS = new Set(["/health", "/api/auth/register", "/api/auth/login"]);

/** MCP 机器端点：免会话，但配了 MCP_TOKEN 就必须带 token。 */
const MCP_PATHS = new Set(["/sse", "/messages", "/rpc"]);

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 登录/注册无会话可挂同步器令牌，以 Origin 校验兜底（随包红线之外的既有约定）。 */
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/register", "/api/auth/login"]);

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function errorBody(code: string, message: string) {
  return { success: false, error: { code, message } };
}

function isMutating(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/** Origin 校验：带 Origin 的修改型请求必须同源（浏览器恒带 Origin；非浏览器客户端不带则放行）。 */
function originMismatch(req: Request): boolean {
  const origin = req.header("origin");
  if (!origin) return false;
  const host = req.header("host");
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export type AuthGateOptions = {
  store: AuthStore;
};

/**
 * default-deny 门禁：置于全部业务路由之前，白名单显式跳过，新增路由自动入保。
 * 401 UNAUTHORIZED（未登录/会话过期/账号停用同码）；403 FORBIDDEN / 403 CSRF_INVALID。
 */
export function createAuthGate(options: AuthGateOptions): RequestHandler {
  let mcpWarned = false;
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;

    if (isMutating(req.method) && originMismatch(req)) {
      res.status(403).json(errorBody("CSRF_INVALID", "跨站请求被拒绝"));
      return;
    }

    if (PUBLIC_PATHS.has(path)) {
      next();
      return;
    }

    if (MCP_PATHS.has(path)) {
      const expected = process.env.MCP_TOKEN?.trim();
      if (!expected) {
        // fail-closed：未配置 token 即禁用 MCP 端点（防生产忘配 = 内网裸奔）。
        // 开发放行须显式 MCP_TOKEN_OPEN=1（逃逸开关，语义醒目）。
        if (process.env.MCP_TOKEN_OPEN === "1") {
          if (!mcpWarned) {
            mcpWarned = true;
            logger.error("MCP_TOKEN 未配置但 MCP_TOKEN_OPEN=1 已显式放行 MCP 端点——仅限开发环境");
          }
          next();
          return;
        }
        res.status(503).json(errorBody("MCP_TOKEN_UNSET", "MCP_TOKEN 未配置，MCP 端点已禁用（开发放行请显式设置 MCP_TOKEN_OPEN=1）"));
        return;
      }
      const authorization = req.header("authorization") ?? "";
      const provided = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : (req.header("x-mcp-token") ?? "");
      if (!safeEqual(provided, expected)) {
        res.status(401).json(errorBody("UNAUTHORIZED", "MCP token 无效"));
        return;
      }
      next();
      return;
    }

    const userId = req.session?.userId;
    if (!userId || isSessionExpired(req.session?.loginAt)) {
      // 未登录 / 超过 8h 绝对上限：销毁会话并拒绝（401 同码）
      if (userId) req.session?.destroy(() => undefined);
      res.status(401).json(errorBody("UNAUTHORIZED", "未登录或会话已过期"));
      return;
    }

    if (isMutating(req.method) && !CSRF_EXEMPT_PATHS.has(path)) {
      const headerToken = req.header("x-csrf-token") ?? "";
      const sessionToken = req.session?.csrfToken ?? "";
      if (!sessionToken || !safeEqual(headerToken, sessionToken)) {
        res.status(403).json(errorBody("CSRF_INVALID", "CSRF 校验失败"));
        return;
      }
    }

    // 每请求回源校验用户：停用即时生效（会话吊销语义），顺带拿到最新管理员标记
    void options.store
      .findUserById(userId)
      .then((user) => {
        if (!user || user.disabled) {
          req.session?.destroy(() => undefined);
          res.status(401).json(errorBody("UNAUTHORIZED", "未登录或会话已过期"));
          return;
        }
        req.authUser = toUserView(user);
        next();
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "鉴权查询用户失败");
        res.status(500).json(errorBody("INTERNAL", "鉴权服务不可用"));
      });
  };
}

/** 管理员标记：挂载在管理路由，越权返回 403 FORBIDDEN。 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.authUser?.isAdmin) {
    res.status(403).json(errorBody("FORBIDDEN", "需要管理员权限"));
    return;
  }
  next();
};
