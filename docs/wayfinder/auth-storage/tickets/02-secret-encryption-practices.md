---
title: 密钥加密与主密钥管理实践调研
type: research
status: closed
assignee: agent-research-02
blocked_by: []
---

## Question

调研 Node/TypeScript 服务端「入库密钥字段统一加密」的现行工程实践，给出推荐方案与权衡表，供票据 09 锁定：

1. **算法与库**：AES-256-GCM（或替代方案）——`node:crypto` vs libsodium 等库的取舍
2. **主密钥来源**：env / 密钥文件 / KMS 的适用边界与多环境（dev/prod）管理惯例
3. **密文格式**：IV/nonce 管理、密文版本化（支持算法/密钥轮换）、编码与字段长度
4. **运维**：密钥轮换与全表重加密的做法、主密钥丢失/泄露的响应
5. **常见错误模式**：IV 重用、密钥硬编码、密钥与密文同库、日志泄露等

产出：推荐方案 + 明确权衡。资料以官方文档与主流库仓库为准。

## Resolution

**推荐方案**：入库密钥字段统一用 `node:crypto` AES-256-GCM（12B 逐条随机 IV + 16B 默认 auth tag，可选 AAD 绑列名）；主密钥 = 部署环境注入的 32 字节随机对称密钥（dev 走 gitignore 的 `.env`、prod 走部署注入、每环境独立，禁入 git/镜像）；密文存单列版本化信封串 `v1:<keyId>:<b64url(iv)>:<b64url(ct‖tag)>`（版本 + keyId 支撑算法/密钥轮换）；轮换 = 新 keyId 设主 + 读路径 lazy 重写 + 幂等批量脚本补扫（新旧密钥三阶段并存，脚本事前就绪）；主密钥泄露 = 换主钥全表重加密 **且** 逐个轮换被保护凭据本体，主密钥丢失 = 密文永久不可恢复，故主密钥必须有与数据库分离的独立备份；明文仅在加密入库/取出使用两处瞬时驻留，回显掩码、日志/错误/导出全链路禁明文。

**关键权衡**：不用 libsodium/noble-ciphers——`node:crypto` 零依赖零供应链且服务器有 AES-NI，GCM 正是 OWASP 首选认证模式（退路：格式带版本号，未来可换 XChaCha20）；不做 KMS/信封 DEK——内网单体威胁模型下 env 注入足够且最简，代价是主密钥轮换需过一遍明文全表重写（KMS 信封才能免明文 rewrap），凭据行数少可接受，keyId/版本位已为平滑升级 KMS 留好接口；IV 必须逐条随机永不复用——GCM 同钥 IV 复用是灾难级（NIST：重复概率须 ≤2^-32，"almost as important as the secrecy of the key"），一切确定性/计数器 IV 方案一票否决；不用哈希存 API Key——必须可逆（拿去调云端），单向哈希只留给登录口令。

详细依据见 [research/02-secret-encryption-practices.md](../research/02-secret-encryption-practices.md)
