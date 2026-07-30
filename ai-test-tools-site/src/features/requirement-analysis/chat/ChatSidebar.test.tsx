import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatSidebar } from './ChatSidebar'
import * as chatApi from './chat-api'

//  mock chat-api 的异步加载，避免测试实际发起网络请求
vi.mock('./chat-api', async () => {
  const actual = await vi.importActual<typeof import('./chat-api')>('./chat-api')
  return {
    ...actual,
    listSessions: vi.fn(),
    getLibraryCount: vi.fn(),
  }
})

const mockListSessions = vi.mocked(chatApi.listSessions)
const mockGetLibraryCount = vi.mocked(chatApi.getLibraryCount)

function renderSidebar(initialEntries: string[] = ['/requirement-analysis']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/requirement-analysis/*" element={<ChatSidebar />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ChatSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListSessions.mockResolvedValue([])
    mockGetLibraryCount.mockResolvedValue(0)
  })

  it('渲染 Logo、新聊天、文件库与最近列表', async () => {
    mockListSessions.mockResolvedValue([
      {
        id: 's1',
        title: '登录需求',
        agentTemplate: 'mindmap',
        createdAt: new Date(Date.now() - 1000 * 60 * 30),
        updatedAt: new Date(Date.now() - 1000 * 60 * 30),
      },
    ])
    mockGetLibraryCount.mockResolvedValue(5)

    renderSidebar()

    expect(await screen.findByText('AI')).toBeInTheDocument()
    expect(await screen.findByText('AI测试工具')).toBeInTheDocument()
    expect(await screen.findByText('新聊天')).toBeInTheDocument()
    expect(await screen.findByText('文件库')).toBeInTheDocument()
    expect(await screen.findByText('最近')).toBeInTheDocument()
    expect(await screen.findByText('登录需求')).toBeInTheDocument()
    expect(await screen.findByText('5')).toBeInTheDocument()
  })

  it('会话为空时显示空态', async () => {
    renderSidebar()

    expect(await screen.findByText('还没有会话')).toBeInTheDocument()
  })

  it('收到 ra-library-count 事件后更新徽章并播放 +1 动画', async () => {
    mockGetLibraryCount.mockResolvedValue(2)
    renderSidebar()

    // 等待初始数字渲染
    expect(await screen.findByText('2')).toBeInTheDocument()

    // 触发自定义事件，count 更新为 3
    window.dispatchEvent(new CustomEvent('ra-library-count', { detail: { count: 3 } }))

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    expect(document.querySelector('.chat-sidebar-count.is-bumping')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })
})
