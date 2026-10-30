# 测试报告视觉重构 —— 版式与生成方式调研

> 配套设计稿：`docs/prototypes/report-redesign-summary.html`（浏览器打开即为高保真原型）。
> 素材：本仓库 `ai-test-tools-site/server/src/features/report/*`、`server/assets/lieflat-charts/*`、`server/assets/chart-fragments/*`；
> 业界：Allure Report 2/3 文档与 `allure-framework/allure2` 源码；图表规范：dataviz 方法论（含调色校验器）。

## 结论（TL;DR）

1. **报告效果差的根因不是配色或图型不好看，是"它不是一份报告"。** 当前产物是 `body > .grid2` 平铺 4–8 张图卡：没有报头、没有结论、没有正文叙事、没有明细表、没有元信息页脚。读者拿到手答不出"这轮测得怎么样、要不要发版"。
2. **层级坍塌。** 全篇字号 16.5 / 11.5 / 9.5px，没有任何大字号。`lieflat-charts` 的字号阶梯是为「缩略图墙」设计的，不是为「要被签字的交付物」设计的。
3. **测试报告缺语义状态色，是和"报告效果"预期最直接的冲突。** 现行色彩红线只允许 Mono 灰阶 + 单强调色，无法编码「通过 / 阻塞 / 失败」——报告最核心的判断"红没红"没有视觉通道。
4. **LLM 自由拼整份 HTML 是版式漂移的来源。** 骨架契约只约定四件套，网格排布、卡片顺序、章节分组每次由模型现想，同类报告两份排版不一致；校验链只查结构/色值/脚本/外链，不查排版。
5. **推荐：编辑排版的单栏文档流 + 语义状态色（只编码状态）+ 组装阶段收紧为"填槽"。** 前两项改观感，第三项把版式钉死。三者都在现有「选图 → 组装 → 校验 → 落库」管线内完成，前端列表/视图/追改/导出一律不动。

---

## 1. 现状诊断：差在哪（附代码证据）

### 1.1 版式 —— 是图画廊，不是文档

`prompts.ts` 的骨架契约里，`<body>` 直接就是卡片网格：

```html
<body>
<div class="grid2">
  <div class="card"> <h2/> <div class="sub"/> <svg/> <div class="src"/> </div>
  <!-- … -->
</div>
```

没有任何报头 / 结论 / 正文段 / 明细表 / 页脚的槽位。**结构上就不可能产出"报告"**——模型再努力也只能把图画整齐。

### 1.2 层级 —— 卡片不可见 + 字号全小

`mono-tokens.js` 的 `CARD_CSS`（第 158–172 行）：

```js
body{background:var(--bg);…;padding:40px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px;max-width:1400px}
.card{background:var(--bg);border-radius:24px;padding:28px 28px 20px}
h2{…font-size:16.5px…}
.sub{font-size:11.5px…}
.src{font-size:9.5px…}
```

三处硬伤：

| 问题 | 证据 | 后果 |
|---|---|---|
| 卡片与页面**同色且无边框** | `.card{background:var(--bg)}` + 注释「卡片无边框，靠留白分卡」 | 进 iframe 后整页糊成一片，看不出分区 |
| 字号阶梯**没有大字号** | 16.5 / 11.5 / 9.5px | 读起来是缩略图墙，不是文档 |
| 1400px **双列**塞 400×320 viewBox | `.grid2{1fr 1fr;gap:22px;max-width:1400px}` | SVG 被拉到 ~690px 宽，7px 的轴字被放大后糊成一团 |

### 1.3 色彩 —— 无语义状态色

`validate.ts` 的色值白名单只收 Mono 灰阶 + wire 预设，`prompts.ts:131` 明写「整份 HTML 只用一套色彩系统（Mono 灰阶；wire 时可加一个强调色 `#F5572F` 标唯一主角）」。

对一份测试报告，这意味着**通过/失败/阻塞无法用色区分**，严重度无编码，读者只能靠读文字判断好坏。这是「报告效果不符合预期」里最要命的一条。

### 1.4 生成 —— 版式漂移

`generate.ts` 的 `assembleHtml` 让模型直接输出整份 HTML。骨架契约只约束「每卡四件套」，**谁通栏、谁半宽、顺序、分组全由模型每次现想**。校验链 6 条规则（结构 / 色值 / 脚本语法 / 外链 / 占位 / 诚实）没有一条管排版。

