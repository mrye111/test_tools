# PRD · 前端视觉系统重构：极简液态玻璃（Quiet Glass）

> 状态：ready-for-agent（gh CLI 缺失，暂以文档形式落盘，后续补发 GitHub Issues）
> 日期：2026-07-21

## Problem Statement

站点视觉经历多轮迭代（Aurora Glass 极光风 → 深色 Lightfall Hero），单点效果出色，但整体开始失控：

- 多彩渐变被当作装饰通用品滥用（按钮多段彩虹渐变、各处渐变文字、渐变徽标），与"精确、轻量、可信赖"的工具定位（PRODUCT.md）冲突
- 动效不成体系：弹窗/下拉/Tooltip 只有进入动画、没有退出动画；时长与缓动各处不一；用户明确反馈"弹出效果、关闭效果都要"
- 材料语言不统一：玻璃、实白、半透明混用；深色 Hero 与浅色主体虽然已做衔接，但浅色区仍偏"花哨"而非"极简 SaaS"
- 字体使用随意：字重/字号阶梯没有规则，显示字体出现在不该出现的位置

用户视角：这是一个给人专业感的 AI 测试工具平台，而不是一块视觉试验田。需要一套克制、统一、液态玻璃为标志性材料的极简 SaaS 界面。

## Solution

确立 **Quiet Glass（极简液态玻璃）** 设计系统并全站落地：

- **极简**：单一主色（青碧），中性色承载 90% 界面；渐变只保留在真正需要的地方（Hero 光雨画布、品牌标识）；装饰性多色渐变全部清除
- **液态玻璃**作为标志性材料，配方统一：半透明底 + 10-20px 背景模糊（仅静态元素）+ 1px 高光边 + 顶部镜面高光 + 分层阴影；动效元素一律用"绘制玻璃"（高不透明渐变，零运行时模糊）
- **动效成体系**：微交互 150-250ms、弹层 200-300ms，统一 expo-out 缓动；所有弹窗/下拉/Tooltip 具备对称的进入与退出动画
- **字体成体系**：Sora + MiSans 不变，但定义明确的阶梯（显示/标题/正文/辅助/微字号五档）与字重规则

## User Stories

1. 作为测试工程师，我希望所有按钮的外观和行为一致（同一套 primary/secondary/icon 词汇），以便形成稳定的操作预期
2. 作为测试工程师，我希望弹窗打开和关闭都有平滑的过渡，而不是生硬地消失，以便感知界面状态变化
3. 作为测试工程师，我希望下拉框/选择器展开和收起都有动画，以便理解它的来去方向
4. 作为测试工程师，我希望输入框的视觉状态（默认/hover/聚焦/错误）清晰可辨，以便放心填写配置
5. 作为测试工程师，我希望列表选中态干净明确，以便知道当前上下文
6. 作为测试工程师，我希望界面颜色克制（一个主色），重要操作一眼可辨，而不是到处是彩色
7. 作为 QA 主管，我希望平台看起来像 Linear/Notion 级别的专业 SaaS，以便向团队推广时有信心
8. 作为访客，我希望首页 Hero 的光雨效果保留并与下方内容自然衔接
9. 作为访客，我希望页面加载没有花哨的编排动画，内容直接可用
10. 作为移动端用户，我希望触控目标足够大、文字足够大
11. 作为无障碍用户，我希望 prefers-reduced-motion 下所有装饰动画关闭
12. 作为键盘用户，我希望所有可交互元素有可见的焦点环
13. 作为弱 GPU 设备用户，我希望动画不掉帧（合成器动画、无运行时模糊滥用）
14. 作为测试工程师，我希望 Tooltip 出现和消失都平滑
15. 作为测试工程师，我希望深色 Hero 区域内的文字、按钮、选中态都为深色场景专门设计

## Implementation Decisions

### 模块：设计令牌（index.css @theme）

- 主色：青碧单主色（oklch ≈ 0.6/0.15/210），保留 accent-strong/soft/cyan/mint 作为梯度，但**禁止**在非 Hero 场景做多色渐变装饰
- 中性色：青色调中性灰（hue 205-215），表面三级：page / panel / raised
- 阴影：低彩度、青色调，三级 elevation + focus ring + glass glow
- 动效令牌：统一时长档（fast 150ms / base 220ms / slow 320ms）与缓动（ease-out-expo），禁止弹性/弹跳曲线

