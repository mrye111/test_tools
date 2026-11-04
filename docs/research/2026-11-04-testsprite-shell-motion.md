# TestSprite 应用壳层、导航、面包屑、响应式与动效

> **来源票**: [#36](https://github.com/mrye111/test_tools/issues/36) · 父图: [#32](https://github.com/mrye111/test_tools/issues/32)
>
> **取证日期**: 2026-11-04 · **取证方式**: ego-browser TaskSpace 1, Page p2, 只读
>
> **参考入口**: `https://www.testsprite.com/dashboard-v3/o/{orgId}/projects/{projId}/test-cases`

---

## 1. 整体布局结构

### 1.1 三栏壳层（桌面端）

TestSprite 应用壳层由三个水平排列的固定栏 + 一个主内容区组成：

```
┌──────────┬────────────────┬──────────────────────────────┬──────────────┐
│ Global   │ Project        │ Main Content                 │ Chat Panel   │
│ Rail     │ Sidebar        │                              │ (overlay)    │
│ 48px     │ 230px          │ flex-1 (min-width: 320px)    │ ~48% width   │
│ (icons   │ (icon + text   │                              │ (slide from  │
│  only)   │  labels)       │                              │  right)      │
└──────────┴────────────────┴──────────────────────────────┴──────────────┘
```

**实测尺寸** (viewport: 1695 x 896):

| 区域 | 宽度 | left | CSS transition |
|------|------|------|----------------|
| Global Rail | 48px | 0 | `width 0.26s cubic-bezier(0.32, 0.72, 0, 1)` |
| Project Sidebar | 230px | 48.67px | 同上 (共用 `transition-[width] duration-[260ms]`) |
| Main Content | flex-1 | 279.33px | 无 (flex 自适应) |
| Chat Panel | ~1215px (桌面端展开时) | 右侧 overlay | `translate 0.26s cubic-bezier(0.32, 0.72, 0, 1)` |

**CSS 类名证据**:

- 最外层容器: `flex h-full flex-col overflow-hidden bg-[var(--color-bg-deep)]`
- 水平行: `flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden`
- 侧栏容器: `relative shrink-0 border-[var(--color-border-default)] h-full transition-[width] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]`
- 主内容: `flex flex-1 flex-col relative h-full min-w-[320px] overflow-hidden`
- Chat 面板: `absolute inset-y-0 right-0 z-10 flex flex-col bg-[var(--color-bg-default)] border-l border-[var(--color-border-default)] pointer-events-auto transition-[translate] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] translate-x-full` (收起时)

---

## 2. Global Rail（全局图标栏）

### 2.1 结构

48px 宽的固定栏，从上到下分为四个区域：

```
┌─────────────┐
│ [MW Avatar] │  ← Workspace switcher (click opens dropdown)
│ [Expand]    │  ← "Expand sidebar" / "Collapse sidebar" toggle
├─────────────┤
│ Get Started │  ← with progress ring "1 of 4 done"
│ Overview    │
│ Chats [New] │  ← badge "New"
│ All Projects│
├─────────────┤
│ Automation  │  ← group label (expanded mode only)
│ Test Lists  │
│ Test Sched. │
├─────────────┤
│ Workspace   │  ← group label
│ General     │
│ Members     │
│ Billing  >  │  ← collapsible: Plan, Usage
│ Connections>│  ← collapsible: Integrations, API Keys
├─────────────┤
│ Starter     │  ← plan info + credit bar (expanded mode)
│ 519.5 Creds │
│ Document. > │  ← external link icon
├─────────────┤
│ [User Avatar]│ ← user profile (bottom pinned)
│ 叶旺林       │
└─────────────┘
```

### 2.2 折叠/展开行为

**观测到的两种状态**:

| 状态 | 宽度 | 触发方式 | 过渡动画 |
|------|------|---------|---------|
| 折叠 (icon-only) | 48px | 点击 "Collapse sidebar" 按钮 | `width 0.26s cubic-bezier(0.32, 0.72, 0, 1)` |
| 展开 (icon + text) | ~230px | 点击 "Expand sidebar" 按钮 | 同上 |

**折叠状态下**:
- 所有图标居中, 32x32px 尺寸
- 文本标签隐藏
- 分组标签隐藏
- Plan/credit 信息隐藏
- Workspace avatar 只显示 "MW" 缩写 (32px)

**展开状态下**:
- 图标 + 文本水平排列
- 分组标签可见 ("Automation", "Workspace Settings")
- Plan 信息 (Starter + 519.5 Credits Remaining + progress bar) 可见
- 用户头像 + 名称 + 邮箱可见
- 折叠/展开按钮 aria-label 切换: "Expand sidebar" <-> "Collapse sidebar"

### 2.3 Rail 项目明细 (折叠态 aria-labels)

| 项目 | 类型 | aria-label / href |
|------|------|-------------------|
| MW Avatar | button | (workspace switcher dropdown) |
| Expand/Collapse | button | "Expand sidebar" / "Collapse sidebar" |
| Get Started | anchor | `.../get-started` (带 progress ring) |
| Overview | anchor | `.../o/{orgId}` |
| Chats | button | 打开 chat panel (非导航) |
| All Projects | anchor | `.../projects` |
| Test Lists | anchor | `.../testlist` |
| Test Schedules | anchor | `.../monitoring` |
| General | anchor | `.../settings/workspace` |
| Members | anchor | `.../settings/team` |
| Billing | button (accordion) | 展开显示 Plan, Usage |
| Connections | button (accordion) | 展开显示 Integrations, API Keys |
| Documentation | anchor | 外部链接 `docs.testsprite.com` |
| User Avatar | button | 用户 profile (bottom) |

### 2.4 Workspace Switcher 下拉菜单

点击 MW Avatar 后出现的 dropdown menu:

```
┌─────────────────────────────┐
│ [MW] My workspace           │
│      Starter plan           │
│─────────────────────────────│
│ Switch Workspace    1    >  │
│ Create Workspace            │
│ Invite Members              │
│ Workspace Activity          │
│ Upgrade Workspace Plan      │
└─────────────────────────────┘
```

- 显示当前 workspace 名称 + plan
- "Switch Workspace" 有数字 badge 和右箭头 (子菜单)
- 其他操作: Create, Invite, Activity, Upgrade

---

## 3. Project Sidebar（项目侧栏）

### 3.1 结构

进入项目后, global rail 右侧出现 230px 宽的项目侧栏:

```
┌────────────────────┐
│ < Back    Frontend │  ← Back link to All Projects + project type
├────────────────────┤
│ Setup              │  ← group label
│   Sources      1   │  ← with count badge
│   GitHub Action    │
│ Workspace          │
│   Test Cases   37  │  ← active state (highlighted bg)
│   Test Runs    1   │
│ Analytics          │
│   Insights         │
│ Activity           │
│   Activity Log     │
│ Project Settings   │
│   General          │
│   Test Execution > │  ← accordion: Environment, Run Behavior, Test Files
│   Notifications &..│
├────────────────────┤
│ Onboarding Checklist│ ← collapsible card
│ Nice start!         │
│ [progress bar]      │
│  Plan your tests    │  ← strikethrough (completed)
│  Generate & run...  │  ← strikethrough (completed)
│  Fix a failure ...  │  ← next task (highlighted)
│  Re-run your tests  │
│  Run tests on...PR  │
│         View All    │
├────────────────────┤
│ [Toggle button]     │  ← collapse project sidebar
└────────────────────┘
```

### 3.2 项目侧栏分组

| 分组 | 项目 | 链接 | badge |
|------|------|------|-------|
| Setup | Sources | `.../settings/source` | count: 1 |
| Setup | GitHub Action | `.../settings/github-action` | - |
| Workspace | Test Cases | `.../test-cases` | count: 37 |
| Workspace | Test Runs | `.../execution` | count: 1 |
| Analytics | Insights | `.../projects/{id}` (root) | - |
| Activity | Activity Log | `.../activity` | - |
| Project Settings | General | `.../settings` | - |
| Project Settings | Test Execution (accordion) | 子项: Environment, Run Behavior, Test Files | - |
| Project Settings | Notifications & Ticketing | `.../settings/integration` | - |

### 3.3 Onboarding Checklist

位于项目侧栏底部, 可折叠:

**展开态**:
- 标题: "Onboarding Checklist"
- 状态文本: "Nice start!" (根据完成度变化)
- 进度条
- 5 个步骤项, 每项有状态:
  - Complete (绿色 checkmark + 删除线): "Plan your tests", "Generate & run your tests"
  - Do this next (当前任务): "Fix a failure with AI"
  - Not started: "Re-run your tests", "Run tests on every PR"
- "View All" 链接 -> `.../get-started`

**折叠态**:
- 只显示标题 "Onboarding Checklist" + 箭头
- 内容区域高度为 0

**折叠动画**: 使用 `grid-template-rows 0.2s cubic-bezier(0, 0, 0.2, 1)` 过渡 (grid 0fr -> 1fr 技术)

### 3.4 折叠按钮

项目侧栏底部有一个独立的折叠按钮 (ref=169), 点击后隐藏整个项目侧栏。

---

## 4. 面包屑与页面标题区

### 4.1 面包屑结构

**桌面端 (项目内)**:
```
[全国调研问卷平台 icon] > [Test Cases]
```
- 使用 `<nav aria-label="breadcrumb">` 包裹
- 项目名有 max-width: 200px + truncate
- 分隔符为 SVG 箭头
- hover: `color 0.15s cubic-bezier(0.4, 0, 0.2, 1)` 颜色过渡

**桌面端 (工作区级页面)**:
```
[Get Started] 或 [All Projects]
```
- 只显示当前页面名, 无层级

**移动端/窄屏**:
```
[Test Cases]
```
- 只显示当前页面名, 隐藏项目名

### 4.2 页面标题区

位于面包屑下方:

```
Test Cases  [?]                         [Share] [copy-link]
Every test in this project, grouped by use case, with its latest result.
```

- 标题 + info icon (hover 显示 "How testing works" 帮助)
- 描述文本
- 右上角: Share 按钮 + Copy link 按钮

### 4.3 Share 弹窗

点击 Share 按钮打开的 dialog:

```
┌─────────────────────────────────────┐
│ Share "全国调研问卷平台"    [link] [X] │
│ Invite people to this workspace...   │
│                                     │
│ Invite by email                     │
│ [name@company.com] [Create Invitation]│
│                                     │
│ People with access                  │
│ [avatar] 叶旺林 (You)        Owner  │
│ [MW] Anyone in My workspace         │
│      Workspace · 1 person           │
│─────────────────────────────────────│
│ [Copy link to this page]      [X]   │
└─────────────────────────────────────┘
```

### 4.4 Copy Link 反馈

点击 copy-link 按钮:
- 复制当前页面 URL 到剪贴板
- 显示 Sonner toast: "Link copied" + "Anyone in this workspace can open it."
- Toast 动画: fade-in (`0.3s ease`, `scale(0.8) -> scale(1)`)

---

## 5. 路由与导航行为

### 5.1 URL 结构

所有路由遵循统一模式:

```
/dashboard-v3/o/{orgId}                         → Overview
/dashboard-v3/o/{orgId}/get-started             → Get Started
/dashboard-v3/o/{orgId}/projects                → All Projects
/dashboard-v3/o/{orgId}/testlist                → Test Lists
/dashboard-v3/o/{orgId}/monitoring              → Test Schedules
/dashboard-v3/o/{orgId}/settings/workspace      → Workspace Settings - General
/dashboard-v3/o/{orgId}/settings/team           → Workspace Settings - Members
/dashboard-v3/o/{orgId}/settings/billing        → Workspace Settings - Billing Plan
/dashboard-v3/o/{orgId}/settings/usage          → Workspace Settings - Usage
/dashboard-v3/o/{orgId}/settings/integrations   → Integrations
/dashboard-v3/o/{orgId}/settings/apikey         → API Keys
/dashboard-v3/o/{orgId}/activity                → Workspace Activity

/dashboard-v3/o/{orgId}/projects/{projId}                  → Project Insights
/dashboard-v3/o/{orgId}/projects/{projId}/test-cases       → Test Cases
/dashboard-v3/o/{orgId}/projects/{projId}/execution        → Test Runs
/dashboard-v3/o/{orgId}/projects/{projId}/execution/{runId} → Test Run Detail
/dashboard-v3/o/{orgId}/projects/{projId}/activity         → Project Activity Log
/dashboard-v3/o/{orgId}/projects/{projId}/settings         → Project General
/dashboard-v3/o/{orgId}/projects/{projId}/settings/source  → Sources
/dashboard-v3/o/{orgId}/projects/{projId}/settings/github-action → GitHub Action
/dashboard-v3/o/{orgId}/projects/{projId}/settings/environments  → Environment
/dashboard-v3/o/{orgId}/projects/{projId}/execution-settings     → Run Behavior
/dashboard-v3/o/{orgId}/projects/{projId}/execution-settings/fixture → Test Files
/dashboard-v3/o/{orgId}/projects/{projId}/settings/integration   → Notifications & Ticketing
/dashboard-v3/o/{orgId}/projects/{projId}/get-started            → Project Onboarding
```

### 5.2 Back 行为

项目侧栏顶部的 "Back" 链接:
- href 指向 `.../projects` (All Projects 页面)
- 不是浏览器 history.back(), 而是固定导航到项目列表
- 旁边显示项目类型标签 (如 "Frontend")

### 5.3 项目切换

项目切换通过以下途径:
1. **All Projects 页面**: 显示所有项目列表, 点击项目名进入
2. **Workspace Switcher**: 切换 workspace (不是项目级别的切换)
3. **URL 直接导航**: 修改 URL 中的 projId

---

## 6. Chat Panel（AI 聊天面板）

### 6.1 结构

Chat 面板是从右侧滑入的 overlay, 不是独立路由:

```
┌──────────────────────────────────┐
│ Chats  [settings] [max] [collapse]│
├──────────────────────────────────┤
│ [TestSprite Logo]                │
│ Hello, {name}. What can I help   │
│ you test?                        │
│                                  │
│ Drop a web URL and I'll explore  │
│ it, plan the tests, and run them │
│ end to end.                      │
│                                  │
│ ┌──────────────────────────┐     │
│ │ Ask a question...        │     │
│ │ [clip] [Select Project] [↑]│   │
│ └──────────────────────────┘     │
│                                  │
│ ┌─Suggestion──────────────────┐  │
│ │ Test the frontend UI on...  │  │
│ │ Re-run last week's...       │  │
│ │ Generate backend API...     │  │
│ └─────────────────────────────┘  │
└──────────────────────────────────┘
```

### 6.2 Chat Panel 操作

| 操作 | 按钮 | 行为 |
|------|------|------|
| 打开 | rail 中的 "Chats" 按钮 | 从右侧滑入 |
| 关闭/折叠 | "Collapse panel" 按钮 | 滑出到右侧 (`translate-x-full`) |
| 最大化 | "Maximize panel" / "Exit full screen" | 全屏/恢复 |
| 设置 | "Chat settings" | 设置菜单 |

### 6.3 Chat Panel 动画

- **CSS**: `transition-[translate] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]`
- **收起状态**: `translate-x-full` (100% 右移)
- **展开状态**: `translate-x-0`
- **持续**: 260ms, 缓动: `cubic-bezier(0.32, 0.72, 0, 1)` (ease-out-expo 风格)

### 6.4 Chat 欢迎动画

Chat 面板中的问候文本 ("Hello, {name}. What can I help you test?") 使用逐字母出现动画:
- 每个字母是独立的 `<span>` 元素
- 关键帧 `chat-enter`: `opacity: 0; transform: translateY(6px)` -> 正常状态

---

## 7. 通知与客服

### 7.1 通知面板

- 存在 `aria-label="Notifications alt+T"` 的容器
- 快捷键: `Alt+T`
- 观测时面板内容为空 (height: 0)
- **推断**: 可能是通过 Alt+T 切换的通知中心面板

### 7.2 Chat 按钮 (右下角)

- 位置: 固定在右下角
- 尺寸: 48x48px 圆形按钮
- 内容: 绿色背景 + chat icon
- aria-label: "Open chat"

### 7.3 Intercom 客服

- 独立的 Intercom Messenger 按钮
- aria-label: "Open Intercom Messenger"
- 位于右下角 (与 chat 按钮分开)

---

## 8. 响应式行为

### 8.1 断点总结

| 视口宽度 | Global Rail | Project Sidebar | Breadcrumb | Chat Panel |
|----------|------------|-----------------|------------|------------|
| >=1024px (桌面) | 48px icon-only 或 230px expanded | 230px | 完整路径 | 右侧 overlay |
| ~768px (平板) | **隐藏**, hamburger 菜单 | **隐藏** | 仅当前页面 | 隐藏, 顶栏 chat 按钮 |
| ~375px (手机) | **隐藏**, hamburger 菜单 | **隐藏** | 仅当前页面 | 隐藏, 顶栏 chat 按钮 |

### 8.2 平板/移动端布局

```
┌──────────────────────────────────┐
│ [=] Test Cases    [Share] [link] │  ← hamburger + breadcrumb + actions
├──────────────────────────────────┤
│ Test Cases  [?]                  │
│ Every test in this project...    │
│                                  │
│ [Search Tests              ]     │
│ [filter] [Edit] [+] [Run]        │  ← icon-only buttons
│                                  │
│ [All 37] [Planned 0] [... >]    │  ← scrollable tabs
│                                  │
│ [ ] ID   Status    Test Name     │  ← simplified columns
│ ...                              │
│                                  │
│ [50 Rows v]         [< 1 >]     │
└──────────────────────────────────┘
```

### 8.3 移动端具体变化

1. **导航**: 两侧栏均隐藏, 替换为左上角 hamburger 按钮 ("Open navigation")
2. **面包屑**: 只显示当前页面名, 项目名隐藏
3. **工具栏按钮**: 文本隐藏, 只显示图标 (Edit Test Plan -> 笔图标, Add More Tests -> +图标, Run All -> 播放图标)
4. **Tab 栏**: 可水平滚动, 右侧有 "Scroll tabs right" 按钮
5. **表格列**: "Latest Status" 缩短为 "Status", Priority 列隐藏
6. **表格内容**: 文本截断 (ellipsis)
7. **分页**: "Previous"/"Next" 文本隐藏, 只显示箭头
8. **顶部栏**: 新增 chat 按钮 (右上角)

---

## 9. 动效系统

### 9.1 核心过渡

| 用途 | 属性 | 时长 | 缓动 |
|------|------|------|------|
| **侧栏宽度** | `width, min-width` | 260ms | `cubic-bezier(0.32, 0.72, 0, 1)` |
| **Chat 面板** | `translate` | 260ms | `cubic-bezier(0.32, 0.72, 0, 1)` |
| **按钮/链接 hover** | `color, bg-color, border-color` | 150ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **Badge/chip** | `color, bg-color, box-shadow` | 150ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **Tab 指示器 (pill)** | `left, top, width, height` | 220ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| **Tab 指示器 (underline)** | `left, width` | 220ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| **Accordion (sidebar)** | CSS keyframe `accordion-down/up` | 150ms | `ease-out` |
| **Onboarding collapse** | `grid-template-rows` | 200ms | `cubic-bezier(0, 0, 0.2, 1)` |
| **Tooltip/popover** | `left, top, width, height` | 220ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| **Sonner toast** | `opacity, scale` | 300ms | `ease` |

### 9.2 关键帧动画

| 名称 | 用途 | 描述 |
|------|------|------|
| `collapsible-down/up` | 折叠面板 | `height: 0 <-> var(--radix-collapsible-content-height)` |
| `accordion-down/up` | 手风琴 | `height: 0 <-> var(--radix-accordion-content-height)` |
| `shimmer` | 骨架加载 | `translate(-100%) -> translate(100%)` |
| `rise` | 内容入场 | `opacity: 0, translateY(14px) -> opacity: 1, translateY(0)` |
| `chat-enter` | Chat 问候文字 | `opacity: 0, translateY(6px)` 逐字母 |
| `live-pulse` | 实时状态指示 | `opacity: 0.4->0, scale: 1->1.8` 脉冲 |
| `live-core-pulse` | 实时核心 | `opacity: 1->0.6` 闪烁 |
| `indeterminate` | 不确定进度条 | `translate(-120%) -> translate(320%)` |
| `plan-shimmer` | AI 规划中文字 | 渐变背景文字动画, `1.8s linear infinite` |
| `marquee` | 滚动文字 | `translate(0) -> translate(-50%)` |
| `ripple-pulse` | 波纹脉冲 | `opacity: 0.6 -> 1` |
| `run-log-settle` | 运行日志入场 | `opacity: 0, scale(0.5)` |
| `ai-shimmer-sweep` | AI 扫光 | `translate(-80%) -> translate(202%)` |
| `ai-shimmer-breathe` | AI 呼吸 | `rotate(16deg) scaleX(0.9) -> rotate(26deg) scale(1.1, 0.85)` |
| `sonner-fade-in/out` | Toast | `opacity + scale(0.8->1)` |
| `auth-scan` | 认证扫描 | `translateY(-120%) -> translateY(220%)` 带透明度 |
| `caret-blink` | 光标闪烁 | `opacity: 1 -> 0` |

### 9.3 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .animate-marquee, .animate-marquee-vertical, .animate-ripple-pulse, .animate-rise {
    animation: none;
  }
  .plan-shimmer {
    color: var(--color-fg-default);
    background: 0;
    animation: none;
  }
}
```

### 9.4 Skeleton 加载状态

- All Projects 页面加载时使用 shimmer 效果的骨架占位行
- 骨架行模拟表格结构 (项目名称、最新结果、最后活动等列)
- 使用 `@keyframes shimmer`: `translate(-100%) -> translate(100%)` 水平扫光

---

## 10. 配色层级 (供 NexusKit 映射)

TestSprite 使用 CSS 自定义属性定义颜色层级, 以下是结构层级关系 (最终复刻使用 NexusKit 配色):

| CSS 变量 | 用途 | 层级关系 |
|----------|------|---------|
| `--color-bg-deep` | 最外层容器背景 | 最深层背景 |
| `--color-bg-default` | 面板/弹窗背景 | 浮层背景 (chat panel, dialogs) |
| `--color-fg-default` | 主要文本 | 最高对比度前景 |
| `--color-fg-secondary` | 次要文本 | 面包屑、描述文本 |
| `--color-fg-icon` | 图标颜色 | rail 图标 |
| `--color-border-default` | 边框 | 分隔线、面板边框 |
| `--color-interactive-bg-hover` | 悬停背景 | 按钮/链接 hover |
| `--color-interactive-bg-subtle` | 微妙背景 | tab pill 背景 |
| `--color-nav-active-bg` | 导航激活背景 | 当前选中侧栏项 |
| `--radius-md` | 中等圆角 | 按钮、输入框 |
| `--radius-xs` | 小圆角 | tab 按钮 |

**层级**: bg-deep < bg-default (浮层); fg-default > fg-secondary > fg-icon (前景递减)

---

## 11. 微交互与细节

### 11.1 按钮

- 所有按钮使用 `transition-all` (150ms), 覆盖 color, bg-color, border-color, fill, stroke
- Focus visible: `ring-[3px] ring-ring/50`
- Disabled: `opacity-50`

### 11.2 侧栏导航项

- 高度: 32px (`h-8`)
- 圆角: `rounded-[var(--radius-md)]`
- hover: 背景色过渡 (`hover:bg-[var(--color-interactive-bg-hover)]`)
- active: 背景色高亮 (`bg-[color:var(--color-nav-active-bg)]`)
- 间距: `gap-2.5` (icon + text)

### 11.3 Badge/Chip

- 形状: `rounded-full` (全圆角)
- 尺寸: `text-xs font-medium`, `px-2 py-0.5`
- 动画: `color, bg-color, box-shadow` 150ms

### 11.4 表格行

- 状态标签: 绿色 "Passed", 红色 "Failed", 琥珀色 "Blocked"
- 优先级: High (双竖线), Medium (单竖线)
- 分组行: 可折叠的 use case 分组, 带计数和进度条
- 行间距和时间戳: "2w ago" 格式

### 11.5 对话框 (Share)

- 居中显示
- 半透明遮罩
- 内部结构: 标题 + 描述 + 表单 + 人员列表 + 底部操作
- 关闭: 右上角 X 按钮 + Escape

---

## 12. 观测局限与未知项

### 12.1 已观测

- 桌面端完整布局 (~1700px)
- 平板布局 (768px)
- 手机布局 (375px)
- Global rail 折叠/展开
- Project sidebar 结构
- Onboarding checklist 折叠
- Chat panel 展开/收起
- Share dialog
- Copy link toast
- Workspace switcher dropdown
- All Projects 页面 (含骨架加载)
- Get Started 页面 (完整 onboarding 流程)
- 所有 CSS transition/animation 参数

### 12.2 未观测 (需后续取证)

- **通知面板内容**: Alt+T 触发的通知中心面板在观测时为空
- **加载/空/错误状态**: 各页面的 loading skeleton 细节 (All Projects 有骨架, 其他页面未逐一检查)
- **键盘导航**: Tab 顺序、快捷键 (除 Alt+T 外)
- **对话框进出动画**: Share dialog 的 enter/exit 动画参数未捕获 (需要慢速观测)
- **路由切换过渡**: 页面间切换是否有过渡动画
- **Tooltip 行为**: rail 折叠态下的 tooltip 内容 (hover 时未捕获到)
- **Billing/Connections 手风琴动画**: accordion 展开/收起的实际动画效果 (CSS 已记录, 视觉未截屏)
- **Test Execution 子菜单**: 手风琴展开/收起的视觉过渡
- **多个项目间的切换**: 只有 1 个项目, 未观测项目切换的实际交互

### 12.3 推断 vs 观测

| 项目 | 状态 |
|------|------|
| 三栏布局尺寸 | 观测 (getBoundingClientRect) |
| CSS transition 参数 | 观测 (getComputedStyle) |
| Keyframe 动画 | 观测 (CSS rules 提取) |
| 响应式断点行为 | 观测 (CDP viewport override) |
| 通知面板用途 | 推断 (aria-label 暗示 Alt+T 快捷键) |
| Toast 使用 Sonner 库 | 观测 (CSS 类名 `data-sonner-toast`) |
| 手风琴使用 Radix UI | 观测 (CSS 变量 `--radix-accordion-content-height`) |
| 项目类型 "Frontend" 标签 | 观测 |
| 页面切换无过渡动画 | 推断 (未观测到 transition/animation on route change) |

---

## 13. 实现建议

### 13.1 布局优先级

1. 三栏 flex 布局 (global rail + project sidebar + main content)
2. Global rail 折叠/展开 (48px <-> 230px, `width 260ms cubic-bezier(0.32,0.72,0,1)`)
3. Chat panel 右侧滑入/滑出 (`translate 260ms` 同缓动)
4. 响应式: <768px 时隐藏两侧栏, hamburger 替代

### 13.2 动画实现

- 侧栏宽度: CSS `transition-[width] duration-[260ms]`
- Chat 面板: CSS `transition-[translate] duration-[260ms]` + `translate-x-full` toggle
- Accordion: CSS grid-template-rows 0fr/1fr 或 Radix collapsible
- Tab 指示器: 绝对定位 span, `transition left/width 220ms cubic-bezier(0.22,1,0.36,1)`
- Toast: Sonner 库或同等 fade-in/scale 动画
- 骨架加载: shimmer keyframe animation

### 13.3 技术栈建议

- 基于 CSS 变量 (类似 Tailwind CSS custom properties)
- Accordion 使用 Radix UI Collapsible (与观测到的 `--radix-*` 变量一致)
- Toast 使用 Sonner
- Tab 指示器使用绝对定位 + CSS transition

---

## 14. 证据来源

- **实时观测**: ego-browser TaskSpace 1, Page p2
  - Test Cases 页面 (desktop 1695px, tablet 768px, mobile 375px)
  - All Projects 页面
  - Get Started 页面
  - Share dialog
  - Workspace switcher dropdown
  - Chat panel (展开/收起)
  - Onboarding checklist (展开/折叠)
  - Global rail (折叠/展开)
- **CSS 提取**: getComputedStyle + document.styleSheets 遍历
- **参考 URL**: `https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases`
- **公开文档**: [TestSprite Documentation - Overview](https://docs.testsprite.com/web-portal/getting-started/overview), [UI Testing](https://docs.testsprite.com/web-portal/core/ui/ui-testing)
