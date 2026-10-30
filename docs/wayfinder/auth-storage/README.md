# 地图：用户登录与数据入库

`wayfinder:map` · local-markdown tracker · 创建于 2026-09-24

## Destination

一份可直接进入实施的规格 + 全部锁死的决策集，覆盖四块：

- **用户登录**：账号门禁（多用户）；开放自助注册，首个注册用户自动成为管理员，注册可关；业务数据全库共享，仅云端模型配置挂用户
- **模型配置双存储**：每条配置自带「本地/云端」开关，默认本地（存当前浏览器）；选云端则保存到当前登录用户下
- **数据全量入库**：一切非数据库持久化数据迁入 MySQL（前端 localStorage 持久项 + 服务端文件式配置）；瞬态接力载荷除外
- **API 密钥加密**：一切入库的密钥类明文统一加密

含存量数据迁移方案。路线清晰的标志：tickets/ 全部关闭、决策汇编为本目录 `spec.md`，可交实施会话开工。

## Notes

- 技术栈：React+Vite 前端 / Express+TypeScript 服务端（ai-test-tools-site/server）/ MySQL（server/src/shared/db/pool.ts；各 feature 已有 mysql-repository + migrate 先例可循）
- 建图已核的现状事实：模型配置存前端 localStorage（`nexuskit_model_configs`，legacy `nexuskit_model_config`）；小偏好与瞬态载荷散落 localStorage；服务端文件式配置 automation.config.json（含凭据真实值）；业务数据（用例/报告/自动化/需求）已入 MySQL
- 建图已拍板的前提（详见 Destination 与各票 Question）：强制登录门禁；开放注册 + 首个管理员；业务数据全库共享；模型配置每条自选本地/云端（默认本地）；一切入库密钥统一加密；瞬态接力载荷不入库
- 领域术语表：[CONTEXT.md](../../ai-test-tools-site/CONTEXT.md)——「用户」「模型配置存储归属」已收录；票 04/05 定稿后继续扩充
- 相关 skills：research（研究票）、grilling / domain-modeling（问答票）
- **Tracker 约定（local-markdown）**：frontier = `tickets/` 下 `status: open` 且 `blocked_by` 全部已关闭且 `assignee` 为空的票据；认领 = 把 `assignee` 改为自己；解决 = 填写票据 `## Resolution`、`status: closed`，并在下方 Decisions so far 追加一行（标题链接 + 一句话 gist）
- 收图动作：全部票据关闭 → 汇编 `spec.md`（目的地交付物）→ 实施另起

## Decisions so far

<!-- 每关闭一张票据追加一行 -->

