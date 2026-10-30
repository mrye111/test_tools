# 认证与会话管理实践调研（2026-09）

> 票据：`tickets/01-auth-session-practices.md`　|　场景：内网测试工具平台（React+Vite / Express+TS+ESM / MySQL），账号密码登录、开放注册、首个用户为管理员，多用户共享业务数据。
> 资料以官方文档、规范与主流库仓库为准；版本号取自 npm registry（2026-09-24）。

## 推荐栈（结论先行）

| 层 | 选择 | 关键参数 |
|---|---|---|
| 密码哈希 | **npm `argon2`（node-argon2）0.45.x，Argon2id** | 用包默认（m=65536 KiB≈64 MiB, t=3, p=4, tag=32B, Argon2 1.3）；内存紧张时用 OWASP 最低档 m=19456, t=2, p=1；登录时 `needsRehash` 做参数升级 |
| 会话形态 | **httpOnly Cookie + 服务端会话**：`express-session@1.19` + `express-mysql-session@3.0`（MySQL） | cookie：`__Host-` 前缀、`httpOnly`、`sameSite: 'lax'`、`secure`（HTTPS 时）；`resave: false`、`saveUninitialized: false`、`rolling: true`（滑动续期）+ 服务端绝对上限 8h；登录 `regenerate()`、登出 `destroy()` |
| CSRF | **同步器令牌**（session 内 csrf token，前端放 `X-CSRF-Token` 头）+ `SameSite=Lax` + Origin 校验 | 不用已归档的 `csurf`；需要现成库可用 `csrf-csrf@4`（签名双提交实现） |
| 登录防护 | **`express-rate-limit@8` 双层限速**（per-IP + per-username，仅计失败）+ 指数退避；密码策略按 **NIST SP 800-63B-4** | 密码 15–64 字符、无复杂度组合规则、比对泄露口令黑名单、拒绝时说明原因；错误信息统一不枚举 + dummy hash 平时序 |
| 生态 | **手写薄认证中间件**（约 200–400 行：注册/登录/登出/requireAuth/requireAdmin） | 不引 Passport；lucia 已弃用（官方示范即手写会话）；想要 OAuth/2FA/邮箱验证开箱功能时改用 `better-auth@1.7`（备选） |

一句话权衡（详见后文各表）：

- **argon2id vs bcrypt vs scrypt**：argon2id 抗 GPU/侧信道最强且是 OWASP 首选；bcrypt 屈居 legacy（72 字节截断、Windows 原生编译坑）；scrypt 仅作零依赖退路。
- **Cookie Session vs JWT**：浏览器场景服务端会话可即时吊销（登出/封禁），JWT 自包含令牌做不到，登出语义与多标签页 refresh 竞态都是自找的复杂度——JWT 留给未来跨服务 API。
- **限速**：只按 IP 限会被分布式爆破绕过，必须叠加 per-账号失败计数 + 指数退避；硬锁定账户有被恶意锁死的 DoS 风险。
- **生态**：单因素账密 + 小团队内网，Passport 的策略抽象收益低于其维护/TS/ESM 成本；手写 + 成熟原语是最短路径，better-auth 为功能升级预留。

---

## 1. 密码哈希

### 1.1 算法权衡表

| 算法 | 安全性 | 现行定位（OWASP） | 参数基线 | 主要短板 |
|---|---|---|---|---|
| **Argon2id** | 抗 GPU/ASIC 与侧-channel 的内存硬化 KDF（PHC 竞赛冠军） | **首选**（first choice） | 最低档 m=19456 (19 MiB), t=2, p=1；等价档还有 m=47104,t=1,p=1 / m=12288,t=3,p=1 / m=9216,t=4,p=1 / m=7168,t=5,p=1；包默认 m=65536,t=3,p=4 | Node 生态原生绑定仍在演进（见 1.2） |
| **scrypt** | 内存硬化，略逊 Argon2id | Argon2id 不可用时的退路 | N=2^17,r=8,p=1 ～ N=2^13,r=8,p=10 共 5 档等价配置 | 无 PHC 标准封装，参数升级要自己编码 |
| **bcrypt** | 抗硬件攻击弱于前两者 | **仅 legacy**（"should only be used where Argon2 and scrypt are unavailable"） | cost ≥ 10，按服务器性能尽量调大；强制 72 字节截断 | 72 字节上限（UTF-8 中文/emoji 更易触顶）；原生绑定在 Windows 有编译坑 |
| **PBKDF2-HMAC-SHA256** | 无内存硬化 | 仅 FIPS-140 / NIST 强制场景 | 600,000 次迭代 | GPU 验证效率高，同等延迟下防护最弱 |

