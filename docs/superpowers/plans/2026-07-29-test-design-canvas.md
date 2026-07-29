# 测试设计画布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把分析画板从只读单图表视图进化为测试设计工作台——Canvas 2D 自由白板，支持 AI 生成因果图/判定表/正交表草稿，确定性推导用例骨架并接力用例生成工具。

**Architecture:** 模型与渲染分离：白板模型是纯 TS 数据（`board/types.ts`），所有修改走命令（`commands.ts`，do/undo 对称），Canvas 渲染器只读模型按需重绘；DOM overlay 仅用于文本编辑态。AI 生成走服务端新接口（prompt 契约 + 修复重试），推导为前端纯函数（`derive.ts`）。白板持久化到分析记录新增的 `board` 字段，PATCH 自动保存防抖 1.5s。

**Tech Stack:** React 19 + TypeScript + Vitest（前端，jsdom）；Express 5 + TypeScript + Vitest（服务端，node）；Canvas 2D 自研渲染（无新增运行时依赖）。

**Spec:** `docs/superpowers/specs/2026-07-29-test-design-canvas-design.md`

## Global Constraints

- 全程中文注释、中文文案；注释风格对齐现有代码（说明约束与意图，不复述代码）
- 不新增 npm 运行时依赖（Canvas 2D 原生 API 自研渲染）
- 提交信息遵循 conventional commits（`feat:` / `fix:` / `test:` / `docs:` / `refactor:`），无 attribution
- 每个任务末尾 `npx vitest run <改动相关测试文件>` 必须全绿；lint 错误数不得超过既存基线 48
- 前后端测试命令均在 `ai-test-tools-site/` 目录下执行：`npx vitest run <path>`
- 图元/文本上限（写死在代码）：白板图元 ≤ 50、因果图节点 ≤ 60、判定表规则列 ≤ 64、正交 ≤ 4 因子 × 总水平 ≤ 18、文本单字段 ≤ 200 字
- API 响应统一信封：成功 `{ success: true, ... }`，失败 `{ success: false, error }`
- 前端 API 类型与函数放 `src/lib/requirement-analysis-api.ts`（现有模式：`parseRecordResponse` 解析信封）
- 后端 AI 调用复用 `server/src/features/requirement/ai.ts` 的 `collectStream` 模式与 `parseMaybeJsonObject`（`server/src/features/testcase/utils.ts`）
- 服务端路由注入式测试：`registerRequirementRoutes(app, store)` 已有此模式（`express-app.ts` 使用默认单例 store）

---

### Task 1: 白板图元模型与持久化层（board/types.ts + persistence.ts）

**Files:**
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/types.ts`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/persistence.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/persistence.test.ts`

**Interfaces:**
- Consumes: `RequirementNode`（`src/lib/requirement-analysis-api.ts`）
- Produces: `Board`、`BoardElement`、`MindmapRefElement`、`CauseEffectElement`、`DecisionTableElement`、`OrthogonalElement`、`ElementBase`、`BOARD_LIMITS`、`serializeBoard(board: Board): string`、`deserializeBoard(raw: unknown): Board | null`、`emptyBoard(): Board`

- [ ] **Step 1: 写失败测试（往返序列化 + 容错）**

```ts
// persistence.test.ts
import { describe, expect, it } from 'vitest'
import { deserializeBoard, emptyBoard, serializeBoard } from './persistence'
import type { Board } from './types'

const board: Board = {
  version: 1,
  elements: [
    {
      id: 'el-1', kind: 'mindmap-ref', x: 0, y: 0, w: 400, h: 300, sourceNodeId: null,
      selectedNodeId: null,
    },
    {
      id: 'el-2', kind: 'cause-effect', x: 500, y: 0, w: 600, h: 400, sourceNodeId: 'n1',
      nodes: [{ id: 'c1', role: 'cause', text: '短信≤210字', x: 0, y: 0 }],
      edges: [{ id: 'e1', from: 'c1', to: 'c2', constraint: 'identity' }],
    },
    {
      id: 'el-3', kind: 'decision-table', x: 0, y: 500, w: 500, h: 200, sourceNodeId: 'n1',
      conditions: ['字数≤210'], actions: ['按单条计费'],
      rules: [{ conditionValues: ['Y'], actionValues: [true] }],
    },
    {
      id: 'el-4', kind: 'orthogonal', x: 600, y: 500, w: 400, h: 200, sourceNodeId: null,
      factors: [{ name: '渠道', levels: ['短信', '邮件'] }],
      arrayName: 'L4(2^3)', rows: [['短信'], ['邮件']],
    },
  ],
}

describe('board persistence', () => {
  it('序列化/反序列化往返一致', () => {
    expect(deserializeBoard(JSON.parse(serializeBoard(board)))).toEqual(board)
  })

  it('空白板往返', () => {
    expect(deserializeBoard(JSON.parse(serializeBoard(emptyBoard())))).toEqual({ version: 1, elements: [] })
  })

  it('非对象输入返回 null', () => {
    expect(deserializeBoard(null)).toBeNull()
    expect(deserializeBoard('x')).toBeNull()
    expect(deserializeBoard([1])).toBeNull()
  })

  it('version 缺失或不支持返回 null', () => {
    expect(deserializeBoard({ elements: [] })).toBeNull()
    expect(deserializeBoard({ version: 2, elements: [] })).toBeNull()
  })

  it('elements 中坏图元被过滤，合法图元保留', () => {
    const parsed = deserializeBoard({
      version: 1,
      elements: [null, 'bad', board.elements[0], { kind: 'cause-effect' }],
    })
    expect(parsed?.elements).toHaveLength(1)
    expect(parsed?.elements[0].id).toBe('el-1')
  })

  it('kind 未知返回 null（整个图元被过滤）', () => {
    const parsed = deserializeBoard({ version: 1, elements: [{ ...board.elements[0], kind: 'sticky' }] })
    expect(parsed?.elements).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/persistence.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 types.ts（完整图元模型，按 spec §4）**

```ts
// types.ts
/** 白板元素与常量（spec §4 图元模型；上限 spec §7） */

export const BOARD_LIMITS = {
  MAX_ELEMENTS: 50,
  MAX_CE_NODES: 60,
  MAX_DT_RULES: 64,
  MAX_ORTHO_FACTORS: 4,
  MAX_ORTHO_LEVELS_TOTAL: 18,
  MAX_TEXT_LENGTH: 200,
} as const

export type ElementKind = 'mindmap-ref' | 'cause-effect' | 'decision-table' | 'orthogonal'

export interface ElementBase {
  id: string
  kind: ElementKind
  x: number
  y: number
  w: number
  h: number
  /** 溯源：从哪个需求节点生成；null = 用户白手建 */
  sourceNodeId: string | null
}

export interface MindmapRefElement extends ElementBase {
  kind: 'mindmap-ref'
  /** 选中 = AI 生成上下文；会话态，持久化时始终为 null */
  selectedNodeId: string | null
}

export type CauseEffectNodeRole = 'cause' | 'intermediate' | 'effect'
export type CauseEffectConstraint = 'and' | 'or' | 'not' | 'identity'

export interface CauseEffectNode {
  id: string
  role: CauseEffectNodeRole
  text: string
  /** 相对图元原点的局部坐标 */
  x: number
  y: number
}

export interface CauseEffectEdge {
  id: string
  from: string
  to: string
  constraint: CauseEffectConstraint
}

export interface CauseEffectElement extends ElementBase {
  kind: 'cause-effect'
  nodes: CauseEffectNode[]
  edges: CauseEffectEdge[]
}

export type DecisionTableConditionValue = 'Y' | 'N' | '-'

export interface DecisionTableRule {
  conditionValues: DecisionTableConditionValue[]
  actionValues: boolean[]
}

