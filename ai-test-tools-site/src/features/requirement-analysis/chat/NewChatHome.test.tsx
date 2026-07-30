import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewChatHome } from './NewChatHome'
import { useChatStream } from './useChatStream'
import { AGENT_TEMPLATES } from './agent-templates'

vi.mock('./useChatStream', () => ({
  useChatStream: vi.fn(),
}))

vi.mock('./chat-api', () => ({
  chatStream: vi.fn(),
}))

const mockUseChatStream = vi.mocked(useChatStream)

function CurrentLocation() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/requirement-analysis']}>
      <NewChatHome />
      <CurrentLocation />
    </MemoryRouter>,
  )
}

function makeMock(overrides: Partial<ReturnType<typeof useChatStream>> = {}) {
  return {
    messages: [],
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
})

describe('NewChatHome', () => {
  it('渲染问候语、五项智能体模板 chips 与四张示例卡片', () => {
    mockUseChatStream.mockReturnValue(makeMock())
    renderWithRouter()

    expect(screen.getByText('你好，开始一次需求分析')).toBeInTheDocument()
    expect(screen.getByText('选择智能体模板，输入需求，AI 为你产出测试设计图表')).toBeInTheDocument()

    for (const template of AGENT_TEMPLATES) {
      expect(screen.getAllByText(template.label).length).toBeGreaterThan(0)
    }

    expect(screen.getByText('更多智能体')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /更多智能体/ })).toHaveLength(1)

    expect(screen.getByText('电商下单流程的异常场景分析')).toBeInTheDocument()
    expect(screen.getByText('登录功能的等价类与边界值')).toBeInTheDocument()
    expect(screen.getByText('订单状态迁移流程图')).toBeInTheDocument()
    expect(screen.getByText('接口测试场景脑图')).toBeInTheDocument()
  })

  it('选择因果图 chip 并提交后，send 以 cause-effect 模板被调用', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    mockUseChatStream.mockReturnValue(makeMock({ send }))
    renderWithRouter()

    fireEvent.click(screen.getByText('因果图'))

    const textarea = screen.getByPlaceholderText('输入你要分析的需求，或粘贴需求文档文本')
    fireEvent.change(textarea, { target: { value: '分析登录失败的原因' } })

    fireEvent.click(screen.getByLabelText('发送'))

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith('分析登录失败的原因', 'cause-effect')
    })
  })

  it('点击更多智能体打开模板中心弹窗', () => {
    mockUseChatStream.mockReturnValue(makeMock())
    renderWithRouter()

    fireEvent.click(screen.getByText('更多智能体'))

    expect(screen.getByText('模板中心')).toBeInTheDocument()
  })

  it('点击示例卡片将示例文本填入 composer', () => {
    mockUseChatStream.mockReturnValue(makeMock())
    renderWithRouter()

    fireEvent.click(screen.getByText('电商下单流程的异常场景分析'))

    const textarea = screen.getByPlaceholderText('输入你要分析的需求，或粘贴需求文档文本')
    expect(textarea).toHaveValue(
      '分析电商下单流程中库存不足、支付失败、地址异常等场景，并输出因果图。',
    )
  })

  it('发送成功后导航到对应会话路由', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    mockUseChatStream.mockReturnValue(makeMock({ send, lastSessionId: 'sess-abc' }))
    renderWithRouter()

    const textarea = screen.getByPlaceholderText('输入你要分析的需求，或粘贴需求文档文本')
    fireEvent.change(textarea, { target: { value: '生成测试分析' } })

    fireEvent.click(screen.getByLabelText('发送'))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/requirement-analysis/chat/sess-abc')
    })
  })

  it('发送成功后无 sessionId 时给出可见错误提示', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    mockUseChatStream.mockReturnValue(makeMock({ send, lastSessionId: null }))
    renderWithRouter()

    const textarea = screen.getByPlaceholderText('输入你要分析的需求，或粘贴需求文档文本')
    fireEvent.change(textarea, { target: { value: '生成测试分析' } })

    fireEvent.click(screen.getByLabelText('发送'))

    await waitFor(() => {
      expect(screen.getByText('会话创建异常，请重试')).toBeInTheDocument()
    })
  })
})