同一类报告生成两次，版式会不一样；这正是「效果不稳定」的来源。

### 1.5 语言 —— 中文报告飘英文

`chart-fragments/*.js` 硬编码英文来源行与 tooltip（如 `F5.js` 的 `TICK ROWS · MONO-BASIC · RELEASE LOG`、`F11.js` 的 `$730k of the $1M quarter target`）。`mono-tokens.js:37` 的 `FONT.family='Inter'` 也没有 CJK 字体栈。中文报告里散着英文 kicker，观感散。

### 1.6 信息 —— 只有聚合图，没有明细

禅道 CSV 里的 BUG `ID / 标题 / 严重度 / 状态 / 负责人 / 创建时间` 全被压成一张聚合图。评审会上问"具体哪几个"，还得回禅道。报告没有回答它该回答的问题。

---

## 2. 业界调研：测试报告的内容解剖

以 Allure Report（事实上的业界基准）为样本。其**页面结构**（源码 `allure-generator/src/main/javascript/features/`）：

| 区块 | 内容 |
|---|---|
| **Summary widget**（首页焦点） | 报告名 + 日期 + 起止时间(耗时) + 执行次数 + 用例总数 + 状态占比图 + 状态明细表 |
| Overview 其余 widget | Status / Severity / Duration / Categories trend / Duration trend / History trend / Retry trend / Executors / Environment |
| 侧栏页面 | Overview · Categories · Suites · Graphs · Timeline · Behaviors · Packages · Environment |
| 明细 | test-result（步骤 / 断言 diff / 附件 / 重试） |

值得直接搬走的三条：

1. **Summary 的信息配比是对的**：身份（项目/版本）→ 时间（起止/耗时）→ 规模（用例数）→ 结果（状态占比）。这正是「一页纸说清一轮测试」该有的顺序，我们的报头 + 指标带照此对齐。
2. **一套状态色贯穿全站**（绿通过 / 红失败 / 琥珀断裂 / 灰跳过），在饼图、条形、徽章、树节点上语义一致。我们缺的就是这套。
3. **多视角入口**：Allure 3 的图表按「当前状态 / 趋势 / 项目健康 / 性能」四类洞察组织，并给 QA Lead / 自动化 / 手工 / 干系人各一条阅读路径（`/docs/v3/read-charts/`）。我们的四类报告类型（summary/brief/defect/free）天然就是阅读路径，应在骨架里显式分节。

**但 Allure 不能照抄形态。** 它是「一轮执行的多页交互仪表盘」，我们交付的是「单文件 HTML / PDF 的文档」。前者靠侧栏切页，后者靠竖向叙事。内容解剖可以搬，版式形态要换。

### 2.1 可读性规则（`/docs/v2/readability/`、`/docs/v2/navigation/`）

- 标题必须是**人类可读**的（不是函数名/图型名）——我们的「结论式标题」契约已对齐，应保留。
- 描述用 Markdown，**禁止 HTML 标签**（会破坏版式，且是 XSS 面）。
- 每条结果带 **severity**（trivial / minor / normal / critical / blocker）、**owner**（对该条稳定性负责的人）、**link**（issue / TMS）、**tag**。
- 大项目用**并行的多棵树**组织（Suites 按代码、Behaviors 按功能、Packages 按包）——不同角色读不同树。

对我们的直接启示：**明细表必须有 ID / 标题 / 严重度 / 状态 / 模块 / 负责人 / 日期七列**，且严重度要成为有序量表。

---

## 3. 生成方式调研：三种路线

| | A · 只换皮 | **B · 确定性骨架 + LLM 填槽（推荐）** | C · 前端 React 渲染 |
|---|---|---|---|
| 做法 | 只改 `mono-tokens` / `CARD_CSS` / 片段，骨架仍由模型现拼 | 服务端写死版式模板，模型只产出**槽位 JSON**（标题 / 结论句 / 每图数据 / 表格行 / 脚注），服务端拼装 | 报告不走 `srcDoc`，由 React 组件渲染 |
| 版式稳定性 | ✗ 每次仍会漂 | ✓ 100% 钉死 | ✓ 100% 钉死 |
| 封面/结论/明细/页脚 | ✗ 结构上加不进去 | ✓ 模板槽位 | ✓ 组件 |
| 单文件 HTML 可下载/离线/PDF | ✓ | ✓ | ✗ **破坏交付物契约** |
| 改动面 | 最小 | `prompts.ts` / `generate.ts` / 新增 `template.ts` | `ReportViewPage` + 前端渲染层 |
| 与「架构不变」 | 完全兼容 | **管线四阶段不变**，仅组装阶段产物契约收紧 | **不兼容**（视图层形态变了） |