### 模块：材料配方（index.css 工具类）

- `.liquid-glass`：静态液态玻璃（nav、弹窗、下拉面板），blur 10-20px + saturate 1.4 + 顶部高光 + 分层阴影
- `.glass-chip` / `.glass-chip-dark`：小件玻璃，深浅两版
- `.surface-panel` / `.motion-card`：绘制玻璃（无 backdrop-filter），供动效元素使用
- `.text-gradient`：保留但仅允许 Hero 标题第二行与品牌字标使用

### 模块：动效系统（index.css keyframes + 组件）

- 弹窗：进入 modal-in（scale 0.95→1 + y + 淡入，280ms expo-out）、退出 modal-out（200ms 收缓）——ModalPortal 需支持退出动画（延迟卸载或状态驱动）
- 下拉/选择器：dropdown-in / dropdown-out 对称；CustomSelect 用 motion AnimatePresence 或等价机制实现退出
- Tooltip：enter/exit 已有，统一时长到 160/120ms
- 页面进入：单一 page-in（短促），取消所有编排式入场
- 按钮：hover 微浮 + 主色加深，active 微缩；去除光线扫过等装饰效果
- 骨架屏/加载：保留 shimmer，统一 2s

### 模块：组件重构范围

- 按钮三件套（primary/secondary/icon-action）：主按钮改**纯色主色**（非多段渐变），内高光保留，hover 加深+微浮
- 弹窗/对话框：玻璃面板 + 对称开合动画；危险操作红色语义保留
- 输入框/下拉框：统一 40px 高、12px 圆角、安静边框、聚焦 accent 环
- 列表（AnimatedList）：选中态改"主色淡底 + 左侧 2px 主色指示"（1px 规则内，不用粗彩条）
- 导航：浮动玻璃胶囊保留，样式随新玻璃配方微调
- Hero：Lightfall 画布与深色舞台保留（已是站点标志），内容区样式随新体系微调

### 模块：首页结构（仅布局微调）

- Hero（深色舞台 + 光雨）→ 跑马灯缝合带 → 工具矩阵 → 深色收边页脚，结构不变
- 工具卡片：保留 6 卡网格与悬停反馈，图标瓷砖改为单色主色（去除四色轮换）

### 字体阶梯

- display（Hero 标题）800 / page-title 700 / section-title 700 / body 400-500 / caption 500
- 显示字体仅限标题层级，按钮/标签/数据用正文字体族

## Testing Decisions

- 好测试标准：只测外部行为（渲染内容、可交互性、回调），不测实现细节（类名、内部结构）
- 测试模块：现有 37 个测试文件（247 用例）保持绿色；视觉重构不应破坏任何断言
- 新增测试：ModalPortal/ConfirmDialog 的退出动画时序（如实现为状态驱动延迟卸载，可用 fake timers 断言卸载延迟）；CustomSelect 开合状态
- 既有先例：组件级 Testing Library 测试（Hero/Navbar/ToolCard/HeaderComboInput 等），沿用同一模式
- 验证手段：`npm run build`、`npx vitest run`、Playwright 截图巡检（桌面 1440 + 移动 390）

## Out of Scope

- 业务逻辑、路由、数据流、后端 API 的任何改动
- 深色模式切换（站点保持浅色 + 深色 Hero 舞台的固定组合）
- 报告主题系统（themes.ts）的二次重构（已在本轮早期迁移过色系）
- 新增页面或功能
- GitHub Issues 发布（gh CLI 缺失，补装后补发）

## Further Notes

- 性能约束来自前轮 trace 分析结论：动效元素不得携带 backdrop-filter/filter（会强制主线程动画）；液态玻璃仅限静态元素
- MiSans 字体为 unicode-range 分包，仅 preconnect 不 preload
- 本 PRD 由 /to-prd 技能从会话上下文合成；模块拆分（令牌/材料/动效/组件/页面）均可在 build+test 下独立验证
