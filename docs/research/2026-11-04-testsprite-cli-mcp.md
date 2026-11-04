# TestSprite 第一方 CLI 与 MCP 契约调研

- 对应 issue：[mrye111/test_tools#43](https://github.com/mrye111/test_tools/issues/43)
- 调研日期：**2026-11-04**
- 范围：当前第一方 TestSprite CLI、MCP Server，以及它们与 Web Portal 在 projects、Sources、plans/test cases、runs、Test Lists、Schedules、CI 上的契约边界。
- 非目标：不提出 NexusKit 实现方案，不评估第三方替代品，不复刻 UI。
- 安全边界：本次仅做只读文档、官方 GitHub 源码和 npm registry/tarball 静态核验；**没有安装或执行 TestSprite 包，没有认证或调用 TestSprite 服务，没有连接或修改参考项目，没有进行 issue/PR/git 写操作**。

> 除特别说明外，文中所有 URL 的访问日期均为 **2026-11-04**。`[A]`、`[B]` 等标记是证据等级，不是产品成熟度。

## 1. 结论摘要

1. 当前官方入口是 npm 包 [`@testsprite/testsprite-cli@0.16.0`](https://registry.npmjs.org/@testsprite%2Ftestsprite-cli/0.16.0) 和 [`@testsprite/testsprite-mcp@0.0.48`](https://registry.npmjs.org/@testsprite%2Ftestsprite-mcp/0.0.48)。前者暴露 `testsprite`，后者暴露 `testsprite-mcp-plugin`；官方 IDE 配置通常通过 `npx @testsprite/testsprite-mcp@latest` 间接启动，而非直接写 bin 名。[A]
2. CLI 的机器契约是 **`--output json` + exit codes**。文本输出不是稳定解析接口；JSON 成功载荷在 stdout，JSON 错误 envelope 在 stderr。CLI 覆盖项目、环境、登录、Sources 文档上传、用例、计划、运行、失败包、Test Lists、Schedules、CI 和 tunnel，是三端中最完整的可脚本化表面。[A]
3. MCP 0.0.48 是 **stdio tool server**，只声明 `tools` capability，发布包只注册 `tools/list` 与 `tools/call`；没有注册 resources 或 prompts。8 个工具覆盖本地项目初始化、代码摘要、标准化 PRD、前/后端计划、生成并执行、打开本地结果 dashboard、账户查询；没有通用的 project/test/run/List/Schedule CRUD 工具。[B]
4. MCP 成功与业务错误都走 tool result：成功为 `content:[{type:"text",text:...}]`， handler 内错误为同形内容加 `isError:true`。它没有 CLI 的 exit-code 语义，也没有 `structuredContent`。[B]
5. 三端共享后端、项目与测试对象，但能力并不重合：Portal 管账户/可视配置和全部 Sources；CLI 管可脚本化生命周期；MCP 管 IDE 内的本地代码到测试执行工作流。MCP 文档中的 GitHub App/Action 是另外的集成入口，不代表 stdio MCP 自身可在 CI 中运行。[A/B/C]
6. 当前文档与发布包存在实质漂移：`setup --api-key` 的文档自相矛盾、`--dry-run` 的“无网络”表述过宽、`test rerun`/`test flaky` 已在 0.16.0 源码中隐藏并弃用、MCP dashboard 参数和多个文件名已变、旧 `@testsprite/mcp-server` 命令仍残留在排障文档且 npm 返回 404。详见第 10 节。

## 2. 方法、证据等级与版本锚点

### 2.1 证据等级

| 等级 | 含义 |
|---|---|
| **A** | 当前官方文档、官方带 tag 源码、npm registry manifest；可直接作为文档事实或发布元数据。 |
| **B** | 对当前 npm 发布 tarball 的静态检查；证明该版本发布包内的实现，不等于对实时后端行为的实测。 |
| **C** | 从多个 A/B 事实得出的推断；会明确写成推断。 |
| **U** | 未能核验、需要真实调用或需要私有后台才能确认的未知项。 |

### 2.2 本次锁定的修订

| 对象 | 当前锚点 | 来源 |
|---|---|---|
| CLI | `v0.16.0`，tag commit `4b5ae55c44cfd3dffae59b861580f32d236b39c1` | [release tag](https://github.com/TestSprite/testsprite-cli/releases/tag/v0.16.0)、[tagged package.json](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/package.json) [A] |
| 官方文档 | Docs `v1.0` 分支，核验时 commit `bffbaa0fa44d5ddddfee77241f1827e32bf808ff` | [TestSprite/Docs](https://github.com/TestSprite/Docs/tree/v1.0) [A] |
| MCP | npm `0.0.48` tarball；未找到官方公共实现仓库，包 manifest 也没有 `repository`/`homepage` 元数据 | [version manifest](https://registry.npmjs.org/@testsprite%2Ftestsprite-mcp/0.0.48)、[tarball](https://registry.npmjs.org/@testsprite/testsprite-mcp/-/testsprite-mcp-0.0.48.tgz) [A/B] |

## 3. 当前包与命令可用性

| 项目 | CLI | MCP |
|---|---|---|
| 当前 `latest` | `0.16.0` | `0.0.48` |
| 发布时间 | `2026-11-01T08:06:33.187Z` | `2026-10-31T01:04:02.501Z` |
| npm bin | `testsprite -> dist/index.js` | `testsprite-mcp-plugin -> dist/index.js` |
| Node engine | `^20.19.0 || ^22.13.0 || >=24` | `>=22` |
| 当前版本 deprecated | 否 | 否 |
| 公开实现来源 | [TestSprite/testsprite-cli](https://github.com/TestSprite/testsprite-cli) | 未找到公共仓库；以发布包静态检查为准 |

来源：[CLI packument](https://registry.npmjs.org/@testsprite%2Ftestsprite-cli)、[CLI 0.16.0 manifest](https://registry.npmjs.org/@testsprite%2Ftestsprite-cli/0.16.0)、[MCP packument](https://registry.npmjs.org/@testsprite%2Ftestsprite-mcp)、[MCP 0.0.48 manifest](https://registry.npmjs.org/@testsprite%2Ftestsprite-mcp/0.0.48)。[A]

“可用”在此处仅表示 registry 可读取、版本存在且 manifest 声明了 bin；**不是实机安装/执行验证**。

### 3.1 旧名称与无关名称

以下 scoped/unscoped 名称在 npm 于本次访问时均返回 404 `Not found`：[A]

- [`@testsprite/mcp-server`](https://registry.npmjs.org/@testsprite%2Fmcp-server)
- [`testsprite-cli`](https://registry.npmjs.org/testsprite-cli)
- [`testsprite-mcp`](https://registry.npmjs.org/testsprite-mcp)
- [`@testsprite/cli`](https://registry.npmjs.org/@testsprite%2Fcli)
- [`@testsprite/mcp`](https://registry.npmjs.org/@testsprite%2Fmcp)
- [`@testsprite/testsprite`](https://registry.npmjs.org/@testsprite%2Ftestsprite)

[`testsprite`](https://registry.npmjs.org/testsprite) 这个不带 scope 的名称存在（访问时 `latest=0.1.0`），但当前官方安装文档没有指向它；不能把它当作上述第一方 CLI/MCP 的入口。[A]

MCP packument 中 `0.0.20`、`0.0.24`、`0.0.34`、`0.0.35`、`0.0.43` 有 deprecated 标记；其中 `0.0.43` 的原因明确为“发布时没有 build/dist，使用 0.0.44+”。这是 registry 版本事实，不影响当前 `0.0.48`。[A｜[MCP packument](https://registry.npmjs.org/@testsprite%2Ftestsprite-mcp)]

## 4. 三端完整覆盖矩阵

主要来源：[CLI Overview](https://github.com/TestSprite/Docs/blob/v1.0/cli/getting-started/overview.mdx)、[CLI Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[MCP Tools](https://github.com/TestSprite/Docs/blob/v1.0/mcp/core/tools.mdx)、[Portal Sources](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/setup/project-sources.mdx)、[Portal Test Lists](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/maintenance/test-lists.mdx)、[Portal Monitoring](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/maintenance/monitoring.mdx)。[A；MCP 包差异标 B]

| 领域 | Web Portal | CLI 0.16.0 | MCP 0.0.48 |
|---|---|---|---|
| **Projects** | 创建、设置、Sources、成员/工作区相关管理 | `project` CRUD；环境、登录、backend credential/auto-auth、文档上传 | `bootstrap` 初始化本地项目配置；无 list/get/update/delete 工具 |
| **Sources：PRD** | 上传，frontend/backend 均可 | `project docs upload --role prd` | 本地 `tmp/prd_files` + 标准化 PRD 工作流；不是 Portal Sources 管理 API |
| **Sources：API Doc** | 上传，backend only，用于 endpoint discovery/review | `project docs upload --role api-doc` | 无直接上传/管理 Portal API Doc 的工具 |
| **Sources：Web Exploration** | 对 frontend live app 做 Agent Web Exploration | 未发现直接管理命令 | 使用本地代码和 live local app；未发现对应 Portal exploration 管理工具 |
| **Sources：Test Files** | fixtures 附件库，Beta、plan-gated | 未发现附件库 CRUD 命令 | 未发现对应工具 |
| **Frontend plan** | 可视查看/编辑相关测试对象 | plan JSON 创建；`scaffold`、`lint`、`plan put/generate/accept` | 生成标准化 PRD 与 frontend plan 文件；由 AI 和本地 dashboard 继续处理 |
| **Backend test definition** | Portal 管理测试对象 | Python/pytest 风格代码，`code get/put` | 生成 backend plan 并生成/执行测试代码 |
| **Test cases** | 查看、编辑、执行 | list/get/create/create-batch/update/delete/delete-batch/open | 生成并执行；本地 dashboard 可查看/编辑/重跑；无通用 CRUD/list 工具 |
| **Runs** | dashboard、历史和报告 | run/wait/cancel/result/steps/diff/artifact/failure；单跑、批跑、重跑 | `generate_code_and_execute`；结果写本地文件并可在 dashboard 查看 |
| **Test Lists** | 跨项目、frontend/backend 混合；运行与维护 | 完整 CRUD、成员增删、环境绑定、整集运行 | 无工具 |
| **Schedules** | 创建、暂停、历史、通知等 | 完整 CRUD、cron、timezone、环境、run history | 无工具；continuous monitoring 由其他表面承接 |
| **CI** | GitHub App 配置在 Portal | `ci init github`、`ci run`；JUnit、annotations、job summary | stdio MCP 本身不是 CI 接口；文档另列 GitHub App/Action |
| **Local app / tunnel** | 无直接 tunnel 管理 | 自动或显式 tunnel；仅 frontend loopback 路径 | 本地 frontend app 通过 tunnel 执行 |
| **API keys** | 创建、过期、撤销、查看使用元数据 | 使用 env/profile；`setup` 写本地凭证，`auth status/remove` | IDE env `API_KEY`；`check_account_info` 查询 |
| **账户/额度** | 完整 billing/org 管理 | `usage`/`auth status` 只读 | `check_account_info` 只读 |
| **机器输出** | 非脚本接口 | 稳定 JSON + exit codes | text content + `isError`，无 CLI exit-code 契约 |

**边界推断 [C]：**若目标是“真实 CLI/MCP 复刻”，不能把 Portal 的每个设置页都等同于 CLI/MCP 公共契约；同样，也不能因为 MCP 能生成测试，就推断它具有 CLI 的项目、List、Schedule 管理能力。

## 5. CLI 契约

### 5.1 全局参数与通用规则

来源：[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[Configuration](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/configuration.mdx)。[A]

| 参数 | 契约 |
|---|---|
| `--output json\|text` | 默认 `text`；`json` 是稳定 agent/CI 接口 |
| `--profile <name>` | 选择 credentials profile；默认 `default` |
| `--endpoint-url <url>` | 覆盖 API host；对应 `TESTSPRITE_API_URL` |
| `--verbose` / `--debug` | retry/polling 或 HTTP 细节写 stderr |
| `--dry-run` | 输出样例响应；一般不需要凭证/文件系统，但“绝无网络”存在第 10 节所述例外 |
| `--request-timeout <seconds>` | 单请求 1–600 秒，默认 120；不是 run wait timeout |
| `-V, --version` / `-h, --help` | 输出并 exit 0 |

全局参数可放在子命令前或后。破坏性 `delete`、`delete-batch`、`tunnel stop --all` 需要 `--confirm`，CLI 不做交互确认。文档统称写命令接受 `--idempotency-key <token>` 以安全重试；同 key 不同 body 会冲突。[A]

### 5.2 顶层、认证与 agent 命令

来源：[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[v0.16.0 init.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/init.ts)、[v0.16.0 auth.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/auth.ts)。[A]

| 命令 | 参数/行为 | 输出与特殊退出 |
|---|---|---|
| `setup` | 校验 key（`GET /me`）、写 profile、安装 agent skills。`--api-key`、`--from-env`、`--agent`、`--no-agent`、`--force`、`--dir`、`-y/--yes`；release source 另有 `--skip-if-configured` | 无 TTY 且没有 key 来源时 exit 5。JSON agent 部分含 `targets/detections/detectedBy`；`--no-agent` 时 `agent:null`、`agentSkippedBy:"flag"` |
| `doctor` | 检查 CLI/Node/profile/endpoint/凭证/连通性/verify skill | 仅 FAIL 使退出非零，WARN 不失败 |
| `usage`（alias `credits`） | 无专用必填参数 | 当前 key 所在 workspace 的 plan、角色、credits、seats |
| `completion [bash\|zsh\|fish]` | 省略时从 `$SHELL` 检测 | 输出 completion script |
| `auth status` | 无专用必填参数 | user、masked key、env、scopes、workspace、plan、角色；缺 scope 时有 note |
| `auth remove` | 删除当前本地 profile 凭证 | **不撤销服务端 key，也不清除 `TESTSPRITE_API_KEY`** |
| `agent install [targets...]` | `--target` 可重复/逗号分隔；`--skill`；`--dir`；`--force` | 写 `testsprite-verify/onboard/ci`；目标冲突且无 force exit 6 |
| `agent list` | 无 | targets 与安装路径 |
| `agent status` | `--dir` | `ok/stale/modified/unmarked/absent/corrupt`；需处理状态 exit 1 |

`setup --agent` 支持 `claude`（GA）及实验目标 `cursor`、`cline`、`antigravity`、`kiro`、`windsurf`、`copilot`、`codex`；省略时检测项目中的 agent，无检测则落到 `claude`。多个显式目标使用 `agent install`。[A]

### 5.3 Projects、环境、登录与 Sources

来源：[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[Projects](https://github.com/TestSprite/Docs/blob/v1.0/cli/core/projects.mdx)、[Portal Sources](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/setup/project-sources.mdx)。[A]

| 命令 | 参数与语义 |
|---|---|
| `project list` | `--page-size 1..100`（默认 25）、`--starting-token`、`--max-items` |
| `project get <id>` | 项目字段、Default 环境、环境数 |
| `project create` | 必填 `--type frontend\|backend`、`--name`；`--url` 或 frontend `--local <port>`；另有 `--skip-preflight`、`--username`、`--password/--password-file`、`--instruction`、`--test-id-attributes` |
| `project update <id>` | 至少一项变化，否则 exit 5；接受 create 的项目设置参数，另有 `--clear-test-id-attributes` |
| `project delete <id> --confirm` | 永久删除项目、子项目、测试、backend fixtures，无恢复窗口 |
| `project env list/get` | `list <project-id>`；`get <project-id> <name>` |
| `project env create <id>` | 必填 `--name`，且 `--url`/`--local` 二选一；`--username`、`--password/--password-file`、重复 `--var KEY=VALUE`、`--sign-in public\|account\|otp\|manual`、`--otp-channel`、`--session-ttl`、`--set-default` |
| `project env update <id> <name>` | URL/local、凭证、变量、`--rename`、`--clear-credentials`、`--skip-preflight` 等 |
| `project env delete <id> <name> --confirm` | soft delete；删除 Default 前须先切换 |
| `project env set-default <id> <name>` | 改默认环境 |
| `project sign-in get <id>` | `--env`，默认 Default |
| `project sign-in set <id>` | `--mode public\|account\|otp\|manual`、`--env`、account 凭证、manual `--session-ttl 1..2592000\|never` |
| `project credential <id>` | backend 静态凭证：`--type public\|Bearer token\|API key\|basic token`；除 public 外需 `--credential` 或 `--credential-file` |
| `project auto-auth <id>` | 必填 `--method password\|refresh_token\|aws_cognito_refresh`、`--inject bearer\|header\|cookie`；`--inject-key`、`--disable` 及各方法专属参数 |
| `project docs upload <file>` | 必填 `--project`；`--role api-doc\|prd`（默认 `api-doc`）；`--name` 默认文件名 |

`auto-auth` 方法参数：[A]

- `password`：`--login-url`、`--login-method POST|PUT`、`--login-content-type`、`--login-body-template`（支持 `{{username}}`/`{{password}}`）、`--username`、`--password/--password-file`、`--token-path <jsonpath>`。
- `refresh_token`：`--token-endpoint`、`--client-id`、`--client-secret/--client-secret-file`、`--refresh-token/--refresh-token-file`、`--scope`。
- `aws_cognito_refresh`：`--region` 加 refresh-token 相关参数。

URL/环境限制：非 loopback 必须是公共 HTTP(S)，private IP 会被拒；backend 不允许 loopback tunnel。frontend `--local` 要求带端口的 loopback HTTP origin。Free/Starter 1 个环境、Standard 3 个、Pro/Enterprise 不限；超限 exit 13。`--target-url`/临时 local 环境不占命名环境额度。[A]

### 5.4 Test cases 与 plans

来源：[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[Creating Tests](https://github.com/TestSprite/Docs/blob/v1.0/cli/core/creating-tests.mdx)、[v0.16.0 plan.schema.json](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/schemas/plan.schema.json)。[A]

| 命令 | 主要参数 | 输出/退出要点 |
|---|---|---|
| `test list --project <id>` | `--env`、`--type`、`--created-from portal\|mcp\|cli`、`--status`、分页参数 | JSON 含 `statusByEnvironment`；list 另有 `headlineEnvironment`；`--target-url` 运行不改列表状态 |
| `test get <id>` | 无专用必填参数 | 默认显示 Default 环境的最近结果 |
| `test create` | `--code-file` 或 frontend `--plan-from`；代码路径需 `--project --type --name`；另有 `--description`、`--priority`、backend `--produces/--needs/--category`；可接 `--run --wait` 等运行参数 | 输出 `testId/codeVersion/createdAt`，可用时有 `dashboardUrl` |
| `test create-batch` | `--plans <jsonl>` 或 `--plan-from-dir`；最多 50 个 frontend plans、总 5 MB；`--run/--wait/--timeout/--env/--target-url/--max-concurrency` | 批量创建，可立即运行；server 对每 key 每分钟 60 次 run trigger，CLI 节流/重试 |
| `test update <id>` | `--name/--description/--priority`；backend `--produces/--needs/--category setup\|main\|teardown` | 更新元数据/依赖 |
| `test delete <id> --confirm` | 无 | 删除 |
| `test delete-batch [ids...] --confirm` | 或 `--all --project` + `--status` | `Deleted N, Skipped M, Failed K`；全成功 0、部分失败 1、validation 5；404 计 skipped |
| `test open <id>` | `--no-browser` | 打开/给出 Portal 链接 |
| `test scaffold` | `--type frontend\|backend`、`--out`、`--force` | 离线生成起始 plan/backend 骨架 |
| `test lint` | `--plan-from`、`--plan-from-dir`、`--plans`、`--steps` 四选一 | JSON `{checked,valid,issues:[{file,field,reason}]}`；无效 exit 5 |
| `test code get <id>` | `--out` | 输出或写代码 |
| `test code put <id>` | 必填 `--code-file`；`--expected-version` 与 `--force` 互斥；`--language python` 唯一值 | codeVersion 变化 exit 6；force 有审计 |
| `test plan put <id>` | 必填 `--steps`；`--expected-step-count` | 替换 frontend `planSteps`；数量不匹配为 412/exit 6 |
| `test plan generate` | 必填 `--project`；`--timeout 1..3600`，默认 1800 | 分阶段生成待审 proposals，按实际运行阶段收费；中断/超时可续跑 |
| `test plan accept` | 必填 `--project`；`--only <ids...>` | 将 staged proposals 转为 tests，不另收费；subset 会丢弃其余，无 staged exit 6 |

文件限制：单个 plan ≤256 KB；backend code ≤350 KB；`test plan put` 的 steps 文件 ≤256 KB、最多 200 步。[A]

#### Frontend plan JSON 的机器契约

[A｜[plan.schema.json](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/schemas/plan.schema.json)]

- 顶层必须是 object，必填 `projectId`、`type`、`name`、`planSteps`；一个文件只描述一个 test，顶层 array 会被拒。
- `type` 在完整 `--plan-from` 命令上只能是 `frontend`；backend 用 `--code-file`。
- `projectId` 和 `name` 必须为非空且非纯空白字符串；`description` 可选且允许空字符串。
- `priority` 接受不区分大小写的 `p0..p3` 或 `high/medium/low`。
- `planSteps` 为 1–200 项；每项必填 `type: action|assertion` 和非空非空白 `description`。
- schema 未禁止额外字段；`$schema` 被 CLI 忽略。`{{...}}` 占位符不由 CLI 替换，只会产生非致命 advisory。
- 文件 ≤256 KB 是独立 pre-flight 约束，不是 JSON Schema 自身的约束。

### 5.5 Runs、结果与失败包

来源：[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[Exit Codes](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/exit-codes.mdx)。[A]

| 命令 | 参数/行为 | 输出与退出 |
|---|---|---|
| `test run [ids...]` | 或 `--all --project` + `--filter`；`--allow-empty`；`--wait/--no-wait`；`--timeout 1..3600`；`--env`；frontend `--target-url` 或 `--local`；`--local-host`、`--skip-preflight`、`--tunnel-client`、`--no-cancel-on-interrupt`、`--max-concurrency`、`--no-auto-heal`、报告参数 | 默认 wait 600 秒，tunnel 默认 1200；loopback 自动 tunnel；`--no-wait` 不自动建 tunnel |
| `test wait <run-id...>` | `--timeout`（默认 600，多个 ID 共用）、`--max-concurrency`（默认 10） | 只轮询，不恢复已关闭 tunnel；多 ID 输出 `{results,summary}` |
| `test cancel <run-id...>` | 服务端取消，可重复 | 多 ID 输出 `{cancelled,alreadyCancelled,conflicts,notFound,errors}`；优先级 notFound→4、errors→1、conflicts→6 |
| `test rerun [ids...]` | 0.16.0 仍可用但已 hidden/deprecated；`--all/--project`、`--skip-terminal`、`--status`、`--filter`、`--allow-empty`、wait/env/auto-heal/backend dependency/report 参数 | 由 `test run` 替代，计划 0.17.0 删除；详见第 10 节 |
| `test flaky <id>` | 0.16.0 仍可用但 hidden/deprecated；`--runs 1..10`（默认 5）、`--until-fail`、`--timeout` | 稳定 0、flaky/failing 1、无 replayable run 4；计划 0.17.0 删除 |
| `test steps <test-id>` | `--run-id` | 指定或最近 run 的 step log |
| `test result <test-id>` | `--include-analysis`；`--history` 时可用 `--source`、`--env`、`--since`、`--columns`、`--no-header`；release source 还支持 `--rerun/--no-rerun` | 默认取所有环境中最新 run；analysis 增加 root cause/fix target/failureKind/snapshotId；backend 另有 `apiOutput/trace` |
| `test diff <run-a> <run-b>` | 比较 verdict、failureKind、step 翻转、codeVersion | verdict 相同 0，不同 1 |
| `test failure get <test-id>` | `--out`、`--failed-only` | 最近失败 run 的 failure bundle；无 saved code 可 exit 4 `no_code` |
| `test failure summary <test-id>` | 无专用必填参数 | 单屏 triage card |
| `test artifact get <run-id>` | `--out`、`--failed-only` | 固定 run 的 bundle；默认 `./.testsprite/runs/<run-id>/`；非终态 exit 6 `run_not_terminal` |

Failure bundle 包括失败 step 及相邻 steps、文本 DOM snapshots、test source、root-cause hypothesis、recommended fix target；同一 bundle 锚定同一 run snapshot。[A]

批量 `--wait` 的报告参数为 `--report junit --report-file <path>`、`--report-suite-name`、`--gh-output`、`--summary-file <path>`。summary-file 形状为：[A]

```json
{
  "total": 0,
  "passed": 0,
  "failed": 0,
  "skipped": 0,
  "timedOut": 0,
  "runs": []
}
```

local batch 主输出为 `{tunnel,maxConcurrency,results,skipped,summary}`，结果保持输入顺序，并可能包含 `not-run`。[A]

### 5.6 Test Lists

来源：[CLI Test Lists & Schedules](https://github.com/TestSprite/Docs/blob/v1.0/cli/integrations/test-lists-and-schedules.mdx)、[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[Portal Test Lists](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/maintenance/test-lists.mdx)。[A]

| 命令 | 参数与语义 |
|---|---|
| `testlist list` / `get <list-id>` | 查询列表/详情 |
| `testlist create` | 必填 `--name`；重复 `--project-env <projectId:env>` 绑定每个项目的执行环境 |
| `testlist update <list-id>` | `--name`；重复 `--project-env` 会**替换**绑定；`--clear-project-env` 清除 |
| `testlist add/remove <list-id> <test-id...>` | 增删成员 |
| `testlist delete <list-id> --confirm` | 同时删除该 list 的 schedules |
| `testlist run <list-id>` | 重复 `--case` 选择子集；`--wait/--no-wait`、`--skip-preflight`、`--timeout`（默认 600）、`--max-concurrency`、报告参数 |

List 可跨项目并混合 frontend/backend。loopback binding 会开 tunnel；`--no-wait` 时在 dispatch 前拒绝且不收费。[A]

### 5.7 Schedules

来源：[CLI Test Lists & Schedules](https://github.com/TestSprite/Docs/blob/v1.0/cli/integrations/test-lists-and-schedules.mdx)、[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[Portal Monitoring](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/maintenance/monitoring.mdx)。[A]

| 命令 | 参数与语义 |
|---|---|
| `schedule list` / `get <id>` | 查询；list 文本有 `ENVIRONMENT` 列，区分 pinned/inherits |
| `schedule create` | 必填 `--name`、`--target-type project\|testList`、`--target-id`、`--cron`；另有 `--timezone`（默认 UTC）、`--start`、`--end`、`--send-to`、project 专用 `--env` |
| `schedule update <id>` | 可更新上述字段，`--pause/--resume` |
| `schedule delete <id> --confirm` | 删除 trigger 和全部 run history |
| `schedule run list <id>` | 查看该 schedule 的运行历史 |

Cron 是 5 段；day-of-week 为 0–7；day-of-month 与 day-of-week 不能同时约束。project schedule 省略 `--env` 时每次跟随 Default；testList schedule 跟随 list bindings 并拒绝 `--env`。通知邮件的每个收件人必须是当前 workspace member。[A]

连续 10 次没有任何 passed test 会自动 pause；没有运行测试不计数。credits 不足或付款失败只跳过当次，不自动 pause。loopback schedule 在云端记为 `blocked`、`failureKind:network`，不收费。[A]

### 5.8 Tunnel

来源：[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)、[Local Apps](https://github.com/TestSprite/Docs/blob/v1.0/cli/core/local-apps.mdx)。[A]

| 命令 | 参数/输出/退出 |
|---|---|
| `tunnel start` | `--ttl 60..28800`（server 可 clamp）；前台运行；mint 时 stderr 打 clientId，stdout 打 `clientId/expiresAt/status/transport`；正常停止 0，断连/撤销/过期/被接管 10 |
| `tunnel list` | 当前用户 live bindings 与 `online/offline/unknown`、创建/过期时间 |
| `tunnel status <client-id>` | 是否连接 |
| `tunnel stop <client-id>` | 撤销一个凭证，幂等 |
| `tunnel stop --all --confirm` | 撤销自己所有 bindings，包括其他终端/CI；至少一个失败 exit 1；无 confirm exit 5 |

`test run --local` 可自己管理 tunnel；跨调用复用时用 `tunnel start` + `test run --tunnel-client`。最新连接接管同名 client 时旧连接会失效。[A]

### 5.9 CI

来源：[CLI CI/CD](https://github.com/TestSprite/Docs/blob/v1.0/cli/integrations/ci-cd.mdx)、[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx)。[A]

| 命令 | 参数与行为 |
|---|---|
| `ci init github` | 写 `.github/workflows/testsprite.yml`。`--project`（workspace 只有一个项目时可省）、`--env`、`--timeout`、`--path`（必须位于 `.github/workflows/` 且为 yml/yaml）、`--force`（保留 `.bak`）、`--set-secret`（通过 `gh` **覆盖** repo 的 `TESTSPRITE_API_KEY` secret）、`--repo owner/name` |
| `ci run` | `--project` 或 `TESTSPRITE_PROJECT_ID`、`--env`、`--target-url`、`--filter`、`--fail-on-skipped`、`--allow-empty`、`--timeout`（默认 600）、`--max-concurrency`、`--summary-file`、JUnit 参数、`--execution-report-timeout`（默认 60）、`--no-execution-report`、`--skip-preflight`、`--gh-output`、`--idempotency-key` |

GitHub Actions PR 中，`--env X --target-url U` 创建/使用临时环境 `github-pr-<N>`，复制 X 的登录设置并指向 U。draft PR 或找不到 open PR 的 deployment 可 skip 且 exit 0。每个被选 test 是独立 execution；后端不支持时 exit 7。典型失败为 failed 1、missing IDs 4、空 dispatch/未知 env 5、timeout 7。[A]

## 6. CLI 配置、认证与 API Key 生命周期

来源：[Configuration](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/configuration.mdx)、[Authentication](https://github.com/TestSprite/Docs/blob/v1.0/cli/core/authentication.mdx)、[Portal API Keys](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/admin/api-keys.mdx)。[A]

### 6.1 配置优先级

```text
flags > environment variables > ~/.testsprite/credentials > built-in defaults
```

- credentials 是 INI；目录权限 `0700`、文件 `0600`、原子写入。
- profile 选择：`--profile` > `TESTSPRITE_PROFILE` > `default`。
- key 选择：`TESTSPRITE_API_KEY` > 当前 profile 的 `api_key`。
- `setup` 是唯一写本地 credentials 的命令；`auth remove` 只删本地 profile。

环境变量：[A]

| 变量 | 用途 |
|---|---|
| `TESTSPRITE_API_KEY` | key，优先于 profile |
| `TESTSPRITE_PROFILE` | 当前 profile |
| `TESTSPRITE_API_URL` | API host |
| `TESTSPRITE_REQUEST_TIMEOUT_MS` | 单请求超时，单位**毫秒** |
| `TESTSPRITE_NO_UPDATE_NOTIFIER` | 非空则禁用更新提示 |
| `NO_COLOR` | 非空则禁用颜色 |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | 代理；也接受小写 |

`--request-timeout` 使用秒，环境变量使用毫秒；两者都不控制 run 的 `--wait --timeout`。[A]

### 6.2 Key 的归属和生命周期

[A｜[Portal API Keys](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/admin/api-keys.mdx)]

- key 代表创建者，绑定创建时所在 workspace 和创建者 membership；创建的资源和消耗 credits 都落在该 workspace。
- Member/Admin/Owner 可持有；Viewer 不能。离开/被移出 workspace 后 key 失效；workspace paused 时不能 mint 新 key。
- 每 workspace 最多 **2 个 active keys**；撤销立即生效。
- 过期可选 never、30、90、365 天；workspace 可强制最大寿命。
- 完整 key 只在创建时显示一次；之后只显示前缀和 last-used/created/expires 元数据。
- Member 查看/撤销自己的 key；Admin/Owner 可查看/撤销 workspace 内任意 member 的 key。
- `sk-user-` 是 workspace keys 之前的旧 key，仍可用，始终作用于默认 workspace，也可在该 workspace 页面撤销。

Scopes：[A｜[CLI Authentication](https://github.com/TestSprite/Docs/blob/v1.0/cli/core/authentication.mdx)]

```text
read:me
read:projects
read:tests
write:tests
write:projects
run:tests
read:schedules
write:schedules
run:tunnel
```

缺 scope 是 `AUTH_FORBIDDEN`/exit 3，不是 feature gate/exit 13。[A]

## 7. CLI 输出、状态与退出码

来源：[Output & Scripting](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/output-and-scripting.mdx)、[Exit Codes](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/exit-codes.mdx)、[v0.16.0 errors.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/lib/errors.ts)。[A]

### 7.1 输出契约

- 同一 major 内 JSON 只做 additive change；脚本应解析 JSON，不应解析 text。
- stdout 只放单一结果载荷；prompt、debug、verbose、onboarding 和 deprecation 通知放 stderr。
- `dashboardUrl` 是可选字段；dry-run 中不出现。后端不给链接时 CLI 可从 `projectId + testId` 计算；无法保证正确时宁可不输出并给 advisory。
- JSON 错误写 stderr：

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Authentication is required.",
    "nextAction": "Run `testsprite setup`, or set TESTSPRITE_API_KEY ...",
    "requestId": "req_...",
    "details": {}
  }
}
```

普通 wait timeout 在 exit 7 前仍输出 `{ "runId":"...", "status":"running" }`。[A]

### 7.2 完整 exit-code 表

| Code | 含义 |
|---:|---|
| 0 | 成功；help/version 也为 0 |
| 1 | run 未通过；部分 `tunnel stop --all` 失败；`INTERNAL` 或未处理错误 |
| 2 | 尚未实现（`NOT_IMPLEMENTED`） |
| 3 | 认证缺失、不可解析、无效、已撤销或缺 scope |
| 4 | not found / 跨 tenant；特定无 failure bundle；旧 server 不支持部分 tunnel 操作 |
| 5 | 参数、enum、payload、validation、flag parse；缺 `--confirm` 等 |
| 6 | conflict/precondition；idempotency body mismatch；codeVersion；tunnels；agent overwrite 等 |
| 7 | wait timeout；client-side request timeout；后端不支持该能力 |
| 8、9 | reserved |
| 10 | unavailable/transport/tunnel 中断、撤销、过期或被接管 |
| 11 | rate limited |
| 12 | insufficient credits |
| 13 | feature gated 或 workspace paused |
| 14 | client too old |
| 129 / 130 / 143 | SIGHUP / SIGINT / SIGTERM |

### 7.3 错误码到 HTTP/exit 的映射

| Error code | HTTP | Exit | 重试规则 |
|---|---:|---:|---|
| `AUTH_REQUIRED` / `AUTH_INVALID` | 401 | 3 | 否 |
| `AUTH_FORBIDDEN` | 403 | 3 | 否；text 可显示 required/granted scopes |
| `NOT_FOUND` | 404 | 4 | 否 |
| `VALIDATION_ERROR` | 400 | 5 | 否 |
| `PAYLOAD_TOO_LARGE` | 413 | 5 | 否 |
| `CONFLICT` | 409 | 6 | 通常 1 秒后一次；cancel conflict 除外 |
| `IDEMPOTENCY_BODY_MISMATCH` | 409 | 6 | 否 |
| `PRECONDITION_FAILED` | 412 | 6 | 否 |
| `RATE_LIMITED` | 429 | 11 | 遵循 Retry-After，3 次；standing tunnel limit 不重试 |
| `INSUFFICIENT_CREDITS` | 402 | 12 | 否 |
| `FEATURE_GATED` | 403 | 13 | 否 |
| `CLIENT_TOO_OLD` | 426 | 14 | 否 |
| `UNSUPPORTED` | 501 | 7 | 否 |
| `INTERNAL` | 500 | 1 | 一次 |
| `UNAVAILABLE` | 503 | 10 | 指数退避，4 次 |

Release source 还直接确认：[A｜[errors.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/lib/errors.ts)]

- `AMBIGUOUS_ORG` 映射 exit 6，但当前文档 error-code 表没有列出。
- client-local `CLI_ERROR` 默认 exit 1、`NOT_IMPLEMENTED` exit 2、`REQUEST_TIMEOUT` exit 7。
- `INTERRUPTED` 使用信号对应 exit 129/130/143，JSON envelope 的 `details.signal` 给出信号。

### 7.4 状态枚举

[A｜[Exit Codes](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/exit-codes.mdx)]

- Test：`draft`、`ready`、`queued`、`running`、`passed`、`failed`、`blocked`、`unknown`；`cancelled` 不作为 test-level 状态，取消保留之前的 verdict。
- Run：非终态 `queued/running`；终态 `passed/failed/blocked/cancelled`。
- Step：`passed/failed/null`（未执行）。
- Run source：`cli`（含 rerun）、`portal`、`mcp`、`schedule`、`github_action`。

普通 run/adopted-tunnel wait 收到信号会 detach，run 继续执行和计费；本命令拥有的 tunnel 默认请求取消，因为 tunnel 随进程关闭。`--no-cancel-on-interrupt` 可取消该行为，但 tunnel 仍会关闭。下游 reader 提前关闭 pipe 时 CLI exit 0。[A]

## 8. MCP 0.0.48 契约

### 8.1 启动、传输与认证

官方配置来源：[MCP Installation](https://github.com/TestSprite/Docs/blob/v1.0/mcp/getting-started/installation.mdx)。[A]

```json
{
  "command": "npx",
  "args": ["@testsprite/testsprite-mcp@latest"],
  "env": {
    "API_KEY": "your-api-key"
  }
}
```

- 无参数启动 stdio MCP server；server identity 为 `testsprite-mcp-server`，版本取包版本。[B]
- 文档化的 key 变量是 **`API_KEY`**，不是 CLI 的 `TESTSPRITE_API_KEY`；更改 IDE 配置后需重启 MCP server。[A/B]
- 0.0.48 server capabilities 只有 `tools:{}`；只注册 `ListToolsRequestSchema` 与 `CallToolRequestSchema` handlers。[B]
- **没有注册 MCP resources、resource templates 或 prompts。** bundle 内出现 SDK 的 Resources/Prompts schema 只是依赖代码，不代表 TestSprite 暴露了这些能力。[B]
- 发布包还把 `generateCodeAndExecute` 和 `server` 注册为辅助 Commander 子命令；npm bin 名仍是 `testsprite-mcp-plugin`。前者成功/失败 `process.exit(0/1)`，后者启动本地 dashboard server；这两个辅助命令不是 8 个 MCP tools，也没有文档化的完整 CLI 稳定契约。[B]

发布包 README 记录 tunnel 配置 `TSEMCP_TUNNEL_CONTROL_URL`、`TSEMCP_TUNNEL_DATA_TLS_ADDRESS`、`TSEMCP_TUNNEL_DATA_TLS_SERVERNAME`、`TSEMCP_TUNNEL_DATA_TLS_CA`、`TSEMCP_TUNNEL_DATA_ADDRESS`、`TSEMCP_TUNNEL_DATA_HOST`、`TSEMCP_TUNNEL_DATA_PORT`。[B｜[0.0.48 tarball](https://registry.npmjs.org/@testsprite/testsprite-mcp/-/testsprite-mcp-0.0.48.tgz)]

包内还出现 `API_URL`、`TESTSPRITE_URL`、`TS_API_ENDPOINT`、`TS_TUNNEL_ENDPOINT`、`TUNNEL_PROXY`、`EXECUTION_TYPE`、`TSMCP_API_KEY`、`TSEMCP_TUNNEL_PROXY_URL`、`TSEMCP_TUNNEL_VERSION` 等名字；它们属于**发布包内部/未稳定文档化事实 [B]**，不能据此宣称都是公共配置契约。

### 8.2 8 个 tools 的完整输入矩阵

来源：官方 [MCP Tools](https://github.com/TestSprite/Docs/blob/v1.0/mcp/core/tools.mdx) [A]；参数 required/default/strictness 以 0.0.48 tarball 的 Zod/JSON Schema 为准 [B｜[tarball](https://registry.npmjs.org/@testsprite/testsprite-mcp/-/testsprite-mcp-0.0.48.tgz)]。

| Tool | 必填参数 | 可选/默认参数 | 输出与副作用 |
|---|---|---|---|
| `testsprite_bootstrap` | `type: frontend\|backend`；`projectPath:string`；`testScope: codebase\|diff` | `localPort:number`，1–65535，默认 5173；`pathname:string?` | 初始化 `tmp/config.json`、启动配置 UI；返回 `next_action`，引导启动 app 和 code summary。已有 config 时不应重复 bootstrap |
| `testsprite_generate_code_summary` | `projectRootPath:string` | 无 | 返回 `next_action` 和 `codeSummarySchema`，给出提示让调用方 AI 生成并写 `tmp/code_summary.yaml`；不是直接返回完整扫描结果的对象 |
| `testsprite_generate_standardized_prd` | `projectPath:string` | 无；strict object | 读取 PRD/code summary，写 `standard_prd.json`；返回指向 frontend/backend plan tool 的 `next_action` |
| `testsprite_generate_frontend_test_plan` | `projectPath:string` | `needLogin:boolean=true`；strict object | 写 `testsprite_frontend_test_plan.json`；返回 `next_action`，通常接 `generate_code_and_execute`；缺 PRD 时可返回前置动作 |
| `testsprite_generate_backend_test_plan` | `projectPath:string` | 无；strict object | 写 `testsprite_backend_test_plan.json`；返回接执行工具的 `next_action` |
| `testsprite_generate_code_and_execute` | `projectName:string`；`projectPath:string` | `testIds:string[]=[]`；`additionalInstruction:string=""`；`serverMode: production\|development="development"` | 生成并执行所选/全部测试，写结果与报告；development 模式的工具说明限制 frontend 为高优先级最多 15 个，production 可由参数或进程检测 |
| `testsprite_open_test_result_dashboard` | **`projectPath:string`** | `modificationContext:string?` | 打开本地交互 dashboard，查看结果、编辑 steps、从 step 重跑；需要已有 config/results，重跑时 local app 必须运行 |
| `testsprite_check_account_info` | 无 | 空 object，`additionalProperties:false` | 返回账户、workspace/plan/credits 或 key 状态 |

通用 schema 注意：[B]

- 发布包的 JSON-schema 生成器给顶层 object 加 `additionalProperties:false`；不要发送未列出的字段。
- 即使无参数工具，也要传 `arguments:{}`；完全省略 `arguments` 会报 `Arguments are required`。
- `projectPath`/`projectRootPath` 的 description 写的是“Absolute path”，但静态 schema 只验证 `string`；**不能由 schema 推断存在绝对路径校验**。官方使用规则仍要求传绝对路径。[A/B]

### 8.3 MCP 成功输出与文件

所有 tool 成功结果统一为：[B]

```json
{
  "content": [
    {
      "type": "text",
      "text": "..."
    }
  ]
}
```

- handler 返回字符串时，`text` 就是该字符串；否则对 `result ?? null` 做 pretty `JSON.stringify(..., null, 2)`。
- 没有 `structuredContent`；若调用方需要结构化数据，只能解析 text 中的 JSON 或遵循 `next_action` 文本/对象序列化结果。
- `next_action` 是工作流协调数据，不是 MCP 协议里的 resources/prompts。

0.0.48 发布包实际路径常量：[B]

```text
testsprite_tests/standard_prd.json
testsprite_tests/testsprite_frontend_test_plan.json
testsprite_tests/testsprite_backend_test_plan.json
testsprite_tests/testsprite-mcp-test-report.md
testsprite_tests/testsprite-mcp-test-report.html
testsprite_tests/tmp/prd_files/
testsprite_tests/tmp/config.json
testsprite_tests/tmp/code_summary.yaml
testsprite_tests/tmp/test_results.json
testsprite_tests/tmp/raw_report.md
testsprite_tests/tmp/tasks_prompt.json
```

`testsprite_tests/` 还承载生成的测试代码。执行结果至少包括本地 `tmp/test_results.json`；最终 Markdown/HTML 报告由后续工作流生成。[A/B]

### 8.4 MCP 错误与账户输出

所有被 tool handler 捕获的错误返回：[B]

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "error message"
    }
  ]
}
```

| 情况 | text 契约 |
|---|---|
| Zod 输入错误 | `Validation error:\n<path>: <message>...` |
| 未提供 `arguments` | `Arguments are required` |
| 未知 tool | `Unknown tool: <name>` |
| 执行超时 | 带错误码 `mcp_timeout` 的文本；提示测试可能仍在 dashboard 完成 |
| local app 未运行 | 带 `mcp_localhost_not_running` 的修复步骤文本 |
| tunnel 建立失败 | 带 `mcp_tunnel_error` 的文本 |
| 后端 401 | JSON 字符串，含 `error:"AUTH_FAILED"`、`status_code:401`、`user_action_required:"CREATE_API_KEY"`、`mcp_terminate/force_stop/no_fallback/stop_all_tools:true` |
| workspace paused | JSON 字符串，含 `error:"WORKSPACE_PAUSED"`、403、`user_action_required:"RESOLVE_BILLING"` 与停止标志 |
| 400 + `MCP_TEST_NOT_FOUND` | 转为 `error:"BAD_REQUEST"` 的 JSON 文本 |
| 其他有响应 HTTP 错误 | `Backend error: <status> - <JSON>` |
| 请求无响应 | `No response from backend` |
| 其他 request 构造错误 | `Request error: <message>` |

这些是 **tool result 错误**，不是进程 exit codes。[B]

`testsprite_check_account_info` 的特殊返回：[B]

- 未配置 key：普通成功 tool result，内容含 `status:"No API Key"` 和配置/重启说明。
- key 无效：`status:"Invalid TestSprite API Key"`、`maskedApiKey` 和创建新 key 的说明。
- 成功基础字段：`firstName`、`lastName`、`emailAddress`、`subPlan`、`credits`。
- 0.0.48 可附加 `workspace`、`paused`、`message`、`instructions` 等 workspace/billing 信息。

`check_account_info` 与 `open_test_result_dashboard` 在包内属于 ungated tools；workspace paused 时仍可查询账户或查看已有结果，其他生成/执行路径会被暂停 gate 拒绝。[B]

## 9. CI 的另一条文档线：GitHub App 与 Action

来源：[MCP GitHub Integration](https://github.com/TestSprite/Docs/blob/v1.0/mcp/integrations/github-integration.mdx)。[A]

该页面不是 stdio MCP tool contract，而是围绕 MCP 生成并提交 `testsprite_tests/` 后的两种 CI 集成：

| 方式 | 契约 |
|---|---|
| GitHub App（页面推荐） | 在 Portal 连接 GitHub org/repo；自动检测 Vercel/Netlify/Render/Railway/Fly.io 等 PR preview deployment；配置 Run on PRs、Include Draft PRs、Blocking PR；无需 workflow YAML |
| GitHub Action | 文档示例使用 `TestSprite/run-action@v1`，inputs 示例只有 `testsprite-api-key`、`base_url`、`blocking`；`blocking:'true'` 时测试不通过会使 Action 失败 |

两种方式的文档结果都是 PR comment，含每测试 pass/fail 摘要和详细结果链接。[A]

**当前可用性警告：**本次只读查询 `https://api.github.com/repos/TestSprite/run-action` 返回 404，raw `v1/action.yml` 也未能取得。因此只能确认“当前官方文档仍引用它”，不能确认该公共 Action 仓库/完整 inputs/outputs 仍可用；将其标为 **疑似失效或已转为非公共入口 [U]**，而不是把它当作已核验的当前 Action contract。CLI 的 `ci init github`/`ci run` 是另一条已由当前 CLI 文档和 release source 确认的入口。[A/U]

## 10. 版本差异、文档冲突与失效旧入口

### 10.1 CLI：`setup --api-key` 文档自相矛盾

- [Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx) 明确列出 `--api-key <key>`。
- [Authentication](https://github.com/TestSprite/Docs/blob/v1.0/cli/core/authentication.mdx) 却写 CLI 不接受 API key 作为 flag/argument。
- [v0.16.0 init.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/init.ts) 直接注册 `--api-key <key>`，且它可替代交互 prompt；`--from-env` 是另一条路径。[A]

结论：flag **确实存在**；“never accepts”是错误/过期表述。交互和 CI 文档推荐 prompt 或 `TESTSPRITE_API_KEY + --from-env`，可避免 key 进入 shell history。[A/C]

### 10.2 CLI：`--dry-run` 的“无网络”不是绝对保证

[Command Reference](https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx) 写“No network, credentials, or filesystem”；但 [v0.16.0 index.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/index.ts) 注明 run 类命令在有 credentials 且未显式给 target 时，可能发只读 GET 来预览 automatic tunnel target。[A]

结论：应把 dry-run 理解为“返回真实形状的 canned response、通常不执行写操作”，不要把它当作所有命令严格离线沙箱。[A/C]

### 10.3 CLI：0.16.0 的 hidden/deprecated 命令

[v0.16.0 test.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/test.ts)、[deprecate.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/lib/deprecate.ts)、[init.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/init.ts)、[auth.ts](https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/auth.ts) 直接确认：[A]

| 旧/兼容入口 | 当前状态 | 替代 |
|---|---|---|
| `test rerun` | hidden、deprecated；0.16.0 仍可执行；计划 **0.17.0** 删除 | `test run`；backend dependency closure/auto-heal 等语义需按迁移提示处理 |
| `test flaky` | hidden、deprecated；计划 **0.17.0** 删除；无等价替代 | 可再次 `test run` 采样，但不保留原稳定性报告语义 |
| `init` | hidden、deprecated alias | `setup` |
| `auth configure` | hidden、deprecated；现在运行完整 setup | `setup` |
| `auth whoami` | hidden、deprecated alias | `auth status` |
| `auth logout` | hidden、deprecated alias | `auth remove` |
| `ci doctor` / `ci connect` | hidden、deprecated | 当前文档只给“以后版本删除”，未给确定版本 |

当前 Command Reference 仍把 `rerun/flaky` 放在主命令树并完整列参数，因此文档与 release source 的“当前推荐入口”信号不一致；复刻新接口时不应把这两个命令当成长期稳定契约。[A/C]

### 10.4 MCP：tools 文档落后于 0.0.48 包

对比 [MCP Tools](https://github.com/TestSprite/Docs/blob/v1.0/mcp/core/tools.mdx) [A] 与 [0.0.48 tarball](https://registry.npmjs.org/@testsprite/testsprite-mcp/-/testsprite-mcp-0.0.48.tgz) [B]：

| 项目 | 当前文档 | 0.0.48 发布包 |
|---|---|---|
| `open_test_result_dashboard` 参数 | “None” | 必填 `projectPath`，可选 `modificationContext` |
| `generate_code_and_execute` | 未列 `serverMode` | 新增 `production/development`，默认 development |
| code summary | `code_summary.json` | `testsprite_tests/tmp/code_summary.yaml` |
| frontend plan | `frontend_test_plan.json` | `testsprite_frontend_test_plan.json` |
| backend plan | `backend_test_plan.json` | `testsprite_backend_test_plan.json` |
| 报告 | `TestSprite_MCP_Test_Report.md/html` | `testsprite-mcp-test-report.md/html` |
| 临时分析文件 | `report_prompt.json` | 实际常量为 `tmp/tasks_prompt.json`，另有 `tmp/raw_report.md` |

因此，若需要与当前包互操作，路径和 required inputs 应以 0.0.48 发布包为准；文档可用来理解用途，但不能覆盖包的实际 schema。[B/C]

### 10.5 MCP：排障文档仍引用不存在的包名

当前文档的 [Installation Issues](https://github.com/TestSprite/Docs/blob/v1.0/mcp/troubleshooting/installation-issues.mdx) 仍建议 `npm install -g @testsprite/mcp-server`，[Test Execution Issues](https://github.com/TestSprite/Docs/blob/v1.0/mcp/troubleshooting/test-execution-issues.mdx) 末尾仍建议 `npx @testsprite/mcp-server --version`；npm 对该名称返回 404。[A]

可用入口是 `@testsprite/testsprite-mcp@latest` 或固定版本 `@testsprite/testsprite-mcp@0.0.48`，不是 `@testsprite/mcp-server`。[A]

### 10.6 其他表面差异与 stale 文档

- CLI schedule 默认 timezone 是 UTC；[Portal Monitoring](https://github.com/TestSprite/Docs/blob/v1.0/web-portal/maintenance/monitoring.mdx) 的新建表单默认 Los Angeles。它是表面默认值差异，不是 cron 语义冲突。[A]
- [CLI Overview](https://github.com/TestSprite/Docs/blob/v1.0/cli/getting-started/overview.mdx) 的能力表把 MCP “Visual dashboards”记为无，但 MCP 有本地 `open_test_result_dashboard`。合理解读是该行指 Portal 式 visual dashboard，而非本地结果 UI；不要据此删掉 MCP 工具。[A/B/C]
- 搜索仍可能发现 `/cli/reference/whats-included` 把 Test Lists/schedule reads 写成 roadmap，但该文件不在当前 Docs `v1.0` tree，当前 Command Reference 已有完整命令。应视为 stale/dead documentation 入口，而非当前能力依据。[A]
- 文档中的 `TestSprite/run-action@v1` 与公共仓库 404 的冲突见第 9 节，当前状态为 U。

## 11. 推断与未知项

### 11.1 明确推断 [C]

1. **CLI 是自动化契约的超集，MCP 是工作流工具集。** 这是由命令/tool 覆盖矩阵得出的架构边界，不表示二者后端对象不同。
2. **MCP 的 `next_action` 让宿主 AI 参与生成。** 尤其 code summary 工具返回 prompt/schema，要求 AI 写 YAML；不能把 MCP server 想象成完全独立、无需宿主模型的一次性测试生成器。
3. **“共享项目/测试”不等于“共享所有管理功能”。** Portal Sources、Lists、Schedules、CLI CRUD 和 MCP 本地文件工作流必须分别核对。
4. **稳定性承诺只覆盖文档明示的 CLI JSON/exit codes。** MCP 0.x 包内的辅助 CLI、内部 env、文件名和 text payload 不应自动获得同等稳定性假设。

### 11.2 未知/未实测 [U]

1. 未安装或执行两个包，因此没有验证本机 Node/npm 下的实际启动、stdio handshake、实时 `tools/list` 或命令 help。
2. 未使用 API key，未验证实时 backend 的响应、scope 默认授予策略、计费、配额、workspace V2/V3 路由或 server-side feature flags。
3. MCP 每个成功 tool 的完整运行时 text/JSON 内容会受后端和项目状态影响；本文只锁定发布包的 envelope、已证实字段、next_action 和文件副作用，没有虚构完整响应样例。
4. 未确认 `TestSprite/run-action` 是私有、迁移还是永久下线；404 只说明本次无法公共读取。
5. 未发现 MCP 第一方公共实现仓库，因此无法给出带 tag 的 MCP 源码 URL；tarball 是当前最强实现证据。
6. CLI exit 8/9 仅知 reserved，没有语义。
7. Portal/GitHub App 的内部 HTTP API 不属于本次已核验公共契约；不能从 UI 文档反推私有端点。

## 12. 一手来源索引

以下来源均访问于 **2026-11-04**。

### Issue

- https://github.com/mrye111/test_tools/issues/43

### 当前包与 registry

- https://registry.npmjs.org/@testsprite%2Ftestsprite-cli
- https://registry.npmjs.org/@testsprite%2Ftestsprite-cli/0.16.0
- https://registry.npmjs.org/@testsprite/testsprite-cli/-/testsprite-cli-0.16.0.tgz
- https://registry.npmjs.org/@testsprite%2Ftestsprite-mcp
- https://registry.npmjs.org/@testsprite%2Ftestsprite-mcp/0.0.48
- https://registry.npmjs.org/@testsprite/testsprite-mcp/-/testsprite-mcp-0.0.48.tgz
- https://registry.npmjs.org/@testsprite%2Fmcp-server

### CLI 官方源码

- https://github.com/TestSprite/testsprite-cli
- https://github.com/TestSprite/testsprite-cli/releases/tag/v0.16.0
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/package.json
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/index.ts
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/lib/errors.ts
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/lib/deprecate.ts
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/init.ts
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/auth.ts
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/test.ts
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/src/commands/ci.ts
- https://github.com/TestSprite/testsprite-cli/blob/v0.16.0/schemas/plan.schema.json

### 官方文档仓库

- https://github.com/TestSprite/Docs/tree/v1.0
- https://github.com/TestSprite/Docs/blob/v1.0/cli/getting-started/overview.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/command-reference.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/configuration.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/output-and-scripting.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/reference/exit-codes.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/core/authentication.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/core/projects.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/core/creating-tests.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/core/local-apps.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/integrations/ci-cd.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/cli/integrations/test-lists-and-schedules.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/mcp/getting-started/installation.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/mcp/core/tools.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/mcp/core/continuous-monitoring.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/mcp/integrations/github-integration.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/mcp/troubleshooting/installation-issues.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/mcp/troubleshooting/test-execution-issues.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/web-portal/admin/api-keys.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/web-portal/setup/project-sources.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/web-portal/maintenance/test-lists.mdx
- https://github.com/TestSprite/Docs/blob/v1.0/web-portal/maintenance/monitoring.mdx