**推荐 B。** 核心理由：LLM 擅长「写什么」（结论句、数据映射、选图），不擅长「长什么样」（网格排布、字号层级）。把排版权从模型手里收回服务端，观感与稳定性同时解决，而管线的「选图 → 组装 → 校验 → 落库」四阶段、单文件 HTML 交付物、追改装箱、SSE 进度全部不动。

若想零契约变更，退到 A 也能明显改观感（见 §6 的 A/B 分层清单）。

---

## 4. 新版式方案

设计稿：`docs/prototypes/report-redesign-summary.html`（建议以 ≥1280px 视口打开）。

**立场：报告是文档，不是卡片墙。**

### 4.1 五段式骨架（竖向单栏叙事流）

```
①  报头 Masthead
    眉题(等宽大写) / 结论式大标题 / 一句话 verdict + 状态戳 / 元信息 8 格
    ── 项目、构建、测试窗口、数据源、范围、执行、负责人、生成时间
②  结论与建议  §00
    3–5 条要点，每条「状态色点 + 一句话 + 关键 ID」
③  本轮指标  §01
    1 个 hero 数字（通过率）+ meter（含发版线刻度）+ 3 个 stat tile（各带 delta + sparkline）
④  分章叙事  §02…
    每章 = 章节名(衬线，挂左栏) + 导语段 + 图（可破格通栏）+ 图注 + 数据表孪生
⑤  明细与附录
    缺陷明细表（7 列）· 缺数占位卡 · 口径与免责 · 页脚 colophon
```

### 4.2 编辑栅格（不是等分卡片墙）

- 纸张 1080px；**左栏 184px 挂章节号与章节名**，正文栏 852px，栏距 44px。
- 图与明细表**破格通栏到 1080px**，制造节奏变化与留白对比。
- 分隔靠**发丝线**（1px），不用卡片阴影 —— 报告是"纸"，不是浮起的卡。

### 4.3 排版（中文优先）

| 角色 | 字体 | 规格 |
|---|---|---|
| 大标题 | CJK 黑体粗 | 30–46px / 700 / 字距 -.025em / 行高 1.22 |
| 章节名、图标题 | **衬线**（Newsreader + 宋体栈） | 25px / 21px / 600 |
| 正文 | CJK 黑体系统栈 | 15px / 行高 1.75 |
| 眉题、数据、轴、表 | **等宽**（IBM Plex Mono） | 9.5–12.5px / 字距 .12em |

要点：
- **中文正文不用 webfont**（中文字库太重，与单文件交付物冲突）；性格由「衬线章节名 + 等宽数据」两处承担。
- 数字：**轴与表格用 `tabular-nums`**（纵向对齐），**hero 与 stat tile 用比例数字**（大字号下 `121` 才不会松）。
- 层级靠**尺度对比**（46px ↔ 9.5px）而非加粗堆叠。

### 4.4 色彩：语义色只编码「状态」

```
基底（继承 lieflat Mono，「明度即数据」）
  paper #F0EFEB · ink #1C1C1A · muted #8F8E88 · faint #C6C5BF · grid #DEDDD6
  灰阶明度阶梯 L0–L4 = sequential ramp（承载一切「量」与「序」）

语义状态色（reserved —— 只表达状态，永不用作「第 N 个系列」或量的深浅）
  good  #0B7A0B  通过 · 已修复
  warn  #C98500  阻塞 · 处理中
  crit  #C0392B  失败 · 激活
  灰    #8F8E88  跳过 · 已关闭（缺席/归档，不是色相）
```

**分工铁律**：一切「量」（计数、密度）与「序」（严重度致命→提示）走灰阶明度；语义色只在「状态」编码上出现。因此严重度用明度（致命最黑 → 提示最浅），状态用色相。这让色彩预算极克制，整份报告近乎单色，只在关键处给三个语义重音。

---

## 5. 图表规格与调色校验

五张图的形式选择按「数据的职责」定，不是按好看定（dataviz 方法论）。

