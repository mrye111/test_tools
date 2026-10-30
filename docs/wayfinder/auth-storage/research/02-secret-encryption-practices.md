---
title: 密钥加密与主密钥管理实践调研结论
type: research
status: done
source_ticket: ../tickets/02-secret-encryption-practices.md
date: 2026-09-24
verified_against: Node.js crypto API 与 DEP0106 / libsodium 官方文档（secretbox、AEAD 参数表）/ OWASP Secrets Management & Cryptographic Storage Cheat Sheet / NIST SP 800-38D 原文 PDF / AWS KMS Developer Guide（rotate-keys、data-keys）/ GCP Cloud KMS envelope-encryption / HashiCorp Vault Transit API / Google Tink design/keysets 与 wire-format / Fernet Spec / 12factor.net/config / noble-ciphers 与 sodium-native README（均 2026-09-24 抓取核对）
---

# 密钥加密与主密钥管理实践调研

## 推荐方案（置顶）

**入库密钥字段统一用 `node:crypto` 的 AES-256-GCM 加密，主密钥用部署环境注入的 32 字节随机对称密钥，密文存单列「版本化信封串」`v1:<keyId>:<b64url(iv)>:<b64url(ct‖tag)>`；轮换靠 keyId 多密钥并存 + 新写用新钥 + 旧密文 lazy/批量重加密；主密钥泄露连同被保护凭据一起换，主密钥丢失密文即废——主密钥必须有独立备份。**

具体到可写进 spec 的六条：

1. **算法与库**：`aes-256-gcm`，`node:crypto` 原生，零新依赖。IV = `randomBytes(12)` **逐条随机、永不复用**；auth tag 用默认 16 字节（128-bit），**不缩短**、解密端不传非默认 `authTagLength`。可选 AAD 绑定上下文（如 `表名.列名` 常量，零成本防密文搬移）。
2. **主密钥来源**：环境变量（如 `SECRET_ENCRYPTION_KEY`，32 字节 hex/base64）注入。dev：gitignore 的 `.env` 文件（dotenv 仅限开发）；prod：部署环境注入（systemd `EnvironmentFile` / 编排器 secret / 启动脚本），**禁止**写死代码、入 git、docker build 期 `ENV`/`ARG`。**每环境独立主密钥**，dev 不得复用 prod 密钥。KMS（AWS KMS / Vault Transit / GCP Cloud KMS）列为可选升级路径而非本期要求。
3. **密文格式**：单列存 `v<版本>:<keyId>:<base64url(iv‖…)>` 风格信封串（示例 `v1:k1:7cQ…:pL3…`）。版本字节 + keyId 撑起算法/密钥轮换（Fernet 版本字节、Tink keyId 前缀的成熟先例）；base64url 编码免 `+/=` 转义麻烦（Fernet 同款）。字段长度：IV 12B + tag 16B 固定开销，base64url 膨胀 4/3，典型 API Key（≤200B 明文）密文 ≤ 400 字符，`VARCHAR(512)` 足够、拿不准用 `TEXT`。
4. **轮换与重加密**：配置中保留「主 keyId + 历史 keyId→密钥」映射。轮换 = 注入新密钥并设为主（新写用新钥）→ 读路径遇旧 keyId **lazy 重写**（解出后立即用当前主密钥重加密回库）→ 后台幂等批量脚本补齐全表（可断点续跑）。AES-GCM 无「免明文 rewrap」原语（那是 KMS/Vault 持钥服务端才有的能力），所以重加密必须过一遍明文——凭据行数少（数十至数百行）完全可接受。
5. **丢失/泄露响应**：**泄露** = 新主密钥 + 全表重加密 + **所有被保护凭据本体也必须去各供应商轮换**（密钥泄露后解出的明文视为已泄）；**丢失** = 密文永久不可读（GCM 无后门），对策是主密钥单独备份（与数据库分离的密钥文件/密码管理器/离线副本，OWASP 推荐加密密钥备份放独立冷存储），并在运维文档写明「丢了 = 所有凭据需从源头重配」。
6. **脱敏铁律**：明文只在「加密入库」与「取出使用」两处短暂驻留内存；回显一律掩码（只露前后 2–4 字符）；日志、错误信息、导出、调试打印一律禁止明文（OWASP：secrets "Never be logged"，须加密或掩码）。这直接喂票 09 的「回显掩码与全链路脱敏」条目。

