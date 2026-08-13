import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatSidebar } from './ChatSidebar'
import { ErrorDialogProvider } from '../../../components/ui/ErrorDialogProvider'
import * as chatApi from './chat-api'

//  mock chat-api 的异步加载，避免测试实际发起网络请求
vi.mock('./chat-api', async () => {
  const actual = await vi.importActual<typeof import('./chat-api')>('./chat-api')
  return {
    ...actual,
    listSessions: vi.fn(),
    getLibraryCount: vi.fn(),
    deleteSession: vi.fn(),
  }
})

const mockListSessions = vi.mocked(chatApi.listSessions)
const mockGetLibraryCount = vi.mocked(chatApi.getLibraryCount)
const mockDeleteSession = vi.mocked(chatApi.deleteSession)

/** 渲染当前路由路径，用于断言删除当前会话后的跳转行为。 */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname}</div>
}

function renderSidebar(initialEntries: string[] = ['/requirement-analysis']) {
  return render(
    <ErrorDialogProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/requirement-analysis/*"
            element={
              <>
                <ChatSidebar />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ErrorDialogProvider>,
  )
}

/** 构造一条会话列表数据。 */
function makeSession(id: string, title: string) {
  return {
    id,
    title,
    agentTemplate: 'mindmap',
    createdAt: new Date(Date.now() - 1000 * 60 * 30),
    updatedAt: new Date(Date.now() - 1000 * 60 * 30),
  }
}

describe('ChatSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListSessions.mockResolvedValue([])
    mockGetLibraryCount.mockResolvedValue(0)
    mockDeleteSession.mockResolvedValue(undefined)
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

    expect(document.querySelector('.ra-chat-sidebar-count.is-bumping')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('点击删除按钮弹出轻量确认，取消后不调用接口且条目保留', async () => {
    mockListSessions.mockResolvedValue([makeSession('s1', '登录需求')])
    renderSidebar()

    expect(await screen.findByText('登录需求')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除会话 登录需求' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('将删除会话「登录需求」及其全部消息记录；已保存到文件库的文件不受影响。')

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mockDeleteSession).not.toHaveBeenCalled()
    expect(screen.getByText('登录需求')).toBeInTheDocument()
  })

  it('确认删除后调用接口并从列表移除该会话', async () => {
    mockListSessions.mockResolvedValue([makeSession('s1', '登录需求'), makeSession('s2', '下单需求')])
    renderSidebar()

    expect(await screen.findByText('下单需求')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除会话 登录需求' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(mockDeleteSession).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(screen.queryByText('登录需求')).not.toBeInTheDocument())
    expect(screen.getByText('下单需求')).toBeInTheDocument()
  })

  it('删除当前打开的会话后跳转回新聊天首页', async () => {
    mockListSessions.mockResolvedValue([makeSession('s1', '登录需求')])
    renderSidebar(['/requirement-analysis/chat/s1'])

    expect(await screen.findByText('登录需求')).toBeInTheDocument()
    expect(screen.getByTestId('location-probe').textContent).toBe('/requirement-analysis/chat/s1')

    fireEvent.click(screen.getByRole('button', { name: '删除会话 登录需求' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(screen.getByTestId('location-probe').textContent).toBe('/requirement-analysis'))
  })

  it('删除失败时条目保留并弹出错误提示', async () => {
    mockDeleteSession.mockRejectedValue(new Error('网络异常'))
    mockListSessions.mockResolvedValue([makeSession('s1', '登录需求')])
    renderSidebar()

    expect(await screen.findByText('登录需求')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除会话 登录需求' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))

    expect(await screen.findByText('网络异常')).toBeInTheDocument()
    expect(screen.getByText('登录需求')).toBeInTheDocument()
  })
})
