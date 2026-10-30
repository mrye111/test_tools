---
title: 认证与会话管理实践调研
type: research
status: closed
assignee: agent-research-01
blocked_by: []
---

## Question

调研 Express（TypeScript、ESM）服务端「账号密码登录」的现行工程实践，给出推荐组合与权衡表，供票据 07 锁定：

1. **密码哈希**：argon2id vs bcrypt vs scrypt——安全参数、Node 库选型（`node:crypto` scrypt / argon2 / bcryptjs）、Windows 开发环境的安装坑
2. **会话形态**：httpOnly Cookie Session vs 无状态 JWT——CSRF 防护差异、服务端会话落 MySQL 的方式与过期/续期、多标签页与并发请求行为
3. **登录防护**：登录/注册限速、防爆破、密码强度校验的现行惯例
4. **生态选型**：Passport.js vs 手写中间件 vs 其他（lucia 等）在小团队内网工具规模下的推荐

产出：推荐栈 + 明确权衡。资料以官方文档与主流库仓库为准。

## Resolution

**推荐栈**：密码哈希用 npm `argon2@0.45`（Argon2id，默认参数 m=64 MiB/t=3/p=4，`needsRehash` 升级；Windows x64 预编译免装 VS Build Tools）；会话用 `express-session@1.19` + `express-mysql-session@3.0` 的 httpOnly Cookie 服务端会话（`__Host-` 前缀、SameSite=Lax、登录 `regenerate()`、登出 `destroy()`、rolling 滑动续期 + 8h 绝对上限）；CSRF 用同步器令牌（X-CSRF-Token 头）+ SameSite + Origin 校验（csurf 已归档勿用）；登录防护用 `express-rate-limit@8` per-IP + per-username 双层失败限速 + 指数退避，密码策略按 NIST SP 800-63B-4（15–64 字符、禁复杂度组合、泄露口令黑名单）；生态选手写薄中间件（约 200–400 行），不引 Passport。

**关键权衡**（各一条）：

- 哈希：argon2id 抗 GPU 最强且为 OWASP 首选；bcrypt 有 72 字节截断与 Windows 原生编译坑仅作 legacy；`node:crypto` scrypt 有默认 maxmem=32 MiB 的坑，只作零依赖退路。
- 会话：Cookie 服务端会话可即时吊销（登出/封禁），JWT 自包含令牌做不到且多标签页 refresh 轮换有竞态——JWT 留给未来跨服务 API。
- 限速：只限 IP 会被分布式爆破绕过，必须叠 per-账号失败计数 + 指数退避；硬锁定账户有被恶意锁死的 DoS 风险。
- 生态：Passport 低维护且无官方 TS/ESM，单策略场景是纯抽象税；lucia 已于 2025-03 弃用（官方示范即手写会话）；better-auth 为将来要 2FA/OAuth 时的备选重框架。

详细依据见 [research/01-auth-session-practices.md](../research/01-auth-session-practices.md)
