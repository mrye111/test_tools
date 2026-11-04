# TestSprite 外部集成实施契约：GitHub、Slack、Jira 与 Linear

> 对应票据：[#44](https://github.com/mrye111/test_tools/issues/44)；父地图：[#32](https://github.com/mrye111/test_tools/issues/32)。  
> 调研日期：2026-11-04。只读取 TestSprite 一手文档、供应商一手文档及 Linear 公开 GraphQL schema；未授权、连接、发送消息/工单或修改任何外部数据。  
> 证据口径：**TestSprite 证实**＝官方产品文档明确描述；**供应商契约**＝供应商文档/API 明确描述；**本地建议**＝为实现这些行为所需的工程约束，不代表 TestSprite 内部实现；**未知**＝公开资料未给出，不能靠猜测补齐。

## 结论（TL;DR）

1. **GitHub 必须拆成三条独立链路**：GitHub App 监听真实 CI/CD 信号并执行已有测试；Export to GitHub 使用**个人 GitHub 登录**导出代码；CLI CI 使用 **API key + 用户自己的 Actions workflow**。三者不共享授权、触发或结果语义。[TS-GH][TS-CI][TS-AUTH]
2. **Export to GitHub 不是 GitHub Issues 工单功能**。它按项目导出所有已完成执行的测试代码，固定提交到 `main` 的 `testsprite_test_code/latest/` 与 `testsprite_test_code/history/execution_<timestamp>_<id>/`；无分支/路径选项。[TS-GH]
3. **GitHub App 不是“PR 一打开就跑”**：它等待用户选择的部署、workflow run、check、commit status 或部署机器人评论等“环境已就绪”信号；TestSprite 不负责构建/部署。[TS-GH]
4. **GitHub 失败 webhook 不会自动重投**；接收端须在 10 秒内返回 2XX，以 `X-GitHub-Delivery` 去重，并自行做失败投递恢复。Slack/Jira/Linear 的 webhook 重试策略各不相同，不能共用一份假设。[GH-WH-BEST][GH-WH-FAIL][SLACK-EVENTS][JIRA-WH][LINEAR-WH]
5. **Slack 是“每次完成运行一条摘要”**，覆盖手工、计划、GitHub 和 CLI 运行，含通过与失败，没有 failures-only；每个 TestSprite workspace 只连接一个 Slack workspace，每个项目独立选频道。[TS-SLACK]
6. **Jira/Linear 的“去重”主要是本地业务状态机，不是供应商幂等键**：同测试重复失败写评论；同 error signature 在 7 天内、最多 25 个测试共票；恢复写评论但不关单，之后再次失败开新票并链接旧票。[TS-TICKET]
7. **所有外部写操作都要防“超时但实际已成功”**。Slack `chat.postMessage`、Jira issue/comment、Linear mutation、GitHub 建库/写文件均不能盲目重试；必须先持久化操作、外部 ID 与不确定状态，再按供应商响应恢复。[SLACK-POST][JIRA-ISSUE][LINEAR-GQL][GH-REPO][GH-CONTENTS]
8. 实现前仍有真正未知项：GitHub 原始事件到规则的具体匹配算法、导出仓库命名/可见性与个人令牌形态、Slack 截图上传方式、error signature 规范化、超过每轮工单上限后的处理、Jira/Linear 断开后的配置保留策略。本文在第 12 节集中列出。

---

## 1. 边界与事件方向

| 能力 | 授权身份 | 触发源 | 外部写入 | 不应混入的契约 |
|---|---|---|---|---|
| GitHub App triggers | GitHub App installation + installation access token | GitHub webhook / CI 就绪信号 | PR 评论、commit status/check | 不使用个人导出登录；不等于 Actions workflow |
| Export to GitHub | **个人 GitHub 账号连接** | 用户在项目菜单主动点击 | 建库、向 `main` 提交测试代码 | 不创建 GitHub Issue；不由 App trigger 触发 |
| CLI CI | workspace API key，绑定创建它的成员 | 用户仓库中的 GitHub Actions | Actions job/check、summary、annotations、artifact | 不依赖 GitHub App webhook；不承诺 App 式 PR 评论 |
| Slack | Slack OAuth bot token | 本地 run 进入 completed | 频道摘要消息 | 不需要用 Slack Events API 来触发通知 |
| Jira | Atlassian OAuth 2.0 (3LO) | 手工 Create Bug Ticket / 本地 run 完成 | Jira Bug、后续评论 | 不需要为“不关单”行为订阅 Jira webhook |
| Linear | Linear OAuth access token | 同上 | Linear issue、后续评论 | 不需要为基线能力订阅 Linear webhook |

**核心分界**：Slack/Jira/Linear 的“事件”首先是本系统内部的 `run completed` / `test recovered`，供应商 API 是出站写入；它们的 inbound webhook 只用于可选的卸载、撤销或未来同步，不应被误写成通知/建单的前置条件。[TS-SLACK][TS-TICKET]

## 2. GitHub App triggers

### 2.1 TestSprite 已证实的产品行为

- Workspace Settings → Connections → Integrations 中连接 GitHub；安装时选择组织/个人账号及 All repositories / Only select repositories。操作者需要在该组织安装 GitHub App 的权限。[TS-GH]
- 项目必须有既有测试，仓库/PR 必须已有能生成可访问环境的部署；TestSprite 不构建、不部署应用。[TS-GH]
- 项目的 **GitHub Action** 页通过 **Add Trigger** 建规则：
  - **Pull Request**：从样本 PR 检测 checks、workflow runs 或 bot comments，选择“部署完成且 URL 可访问”的信号，填写 Target URL pattern；占位符为 `{pr}`、`{branch}`、`{branch-slug}`、`{sha}`、`{short-sha}`。
  - **Push to Branch**：选择仓库和分支，再选择 workflow、named check 或 raw push；运行目标是预先配置的 TestSprite Environment，不使用每轮 URL pattern。[TS-GH]
- **Send Test Event** 会对真实样本排队一次运行；PR 上先出现进行中评论，随后原评论更新为结果。规则可开启 **Include draft PRs**、**Block PR until tests pass**。[TS-GH]
- 规则有 Active/Disabled、Last matched、启停与删除；Trigger activity 展示匹配信号、执行链接、短 SHA、结果和时间，保留 **30 天**。删除规则立即停止该触发且保留既有运行历史。[TS-GH]

**未知**：公开文档没有列出 TestSprite App 的实际 webhook subscription 清单、action 过滤、信号优先级、同 SHA 合并/并发策略或运行去重键。因此下面是“用 GitHub 一手契约实现同等能力”的映射，不声称是 TestSprite 内部 schema。

### 2.2 App 凭据、权限与令牌

部署需要保存 App ID/Client ID、PEM private key、webhook secret；JWT 用 RS256，`iss` 可为 Client ID 或 App ID，`exp` 距签发不得超过 10 分钟。服务端用 JWT 调 `POST /app/installations/{installation_id}/access_tokens` 换 installation token；token 一小时过期，权限与仓库范围不能超过 installation 授权。[GH-APP-AUTH][GH-JWT][GH-IAT]

TestSprite 当前公开列出的 App 权限为：[TS-GH]

| 权限 | TestSprite 请求值 | 对应用途 |
|---|---|---|
| Actions | Read | 检测 workflow run |
| Checks | Read | 检测 checks |
| Issues | Read | 读取部署机器人 PR 评论 |
| Metadata | Read | 仓库基础信息 |
| Code | Read/write | 文档明确列出；App trigger 不应因此替代个人导出授权 |
| Commit statuses | Read/write | 读取 status 信号、写结果状态 |
| Deployments | Read/write | 读取部署就绪信号 |
| Pull requests | Read/write | 读取 PR、写/更新 PR 评论 |

GitHub App 只有一个 App webhook；需配置 HTTPS URL、独立高熵 webhook secret、SSL verification 和最小事件订阅。Client secret 只在需要 GitHub App user OAuth flow 时使用，不是 JWT 密钥或 webhook secret。[GH-APP-REG][GH-APP-WH]

### 2.3 原始事件与关键 payload

| 就绪/生命周期信号 | GitHub event | 最低读取权限 | 路由/匹配字段 |
|---|---|---|---|
| PR 状态、draft、head 更新 | `pull_request` | Pull requests: read | `action`、`number`、`pull_request.head.sha`、`base.sha` |
| 分支更新 | `push` | Contents: read | `ref`、`after`、`head_commit` |
| 部署状态 | `deployment_status` | Deployments: read | `deployment_status.state`、`environment_url`、`deployment.environment`、`deployment.sha` |
| Actions 完成 | `workflow_run` | Actions: read | `workflow_run.id`、`name`、`status`、`conclusion`、`head_sha` |
| Check 完成 | `check_run` / `check_suite` | Checks: read | 名称/ID、`head_sha`、`status`、`conclusion` |
| Commit status | `status` | Commit statuses: read | `sha`、`state`、`context`、`target_url` |
| 部署机器人评论 | `issue_comment` | Issues: read | `action`、`issue.number`、`comment.id`、`comment.body`、作者 |
| 安装/仓库授权变化 | `installation` / `installation_repositories` | 默认投递 | `action`、installation ID、增删仓库列表 |

通用路由还需保存 `installation.id`、`repository.id/full_name`、`sender.id`。`pull_request` 本身只提供 PR 上下文；除非用户明确选择 raw push 等规则，不能绕过“等待 CI 就绪信号”。[GH-EVENTS][TS-GH]

### 2.4 接收、验签、去重、失败恢复

1. 对**未修改的 raw body** 以 webhook secret 计算 HMAC-SHA256，常量时间比较 `X-Hub-Signature-256: sha256=<hex>`；先验签再 JSON parse。[GH-VERIFY]
2. 用 `X-GitHub-Event` 与顶层 `action` 路由；未知新 action 不应使接收器崩溃。[GH-WH-BEST]
3. 在 **10 秒**内返回 2XX；持久化接收记录并入队后再异步解析信号、探测 URL、排队运行。[GH-WH-BEST]
4. 以 `X-GitHub-Delivery` 建唯一约束。手工/程序 redelivery 保留原 GUID，重复接收应直接返回成功而不再次触发运行。[GH-WH-BEST]
5. **GitHub 不自动重投失败 delivery**。需要定期调用 App delivery API 查失败记录，并用 `POST /app/hook/deliveries/{delivery_id}/attempts` 补投；仅能恢复近 **3 天**的 deliveries。[GH-WH-FAIL][GH-REDELIVERY]
6. 本地建议另设业务幂等键 `(trigger_rule, matched_event_identity, head_sha)`，防止不同投递恢复路径重复排队；其是否等同 TestSprite 行为未知。

### 2.5 回写与断开

- PR 评论可用 `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` 创建，保存 comment ID 后用 `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` 原地更新；评论正文包含进行中/结果及完整运行链接。[GH-COMMENT][TS-GH]
- 可用 `POST /repos/{owner}/{repo}/statuses/{sha}` 写 `state=pending|success|failure|error`、`context`、`description`、`target_url`。该端点只需 Commit statuses:write，符合当前 App 权限；若改用 Checks API 则须新增 Checks:write，不是当前文档权限的隐含能力。[GH-STATUS][TS-GH]
- **Block PR until tests pass** 只让 TestSprite 结果失败；真正阻止合并还要在 GitHub branch protection 中把对应 check/status 设为 required。[TS-GH]
- GitHub 侧移除仓库授权或 uninstall App 后应依据 `installation_repositories.removed` / `installation.deleted` 停用对应连接与规则；TestSprite 明确“删除 trigger 保留既有运行历史”，完整卸载则使设置页回到未安装态；卸载后的历史保留未被单独说明。[GH-EVENTS][TS-GH]
- 出站评论/状态 API 没有通用“只执行一次”保证。创建评论前先查本地 comment ID；网络结果不明时先读取/对账，不能直接重复 POST。[GH-COMMENT]

## 3. Export to GitHub（个人账号、代码导出）

### 3.1 TestSprite 已证实的完整外部语义

- 入口为 **All Projects → 项目 ⋮ → Export to GitHub**；首次使用要求 **Connect GitHub**，后续复用该个人账号连接。[TS-GH]
- 项目尚未 linked repo 时，TestSprite 会创建仓库并将用户加入为 collaborator；已有链接时写入该仓库。[TS-GH]
- 导出是**项目级**：写入该项目每个已完成（passed 或 failed）执行的生成测试代码，而非单测试或单执行。[TS-GH]
- 直接提交 `main`：
  - `testsprite_test_code/latest/`：最近一次执行的测试；
  - `testsprite_test_code/history/execution_<timestamp>_<id>/`：每次已完成执行的历史。
- 当前不能改目标分支或文件路径；该链路与上方 GitHub App trigger 明确分离。[TS-GH]

### 3.2 GitHub API 实施契约

| 操作 | API | 必要字段/权限 | 本地必须保存 |
|---|---|---|---|
| 创建个人仓库 | `POST /user/repos` | `name` 必填；可选 `private`、`description`、`auto_init`。classic OAuth token 建私有库需 `repo`；GitHub App user token 依文档需 Administration:write 或 Repository creation:write | owner、repo ID/full_name/html_url、默认分支 |
| 创建/更新文件 | `PUT /repos/{owner}/{repo}/contents/{path}` | `message`、Base64 `content`；更新已有文件必须带当前 blob `sha`；`branch=main`；Contents:write | 文件 path/sha、commit sha/html_url |
| 断开出站授权 | 依所选 OAuth/App 类型撤销 token | GitHub App user token 可用 OAuth revocation API；具体 TestSprite 个人连接类型未公开 | 连接状态、revoked_at、本地 token 清除记录 |

创建成功返回 `201`；文件创建/更新返回 `201/200`。文件更新遇 `409` 应重新读取 HEAD/blob SHA 后决策，不能覆盖用户并发修改。GitHub 还明确要求 Contents 写端点串行使用，避免并行冲突。[GH-REPO][GH-CONTENTS]

**本地建议**：以 `project + personal_connection + export_generation` 建导出操作记录；建库与文件写入分阶段保存。建库响应丢失时先按 owner/name 对账，文件响应丢失时读取 path/commit 对账，避免重复建库或历史目录。若要求一次项目导出只有一个原子 commit，可改用 Git trees/commits API；TestSprite 未公开其 commit 粒度，不能将单文件 Contents 提交形态当作复刻事实。

**未知**：个人连接究竟是 OAuth App 还是 GitHub App user flow、令牌期限/scope、仓库 owner/名称/可见性、collaborator 的实际账号关系、既有仓库如何链接、空仓库初始化、commit message/author、latest 更新策略、导出冲突与重试、个人连接断开 UI 与 linked repo 是否保留。

## 4. CLI CI（API key + 用户 workflow）

### 4.1 授权与配置

- API key 在 **Workspace Settings → Connections → API Keys** 创建；key 绑定 workspace 和创建成员，成员离开/被移除后失效；需 Member 及以上，最多 2 个 active keys/workspace。[TS-AUTH]
- CI 用 `TESTSPRITE_API_KEY`，不得把 key 作为 CLI 参数；GitHub 示例把它存为仓库 Actions secret。key scopes 随 workspace 角色授予，portal 无逐 scope 选择器；`run:tests` 明确门控运行命令，但 `ci run` 的独立最小 scope 集合未单列，部署时用 Member+ key 并通过 `auth status` 验证。[TS-AUTH][TS-CI]
- `testsprite ci init github --project <id> --env <name>` 写 `.github/workflows/testsprite.yml`；含需要替换的 preview 部署步骤。`--set-secret` 会通过 `gh` 覆盖现有 secret，实施时不能默认静默执行。[TS-CI][TS-CMD]

### 4.2 两种 workflow 触发形态

- 平台部署 preview：`on: deployment_status`，只接受 `state == 'success'` 且非 production；URL 来自 `github.event.deployment_status.environment_url`。
- workflow 自己部署：`on: pull_request` 的 `opened/synchronize/reopened/ready_for_review`，跳过 fork/draft，从部署 step output 取 URL。
- 生成的 workflow 权限仅 `contents: read`、`pull-requests: read`；按 PR/deployment SHA 设 concurrency，`cancel-in-progress: true`。[TS-CI]

`deployment_status` workflow 能访问仓库 secrets；若托管平台允许不可信 fork 触发 preview，必须先限制，否则可能暴露 `TESTSPRITE_API_KEY`。[TS-CI]

### 4.3 运行、结果与重试

```bash
testsprite ci run \
  --project proj_xxxxxxxx --env staging --target-url "$PREVIEW_URL" \
  --fail-on-skipped --summary-file testsprite-summary.json
```

- 每个被选择测试形成一个 execution；在 Actions PR 中，`--env X --target-url U` 使用临时 `github-pr-<N>` 环境，结束后删除。recorded SSO session 会在计费前被拒绝。[TS-CI][TS-CMD]
- 结果包括 Actions job/check、execution report job summary、逐未通过测试 annotations、JSON `{total, passed, failed, skipped, timedOut, runs[]}`、可选 JUnit 与 artifact；要让 job 阻断合并，在 branch protection 要求 `testsprite-tests`。[TS-CI][TS-CMD]
- CLI workflow **没有文档承诺自动创建/更新 App 式 PR 评论**；summary 内容相同不等于传输通道相同。[TS-CI]
- 取消 Actions job **不会取消已开始的 TestSprite run**，它仍在 Portal 完成；普通等待超时可用 run ID 重新 wait。[TS-CI][TS-EXIT]
- 写命令支持 `--idempotency-key`；同 key 同 body 可安全重试，同 key 不同 body 返回 `409 IDEMPOTENCY_BODY_MISMATCH`。`RATE_LIMITED` 遵 `Retry-After` 最多 3 次；`UNAVAILABLE` 指数退避最多 4 次；`INTERNAL` 重试一次。auth、validation、credits、plan gate、client too old 不应盲目重试。[TS-EXIT][TS-CMD]
- 关键 exit code：`0` 成功，`1` 未通过，`3` auth，`5` validation/未派发，`6` conflict/precondition，`7` timeout，`10` unavailable/transport，`11` rate limited，`12` credits，`13` plan/paused，`14` client too old。[TS-EXIT]

**未知**：公开文档定义 CLI 黑盒契约而非其底层 TestSprite HTTP API；若复刻自己的 CLI，需要另行定义服务端 dispatch/poll/report API，不能从 flag 名称反推线上私有接口。

## 5. Slack notifications

### 5.1 TestSprite 产品契约

- 仅 workspace Owner/Admin 可在 Integrations 连接/断开；每个 TestSprite workspace 只连一个 Slack workspace。每个项目在 Notifications & Ticketing 独立选 channel、开关 Notify on test run completion。[TS-SLACK]
- OAuth scopes 固定为 `channels:read`、`groups:read`、`chat:write`、`chat:write.public`。私有频道必须先 `/invite @TestSprite`，否则不出现在选择器中。[TS-SLACK]
- 每个 completed run 发一次，不论 manual/scheduled/GitHub/CLI、通过/失败；无 failures-only。卡片含项目/总结果、AI summary、passed/failed/blocked/total、完整结果链接、最多 10 个 failed/blocked 标题、最多 5 张失败优先截图。[TS-SLACK]
- 全 workspace 断开后所有项目立即停止；**保留项目频道选择**，重连同一 Slack workspace 后恢复。私频移除 bot 会导致静默失败。[TS-SLACK]

### 5.2 Slack 供应商契约

- 授权：`GET https://slack.com/oauth/v2/authorize`，带 `client_id`、bot `scope`、HTTPS `redirect_uri`、不可预测 `state`；回调 code 10 分钟有效。服务端以 `POST https://slack.com/api/oauth.v2.access` 换 token，保存 `app_id`、`team.id/name`、`bot_user_id`、`scope`、`access_token`；若传过 redirect_uri，exchange 必须一致。[SLACK-OAUTH]
- Token rotation 是可选且开启后不可关闭的能力；开启后 access token 12 小时过期，refresh 仍走 `oauth.v2.access`（`grant_type=refresh_token`），并须持久化每次返回的新 refresh token。未开启时不得虚构 12 小时过期任务。[SLACK-ROTATE]
- 使用 bot token（`xoxb-`）而非 user token，确保消息以 App 身份发送。频道列表用 `conversations.list?types=public_channel,private_channel&exclude_archived=true`，遵循 cursor 分页并保存 channel ID 而非名称。[SLACK-TOKEN][SLACK-CHANNELS]
- 发消息：`POST https://slack.com/api/chat.postMessage`，Bearer token，JSON 至少含 `channel` 与 `text`；富卡片用 `blocks`，仍保留 `text` fallback。成功保存返回的 `channel`、`ts`。Web API 必须检查 JSON `ok`，不能只看 HTTP 200。[SLACK-POST]
- 通常每频道每秒一条，突发另有 workspace 限制；`429` 必须遵 `Retry-After`。`not_in_channel`/`channel_not_found`/`is_archived` 属配置问题，`invalid_auth`/`token_revoked`/`token_expired` 属重授权问题，不应做同样重试。[SLACK-POST][SLACK-RATE]
- Slack 不为 `chat.postMessage` 提供通用幂等键；本地以 `(project, run, channel)` 唯一约束保证“一次完成运行一条”，超时后先标记 outcome unknown 并对账，不直接重发。[SLACK-POST]
- 截图是 TestSprite 已证实内容，但其通过公开 image URL、Slack file upload 或其他方式传输未公开；实现前须另定存储/上传/过期契约，不能假设 `chat.postMessage` 会自动上传本地图片。[TS-SLACK][SLACK-POST]

### 5.3 可选 inbound 生命周期事件

通知本身不需要 Events API。若要在 Slack 侧卸载/撤销时立即失效，可订阅 `app_uninstalled`、`tokens_revoked`：验签使用 signing secret、`X-Slack-Request-Timestamp` 与 `X-Slack-Signature`，对 raw body 计算 `v0:timestamp:body` 的 HMAC-SHA256，并拒绝超过 5 分钟的 timestamp。[SLACK-VERIFY][SLACK-LIFECYCLE]

Events envelope 以 `event_id` 全局唯一去重，`team_id/api_app_id` 路由；`url_verification` 返回 challenge。正常事件须 **3 秒内 2XX**，失败最多重试 3 次（近似立即、1 分钟、5 分钟），诊断 headers 为 `X-Slack-Retry-Num/Reason`；非 200 响应可带 `X-Slack-No-Retry: 1` 禁止该次重试。[SLACK-EVENTS][SLACK-HTTP]

本地 Disconnect 可调 `auth.revoke` 撤销 token，但这不等于完整卸载 App；撤销 bot token 会使 bot 停用并离开频道。是否执行远程撤销与 TestSprite 文档的“保留频道、同 workspace 重连恢复”如何组合，须作为本地实现决策并测试。[SLACK-REVOKE][TS-SLACK]

## 6. Jira 与 Linear 共有的 Ticketing 业务契约

### 6.1 配置与创建

- Workspace 级 OAuth 由 Owner/Admin 连接；项目级分别选择 Jira **project**（issue type `Bug`）或 Linear **team**。手工保存默认 destination 不会开启自动建单。[TS-TICKET]
- 手工：failed 或 blocked 测试的详情/执行/列表入口 → Create Bug Ticket → tracker + destination → 确认；成功后按钮变为 Open `<issue key>`。[TS-TICKET]
- 自动：run 完成时按 distinct failure 建单；`Include blocked tests` 默认 Off；`Max new tickets per run` 默认 **20**，只限制新票，重复失败评论不占额度。[TS-TICKET]
- 标题 `[TestSprite] Test failed: <test name>`；共票时 `N tests failed: …`。正文含项目/测试、execution ID、运行链接、可用的 AI probable cause、raw error code block、回归旧票链接。error/cause 离站前脱敏；只链接运行，不附截图。[TS-TICKET]
- 两个 tracker 可同时启用，各自 destination、各自 dedup；没有 GitHub Issues 或内置 tracker。[TS-TICKET]

### 6.2 去重与恢复状态机

| 情况 | TestSprite 行为 |
|---|---|
| 同测试再次失败，已有跟踪票 | 写 “failed again” 评论，不新建 |
| 不同测试同 root-cause error signature | 在 **7 天窗口**内共票，单票最多 **25 个测试** |
| 手工与自动指向同 destination | 共享去重，不重复建票 |
| 测试后来通过 | 写 recovery comment，停止更新该票 |
| 共票仅部分恢复 | 评论说明仍失败数量；全部恢复后才停止 |
| 恢复后再次失败 | 开新票并链接已恢复旧票 |
| 远程 issue 状态 | 不 transition、不 close，交给团队 workflow |

以上是产品行为，不是 Jira/Linear 自动提供的能力。[TS-TICKET]

**本地建议**：在同一 DB 事务内计算 dedup、占 ticket slot、写 outbox；唯一键至少包含 tracker connection + destination + active test link，group ticket 另存 signature、window、test memberships、active/recovered 状态。外部 API 成功后再存 issue ID/key/identifier、URL、comment IDs。慢 API 不得占着 DB 事务，可使用 reservation → 出站调用 → 完成/对账的三态操作。

**未知**：error signature 的输入与规范化、7 天起点/滑动规则、25 个测试的计数口径、cap 之外失败是丢弃/延后/排队、删除/关闭远程票后的行为、API 失败重试与 UI 呈现、断开是否保留 destination/dedup 状态。

## 7. Jira Cloud 供应商契约

### 7.1 OAuth 3LO 与站点/项目选择

- Developer Console 建 OAuth 2.0 (3LO) integration，配置 Callback URL、Jira API 权限；对外安装需启用 distribution sharing。授权 URL 为 `https://auth.atlassian.com/authorize`，固定 `audience=api.atlassian.com`、`response_type=code`、`prompt=consent`，带匹配 `redirect_uri`、用户绑定且不可猜测的 `state`。[JIRA-OAUTH]
- 基线 scopes：`read:jira-work`（站点/项目/issue 读取）、`write:jira-work`（建 issue/comment）、`offline_access`（refresh token）。scope 不替代 Jira 用户权限；目标用户仍需 Browse projects、Create issues、Add comments。[JIRA-SCOPES][JIRA-ISSUE][JIRA-COMMENT]
- `POST https://auth.atlassian.com/oauth/token` 以 authorization_code 换 token；refresh 也走该端点。refresh token **旋转**，每次成功必须原子保存新 token；默认 inactivity expiry 90 天、reuse leeway 10 分钟。`invalid_grant` 后要求重新授权，不应循环刷新。[JIRA-OAUTH]
- 调 `GET https://api.atlassian.com/oauth/token/accessible-resources` 获取 Jira site 的 `id`（cloudid）、name、url、scopes。Jira API 必须走 `https://api.atlassian.com/ex/jira/{cloudid}/...`，不是租户 hostname。[JIRA-OAUTH]

### 7.2 建单、评论、限流

- 项目列表可用 `GET /rest/api/3/project/search`；建单前读取 create metadata，解析目标 project 的 Bug issue type ID 和额外必填字段，不能硬编码 `10000`。[JIRA-PROJECT][JIRA-ISSUE]
- `POST /rest/api/3/issue` 的核心 JSON 为 `fields.project.id`、`fields.issuetype.id`、`fields.summary`；API v3 的 `description` 使用 Atlassian Document Format (ADF)。成功 `201`，保存 `id/key/self`，再生成用户可访问 URL。[JIRA-ISSUE]
- 重复/恢复评论：`POST /rest/api/3/issue/{issueIdOrKey}/comment`，`body` 为 ADF；成功 `201` 并保存 comment ID。[JIRA-COMMENT]
- Jira 有 hourly points、per-second burst、per-issue write 等独立限流；`429` 时遵 `Retry-After` 并检查 `RateLimit-Reason`。Create Issue/Add Comment 非幂等，Atlassian 明确建议只在操作幂等且有 Retry-After 时自动重试，因此出站 worker 必须先对账本地 reservation/外部对象，不得简单重复 POST。[JIRA-RATE]

### 7.3 Webhook 与断开边界

基线建单/评论/不关单**不需要 Jira webhook**，也不需要 `manage:jira-webhook`。只有未来要同步远程编辑/状态时才引入 OAuth dynamic webhooks：注册 `POST /rest/api/3/webhook`，30 天过期需 refresh；事件如 `jira:issue_created/updated/deleted`，payload 有 `timestamp`、`webhookEvent`、`issue.id/key/fields`、`user`、更新时的 `changelog`。[JIRA-WH]

Jira webhook 以 `X-Atlassian-Webhook-Identifier` 跨重试去重，失败最多重发 5 次、随机 backoff 5–15 分钟；OAuth dynamic webhook 的 Authorization bearer JWT 验证与 Connect sharedSecret、管理后台 HMAC webhook 是三种不同机制，不能混用。[JIRA-WH]

用户可在 Atlassian Connected apps 撤销授权，admin uninstall 会撤销用户 grants；公开资料未给出通用 app-initiated OAuth revocation endpoint 或 OAuth 3LO uninstall callback。本地 Disconnect 应立即停用任务、标记 reauth 并清除本地 secret；是否尝试远程卸载不可承诺。[JIRA-ADMIN]

## 8. Linear 供应商契约

### 8.1 OAuth、actor 与刷新

- 授权：`GET https://linear.app/oauth/authorize`，带 `client_id`、匹配 `redirect_uri`、`response_type=code`、逗号分隔 scope、`state`；建议 PKCE S256。`prompt=consent` 可用于连接多个 workspace。[LINEAR-OAUTH]
- 基线 scopes：`issues:create` 与 `comments:create`；`read` 总会出现。避免 broad `write`/`admin`。`actor=user` 默认以授权用户身份创建；`actor=app` 以 App 身份创建且安装需 workspace admin。TestSprite 未公开 actor 选择，实施前需决定产品归因。[LINEAR-OAUTH][LINEAR-ACTOR]
- `POST https://api.linear.app/oauth/token` 用 form-encoded authorization_code 换 token。access token 有效 **24 小时**；每次 refresh 返回新 access + refresh token，原 refresh 请求有 **30 分钟**重放宽限。用 per-installation single-flight 刷新并原子保存 token pair；`invalid_grant` 标记重授权。[LINEAR-OAUTH]
- 本地断开可 `POST https://api.linear.app/oauth/revoke`，form 字段 `token`，可选 `token_type_hint=access_token|refresh_token`；200 成功，400/401 也要使本地连接进入断开/重授权终态而非无限重试。[LINEAR-OAUTH]

### 8.2 GraphQL 建单、评论、限流

- 所有调用走 `POST https://api.linear.app/graphql`，Bearer token。先 `teams { nodes { id name } }` 选择并保存 team UUID。[LINEAR-GQL]
- `issueCreate(input:{title, description, teamId})`，选择 `success issue { id identifier url }`。不显式传 `stateId` 时进入 team 第一个 Backlog state；开启 Triage 时进入 Triage，符合“不自动关单”的边界。[LINEAR-GQL]
- 重复/恢复评论用 `commentCreate(input:{issueId, body})`；2026-11-04 对 Linear 公开 GraphQL schema 的只读 introspection 证实 `CommentCreateInput` 含 `issueId`、`body`。实现仍应通过 SDK/schema 固定版本，而非手写未验证 selection。[LINEAR-GQL]
- GraphQL 可能 HTTP 200 同时返回 partial data + `errors`；必须检查 `errors` 与 mutation `success`。OAuth 请求/复杂度有限流，`429` 时 `errors[].extensions.code=RATELIMITED` 并遵 `Retry-After`。issueCreate/commentCreate 不是幂等键替代物，超时先对账。[LINEAR-GQL][LINEAR-RATE]

### 8.3 可选 webhook 与撤销通知

基线 ticketing 不需要 inbound webhook。若要接收 OAuthApp revoked 或未来 issue/comment 同步，可在 OAuth App 上配置 organization webhook；运行时 `webhookCreate` 需要 workspace admin 或 OAuth `admin` scope，因此 `actor=app` 基线不应为了建单额外请求 admin。[LINEAR-WH][LINEAR-ACTOR]

Webhook headers 为 `Linear-Delivery`（payload UUID）、`Linear-Event`、`Linear-Signature`、`Linear-Timestamp`；data-change body 含 `action=create|update|remove`、`type`、`actor`、`createdAt`、`data`、`url`、`updatedFrom`、`webhookTimestamp`，示例另有 `organizationId/webhookId`。以 webhook secret 对 raw body 做 HMAC-SHA256、常量时间比较，并检查 timestamp 新鲜度。[LINEAR-WH]

接收端必须公开 HTTPS、**5 秒内返回 200**；失败最多重试 3 次（1 分钟、1 小时、6 小时），持续无响应时 Linear “might disable”，无精确阈值。按 `Linear-Delivery` 去重并异步处理；OAuthApp revoked payload 只保证 `oauthClientId` 与 `organizationId`，不要猜其他 action/type 字符串。[LINEAR-WH]

## 9. 部署配置要求

以下是实现所需配置项，不是 TestSprite 公开的环境变量命名；名称可映射到现有部署规范。

| 配置组 | 必需项 | 说明 |
|---|---|---|
| 公共入口 | `PUBLIC_BASE_URL`、HTTPS 可信证书 | GitHub App 与可选 Slack/Jira/Linear webhooks 需要公网可达；回调/webhook 路径固定注册 |
| 密钥保护 | `INTEGRATION_TOKEN_ENCRYPTION_KEY`、OAuth state 签名/存储 | access/refresh token、App private key、client secret、webhook secret 只能服务端加密保存；禁止浏览器/localStorage |
| GitHub App | App ID/Client ID、PEM private key、webhook secret | 配置 webhook URL、权限和事件；private key 支持轮换 |
| GitHub Export | 独立的 personal OAuth client ID/secret、callback URL | 与 App installation 逻辑分表/分状态；具体 app 类型与 scope 待第 12 节决策 |
| Slack | client ID/secret、OAuth callback；可选 signing secret + Events Request URL | 不启用 inbound 生命周期时 signing secret 不参与通知发送 |
| Jira | 3LO client ID/secret、callback URL、Jira API scopes | accessible-resources 决定 cloudid；refresh worker 必须持久化旋转 token |
| Linear | OAuth client ID/secret、callback URL；可选 app webhook signing secret | 保存 workspace/app-user identity、team ID、refresh token 与 expiry |
| 队列/调度器 | durable outbox、retry scheduler、webhook recovery job | 不在 HTTP 请求中执行测试/外部写；支持 per-connection/job 锁与 dead letter |
| 数据存储 | connection、project setting、trigger/activity、webhook receipt、outbox、export、ticket link | 用唯一约束而非“先查再插”实现去重；保存外部 ID 与原始诊断信息 |
| 可观测性 | operation ID、run ID、delivery ID、request ID、attempt、next retry、last error | 日志不得记录 token、完整 webhook secret、未脱敏 error/cause |

建议回调/接收路径（本地设计，非 TestSprite 已知路径）：

```text
POST /api/integrations/github/webhook
GET  /api/integrations/github/export/callback
GET  /api/integrations/slack/oauth/callback
POST /api/integrations/slack/events                 # 可选
GET  /api/integrations/jira/oauth/callback
GET  /api/integrations/linear/oauth/callback
POST /api/integrations/linear/webhook               # 可选
```

GitHub、Slack、Linear 验签都必须读取 raw body；body parser 不能先重序列化。OAuth `state` 应单次、短期、绑定本地用户/workspace；Linear/GitHub user flow 使用 PKCE 时还要绑定 verifier。后台 job 需限流、超时、取消、认证失效状态和人工重试入口。[GH-VERIFY][SLACK-VERIFY][LINEAR-WH][JIRA-OAUTH]

## 10. 统一失败/重试/断开矩阵

| 链路 | 去重依据 | 供应商失败行为 | 本地出站写入策略 | 断开契约 |
|---|---|---|---|---|
| GitHub inbound | `X-GitHub-Delivery`；redelivery 不变 | 10 秒 2XX；**无自动重投**，近 3 天可补投 | 入队后异步，业务幂等键防重复运行 | installation 删除/仓库移除即停触发，保留历史 |
| GitHub PR 结果 | 保存 comment ID；status 用稳定 context + SHA | 429/5xx/网络错误需分类 | 评论优先 PATCH；不确定时先读取 | token/installation 失效即标错误，不继续写 |
| GitHub Export | project/export generation、repo/path/commit 对账 | 建库/写文件无通用幂等承诺 | 不盲目重复 POST；文件 409 重新读 SHA | 个人连接与 App 分开；产品保留语义未知 |
| Slack 通知 | `(project, run, channel)` + 返回 `ts` | 429 遵 Retry-After；事件另有 3 次 retry | 每次完成运行一条；unknown outcome 先对账 | 全项目即停，保留频道，同 workspace 重连恢复 |
| Jira ticketing | 本地 active test/signature/ticket reservation + issue/comment ID | 429/限流；webhook 策略不适用出站建单 | ADF create/comment；非幂等，不对不明结果重复 POST | 本地即停；refresh invalid_grant 要 reauth；远程撤销回调不保证 |
| Linear ticketing | 同上 + issue/comment ID | GraphQL 200 也可有 errors；429 遵 Retry-After | mutation 检查 success/errors；不明结果先查 | 可调 revoke；可选 OAuthApp revoked webhook |
| CLI CI | `--idempotency-key` + run ID | 429 3 次、503 4 次、500 1 次；exit code 分流 | CI 只负责启动/等待/报告，不冒充 App comment | 取消 job 不取消远端 run；成员移除使 key 失效 |

## 11. 可直接进入实施的验收要点

1. **授权隔离测试**：同一 workspace 可同时存在 GitHub App installation 与个人 Export 连接；撤销其中一个不得误删另一个。[TS-GH]
2. **webhook 重放测试**：同一 GitHub GUID、Slack event_id、Jira identifier、Linear delivery 重放均返回成功但不重复执行；raw-body 篡改必须拒绝。[GH-WH-BEST][SLACK-EVENTS][JIRA-WH][LINEAR-WH]
3. **就绪信号测试**：PR opened 但部署未 ready 不运行；选定 check/workflow/deployment/comment 成功后才解析 URL 并运行；Push 使用预配置 Environment。[TS-GH]
4. **导出快照测试**：两个已完成执行导出后，latest 指向最近执行，history 同时保留两者；failed 执行也包含；路径/branch 固定。[TS-GH]
5. **Slack 四来源测试**：manual/scheduled/GitHub/CLI 各完成一次各发一条；passed 也发；断开即停且重连同 workspace 恢复原频道。[TS-SLACK]
6. **票务竞争测试**：手工与自动并发、同 signature 多测试并发、重复 delivery/重试均不重复建票；每轮新票最多配置值，评论不占新票 cap。[TS-TICKET]
7. **恢复状态机测试**：共票部分恢复继续跟踪，全部恢复写最后评论并停止；再次失败创建带旧票链接的新票，不 transition 远程 issue。[TS-TICKET]
8. **不明结果测试**：在建库/发帖/建单/评论“服务器已应用但客户端超时”的故障注入下，不产生重复外部对象；进入可诊断的 reconciliation/dead-letter 状态。
9. **token 生命周期测试**：Jira/Linear 单飞刷新并持久化新 refresh token；撤销/成员移除/scope 不足均进入明确 reauth 或配置错误，不做无限重试。[JIRA-OAUTH][LINEAR-OAUTH][TS-AUTH]
10. **CLI 安全测试**：fork/draft 按规则跳过；preview URL 缺失不扣费；取消 job 不宣称取消远端 run；summary/artifact 在失败时也按契约生成。[TS-CI]

## 12. 实施前未知项与必须决策

### P0：不决定就无法保证“真实可用”

- **GitHub 信号匹配**：每种原始事件的 action/status/conclusion 白名单、bot comment URL 提取与可信作者规则、同 SHA 多信号/多规则去重、URL 不可达重试、运行并发与取消。
- **GitHub Export 身份**：personal OAuth App 或 GitHub App user flow、scopes/token 刷新；repo owner/name/private、已有 repo 链接入口、空库与 main 初始化、导出原子性/冲突/覆盖策略。
- **出站不确定性**：四个供应商均需要本地 operation/outbox 与 reconciliation 规则；不能用统一“失败后重试 3 次”掩盖重复外部写入。
- **Ticket dedup 算法**：error signature 规范化与脱敏先后顺序、7 天窗口锚点、25-test 上限、recovery 后旧映射归档、cap 溢出处理。
- **失败可见性**：TestSprite 公开文档未说明 Slack/建单/导出失败队列与 UI；本地至少要保存可诊断状态，不能把私频 bot 被移除的“静默失败”当成完整工程目标。

### P1：可在主流程后决定，但须写进规格

- Linear `actor=user` 或 `actor=app`；Jira 多 site grant 的 workspace 绑定；是否启用 Slack/Jira/Linear 可选 inbound webhook。
- Jira 额外必填 fields、ADF 转换上限；Linear issue 默认 state 是否保持 Backlog/Triage；自定义 assignee/labels/priority 当前均无 TestSprite 证据。
- Slack 最多 5 张截图的上传/公开 URL/保留期限与失败降级；通知卡片 Block Kit 精确 JSON。
- Disconnect 是否撤销远程 token、保留多久外部 ID/dedup/history；除 Slack 与 GitHub trigger 外，TestSprite 公开文档未明确重连恢复配置的承诺。
- TestSprite ticketing 的具体可用套餐名称需按 pricing 页面/产品决策另行固定；本调研未购买或验证计划门槛。[TS-TICKET]

### 文档明确不能当作事实的事项

- 不得把 GitHub App trigger 写成仅订阅 `pull_request.opened/synchronize`；TestSprite 当前规则围绕真实 CI/CD 就绪信号。[TS-GH]
- 不得把 Export to GitHub 写成创建 Issue、复用 App installation 或允许自定义分支/路径。[TS-GH]
- 不得把 CLI job summary 写成 App PR comment，也不得把取消 Actions job 写成取消远端执行。[TS-CI]
- 不得声称 GitHub 自动重试 webhook，或 Jira/Linear API 自动完成 TestSprite 的 7 天/25 测试去重。[GH-WH-FAIL][TS-TICKET]
- 不得为基线 Slack/Jira/Linear 出站能力强加 inbound webhook；可选生命周期/同步契约必须单独配置和验收。

## 一手来源索引

### TestSprite

- [TS-GH] GitHub Integration（当前文档同时覆盖 App triggers、Trigger activity、disconnect 与 Export to GitHub）
- [TS-CI] CLI CI/CD
- [TS-CMD] CLI Command Reference
- [TS-EXIT] CLI Exit Codes & Errors
- [TS-AUTH] CLI Authentication
- [TS-SLACK] Slack Notifications
- [TS-TICKET] Ticketing（Jira / Linear）

### GitHub

- [GH-APP-AUTH] About authentication with a GitHub App
- [GH-JWT] Generating a JSON Web Token (JWT) for a GitHub App
- [GH-IAT] Generating an installation access token for a GitHub App
- [GH-APP-REG] Registering a GitHub App
- [GH-APP-WH] Using webhooks with GitHub Apps
- [GH-EVENTS] Webhook events and payloads
- [GH-VERIFY] Validating webhook deliveries
- [GH-WH-BEST] Best practices for using webhooks
- [GH-WH-FAIL] Handling failed webhook deliveries
- [GH-REDELIVERY] Redelivering webhooks
- [GH-COMMENT] REST API endpoints for issue comments
- [GH-STATUS] REST API endpoints for commit statuses
- [GH-REPO] Create a repository for the authenticated user
- [GH-CONTENTS] Create or update file contents

### Slack

- [SLACK-OAUTH] Installing via OAuth authorization code flow / oauth.v2.access
- [SLACK-ROTATE] Using token rotation
- [SLACK-TOKEN] Tokens
- [SLACK-CHANNELS] conversations.list
- [SLACK-POST] chat.postMessage
- [SLACK-RATE] Rate limits
- [SLACK-VERIFY] Verifying requests from Slack
- [SLACK-EVENTS] The Events API
- [SLACK-HTTP] Using HTTP Request URLs
- [SLACK-LIFECYCLE] app_uninstalled / tokens_revoked
- [SLACK-REVOKE] auth.revoke

### Jira / Atlassian

- [JIRA-OAUTH] OAuth 2.0 (3LO) apps
- [JIRA-SCOPES] Jira scopes for OAuth 2.0 (3LO) and Forge apps
- [JIRA-PROJECT] Get projects paginated
- [JIRA-ISSUE] Create issue / Get create issue metadata
- [JIRA-COMMENT] Add comment
- [JIRA-RATE] Rate limiting
- [JIRA-WH] Webhooks
- [JIRA-ADMIN] Manage your organization's Marketplace and third-party apps

### Linear

- [LINEAR-OAUTH] OAuth 2.0 authentication
- [LINEAR-ACTOR] OAuth actor authorization
- [LINEAR-GQL] GraphQL API — Getting started（另含本次只读 `CommentCreateInput` introspection）
- [LINEAR-RATE] Rate limiting
- [LINEAR-WH] Webhooks

[TS-GH]: https://docs.testsprite.com/web-portal/integrations/github-integration
[TS-CI]: https://docs.testsprite.com/cli/integrations/ci-cd
[TS-CMD]: https://docs.testsprite.com/cli/reference/command-reference
[TS-EXIT]: https://docs.testsprite.com/cli/reference/exit-codes
[TS-AUTH]: https://docs.testsprite.com/cli/core/authentication
[TS-SLACK]: https://docs.testsprite.com/web-portal/integrations/slack-notifications
[TS-TICKET]: https://docs.testsprite.com/web-portal/integrations/ticketing
[GH-APP-AUTH]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app
[GH-JWT]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
[GH-IAT]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
[GH-APP-REG]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
[GH-APP-WH]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps
[GH-EVENTS]: https://docs.github.com/en/webhooks/webhook-events-and-payloads
[GH-VERIFY]: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
[GH-WH-BEST]: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
[GH-WH-FAIL]: https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
[GH-REDELIVERY]: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks
[GH-COMMENT]: https://docs.github.com/en/rest/issues/comments
[GH-STATUS]: https://docs.github.com/en/rest/commits/statuses#create-a-commit-status
[GH-REPO]: https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user
[GH-CONTENTS]: https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents
[SLACK-OAUTH]: https://docs.slack.dev/authentication/installing-with-oauth/
[SLACK-ROTATE]: https://docs.slack.dev/authentication/using-token-rotation/
[SLACK-TOKEN]: https://docs.slack.dev/authentication/tokens/
[SLACK-CHANNELS]: https://docs.slack.dev/reference/methods/conversations.list/
[SLACK-POST]: https://docs.slack.dev/reference/methods/chat.postMessage/
[SLACK-RATE]: https://docs.slack.dev/apis/web-api/rate-limits/
[SLACK-VERIFY]: https://docs.slack.dev/authentication/verifying-requests-from-slack/
[SLACK-EVENTS]: https://docs.slack.dev/apis/events-api/
[SLACK-HTTP]: https://docs.slack.dev/apis/events-api/using-http-request-urls/
[SLACK-LIFECYCLE]: https://docs.slack.dev/reference/events/app_uninstalled/
[SLACK-REVOKE]: https://docs.slack.dev/reference/methods/auth.revoke/
[JIRA-OAUTH]: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
[JIRA-SCOPES]: https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
[JIRA-PROJECT]: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get
[JIRA-ISSUE]: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post
[JIRA-COMMENT]: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/#api-rest-api-3-issue-issueidorkey-comment-post
[JIRA-RATE]: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/
[JIRA-WH]: https://developer.atlassian.com/cloud/jira/platform/webhooks/
[JIRA-ADMIN]: https://support.atlassian.com/security-and-access-policies/docs/manage-your-users-third-party-apps/
[LINEAR-OAUTH]: https://linear.app/developers/oauth-2-0-authentication
[LINEAR-ACTOR]: https://linear.app/developers/oauth-actor-authorization
[LINEAR-GQL]: https://linear.app/developers/graphql
[LINEAR-RATE]: https://linear.app/developers/rate-limiting
[LINEAR-WH]: https://linear.app/developers/webhooks