---

## 1. 算法与库

### 权衡表

| 方案 | 优点 | 代价 / 风险 | 结论 |
|---|---|---|---|
| **`node:crypto` AES-256-GCM** | 零依赖零供应链；OpenSSL 实现，服务器 x86_64 有 AES-NI 硬件加速；OWASP 指名 GCM/CCM 为首选认证加密模式；Node 文档自带完整 auth-tag 生命周期语义 | 手工管理 IV/tag/密文三段拼装（~30 行封装解决）；GCM 对 IV 复用零容忍 | **推荐** |
| libsodium `crypto_secretbox`（XSalsa20-Poly1305，如 `sodium-native`） | 24 字节 nonce，误用空间小；sodium_malloc 安全内存；API 简单（combined 模式密文自带 tag） | 新增原生依赖（`sodium-native` 是手写 buffer 的薄绑定，心智负担不低）；WASM 绑定（`libsodium-wrappers`）多一层打包体积与冷启动 | 次选：未来要「安全内存」或换算法时的退路 |
| libsodium XChaCha20-Poly1305-IETF | 192-bit nonce，官方称随机 nonce「No practical limits」（对比 AES-GCM 随机 nonce 上限 2^32 条消息） | 同上 + Node 原生不支持，必须引第三方库 | 若坚持随机 nonce 且消息量可能极大时优于 GCM；本场景密钥条目量级完全用不上 |
| `@noble/ciphers`（纯 JS，cure53 2024 审计） | 零依赖纯 JS、易审计、覆盖 aes-gcm/xchacha20poly1305 | 纯 JS 恒定时间性无保证（其 README 自述："If your goal is absolute security, don't use any JS lib"）；性能低于原生 | 不选：node:crypto 已满足且更「正统」 |
| AES-256-CBC + HMAC（encrypt-then-MAC）或 ECB、无认证模式 | — | 需自己拼 MAC 与常量时间比较、易出 padding oracle / 静态 IV 事故；OWASP：ECB "should not be used"；认证模式可用时"always be used" | **禁止**作为入库密钥方案 |

要点：AES-256-GCM 需要硬件 AES 支持才快（libsodium 官方文档明确 AES-GCM "requires hardware support"，无硬件加速计划）——本项目服务端是内网 x86_64，满足前提；GCM 的 96-bit IV 随机生成在 **2^32 次加密/密钥** 的量级内是安全的（NIST §8 概率界 + libsodium 参数表 2^32 上限），密钥条目加密一辈子到不了这个量级。

### 依据

