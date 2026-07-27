import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Finding, RequirementNode } from '../../lib/requirement-analysis-api'
import type { ChartCanvasHandle } from './MindMapView'
import { ChartCanvasModal } from './ChartCanvasModal'

// 重型渲染器（markmap / echarts）在 jsdom 中不可用，mock 为轻量 stub；
// 通过 hoisted 的 handle / props 观察画布对缩放控制句柄的调用。
const stub = vi.hoisted(() => ({
  mindmapHandle: {
    getPngDataUrl: vi.fn<() => Promise<string | null>>(),
    zoomBy: vi.fn<(factor: number) => void>(),
    fit: vi.fn<() => Promise<void>>(),
  },
  treeHandle: {
    getPngDataUrl: vi.fn<() => Promise<string | null>>(),
    zoomBy: vi.fn<(factor: number) => void>(),
    fit: vi.fn<() => Promise<void>>(),
  },
  mindmapProps: { current: null as { onZoomScaleChange?: (ratio: number) => void } | null },
  treeProps: { current: null as { onZoomScaleChange?: (ratio: number) => void } | null },
  downloadDataUrl: vi.fn(),
}))

vi.mock('./MindMapView', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react')
  return {
    MindMapView: forwardRef<ChartCanvasHandle, { onZoomScaleChange?: (ratio: number) => void }>(
      function MindMapViewStub(props, ref) {
        stub.mindmapProps.current = props
        useImperativeHandle(ref, () => stub.mindmapHandle)
        return createElement('svg', { 'data-testid': 'mindmap-stub' })
      },
    ),
  }
})

vi.mock('./TreeChartView', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react')
  return {
    TreeChartView: forwardRef<ChartCanvasHandle, { onZoomScaleChange?: (ratio: number) => void }>(
      function TreeChartViewStub(props, ref) {
        stub.treeProps.current = props
        useImperativeHandle(ref, () => stub.treeHandle)
        return createElement('div', { 'data-testid': 'tree-stub' })
      },
    ),
  }
})

vi.mock('../../lib/requirement-export', () => ({
  downloadDataUrl: stub.downloadDataUrl,
}))

const tree: RequirementNode = {
  id: 'root',
  title: '登录需求',
  children: [{ id: 'n1', title: '账号密码登录', children: [] }],
}

const findings: Finding[] = [
  { id: 'f1', type: 'risk', title: '缺少密码错误锁定策略', detail: '存在暴力破解风险', nodeId: 'n1' },
]

function renderModal(overrides: Partial<Parameters<typeof ChartCanvasModal>[0]> = {}) {
  const props: Parameters<typeof ChartCanvasModal>[0] = {
    open: true,
    onClose: vi.fn(),
    title: '登录需求分析',
    tree,
    findings,
    findingCounts: new Map(),
    nodeTitles: new Map([
      ['root', '登录需求'],
      ['n1', '账号密码登录'],
    ]),
    chartType: 'mindmap',
    onChartTypeChange: vi.fn(),
    selectedNodeId: null,
    onSelectNode: vi.fn(),
    activeFindingId: null,
    onSelectFinding: vi.fn(),
    ...overrides,
  }
  return { ...render(<ChartCanvasModal {...props} />), props }
}

beforeEach(() => {
  vi.clearAllMocks()
  stub.mindmapHandle.getPngDataUrl.mockResolvedValue('data:image/png;base64,AAA')
  stub.mindmapHandle.fit.mockResolvedValue(undefined)
  stub.treeHandle.getPngDataUrl.mockResolvedValue('data:image/png;base64,BBB')
  stub.treeHandle.fit.mockResolvedValue(undefined)
})

describe('ChartCanvasModal 图表画布', () => {
  it('open=false 时不渲染', () => {
    renderModal({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('打开时渲染全屏 dialog：tabs、缩放控件、结论面板，焦点落在关闭按钮', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: '图表画布' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '思维导图' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放大' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '适应屏幕' })).toBeInTheDocument()
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('100%')
    expect(screen.getByText('缺少密码错误锁定策略')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭图表画布' })).toHaveFocus()
  })

  it('打开期间锁定 body 滚动，卸载后恢复', () => {
    const { unmount } = renderModal()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('ESC 与关闭按钮都触发 onClose', () => {
    const { props } = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '关闭图表画布' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('切换图表类型 tab 通知父级，缩放显示随新图表重置', () => {
    const { props, rerender } = renderModal()
    fireEvent.click(screen.getByRole('tab', { name: '树状图' }))
    expect(props.onChartTypeChange).toHaveBeenCalledWith('tree')

    rerender(<ChartCanvasModal {...props} chartType="tree" />)
    expect(screen.getByTestId('tree-stub')).toBeInTheDocument()
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('100%')
  })

  it('放大/缩小按 ±20% 步进驱动渲染器，原生缩放回报更新百分比', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(stub.mindmapHandle.zoomBy).toHaveBeenCalledTimes(1)
    expect(stub.mindmapHandle.zoomBy.mock.calls[0][0]).toBeCloseTo(1.2)

    // 渲染器回报（markmap 动画 / 用户滚轮）后，百分比与后续步进基于最新比例
    act(() => stub.mindmapProps.current?.onZoomScaleChange?.(1.44))
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('144%')

    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(stub.mindmapHandle.zoomBy).toHaveBeenCalledTimes(2)
    expect(stub.mindmapHandle.zoomBy.mock.calls[1][0]).toBeCloseTo(1 / 1.2)
  })

  it('适应屏幕调用 fit', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: '适应屏幕' }))
    expect(stub.mindmapHandle.fit).toHaveBeenCalledTimes(1)
  })

  it('导出 PNG 先 fit 适应屏幕再取图，导出完整树', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /PNG/ }))

    await waitFor(() => {
      expect(stub.downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,AAA', '登录需求分析.png')
    })
    expect(stub.mindmapHandle.fit).toHaveBeenCalledTimes(1)
    expect(stub.mindmapHandle.getPngDataUrl).toHaveBeenCalledTimes(1)
    // fit 必须先于取图，保证导出物是完整树而非当前视口
    expect(stub.mindmapHandle.fit.mock.invocationCallOrder[0]).toBeLessThan(
      stub.mindmapHandle.getPngDataUrl.mock.invocationCallOrder[0],
    )
  })

  it('结论面板可收起/展开', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: '收起结论面板' }))
    expect(screen.queryByText('缺少密码错误锁定策略')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开结论面板' }))
    expect(screen.getByText('缺少密码错误锁定策略')).toBeInTheDocument()
  })

  it('窄屏打开时结论面板默认收起', () => {
    const original = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true, writable: true })
    try {
      renderModal()
      expect(screen.queryByText('缺少密码错误锁定策略')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '展开结论面板' })).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: original, configurable: true, writable: true })
    }
  })
})
