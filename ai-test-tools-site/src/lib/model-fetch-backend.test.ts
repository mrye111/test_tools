import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildModelsUrlCandidates,
  fetchAvailableModels,
} from '../../server/src/features/testcase/ai'

describe('model fetch backend helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('为裸域名 OpenAI 兼容地址生成 /models 兜底候选', () => {
    expect(buildModelsUrlCandidates('https://api.saviour.cc.cd')).toEqual([
      'https://api.saviour.cc.cd/v1/models',
      'https://api.saviour.cc.cd/models',
    ])
  })

  it('某个候选地址超时后仍可使用其他成功候选', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) {
        throw new Error('The operation was aborted due to timeout')
      }

      return new Response(JSON.stringify({
        data: [
          { id: 'gpt-5.5', owned_by: 'Other' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const models = await fetchAvailableModels({
      apiKey: 'test-key',
      baseUrl: 'https://api.saviour.cc.cd',
      endpointType: 'openai_responses',
      model: 'gpt-5.5',
      provider: 'codex',
    })

    expect(models).toEqual([{ id: 'gpt-5.5', ownedBy: 'Other' }])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.saviour.cc.cd/models',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
