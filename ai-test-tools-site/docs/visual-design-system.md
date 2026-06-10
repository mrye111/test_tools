# AI测试工具统一视觉效果设计规范

## 1. 设计方向

AI测试工具使用“现代工具台”视觉语言：简洁、轻量、精确，但不做空白页面式的简单。整体基调是浅色背景、玻璃质感面板、单一蓝色强调、柔和动效和高信息可读性。

核心原则：

- 统一强调色：只使用蓝色 `#2563eb` 作为主强调色。
- 克制层次：用边框、透明白、轻阴影表达层级，避免厚重卡片和强外发光。
- 动效有用途：入场、悬停、弹窗、下拉、状态提示都要有反馈，但不干扰操作。
- 软件界面无 emoji：图标使用现有 `lucide-react`，或使用文字型技术徽标。
- 移动端优先收敛：复杂网格在小屏幕必须折叠为单列。

## 2. 颜色

基础色：

- 背景：`#f8fafc`
- 前景文字：`#0f172a`
- 次级文字：`#64748b`
- 边框：`#e2e8f0`
- 表面：`rgba(255,255,255,0.78)` 到 `#ffffff`
- 强调色：`#2563eb`
- 错误色：`#b91c1c`

使用规则：

- 主按钮、选中态、状态点使用强调色。
- 成功和普通进展状态优先使用蓝色信息面板，不额外引入绿色体系。
- 错误状态使用红色，但只用于错误提示、删除悬停、失败结果。
- 避免紫色、霓虹色、大面积渐变文字。

## 3. 字体与标题

字体栈定义在 `src/index.css`：

- Display：`Geist`, `Satoshi`, `Inter`, system sans-serif
- Body：`Geist`, `Satoshi`, `Inter`, system sans-serif
- Mono：`JetBrains Mono`, `SFMono-Regular`, ui-monospace

标题规范：

- 页面主标题使用 `.page-title`，约 `22px`，字重 `720`，负字距。
- 首页使用上方 Hero + 下方功能按钮矩阵，进入页面应同时看到标题、子标题和主要功能入口。
- 面板标题使用 `font-display text-xl font-semibold tracking-[-0.035em]`。
- 分组标签使用小写或英文短标签时，采用 `text-xs uppercase tracking-[0.16em] text-muted`。

正文规范：

- 正文默认 `14px` 到 `16px`。
- 描述文本使用 `text-muted`，行高保持 `1.6` 到 `1.8`。
- 数字、路径、工具名、JSON 使用等宽字体。

## 4. 页面布局

页面容器：

- 业务页统一使用 `.page-shell`。
- 页面头部统一使用 `.page-header`。
- 返回按钮使用 `.icon-action h-10 w-10`。
- 页面右侧操作使用 `.secondary-action` 或 `.primary-action`。

首页布局：

- 首页使用上下结构：Hero 展示标题和子标题，功能按钮矩阵紧跟在标题下方。
- Hero 不放 CTA 和编排台，避免和功能入口重复。
- 功能按钮使用 3 列 2 行紧凑磁贴，确保桌面首屏全部可见；移动端折叠为单列。

业务页布局：

- JMeter、用例生成、设置页统一使用玻璃面板 `.surface-panel`。
- 表格容器使用 `.table-shell`。
- 状态提示使用 `.status-panel`，错误叠加 `.danger-panel`。

## 5. 按钮

主按钮：

- 类名：`.primary-action`
- 用途：生成、保存、下载、添加模型等主动作。
- 形态：蓝色渐变、白字、轻阴影、hover 上移、active 下压。
- 推荐尺寸：`px-4 py-2 text-sm` 或 `px-6 py-2.5 text-sm`。

次按钮：

- 类名：`.secondary-action`
- 用途：取消、模型设置、刷新、次级导出。
- 形态：白色半透明、浅灰边框、hover 蓝色边框和蓝色文字。

图标按钮：

- 类名：`.icon-action`
- 用途：返回、关闭、删除、单图标操作。
- 尺寸：常规 `h-10 w-10`，弹窗关闭 `h-8 w-8`。

交互规则：

