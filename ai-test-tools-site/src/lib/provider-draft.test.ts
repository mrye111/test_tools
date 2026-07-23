import { describe, expect, it } from 'vitest'
import type { UniversalProvider } from '../shared/api-types'
import {
  applyPresetToDraft,
  createProviderDraft,
  normalizeProviderDraft,
  normalizeUniversalProvider,
} from './provider-draft'

function buildDraft(overrides: Partial<UniversalProvider> = {}): UniversalProvider {
  return {
    id: 'draft-1',
    name: '我的供应商',
    providerType: 'custom',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'my-model',
    modelOptions: ['my-model'],
    apiFormat: 'openai_responses',
    ...overrides,
  }
}

describe('createProviderDraft', () => {
  it('无初始配置时套用第一个预设（自定义配置）', () => {
    const draft = createProviderDraft()

    expect(draft.id).toBeTruthy()
    expect(draft.name).toBe('自定义配置')
    expect(draft.providerType).toBe('custom')
    expect(draft.baseUrl).toBe('')
    expect(draft.apiKey).toBe('')
    expect(draft.model).toBe('gpt-5.5')
    expect(draft.modelOptions).toEqual(['gpt-5.5'])
    expect(draft.apiFormat).toBe('openai_responses')
    expect(draft.icon).toBe('custom')
    expect(draft.notes).toBe('')
  })

  it('传入已有配置时保留字段并把当前模型排到候选首位', () => {
    const draft = createProviderDraft(buildDraft({
      id: 'existing-1',
      model: 'model-b',
      modelOptions: ['model-a', 'model-b'],
      apiKey: 'sk-keep',
    }))

    expect(draft.id).toBe('existing-1')
    expect(draft.apiKey).toBe('sk-keep')
    expect(draft.modelOptions).toEqual(['model-b', 'model-a'])
  })
})

describe('applyPresetToDraft', () => {
  it('套用预设模板字段并保留密钥与备注', () => {
    const next = applyPresetToDraft(buildDraft({ apiKey: 'sk-keep', notes: '备注' }), 'deepseek')

    expect(next.providerType).toBe('deepseek')
    expect(next.name).toBe('DeepSeek')
    expect(next.baseUrl).toBe('https://api.deepseek.com')
    expect(next.model).toBe('deepseek-v4-flash')
    expect(next.modelOptions).toEqual(['deepseek-v4-flash'])
    expect(next.apiFormat).toBe('openai_chat')
    expect(next.modelsUrl).toBe('https://api.deepseek.com/models')
    expect(next.websiteUrl).toBe('https://platform.deepseek.com')
    expect(next.icon).toBe('deepseek')
    expect(next.endpointCandidates).toEqual(['https://api.deepseek.com'])
    expect(next.apiKey).toBe('sk-keep')
    expect(next.notes).toBe('备注')
    expect(next.id).toBe('draft-1')
  })

  it('编辑已有供应商时保留当前名称', () => {
    const next = applyPresetToDraft(buildDraft({ name: '我的 DeepSeek' }), 'deepseek', { keepCurrentName: true })

    expect(next.name).toBe('我的 DeepSeek')
  })

  it('名称为空时即使编辑模式也回退到预设名称', () => {
    const next = applyPresetToDraft(buildDraft({ name: '' }), 'deepseek', { keepCurrentName: true })

    expect(next.name).toBe('DeepSeek')
  })

  it('未知预设类型回退到自定义配置模板', () => {
    const next = applyPresetToDraft(buildDraft(), 'acme-unknown')

    expect(next.providerType).toBe('acme-unknown')
    expect(next.name).toBe('自定义配置')
    expect(next.baseUrl).toBe('')
    expect(next.apiFormat).toBe('openai_responses')
    expect(next.icon).toBe('custom')
  })
})

