# lieflat-charts 图型子集与 prompt 契约研究

> Wayfinder 票「lieflat-charts 图型子集与 prompt 契约研究」的研究产出。
> 素材：`larashero3-dotcom/lieflat-charts`（SKILL.md / catalog.md / mono-tokens.js / templates/*）。

## 结论（TL;DR）

1. **图型白名单**：一期三类报告共圈定 17 种图型（Lupi 7 + Basics 8 + Glance 2），按 skill 选型顺序 Lupi → Basics → Glance，Glance 两种均写明降级理由。
2. **prompt 契约 = 两阶段生成**：先"选图阶段"产出选型与数据映射 JSON，再"组装阶段"由后端把**选中图型的真实渲染代码段**从 gallery 抽出注入 prompt，模型只负责组织整页 HTML。不允许模型凭记忆复刻模板。
3. **mono-tokens.js 全文内联**（177 行 / 约 6KB），彩色预设一期只用 Mono + wire（灰阶 + 单强调色，契合"需要一个视线落点"的报告场景）。
4. **页面骨架契约**采用 skill 第九节单文件骨架 + 三个本项目附加条款（`@media print`、缺数占位卡、无外链依赖白名单）。
5. **校验链**：静态启发式（结构四件套、单一色彩系统、脚本语法、外链白名单、占位标记完整）→ 失败自动修复重试一次 → 仍失败降级为错误卡片（对齐 board-ai 既有模式）。

## 1. 三类报告的数据形状与图型白名单

### 1.1 测试总结报告（禅道用例 CSV + BUG CSV）

| 可画的数据形状 | 选定图型 | 备注 |
|---|---|---|
| 用例执行通过率（单值进度 0–100%） | F11 Tick Gauge | 汇报开场首选 |
| 通过/失败/阻塞构成（100% 构成 ≤6 段） | F4 Tick Donut ⇄ L14 Hundred Field | 二选一，看条目密度 |
| 用例按功能模块分布（少类目排名 ≤8） | F5 Tick Rows | 中文长类目友好（L2 类目名竖排已排除） |
| 用例优先级构成（堆叠构成 ≤4 类 × ≤3 段） | F7 Stacked Rungs | |
| 缺陷按模块归属（多对一，不丢明细） | L5 Radial Convergence | 报告门面图 |
| 缺陷严重度构成 | L14 Hundred Field | 单位分解：1 点 = 1 个 BUG |
| 用例/缺陷随日期趋势 | F2 Hairline Line | **仅当 CSV 含日期列**；否则进缺数占位 |

### 1.2 快速简报（定性文本，无指标）

| 可画的数据形状 | 选定图型 | 备注 |
|---|---|---|
| 测试重点条目层级（主题 → 条目） | G7 Tree LR | 见下方降级理由 |
| 条目按维度归类计数（功能/异常/权限/数据…） | F5 Tick Rows | AI 归类、条目数真实 |
| 风险/待澄清清单（多对一归属 + 逐条名单） | L12 Type Colonnade | 治理/审计报告语义 |
| 通过率、缺陷分布、趋势 | 缺数占位卡 | 补数据后经追改通路整体重生成 |

### 1.3 缺陷分析报告（仅 BUG CSV）

| 可画的数据形状 | 选定图型 | 备注 |
|---|---|---|
| 严重度 × 状态矩阵（分类 × 分类 + 量） | L4 Arc Matrix | ≤100 格轻量矩阵 |
| 缺陷按模块归属 | L5 Radial Convergence ⇄ L12 Type Colonnade | 与总结报告全局去重 |
| 严重度构成 | F4 Tick Donut | |
| 创建日期日序列 | F2 Hairline Line ⇄ L3 Barcode Lollipop | 90 天级上 L3 |
| 解决时长分布（逐条记录几百点） | G15 Jitter Strip | 见下方降级理由 |

### Glance 降级理由（skill 硬规则要求写明）

- **G7 Tree LR**：测试重点层级是"从属关系不比较份额"，Basics/Lupi 无层级结构图（F13 Treemap 要求权重语义，层级条目无诚实权重），故降级 Glance。
- **G15 Jitter Strip**：逐条解决时长是几百点分组分布，Lupi/Basics 候选（F8 ≤20 点散点）容量不足，故降级 Glance。

### 明确排除

- 动画/实时类（G9/G12/G16/G17/G18）：报告是静态阅读场景，违背"场合"契约。
- 交互大图 B1–B3：一期报告无网络/路径数据。
- 暗卡图（L2/G2/G6/G11 等）：报告场景无需暗底门面；每屏 ≤1 暗卡规则在一期直接收紧为 0。

## 2. prompt 契约：两阶段生成

skill 的模板正本是 gallery 里的真实代码（每图渲染段 40–80 行手写 SVG/ECharts 配置）。让模型背 46 个模板必然走样；全量注入则 prompt 爆炸（lupi-gallery 单文件数千行）。解法：

**阶段一 · 选图（轻量调用）**
输入：用户素材 + 报告类型 + 白名单图型的紧凑描述（每图 2–3 行：编号、卡内标题、数据契约、几何约束——直接从 catalog.md 蒸馏，白名单 17 图约 60 行）。
输出（严格 JSON）：整页叙事结构 = 图型编号数组 + 每图的数据映射（哪个字段进哪个通道）+ 结论式标题 + 副标题图例说明。

**阶段二 · 组装（重量调用）**
后端按阶段一的选型，从本地 gallery 文件**抽出对应卡片的渲染代码段**（`// ════ 图型名 ════` 注释块），连同 mono-tokens 全文、页面骨架、数据映射一起注入 prompt。模型的任务收敛为：替换数据、写标题旁注、组织整页——模板的几何、编码、动效由注入的真实代码保证。

工程推论：后端需要一个"图型片段库"构建步骤，把 17 个白名单图型的渲染段从 gallery 抽成独立片段文件（`server/assets/chart-fragments/`），并随注入附上该图的演示数据数组作为格式参照。

## 3. Token 与色彩

- **mono-tokens.js 全文内联**进系统侧 prompt（177 行 ≈ 6KB），它同时携带 CARD_CSS 与 obsReveal 机制，是风格唯一正本。
- 一期色彩系统锁定 **Mono**（保底）与 **wire**（灰阶 + 单强调色标主角，契合报告"视线落点"场景），由后端按报告类型指定，不让模型自由选色。porcelain/palm/custom 二期评估。
- 字体：Inter 走 Google Fonts 外链（skill 原生做法）；离线场景降级系统字体栈写进骨架契约。

## 4. 页面骨架契约（skill 第九节 + 本项目附加条款）

基础骨架照抄 skill 第九节（单文件、卡片四件套、顶部数据数组、obsReveal）。附加：

1. **`@media print` 块必须内联**：`print-color-adjust: exact`、动画强制终态、`.card` 避免跨页断裂（`break-inside: avoid`）、A4 适配——后端无头 PDF 导出依赖此契约。
2. **缺数占位卡**：`<div class="card card-placeholder" data-missing="pass-rate|trend|...">`，含缺数说明与所需数据清单；占位卡不得含任何编造图形。该标记同时供诚实校验与追改装箱识别。
3. **外链白名单**：仅允许 echarts@6 CDN（G7/G15 需要）与 Google Fonts；其余外链一律拒绝。Lupi/Basics 手写 SVG 图零依赖可离线。

## 5. 校验链（生成后）

按序执行，失败进修复重试一次，再失败降级错误卡片：

1. 结构：每个 `.card` 具备标题/副标题/图容器/来源行四件套；标题非图型名。
2. 色彩：全文扫描色值，仅允许 Mono ladder 或 wire 预设色值集合。
3. 脚本：抽出 `<script>` 过 `node --check`。
4. 外链：`src`/`href` 全部命中白名单。
5. 诚实：定性输入时 HTML 不得出现未在输入中给出的百分比/计数（启发式：数字必须能溯源到输入文本或条目计数）；`data-missing` 占位卡的图容器必须为空。
6. 数据：`const DATA` 数组存在且与阶段一的数据映射一致（抽查键名）。

## 6. 对后续票的输入

- 「AI 报告生成管线」：按两阶段实现；片段库构建脚本归入该票。
- 「存储 schema」：报告记录需存 `chartKinds`（阶段一选型 JSON）与 `sourceDigest`，追改时复用。
- 「PDF 导出」：依赖骨架契约第 1 条；puppeteer 渲染时注入 `prefers-reduced-motion: reduce` 强制终态。
- 「缺数占位交互原型」：占位卡视觉以骨架契约第 2 条为起点做高保真。
