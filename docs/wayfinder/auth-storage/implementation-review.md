# 实施审查与整改记录（auth-storage）

> 安全/代码审查报告的落盘留存 · 2026-09-28 · 审查基准 spec.md

## 判决与整改状态

| 级别 | 问题 | 状态 |
|---|---|---|
| C-1 | `splitConfigBody` 只剔 `apiKey`，`api_key`/`key` 别名可明文落库回显 | ✅ 已修：payload 白名单（`CONFIG_PAYLOAD_KEYS` 读写双侧）、别名提交 400、云端组装面纵深过滤 |
| C-2 | 密钥剥离只覆盖生效单字段，双字段并存/扁平兜底路径明文落盘 | ✅ 已修：`job-secrets.ts` 全字段扫描剥离（3 别名 × 嵌套/扁平两层），生效那条入加密列；双字段并存回归测试钉住 |
| C-3 | 业务前端客户端未接 CSRF 头与 401 拦截（登录后全部写路径 403） | ✅ 已修：`httpClient.apiFetch` 下沉（内存态 token + 修改型自动附头 + 401 统一拦截跳登录），6 业务模块 55 处裸 fetch 收编；共性契约测试钉住 |
| H-1 | MCP_TOKEN 未配置时 MCP 三端点 fail-open | ✅ 已修：fail-closed（503 `MCP_TOKEN_UNSET`），开发放行须显式 `MCP_TOKEN_OPEN=1` |
| H-2 | 密钥轮换整套缺失，decrypt 无视信封 keyId | ✅ 已修：多密钥 Map + 按 keyId 选钥 + `needsRewrite` 懒重写标记 + `SECRET_MASTER_KEYS` 历史钥注入 + `server/scripts/reencrypt-secrets.mjs` 幂等批量重加密脚本 |
| M-1 | 会话「滑动续期 + 8h 绝对上限」未真正成立（touch 不落库、无 rolling） | ✅ 已修：`loginAt` 写入 + 门禁 `isSessionExpired` 8h 绝对上限销毁 + `rolling: true` 滑动续期 |
| M-2 | 首管理员判定/用户名唯一性并发竞态（双管理员、同名 500） | ✅ 已修：`ER_DUP_ENTRY`→409（MySQL）/ memory 同名抛 conflict、首管理员改为插入后回查首行提升 |
| M-3 | per-账号指数退避可被定向软锁（持续故意失败顶格 300s） | ✅ 已修：失败计数 15 分钟衰减归零；密码校验正确一律放行，退避只拦错误密码 |
| M-4 | 凭据名可覆盖 `NODE_OPTIONS`/`PATH`（→子进程 RCE） | ✅ 已修：`isDeniedCredentialName` 黑名单（写入/应用/删除三侧），路由 400 |
| M-5 | 500 错误透传原始文案（可能内嵌请求体/密钥片段） | ✅ 已修：固定文案出站、`AppError.toJSON` 去 cause、pino redact 日志禁钥 |
| L-1 | 白名单措辞「仅三项」与实现五路径不符 | ✅ 已修：spec 回写（登录/注册为必要豁免） |
| L-2 | Cookie 未用 `__Host-` 前缀（内网 http 妥协） | ⏳ HTTPS 上线后改 `__Host-sid` + `secure:true` |
| L-3 | 泄露口令黑名单仅 5 条合成样例 | ⏳ 待接入真实泄露库（top-N 哈希比对） |
| L-4 | 短钥掩码暴露过多 | ✅ 已修：<12 字符全遮 |
| L-5 | 空明文信封加解密不对称 | ✅ 已修：`body.length < TAG_BYTES` 边界 |

## 已通过面（审查确认）

AES-GCM 逐条随机 IV、SQL 全参数化、会话固定防护、停用即时吊销、云端只回掩码、服务端代发试连双层脱敏、`cloudConfigId` 服务端解析防伪造、乐观锁原子性、迁移幂等、无 XSS 面、开放重定向防护。

## 实施期已知取舍

- Cookie 名 `sid` + `secure:"auto"`（内网 http 部署下 `__Host-` 的 Secure 属性会被浏览器拒收；见 L-2）
- MCP 工具（`requirement-v2/mcp-tools.ts`）走机器 token 通道无用户上下文，不接云端配置引用（误传 cloudConfigId 失败关闭）
- 浏览器 E2E 未做（多会话并发改库，避免抢占）；tsc×2 + 全量单测为验证底线
