/** ModelConfigModal 双存储开关：默认本地、切换=迁移目标传递、云端掩码/版本回传、服务端代发试连、409 提示。 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelConfigModal, type ModelConfigSaveTarget } from './ModelConfigModal'
import { ErrorDialogProvider } from '../ui/ErrorDialogProvider'
import { AuthApiError } from '../../lib/auth-api'
import type { UniversalProvider } from '../../shared/api-types'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** 编辑云端条目时父级转换来的草稿：明文密钥不落地（留空）。 */
const cloudDraft: UniversalProvider = {
  id: 'cloud-1',
  name: '云端供应商',
  providerType: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: 'openai/gpt-5.5',
  modelOptions: ['openai/gpt-5.5'],
  apiFormat: 'openai_responses',
}

function renderModal(props: {
  initialConfig?: UniversalProvider | null
  cloudStorage?: { editing: { apiKeyMask: string | null; version: number } | null; onChanged: () => void }
  onSave?: (config: UniversalProvider, target: ModelConfigSaveTarget) => void | Promise<void>
  onClose?: () => void
}) {
  return render(
    <ErrorDialogProvider>
      <ModelConfigModal
        open
        initialConfig={props.initialConfig}
        cloudStorage={props.cloudStorage}
        onClose={props.onClose ?? (() => {})}
        onSave={props.onSave ?? (() => {})}
      />
    </ErrorDialogProvider>,
  )
}

/** 新建表单：补上预设默认留空的 baseUrl / apiKey，使校验通过。 */
function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
    target: { value: 'https://api.example.com/v1' },
  })
  fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-test' } })
}

describe('ModelConfigModal 双存储开关', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('不传 cloudStorage 时不渲染存储开关，保存目标恒为本地', async () => {
    const onSave = vi.fn()
    renderModal({ onSave })

    expect(screen.queryByText('存储位置')).not.toBeInTheDocument()

    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /添加统一供应商/ }))

    await screen.findByRole('button', { name: /添加统一供应商/ })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://api.example.com/v1' }), { storage: 'local' })
  })

  it('传入 cloudStorage 时默认本地，拨云端后保存目标为 cloud（新建不带 version）', async () => {
    const onSave = vi.fn()
    renderModal({
      onSave,
      cloudStorage: { editing: null, onChanged: vi.fn() },
    })

    expect(screen.getByText('存储位置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /本地/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /云端/ }))
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /添加统一供应商/ }))

    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.anything(), { storage: 'cloud', version: undefined })
    })
  })

  it('编辑云端条目：apiKey 留空 = 保持不变，掩码回显，version 随保存回传', async () => {
    const onSave = vi.fn()
    renderModal({
      initialConfig: cloudDraft,
      onSave,
      cloudStorage: { editing: { apiKeyMask: 'sk***ey', version: 3 }, onChanged: vi.fn() },
    })

    // 掩码回显、留空不触发必填校验
    expect(screen.getByPlaceholderText(/留空保持不变（当前 sk\*\*\*ey）/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }))

    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cloud-1', apiKey: '' }),
        { storage: 'cloud', version: 3 },
      )
    })
    expect(screen.queryByText('请输入 API Key')).not.toBeInTheDocument()
  })

  it('编辑云端条目拨回本地：apiKey 变为必填（云端不导出明文）', () => {
    renderModal({
      initialConfig: cloudDraft,
      onSave: vi.fn(),
      cloudStorage: { editing: { apiKeyMask: 'sk***ey', version: 3 }, onChanged: vi.fn() },
    })

    fireEvent.click(screen.getByRole('button', { name: /本地/ }))
    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }))

    expect(screen.getByText('请输入 API Key')).toBeInTheDocument()
  })

  it('云端模式测试连接由服务端代发：POST /api/model-configs/test 携带草稿与条目 id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    renderModal({
      initialConfig: cloudDraft,
      onSave: vi.fn(),
      cloudStorage: { editing: { apiKeyMask: 'sk***ey', version: 3 }, onChanged: vi.fn() },
    })

    // 云端模式不出「获取模型列表」（明文密钥不在前端），出「测试连接」
    expect(screen.queryByRole('button', { name: /获取模型列表/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }))

    await screen.findByText(/连接成功/)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/model-configs/test')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.id).toBe('cloud-1')
    expect(body.baseUrl).toBe(cloudDraft.baseUrl)
    expect('apiKey' in body).toBe(false)
  })

  it('保存遇 409：提示已被其他设备修改，并回调 onChanged 让父级重新拉取', async () => {
    const onChanged = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new AuthApiError('已被其他设备修改，刷新后重试', 'CONFLICT', 409))
    renderModal({
      initialConfig: cloudDraft,
      onSave,
      cloudStorage: { editing: { apiKeyMask: 'sk***ey', version: 3 }, onChanged },
    })

    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }))

    await screen.findByText(/已被其他设备修改，请刷新后重试/)
    expect(onChanged).toHaveBeenCalled()
  })

  it('保存遇非 409 错误：通用失败提示，不触发 onChanged', async () => {
    const onChanged = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new AuthApiError('网络错误', 'HTTP_500', 500))
    renderModal({
      initialConfig: cloudDraft,
      onSave,
      cloudStorage: { editing: { apiKeyMask: 'sk***ey', version: 3 }, onChanged },
    })

    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }))

    await screen.findByText('网络错误')
    expect(onChanged).not.toHaveBeenCalled()
  })
})