- hover 使用 `translateY(-1px/-2px)`。
- active 使用 `translateY(1px) scale(0.99)`。
- disabled 使用 `opacity-50`，并禁止主操作触发。

## 6. 表单与下拉框

输入框：

- 类名：`.field-control`
- 圆角：`12px`
- 边框：`rgba(226,232,240,0.95)`
- focus：蓝色边框 + `--shadow-focus-ring`

标签：

- 类名：`.field-label`
- 必填项使用红色星号。
- 辅助说明使用 `.helper-text`。

下拉框：

- 自定义下拉组件使用 `.field-control` 作为触发器。
- 弹层使用 `.dropdown-panel`，带轻微上移动效。
- 选中项使用蓝色浅底，不使用多色标签。

文本域：

- 普通文本域使用 `.field-control`。
- 代码/JSON 文本域使用深色背景 `bg-slate-950` 和等宽字体。

## 7. 弹窗

遮罩：

- 类名：`.modal-backdrop`
- 背景：`rgba(15,23,42,0.42)`
- 模糊：`backdrop-filter: blur(16px) saturate(1.25)`

面板：

- 类名：`.modal-panel`
- 圆角：`26px`
- 材质：白色半透明渐变 + 内高光边
- 动效：`modal-in 0.34s cubic-bezier(0.16, 1, 0.3, 1)`

弹窗结构：

- 标题：`font-display text-xl font-semibold`
- 描述：`text-sm text-muted`
- 表单：`grid gap-4`
- 底部按钮：右对齐，先次按钮再主按钮。

## 8. 图标

当前项目统一使用已安装的 `lucide-react`。

规范：

- 常规图标尺寸：`h-4 w-4`
- 大入口图标：`h-5 w-5` 到 `h-6 w-6`
- 工具卡图标使用 `stroke-[1.8]`
- 技术模板不使用 emoji，使用 `HTTP`、`DB`、`TCP`、`JSR` 等文字徽标。
- 图标颜色跟随容器状态，默认 `text-muted`，hover 或选中使用 `text-accent`。

## 9. 动效

全局动效定义在 `src/index.css`：

- `card-in`：卡片和页面块入场。
- `pulse-dot`：状态点呼吸。
- `float-soft`：背景光斑缓慢漂浮。
- `shimmer-pass`：主按钮和状态面板的轻扫光。
- `modal-in`：弹窗入场。
- `dropdown-in`：下拉面板入场。

使用规则：

- 卡片统一使用 `.motion-card`。
- 页面中多个卡片使用 `.stagger-1` 到 `.stagger-6` 控制入场延迟。
- 动画只使用 `transform` 和 `opacity`，避免动画 `width`、`height`、`top`、`left`。
- 尊重系统减少动态偏好，`prefers-reduced-motion` 下自动关闭动画。

## 10. 面板与表格

普通面板：

- 类名：`.surface-panel`
- 用途：业务页内容区域、配置区域、工具工作台左右面板。
- 具备轻微 spotlight hover，但不强制每个面板都 hover 上浮。

卡片入口：

- 类名：`.motion-card`
- 用途：首页工具卡、模板卡、模型列表项。
- hover 上浮，边框转蓝，阴影加强。

状态面板：

- 类名：`.status-panel`
- 用途：后端连接状态、生成完成、AI 总结。
- 错误态叠加 `.danger-panel`。

表格：

- 类名：`.table-shell`
- 表头使用浅灰底。
- 行 hover 使用极浅蓝底。
- 单元格保持 `12px`，长文本使用 `whitespace-pre-wrap`。

## 11. 后续开发检查清单

- 新页面是否使用 `.page-shell` 和 `.page-header`？
- 主操作是否使用 `.primary-action`？
- 次操作是否使用 `.secondary-action`？
- 输入、下拉、文本域是否使用 `.field-control`？
- 弹窗是否使用 `.modal-backdrop` 和 `.modal-panel`？
- 图标是否来自 `lucide-react` 且没有 emoji？
- 动效是否只使用 transform 和 opacity？
- 移动端是否折叠成单列并避免横向滚动？
