import { describe, expect, it } from 'vitest'
import { BRAND_ICONS } from './brand-icons.generated'
import {
  DEFAULT_ICON_KEY,
  PROJECT_PALETTE,
  SEMANTIC_ICONS,
  badgeTintOf,
  defaultColorFor,
  glyphColorOf,
  resolveIcon,
} from './project-icons'

describe('项目图标注册表', () => {
  it('语义图标唯一且充足，默认 key 存在', () => {
    const keys = SEMANTIC_ICONS.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBeGreaterThanOrEqual(50)
    expect(keys).toContain(DEFAULT_ICON_KEY)
  })

  it('品牌图标唯一、path 合法、官方色为 hex，规模约 30+', () => {
    const keys = BRAND_ICONS.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBeGreaterThanOrEqual(30)
    for (const item of BRAND_ICONS) {
      expect(item.key.startsWith('brand:')).toBe(true)
      // Simple Icons 的 path 以 M 或 m（相对坐标）起笔
      expect(item.path).toMatch(/^[Mm]/)
      expect(item.officialColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(item.title.length).toBeGreaterThan(0)
    }
  })

  it('resolveIcon 双库解析与默认回落', () => {
    expect(resolveIcon(undefined)).toEqual({ kind: 'semantic', option: SEMANTIC_ICONS[0] })
    expect(resolveIcon('sem:rocket')).toEqual({ kind: 'semantic', option: SEMANTIC_ICONS.find((i) => i.key === 'sem:rocket') })
    const wechat = resolveIcon('brand:wechat')
    expect(wechat.kind).toBe('brand')
    if (wechat.kind === 'brand') expect(wechat.data.key).toBe('brand:wechat')
    // 未知 key 回落默认语义图标
    expect(resolveIcon('brand:not-exist')).toEqual({ kind: 'semantic', option: SEMANTIC_ICONS[0] })
    expect(resolveIcon('sem:not-exist')).toEqual({ kind: 'semantic', option: SEMANTIC_ICONS[0] })
  })

  it('品牌图标默认品牌官方色，语义图标默认回落主题蓝', () => {
    expect(defaultColorFor('brand:wechat')).toBe('#07C160')
    expect(defaultColorFor('sem:rocket')).toBe('')
    expect(defaultColorFor(undefined)).toBe('')
  })

  it('配色回落与浅色调计算', () => {
    expect(glyphColorOf(undefined)).toBe('var(--color-accent)')
    expect(glyphColorOf('')).toBe('var(--color-accent)')
    expect(glyphColorOf(' #07C160 ')).toBe('#07C160')
    expect(badgeTintOf(undefined)).toBe('oklch(0.96 0.018 264)')
    expect(badgeTintOf('#07C160')).toContain('#07C160')
  })

  it('色板为 10 个不重复色（字形色存值，浅底渲染时计算）', () => {
    expect(PROJECT_PALETTE).toHaveLength(10)
    expect(new Set(PROJECT_PALETTE.map((item) => item.key)).size).toBe(10)
    expect(new Set(PROJECT_PALETTE.map((item) => item.hex.toLowerCase())).size).toBe(10)
    for (const item of PROJECT_PALETTE) {
      expect(item.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})