export interface DecisionTableElement extends ElementBase {
  kind: 'decision-table'
  conditions: string[]
  actions: string[]
  rules: DecisionTableRule[]
}

export interface OrthogonalFactor {
  name: string
  levels: string[]
}

export interface OrthogonalElement extends ElementBase {
  kind: 'orthogonal'
  factors: OrthogonalFactor[]
  arrayName: string
  rows: string[][]
}

export type BoardElement =
  | MindmapRefElement
  | CauseEffectElement
  | DecisionTableElement
  | OrthogonalElement

export interface Board {
  version: 1
  elements: BoardElement[]
}
```

- [ ] **Step 4: 实现 persistence.ts（校验式反序列化）**

要点：`emptyBoard()` 返回 `{ version: 1, elements: [] }`；`serializeBoard` 前把 `mindmap-ref` 的 `selectedNodeId` 置 null（会话态不落盘）；`deserializeBoard` 对每个图元按 kind 做结构校验（id/kind/坐标为有限数字、nodes/edges/rules/factors/rows 数组形状正确、字符串为 string），坏图元过滤；version 非 1 返回 null。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/persistence.test.ts`
Expected: 6 个用例全 PASS

- [ ] **Step 6: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/
git commit -m "feat: 白板图元模型与持久化序列化层"
```

---

### Task 2: 视口与坐标换算（viewport.ts）

**Files:**
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/viewport.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/viewport.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Viewport = { x: number; y: number; zoom: number }`、`screenToWorld(vp: Viewport, sx: number, sy: number): { x: number; y: number }`、`worldToScreen(vp: Viewport, wx: number, wy: number): { x: number; y: number }`、`zoomAt(vp: Viewport, sx: number, sy: number, factor: number): Viewport`（以屏幕点为锚缩放）、`fitBounds(bounds: { x: number; y: number; w: number; h: number }, viewportW: number, viewportH: number, padding?: number): Viewport`、`BOARD_ZOOM_MIN = 0.1`、`BOARD_ZOOM_MAX = 8`、`clampZoom(zoom: number): number`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { clampZoom, fitBounds, screenToWorld, worldToScreen, zoomAt, BOARD_ZOOM_MIN, BOARD_ZOOM_MAX } from './viewport'

