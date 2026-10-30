---
title: P5 Test Files / 跨项目用例集 / 定时
type: task
status: done
assignee: ""
blocked_by: [p4-runs-and-map]
---

## Question

- Test Files 生效：执行含上传步骤时从附件库取文件注入（解决「导入受阻因为没文件」类 blocked）
- Test Lists：跨项目用例集（`at_test_lists` + items），可从一次运行「Make a list from last run」
- Test Schedules：`at_schedules` + 服务端定时扫描（cron 到点触发整集执行，失败继续）

## Resolution

**交付**

- **Test Files 注入**：`upload-inject.ts`（`pickUploadFiles` 四级确定性选取：步骤文本提文件名 → accept 扩展名 → 单文件 → 首文件；`installUploadInjector` 拦截 `filechooser` 填入，返回 dispose）。`runner.ts` 装/卸拦截器（每步更新当前步骤文本供选取）；`run-manager.ts` 在 startRun 时快照项目附件库进 `PendingExecution.uploadFiles`。无需改步骤 schema，双引擎（极速/纯视觉）都受益。
- **Test Lists**：`at_test_lists` + `at_test_list_items`（`uk(list_id, case_id)` 幂等）+ 11 个 repo 方法（双实现：MySQL + 内存）；`startCaseBatch` 抽出共用编排（getCase → ensureCompiled → 跳过 manual → startRun 带 batchId），`/runs/batch`、`/test-lists/:id/run`、`/schedules/:id/run`、调度器四处复用——「失败继续」语义天然内含（逐条 try/catch）。
- **Test Schedules**：`at_schedules`；`cron.ts` 纯 5 段匹配器（`* , - */n a-b/n`，dow 7→0，`validateCron` 中文报错，`describeCron` 中文描述）+ `scheduler.ts` 60s 扫描（enabled && cronMatches && 非本分钟已触发 → 先写 lastRunAt 再触发，unref 定时器随进程存活）。到点触发 `startCaseBatch(items, { aiConfig: null, useCache: true })`——无用户会话，未编译提案用例按占位步骤直跑，无根因自动生成。
- **API/前端**：12 个端点（lists CRUD、items 增删、run 整集、`from-run`（batchId→整组用例收进新列表）、schedules CRUD、`schedules/:id/run`）；`TestListsView`（`/automation/lists` 主从布局：列表侧栏 + 用例/定时双表 + cron 预设）；运行详情页「从本次运行建列表」按钮（批次收整组）；项目列表头部「Test Lists · 定时」入口。

**验证（2026-10-30 实测）**

- 新增单测 20 个全绿（upload-inject 7、cron 匹配器、scheduler 到点/同分钟去重/异常隔离）；门禁：`server:build` + 双端 `tsc` 干净，`npm test` 820/821（唯一失败为存量 docling-serve `testcase-reference-parse`；loadtest k6 锁检测为并行 flake，隔离 42/42）。
- 真机走查全链：运行详情「建列表」→ 列表页选中 → 「运行整集」发批次 → 运行历史确认 passed；定时 `* * * * *` 到点触发 5 次真实运行（09:07–09:12 五个独立批次，全 passed）后删除该定时；lastRunAt 持久化 + UI 展示中文描述（每天 09:00）确认。截图留证（列表 + ATC-001 成员 + 定时行）。
- **上传注入 E2E**：临时 `public/upload-demo.html`（file input accept=.csv）+ 附件库 users.csv + 三步用例（选择文件 → 上传 → 断言显示文件名）真实引擎两轮跑通——第二轮 3/3 全过，服务端日志命中「Test Files 注入：拦截文件选择对话框」。演练毕已删演示用例与临时页；附件 users.csv 留作库展示。

**走查发现并修复的缺陷**

1. `lastRunAt` 写库用 ISO 字符串（含 T/Z）被 MySQL DATETIME(3) strict 模式拒——`updateSchedule` 改传 `toDate(iso)`（沿 `updateRunRecord` 惯例）；损坏期间同分钟去重失效导致重复触发，已随修复恢复。
2. 注入文件名泄漏存储名（`<uuid>-users.csv`）——Playwright `setFiles(path)` 用路径 basename 当上传名；改传 `FilePayload {name, mimeType, buffer}` 保留原始文件名（单测覆盖「载荷带原始文件名」）。

**语义澄清**：`* * * * *` 每个整分触发一次是**正确**行为（「每分钟」）；去重仅限同分钟内不重发。定时触发不带 AI 配置（无用户会话）属设计取舍，已在 UI 注明。

**清理**：验证毕删除每日定时（避免每日真实跑 Kimi）与临时演示物；保留 from-run 测试列表与附件库文件作演示数据。
