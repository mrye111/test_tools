# 0008 — 测试报告页重构为 AI 报告工作台

## 状态

已接受

## 背景

原测试报告工具是纯前端实现：导入禅道 CSV → 浏览器内解析 → ECharts 图表 + 主题皮肤。图表样式固定、无持久化、无 AI 能力，且"几句话快速出报告"的定性汇报场景无处安放。用户要求引入 lieflat-charts 视觉体系（Agent Skill，46 图型 gallery 模板），同时保留 CSV 通路并新增自然语言快速报告。

## 决策

- **报告产物 = AI 生成的单文件 HTML**（lieflat-charts 原生交付契约），不做 46 图型的前端组件化移植（与上游双份维护，否决）。
- **两阶段生成管线**：选图阶段（白名单紧凑描述 → 严格 JSON 选型，含缺数占位条目）→ 组装阶段（后端从 vendored gallery 抽取选中图型的真实渲染片段注入 prompt，模型只替换数据与组织整页）。模板保真由注入代码保证。
- **图型白名单一期 16 种**（Lupi/Basics 优先，Glance 仅 G7/G15 且写明降级理由；暗卡图、动画/实时类、交互大图排除），抽取脚本与片段库入库（`server/scripts/extract-chart-fragments.mjs` + `server/assets/`）。
- **报告持久化为报告记录**（`tr_reports` 表 / 内存降级，共享聊天域连接池），记录列表 ↔ 报告视图两层结构，回看与再导出不调 AI；只保存完成态。
- **CSV 通路单轨替换**：前端解析 CSV 后上传结构化 JSON（现有解析器不动），旧 ECharts 报告（features/test-report 的视图/主题/图表体系）整体退役。
- **数据诚实红线**：定性输入只出结构图；缺数图型以 `data-missing` 占位卡呈现，补录后经追改通路整体重生成解锁；诚实校验（标题百分比溯源）进入六级静态校验链。
- **对话式追改**：原输入 + 修改指令整体重生成替换，一期不做局部 patch；版本策略仅保留当前版。
- **PDF 导出**：后端 puppeteer-core 挂本机 Chrome/Edge（不下载 Chromium），reduced-motion 终态 + 自动滚动触发懒渲染图表后输出 A4；浏览器缺失时 503 并提示浏览器打印兜底。
- **报告类型体系**：预设类型（测试总结 / 快速简报 / 缺陷分析）+ 自由输入；时间维度类型（周报/版本报告）留待有纵向数据来源后再做。

## 后果

- 新增 `server/src/features/report/`（仓储双模、生成管线、校验链、PDF）与 `server/assets/`（lieflat 资产 + 图型片段库）。lieflat-charts 为 PolyForm Noncommercial 许可——本项目为本地内部工具属非商业用途，商业化前必须重新评估该资产。
- 前端 `/testreport` 重写为记录列表 + 类型化生成入口，`/testreport/reports/:id` 为报告视图（iframe 沙箱 + 追改 + 补数弹窗）。
- CONTEXT.md 退役「报告展示风格」「测试报告视图」「报告图表显示窗口」「报告图表排序规则」，新增「报告记录」「报告类型」「AI 报告」「缺数占位」「对话式追改」。
- 生成 prompt 契约包含 `@media print` 与占位卡补录桥接按钮（postMessage），前后端以消息类型 `nexus-report-supplement` 咬合。
- 二期候选：局部 patch 追改、数据面板直改、PNG/分享、自定义报告类型、时间维度报告类型。
