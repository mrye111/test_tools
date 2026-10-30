/**
 * 当前生效 AI 配置的统一解析（双存储最后一里路，spec §4）。
 * 所有 AI 生成/分析/编译入口统一从这里取提交载荷：
 * - 本地条目 → 完整 RuntimeAiConfig（密钥在此浏览器，随请求上送，现状不变）
 * - 云端条目（activeModelId = cloud:<id>）→ { cloudConfigId } 引用，密钥不出服务端，服务端按引用解析
 * 云端指针失效（确认已删除/无权）→ 回退本机可用列表第一条并归位指针；拉取失败保留指针、本次按本地兜底。
 */

import { listCloudModelConfigs, type CloudModelConfigView } from './auth-api'
import {
  getActiveCloudConfigId,
  loadStoredModelConfig,
  loadStoredModelConfigState,
  saveStoredModelConfigState,
} from './model-config-store'
import {
  toAiConfig,
  type CloudAiConfigRef,
  type RuntimeAiConfig,
  type UniversalProvider,
} from '../shared/api-types'

export type ActiveAiConfigSelection =
  | {
      storage: 'local'
      /** 直接作为 ai_config / aiConfig 提交载荷。 */
      payload: RuntimeAiConfig
      provider: UniversalProvider
      name: string
      model: string
      apiFormat: string
    }
  | {
      storage: 'cloud'
      payload: CloudAiConfigRef
      view: CloudModelConfigView
      name: string
      model: string
      apiFormat: string
    }

function toLocalSelection(provider: UniversalProvider): ActiveAiConfigSelection {
  return {
    storage: 'local',
    payload: toAiConfig(provider),
    provider,
    name: provider.name,
    model: provider.model,
    apiFormat: provider.apiFormat,
  }
}

function toCloudSelection(view: CloudModelConfigView): ActiveAiConfigSelection {
  return {
    storage: 'cloud',
    payload: { cloudConfigId: view.id },
    view,
    name: view.name,
    model: view.model,
    apiFormat: view.apiFormat,
  }
}

/**
 * 同步读本地当前选择（云端指针返回 null，由 loadActiveAiConfigSelection 异步校验后补全）。
 * 供需要同步初始值的展示组件（如生成页状态条）使用。
 */
export function loadLocalAiConfigSelection(): ActiveAiConfigSelection | null {
  if (getActiveCloudConfigId()) return null
  const local = loadStoredModelConfig()
  return local ? toLocalSelection(local) : null
}

/** 解析当前生效配置：云端指针实时校验存在性（云端零本地缓存），本地指针直接转换。 */
export async function loadActiveAiConfigSelection(): Promise<ActiveAiConfigSelection | null> {
  const cloudId = getActiveCloudConfigId()
  if (cloudId) {
    const configs = await listCloudModelConfigs().catch(() => null)
    const found = configs?.find((item) => item.id === cloudId)
    if (found) return toCloudSelection(found)
    if (configs) {
      // 确认已不存在：指针归位到本机可用列表第一条（spec §4 回退语义）
      const state = loadStoredModelConfigState()
      saveStoredModelConfigState({ ...state, activeModelId: state.models[0]?.id ?? null })
    }
    // configs === null（未登录/网络异常）：指针保留，本次先按本地兜底
  }
  const local = loadStoredModelConfig()
  return local ? toLocalSelection(local) : null
}