describe('normalizeProviderDraft', () => {
  it('预设供应商保存时以预设为准刷新格式与展示元信息', () => {
    const before = Date.now()
    const saved = normalizeProviderDraft(buildDraft({
      providerType: 'deepseek',
      apiFormat: 'openai_responses',
      icon: 'whatever',
      iconColor: '#000000',
      modelsUrl: '',
      createdAt: 123,
    }))

    expect(saved.providerType).toBe('deepseek')
    expect(saved.apiFormat).toBe('openai_chat')
    expect(saved.icon).toBe('deepseek')
    expect(saved.iconColor).toBe('#1E88E5')
    expect(saved.modelsUrl).toBe('https://api.deepseek.com/models')
    expect(saved.endpointCandidates).toEqual(['https://api.deepseek.com'])
    expect(saved.createdAt).toBe(123)
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('自定义模板按地址推断 anthropic 格式', () => {
    const saved = normalizeProviderDraft(buildDraft({
      baseUrl: 'https://api.anthropic.com/v1',
    }))

    expect(saved.apiFormat).toBe('anthropic')
  })

  it('自定义模板按地址推断 gemini 格式', () => {
    const saved = normalizeProviderDraft(buildDraft({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    }))

    expect(saved.apiFormat).toBe('gemini_native')
  })

  it('自定义模板按地址推断 openai_chat 格式', () => {
    const saved = normalizeProviderDraft(buildDraft({
      baseUrl: 'https://api.example.com/v1/chat/completions',
    }))

    expect(saved.apiFormat).toBe('openai_chat')
  })

  it('自定义模板无法识别地址时回退 openai_responses 且推断优先于草稿格式', () => {
    const saved = normalizeProviderDraft(buildDraft({
      baseUrl: 'https://api.example.com/v1',
      apiFormat: 'gemini_native',
    }))

    expect(saved.apiFormat).toBe('openai_responses')
  })

  it('留空的链接字段回退到预设值并裁剪文本空白', () => {
    const saved = normalizeProviderDraft(buildDraft({
      name: '  我的 Kimi  ',
      providerType: 'kimi',
      baseUrl: ' https://api.moonshot.cn/v1 ',
      apiKey: ' sk-kimi ',
      websiteUrl: '',
      apiKeyUrl: '   ',
      modelsUrl: undefined,
      model: 'kimi-k2.7-code',
      modelOptions: ['other-model', 'kimi-k2.7-code'],
    }))

    expect(saved.name).toBe('我的 Kimi')
    expect(saved.baseUrl).toBe('https://api.moonshot.cn/v1')
    expect(saved.apiKey).toBe('sk-kimi')
    expect(saved.websiteUrl).toBe('https://platform.kimi.com?aff=cc-switch')
    expect(saved.apiKeyUrl).toBe('https://platform.kimi.com/console/api-keys?aff=cc-switch')
    expect(saved.modelsUrl).toBeUndefined()
    expect(saved.modelOptions).toEqual(['kimi-k2.7-code', 'other-model'])
  })
})

describe('normalizeUniversalProvider', () => {
  it('缺少 baseUrl 或 apiKey 时返回 null', () => {
    expect(normalizeUniversalProvider({ apiKey: 'sk-test' })).toBeNull()
    expect(normalizeUniversalProvider({ baseUrl: 'https://api.example.com/v1' })).toBeNull()
  })

  it('保留已有值，预设仅补全缺失的元信息', () => {
    const saved = normalizeUniversalProvider(buildDraft({
      providerType: 'kimi',
      icon: 'my-icon',
      iconColor: '#123456',
      isPartner: false,
    }))

    expect(saved?.icon).toBe('my-icon')
    expect(saved?.iconColor).toBe('#123456')
    expect(saved?.isPartner).toBe(false)
    expect(saved?.primePartner).toBe(true)
    expect(saved?.websiteUrl).toBe('https://platform.kimi.com?aff=cc-switch')
    expect(saved?.apiFormat).toBe('openai_responses')
  })

  it('合并 fallback 并按预设补全默认名称、模型与格式', () => {
    const saved = normalizeUniversalProvider(
      { providerType: 'deepseek' },
      { baseUrl: ' https://api.deepseek.com ', apiKey: ' sk-legacy ' },
    )

    expect(saved?.name).toBe('DeepSeek')
    expect(saved?.baseUrl).toBe('https://api.deepseek.com')
    expect(saved?.apiKey).toBe('sk-legacy')
    expect(saved?.model).toBe('deepseek-v4-flash')
    expect(saved?.modelOptions).toEqual(['deepseek-v4-flash'])
    expect(saved?.apiFormat).toBe('openai_chat')
    expect(saved?.id).toBeTruthy()
  })
})
