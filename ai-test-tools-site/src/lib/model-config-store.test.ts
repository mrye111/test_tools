import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyModelConfigState,
  deleteStoredModelConfig,
  loadStoredModelConfig,
  loadStoredModelConfigState,
  saveStoredModelConfigState,
  setActiveStoredModelConfig,
  setStoredModelConfigCurrentModel,
  upsertStoredModelConfig,
} from './model-config-store'

describe('model-config-store', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('兼容旧版单条模型配置并迁移为当前模型加候选模型结构', () => {
    window.localStorage.setItem('nexuskit_model_config', JSON.stringify({
      name: '旧模型',
      baseUrl: 'https://legacy.example.com/v1',
      apiKey: 'legacy-key',
      modelId: 'legacy-model',
      temperature: 0.4,
    }))

    const state = loadStoredModelConfigState()

    expect(state.models).toHaveLength(1)
    expect(state.models[0].name).toBe('旧模型')
    expect(state.models[0].model).toBe('legacy-model')
    expect(state.models[0].modelOptions).toEqual(['legacy-model'])
    expect(state.models[0].apiFormat).toBe('openai_responses')
    expect(state.activeModelId).toBe(state.models[0].id)

    const savedState = JSON.parse(window.localStorage.getItem('nexuskit_model_configs') ?? '{}')
    expect(savedState.models).toHaveLength(1)
  })

  it('兼容旧版三模型统一供应商结构并迁移为候选模型结构', () => {
    window.localStorage.setItem('nexuskit_model_configs', JSON.stringify({
      activeModelId: 'legacy-provider',
      models: [
        {
          id: 'legacy-provider',
          name: '旧统一供应商',
          providerType: 'newapi',
          baseUrl: 'https://legacy-gateway.example.com/v1',
          apiKey: 'legacy-key',
          models: {
            claude: {
              model: 'claude-sonnet-4-6',
            },
            codex: {
              model: 'gpt-5.5',
              reasoningEffort: 'high',
            },
          },
        },
      ],
    }))

    const state = loadStoredModelConfigState()

    expect(state.models).toHaveLength(1)
    expect(state.models[0].id).toBe('legacy-provider')
    expect(state.models[0].model).toBe('gpt-5.5')
    expect(state.models[0].modelOptions).toEqual(['gpt-5.5', 'claude-sonnet-4-6'])
    expect(state.models[0].apiFormat).toBe('openai_responses')
  })

  it('新增多条统一供应商后可以切换当前供应商', () => {
    const firstState = upsertStoredModelConfig({
      id: 'model-a',
      name: '供应商 A',
      providerType: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'key-a',
      model: 'openai/gpt-5.5',
      apiFormat: 'openai_responses',
    })

    expect(firstState.activeModelId).toBe('model-a')

    const secondState = upsertStoredModelConfig({
      id: 'model-b',
      name: '供应商 B',
      providerType: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key-b',
      model: 'deepseek-v4-flash',
      apiFormat: 'openai_chat',
    })

    expect(secondState.models).toHaveLength(2)
    expect(loadStoredModelConfig()?.id).toBe('model-a')

    const switchedState = setActiveStoredModelConfig('model-b')
    expect(switchedState.activeModelId).toBe('model-b')
    expect(loadStoredModelConfig()?.id).toBe('model-b')
  })

  it('同一供应商存在多个候选模型时可以切换当前模型', () => {
    saveStoredModelConfigState({
      models: [
        {
          id: 'model-a',
          name: '供应商 A',
          providerType: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'key-a',
          model: 'openai/gpt-5.5',
          modelOptions: ['openai/gpt-5.5', 'anthropic/claude-sonnet-4-6'],
          apiFormat: 'openai_responses',
        },
      ],
      activeModelId: 'model-a',
    })

    const nextState = setStoredModelConfigCurrentModel('model-a', 'anthropic/claude-sonnet-4-6')

    expect(nextState.models[0].model).toBe('anthropic/claude-sonnet-4-6')
    expect(nextState.models[0].modelOptions).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.5',
    ])
    expect(loadStoredModelConfig()?.model).toBe('anthropic/claude-sonnet-4-6')
  })

  it('保存配置时会把当前模型自动纳入候选模型列表', () => {
    const state = upsertStoredModelConfig({
      id: 'model-a',
      name: '供应商 A',
      providerType: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'key-a',
      model: 'openai/gpt-5.5',
      modelOptions: ['anthropic/claude-sonnet-4-6'],
      apiFormat: 'openai_responses',
    })

    expect(state.models[0].modelOptions).toEqual([
      'openai/gpt-5.5',
      'anthropic/claude-sonnet-4-6',
    ])
  })

  it('删除当前供应商后会自动切到剩余第一条供应商', () => {
    saveStoredModelConfigState({
      models: [
        {
          id: 'model-a',
          name: '供应商 A',
          providerType: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'key-a',
          model: 'openai/gpt-5.5',
          apiFormat: 'openai_responses',
        },
        {
          id: 'model-b',
          name: '供应商 B',
          providerType: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'key-b',
          model: 'deepseek-v4-flash',
          apiFormat: 'openai_chat',
        },
      ],
      activeModelId: 'model-b',
    })

    const nextState = deleteStoredModelConfig('model-b')

    expect(nextState.models).toHaveLength(1)
    expect(nextState.activeModelId).toBe('model-a')
    expect(loadStoredModelConfig()?.id).toBe('model-a')
  })

  it('空状态保存后应保持空结构', () => {
    saveStoredModelConfigState(createEmptyModelConfigState())

    const state = loadStoredModelConfigState()
    expect(state.models).toEqual([])
    expect(state.activeModelId).toBeNull()
  })
})
