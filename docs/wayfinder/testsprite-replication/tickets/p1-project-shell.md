---
title: P1 项目化外壳与建项目向导
type: task
status: done
assignee: main-session
blocked_by: []
---

## Question

把「自动化测试」从单一四页签页面改造为 TestSprite 的「工作区 ⊃ 项目」形态：

- `/automation` → 项目列表（All Projects 形态：项目名 + 最新结果徽章 + 最近活动 + 来源 + 新建入口）
- `/automation/new` → 建项目三步向导（Basics[类型+URL+名称] / Access[凭据/免登录/SSO占位] / Extra[PRD 文本+附件+指令]）
- `/automation/p/:projectId/*` → 项目工作台外壳 + 子导航（探源/用例/执行台/运行/洞察/设置）
- 现有四页签归入项目工作台的「用例」「运行」「设置」；「交互执行台」保留
- 项目级设置页：General（名称/类型/额外指令/Danger Zone）、环境（多环境 + 测试账号）、运行行为（每次运行只登一次/视口/并发）、测试文件（上传列表）

数据模型新增：`at_projects_ext`（defaultEnvId/extraInstructions/prdText）、`at_environments`、`at_test_files`（本期只存不管用）；沿用 mysql + memory 双仓储与 tolerant ALTER。

## Resolution

2026-10-20 完成并实测通过。

**落地内容**

- 路由改造（[App.tsx](../../../ai-test-tools-site/src/App.tsx)）：`/automation`→项目列表、`/automation/new`→三步向导、`/automation/p/:projectId/:section?`→项目工作台、`/automation/cases/:id`→用例编辑器（独立页，支持 `?project=` 预填）。
- 项目列表 [ProjectListView.tsx](../../../ai-test-tools-site/src/features/automation/ProjectListView.tsx)：卡片（名称 + 最新结果徽章「n 失败/通过 共 N」+ 入口地址 + 用例数 + 最近活动）、搜索、空态、新建入口。
- 三步向导 [ProjectWizardView.tsx](../../../ai-test-tools-site/src/features/automation/ProjectWizardView.tsx)：Basics（Web 类型卡 + 被测地址 + 名称）→ Access（凭据/免登录/SSO 占位）→ Extra（PRD 原文 + 附件 ≤3×10MB + 额外指令）；创建时一次性完成 upsertProject + 凭据入库（`PROJ_<suffix>_USERNAME/PASSWORD`）+ 默认环境 + 附件上传，然后跳转工作台探源页。
- 工作台 [ProjectWorkbenchView.tsx](../../../ai-test-tools-site/src/features/automation/ProjectWorkbenchView.tsx)：面包屑（全部项目/名称/URL）+ 六段子导航（探源/用例/执行台/运行/洞察/设置）；用例/执行台/运行 keep-mounted 复用现有视图并按 projectId 过滤；探源/洞察为 P2/P6 占位页。
- 项目设置 [ProjectSettingsView.tsx](../../../ai-test-tools-site/src/features/automation/ProjectSettingsView.tsx)：左侧 mini-nav 五页——General（改名/额外指令/PRD 原文/Danger Zone 输名确认删除）、环境（CRUD + 默认环境 + 凭据键名引用）、运行行为（每次运行只登一次/视口/并发 1–5）、测试文件（列表/上传/删除）、执行配置（嵌入全局 AutomationConfigView）。
- 服务端：`GET/POST /api/automation/projects`、`GET/PUT .../projects/:id/ext`、环境 CRUD + `/default`、测试文件 GET/POST(base64 ≤10MB→`artifacts/automation-files/<pid>/`)/DELETE；仓储新增 `at_projects_ext`/`at_environments`/`at_test_files` 三表（mysql + memory 双实现，tolerant ALTER）。

**实测记录**（预览面板，账号 preview-check，vite 5202 → API 3001 新构建）

1. 项目列表渲染两张存量卡（结果徽章/用例数/相对时间正确）。
2. 向导三步流转：填 `www.saucedemo.com` + 名称 → 凭据 → Extra → 创建 → 自动跳 `/automation/p/proj_…/sources`。
3. 工作台六段全部可达；环境页可见向导自动建的 default 环境（URL + `PROJ_86130487_USERNAME` 键名引用）——证明创建链路的凭据/默认环境写入生效。
4. 设置五子页全部渲染；Danger Zone 输名确认删除实测通过，删除后回列表且卡片消失。
5. 全程无控制台错误（仅登录前两条 auth/me 401，预期）。

**实测中修复的缺陷**

- 向导第一步 `canNext` 校验写反：`/^https?:\/\//.test(url || 'https://'+url)` 在输入裸域名（placeholder 引导的用法）时永远 false，「继续」永久禁用。改为与 `normalizedUrl()` 对齐的非空校验（[ProjectWizardView.tsx](../../../ai-test-tools-site/src/features/automation/ProjectWizardView.tsx)）。

**验证**：`tsc --noEmit` 干净；`npm test` 738 过 / 1 失败为既有问题（`testcase-reference-parse.test.ts` 期望「提取出文本」而源码为「提取出有效文本」，与本票据无关，已另行上报）。

**注意**：本机 3000 端口被 loadtest Grafana 容器占用，vite 代理须用 `VITE_API_TARGET=http://localhost:3001` 指向新构建（`.claude/dev-p1-verify.cmd` 固化）。
