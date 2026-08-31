import { describe, expect, it } from 'vitest'
import { normalizeErrorMessage } from './app-error'

describe('normalizeErrorMessage（前端极简兜底）', () => {
  it('网络层失败映射为连接提示', () => {
    expect(normalizeErrorMessage(new Error('Failed to fetch'))).toBe(
      '无法连接到服务，请检查网络、接口地址或服务状态后重试。',
    )
    expect(normalizeErrorMessage('NetworkError when attempting to fetch resource.')).toBe(
      '无法连接到服务，请检查网络、接口地址或服务状态后重试。',
    )
  })

  it('服务端友好文案（含中文）原样直通', () => {
    expect(normalizeErrorMessage(new Error('模型服务认证失败，请检查 API Key 或权限配置后重试。'))).toBe(
      '模型服务认证失败，请检查 API Key 或权限配置后重试。',
    )
    expect(normalizeErrorMessage('报告记录已达上限（200 条）')).toBe('报告记录已达上限（200 条）')
  })

  it('纯英文原文兜底为友好文案', () => {
    expect(
      normalizeErrorMessage(
        'AI request failed: HTTP 400 {"error":{"code":"InvalidSubscription","message":"Your account does not have a valid subscription"}}',
      ),
    ).toBe('操作失败，请稍后重试。')
  })

  it('自定义兜底文案生效', () => {
    expect(normalizeErrorMessage('weird raw', { fallbackMessage: '保存失败，请重试。' })).toBe('保存失败，请重试。')
  })

  it('空错误与非 Error 输入返回兜底', () => {
    expect(normalizeErrorMessage(null)).toBe('操作失败，请稍后重试。')
    expect(normalizeErrorMessage(undefined)).toBe('操作失败，请稍后重试。')
  })
})
