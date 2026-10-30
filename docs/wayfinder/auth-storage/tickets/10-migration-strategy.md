---
title: 存量迁移策略
type: grilling
status: closed
assignee: claude
blocked_by: ["03", "05", "06"]
---

## Question

存量迁移方案定稿（HITL，用 /grilling 逐题拍板），以票 03 的盘点清单为事实地基：

1. **老浏览器 localStorage 模型配置的首次登录导入**：导入向导 / 静默合并 / 放弃——与票 05 的 local↔cloud 搬运语义对齐
2. **automation.config.json 平迁入表**：步骤、热生效保持、回滚
3. **小偏好存量值迁移与归属落位**（按票 06 的归属结论）
4. **库表落地约定**：DDL 与 migrate.ts 落位（沿用各 feature migrate 先例）、迁移顺序、要不要双写/灰度
5. **存量明文重加密**（票 03 盘点警示）：`tc_*` 表中生成任务 `request` 内嵌的 apiKey 存量明文、automation 配置迁移时的密钥字段——何时加密、一次性脚本还是 lazy

## Resolution

四题逐项拍板后经用户确认的定稿全集：

1. **模型配置存量**：不需要「首次登录导入向导」——本地配置按票 05 豁免不入库（拨开关上云即既定迁移语义），legacy 键 `nexuskit_model_config` 现有代码已自动并入新键。**同浏览器多用户场景裁定：localStorage 按登录账号分命名空间隔离**——同浏览器不同账号各管各的本地配置（个人 API Key 不共用白嫖）；「本地」语义精化为「此浏览器 + 此账号」（CONTEXT.md 已同步修订），「换浏览器即丢」性质不变。
2. **URL 记忆存量**：首次登录静默上送一次——检测到本地记忆键（`ai-run-entry:*`、`requirement-import-entry-*`）有值即按当前用户入库（无值不动作），送完即删本地键；习惯无缝续命。
3. **服务端存量（一次性幂等脚本包，编入启动 bootstrap 序列）**：
   - `automation.config.json` → 读文件写库（`model.apiKey`/`jevApiKey`/`credentials` 按票 09 入加密列）→ 原文件重命名 `.bak` 归档；**不双写**；config-store 切为读库 + 进程缓存，「保存即热生效」语义不变
   - `tc_*` 存量 `request` 内嵌 `ai_config.apiKey` → 剥离入独立加密列（幂等可重跑，跑一半崩了重启续上）
   - 明文存量**一次清零、可审计**，不留 lazy 尾巴
4. **落地约定**：按域落位——`users`/`sessions`/`user_preferences` 归新 auth 域，automation 配置表归 automation 域，**加密助手归 shared**（各域共用）；各域沿用 `mysql-repository.ts` + `migrate.ts` 先例。迁移顺序：shared 加密助手 → auth → 个人偏好 → automation 平迁 → `tc_*` 剥离重加密。**不做双写/灰度**：内网小团队，分钟级停机一次切换；回滚 = 版本回退 + `.bak` 文件反向导入脚本。