describe('viewport', () => {
  it('世界↔屏幕坐标换算互逆', () => {
    const vp = { x: 100, y: 50, zoom: 2 }
    const s = worldToScreen(vp, 300, 200)
    expect(s).toEqual({ x: 500, y: 350 })
    expect(screenToWorld(vp, s.x, s.y)).toEqual({ x: 300, y: 200 })
  })

  it('zoomAt 以屏幕锚点缩放：锚点对应的世界点不动', () => {
    const vp = { x: 0, y: 0, zoom: 1 }
    const anchor = { sx: 200, sy: 150 }
    const before = screenToWorld(vp, anchor.sx, anchor.sy)
    const next = zoomAt(vp, anchor.sx, anchor.sy, 1.5)
    const after = screenToWorld(next, anchor.sx, anchor.sy)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.zoom).toBeCloseTo(1.5)
  })

  it('clampZoom 夹取边界，非法值回退 1', () => {
    expect(clampZoom(0)).toBe(1)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(0.0001)).toBe(BOARD_ZOOM_MIN)
    expect(clampZoom(1000)).toBe(BOARD_ZOOM_MAX)
  })

  it('fitBounds 让包围盒完整可见并居中（含 padding）', () => {
    const vp = fitBounds({ x: 0, y: 0, w: 1000, h: 500 }, 1200, 800, 40)
    // 可用 1120×720，缩放 = min(1120/1000, 720/500) = 1.12
    expect(vp.zoom).toBeCloseTo(1.12)
    const center = worldToScreen(vp, 500, 250)
    expect(center.x).toBeCloseTo(600)
    expect(center.y).toBeCloseTo(400)
  })

  it('fitBounds 空/零尺寸包围盒回退 zoom 1', () => {
    const vp = fitBounds({ x: 0, y: 0, w: 0, h: 0 }, 1200, 800)
    expect(vp.zoom).toBe(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/viewport.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 viewport.ts（纯函数）**

换算公式：`screen = (world - vp.{x,y}) * zoom`、`world = screen / zoom + vp.{x,y}`。`zoomAt`：先求锚点世界坐标，按新 zoom 反推 vp 原点使锚点屏幕坐标不变。`fitBounds`：`zoom = min((vpW-2p)/w, (vpH-2p)/h)` 后 clamp，原点使包围盒中心对齐视口中心；`w` 或 `h` ≤ 0 时返回 `{ x: bounds.x, y: bounds.y, zoom: 1 }`。

- [ ] **Step 4: 运行确认通过**

Expected: 5 个用例全 PASS

- [ ] **Step 5: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/viewport.ts ai-test-tools-site/src/features/requirement-analysis/board/viewport.test.ts
git commit -m "feat: 白板视口与坐标换算"
```

---

### Task 3: 命中检测（hit-test.ts）

**Files:**
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/hit-test.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/hit-test.test.ts`

**Interfaces:**
- Consumes: `BoardElement`、`CauseEffectElement`（Task 1）
- Produces: `HitResult = { elementId: string; part: 'body' } | { elementId: string; part: 'node'; nodeId: string } | { elementId: string; part: 'edge'; edgeId: string }`、`hitTestElement(el: BoardElement, wx: number, wy: number): HitResult | null`、`hitTestBoard(elements: BoardElement[], wx: number, wy: number): HitResult | null`（z 序：数组倒序，先因果图内部再整体）、`distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number`、`EDGE_HIT_TOLERANCE = 4`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { distToSegment, hitTestBoard, hitTestElement } from './hit-test'
import type { CauseEffectElement, DecisionTableElement } from './types'

const causeEffect: CauseEffectElement = {
  id: 'ce1', kind: 'cause-effect', x: 100, y: 100, w: 600, h: 400, sourceNodeId: null,
  nodes: [
    { id: 'n1', role: 'cause', text: '原因A', x: 0, y: 0 },
    { id: 'n2', role: 'effect', text: '结果B', x: 300, y: 100 },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', constraint: 'identity' }],
}

const table: DecisionTableElement = {
  id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  conditions: ['c1'], actions: ['a1'],
  rules: [{ conditionValues: ['Y'], actionValues: [true] }],
}

describe('hit-test', () => {
  it('distToSegment：点在线段上为 0，延长线上按端点距离', () => {
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBe(0)
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3)
    expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBe(5)
  })

  it('表格图元：包围盒内命中 body，外部 miss', () => {
    expect(hitTestElement(table, 200, 100)).toEqual({ elementId: 'dt1', part: 'body' })
    expect(hitTestElement(table, 500, 100)).toBeNull()
  })

  it('因果图：节点优先于边与背景（世界坐标 = 图元原点 + 局部坐标）', () => {
    // 节点 n1 中心约在 (100+60, 100+20)（节点绘制尺寸见 renderer，命中按节点局部包围盒 ± 节点半宽）
    const hit = hitTestElement(causeEffect, 100, 100)
    expect(hit?.elementId).toBe('ce1')
    expect(hit?.part).toBe('node')
  })

  it('因果图：边命中（距线段 ≤ 4px）', () => {
    // 边从 n1(100,100) 到 n2(400,200)，中点 (250,150) 附近
    const hit = hitTestElement(causeEffect, 250, 152)
    expect(hit?.part === 'edge' || hit?.part === 'node').toBe(true)
  })

  it('hitTestBoard 按 z 序返回最上层（数组倒序）', () => {
    const overlap: DecisionTableElement = { ...table, id: 'dt2', x: 50, y: 50 }
    const hit = hitTestBoard([table, overlap], 100, 100)
    expect(hit?.elementId).toBe('dt2')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/hit-test.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hit-test.ts**

`distToSegment`：投影参数 t = clamp(dot(p-a, b-a)/|b-a|², 0, 1)，距离 = |p - (a + t(b-a))|。`hitTestElement`：因果图先按节点局部包围盒（节点宽 160、高 40 的常量 `CE_NODE_W = 160`、`CE_NODE_H = 40`，从 types 导出）测 node，再测每条边（两端节点中心连线，容差 4)，最后测图元整体包围盒 body；其他图元只测包围盒。`hitTestBoard`：for 循环 `elements` 倒序，首个命中即返回。

- [ ] **Step 4: 运行确认通过**

Expected: 5 个用例全 PASS

- [ ] **Step 5: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/hit-test.ts ai-test-tools-site/src/features/requirement-analysis/board/hit-test.test.ts
git commit -m "feat: 白板命中检测（z 序/节点/边）"
```

---

### Task 4: 命令与命令栈（commands.ts + board-store.ts）

**Files:**
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/commands.ts`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/board-store.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/commands.test.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/board-store.test.ts`

**Interfaces:**
- Consumes: `Board`、`BoardElement`（Task 1）
- Produces:
  - `Command = { label: string; do(board: Board): Board; undo(board: Board): Board }`
  - 命令工厂（全部返回 Command，纯函数不可变更新）：`addElement(el: BoardElement)`、`removeElements(ids: string[])`、`moveElements(ids: string[], dx: number, dy: number)`、`updateElement(id: string, updater: (el: BoardElement) => BoardElement)`、`bringToFront(ids: string[])`、`sendToBack(ids: string[])`
  - `BoardStore` 类：`getBoard(): Board`、`execute(cmd: Command): void`、`undo(): boolean`、`redo(): boolean`、`canUndo(): boolean`、`canRedo(): boolean`、`subscribe(listener: () => void): () => void`（变更通知，渲染与自动保存各订阅一份）、栈上限 `COMMAND_STACK_LIMIT = 100`

- [ ] **Step 1: 写失败测试（命令 do/undo 对称 + store 栈行为）**

```ts
// commands.test.ts
import { describe, expect, it } from 'vitest'
import { addElement, bringToFront, moveElements, removeElements, sendToBack, updateElement } from './commands'
import type { Board, DecisionTableElement } from './types'

const dt: DecisionTableElement = {
  id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  conditions: ['c1'], actions: ['a1'], rules: [{ conditionValues: ['Y'], actionValues: [true] }],
}
const dt2: DecisionTableElement = { ...dt, id: 'dt2' }
const base: Board = { version: 1, elements: [dt] }

describe('commands', () => {
  it('addElement do/undo 对称', () => {
    const cmd = addElement(dt2)
    const after = cmd.do(base)
    expect(after.elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
    expect(cmd.undo(after)).toEqual(base)
  })

  it('removeElements do/undo 对称（恢复原位置序）', () => {
    const board: Board = { version: 1, elements: [dt, dt2] }
    const cmd = removeElements(['dt1'])
    const after = cmd.do(board)
    expect(after.elements.map((e) => e.id)).toEqual(['dt2'])
    expect(cmd.undo(after).elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
  })

  it('moveElements 平移世界坐标，undo 还原', () => {
    const cmd = moveElements(['dt1'], 30, -10)
    const after = cmd.do(base)
    expect(after.elements[0]).toMatchObject({ x: 30, y: -10 })
    expect(cmd.undo(after).elements[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('updateElement 更新判定表条件桩', () => {
    const cmd = updateElement('dt1', (el) =>
      el.kind === 'decision-table' ? { ...el, conditions: ['新条件'] } : el)
    const after = cmd.do(base)
    expect((after.elements[0] as DecisionTableElement).conditions).toEqual(['新条件'])
    expect(cmd.undo(after)).toEqual(base)
  })

  it('bringToFront / sendToBack 调整 z 序且可撤销', () => {
    const board: Board = { version: 1, elements: [dt, dt2] }
    const front = bringToFront(['dt1']).do(board)
    expect(front.elements.map((e) => e.id)).toEqual(['dt2', 'dt1'])
    expect(bringToFront(['dt1']).undo(front).elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
    const back = sendToBack(['dt2']).do(board)
    expect(back.elements.map((e) => e.id)).toEqual(['dt2', 'dt1'])
  })
})
```

```ts
// board-store.test.ts
import { describe, expect, it, vi } from 'vitest'
import { BoardStore, COMMAND_STACK_LIMIT } from './board-store'
import { addElement } from './commands'
import type { DecisionTableElement } from './types'

const dt = (id: string): DecisionTableElement => ({
  id, kind: 'decision-table', x: 0, y: 0, w: 100, h: 50, sourceNodeId: null,
  conditions: [], actions: [], rules: [],
})

describe('BoardStore', () => {
  it('execute 应用命令并通知订阅者', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    const listener = vi.fn()
    store.subscribe(listener)
    store.execute(addElement(dt('a')))
    expect(store.getBoard().elements).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('undo/redo 穿越命令栈', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    store.execute(addElement(dt('a')))
    store.execute(addElement(dt('b')))
    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(store.getBoard().elements.map((e) => e.id)).toEqual(['a'])
    store.redo()
    expect(store.getBoard().elements.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('空栈 undo/redo 返回 false', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    expect(store.undo()).toBe(false)
    expect(store.redo()).toBe(false)
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
  })

  it('新命令清空 redo 栈', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    store.execute(addElement(dt('a')))
    store.undo()
    store.execute(addElement(dt('c')))
    expect(store.canRedo()).toBe(false)
  })

  it('栈上限 100：超出后丢弃最旧命令', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    for (let i = 0; i < COMMAND_STACK_LIMIT + 10; i += 1) store.execute(addElement(dt(`e${i}`)))
    let count = 0
    while (store.undo()) count += 1
    expect(count).toBe(COMMAND_STACK_LIMIT)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/commands.test.ts src/features/requirement-analysis/board/board-store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 commands.ts 与 board-store.ts**

commands：每个工厂捕获命令所需快照（如 removeElements 记录被删图元及其索引），do/undo 都返回新 Board（不可变）。board-store：持有 `board`、`undoStack: Command[]`、`redoStack: Command[]`；execute = `board = cmd.do(board)` → push undoStack（溢出 shift）→ 清 redoStack → 通知；undo/redo 对称迁移栈顶并通知。

- [ ] **Step 4: 运行确认通过**

Expected: 10 个用例全 PASS

- [ ] **Step 5: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/commands.ts ai-test-tools-site/src/features/requirement-analysis/board/board-store.ts ai-test-tools-site/src/features/requirement-analysis/board/commands.test.ts ai-test-tools-site/src/features/requirement-analysis/board/board-store.test.ts
git commit -m "feat: 白板命令模式与撤销重做栈"
```

---

### Task 5: 确定性推导——正交表与判定表推导（derive.ts 上半）

**Files:**
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/derive.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/derive.test.ts`

**Interfaces:**
- Consumes: `CauseEffectElement`、`DecisionTableElement`、`OrthogonalFactor`、`BOARD_LIMITS`（Task 1）
- Produces:
  - `selectOrthogonalArray(factors: OrthogonalFactor[]): { name: string; rows: string[][] } | { error: string }`（L4/L8/L9/L16/L18 选型 + 生成；直接构造法 + 水平映射）
  - `deriveDecisionTable(ce: CauseEffectElement): DecisionTableElement | { error: string }`（因果图→判定表；环路/无结果节点报错）
  - `mergeEquivalentRules(table: DecisionTableElement): DecisionTableElement`（合并条件取值与动作完全相同的规则列）

**正交表实现说明（实施者注意）**：内置 L4(2³)、L8(2⁷)、L9(3⁴)、L16(4⁵)、L18(2¹3⁷) 五张标准阵列常量（行 = 测试组合，列 = 因子位）。选型：因子数 ≤ 阵列列数且每因子水平数 ≤ 对应水平上限的最小阵列；`levels.length` 不足阵列水平数时循环复用水平填充（直接构造的常规近似，文档注释说明）；不满足任一阵列返回 `{ error: '因子/水平超出支持范围（≤4 因子、总水平 ≤ 18）' }`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { deriveDecisionTable, mergeEquivalentRules, selectOrthogonalArray } from './derive'
import type { CauseEffectElement, DecisionTableElement } from './types'

describe('selectOrthogonalArray', () => {
  it('2 因子各 2 水平 → L4 全组合（4 行）', () => {
    const result = selectOrthogonalArray([
      { name: '渠道', levels: ['短信', '邮件'] },
      { name: '定时', levels: ['是', '否'] },
    ])
    expect('name' in result && result.name).toContain('L4')
    expect('rows' in result && result.rows).toHaveLength(4)
  })

  it('3 因子各 3 水平 → L9（9 行，每对因子水平组合至少出现一次）', () => {
    const factors = [
      { name: 'A', levels: ['1', '2', '3'] },
      { name: 'B', levels: ['x', 'y', 'z'] },
      { name: 'C', levels: ['p', 'q', 'r'] },
    ]
    const result = selectOrthogonalArray(factors)
    if (!('rows' in result)) throw new Error('应产出阵列')
    expect(result.rows).toHaveLength(9)
    // 两两覆盖校验：任意两列的 (水平, 水平) 组合全集 ⊆ 行集合
    const pairs = new Set(result.rows.map((row) => `${row[0]}|${row[1]}`))
    expect(pairs.size).toBe(9)
  })

  it('超出支持范围返回错误', () => {
    const result = selectOrthogonalArray([
      { name: 'A', levels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'] },
    ])
    expect('error' in result).toBe(true)
  })
})

const ceBase: CauseEffectElement = {
  id: 'ce1', kind: 'cause-effect', x: 0, y: 0, w: 600, h: 400, sourceNodeId: 'n1',
  nodes: [
    { id: 'c1', role: 'cause', text: '字数≤210', x: 0, y: 0 },
    { id: 'c2', role: 'cause', text: '含变量', x: 0, y: 100 },
    { id: 'e1', role: 'effect', text: '按长短信拆分计费', x: 300, y: 50 },
  ],
  edges: [
    { id: 'edge1', from: 'c1', to: 'e1', constraint: 'and' },
    { id: 'edge2', from: 'c2', to: 'e1', constraint: 'and' },
  ],
}

describe('deriveDecisionTable', () => {
  it('and 约束：仅全真时动作发生（规则列枚举原因组合）', () => {
    const result = deriveDecisionTable(ceBase)
    if ('error' in result) throw new Error(result.error)
    expect(result.conditions).toEqual(['字数≤210', '含变量'])
    expect(result.actions).toEqual(['按长短信拆分计费'])
    // and：全 Y 动作 true，其余组合动作 false；规则列覆盖 2^2 枚举
    expect(result.rules).toHaveLength(4)
    const full = result.rules.find((r) => r.conditionValues.every((v) => v === 'Y'))
    expect(full?.actionValues).toEqual([true])
  })

  it('无结果节点返回错误', () => {
    const noEffect: CauseEffectElement = { ...ceBase, nodes: ceBase.nodes.filter((n) => n.role !== 'effect') }
    expect('error' in deriveDecisionTable(noEffect)).toBe(true)
  })

  it('原因链成环返回错误', () => {
    const cyclic: CauseEffectElement = {
      ...ceBase,
      edges: [...ceBase.edges, { id: 'edge3', from: 'e1', to: 'c1', constraint: 'identity' }],
    }
    expect('error' in deriveDecisionTable(cyclic)).toBe(true)
  })
})

describe('mergeEquivalentRules', () => {
  it('条件与动作完全相同的规则列合并为一列', () => {
    const table: DecisionTableElement = {
      id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
      conditions: ['A'], actions: ['X'],
      rules: [
        { conditionValues: ['Y'], actionValues: [true] },
        { conditionValues: ['Y'], actionValues: [true] },
        { conditionValues: ['N'], actionValues: [false] },
      ],
    }
    expect(mergeEquivalentRules(table).rules).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/derive.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 derive.ts（本任务只含 selectOrthogonalArray / deriveDecisionTable / mergeEquivalentRules）**

`deriveDecisionTable` 算法：对每个 effect 节点，DFS 回溯其原因（from→to 反向），检测环路（访问集）；收集全部 cause 节点为条件桩（去重，顺序 = 首次出现）；枚举条件组合的 2^n 笛卡尔积（n = 原因数，n ≤ 8，超出截断并 warning 注释）；对每个组合按约束求值（and：全真；or：任一真；not：取反；identity：原值），动作 = effect 求值结果。`mergeEquivalentRules`：以 `conditionValues.join()+actionValues.join()` 为 key 去重。

- [ ] **Step 4: 运行确认通过**

Expected: 7 个用例全 PASS

- [ ] **Step 5: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/derive.ts ai-test-tools-site/src/features/requirement-analysis/board/derive.test.ts
git commit -m "feat: 正交表选型生成与因果图推导判定表"
```

---

### Task 6: 用例骨架序列化（derive.ts 下半）

**Files:**
- Modify: `ai-test-tools-site/src/features/requirement-analysis/board/derive.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/derive-skeleton.test.ts`

**Interfaces:**
- Consumes: `DecisionTableElement`、`OrthogonalElement`（Task 1）
- Produces: `decisionTableToSkeleton(table: DecisionTableElement): CaseSkeleton[]`、`orthogonalToSkeleton(el: OrthogonalElement): CaseSkeleton[]`、`serializeSkeletons(sourceTitle: string, skeletons: CaseSkeleton[]): string`（Markdown 文本，供接力载荷）、`CaseSkeleton = { source: 'decision-table' | 'orthogonal'; precondition: string; steps: string; expected: string }`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { decisionTableToSkeleton, orthogonalToSkeleton, serializeSkeletons } from './derive'
import type { DecisionTableElement, OrthogonalElement } from './types'

const table: DecisionTableElement = {
  id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  conditions: ['字数≤210', '含变量'],
  actions: ['按长短信拆分计费', '提示拆分规则'],
  rules: [
    { conditionValues: ['Y', 'Y'], actionValues: [true, false] },
    { conditionValues: ['N', '-'], actionValues: [false, false] },
  ],
}

describe('decisionTableToSkeleton', () => {
  it('每列规则 → 一条骨架：Y/N 组合进前置，动作 true 项进预期', () => {
    const skeletons = decisionTableToSkeleton(table)
    expect(skeletons).toHaveLength(2)
    expect(skeletons[0].source).toBe('decision-table')
    expect(skeletons[0].precondition).toContain('字数≤210')
    expect(skeletons[0].precondition).toContain('含变量')
    expect(skeletons[0].expected).toContain('按长短信拆分计费')
    expect(skeletons[0].expected).not.toContain('提示拆分规则')
  })

  it('无关项（-）不出现在前置条件中', () => {
    const skeletons = decisionTableToSkeleton(table)
    expect(skeletons[1].precondition).not.toContain('含变量')
  })
})

const ortho: OrthogonalElement = {
  id: 'o1', kind: 'orthogonal', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  factors: [{ name: '渠道', levels: ['短信', '邮件'] }, { name: '定时', levels: ['是', '否'] }],
  arrayName: 'L4(2^3)',
  rows: [['短信', '是'], ['邮件', '否']],
}

describe('orthogonalToSkeleton', () => {
  it('每行 → 一条组合骨架（因子=水平 键值对）', () => {
    const skeletons = orthogonalToSkeleton(ortho)
    expect(skeletons).toHaveLength(2)
    expect(skeletons[0].precondition).toContain('渠道=短信')
    expect(skeletons[0].precondition).toContain('定时=是')
  })
})

describe('serializeSkeletons', () => {
  it('产出含需求标题与骨架条目的 Markdown 文本', () => {
    const text = serializeSkeletons('调研问卷需求', [
      ...decisionTableToSkeleton(table),
      ...orthogonalToSkeleton(ortho),
    ])
    expect(text).toContain('调研问卷需求')
    expect(text).toContain('判定表')
    expect(text).toContain('正交表')
    expect(text).toContain('前置条件')
    expect(text).toContain('预期')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/derive-skeleton.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现三个骨架函数（追加到 derive.ts）**

前置条件格式：`Y → "条件名成立"`、`N → "条件名不成立"`、`-` 跳过；多条件用 "；`连接。expected：动作 true 项以"、"连接，全 false 时为"无附加动作发生"。`serializeSkeletons` 输出：

```md
## 需求：{sourceTitle}

以下用例骨架由测试设计画布产出，请据此补全为标准用例。

### 判定表规则（共 N 条）
| # | 前置条件 | 步骤 | 预期 |
...

### 正交组合（共 M 条）
| # | 前置条件 | 步骤 | 预期 |
...
```

- [ ] **Step 4: 运行确认通过**

Expected: 4 个用例全 PASS

- [ ] **Step 5: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/derive.ts ai-test-tools-site/src/features/requirement-analysis/board/derive-skeleton.test.ts
git commit -m "feat: 判定表/正交表用例骨架序列化"
```

---

### Task 7: 服务端白板生成接口（board-generate）

**Files:**
- Create: `ai-test-tools-site/server/src/features/requirement/board-prompts.ts`
- Create: `ai-test-tools-site/server/src/features/requirement/board-ai.ts`
- Modify: `ai-test-tools-site/server/src/features/requirement/routes.ts`（注册新路由，约 line 392 `registerAnalysisRecordRoutes` 内）
- Modify: `ai-test-tools-site/server/src/features/requirement/types.ts`（`AnalysisRecord` 增加 `board?: unknown`，透传存储，结构由前端校验）
- Test: `ai-test-tools-site/server/src/features/requirement/board-ai.test.ts`

**Interfaces:**
- Consumes: `collectStream` 模式（`ai.ts` 内私有函数，本任务将 `board-ai.ts` 放同目录复用 `streamChatCompletionParts`）、`parseAiRequestConfig`（`server/src/features/testcase/ai.ts:274`）、`parseMaybeJsonObject`（`server/src/features/testcase/utils.ts`）、`RequirementAnalysisStore`
- Produces:
  - `POST /api/requirement-analysis/records/:id/board/generate`，请求 `{ nodeId, chartKind, provider/ai_config }`，响应 `{ success: true, draft }` / `{ success: false, error }`
  - `generateBoardChartDraft(config: AiRequestConfig, input: { nodeTitle: string; nodeSubtreeText: string; chartKind: BoardChartKind }): Promise<unknown>`（内部：build messages → collectStream 一次性 JSON → parseMaybeJsonObject → 失败修复重试一次 → 仍失败抛 `BoardDraftParseError`）
  - `BoardChartKind = 'cause-effect' | 'decision-table' | 'orthogonal'`
  - `buildBoardChartMessages(input): Array<{ role: 'system' | 'user'; content: string }>`（board-prompts.ts）
  - `findNodeSubtreeText(tree: RequirementNode, nodeId: string): { title: string; text: string } | null`（routes.ts 内辅助：按 id 找节点，拼接其子树全部标题文本）

**Prompt 契约（board-prompts.ts，三种 chartKind 各一份 system prompt 骨架 + 统一 user 包装）**:

- 公共要求：只输出 JSON、坐标 x/y 为 0 起递增的布局建议值（因果图节点给出 x/y，前端只做轻量避让）、文本 ≤ 200 字、节点数 ≤ 60
- `cause-effect`：`{ "nodes": [{ "role": "cause|intermediate|effect", "text": "..." }], "edges": [{ "from": <index>, "to": <index>, "constraint": "and|or|not|identity" }] }`
- `decision-table`：`{ "conditions": [...], "actions": [...], "rules": [{ "conditionValues": ["Y|N|-"], "actionValues": [bool] }] }`
- `orthogonal`：`{ "factors": [{ "name": "...", "levels": [...] }] }`（阵列由前端算法生成，AI 只提取因子水平）

- [ ] **Step 1: 写失败测试（契约解析与重试）**

```ts
// board-ai.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../testcase/ai.js', async () => {
  const actual = await vi.importActual<typeof import('../testcase/ai.js')>('../testcase/ai.js')
  return { ...actual, streamChatCompletionParts: vi.fn() }
})

import { streamChatCompletionParts } from '../testcase/ai.js'
import { generateBoardChartDraft, BoardDraftParseError } from './board-ai.js'
import type { AiRequestConfig } from '../testcase/types.js'

const config = { endpointType: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' } as unknown as AiRequestConfig
const input = { nodeTitle: '第4步-分发问卷', nodeSubtreeText: '短信≤210字+变量……', chartKind: 'cause-effect' as const }

function mockStream(outputs: string[]) {
  let call = 0
  vi.mocked(streamChatCompletionParts).mockImplementation(async function* () {
    const text = outputs[Math.min(call, outputs.length - 1)]
    call += 1
    yield { type: 'content' as const, text }
  })
}

describe('generateBoardChartDraft', () => {
  it('一次成功：解析 content 片段为 JSON draft', async () => {
    mockStream(['{"nodes":[{"role":"cause","text":"A"}],"edges":[]}'])
    const draft = await generateBoardChartDraft(config, input)
    expect(draft).toMatchObject({ nodes: [{ role: 'cause', text: 'A' }] })
  })

  it('首次输出非 JSON → 修复重试一次后成功', async () => {
    mockStream(['无法解析的垃圾', '{"nodes":[],"edges":[]}'])
    const draft = await generateBoardChartDraft(config, input)
    expect(draft).toMatchObject({ nodes: [] })
    expect(vi.mocked(streamChatCompletionParts)).toHaveBeenCalledTimes(2)
  })

  it('两次都失败 → 抛 BoardDraftParseError', async () => {
    mockStream(['垃圾1', '垃圾2'])
    await expect(generateBoardChartDraft(config, input)).rejects.toBeInstanceOf(BoardDraftParseError)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run server/src/features/requirement/board-ai.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 board-prompts.ts 与 board-ai.ts（沿用 ai.ts 的 collectStream / REPAIR 模式）**

`generateBoardChartDraft` 内联一份 `collectStream` 调用（`streamChatCompletionParts(config, { messages, temperature: 0.2, maxTokens: 8192, responseJson: true })`，累积 content 片段），失败时携带上次输出 + 修复指令重试一次。

- [ ] **Step 4: 运行确认通过**

Expected: 3 个用例全 PASS

- [ ] **Step 5: 注册路由（routes.ts）+ types.ts 增加 board 字段**

在 `registerAnalysisRecordRoutes` 内追加：

```ts
app.post("/api/requirement-analysis/records/:id/board/generate", (req, res) => {
  void (async () => {
    try {
      const record = store.getRecord(req.params.id);
      if (!record) {
        res.status(404).json({ success: false, error: RECORD_NOT_FOUND_ERROR });
        return;
      }
      const data: JsonObject = isObject(req.body) ? req.body : {};
      const chartKind = text(data.chartKind).trim();
      if (chartKind !== "cause-effect" && chartKind !== "decision-table" && chartKind !== "orthogonal") {
        res.status(400).json({ success: false, error: "无效的图表类型（chartKind）。" });
        return;
      }
      const found = findNodeSubtreeText(record.tree, text(data.nodeId));
      if (!found) {
        res.status(400).json({ success: false, error: "需求分解树中不存在该节点（nodeId）。" });
        return;
      }
      const config = parseAiRequestConfig(resolveAiConfigSource(req));
      const draft = await generateBoardChartDraft(config, { nodeTitle: found.title, nodeSubtreeText: found.text, chartKind });
      res.json({ success: true, draft });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  })();
});
```

`types.ts` 的 `AnalysisRecord` 追加 `board?: unknown;`（服务端不透知结构，前端 `deserializeBoard` 校验）；routes.ts PATCH 处理追加：`if (data.board !== undefined) patch.board = data.board`（patch 类型放宽为 `Partial<Pick<AnalysisRecord, "name" | "chartType" | "board">>`）。

- [ ] **Step 6: 全量服务端测试 + Commit**

Run: `cd ai-test-tools-site && npx vitest run server/src/features/requirement/`
Expected: 全绿（含既有测试）

```bash
git add ai-test-tools-site/server/src/features/requirement/
git commit -m "feat: 服务端白板图表 AI 生成接口与记录 board 字段"
```

---

### Task 8: 前端 API 层扩展（generate + board 字段）

**Files:**
- Modify: `ai-test-tools-site/src/lib/requirement-analysis-api.ts`
- Test: `ai-test-tools-site/src/lib/requirement-analysis-api.test.ts`（在现有文件追加用例）

**Interfaces:**
- Consumes: `parseRecordResponse`、`buildUrl`（现有）
- Produces:
  - `BoardChartKind = 'cause-effect' | 'decision-table' | 'orthogonal'`
  - `generateBoardChart(recordId: string, args: { nodeId: string; chartKind: BoardChartKind }, aiConfig: RuntimeAiConfig): Promise<unknown>`（POST，provider 放 body，与 analyze 的 `resolveAiConfigSource` 对齐）
  - `AnalysisRecord` 增加 `board?: unknown`
  - `UpdateAnalysisRecordInput` 增加 `board?: unknown`

- [ ] **Step 1: 写失败测试（fetch mock）**

```ts
// 追加到 requirement-analysis-api.test.ts
it('generateBoardChart POST 到 records/:id/board/generate 并返回 draft', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, draft: { nodes: [], edges: [] } }),
  })
  vi.stubGlobal('fetch', fetchMock)
  const { generateBoardChart } = await import('./requirement-analysis-api')
  const draft = await generateBoardChart('rec_1', { nodeId: 'n1', chartKind: 'cause-effect' }, aiConfig)
  expect(draft).toEqual({ nodes: [], edges: [] })
  const [url, init] = fetchMock.mock.calls[0]
  expect(String(url)).toContain('/api/requirement-analysis/records/rec_1/board/generate')
  expect(init.method).toBe('POST')
  vi.unstubAllGlobals()
})

it('updateAnalysisRecord 支持 board 字段透传', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, record: { id: 'rec_1' } }),
  })
  vi.stubGlobal('fetch', fetchMock)
  const { updateAnalysisRecord } = await import('./requirement-analysis-api')
  await updateAnalysisRecord('rec_1', { board: { version: 1, elements: [] } })
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.board).toEqual({ version: 1, elements: [] })
  vi.unstubAllGlobals()
})
```

注：参考现有测试文件顶部 aiConfig fixture 写法复用。

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/lib/requirement-analysis-api.test.ts`
Expected: FAIL（新增用例）

- [ ] **Step 3: 实现 API 扩展**

```ts
export type BoardChartKind = 'cause-effect' | 'decision-table' | 'orthogonal'

/** POST /api/requirement-analysis/records/:id/board/generate（AI 生成图表草稿，一次性 JSON）。 */
export async function generateBoardChart(
  recordId: string,
  args: { nodeId: string; chartKind: BoardChartKind },
  aiConfig: RuntimeAiConfig,
): Promise<unknown> {
  const response = await fetch(buildUrl(`/api/requirement-analysis/records/${encodeURIComponent(recordId)}/board/generate`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: args.nodeId, chartKind: args.chartKind, ai_config: aiConfig }),
  })
  const data = await parseRecordResponse<{ draft: unknown }>(response, '生成图表草稿失败')
  return data.draft
}
```

`AnalysisRecord` 与 `UpdateAnalysisRecordInput` 各加 `board?: unknown`。

- [ ] **Step 4: 运行确认通过 + Commit**

```bash
git add ai-test-tools-site/src/lib/requirement-analysis-api.ts ai-test-tools-site/src/lib/requirement-analysis-api.test.ts
git commit -m "feat: 前端白板生成 API 与记录 board 字段类型"
```

---

### Task 9: 渲染器（renderer.ts）与图元绘制（elements/）

**Files:**
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/renderer.ts`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/elements/mindmap-ref.ts`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/elements/cause-effect.ts`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/elements/decision-table.ts`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/elements/orthogonal.ts`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/elements/layout.ts`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/renderer.test.ts`（只测布局/尺寸推导纯函数，不测像素）

**Interfaces:**
- Consumes: `Board`、`BoardElement`（Task 1）、`Viewport`（Task 2）
- Produces:
  - `renderBoard(canvas: HTMLCanvasElement, board: Board, vp: Viewport, selection: ReadonlySet<string>): void`（DPR 适配 + 清屏 + 逐图元绘制 + 选中框；按需调用，不自旋）
  - `layoutMindmap(tree: RequirementNode): Array<{ id: string; title: string; x: number; y: number; depth: number }>`（elements/layout.ts： tidy 树简化版——按深度分列，叶节点均分行，父节点居子节点中；单测可验）
  - `measureDecisionTable(el: DecisionTableElement): { w: number; h: number }`、`measureOrthogonal(el: OrthogonalElement): { w: number; h: number }`（行高 28 × 行数 + 表头；列宽取各列最长文本 × 字宽系数，上限 240）
  - `CE_NODE_W = 160`、`CE_NODE_H = 40`（从 types.ts 导出，hit-test 与渲染共用）
  - 各元素文件导出 `drawXxx(ctx: CanvasRenderingContext2D, el, vp, selected: boolean): void`

**绘制要点（实施者注意）**:
- `renderBoard`：`ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -vp.x * dpr * zoom, -vp.y * dpr * zoom)`，之后全部用世界坐标绘制；canvas 宽高 = CSS 尺寸 × dpr
- 图元统一白卡底（圆角 12、边框 `--color-border` 同色系、轻投影）；选中时外描 2px accent 框
- 因果图：节点 = 角色区分色（cause 白底蓝边 / intermediate 灰底 / effect 白底红边）圆角矩形 + 居中文字；边 = 折线 + 末端箭头 + 中点约束符号（∧∨¬，identity 无符号）
- 判定表/正交表：网格线 + 表头底色 + 单元格文字（`fillText`，超长截断加 …）
- 需求树参考图：灰白底卡 + `layoutMindmap` 布局的节点连线（只读视觉，选中节点高亮 accent 边框）

- [ ] **Step 1: 写失败测试（布局与尺寸纯函数）**

```ts
// renderer.test.ts
import { describe, expect, it } from 'vitest'
import { layoutMindmap } from './elements/layout'
import { measureDecisionTable, measureOrthogonal } from './elements/measure'

describe('layoutMindmap', () => {
  it('按深度分列、父节点纵向居中于子节点', () => {
    const layout = layoutMindmap({
      id: 'r', title: '根', children: [
        { id: 'a', title: 'A', children: [
          { id: 'a1', title: 'A1', children: [] },
          { id: 'a2', title: 'A2', children: [] },
        ] },
        { id: 'b', title: 'B', children: [] },
      ],
    })
    const byId = new Map(layout.map((n) => [n.id, n]))
    expect(byId.get('r')!.x).toBe(0)
    expect(byId.get('a')!.x).toBeGreaterThan(byId.get('r')!.x)
    expect(byId.get('a1')!.x).toBeGreaterThan(byId.get('a')!.x)
    expect(byId.get('a')!.y).toBeCloseTo((byId.get('a1')!.y + byId.get('a2')!.y) / 2)
  })
})

describe('measure', () => {
  it('判定表尺寸 = 行数 × 行高 + 表头，含规则列宽', () => {
    const size = measureDecisionTable({
      id: 'dt', kind: 'decision-table', x: 0, y: 0, w: 0, h: 0, sourceNodeId: null,
      conditions: ['c1', 'c2'], actions: ['a1'],
      rules: [{ conditionValues: ['Y', 'N'], actionValues: [true] }],
    })
    expect(size.h).toBeGreaterThan(0)
    expect(size.w).toBeGreaterThan(0)
  })

  it('正交表尺寸随行列增长', () => {
    const small = measureOrthogonal({
      id: 'o', kind: 'orthogonal', x: 0, y: 0, w: 0, h: 0, sourceNodeId: null,
      factors: [{ name: 'A', levels: ['1', '2'] }], arrayName: 'L4', rows: [['1'], ['2']],
    })
    const big = measureOrthogonal({
      id: 'o', kind: 'orthogonal', x: 0, y: 0, w: 0, h: 0, sourceNodeId: null,
      factors: [{ name: 'A', levels: ['1', '2'] }], arrayName: 'L4',
      rows: [['1'], ['2'], ['1'], ['2'], ['1'], ['2']],
    })
    expect(big.h).toBeGreaterThan(small.h)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd ai-test-tools-site && npx vitest run src/features/requirement-analysis/board/renderer.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 layout/measure 纯函数 + 四个绘制文件 + renderer.ts**

measure 函数放 `elements/measure.ts`（测试 import 路径以此为准）。绘制文件无单测（人工验收），但函数签名按 Interfaces 对齐。

- [ ] **Step 4: 运行确认通过**

Expected: 3 个用例全 PASS

- [ ] **Step 5: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/
git commit -m "feat: 白板 Canvas 渲染器与四类图元绘制"
```

---

### Task 10: BoardCanvas 组件（交互装配：视口/选中/拖拽/文本编辑/浮动工具条）

**Files:**
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/BoardCanvas.tsx`
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/BoardToolbar.tsx`（浮动工具条）
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/TextEditOverlay.tsx`
- Test: `ai-test-tools-site/src/features/requirement-analysis/board/BoardCanvas.test.tsx`

**Interfaces:**
- Consumes: `BoardStore`（Task 4）、`renderBoard`（Task 9）、viewport/hit-test（Task 2/3）、`Tooltip`（`src/components/ui/Tooltip.tsx`）
- Produces:
  - `<BoardCanvas store={BoardStore} mindmapTree={RequirementNode} onRequestInsert={...} generating={...} />`（具体 props 见实现：store、需求树（渲染 mindmap-ref 用）、`onFit` 回调 ref、缩放比例变化回调 `onZoomChange(ratio: number)`）
  - 缩放句柄：`BoardCanvasHandle = { zoomBy(factor: number): void; fit(): void }`（forwardRef + useImperativeHandle，供 AnalysisBoard 缩放条复用，对齐现有 ChartCanvasHandle 模式）
  - 文本编辑态：`EditingTarget = { elementId: string; field: 'node-text' | 'cell' | 'factor' | 'level'; path: string[] } | null`

**交互实现要点**:
- wheel：按 `Math.exp(-deltaY * 0.001)` 因子 `zoomAt`；空格/中键拖动平移；V 切选择/手型
- pointerdown 命中图元 → 选中（Shift 多选）并开始拖拽（pointer capture）；命中空白 → 框选（选框与图元包围盒相交）
- dblclick 命中可编辑部位 → `TextEditOverlay`（绝对定位 input，样式随视口换算）；提交走 `updateElement` 命令
- Del/Backspace 删选中；Ctrl+Z / Ctrl+Shift+Z；Ctrl+A 全选；Ctrl+C/V 图元复制（新 id、偏移 +24）
- `store.subscribe` → `renderBoard` 重绘（`requestAnimationFrame` 合帧一次）
- 浮动工具条 `BoardToolbar`：跟随选中集包围盒上沿（世界→屏幕换算），按 kind 装配按钮；本任务只接通用键（置顶/置底/复制/删除）+ 三件套键（推导判定表/重新生成阵列/编辑因子——先触发回调，逻辑 Task 11 接）

- [ ] **Step 1: 写失败测试（jsdom + mock renderer）**

沿用 AnalysisBoard.test.tsx 的 stub 套路：`vi.mock('./renderer', ...)` 暴露 `renderBoard` spy。用例：
1. 渲染 canvas 元素并调用 renderBoard（初始 + store 变更后）
2. Ctrl+Z 触发 store.undo（构造带一条命令的 store）
3. Del 删除选中图元（store 内元素减少）
4. 双击图元 → overlay input 出现 → 输入提交后 store 文本更新
5. V 键切换选择/手型（canvas cursor 样式变化）

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 确认通过 → Step 5: Commit**

```bash
git add ai-test-tools-site/src/features/requirement-analysis/board/
git commit -m "feat: BoardCanvas 交互装配（视口/选中/拖拽/编辑/工具条）"
```

---

### Task 11: AnalysisBoard 壳改造（接入 BoardCanvas + AI 生成 + 推导 + 接力）

**Files:**
- Modify: `ai-test-tools-site/src/features/requirement-analysis/AnalysisBoard.tsx`（重写中央区）
- Modify: `ai-test-tools-site/src/pages/AnalysisBoardPage.tsx`（board 加载/保存/AI 生成调用）
- Create: `ai-test-tools-site/src/features/requirement-analysis/board/useBoardPersistence.ts`（防抖自动保存 hook）
- Test: `ai-test-tools-site/src/features/requirement-analysis/AnalysisBoard.test.tsx`（重写）
- Test: `ai-test-tools-site/src/pages/AnalysisBoardPage.test.tsx`（更新）

**Interfaces:**
- Consumes: 全部前序任务；`generateBoardChart`/`updateAnalysisRecord`（Task 8）；`loadStoredModelConfig`/`getPreferredAiConfig`（`src/lib/model-config-store.ts` + `src/shared/api-types.ts`，对齐 RequirementAnalysisPage 用法）
- Produces:
  - AnalysisBoard 新 props：`recordName`、`recordId`、`result`、`board: Board`、`onBoardChange(board: Board): void`、`onHandoff`、`onExportFile`、`onExportError`、`error`
  - `useBoardPersistence(recordId: string, board: Board): { saveError: boolean }`（board 引用变化 → 防抖 1.5s → `updateAnalysisRecord(recordId, { board: serializeBoard 后的对象 })`；失败置 saveError，下一次变更或 10s 后重试）
  - AnalysisBoardPage：拉记录后 `deserializeBoard(record.board)`，null/缺失 → 建空白板并自动放入需求树参考图元（`buildMindmapRefElement(result.tree)`，x=40,y=40）
  - 插入流程：左栏插入按钮（未选中节点禁用 + Tooltip"先在需求树中选择一个节点"）→ 占位图元（`kind` 同目标图表、nodes/rows 空 + `pending: true` 视觉骨架，以普通图元 + 灰闪烁样式呈现，不入命令栈）→ `generateBoardChart` → 成功则 `draftToElement(draft, chartKind, sourceNodeId)`（board/ai.ts，校验 + id 分配）→ `addElement` 命令替换占位；失败 → 占位换错误卡片样式（重试/删除按钮，浮动工具条形态）

**壳改造要点**:
- 删除：顶部中央图表类型菜单（`chartSelect`）、`chartType`/`onChartTypeChange` props、缩放条的 ChartCanvasHandle 调用（改为 BoardCanvasHandle）、`findingCounts` prop 与 mindmap/tree/logic 三分支渲染
- 保留：左上胶囊（返回/记录名/导出菜单）、右上生成用例、左栏（选择/手型 + 插入三件套 + 插入模板 + 收缩）、右下缩放条（±20% 步进/fit，接 BoardCanvasHandle）、警告/错误横幅、模板中心弹窗
- 导出 PNG：改为 `renderBoard` 离屏 canvas 导出（对全部图元包围盒 fit 后绘制到临时 canvas → `toDataURL`）
- 用例接力（AnalysisBoardPage.handleHandoff）：收集 board 中全部判定表/正交表 → `decisionTableToSkeleton`/`orthogonalToSkeleton` → `serializeSkeletons` → 骨架为空时退化为现状（仅 sourceText+title 载荷），非空时载荷 requirement = `sourceText + '\n\n' + skeletonText`

- [ ] **Step 1: 写失败测试（壳装配 + 持久化 hook）**

AnalysisBoard.test.tsx 重写用例（mock BoardCanvas 为 stub）：
1. 渲染胶囊/插入三件套/缩放条/生成用例按钮
2. 未选中需求节点时插入按钮禁用
3. 占位图元→生成失败→错误卡片（mock generateBoardChart reject）
4. 保存失败横幅出现（mock updateAnalysisRecord reject）
5. ESC 触发 onBack

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 确认通过**

- [ ] **Step 5: 全量测试 + lint 基线检查**

Run: `cd ai-test-tools-site && npm run test 2>&1 | tail -4 && npm run lint 2>&1 | tail -2`
Expected: 测试全绿；lint 错误 ≤ 48

- [ ] **Step 6: Commit**

```bash
git add ai-test-tools-site/src/
git commit -m "feat: 分析画板接入测试设计白板（生成/推导/接力/持久化）"
```

---

### Task 12: 旧代码退役（MindMapView/TreeChartView/chart-tabs/相关样式）

**Files:**
- Delete: `ai-test-tools-site/src/features/requirement-analysis/MindMapView.tsx`
- Delete: `ai-test-tools-site/src/features/requirement-analysis/TreeChartView.tsx`
- Delete: `ai-test-tools-site/src/features/requirement-analysis/chart-tabs.ts`
- Delete: `ai-test-tools-site/src/features/requirement-analysis/canvas-zoom.ts` + `canvas-zoom.test.ts`（缩放改由 viewport.ts 承担；先全库搜索确认无残留引用后删）
- Modify: `ai-test-tools-site/src/index.css`（删 `.requirement-chart-*` / `.requirement-canvas-*` 等无引用样式，逐段 grep 确认）
- Modify: `ai-test-tools-site/src/pages/AnalysisBoardPage.tsx` / `RequirementAnalysisPage.tsx`（清理 chartType 相关残留 import）

**Interfaces:**
- Consumes: Task 11 完成态
- Produces: 无新接口；全库 grep `MindMapView|TreeChartView|chart-tabs|REQUIREMENT_CHART_TABS|canvas-zoom|ChartCanvasHandle` 必须零引用

- [ ] **Step 1: grep 确认引用清单**

Run: `cd ai-test-tools-site && grep -rn "MindMapView\|TreeChartView\|chart-tabs\|REQUIREMENT_CHART_TABS\|canvas-zoom\|ChartCanvasHandle" src/ --include="*.ts*" -l`
Expected: 仅待删文件自身与 index.css 注释

- [ ] **Step 2: 删除文件并清理 index.css / import**

- [ ] **Step 3: 全量测试 + build**

Run: `cd ai-test-tools-site && npm run test 2>&1 | tail -4 && npm run build 2>&1 | tail -3`
Expected: 全绿 + 构建成功（tsc 会抓住任何残留引用）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: 退役单图表渲染链路（MindMapView/TreeChartView/chart-tabs）"
```

---

### Task 13: 文档收尾（ADR 0007 + CONTEXT.md）

**Files:**
- Create: `docs/adr/0007-analysis-board-becomes-test-design-canvas.md`
- Modify: `docs/adr/0006-analysis-board-dedicated-route.md`（顶部加修订链接）
- Modify: `CONTEXT.md`（更新「分析画板」词条；新增「测试设计画布」「因果图」「判定表」「正交表」「用例骨架」词条）

**ADR 0007 要点**:
- 背景：0005/0006 落地只读画板后，用户对标 boardmix 要求工作台化；测试用例设计方法（黑盒三件套）需要形式化图表载体
- 决策：自由白板 Canvas 2D 全量渲染；模型/渲染分离 + 命令栈；AI 全自动生成草稿（选中节点上下文）；因果图→判定表→用例骨架确定性推导；接力复用现有 AI 用例管线；board 持久化到分析记录
- 备选：SVG/DOM 渲染（交互白送但用户明确选 Canvas）、多页签/分区画布（被自由白板否决）、用例骨架直接落库（首期走接力）
- 后果：MindMapView/TreeChartView 退役；记录 schema 增 board 字段；二期候选（状态迁移图/覆盖率追溯等）记录在 spec §11

**CONTEXT.md 词条更新**:
- 「分析画板」改为指向「测试设计画布」（保留路由与两层结构语义）
- 新增词条（每个 2-4 句，对齐现有词条风格）：测试设计画布、因果图、判定表、正交表、用例骨架

- [ ] **Step 1: 写 ADR 0007 + 修订 0006 顶部**

0006 顶部加：`> 本文已被 [0007](0007-analysis-board-becomes-test-design-canvas.md) 修订：画板从只读阅览进化为可编辑测试设计画布。`

- [ ] **Step 2: 更新 CONTEXT.md 词条**

- [ ] **Step 3: Commit**

```bash
git add docs/ CONTEXT.md
git commit -m "docs: ADR 0007 与测试设计画布术语"
```

---

### Task 14: 端到端验证（浏览器走查）

**Files:** 无（人工验收）

- [ ] **Step 1: 全量质量门**

Run: `cd ai-test-tools-site && npm run test 2>&1 | tail -4 && npm run lint 2>&1 | tail -2 && npm run build 2>&1 | tail -3`
Expected: 测试全绿；lint ≤ 48；build 成功

- [ ] **Step 2: 浏览器走查清单（npm run server + npm run dev）**

1. 打开记录 → 白板加载，需求树参考图元自动 fit
2. 选中需求节点 → 插入因果图 → AI 草稿落板；未选中时插入按钮禁用
3. 因果图浮动工具条 → 推导判定表 → 新图元出现且可拖动
4. 判定表 → 转骨架 → 接力跳转 testcase 弹窗预填含骨架文本
5. 双击文本编辑 / 拖拽 / 框选 / Ctrl+Z / Del / 缩放锚点 / DPR 清晰度
6. 刷新页面 → 白板布局与内容完整恢复（持久化）
7. 断网生成 → 错误卡片可重试可删除

- [ ] **Step 3: 最终 Commit（如有走查修复）**

---

## Self-Review 记录

- **Spec 覆盖**：§3 架构（T9/10/11）、§4 图元模型（T1）、§5 数据流（T5/6/7/8/11）、§6 交互（T10/11）、§7 错误处理（T7 修复重试、T11 错误卡片/保存横幅、T5 推导报错、T1 上限常量）、§8 测试策略（每任务内嵌）、§9 API 变更（T7/8）、§10 影响面（T11/12/13）——全覆盖。
- **Placeholder 扫描**：无 TBD/TODO；所有测试代码为完整可复制内容（T10/11 组件测试因涉及 mock 结构以要点形式给出用例清单，实现者沿用 AnalysisBoard.test.tsx 既有 stub 套路）。
- **类型一致性**：`BoardChartKind` 在 T7（服务端）、T8（前端 lib）同名同值；`BoardCanvasHandle` 与现有 `ChartCanvasHandle` 模式对齐；`draftToElement` 在 T11 定义于 `board/ai.ts`（前端，注意与服务端 `board-ai.ts` 命名区分）。
