import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Board, CauseEffectElement } from './types'
import type { RequirementNode } from '../../lib/requirement-analysis-api'
import { BoardStore } from './board-store'
import { addElement } from './commands'
import { BoardCanvas, type BoardCanvasHandle } from './BoardCanvas'

const stub = vi.hoisted(() => ({
  renderBoard: vi.fn(),
}))

vi.mock('./renderer', () => ({
  renderBoard: stub.renderBoard,
}))

const tree: RequirementNode = { id: 'root', title: '需求', children: [] }

function ceElement(id: string, x = 0, y = 0, text = '节点'): CauseEffectElement {
  return {
    id,
    kind: 'cause-effect',
    x,
    y,
    w: 200,
    h: 120,
    sourceNodeId: null,
    nodes: [{ id: `${id}-n1`, role: 'cause', text, x: 50, y: 30 }],
    edges: [],
  }
}

function makeStore(board: Board) {
  return new BoardStore(board)
}

function mockRect(element: Element) {
  return vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => {},
  })
}

function renderCanvas(store: BoardStore) {
  const handleRef = { current: null as BoardCanvasHandle | null }
  const onZoomChange = vi.fn()
  const onSelectionChange = vi.fn()
  const result = render(
    <BoardCanvas
      ref={(ref) => (handleRef.current = ref)}
      store={store}
      tree={tree}
      onZoomChange={onZoomChange}
      onSelectionChange={onSelectionChange}
    />,
  )
  return { ...result, handleRef, onZoomChange, onSelectionChange, store }
}

describe('BoardCanvas 交互', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染 canvas 并调用 renderBoard（初始 + store 变更后）', async () => {
    const store = makeStore({ version: 1, elements: [ceElement('e1')] })
    const { container } = renderCanvas(store)
    const canvas = container.querySelector('canvas')
    expect(canvas).toBeInTheDocument()
    await waitFor(() => {
      expect(stub.renderBoard).toHaveBeenCalled()
    })

    act(() => store.execute(addElement(ceElement('e2', 300, 0, '节点2'))))
    await waitFor(() => {
      expect(stub.renderBoard).toHaveBeenCalledTimes(2)
    })
  })

  it('Ctrl+Z 触发 store.undo', async () => {
    const store = makeStore({ version: 1, elements: [] })
    store.execute(addElement(ceElement('e1')))
    expect(store.getBoard().elements).toHaveLength(1)
    renderCanvas(store)
    await waitFor(() => expect(stub.renderBoard).toHaveBeenCalled())

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(store.getBoard().elements).toHaveLength(0)
  })

  it('Del 删除选中图元', async () => {
    const store = makeStore({ version: 1, elements: [ceElement('e1'), ceElement('e2', 300)] })
    const { container } = renderCanvas(store)
    await waitFor(() => expect(stub.renderBoard).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!
    mockRect(canvas)

    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 30 })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(store.getBoard().elements).toHaveLength(1)
    expect(store.getBoard().elements[0].id).toBe('e2')
  })

  it('双击图元 → overlay input 出现 → 提交后 store 文本更新', async () => {
    const el = ceElement('e1', 0, 0, '旧文本')
    const store = makeStore({ version: 1, elements: [el] })
    const { container } = renderCanvas(store)
    await waitFor(() => expect(stub.renderBoard).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!
    mockRect(canvas)

    fireEvent.doubleClick(canvas, { clientX: 50, clientY: 30 })
    const input = await screen.findByRole('textbox')
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '新文本' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      const updated = store.getBoard().elements[0] as CauseEffectElement
      expect(updated.nodes[0].text).toBe('新文本')
    })
  })

  it('V 键切换选择/手型（canvas cursor 样式变化）', async () => {
    const store = makeStore({ version: 1, elements: [] })
    const { container } = renderCanvas(store)
    await waitFor(() => expect(stub.renderBoard).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!

    expect(canvas).toHaveStyle({ cursor: 'default' })
    fireEvent.keyDown(window, { key: 'v' })
    expect(canvas).toHaveStyle({ cursor: 'grab' })
    fireEvent.keyDown(window, { key: 'v' })
    expect(canvas).toHaveStyle({ cursor: 'default' })
  })

  it('空白处拖拽框选出现选框 DOM 并在 pointerup 后消失', async () => {
    const store = makeStore({ version: 1, elements: [ceElement('e1', 0, 0), ceElement('e2', 300, 0)] })
    const { container } = renderCanvas(store)
    await waitFor(() => expect(stub.renderBoard).toHaveBeenCalled())
    const canvas = container.querySelector('canvas')!
    mockRect(canvas)

    expect(screen.queryByTestId('board-marquee')).not.toBeInTheDocument()
    fireEvent.pointerDown(canvas, { clientX: 600, clientY: 300 })
    fireEvent.pointerMove(canvas, { clientX: 700, clientY: 400 })
    await waitFor(() => {
      expect(screen.getByTestId('board-marquee')).toBeInTheDocument()
    })
    fireEvent.pointerUp(canvas)
    await waitFor(() => {
      expect(screen.queryByTestId('board-marquee')).not.toBeInTheDocument()
    })
  })
})
