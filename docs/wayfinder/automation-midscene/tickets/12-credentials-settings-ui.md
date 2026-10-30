---
title: 凭据与模型配置的界面化管理
type: task
status: closed
assignee: main-session
blocked_by: []
---

## Question

当前凭据（varDefs 指向的服务端配置键名）和 MIDSCENE_MODEL_* 都写在 server/.env，只能手改文件。落地界面化：

1. **Settings 页加「UI 自动化」配置块**：模型四件套（baseUrl/apiKey/model/family）+ 执行参数（超时、并发、缓存默认开关），写入 server/.env（或服务端配置文件），保存后无需重启生效（模型配置热加载/重建 agent 配置）；
2. **凭据键值管理界面**：新增/删除"配置键名 → 真实值"（值写服务端配置，前端永不回显真实值，只显示"已设置"）；编辑器 varDefs 下拉选择已有键名代替手输；
3. 服务端配置从纯 .env 演进为 .env + 配置文件合并（.env 兜底，界面写入配置文件），注意 key 不落库不进前端的原则不破（票据 05）。

产出：用户不再手改任何文件即可完成模型与凭据配置。

## Resolution

2026-09-21 完成。用户不再手改任何文件即可完成模型与凭据配置。

**配置存储**：`server/automation.config.json`（已加入根 .gitignore）+ server/.env 兜底（配置文件优先），保存即应用到进程环境——热生效无需重启。

**落地内容**：

- **配置入口**：放在「自动化测试」菜单的第四主区「配置」（而非全局 Settings 页——自动化 VLM 与全局文本 LLM 是两套配置，模块内聚合更内聚；此为本票「Settings 页加配置块」的等效变体）
- **模型四件套**：baseUrl/modelName/family/apiKey，apiKey 只在显式提供时更新，界面只回显"已设置+尾 4 位"；保存后**自动重跑定位冒烟**（引擎状态即时反映新配置，失败标降级）
- **执行参数**：单步超时（10–1800s）/ 全局并发（1–5）/ 执行缓存默认开关；RunManager 按稳定引用持有 settings，保存后下一批执行即生效
- **凭据键值管理**：新增/删除 KEY_NAME → 真实值；真实值只进服务端配置文件与进程环境，接口只回键名+掩码尾 4 位（票据 05 原则不破：不落库、不回传前端）
- **编辑器联动**：varDefs 值字段改为 datalist，可直接选择已配置的凭据键名

**API**：`GET/PUT /api/automation/config*`、`GET/PUT/DELETE /api/automation/credentials*`。

**验证**：config-store 6 个单测（含"完整 key 不出现在任何接口视图"断言）+ 全量回归（服务端 348、前端 483）+ 实测：.env 兜底读取、并发 3→2 热生效、凭据设置/掩码列表、配置页渲染正确。