通用工程要求（OWASP）：哈希延迟目标 **< 1 秒/次**（过高会因登录请求造成 CPU 耗尽 DoS）；每密码唯一随机盐（主流库自动管理）；可选 pepper（存 DB 外）；算法与参数随哈希存储（PHC 字符串格式），**下次登录时 `needsRehash` 重算升级**。

- 来源：[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- Argon2id 定义与推荐配置（第一推荐 t=1,p=4,m=2 GiB；第二推荐 t=3,p=4,m=64 MiB；盐 16 字节推荐、tag 128 bit 起）：[RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)

### 1.2 Node 库选型权衡表（版本为 2026-09 npm latest）

| 库 | 形态 | Windows 安装 | TS/ESM | 封装完备度 | 结论 |
|---|---|---|---|---|---|
| **`argon2@0.45.1`**（[ranisalt/node-argon2](https://github.com/ranisalt/node-argon2)） | 参考实现 C 库的 N-API 绑定 | **v0.26 起提供预编译二进制（GitHub Actions 构建，含 Windows Server 2022 x86-64），Win11 直接可用、无需 VS Build Tools**；仅预编译缺失才需 node-gyp + VS 2015+；要求 Node ≥ 22（本机 Node 24.15 满足） | 自带 `.d.ts`；`import * as argon2 from "argon2"` | **PHC 字符串输出、`verify`、`needsRehash`、默认参数齐全**（README 自述默认值即 Argon2 团队安全推荐，"no need to modify them"） | **推荐** |
| `node:crypto` **argon2**（[Node 文档](https://nodejs.org/api/crypto.html)） | **Node ≥ 24.7.0 内置**，零依赖 | 零安装 | 原生 | ❌ 无 PHC 格式、无 verify、无 needsRehash、无默认参数——返回裸 `derivedKey`，盐/参数/存储格式全要自己管 | 观察项：等 node-argon2 转为原生封装后再迁移（其官方路线图即如此） |
| `node:crypto` **scrypt**（[Node 文档](https://nodejs.org/api/crypto.html)） | Node ≥ 10.5 内置，零依赖 | 零安装 | 原生 | 需自管 PHC/参数列；**坑：默认 `maxmem=32 MiB`，N≥2^16 时必须手动加大，否则抛 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`**（约 128·N·r > maxmem 即报错）；异步实现跑在 libuv 线程池（默认 4 线程，与 fs 共享） | 零依赖退路 |
| **`bcryptjs@3.0.3`**（[dcodeIO/bcrypt.js](https://github.com/dcodeIO/bcrypt.js)） | 纯 JS bcrypt，零依赖 | **零安装坑**（无原生编译） | 自带 TS 类型，ESM+UMD | hash/compare/genSalt，rounds 默认 10；比原生慢约 30%（同等时间预算内可设 cost 更低）；同样 72 字节截断（提供 `truncates()` 检查） | **备胎**：当部署环境预编译不可用时的降级选项 |
| `bcrypt@6.0.0`（[kelektiv/node.bcrypt.js](https://github.com/kelektiv/node.bcrypt.js)） | C++ 绑定 | 预编译"best-effort"（Win x64/arm64）；回退源码编译需 **VS C/C++ 工作负载 + Python + node-gyp**——Windows 典型翻车点（MSBuild/MSVS 缺失） | 无官方 TS 类型 | 72 字节截断是硬约束；<5.0.0 曾有 NUL 截断/回绕 bug（务必 ≥5） | 不推荐首选 |

**Windows 11 开发环境结论**：`argon2` 自 v0.26 起有 Windows x86-64 预编译二进制，开发机与常规 x64 部署机 **npm install 即用，不需要装 VS Build Tools/Python**；只有（a）预编译未覆盖的平台（如 Windows ARM64）或（b）`--build-from-source` 时才会落入 node-gyp 编译链。若某环境实在装不上，降级路径是 `bcryptjs@3`（纯 JS），再退是 `node:crypto` scrypt（记得 `maxmem`）。

来源：
- [ranisalt/node-argon2 README（预编译平台矩阵、Node ≥22、与 node:crypto 对比表）](https://github.com/ranisalt/node-argon2)
- [node-argon2 Options wiki（默认 type=argon2id, timeCost=3, memoryCost=65536, parallelism=4, hashLength=32, version=0x13 即 Argon2 1.3）](https://github.com/ranisalt/node-argon2/wiki/Options)
- [Node.js crypto 文档（scrypt 默认 cost=16384/blockSize=8/parallelization=1/maxmem=32 MiB；argon2/argon2Sync Added in v24.7.0）](https://nodejs.org/api/crypto.html)
- [kelektiv/node.bcrypt.js README（Windows 编译要求、72 字节截断）](https://github.com/kelektiv/node.bcrypt.js)
- [dcodeIO/bcrypt.js README](https://github.com/dcodeIO/bcrypt.js)

---

## 2. 会话形态：httpOnly Cookie Session vs 无状态 JWT

### 2.1 形态权衡表

| 维度 | Cookie + 服务端会话（推荐） | 无状态 JWT（access token） | JWT + refresh token |
|---|---|---|---|
| 吊销/登出 | **即时**：`session.destroy()` 服务端删除；封禁用户即刻生效 | **做不到即时**：令牌自包含（[RFC 7519](https://www.rfc-editor.org/rfc/rfc7519.html)），登出只能等过期；要黑名单就又变回"有状态" | refresh 轮换可间接吊销，但已发出的 access token 仍在有效期内 |
| OWASP 合规 | 直接满足"登出必须服务端失效"（[Session Mgmt Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)） | 天然不满足，需额外补偿 | 补偿后可满足，复杂度高 |
| CSRF | 需防护（浏览器自动带 cookie）→ 同步器令牌 + SameSite | 放 localStorage 无 CSRF 但 XSS 窃取后果更持久；放 cookie 则同样面临 CSRF | 同左 |
| XSS 面 | `httpOnly` cookie 使 JS 拿不到会话 ID | localStorage 可被 XSS 读走 | 双 token 都要防 |
| 多标签页 | **天然一致**：全标签页共享同一 SID，登出一处全体失效；并发请求只是并发 touch 同一行（`saveUninitialized:false` 可免并行建会话竞态，express-session 文档明确） | 各标签页各持 token，登出不同步 | **refresh 并发轮换竞态**：两标签页同时刷新会互踢，需 reuse-detection/跨标签页协调（BroadcastChannel 等） |
| 过期/续期 | 滑动：`rolling: true` 每响应重置 cookie `maxAge` + store `touch`；绝对上限：session 存 `createdAt`，超 8h 强制重建（express-session 本身无绝对超时，要自己加这 5 行） | 短时效（5–15 min）+ 无状态校验 | 短 access + 长 refresh + rotation |
| 水平扩展 | 会话在 MySQL，天然共享（内网单实例更无压力） | 无共享状态是其唯一结构性优势 | 介于两者 |
| 复杂度 | express-session + mysql store 约 30 行配置 | 令牌签发/校验/刷新/吊销/多标签页协调全要自己写 | 最高 |

**结论**：本项目是同源 SPA（浏览器自动携带凭证），业务数据全库共享、无跨服务调用需求——无状态 JWT 的唯一结构性优势（免共享存储的水平扩展）用不上，而其吊销短板与 OWASP 登出要求直接冲突。**选 httpOnly Cookie + MySQL 服务端会话**；未来若开放跨服务 API，再用 [`jose@6`](https://github.com/panva/jose) 发短时效 JWT 走双轨（资料见 [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_JavaScript_Cheat_Sheet.html)、[RFC 8725 JWT BCP](https://www.rfc-editor.org/rfc/rfc8725.html)）。

### 2.2 服务端会话落 MySQL（推荐配置明细）

| 项 | 做法 | 依据 |
|---|---|---|
| 存储 | `express-mysql-session@3.0.3`，默认自动建表：`session_id / expires / data`（data 为 utf8mb4 文本列，MySQL ≥ 5.5.3）；可用 `schema` 选项加 `user_id` 列（为将来的"查看活跃会话/踢下线"留钩子） | [express-mysql-session README](https://github.com/chill117/express-mysql-session) |
| 过期清理 | store 层 `expiration`（默认 24h）+ `clearExpired: true` + `checkExpirationInterval`（默认 15 min 清扫） | 同上 |
| 续期 | `rolling: true`（滑动续期，配合 `maxAge`）+ 自写绝对上限（session 内 `createdAt`，建议 8h——OWASP 对全日常驻办公场景推荐绝对超时 4–8h；低风险应用 idle 15–30 min） | [express-session README](https://github.com/expressjs/session)、[OWASP Session Mgmt](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) |
| cookie | 名带 `__Host-` 前缀（OWASP 对会话 cookie 的推荐前缀，要求 Secure + Path=/ + 无 Domain）；`httpOnly: true`（默认即开）；`sameSite: 'lax'`；HTTPS 部署时 `secure: true`（文档明示 recommended）+ `trust proxy`；会话 cookie 建议不落盘（会话级） | 同上 |
| 固定攻击 | **登录成功必调 `req.session.regenerate()`**（匿名→已认证属权限变更）；绝不上客户端传什么 SID 就用什么 | OWASP Session Mgmt"regenerate after any privilege level change" |
| 登出 | `req.session.destroy()` + 清 cookie（过期时间设为过去） | 同上 |
| 会话 secret | ≥32 字节随机；用 secrets 数组支持无痛轮换（首元素签发、全体验证） | express-session README |
| 其他 | `resave: false`（文档明示通常应关）、`saveUninitialized: false`（利于登录会话/GDPR/并行请求竞态）；响应带 `Cache-Control: no-store` | 同上 + OWASP |
| 生产禁区 | 默认 `MemoryStore` 文档明文"purposely not designed for a production environment"（泄漏内存、不跨进程） | express-session README |

**多标签页与并发行为小结**（服务端会话方案）：所有标签页共享同一会话；并发请求对同一 store 行做 touch/save 是幂等更新，无互踢；一个标签页登出 → 全体下线（符合直觉）；唯一要注意的是登录/登出瞬间的并行首个请求——`saveUninitialized: false` + `regenerate()` 顺序写好即可。对照 JWT 方案：登出不传导、refresh 并发轮换竞态需要额外协议，多标签页是其常见翻车点。

### 2.3 CSRF 防护差异与选型表

| 手段 | 定位 | 说明 |
|---|---|---|
| **同步器令牌（推荐主力）** | OWASP 对**有状态**应用的首选（synchronizer token pattern） | 服务端 session 存 csrf secret，前端启动时取一次，所有变更类请求放 `X-CSRF-Token` 头（自定义头比 hidden form 更安全）；自实现约 20 行，或用 [`csrf-csrf@4`](https://github.com/psf/csrf-csrf)（签名双提交实现） |
| `SameSite=Lax` | 纵深防御 | Lax 挡跨站 POST；**"Lax only blocks unsafe methods"**——有变更类 GET 就失效；且 SameSite 作用域是注册域不是源，兄弟子域仍需防 |
| Origin/Referer 校验 | 纵深防御 / 老浏览器兜底 | 变更类请求校验 Origin 同源，简单一行中间件 |
| Fetch Metadata（`Sec-Fetch-Site`） | 现代浏览器最强信号 | 拦 `cross-site` + 不安全方法；2023-03 起全主流浏览器覆盖 98%+；内网工具可与上面叠加 |
| 裸双提交 cookie | **不推荐单独使用** | OWASP 明示 naive double-submit 可被子域写 cookie 绕过；要用就用 HMAC 签名版 |
| `csurf` | **禁用** | [expressjs/csurf 已于 2025-05-14 归档](https://github.com/expressjs/csurf)，不再维护 |

JWT 方案对照：token 放 localStorage 不受 CSRF 影响（浏览器不自动携带），但换来 XSS 可直接偷 token 且无法吊销；token 放 cookie 则回到同样的 CSRF 问题。"JWT 天生免疫 CSRF"是只在 localStorage 形态下成立的半真相。

来源：[OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

---

## 3. 登录防护（限速、防爆破、密码强度）

### 3.1 措施权衡表

| 措施 | 推荐配置 | 依据 / 权衡 |
|---|---|---|
| **per-IP 限速** | `express-rate-limit@8`：登录/注册端点独立实例，约 10 次/分钟/IP，`skipSuccessfulRequests: true`（只计失败） | 防单源爆破与撞库噪声；注意多用户同出口 IP（内网 NAT）的误伤，阈值别太狠。[express-rate-limit README](https://github.com/express-rate-limit/express-rate-limit) |
| **per-账号失败计数 + 指数退避（主力）** | keyGenerator 取用户名，失败 5 次起加渐进延迟（~1s 起倍增）；或按 NIST 上限：单账号连续失败 **≤100 次**禁用该认证器直到重绑 | 只按 IP 限会被分布式/代理绕过；OWASP 建议**按账号而非按 IP**计数。NIST：verifier **SHALL** 限速失败尝试、连续失败 SHALL ≤100（上限值，可更低）。[OWASP Auth Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[NIST SP 800-63B-4 §3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html) |
| 硬锁定账户 | **不做长时锁定** | OWASP 明示锁定会被用来"锁死别人"造 DoS；用指数退避/短时延迟替代，密码找回通道可作补救 |
| CAPTCHA | 可选、仅纵深防御 | OWASP：可被绕过/外包打码，"只在少量失败后才要求"；内网工具可省略 |
| 防撞库 | 同上 per-账号 + 泄露口令黑名单（注册时挡掉已泄露密码即可大幅降低撞库成功率） | Credential stuffing 的克星是 MFA+黑名单+限速三件套；内网无 MFA 时黑名单尤其重要 |
| **密码强度（NIST SP 800-63B-4 现行惯例）** | 最短 **15 字符**（单因素登录 SHALL；有 MFA 才允许 8）；最长 **≥64 字符** SHOULD；**禁止**大小写/数字/特殊字符组合规则（SHALL NOT）；**禁止**无证据的定期改密（SHALL NOT）；注册/改密时 **SHALL** 比对泄露/常见/上下文相关口令黑名单（含服务名、用户名及其变形），命中 SHALL 说明原因；允许粘贴与密码管理器 | [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)（OWASP Auth Sheet 同步背书：length + blocklist > composition/entropy math） |
| 强度计 UX | 前端 `zxcvbn` meter 仅作提示（`zxcvbn@4.4.2` 多年未发新版但 API 稳定，或用维护中的 zxcvbn-ts）；**服务端校验以 NIST 规则为准**，不信任前端 | OWASP Auth Sheet 推荐 zxcvbn 作 strength meter |
| 防用户枚举 | 登录失败统一文案「用户名或密码错误」（不区分不存在/密码错/被禁用/被锁定）；状态码也要一致；**用户不存在时也跑一次 dummy hash** 拉平时序 | OWASP Auth Sheet 伪码明示 quick-exit 时序泄露 |
| 注册接口 | 与登录同级限速；开放注册 + 内网场景下黑名单 + 限速足够；首用户自动 `role='admin'`（users 表 count==0 时）落在同一注册事务内 | 项目需求 |

`express-rate-limit@8.7.0` 要点：`windowMs` + `limit`（v8 用 `limit` 不是 `max`）、`ipv6Subnet`（推荐 56，防 IPv6 换址绕过）、`keyGenerator`、`skipSuccessfulRequests`、`standardHeaders: 'draft-7'`、内置配置校验 `validate`；默认内存 store，多实例部署才需要换共享 store——内网单实例直接用默认。

---

## 4. 生态选型：Passport vs 手写 vs 其他

| 方案 | 现状（2026-09） | 对本项目的适配 | 结论 |
|---|---|---|---|
| **手写薄中间件（推荐）** | 依赖面小：`argon2` + `express-session` + `express-mysql-session` + `express-rate-limit`，auth 流程约 200–400 行 | 单因素账密、5 个端点、无 OAuth；每行代码可见可控；TS/ESM 原生就是我们的写法 | **选它** |
| Passport `0.7.0`（[jaredhanson/passport](https://github.com/jaredhanson/passport)） | 23.5k stars 但**低维护**：README 版权止于 2021、Travis/david-dm 老旧徽章、355 open issues、无官方 TS 类型与 ESM 指引（社区 `@types/passport`）、策略生态大量停更 | "LocalStrategy"对单策略场景是纯抽象税；serialize/deserialize 再包一层 indirection；session 还是外包给 express-session | 不引 |
| lucia（[lucia-auth.com](https://lucia-auth.com/)） | **2025-03 已弃用 npm 包**；官网（2026-07 修订）转为教学资源 + 单文件 `auth_session.ts` 参考实现，指向 Auth Book（auth.pilcrowonpaper.com） | 官方现在的立场恰恰是"照着参考实现手写会话"——为我们的推荐背书 | 不作依赖引入 |
| better-auth `1.7.5`（[better-auth/better-auth](https://github.com/better-auth/better-auth)） | 30.1k stars、极活跃的 TS 认证框架；Express 集成经 `toNodeHandler`（`better-auth/node`）挂 `/api/auth/*`（v5 为 `/api/auth/*splat`），须挂在 `express.json()` 之前，**ESM-only（明示不支持 CJS）**；cookie + 数据库会话；插件生态（2FA/OAuth/邮箱验证等） | 对本项目是重框架：接管用户/会话表结构与路由、升级节奏快（335 open issues/394 open PRs 的快车道项目）；纯账密内网工具收益覆盖不了引入成本 | **备选**：将来要开箱 2FA/OAuth/邮箱验证时整体切换（它自带完整表结构，届时替换手写层） |

**推荐组合的形状**（留给决策票 07 锁定）：`users` 表（`id, username 唯一, password_hash PHC 字符串, role, created_at`）+ `sessions` 表（express-mysql-session 默认表 + 可选 `user_id` 列）+ `login_attempts`（或内存 map，单实例足够）做失败退避；中间件 `requireAuth` 读 `req.session.userId`，`requireAdmin` 比对 `role`。首个注册用户在注册事务内判空落 `role='admin'`。

---

## 来源清单

1. [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)（argon2id 首选与参数表、scrypt/bcrypt/PBKDF2 定位、PHC 与重哈希升级）
2. [RFC 9106 – Argon2 Memory-Hard Function](https://www.rfc-editor.org/rfc/rfc9106.html)（Argon2id 定义、两档官方推荐参数、盐/tag 长度）
3. [ranisalt/node-argon2（npm `argon2`）](https://github.com/ranisalt/node-argon2) + [Options wiki](https://github.com/ranisalt/node-argon2/wiki/Options)（预编译矩阵、Windows 条件、默认参数、与 node:crypto 对比）
4. [Node.js crypto 文档](https://nodejs.org/api/crypto.html)（scrypt 参数与 maxmem 坑、argon2/argon2Sync v24.7.0 新增、timingSafeEqual）
5. [kelektiv/node.bcrypt.js（npm `bcrypt`）](https://github.com/kelektiv/node.bcrypt.js) / [dcodeIO/bcrypt.js（npm `bcryptjs`）](https://github.com/dcodeIO/bcrypt.js)（Windows 编译要求、72 字节截断、纯 JS 慢 30%）
6. [express-session README](https://github.com/expressjs/session)（cookie 选项、regenerate/rolling/resave/saveUninitialized、MemoryStore 警告、store 接口）
7. [express-mysql-session README](https://github.com/chill117/express-mysql-session)（表结构、过期清扫、自定义 schema）
8. [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)（cookie 属性与 `__Host-`、idle/absolute 超时、固定攻击、登出失效）
9. [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)（同步器令牌 vs 双提交、SameSite 边界、Fetch Metadata）
10. [expressjs/csurf（2025-05-14 归档）](https://github.com/expressjs/csurf)
11. [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)（按账号计数、指数退避、锁定 DoS、统一错误与时序、NIST 口令规则摘要）
12. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)（15/64 字符、禁组合规则、禁定期改密、黑名单 SHALL、限速与 ≤100 失败上限）
13. [express-rate-limit README](https://github.com/express-rate-limit/express-rate-limit)（v8 选项集）
14. [jaredhanson/passport](https://github.com/jaredhanson/passport)（维护状态证据）
15. [lucia-auth.com](https://lucia-auth.com/)（2025-03 弃用声明与现状）
16. [better-auth](https://github.com/better-auth/better-auth) + [Express 集成文档](https://www.better-auth.com/docs/integrations/express)（toNodeHandler、ESM-only、挂载顺序）
17. [RFC 7519 – JWT](https://www.rfc-editor.org/rfc/rfc7519.html) / [RFC 8725 – JWT BCP](https://www.rfc-editor.org/rfc/rfc8725.html)（自包含令牌无吊销语义；将来若引入 JWT 的实现规范）
18. npm registry 各包 latest（2026-09-24）：argon2@0.45.1、bcrypt@6.0.0、bcryptjs@3.0.3、express-session@1.19.0、express-mysql-session@3.0.3、express-rate-limit@8.7.0、better-auth@1.7.5、passport@0.7.0、csrf-csrf@4.0.3、zxcvbn@4.4.2、jose@6.2.12、express@5.2.1