| # | 数据职责 | 形式 | 色彩职责 | 关键规格 |
|---|---|---|---|---|
| 1 | 通过率（单一比率对目标） | **hero 数字 + meter** | meter：fill=good，track=同色相浅步 | 全篇唯一 hero；虚线刻度标发版线（虚线只留给阈值） |
| 2 | 用例状态构成（part-to-whole） | **单条水平堆叠条** | 状态色 | 段序 **通过\|阻塞\|失败\|跳过**；段间 2px 表面间隙、不描边；基线端方角、数据端 4px 圆角；段内标签只在放得下时给 |
| 3 | 缺陷严重度×状态（grid of counts） | **热力矩阵** | **灰阶明度** | 越黑=越多；附明度标尺；唯一红圈 emphasis 标出「发版前必须清零」那格 |
| 4 | 模块缺陷分布（名义类目排名） | **emphasis 横条** | 1 色 + 灰 | **禁止「越大越深」的值色阶**（那是双重编码）；只高亮风险焦点，其余去强调灰；条端标值，极值加重 |
| 5 | 每日新增/关闭（变化趋势） | **emphasis 折线** | 1 色 + 灰 | **绝不双轴**（两系列同单位共用一轴）；2px 线；端点 ≥8px + 2px 表面环；只标峰值与两端 |

通用规格：条厚 ≤24px、网格发丝实线（虚线只给阈值）、≥2 系列必出图例且状态色必配 **icon + label + 数值**（不靠颜色单独承载语义）、每图配**数据表孪生**（任何色编码都有等价通路）、hover 只作增强不作读数唯一通路。

### 5.1 调色校验记录（校验器实测，非眼估）

对纸面 `#F0EFEB`，最终色序 `#0B7A0B → #C98500 → #C0392B → #8F8E88`：

```
[PASS] Lightness band      全部 4 个在 L 0.43–0.77
[PASS] CVD separation      worst adjacent ΔE 9.7 (protan)   ≥8 达标
[PASS] Normal-vision floor worst adjacent ΔE 17.5 (normal)  ≥15 达标
[WARN] Contrast vs surface #C98500 = 2.67、#8F8E88 = 2.86   低于 3:1
[FAIL] Chroma floor        #8F8E88 无色相
```

三条必须记录的取舍：

1. **红绿不能相邻。** 现行 wire 的 `#F5572F` 与通行的「绿通过/红失败」若按 `绿|红|…` 排，CVD ΔE 只有 **4.1**（红绿色盲直接糊成一片）。改为 `绿|琥珀|红|灰` 后升到 **9.7**。这是段序的设计约束，不是审美偏好。
2. **琥珀与灰低于 3:1 → 走 relief 规则**：配可见直标 + 数据表孪生（设计稿已含）。该 WARN 不可无视。
3. **`#8F8E88` 无色相导致的 Chroma FAIL 是预期的**：跳过/已关闭是「缺席/归档」，是中性底而非身份色相，本就不该过色相地板。参与身份编码的三个状态色全部 PASS。

原始琥珀 `#fab219` 在这张纸面上只有 **1.59:1**，且 L=0.811 越出色度带，PDF 打印几乎看不见 —— 故重新步进到 `#C98500`（2.67:1）。

---

## 6. 落地改动清单（架构不变）

**保持不动**：两阶段管线（选图 → 组装 → 校验 → 落库）、四类报告类型与图型白名单、单文件 HTML 交付物、SSE 进度事件、记录列表↔报告视图两层、对话式追改装箱、缺数占位 + postMessage 补录、PDF 无头导出。

### A 层 · 只换皮（零契约变更，先做）

| 改动 | 文件 |
|---|---|
| 新色彩 token：加语义状态色 + 保留 Mono 基底 | `server/assets/lieflat-charts/mono-tokens.js` |
| `CARD_CSS` 重写：卡片可辨识、字号阶梯拉大、CJK 字体栈、单栏文档流 | 同上 |
| 图型片段去英文：`.src` / tooltip 中文化、数值改真实数据形状 | `server/assets/chart-fragments/*.js`（16 个） |
| 色值白名单并入语义状态色 | `server/src/features/report/validate.ts:21` |
| 骨架契约改为五段式 + 打印分页规则 | `server/src/features/report/prompts.ts:87` |

