import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatShell } from './ChatShell'
import * as chatApi from './chat-api'

vi.mock('./chat-api', async () => {
  const actual = await vi.importActual('./chat-api') as typeof import('./chat-api')
  return {
    ...actual,
    getStorageStatus: vi.fn(),
    listSessions: vi.fn(),
    getLibraryCount: vi.fn(),
  }
})

vi.mock('./ChatSidebar', () => ({
  ChatSidebar: () => <div data-testid="chat-sidebar">Sidebar</div>,
}))

const mockGetStorageStatus = vi.mocked(chatApi.getStorageStatus)

function renderShell(initialEntries: string[] = ['/requirement-analysis']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/requirement-analysis/*" element={<ChatShell />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ChatShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('挂载时查询存储状态并在 memory 模式下渲染横幅', async () => {
    mockGetStorageStatus.mockResolvedValue('memory')
    renderShell()

    await waitFor(() => {
      expect(mockGetStorageStatus).toHaveBeenCalledTimes(1)
    })

    expect(await screen.findByText(/数据库不可用/)).toBeInTheDocument()
    expect(await screen.findByText(/本次会话内容不会持久保存/)).toBeInTheDocument()
  })

  it('mysql 模式下不渲染降级横幅', async () => {
    mockGetStorageStatus.mockResolvedValue('mysql')
    renderShell()

    await waitFor(() => {
      expect(mockGetStorageStatus).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByText(/数据库不可用/)).not.toBeInTheDocument()
  })

  it('查询失败时不渲染横幅，避免误导', async () => {
    mockGetStorageStatus.mockRejectedValue(new Error('network'))
    renderShell()

    await waitFor(() => {
      expect(mockGetStorageStatus).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByText(/数据库不可用/)).not.toBeInTheDocument()
  })
})
