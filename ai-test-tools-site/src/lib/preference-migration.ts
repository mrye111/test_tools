/** 首登偏好上送：把匿名时期存 localStorage 的入口地址记忆一次性迁移到服务端个人偏好。 */

import { putPreference } from './auth-api'

/** 需要迁移的本地键前缀（与历史 URL 记忆写入方约定一致）。 */
const MIGRATION_PREFIXES = ['ai-run-entry:', 'requirement-import-entry-'] as const

/** 服务端偏好值长度上限，超限跳过不报错。 */
const MAX_VALUE_LENGTH = 2048

export interface PreferenceMigrationResult {
  /** 成功上送并删除本地键的条数 */
  migrated: number
  /** 因值超长等原因跳过的条数（保留本地键） */
  skipped: number
  /** 上送失败的条数（保留本地键，留待下次登录重试） */
  failed: number
}

/** 列出可迁移的本地偏好键（按 localStorage 枚举顺序）。 */
export function listMigratablePreferenceKeys(storage: Storage = localStorage): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key && MIGRATION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keys.push(key)
    }
  }
  return keys
}

/**
 * 登录成功后调用：逐条 PUT /api/preferences/:key，成功即删本地键（幂等，重登不重传）。
 * 单条失败不抛出、不阻塞登录流程；失败键保留待重试。
 */
export async function migrateLocalPreferences(storage: Storage = localStorage): Promise<PreferenceMigrationResult> {
  const result: PreferenceMigrationResult = { migrated: 0, skipped: 0, failed: 0 }
  for (const key of listMigratablePreferenceKeys(storage)) {
    const value = storage.getItem(key)
    if (value === null) continue
    if (value.length > MAX_VALUE_LENGTH) {
      result.skipped += 1
      continue
    }
    try {
      await putPreference(key, value)
      storage.removeItem(key)
      result.migrated += 1
    } catch {
      result.failed += 1
    }
  }
  return result
}