- OWASP [Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)："Where available, authenticated modes should always be used"；GCM 与 CCM "should be used as a first preference"；AES 密钥 "ideally 256 bits"；ECB "should not be used outside of very specific circumstances"。
- Node.js [crypto 文档](https://nodejs.org/docs/latest/api/crypto.html)：`createCipheriv/createDecipheriv`；`getAuthTag()` 须在 `final()` 后调用；解密端 `setAuthTag()` 后若密文被篡改 "`decipher.final()` will throw, indicating that the cipher text should be discarded due to failed authentication"（tag 校验由 OpenSSL 常量时间完成，应用层无需自比 HMAC）。
- Node.js [DEP0106](https://nodejs.org/api/deprecations.html#dep0106-cryptocreatecipher-and-cryptocreatedecipher)：`createCipher/createDecipher`（无 IV 版）"use a weak key derivation function (MD5 with no salt) and static initialization vectors"，v10 文档弃用 → v11 运行时弃用 → **v22 End-of-Life**；替代 = `pbkdf2/scrypt` 派生 + `createCipheriv`。
- libsodium 官方 [AEAD 参数表](https://libsodium.gitbook.io/doc/secret-key_cryptography/aead.md)：AES256-GCM = key 256-bit / nonce 96-bit / MAC 128-bit / 随机 nonce 上限 2^32 条消息，"requires hardware support"；XChaCha20-Poly1305-IETF = nonce 192-bit、随机 nonce "No practical limits"；[secretbox 页](https://libsodium.gitbook.io/doc/secret-key_cryptography/secretbox.md)："The nonce doesn't have to be confidential, but it should never ever be reused with the same key."
- [@noble/ciphers README](https://github.com/paulmillr/noble-ciphers)：cure53 2024-09 审计、0 依赖、"If your goal is absolute security, don't use any JS lib — including bindings to native ones."
- [sodium-native README](https://github.com/holepunchto/sodium-native)："Low level bindings for libsodium"、"thin, stable, unopinionated wrapper"，手写 buffer 分配。

---

## 2. 主密钥来源与多环境管理

### 权衡表

| 来源 | 适用边界 | 优点 | 代价 / 风险 |
|---|---|---|---|
| **环境变量注入**（推荐本期） | 内网单体服务、威胁模型止于「数据库/备份泄露、SQLi 拿库拿不到钥」 | 实现最简；部署面天然隔离 dev/prod；12factor 正统做法 | 进程环境可被同机高权限读走（OWASP 提醒 env "may be included in logs or system dumps"）——比 KMS 少一层「服务被攻破也拿不到钥」 |
| 密钥文件（部署机本地/挂载文件） | 同上，或密钥长到不便放 env | 与数据库物理分离明确；权限可锁 0400 | 必须由编排器挂载、**不得打进镜像**（OWASP）；备份/分发要自己管 |
| KMS / Vault Transit（信封加密） | 多服务共享、合规审计、防「应用主机被攻破」 | KEK 不出 KMS、审计日志、轮换可只 rewrap 不碰明文（Vault `rewrap` 明文全程不出库） | 引入网络依赖与可用性耦合；API 限流要 data-key caching（OWASP 提醒可能 "(D)DoS yourself"）；BYOK 模式 OWASP 直接评 "not a recommended solution due to its complexity" |

**多环境惯例**（各来源汇合的通行做法）：

- 12factor [Config](https://12factor.net/config)："The twelve-factor app stores config in environment variables"；"strict separation of config from code"（开源代码不得泄露任何凭据）；配置应是 granular 环境变量而非 `development/test/production` 命名的配置文件打包。
- OWASP [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)：secrets "should never be hardcoded using docker ENV or docker ARG commands"（会随镜像定义泄露）；env 注入 "not recommended unless the other methods are not possible"（相对密钥托管服务而言）；文件型 secret 应 "mounted in by the orchestrator and never built-in"。
- 落地惯例：仓库只提交 `.env.example`（变量名 + 假值）；dev 密钥放 gitignore 的 `.env`；prod 密钥只存在部署环境（启动前注入），**每环境独立生成**（`randomBytes(32)` 一次性生成脚本产出），环境之间无推导关系——dev 泄露不影响 prod。
- OWASP 同页密钥/密文分离原则："You should not store keys next to the secrets they encrypt, except if those keys are encrypted themselves."——env/文件注入天然满足（密钥在部署面，密文在 MySQL），**绝不能**图省事把主密钥也写进 MySQL 配置表。

### 依据

- OWASP [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)（上述引文均出自该页 env/files/KMS/key-storage 各节）。
- OWASP [Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)："Store keys away from the data they protect"，使 SQLi/路径穿越等单一攻破路径 "can't yield both"；基础底线 "don't hard-code keys, don't commit keys to version control"；KEK/DEK 信封结构中 KEK "must be stored separately from the DEK"。
- [12factor.net/config](https://12factor.net/config)：config/code 分离、env vars 承载、granular 正交。
- GCP [Envelope encryption](https://cloud.google.com/kms/docs/envelope-encryption)：KEK 集中托管于 KMS、"the KEK never leaves Cloud KMS"、绝不可 "store a plaintext DEK"。
- HashiCorp [Vault Transit API](https://developer.hashicorp.com/vault/api-docs/secret/transit)：`rewrap` 端点 "never returns plaintext, it is possible to delegate this functionality to untrusted users or scripts"（KMS 路线的核心运维红利）。

---

## 3. 密文格式（IV、版本化、编码与字段长度）

### 推荐格式

```
列内单串：  v<版本>:<keyId>:<base64url(iv)>:<base64url(ciphertext ‖ authTag)>
示例：      v1:k1:Kx9f0sQ2vR4t:pL3mZc8…（k1 = 主密钥标识，见密钥配置表）
```

三段的职责与先例：

| 段 | 职责 | 先例 |
|---|---|---|
| `v<版本>` | **算法/格式**版本：将来换算法（如换 XChaCha）时 v1 老密文照解、新密文写 v2 | Fernet token 首字节版本（唯一定义值 0x80）"Version ‖ Timestamp ‖ IV ‖ Ciphertext ‖ HMAC" 的版本化思想（[Fernet Spec](https://github.com/fernet/spec/blob/master/Spec.md)） |
| `<keyId>` | **密钥**版本：多密钥并存支撑轮换；解密端按 keyId 选钥 | Tink wire format：密文前缀 "1 byte version … 4 bytes key hint: This is the key ID of the key used"（[Tink wire-format](https://developers.google.com/tink/wire-format)）；Tink 明确该前缀 "is not authenticated and cannot be relied on for security purposes"——**它只是选钥 hint，防篡改靠 GCM tag 本身** |
| `<iv>` / `<ct‖tag>` | 随机 12B IV + 密文 + 16B tag | Node `getAuthTag()` 16B 默认；"The IV is usually passed along with the ciphertext."（[Node crypto](https://nodejs.org/docs/latest/api/crypto.html)） |

各决策点：

- **IV/nonce 管理**：每条密文 `randomBytes(12)` 全新随机，存明文段随密文一起存（IV 无需保密）。**禁止**计数器 IV、禁止从主密钥派生确定性 IV、禁止复用——GCM 的 IV 复用是灾难级（见 §5）。每密钥 2^32 次加密的 NIST 上限对「按条目重加密」的场景是天文数字，无需计数防护。
- **auth tag**：16 字节全 tag，不截断。Node 文档：非 128-bit tag 的 GCM 解密自 v26 起必须显式传 `authTagLength`——统一用默认即可绕开整个问题。
- **编码**：base64url（RFC 4648），Fernet 同款；免 `+/=` 在 URL/JSON/日志搬运中的转义事故。
- **字段长度预算**（`VARCHAR` 选型）：

| 明文长度 | IV+tag 开销 | base64url 后密文段 | 加 `v1:k1:` 前缀 | 建议列宽 |
|---|---|---|---|---|
| 32B（短 token） | 28B | ~80 字符 | ~88 字符 | `VARCHAR(512)` |
| 128B（常见 API Key） | 28B | ~208 字符 | ~216 字符 | `VARCHAR(512)` |
| 350B（含注释的长凭据） | 28B | ~504 字符 | ~512 字符 | `TEXT` 或 `VARCHAR(2048)` |

  公式：`b64len ≈ ceil((n+28)/3)*4`，前缀约 8 字符。**建议直接统一 `TEXT`**（或 `VARCHAR(2048)`）：密钥列不参与索引/排序，宽列无代价，省掉长度边界校验一类的隐患。
- **可选 AAD**：`setAAD()` 绑定上下文（如常量 `"model_config.api_key"`，或含行 id）可防止密文被整段搬到别的行/列后照常解密。成本为零，建议至少绑列名常量（绑行 id 则行迁移/合并时要小心）。
- **反例提醒**：Fernet 自身是 AES-**128**-CBC+HMAC 时代的产物（且 key 是 128-bit 签名 + 128-bit 加密），**只借它的版本化与编码思想，不抄它的算法选择**；OWASP 明确 CBC 只是 GCM/CCM 不可用时的 fallback 且须配 encrypt-then-MAC。

### 依据

- [Fernet Spec](https://github.com/fernet/spec/blob/master/Spec.md)："Version ‖ Timestamp ‖ IV ‖ Ciphertext ‖ HMAC"，token = 其 base64url 编码；IV "must be chosen uniquely for every token"；HMAC-SHA256 "using a constant-time comparison function"。
- [Tink wire-format](https://developers.google.com/tink/wire-format)：`prefix || IV || ciphertext || tag`，prefix = 1B version + 4B key ID，前缀未认证仅作 hint；信封布局 "encrypted DEK length || encrypted DEK || ciphertext"（KMS 路线的对照物）。
- [Tink design/keysets](https://developers.google.com/tink/design/keysets)：keyset = "a non-empty list of keys in which one key is designated primary"；加密只用 primary，解密 "tries to decrypt with all keys"——**轮换 = 加新钥 → 全量铺开 → 才设 primary** 的三阶段纪律值得照抄到运维流程。
- [Node crypto](https://nodejs.org/docs/latest/api/crypto.html)：GCM 默认 128-bit tag；v26 起非默认 tag 长度必须显式 `authTagLength`；IV 随密文传递的惯例。
- NIST [SP 800-38D](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf) §5.2.1.1：多数应用推荐 96-bit IV（免 GHASH 预处理）；§8.3：非「96-bit 确定性构造」场景单密钥总加密次数 "shall not exceed 2^32"。

---

## 4. 运维：轮换、全表重加密、丢失/泄露响应

### 轮换与重加密做法对比

| 做法 | 机制 | 优点 | 代价 | 适用 |
|---|---|---|---|---|
| **keyId 双密钥 + lazy/批量重加密**（推荐本期） | 新密钥写入密钥配置并设为主；读到旧 keyId 密文即解出重写；后台脚本批量补扫 | 简单直观；无停机；渐进迁移 | 主密钥轮换**过一遍明文**（decrypt+encrypt）；批量期新旧并存 | 密钥条目少（本项目量级） |
| KMS 信封加密（每条密文带 DEK） | 每行存「KEK 加密过的 DEK」+ DEK 加密的数据体；轮 KEK 只重包 DEK | 轮换**免明文重写**；AWS 原话："Key rotation has no effect on the data that the KMS key protects. It does not … re-encrypt any data protected by the KMS key." | 架构复杂度陡增；每行多一段 wrapped-DEK | 合规/多服务/海量行时 |
| Vault Transit `rotate` + `rewrap` | 服务端持钥、密文带 key version；`rotate` 出新版本，`rewrap` 免明文升版本 | 明文全程不出库；rewrap "possible to delegate … to untrusted users or scripts" | 依赖 Vault 可用性 | 已有 Vault 的组织 |
| OWASP「新钥写、旧钥读」渐进 | "Introducing new keys for Write operations, Leaving old keys for Read operations" | 明确的两阶段纪律 | 与 keyId 方案同 | —（即推荐方案的流程骨架） |

**推荐方案的轮换流程**（吸收 Tink 三阶段 + OWASP 两阶段）：

1. 生成新密钥（新 keyId），加入密钥配置并设为主——**先双钥并存**，旧钥仍标「可解密」；
2. 新写入一律用主密钥；读路径 lazy 重写旧密文；
3. 后台幂等脚本 `SELECT … WHERE 密文 LIKE 'v1:k0:%'` 逐行 decrypt→encrypt 补齐（游标分页、失败跳过记日志、可断点续跑；明文只在内存瞬时存在）；
4. 确认 `k0` 密文清零后，把旧钥从配置摘除（或标记 disabled 保留一个观察期再删）；
5. **轮换代码与脚本必须在需要之前就绪**——OWASP："rotation code/processes [must exist] before they are required"（泄露时要的是立刻能跑，不是现场写）。

注意密钥条目与「凭据本体」是两层：轮换主密钥**不**改变 API Key 明文本身；凭据本体的轮换（去供应商换 Key 再走一遍录入）是另一条运维动作，只在泄露响应时触发。

### 主密钥丢失 / 泄露响应

| 事件 | 响应 | 依据/说明 |
|---|---|---|
| **泄露**（密钥文件/环境被读走） | ① 生成新主密钥立即上线（进双钥流程）；② 全表重加密旧密文；③ **把所有被保护凭据视为已泄露**，逐个去供应商轮换 API Key/凭据真实值并重新加密入库；④ 追查泄露面（env 是否进了日志/镜像） | 密钥泄露 = 全部明文已泄；只换密钥不换凭据等于没换 |
| **丢失**（密钥文件误删/环境变量没传对/备份不可用） | 密文**永久不可恢复**（AEAD 无后门、无密钥托管即无救援）；只能从各供应商重配凭据 | 因此主密钥必须有**与数据库分离**的备份：OWASP "backups of encryption keys … in separate storage (e.g., cold storage)"；单钥丢失即全废是本方案对「简单」付出的对价 |
| **疑似 IV 复用事故**（实现 bug 致同钥同 IV） | 换新主密钥 + 全表重加密 | NIST：GCM IV 复用后安全保证"almost entirely"崩塌且事后无法界定损失边界，只能 rekey |

### 依据

- AWS KMS [rotate-keys](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html)："Key rotation has no effect on the data that the KMS key protects. It does not rotate the data keys … or re-encrypt any data protected by the KMS key."；KEK 定位："wrapping keys … encrypt the data keys that encrypt your data"；数据钥用量纪律："It's best to use data keys once, or just a few times, to mitigate this key exhaustion."
- AWS KMS [data-keys](https://docs.aws.amazon.com/kms/latest/developerguide/data-keys.html)：`GenerateDataKey` 返回明文 DEK + 加密 DEK 副本；"After using the plaintext data key to encrypt data, remove it from memory as soon as possible. You can safely store the encrypted data key with the encrypted data."
- GCP [Envelope encryption](https://cloud.google.com/kms/docs/envelope-encryption)：每次写入新 DEK 则 "you don't need to rotate the DEKs"；推荐 "256-bit Advanced Encryption Standard (AES) in Galois Counter Mode (GCM)"；解密时须 "identify the KEK that wrapped the DEK"（密文必须携带密钥版本线索——即 keyId 的由来）。
- HashiCorp [Vault Transit](https://developer.hashicorp.com/vault/api-docs/secret/transit)：`rotate` 后 "new plaintext requests will be encrypted with the new version of the key"；`rewrap` "never returns plaintext"；`min_decryption_version` "can prevent old copies of ciphertext from being decrypted"（旧密文可被强制过期——对应本方案「摘除旧钥」步骤）。
- [Tink design/keysets](https://developers.google.com/tink/design/keysets)：轮换顺序 "the KMS should add a new key to the keyset (but not yet set it as a primary)" → 铺开 → "Only then should the new key be made primary"。
- OWASP [Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) 轮换触发条件：密钥疑似泄露（含 "someone who had access to the key leaving the organization"）、cryptoperiod 到期（NIST SP 800-57）、加密数据量触顶、算法假设变化；旧数据 "prefer re-encrypting with the new key over keeping multiple keys"；轮换流程须事前就绪。
- OWASP [Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)：轮换应自动化；"Gradual rotation … Introducing new keys for Write operations, Leaving old keys for Read operations"；rotation "may trigger full or partial data re-encryption"；密钥备份放独立存储。

---

## 5. 常见错误模式对照表

| # | 错误模式 | 后果 | 正确做法 | 来源 |
|---|---|---|---|---|
| 1 | **IV/nonce 复用**（同钥同 IV 加密两条以上明文） | GCM 灾难：密钥流失量 XOR 直接泄露明文异或、认证密钥可被恢复进而**任意伪造**；NIST 原话：重复一次即可能落入伪造攻击，"in practice, this requirement is almost as important as the secrecy of the key" | 每条密文 `randomBytes(12)` 全新 IV；禁止计数器/派生式 IV 方案 | [NIST SP 800-38D](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf) §5.1/§8；[libsodium](https://libsodium.gitbook.io/doc/secret-key_cryptography/secretbox.md)："never ever be reused with the same key" |
| 2 | **用口令/弱 KDF 直接当密钥**，或用已死的 `createCipher` | DEP0106 原话："a weak key derivation function (MD5 with no salt) and static initialization vectors"，v22 已 End-of-Life | 主密钥 = CSPRNG 生成的 32 字节随机量（`randomBytes(32)`）；从不从口令派生 | [Node DEP0106](https://nodejs.org/api/deprecations.html#dep0106-cryptocreatecipher-and-cryptocreatedecipher) |
| 3 | **密钥硬编码 / 入 git / docker build 期 ENV** | 仓库/镜像拿到 = 密钥拿到；开源即全泄 | config 与 code 分离、env 注入、`.env.example` 只留变量名 | [12factor/config](https://12factor.net/config)；[OWASP Secrets](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)："never be hardcoded using docker ENV or docker ARG" |
| 4 | **密钥与密文同库**（主密钥写进 MySQL 配置表/跟密文同一备份） | SQLi/拖库/备份泄露一箭双雕 | 密钥在部署面（env/文件/KMS），密文在库；密钥备份独立存放 | [OWASP Secrets](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)："You should not store keys next to the secrets they encrypt"；[OWASP Crypto](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)：单一攻破路径不得同时拿到钥与数据 |
| 5 | **明文进日志/报错/导出/调试打印**（含解密失败时打印上下文变量、`JSON.stringify` 整个配置对象） | 日志系统成为第二泄密面；管道输出可被旁听 | "Never be logged (must implement either an encryption or masking approach)"；错误信息只报「解密失败」不带输入输出；导出/回显全链路掩码 | [OWASP Secrets](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) logging 节 |
| 6 | **用无认证模式**（ECB/CBC 裸用）或**手搓加密不带 MAC** | 静态 IV/padding oracle/可篡改不被发现 | 只用 AEAD（GCM/CCM "first preference"）；tag 必须随密文存并解密时校验 | [OWASP Crypto](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) |
| 7 | **密文不带版本/密钥标识** | 想轮换/换算法时全表成「不知用哪把钥的死密文」，只能停机硬迁 | 信封串强制 `版本: keyId : …` 段；keyId 仅是 hint，防篡改靠 GCM tag | [Tink wire-format](https://developers.google.com/tink/wire-format)；GCP 解密须 "identify the KEK that wrapped the DEK" |
| 8 | **把 API Key 做单向哈希存** | 丧失可逆性——API Key 要拿去调用云端，必须可还原 | 密钥类凭据用可逆 AEAD；单向哈希（argon2/bcrypt/scrypt）**只**用于登录口令 | [OWASP Crypto](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)：password storage "Don't use reversible encryption"（反向即本条） |
| 9 | **IV/tag 处理自作主张**（tag 截短省长度、自管 IV 计数、解密不 setAuthTag） | tag 截短降低伪造门槛；忘 setAuthTag 的解密路径形同虚设；Node 文档：无 tag 或篡改 "cipher text should be discarded" | IV 随机 12B、tag 全 16B、`setAuthTag` 后以 `final()` 抛错为准丢弃密文 | [Node crypto](https://nodejs.org/docs/latest/api/crypto.html) |
| 10 | **轮换脚本临时写、明文落临时表/文件** | 重加密过程制造新的泄密面 | 脚本事前就绪（OWASP "before they are required"）；流式逐行处理，明文不落盘 | [OWASP Crypto](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) |

---

## 附：与本仓库现状的衔接观察

- `ai-test-tools-site/server/src/features/datafactory/tools.ts` 里的 `aesEncrypt/aesDecrypt`（aes-256-cbc + 口令派生 + base64）是**数据工厂给造数用的演示/工具加解密**，不是密钥存储方案——其 CBC 无认证、口令派生模型不满足入库密钥要求，**不要**在实现时顺手复用它。
- 服务端目前没有任何密钥加密设施（全库 grep 仅见 `randomUUID`/`createHash` 与上述工具）——本方案是绿地实现，无历史密文兼容负担；存量明文数据的加密迁移属票 10（migration-strategy）范围。
- 日志面现状：`server/src/logger.ts` 存在——票 09 的「日志/错误/导出脱敏」验收项应指名覆盖 logger 输出路径。

## 来源清单

1. Node.js Crypto API — <https://nodejs.org/docs/latest/api/crypto.html>
2. Node.js DEP0106（createCipher/createDecipher）— <https://nodejs.org/api/deprecations.html#dep0106-cryptocreatecipher-and-cryptocreatedecipher>
3. libsodium AEAD 参数表 — <https://libsodium.gitbook.io/doc/secret-key_cryptography/aead.md>
4. libsodium secretbox — <https://libsodium.gitbook.io/doc/secret-key_cryptography/secretbox.md>
5. OWASP Secrets Management Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>
6. OWASP Cryptographic Storage Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html>
7. NIST SP 800-38D（GCM）— <https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf>
8. AWS KMS Key Rotation — <https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html>
9. AWS KMS Data Keys — <https://docs.aws.amazon.com/kms/latest/developerguide/data-keys.html>
10. GCP Cloud KMS Envelope Encryption — <https://cloud.google.com/kms/docs/envelope-encryption>
11. HashiCorp Vault Transit API — <https://developer.hashicorp.com/vault/api-docs/secret/transit>
12. Google Tink Keysets 设计 — <https://developers.google.com/tink/design/keysets>
13. Google Tink Wire Format — <https://developers.google.com/tink/wire-format>
14. Fernet Spec — <https://github.com/fernet/spec/blob/master/Spec.md>
15. 12factor Config — <https://12factor.net/config>
16. noble-ciphers — <https://github.com/paulmillr/noble-ciphers>
17. sodium-native — <https://github.com/holepunchto/sodium-native>