- [认证与会话管理实践调研](tickets/01-auth-session-practices.md) — 推荐栈：`argon2` 包（Argon2id + needsRehash 升级）+ express-session/express-mysql-session 的 httpOnly Cookie 服务端会话（登录 regenerate、滑动续期 + 8h 绝对上限）+ 同步器令牌防 CSRF + express-rate-limit 双层限速 + NIST SP 800-63B-4 密码规则 + 手写薄认证中间件（Passport 低维护、lucia 已弃用）；注意 csurf 已归档、Node ≥24.7 内置 crypto.argon2 但无 PHC 封装
- [密钥加密与主密钥管理实践调研](tickets/02-secret-encryption-practices.md) — 推荐方案：`node:crypto` AES-256-GCM（12B 逐条随机 IV + 16B tag）+ 环境注入 32B 主密钥（dev .env / prod 部署注入，每环境独立）+ 单列版本化信封 `v1:<keyId>:<b64url(iv)>:<b64url(ct‖tag)>`；轮换走 keyId 双钥三阶段 + lazy/批量重加密；不用 libsodium/KMS，GCM IV 复用一票否决；重加密必须过明文（GCM 无 rewrap）
- [非数据库持久化数据全量盘点](tickets/03-inventory-local-data.md) — 前端 localStorage 5 键（模型配置×2 含密钥、需求接力瞬态除外、URL 记忆×2）+ 服务端 2 个迁移目标文件（testcase-store.json、automation.config.json，均含密钥）+ .env/日志/jmx 不迁；⚠ 发现生成任务 request 内嵌 apiKey 明文已入 tc_* 表——票 09 加密清单必含，票 10 存量须重加密
- [登录/注册交互与政策](tickets/04-auth-ux-policy.md) — 用户名+密码（NIST 15–64 字符、禁组合、泄露黑名单，无邮箱）；独立 /login /register + redirect 回跳、登出在导航栏用户菜单；管理员=用户管理（注册开关/列表/建号/停用/重置）零业务特权；注册关闭后仅管理员建号；改密自助+管理员重置、无自助找回；初始密码不强制改密；SSO/扫码出局
- [模型配置双存储语义全案](tickets/05-dual-storage-semantics.md) — 切换=迁移（单一家、无双份）；云端配置零本地存在、未登录不可见；activeModelId 归浏览器（悬空回退第一条）；云端配置乐观锁版本号、冲突 409；密钥回显按归属画线（云端只回掩码+留空不变+服务端代发测试，本地维持现状）
- [小偏好归属与瞬态排除清单](tickets/06-preferences-attribution.md) — 入口地址记忆等个人偏好按用户入库（前提修订：挂用户=云端模型配置+个人偏好）；瞬态排除清单收口两项（接力载荷、分析任务进程内缓存）；双存储只给模型配置，不外溢
- [认证技术选型锁定](tickets/07-auth-tech-selection.md) — Argon2id（argon2 包 + needsRehash）+ express-session/express-mysql-session Cookie 服务端会话（__Host-、SameSite=Lax、regenerate/destroy、滑动+8h 绝对上限，为停用即时吊销）；CSRF 三件套 + express-rate-limit 双层无硬锁；手写薄中间件，四依赖锁定
- [API 鉴权面与免登例外](tickets/08-api-auth-surface.md) — 免登白名单仅三项（health、静态、MCP 端点）；MCP 走 MCP_TOKEN 静态 token；其余全登、default-deny 自动入保；契约 401 UNAUTHORIZED / 403 FORBIDDEN / 403 CSRF_INVALID
- [密钥加密方案锁定](tickets/09-secret-encryption-scheme.md) — node:crypto AES-256-GCM + 环境注入 32B 主密钥（IV 复用否决、可逆加密）；信封 `v1:keyId:iv:ct-tag` + 轮换全套（双钥三阶段+lazy+批量）；覆盖清单四类（request 内嵌 key 写入时剥离入加密列）+ 纳入规则；脱敏四条（出站 redact/日志禁钥/导出零密钥/明文瞬时驻留）
- [存量迁移策略](tickets/10-migration-strategy.md) — 模型配置无需导入向导（本地豁免）且 localStorage 按账号命名空间隔离（「本地」=此浏览器+此账号）；URL 记忆首次登录静默上送；服务端一次性幂等 bootstrap 脚本（automation 文件→库归档 .bak、tc_* request 剥离重加密，明文一次清零）；按域落位、顺序明确、不做双写灰度

**✅ 已收图（2026-09-24）**：10/10 票关闭、零雾区。目的地交付物 → [spec.md](spec.md)。实施另起。

## Not yet specified

<!-- 雾已全部散尽：前沿全展开，只剩存量迁移策略待关 -->

## Out of scope

- 一切实施施工（登录 UI、迁移向导、双存储 UI、建表落地等）——本图只交规格与决策集，实施另起
- 业务数据按用户隔离 / 权限分级——建图已拍板全库共享；未来若要重划是新图
- 多租户 / 组织（团队空间）概念——本次「用户」不带组织层级
- SSO / OAuth / 扫码登录——票 04 已裁：本期止于账号密码；未来要做是新图
