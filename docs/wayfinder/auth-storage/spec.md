# 规格：用户登录与数据入库

> 目的地交付物 · 由「用户登录与数据入库」图（[README](README.md)）的 10 张决策票汇编 · 2026-09-24 定稿
> 决策溯源见文末索引表；领域术语以 [CONTEXT.md](../../ai-test-tools-site/CONTEXT.md) 为准。

## 0. 范围

**做**：用户登录（账号门禁）；模型配置双存储（默认本地、可选云端挂用户）；一切非数据库持久化数据入库 MySQL；入库密钥统一加密；存量迁移。

**不做**（Out of scope）：实施施工细节之外的业务改造；业务数据按用户隔离/权限分级（全库共享已定）；多租户/组织概念；SSO/OAuth/扫码登录（止于账号密码，未来另立新图）。

## 1. 领域模型（要点）

- **用户（User）**：用户名（唯一）+ 密码登录，无邮箱。业务数据全库共享；**挂用户的数据 = 云端模型配置 + 个人偏好**。
- **管理员（Admin）**：首个注册用户自动成为；能力=用户管理（注册开关、用户列表、创建账号、停用/启用、重置密码），业务数据零特权。
- **模型配置存储归属（Local/Cloud）**：按条自选；本地 = 此浏览器+此账号（互相隔离），云端 = 挂用户入库加密；切换=迁移，单一住所。
- 双存储待遇**只给模型配置**，不外溢。

## 2. 用户登录与账号管理

### 2.1 注册 / 登录 / 登出

- 注册字段：用户名（唯一）+ 密码，不收邮箱。开放自助注册，**管理员可关闭注册**；关闭后新账号只能由管理员创建（用户名+初始密码）。
- 界面：独立 `/login`、`/register` 页；未登录访问任意路由 → `/login?redirect=原地址`，登录后回跳；登出在导航栏用户菜单。
- 初始密码（创建/重置所得）**不强制**首次登录改密，登录后提示可改。

### 2.2 密码策略与生命周期

- 规则（NIST SP 800-63B-4）：15–64 字符、不强制大小写/符号组合、拒绝常见泄露口令黑名单。
- 本人自助改密；忘记密码走管理员重置为新初始密码；**无自助找回通道**。
- 存储：单向哈希（Argon2id，见 2.4），任何场景不回显、不落日志。

### 2.3 管理员与用户管理

用户管理五能力：注册开关、用户列表、创建账号、停用/启用、重置密码。**账号停用**=软禁用（不能登录、数据不受影响、可重新启用）。

### 2.4 认证技术栈（锁定）

| 项 | 选型 |
|---|---|
| 密码哈希 | npm `argon2`（Argon2id，默认参数 m=64MiB/t=3/p=4，`needsRehash` 升级） |
| 会话 | `express-session` + `express-mysql-session`（会话落 MySQL）；httpOnly Cookie、`__Host-` 前缀、SameSite=Lax；登录 `regenerate()`、登出 `destroy()`；滑动续期 + 8h 绝对上限 |
| CSRF | 同步器令牌（`X-CSRF-Token` 头）+ SameSite + Origin 校验（`csurf` 已归档，自研薄实现） |
| 限速 | `express-rate-limit` 双层（per-IP + per-账号失败计数）+ 指数退避；**不硬锁账户**（防恶意锁死 DoS） |
| 生态 | 手写薄认证中间件（约 200–400 行），不引 Passport / better-auth |

选 Cookie 服务端会话的决定性理由：停用/登出需要**即时吊销**。依赖清单四件：`argon2`、`express-session`、`express-mysql-session`、`express-rate-limit`。Windows 开发环境 `argon2` 走 x64 预编译、无需 VS Build Tools。

## 3. API 鉴权面

- **免登白名单仅三项**：`GET /health`、前端静态资源、MCP 机器端点（`/sse`、`/messages`、`/rpc`）。MCP 免的是会话不是门禁：走 **`MCP_TOKEN` 静态 token**（请求头、环境变量配置），校验不过 401；**未配置 token 时 fail-closed（503）**，开发放行须显式 `MCP_TOKEN_OPEN=1`。（实施注：会话入口 `POST /api/auth/login`、`/api/auth/register` 亦属白名单必要豁免——登录前无会话可校验，靠限速 + Origin 校验兜底；白名单实际为五项路径。）
- **其余全登**：`/api/*`（含 `/api/test-connection`）、`/tools`、`/ai/*`、`/api/jmeter/build`、`/files`、日志路由。
- **覆盖模型 default-deny**：会话中间件置于全部路由之前、白名单显式跳过；新增路由自动入保。
- **响应契约**：`401 UNAUTHORIZED`（未登录与会话过期同码）→ 前端全局拦截跳 `/login?redirect=`；`403 FORBIDDEN`（越权，管理路由挂 admin 标记）；`403 CSRF_INVALID`。

## 4. 模型配置双存储

- **切换=迁移**：拨云端=上传删本地，拨回本地=下载删云端；任一时刻一条配置只有一个家。
- **云端零本地存在**：不留缓存，用时实时取；未登录不可见。
- **activeModelId 归浏览器**（随本地配置域）：每台机器各选各的；指向配置不存在 → 回退本机可用列表第一条。
- **并发编辑乐观锁**：云端配置带版本号，条件 UPDATE，冲突 409「已被其他设备修改，刷新后重试」。
- **密钥回显按归属画线**（以「密钥过没过网络进服务端」为界）：
  - 云端：保存后永不回显明文（掩码如 `sk-***f8`）；编辑留空 = 保持不变；测试连接**服务端代发**（密钥不出服务端）。
  - 本地：明文存于此浏览器+此账号，可看可改，归用户自管。

