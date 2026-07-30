import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatView } from './ChatView'
import { useChatStream } from './useChatStream'
import { saveToLibrary } from './chat-api'
import type { ChatMessageView } from './useChatStream'

vi.mock('./useChatStream', () => ({
  useChatStream: vi.fn(),
}))

vi.mock('./chat-api', async () => {
  const actual = await vi.importActual<typeof import('./chat-api')>('./chat-api')
  return {
    ...actual,
    saveToLibrary: vi.fn(),
  }
})

const mockUseChatStream = vi.mocked(useChatStream)
const mockSaveToLibrary = vi.mocked(saveToLibrary)

function NavigateSpy() {
  const navigate = useNavigate()
  return <div data-testid="navigate-spy" data-path={JSON.stringify(navigate)} />
}

function renderChatView(sessionId = 'sess-123') {
  return render(
    <MemoryRouter initialEntries={[`/requirement-analysis/chat/${sessionId}`]}>
      <Routes>
        <Route path="/requirement-analysis/chat/:sessionId" element={<ChatView />} />
        <Route path="/requirement-analysis/board/:id" element={<div data-testid="board-page">board</div>} />
      </Routes>
      <NavigateSpy />
    </MemoryRouter>,
  )
}

function makeMessages(): ChatMessageView[] {
  return [
    {
      id: 'msg-user-1',
      role: 'user',
      content: '帮我分析登录需求',
      reasoning: null,
      status: 'done',
      agentTemplate: 'mindmap',
      files: [],
    },
    {
      id: 'msg-assistant-1',
      role: 'assistant',
      content: '已为你生成思维导图。',
      reasoning: '我需要先理解登录需求的核心要素。',
      status: 'done',
      agentTemplate: 'mindmap',
      files: [
        { sessionFileId: 'sf-1', kind: 'mindmap', title: '登录需求思维导图', savedToLibrary: false },
      ],
    },
  ]
}

function makeMock(overrides: Partial<ReturnType<typeof useChatStream>> = {}) {
  return {
    messages: [] as ChatMessageView[],
    streaming: false,
    error: null,
    send: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn(),
    loadHistory: vi.fn(),
    lastSessionId: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockUseChatStream.mockReset()
  mockSaveToLibrary.mockReset()
})

describe('ChatView', () => {
  it('挂载时加载历史并渲染 user 与 assistant 消息', async () => {
    const loadHistory = vi.fn()
    mockUseChatStream.mockReturnValue(makeMock({ loadHistory, messages: makeMessages() }))
    renderChatView()

    await waitFor(() => {
      expect(loadHistory).toHaveBeenCalled()
    })

    expect(screen.getByText('帮我分析登录需求')).toBeInTheDocument()
    expect(screen.getByText('已为你生成思维导图。')).toBeInTheDocument()
  })

  it('带 files 的 assistant 消息显示文件卡片标题', () => {
    mockUseChatStream.mockReturnValue(makeMock({ messages: makeMessages() }))
    renderChatView()

    expect(screen.getByText('登录需求思维导图')).toBeInTheDocument()
  })

  it('点击保存到文件库后调用 saveToLibrary、按钮变已保存并 dispatch 徽章事件', async () => {
    mockSaveToLibrary.mockResolvedValue({ libraryFileId: 'lf-1', libraryCount: 6 })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    mockUseChatStream.mockReturnValue(makeMock({ messages: makeMessages() }))
    renderChatView()

    fireEvent.click(screen.getByRole('button', { name: '保存到文件库' }))

    await waitFor(() => {
      expect(mockSaveToLibrary).toHaveBeenCalledWith('sf-1')
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
    })

    const dispatched = dispatchSpy.mock.calls.find(
      (call) => call[0] instanceof CustomEvent && (call[0] as CustomEvent).type === 'ra-library-count',
    )
    expect(dispatched).toBeDefined()
    expect((dispatched![0] as CustomEvent).detail).toEqual({ count: 6 })

    dispatchSpy.mockRestore()
  })

  it('点击打开画布导航到 /requirement-analysis/board/:fileId', async () => {
    mockUseChatStream.mockReturnValue(makeMock({ messages: makeMessages() }))
    renderChatView()

    fireEvent.click(screen.getByRole('button', { name: '打开画布' }))

    await waitFor(() => {
      expect(screen.getByTestId('board-page')).toBeInTheDocument()
    })
  })

  it('error 消息显示重试按钮且点击调用 retry', async () => {
    const retry = vi.fn()
    const messages: ChatMessageView[] = [
      {
        id: 'msg-user-1',
        role: 'user',
        content: '帮我分析登录需求',
        reasoning: null,
        status: 'done',
        agentTemplate: 'mindmap',
        files: [],
      },
      {
        id: 'msg-assistant-err',
        role: 'assistant',
        content: '生成中断',
        reasoning: null,
        status: 'error',
        agentTemplate: 'mindmap',
        files: [],
      },
    ]
    mockUseChatStream.mockReturnValue(makeMock({ retry, messages }))
    renderChatView()

    const retryButton = screen.getByRole('button', { name: '重试' })
    expect(retryButton).toBeInTheDocument()

    fireEvent.click(retryButton)

    await waitFor(() => {
      expect(retry).toHaveBeenCalledWith('msg-assistant-err')
    })
  })
})
