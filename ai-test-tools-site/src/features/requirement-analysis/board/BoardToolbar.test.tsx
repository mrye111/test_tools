import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BoardToolbar } from './BoardToolbar'
import { BoardStore } from './board-store'
import type { Board, BoardElement } from './types'

const viewport = { x: 0, y: 0, zoom: 1 }

function makeStore(elements: BoardElement[]) {
  return new BoardStore({ version: 1, elements })
}

function renderToolbar(board: Board, selection: Set<string>) {
  const store = makeStore(board.elements)
  const onAction = vi.fn()
  const onCopy = vi.fn()
  render(
    <BoardToolbar
      store={store}
      board={board}
      viewport={viewport}
      selection={selection}
      onAction={onAction}
      onCopy={onCopy}
    />,
  )
  return { onAction, onCopy }
}

const ce: BoardElement = {
  id: 'ce1',
  kind: 'cause-effect',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  sourceNodeId: null,
  nodes: [{ id: 'n1', role: 'cause', text: '原因', x: 0, y: 0 }],
  edges: [],
}

const dt: BoardElement = {
  id: 'dt1',
  kind: 'decision-table',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  sourceNodeId: null,
  conditions: [],
  actions: [],
  rules: [],
}

const ortho: BoardElement = {
  id: 'o1',
  kind: 'orthogonal',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  sourceNodeId: null,
  factors: [],
  arrayName: '',
  rows: [],
}

const mindmapRef: BoardElement = {
  id: 'mm1',
  kind: 'mindmap-ref',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  sourceNodeId: null,
  selectedNodeId: null,
}

describe('BoardToolbar 按选中图元类型装配动作', () => {
  it('mindmap-ref 只显示通用键，不显示三件套', () => {
    renderToolbar({ version: 1, elements: [mindmapRef] }, new Set(['mm1']))
    expect(screen.getByRole('button', { name: '置顶' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '推导判定表' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新生成阵列' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑因子' })).not.toBeInTheDocument()
  })

  it('因果图只显示推导判定表', () => {
    renderToolbar({ version: 1, elements: [ce] }, new Set(['ce1']))
    expect(screen.getByRole('button', { name: '推导判定表' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新生成阵列' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑因子' })).not.toBeInTheDocument()
  })

  it('判定表显示重新生成阵列和编辑因子', () => {
    renderToolbar({ version: 1, elements: [dt] }, new Set(['dt1']))
    expect(screen.queryByRole('button', { name: '推导判定表' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成阵列' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑因子' })).toBeInTheDocument()
  })

  it('正交表只显示编辑因子', () => {
    renderToolbar({ version: 1, elements: [ortho] }, new Set(['o1']))
    expect(screen.queryByRole('button', { name: '推导判定表' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新生成阵列' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑因子' })).toBeInTheDocument()
  })

  it('多类型同时选中只显示通用键', () => {
    renderToolbar({ version: 1, elements: [ce, dt] }, new Set(['ce1', 'dt1']))
    expect(screen.queryByRole('button', { name: '推导判定表' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新生成阵列' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑因子' })).not.toBeInTheDocument()
  })
})