### B 层 · 组装阶段收紧为「填槽」（推荐一并做，是版式稳定的关键）

| 改动 | 文件 |
|---|---|
| 新增确定性模板拼装器（五段式骨架 + 槽位替换） | 新增 `server/src/features/report/template.ts` |
| 选图阶段扩展产出「槽位 JSON」（结论句 / 要点 / 图数据 / 表行 / 脚注） | `prompts.ts` + `generate.ts:54` 的 `validateSelection` |
| `assembleHtml` 由「让模型写 HTML」改为「服务端拼装」 | `generate.ts:127` |
| 校验链从 HTML 启发式改为槽位 schema 校验（保留脚本/外链/诚实三条） | `validate.ts` |

**判断点**：B 层会改动组装阶段的模型输出契约。若你认为这已越出「架构不变」的边界，只做 A 层也能拿到约七成的观感改善（版式漂移会仍在）。

---

## 7. 对后续票的输入

- **「报告版式模板」**：按 §4.1 五段式落 `template.ts`；打印契约需 `@page A4` + `break-inside: avoid` + `print-color-adjust: exact`。
- **「图型片段重绘」**：16 个片段按 §5 规格重做，优先级 F11（通过率→meter）、F4/L14（状态构成→堆叠条）、L4（矩阵→灰阶热力 + 红圈 emphasis）、F5（模块分布→emphasis 横条）、F2（趋势→emphasis 折线）。
- **「明细表」**：新增缺陷明细槽位，七列（ID / 标题 / 严重度 / 状态 / 模块 / 负责人 / 创建）。严重度为有序量表 → 灰阶明度；状态 → 语义色 + icon + label。
- **「PDF 导出」**：渲染时注入 `prefers-reduced-motion: reduce` 强制终态；分页依赖骨架的 `break-inside` 规则。
- **二期评估**：多轮对比图（当前为缺数占位）；暗色报告（PDF 场景建议不做，浅色是文档正统）。

---

## 8. A 层实施记录（2026-09-22）

A 层五项已落地，全量测试 66 文件 / 545 用例通过，`tsc --noEmit` 干净。样张见
`docs/prototypes/report-a-layer-sample.html`（由 `node .scratch/build-report-sample.mjs` 从真实资源拼出，可重新生成）。

**与 §6 计划的两处出入**：

1. **色值校验从「枚举白名单」改成「灰阶放行 + 三个语义状态色」。** 原因见下面 bug ③：片段硬编码了 `#CFCEC7` / `#A8A7A0` / `#D8D6CE` / `#C0BFB8` / `#CDCCC5` / `#E3E2DB` 等灰阶微色阶，新旧白名单都没收，枚举过一遍必漏。现改为 HSV 饱和度 ≤ 0.13 视为中性灰阶放行，彩色只认 `STATUS` 三色——这才是设计本身的铁律，且不随片段漂移。实测 17 个资源文件 25 个色值全部通过。
2. **图卡 SVG 加了 `max-width:560px`。** 片段是 400×320 viewBox、内含 5.5–11px 字号；通栏卡若吃满 1080px 会把缩放推到 2.7x，7px 说明放大成 18.9px。上限后缩放稳定在 1.3–1.4x，最小字号渲染后 9–10px。**结论：A 层不适合做全出血大图**，那要等 §7 的「图型片段重绘」按 1080 viewBox 重做。

**顺带修掉的三个既有 bug**（都在「报告根本画不出图」这一档）：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| ① | 图型片段全部 `ReferenceError` | gallery 里 `INK`/`el`/`obsReveal` 是局部 `const`，而管线内联的是挂 `window.MONO` 的 IIFE，裸标识符不会自动成为全局变量；骨架也没让模型解构 | 骨架的第二个 `<script>` 增加 `const {INK,…,D2R,…} = MONO` 解构行 |
| ② | F4 标签定位错 | 片段用了 `D2R`，`mono-tokens` 根本没把它导出 | `MONO` 增加 `D2R` |
| ③ | 整份报告的 `<script>` 被腰斩，注释里的 `<svg id="xx">` 反被当成标签 | `mono-tokens.js` 头注释写着 `<script src="mono-tokens.js"></script>`；HTML 解析器不认 JS 注释，遇到 `</script` 就提前截断 | 注释改写为不含脚本闭合序列，并就地写明约束 |

