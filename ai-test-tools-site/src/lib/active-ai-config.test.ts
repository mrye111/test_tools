/**
 * 统一生成载荷解析（双存储最后一里路）：
 * 本地条目 → RuntimeAiConfig；云端条目 → { cloudConfigId } 引用（密钥不出服务端）；
 * 云端指针失效回退本机第一条并归位，拉取失败保留指针本次兜底。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listCloudModelConfigs, type CloudModelConfigView } from './auth-api'
import { loadActiveAiConfigSelection, loadLocalAiConfigSelection } from './active-ai-config'
import {
  loadStoredModelConfigState,
  setActiveCloudModelConfig,
  upsertStoredModelConfig,
} from './model-config-store'

vi.mock('./auth-api', () => ({
  listCloudModelConfigs: vi.fn(),
}))

const mockListCloud = vi.mocked(listCloudModelConfigs)

const localModel = {
  id: 'model-a',
  name: '供应商 A',
  providerType: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'key-a',
  model: 'openai/gpt-5.5',
  apiFormat: 'openai_responses' as const,
}

function cloudView(id: string, name = '云端 Kimi'): CloudModelConfigView {
  return {
    id,
    name,
    providerType: 'kimi',
    baseUrl: 'https://api.kimi.com/coding/v1',
    model: 'kimi-k2.7-code',
    apiFormat: 'openai_chat',
    apiKeyMask: 'sk***ey',
    version: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('loadActiveAiConfigSelection', () => {
  it('本地当前条目 → 完整运行时配置载荷', async () => {
    upsertStoredModelConfig(localModel)

    const selection = await loadActiveAiConfigSelection()

    expect(selection?.storage).toBe('local')
    expect(selection?.payload).toEqual({
      provider: 'codex',
      endpointType: 'openai_responses',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'key-a',
      model: 'openai/gpt-5.5',
    })
    expect(selection?.name).toBe('供应商 A')
    expect(mockListCloud).not.toHaveBeenCalled()
  })

  it('云端当前条目 → 只产出 cloudConfigId 引用载荷', async () => {
    upsertStoredModelConfig(localModel)
    setActiveCloudModelConfig('cfg-1')
    mockListCloud.mockResolvedValue([cloudView('cfg-1')])

    const selection = await loadActiveAiConfigSelection()

    expect(selection?.storage).toBe('cloud')
    expect(selection?.payload).toEqual({ cloudConfigId: 'cfg-1' })
    expect(selection?.name).toBe('云端 Kimi')
    expect(selection?.model).toBe('kimi-k2.7-code')
    expect(JSON.stringify(selection?.payload)).not.toContain('key')
  })

  it('云端指针指向已删除的配置 → 回退本机第一条并归位指针（spec §4）', async () => {
    upsertStoredModelConfig(localModel)
    setActiveCloudModelConfig('cfg-gone')
    mockListCloud.mockResolvedValue([cloudView('cfg-other')])

    const selection = await loadActiveAiConfigSelection()

    expect(selection?.storage).toBe('local')
    expect(selection?.payload).toMatchObject({ apiKey: 'key-a' })
    expect(loadStoredModelConfigState().activeModelId).toBe('model-a')
  })

  it('云端列表拉取失败 → 本次按本地兜底但保留云端指针', async () => {
    upsertStoredModelConfig(localModel)
    setActiveCloudModelConfig('cfg-1')
    mockListCloud.mockRejectedValue(new Error('network down'))

    const selection = await loadActiveAiConfigSelection()

    expect(selection?.storage).toBe('local')
    expect(loadStoredModelConfigState().activeModelId).toBe('cloud:cfg-1')
  })

  it('什么配置都没有 → null', async () => {
    expect(await loadActiveAiConfigSelection()).toBeNull()
  })
})

describe('loadLocalAiConfigSelection', () => {
  it('本地指针同步有值；云端指针返回 null（等待异步校验）', () => {
    expect(loadLocalAiConfigSelection()).toBeNull()

    upsertStoredModelConfig(localModel)
    expect(loadLocalAiConfigSelection()?.storage).toBe('local')

    setActiveCloudModelConfig('cfg-1')
    expect(loadLocalAiConfigSelection()).toBeNull()
  })
})
