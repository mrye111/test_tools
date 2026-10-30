import { describe, expect, it } from 'vitest'
import { normalizeSystemUrl, systemUrlHost } from './system-url'

describe('normalizeSystemUrl', () => {
  it('空值合法（可选字段）', () => {
    expect(normalizeSystemUrl('')).toEqual({ ok: true, value: '' })
    expect(normalizeSystemUrl('   ')).toEqual({ ok: true, value: '' })
  })

  it('无协议域名补 https', () => {
    expect(normalizeSystemUrl('staging.shop.com')).toEqual({ ok: true, value: 'https://staging.shop.com/' })
    expect(normalizeSystemUrl('staging.shop.com/checkout')).toEqual({ ok: true, value: 'https://staging.shop.com/checkout' })
  })

  it('localhost 与 IP 形态补 http（测试环境常态）', () => {
    expect(normalizeSystemUrl('localhost:5173')).toEqual({ ok: true, value: 'http://localhost:5173/' })
    expect(normalizeSystemUrl('127.0.0.1:3000')).toEqual({ ok: true, value: 'http://127.0.0.1:3000/' })
    expect(normalizeSystemUrl('10.20.30.4:8080/admin')).toEqual({ ok: true, value: 'http://10.20.30.4:8080/admin' })
  })

  it('已有 http/https 协议原样归一化，允许 IPv6 与路径', () => {
    expect(normalizeSystemUrl('http://[::1]:3000')).toEqual({ ok: true, value: 'http://[::1]:3000/' })
    expect(normalizeSystemUrl('https://staging.shop.com/login?a=1')).toEqual({
      ok: true,
      value: 'https://staging.shop.com/login?a=1',
    })
  })

  it('拒绝含空格输入', () => {
    const result = normalizeSystemUrl('has space.com')
    expect(result.ok).toBe(false)
  })

  it('拒绝含中文输入', () => {
    const result = normalizeSystemUrl('http://内网地址')
    expect(result.ok).toBe(false)
  })

  it('拒绝非 http(s) 协议（含 javascript: 伪协议绕过）', () => {
    expect(normalizeSystemUrl('ftp://files.internal').ok).toBe(false)
    expect(normalizeSystemUrl('javascript://evil.com/%0aalert(1)').ok).toBe(false)
    expect(normalizeSystemUrl('file:///c:/windows').ok).toBe(false)
  })

  it('拒绝解析失败的畸形地址', () => {
    expect(normalizeSystemUrl('https://').ok).toBe(false)
    expect(normalizeSystemUrl('not a url at all !!').ok).toBe(false)
  })
})

describe('systemUrlHost', () => {
  it('返回展示用主机名（含端口），未配置或非法时为空串', () => {
    expect(systemUrlHost('staging.shop.com')).toBe('staging.shop.com')
    expect(systemUrlHost('http://10.20.30.4:8080/admin')).toBe('10.20.30.4:8080')
    expect(systemUrlHost(undefined)).toBe('')
    expect(systemUrlHost('中文')).toBe('')
  })
})