三条里 ①③ 是**既有**问题（与本次改动无关），`validate.ts` 的 `new Function` 语法检查本可检出 ③（截断处块注释未闭合必然抛语法错），但此前从未被真实报告触发过。

---

## 9. 图型片段重绘记录（2026-09-22）

**16 个白名单图型已全部重绘为 1080 宽全出血图。** 全量 558 测试通过，`tsc --noEmit` 干净，真实 `validateReportHtml` 对样张全规则通过，浏览器端 16/16 渲染成功（14 张 SVG 全部 1.00x 缩放、最小字号 10–12px；2 张 ECharts 落在 1080×520），零控制台报错。

### 9.1 §5 点名的五组（有明确形式规格）

| code | 新形态 | 对应 §5 | 关键规格 |
|---|---|---|---|
| **F11** Meter Rails 进度轨 | 1–6 条 meter 并排 | #1 通过率 | fill=状态色、track=同色相浅步、虚线阈值刻度 |
| **F4** Stacked Share 状态构成条 | 单条水平堆叠条 | #2 状态构成 | 段序 `STATUS.order`（绿红不相邻）、段间 2px 表面间隙不描边、基线端方角/数据端 4px 圆角、段内直标放不下就交给图例 |
| **L14** Hundred Field 百格场 | 单位分解点阵（25 列自适应行数） | #2 状态构成（可数读数） | 1 格 = 1 单位、格间 2px 间隙、末行淡格表示非整行余量 |
| **F5** Emphasis Bars 焦点横条 | emphasis 横条 | #4 模块分布 | 一支高亮风险焦点 + 去强调灰，**无值色阶**；条端标值 |
| **L4** Ink Matrix 明度矩阵 | 热力矩阵 | #3 严重度×状态 | 量走灰阶明度（不上彩虹）、明度标尺、唯一红圈 emphasis |
| **F2** Emphasis Lines 焦点折线 | emphasis 折线 | #5 趋势 | **绝不双轴**（同单位共用一轴）、2px 线、端点 r=4 + 2px 表面环、只标峰值与两端 |

### 9.2 其余 10 个（保形态，只套 §5 的标记/色彩/标注规格）

| code | 形式 | 色彩职责 |
|---|---|---|
| **F1** Columns 竖柱 | 少类目比较柱状 | 单系列同一墨色（名义类目，**无值色阶**） |
| **F6** Paired Columns 并柱 | 分组对比 | emphasis 1 色 + 灰（本轮墨 / 上轮灰） |
| **F7** Stacked Columns 堆叠柱 | 堆叠构成 | 段为状态 → `STATUS.order`；段为量/序 → 灰阶明度 |
| **F9** Waterfall 瀑布 | 增减分解浮动柱 | 加项墨 / 减项灰，靠符号与图例区分 |
| **F10** Dot Heat 点阵热力 | 网格里的量 | 点面积 = 量（sqrt 换算），明度 = 密度 |
| **L3** Barcode Lollipop 条码棒棒糖 | 90 天日序列 | 墨色单系列 + 周末空心（次要编码不靠颜色） |
| **L5** Radial Convergence 辐射汇聚 | 多对一归属（不丢明细） | 发丝灰阶 + 中心点面积 = 归属条数 |
| **L12** Type Colonnade 名录柱廊 | 归属 + 逐条名单 | 同上 |
| **G7** Tree LR 左右树 | 层级结构（ECharts） | 分支走 `L` 明度阶梯 |
| **G15** Jitter Strip 抖动条带 | 分组分布几百点（ECharts） | 点明度 = 分组序 |

**四条判断**：

1. **F4 与 L14 不做同一种形态。** 两者都答「状态构成」，若都改成堆叠条就是两张一样的图。改为互补：F4 读**占比**（堆叠条），L14 读**可数**（点阵，1 格 = 1 条）。这也保住了 L14「1 点 = 1 单位」的原契约。
2. **§5 的「只标极值」是笔误，已改为「条端标值」。** 标记规范对条形的规定是「Bars → value at the tip」；6 行的排名条逐条标值不是「逐点铺数」，反而是读数正解。
3. **「档柱」纹理（rung/tick）全部换成实心标记。** 原纹理是单位分解（1 档 = 1 个诚实单位），但计数上百时档距压到 2px 以下就读不出来了。可数这件事改由 L14 百格场专职承担——它在任何规模下都数得清。于是条柱回归条柱，F4/F5/F1/F6/F7/F9 视觉成族。
4. **`.grid2 > .card` 半宽路径保留但不再被契约使用**（旧报告渲染还需要它的 CSS）；16 种图型现统一走 `<figure class="fig">` 通栏。

