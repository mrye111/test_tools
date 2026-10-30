---
title: 非数据库持久化数据全量盘点
type: task
status: closed
assignee: claude
blocked_by: []
---

## Question

全量盘点「非数据库持久化数据」，输出清单表（AFK 可执行），作为迁移票 10 的事实地基。结果直接写进本票 `## Resolution`：

1. **前端 localStorage 全部键（含动态键）**：`nexuskit_model_configs` / legacy `nexuskit_model_config`、`requirement-analysis-v2-handoff`、`ai-run-entry:*`、自动化导入入口键等——每个键给出：键名、读写位置（文件:行）、内容形状、持久/瞬态判定、是否含密钥
2. **服务端文件式存储**：automation.config.json 及一切 JSON 文件落盘 / 内存兜底（各 feature 的 store / config）——路径、读写位置、内容形状、是否含密钥
3. **已入库确认**：哪些数据已由 MySQL 覆盖、无需迁移（testcase / report / automation / requirement-v2 的 mysql-repository）

查全方法建议：全局搜 `localStorage`、`writeFile` / `readFileSync` / `writeFileSync`、`config-store`、`store.json`。动态键（模板拼接键名）要还原出键名模式。

## Resolution

全量盘点完成（搜法：src/ 全量 `localStorage|sessionStorage|indexedDB`；server/ 全量 `writeFile|readFileSync|mkdirSync|appendFile`，并逐一核对读写点与内容类型）。

### 一、前端 localStorage（共 5 键）

| 键名 | 读写位置 | 内容形状 | 判定 | 含密钥 |
|---|---|---|---|---|
| `nexuskit_model_configs` | `model-config-store.ts:226` 读 / `:256` 写 | `{ models: UniversalProvider[], activeModelId }` | **持久（迁移目标）** | **是**（`models[].apiKey` 明文） |
| `nexuskit_model_config`（legacy） | `:233` 读（回退）/ `:199` 迁移后删 / `:203` 兼容写 | 单条 `LegacyStoredModelConfig` | 持久遗留（加载时并入新键） | **是**（`apiKey`） |
| `requirement-analysis-v2-handoff` | 定义 `handoff.ts:3`；写 `RequirementAnalysisViewPage.tsx:201`；读后即删 `TestCasePage.tsx:297-299` | 需求条件接力载荷 | **瞬态（已排除，不入库）** | 否 |
| `ai-run-entry:${previewSetId}` | `TestCasePage.tsx:600` 读 / `:610` 写 | 用例生成入口 URL 字符串（按用例集记忆） | 持久小偏好 | 否 |
| `requirement-import-entry-${recordId}` | 定义 `RequirementImportDialog.tsx:37-39`；读 `:72` / 写 `:118` | 自动化导入入口 URL 字符串（按分析记录记忆） | 持久小偏好 | 否 |

无 sessionStorage、无 IndexedDB；另两处 `localStorage` 出现（SettingsPage.tsx:206、ModelConfigModal.tsx:749）仅为界面文案。

### 二、服务端文件式存储

| 路径 | 读写位置 | 内容形状 | 判定 | 含密钥 |
|---|---|---|---|---|
| `server/data/testcase-store.json` | 默认路径 `store.ts:106`；读 `:154-170`；原子写 `:39-68` | `TestCaseStoreData {projects, testSets, testCases, generationJobs}` | **迁移目标**（现状=MySQL 写穿透 + 离线备份锚点；MySQL 挂时回退纯文件） | **是**：`generationJobs[].request` 内嵌 `ai_config.apiKey` 明文（`types.ts:63` `request: JsonObject` ← 创建任务时的请求体） |
| `server/automation.config.json` | 路径 `config-store.ts:41`；读 `:55-68`；原子写 `:70-76` | `AutomationConfigFile {model{baseUrl,apiKey,modelName,family}, execution, fastEngine{jevApiKey,jevBaseUrl,layaBaseUrl}, credentials{键→真实值}}` | **迁移目标** | **是**（`model.apiKey`、`fastEngine.jevApiKey`、`credentials` 全部真实值） |
| `server/.env` | `shared/db/config.ts:23-35` `loadDotEnv`；automation 配置 `.env` 兜底 | 部署环境变量（DB 密码、MIDSCENE_*、JEV 等） | 部署配置——预期不迁库，边界由票 10 裁定 | **是** |
| LOG_DIR 日志文件 | 创建 `logger.ts:13`；只读 `log-routes.ts:46` | pino 运行日志 | 运行日志——预期留文件 | 否（`sanitizeError` 已脱敏） |
| `.jmx` 导出产物 | `jmeterBackend.ts:122-123` 写 / `:131` 读 | 用户导出的 JMeter 脚本 | 生成产物——非数据存储 | 否 |
| assets（chart-fragments 等） | `report/fragments.ts:17,32,41` 只读 | 代码资产 | 只读资产 | 否 |

### 三、无文件持久化的内存兜底（重启即丢，供票 10 定性）

- **report**：`MemoryReportRepository`（`repository.ts`）——MySQL 不可用时的回退；可用时走 `MysqlReportRepository`（`tr_reports`，`mysql-repository.ts:80`）
- **requirement-v2**：分析任务注册表（`jobs.ts` 进程内缓存，天然瞬态）+ `AnalysisRepository`（MySQL）
- **automation**：`memory-repository.ts` + `mysql-repository.ts` 同模式

### 四、已入库确认

- **testcase**：`tc_*` 四表（`mysql-persistence.ts:304`）；启动引导自动 JSON→DB 迁移（`migrate.ts:11-26`），JSON 文件保留为离线备份
- **report**：`tr_reports`；**automation / requirement-v2**：各有 `mysql-repository.ts` + `migrate.ts`

### ⚠ 给票 09 / 票 10 的警示

「已入库」≠「已加密」：**生成任务 `request` 内嵌 API Key 明文**已随用例域写入 `tc_*` 表；automation 配置迁库时 `model.apiKey` / `jevApiKey` / `credentials` 亦为明文。票 09 的加密覆盖字段清单必须包含这三类，票 10 迁移时存量明文要一并重加密。
