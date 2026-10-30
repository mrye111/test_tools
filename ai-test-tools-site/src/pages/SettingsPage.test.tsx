/** SettingsPage 双存储列表：本地/云端合并呈现、云端徽标与掩码、上云迁移、云端删除、未登录不可见。 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPage } from './SettingsPage'
import { ErrorDialogProvider } from '../components/ui/ErrorDialogProvider'
import type { CloudModelConfigView } from '../lib/auth-api'

const authStub = {
  status: 'authenticated' as 'authenticated' | 'anonymous',
}

vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: 'amy', isAdmin: false, disabled: false, createdAt: '', updatedAt: '' },
    status: authStub.status,
    isAdmin: false,
    csrfToken: 'tok',
  }),
}))

vi.mock('../lib/auth-api', () => ({
  listCloudModelConfigs: vi.fn(),
  createCloudModelConfig: vi.fn(),
  updateCloudModelConfig: vi.fn(),
  deleteCloudModelConfig: vi.fn(),
  testCloudModelConfig: vi.fn(),
  isCloudModelConfigConflict: () => false,
}))

import {
  createCloudModelConfig,
  deleteCloudModelConfig,
  listCloudModelConfigs,
  updateCloudModelConfig,
} from '../lib/auth-api'

const localProvider = {
  id: 'local-1',
  name: '本地供应商',
  providerType: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-local',
  model: 'openai/gpt-5.5',
  modelOptions: ['openai/gpt-5.5'],
  apiFormat: 'openai_responses' as const,
}

const cloudView: CloudModelConfigView = {
  id: 'cloud-1',
  name: '云端供应商',
  providerType: 'openrouter',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  modelOptions: ['deepseek-v4-flash'],
  apiFormat: 'openai_chat',
  apiKeyMask: 'sk***56',
  version: 1,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
}

function seedLocalState() {
  localStorage.setItem('nexuskit_model_configs', JSON.stringify({
    models: [localProvider],
    activeModelId: 'local-1',
  }))
}

function readLocalModelIds(): string[] {
  const raw = localStorage.getItem('nexuskit_model_configs')
  if (!raw) return []
  const parsed = JSON.parse(raw) as { models?: Array<{ id: string }> }
  return (parsed.models ?? []).map((item) => item.id)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ErrorDialogProvider>
        <SettingsPage />
      </ErrorDialogProvider>
    </MemoryRouter>,
  )
}

describe('SettingsPage 双存储列表', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    authStub.status = 'authenticated'
    vi.mocked(listCloudModelConfigs).mockResolvedValue([cloudView])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('本地与云端配置合并呈现，云端条目标「云端」徽标与密钥掩码', async () => {
    seedLocalState()
    renderPage()

    expect(await screen.findByText('本地供应商')).toBeInTheDocument()
    expect(await screen.findByText('云端供应商')).toBeInTheDocument()
    expect(screen.getByText('云端')).toBeInTheDocument()
    expect(screen.getByText('密钥 sk***56')).toBeInTheDocument()
    expect(listCloudModelConfigs).toHaveBeenCalled()
  })

  it('未登录时不拉取、不展示云端配置（云端零本地存在）', async () => {
    authStub.status = 'anonymous'
    seedLocalState()
    renderPage()

    expect(await screen.findByText('本地供应商')).toBeInTheDocument()
    expect(listCloudModelConfigs).not.toHaveBeenCalled()
    expect(screen.queryByText('云端供应商')).not.toBeInTheDocument()
  })

  it('本地条目拨云端保存：上传成功后删除本地原件（切换=迁移）', async () => {
    seedLocalState()
    vi.mocked(createCloudModelConfig).mockResolvedValue({ ...cloudView, id: 'cloud-new' })
    renderPage()

    // 本地行的编辑按钮（列表顺序：本地在前、云端在后）
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0])
    // 编辑弹窗打开后拨到云端（存储开关按钮名以「云端」开头，区别于删除按钮的 aria-label）
    fireEvent.click(await screen.findByRole('button', { name: /^云端/ }))
    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }))

    await waitFor(() => {
      expect(createCloudModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'local-1', name: '本地供应商' }),
        'sk-local',
      )
    })
    await waitFor(() => {
      expect(readLocalModelIds()).not.toContain('local-1')
    })
  })

  it('编辑云端条目保存：PUT 走 updateCloudModelConfig 并带 version', async () => {
    vi.mocked(updateCloudModelConfig).mockResolvedValue({ ...cloudView, version: 2 })
    renderPage()

    // 云端行的编辑按钮（列表中只有云端一条时唯一的「编辑」）
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    // 默认云端存储、掩码占位
    expect(await screen.findByPlaceholderText(/留空保持不变（当前 sk\*\*\*56）/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }))

    await waitFor(() => {
      expect(updateCloudModelConfig).toHaveBeenCalledWith(
        'cloud-1',
        expect.objectContaining({ name: '云端供应商', apiKey: '' }),
        1,
        undefined,
      )
    })
  })

  it('删除云端条目：确认后调 DELETE 并重新拉取列表', async () => {
    vi.mocked(deleteCloudModelConfig).mockResolvedValue(undefined)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '删除云端配置 云端供应商' }))
    expect(await screen.findByText('删除云端配置？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(deleteCloudModelConfig).toHaveBeenCalledWith('cloud-1')
    })
    // 初始拉取一次 + 删除后刷新一次
    await waitFor(() => {
      expect(vi.mocked(listCloudModelConfigs).mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })
})