**统一落的标记规格**：条厚 ≤24px、数据端 4px 圆角 / 基线端方角（`barH` / `barV` 两个原语进 `MONO`）、段与段 2px 表面间隙不描边、端点 ≥8px + 2px 表面环、网格发丝实线（虚线只留给阈值与级间接力）、≥2 系列必出图例且状态色必配 icon + label、**文字一律穿墨色 token 绝不穿数据色**、面积编码用 sqrt 换算半径、每图强制配数据表孪生。


---

## 10. B 层实施记录（2026-09-22）

**组装阶段已从「模型写整份 HTML」收紧为「模型出槽位 JSON + 服务端模板拼装」。** 全量 559 测试通过，`tsc --noEmit` 零报错，真实 `validateReportHtml` 对样张全规则通过，浏览器端 16/16 图型渲染成功。

### 10.1 契约变化

| | A 层 | B 层 |
|---|---|---|
| 模型输出 | 整份 HTML | **槽位 JSON**（`ReportDraft`） |
| 组装阶段 LLM 调用 | 1 次 | **0 次** |
| 版式来源 | 模型每次现排 | **`renderReportHtml` 恒定产出** |
| 修复重试 | 选图 1 次 + 组装 1 次 | 收敛到出稿阶段 1 次 |
| 图内数据 | 模型改片段里的 demo 数组 | **`__DATA__` 槽位注入** |

`ReportDraft` 覆盖五段式全部槽位：`kicker` / `title` / `verdict` / `meta` / `findings` / `kpi` / `charts`（平铺图序）+ `sections[].figureIndexes`（分章排布）/ `detail` / `appendix` / `colophon`，外加 `PLACEHOLDER` 缺数条目。文本槽位一律经 `esc()` 转义——**模型输出是不可信输入，不转义就是给下载的单文件 HTML 开 XSS 面**（iframe 有 sandbox，下载件没有）。

16 个片段统一了 `__DATA__` 数据槽位；**颜色一律由 `STATUS` / `L` 从语义键取，不进数据**（数据里写 `good|warn|crit|mute`，不写颜色字面量）。数据形状逐图型写在 prompt 的 `DATA_SHAPES` 表里。

### 10.2 新增校验规则 7：脚本可执行性

`checkScripts` 原先只做 `new Function` **解析**，不执行。实测连踩四个运行时 bug 全部漏网：

| # | 报错 | 根因 |
|---|---|---|
| ① | `{...}.map is not a function` | `DATA_SHAPES` 写 `{rows:[…]}`，片段却按数组 `.map` |
| ② | `Cannot access 'FILL' before initialization` | 数据派生用到 `FILL`，而 `FILL` 声明在后（TDZ） |
| ③ | `D is not defined` | L14 数据改名为 `SEG`，用法没跟着改 |
| ④ | `val is not defined` | L3 删掉了 demo 公式，调用点还在 |

补的 `checkScriptExecution` 用最小 DOM 桩把脚本**真跑一遍**（`IntersectionObserver` 桩立即判定可见以触发绘图回调），画不出来就算不过。有个细节值得记：`echarts` 必须注入到 **mono-tokens 那一层**作用域——`eReveal` 是那里的闭包，自由变量按它自己的作用域链解析，注入到调用方看不见。





- Allure Report 文档 — Features / Readability / Navigation / Read charts：<https://allurereport.org/docs/v2/readability/> · <https://allurereport.org/docs/v2/navigation/> · <https://allurereport.org/docs/v3/read-charts/>
- Allure Report 源码（overview widgets / widget 样式）：<https://github.com/allure-framework/allure2>
- 本仓库前序调研：[`2026-08-13-lieflat-charts-prompt-contract.md`](2026-08-13-lieflat-charts-prompt-contract.md)（图型白名单与两阶段 prompt 契约，本次沿用其管线结论，仅改视觉层与组装契约）
- 图表形式 / 标记规格 / 反模式 / 调色方法：dataviz 方法论（`choosing-a-form` · `marks-and-anatomy` · `anti-patterns` · `color-formula`，含 `validate_palette.js`）
