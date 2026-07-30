import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryPage } from './LibraryPage'
import { listLibraryFiles, deleteLibraryFile } from '../chat/chat-api'

vi.mock('../chat/chat-api', async () => {
  const actual = await vi.importActual<typeof import('../chat/chat-api')>('../chat/chat-api')
  return {
    ...actual,
    listLibraryFiles: vi.fn(),
    deleteLibraryFile: vi.fn(),
  }
})

const mockListLibraryFiles = vi.mocked(listLibraryFiles)
const mockDeleteLibraryFile = vi.mocked(deleteLibraryFile)

function NavigateSpy() {
  const navigate = useNavigate()
  return <div data-testid="navigate-spy" data-path={JSON.stringify(navigate)} />
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/requirement-analysis/library']}>
      <Routes>
        <Route path="/requirement-analysis/library" element={<LibraryPage />} />
        <Route path="/requirement-analysis" element={<div data-testid="new-chat-home">新聊天</div>} />
        <Route path="/requirement-analysis/board/:id" element={<div data-testid="board-page">画板</div>} />
      </Routes>
      <NavigateSpy />
    </MemoryRouter>,
  )
}

const files = [
  {
    id: 'lf-1',
    kind: 'mindmap' as const,
    title: '登录需求思维导图',
    payload: {},
    sourceSessionTitle: null,
    createdAt: new Date('2026-07-28T10:00:00.000Z'),
    updatedAt: new Date('2026-07-28T14:30:00.000Z'),
  },
  {
    id: 'lf-2',
    kind: 'cause-effect' as const,
    title: '因果图分析',
    payload: {},
    sourceSessionTitle: null,
    createdAt: new Date('2026-07-28T09:00:00.000Z'),
    updatedAt: new Date('2026-07-28T09:00:00.000Z'),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockListLibraryFiles.mockResolvedValue(files)
  mockDeleteLibraryFile.mockResolvedValue(undefined)
})

describe('LibraryPage 文件库页', () => {
  it('渲染文件库标题、总数和卡片标题、类型、时间', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('文件库')).toBeInTheDocument()
    })

    expect(screen.getByText('共 2 个文件')).toBeInTheDocument()
    expect(screen.getByText('登录需求思维导图')).toBeInTheDocument()
    expect(screen.getByText('思维导图')).toBeInTheDocument()
    expect(screen.getByText('2026-07-28 14:30')).toBeInTheDocument()
    expect(screen.getByText('因果图')).toBeInTheDocument()
  })

  it('搜索框按标题过滤', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('登录需求思维导图')).toBeInTheDocument()
    })

    const input = screen.getByLabelText('按标题搜索')
    fireEvent.change(input, { target: { value: '因果' } })

    expect(screen.queryByText('登录需求思维导图')).not.toBeInTheDocument()
    expect(screen.getByText('因果图分析')).toBeInTheDocument()
  })

  it('点击卡片导航到画板并带 from=library', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('登录需求思维导图')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('登录需求思维导图'))

    await waitFor(() => {
      expect(screen.getByTestId('board-page')).toBeInTheDocument()
    })
  })

  it('删除按钮点击后弹出确认框，确认后从列表移除', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('登录需求思维导图')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByRole('button', { name: /删除/ })
    fireEvent.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(screen.queryByText('登录需求思维导图')).not.toBeInTheDocument()
    })
    expect(mockDeleteLibraryFile).toHaveBeenCalledWith('lf-1')
  })

  it('取消删除不调用接口', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('登录需求思维导图')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByRole('button', { name: /删除/ })
    fireEvent.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(mockDeleteLibraryFile).not.toHaveBeenCalled()
  })

  it('空态展示文案和去新聊天按钮', async () => {
    mockListLibraryFiles.mockResolvedValue([])
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('还没有保存的文件')).toBeInTheDocument()
    })

    expect(screen.getByText('去新聊天生成并保存，即可在这里查看。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '去新聊天' }))

    await waitFor(() => {
      expect(screen.getByTestId('new-chat-home')).toBeInTheDocument()
    })
  })

  it('加载失败展示错误信息', async () => {
    mockListLibraryFiles.mockRejectedValue(new Error('网络错误'))
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('网络错误')
    })
  })
})