## 5. 数据全量入库

### 5.1 入库清单

| 数据 | 去向 | 归属 |
|---|---|---|
| 云端模型配置（含 apiKey 加密列、版本号） | MySQL（auth/模型配置域新表） | 挂用户 |
| 个人偏好：`ai-run-entry:*`、`requirement-import-entry-*` | MySQL `user_preferences` | 挂用户 |
| `automation.config.json`（model/execution/fastEngine/credentials） | MySQL（automation 域新表，密钥加密列） | 全库共享 |
| 服务端其余业务数据 | 已在 MySQL（tc_*/tr_reports 等），仅补密钥剥离 | 全库共享 |

### 5.2 瞬态排除（就两项）

① 需求接力载荷（读后即删）；② 需求分析任务进程内缓存（不持久化）。

### 5.3 不迁项

`server/.env`（部署配置）、运行日志、`.jmx` 导出产物、只读 assets。模型配置「本地」域按双存储语义**豁免入库**（localStorage 按账号命名空间）。

## 6. 密钥加密

- **算法**：`node:crypto` AES-256-GCM（每条随机 12B IV + 16B tag，AAD 可绑列名）。主密钥 = 环境注入 32B 随机密钥（dev `server/.env` gitignore / prod 部署注入、每环境独立、禁入 git/镜像），须有与数据库分离的独立备份。
- **红线**：GCM 同钥 IV 复用一票否决；API Key 必须**可逆**加密（单向哈希只给登录口令）。
- **密文格式**：单列版本化信封 `v1:<keyId>:<b64url(iv)>:<b64url(ct‖tag)>`。
- **轮换全套**：新 keyId 设主 + 读路径 lazy 重写 + 幂等批量补扫脚本（三阶段并存）。主密钥泄露 = 全表重加密 **且** 逐个轮换被保护的凭据本体；重加密必过明文（GCM 无 rewrap）。
- **覆盖清单四类**：① 云端模型配置 `apiKey`；② 生成任务 `request` 内嵌 `ai_config.apiKey`（**写入时剥离入独立加密列，request 留脱敏占位**，不整列加密）；③ automation `model.apiKey`/`fastEngine.jevApiKey`；④ `credentials` 真实值。
- **纳入规则**：凡「明文可直接当第三方凭据使用」的服务端落库字段，一律加密列，禁混大 JSON 明文列。
- **脱敏四条**：出站错误统一 redact 助手（`sanitizeError` 提为共享层）；pino `redact` 日志禁钥；导出物零密钥成契约；明文仅「加密入库/取出使用」两处瞬时驻留。

## 7. 存量迁移

一次性幂等脚本包，编入启动 bootstrap（顺序：shared 加密助手 → auth → 个人偏好 → automation 平迁 → `tc_*` 剥离重加密）；**不做双写/灰度**，分钟级停机一次切。

1. **模型配置**：无需导入向导（本地豁免；legacy 键现有代码自动并入）；localStorage 按账号命名空间隔离落地时一次性归位。
2. **URL 记忆**：首次登录静默上送一次（按当前用户入库），送完删本地键。
3. **automation.config.json**：读文件写库（密钥入加密列）→ 原文件归档 `.bak`；不双写；config-store 切读库+进程缓存，热生效语义不变。
4. **`tc_*` 存量 `request` 内嵌 key**：剥离入加密列，幂等可重跑；明文存量一次清零、可审计。
5. **回滚**：版本回退 + `.bak` 文件反向导入脚本。

## 8. 库表落位约定

按域落位，沿用各 feature `mysql-repository.ts` + `migrate.ts` 先例：

| 表 | 域 | 说明 |
|---|---|---|
| `users` | auth（新） | 用户名唯一、密码哈希（PHC 串含参数，支撑 needsRehash）、is_admin、disabled |
| `sessions` | auth（新） | `express-mysql-session` 标准表 |
| `user_preferences` | auth（新） | 键值 + user_id |
| 模型配置表 | auth/模型配置 | user_id、apiFormat、apiKey 加密列、**version 乐观锁列** |
| automation 配置表 | automation | model/execution/fastEngine 字段 + 密钥加密列 |
| （tc_* 表改造） | testcase | `request` 内嵌 key 剥离 → 独立加密列 |
| 加密助手 | shared | encrypt/decrypt + 信封格式 + keyId 管理，各域共用 |

## 9. 决策溯源

| 决策域 | 票据 |
|---|---|
| 认证与会话实践调研 | [01](tickets/01-auth-session-practices.md) · [研究](research/01-auth-session-practices.md) |
| 密钥加密实践调研 | [02](tickets/02-secret-encryption-practices.md) · [研究](research/02-secret-encryption-practices.md) |
| 非数据库持久化数据盘点 | [03](tickets/03-inventory-local-data.md) |
| 登录/注册交互与政策 | [04](tickets/04-auth-ux-policy.md) |
| 模型配置双存储语义 | [05](tickets/05-dual-storage-semantics.md) |
| 小偏好归属与瞬态排除 | [06](tickets/06-preferences-attribution.md) |
| 认证技术选型 | [07](tickets/07-auth-tech-selection.md) |
| API 鉴权面 | [08](tickets/08-api-auth-surface.md) |
| 密钥加密方案 | [09](tickets/09-secret-encryption-scheme.md) |
| 存量迁移策略 | [10](tickets/10-migration-strategy.md) |
