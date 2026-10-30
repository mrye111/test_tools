---
title: 密钥加密方案锁定
type: grilling
status: closed
assignee: claude
blocked_by: [02]
---

## Question

吃研究票《密钥加密与主密钥管理实践调研》的结论，拍板锁定密钥加密方案（HITL）：

- 算法与库选型
- 主密钥来源与多环境（dev/prod）管理
- 密文版本化与轮换策略（做 / 不做 / 留接口）
- **加密覆盖字段清单**：云端模型配置 API Key、自动化凭据真实值，及未来密钥字段的纳入规则。⚠ 票 03 盘点新发现的三类密钥载体必须一并裁定：① 生成任务 `request` 内嵌 `ai_config.apiKey`（已随用例域写入 `tc_*` 表的存量明文）；② `automation.config.json` 的 `model.apiKey` / `fastEngine.jevApiKey`；③ `credentials` 真实值
- 回显掩码规则与日志 / 错误信息 / 导出全链路脱敏强化要求

产出：可直接写进 spec 的技术决定段落。

## Resolution

四题逐项拍板后经用户确认的定稿全集：

1. **算法 + 主密钥**：`node:crypto` AES-256-GCM（每条随机 12B IV + 16B tag，AAD 可绑列名）；主密钥 = 环境注入 32 字节随机对称密钥（dev 走 gitignore 的 `server/.env`、prod 部署注入、每环境独立、禁入 git/镜像）。两红线随包锁定：GCM 同钥 IV 复用一票否决；API Key 必须可逆加密（要拿去调云端），单向哈希只留给登录口令。不用 libsodium/KMS（内网单体威胁模型下零依赖最简）。
2. **密文格式 + 轮换**：单列版本化信封 `v1:<keyId>:<b64url(iv)>:<b64url(ct‖tag)>`（版本位 + keyId 留好升级接口）；轮换做全套——新 keyId 设主 + 读路径 lazy 重写 + 幂等批量补扫脚本（新旧密钥三阶段并存，脚本事前就绪）。明确认账两个既定事实：重加密必须过明文（GCM 无 rewrap）；主密钥泄露 = 全表重加密**且**逐个轮换被保护的凭据本体。主密钥必须有与数据库分离的独立备份（丢失 = 密文永久不可恢复）。
3. **加密覆盖清单四类 + 最小加密原则**：
   1. 云端模型配置 `apiKey`（票 05 既有义务）
   2. 生成任务 `request` 内嵌 `ai_config.apiKey`（tc_* 表存量明文）——**写入时剥离**，密钥改存独立加密列，`request` 留脱敏占位符；不整列加密 `request`（过度加密会让调试/审计全盲）
   3. automation 配置 `model.apiKey` / `fastEngine.jevApiKey`（迁库时入加密列）
   4. `credentials` 凭据真实值（同上）
   - **未来纳入规则**：凡「明文可直接当第三方凭据使用」的服务端落库字段，一律走加密列，禁止混进大 JSON 明文列。
4. **脱敏全链路四条**：① 出站错误统一 redact 助手（现有 `sanitizeError` 模式提为共享层，任何出站错误必经）；② 日志禁钥（pino `redact` 路径配置，密钥字段永不落日志）；③ 导出物零密钥写死为契约；④ 明文瞬时驻留纪律——密钥明文只在「加密入库 / 取出使用」两处瞬时存在，不进任务中间产物、streamText、缓存。

**雾区裁决**：「密钥轮换 / 重加密运维流程要不要独立票」——第 2 条已把轮换全套锁进本方案（脚本属实施棒），无需拆票，已从雾区清除。详细依据见 [research/02-secret-encryption-practices.md](../research/02-secret-encryption-practices.md)。
