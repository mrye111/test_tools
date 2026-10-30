---
title: 认证技术选型锁定
type: grilling
status: closed
assignee: claude
blocked_by: [01, 04]
---

## Question

吃研究票《认证与会话管理实践调研》的实践结论与政策票《登录/注册交互与政策》的定稿，拍板锁定认证技术栈（HITL）：

- 密码哈希方案与参数
- 会话形态（cookie session / JWT）与会话存储表
- CSRF 防护
- 登录 / 注册限速的落位
- 相关依赖清单（含 Windows 开发环境注意事项）

产出：可直接写进 spec 的技术决定段落。

## Resolution

三题逐项拍板后经用户确认，认证技术栈锁定如下：

1. **哈希 + 会话**：npm `argon2`（Argon2id，默认参数 m=64MiB/t=3/p=4，`needsRehash` 自动升级）；`express-session` + `express-mysql-session` 的 httpOnly Cookie 服务端会话（会话落 MySQL）——`__Host-` 前缀、SameSite=Lax、登录 `regenerate()`、登出 `destroy()`、滑动续期 + 8h 绝对上限。选 Cookie 服务端会话的决定性理由：票 04 定稿的「停用账号」需要**即时吊销**（登出/停用立刻生效），JWT 自包含令牌做不到。
2. **CSRF + 限速**：同步器令牌（`X-CSRF-Token` 头）+ `SameSite=Lax` + `Origin` 校验三件套（`csurf` 已于 2025-05 归档，自研薄实现）；`express-rate-limit` 双层限速（per-IP + per-账号失败计数）+ 指数退避；**不硬锁账户**（防恶意输错密码锁死他人的 DoS）。
3. **生态与依赖**：手写薄认证中间件（约 200–400 行），不引 Passport（低维护、无官方 TS/ESM、单策略抽象税）/ better-auth（留给未来 2FA/OAuth，已出局本期）。依赖清单四件：`argon2`、`express-session`、`express-mysql-session`、`express-rate-limit`。Windows 开发环境 `argon2` 走 x64 预编译、无需 VS Build Tools。

与票 04 的衔接：密码策略沿用 NIST SP 800-63B-4（15–64 字符、禁组合、泄露黑名单）；管理员建号/重置出的初始密码走同一哈希管线。详细依据见 [research/01-auth-session-practices.md](../research/01-auth-session-practices.md)。
