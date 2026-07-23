import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App integration', () => {
  it('renders the navbar', () => {
    const { container } = render(<App />)
    // 品牌名在导航与 Hero 标题中都会出现，这里限定在 nav 内断言
    expect(container.querySelector('nav')).toHaveTextContent('AI测试工具')
  })

  it('renders the compact hero on the home page', () => {
    const { container } = render(<App />)
    expect(screen.getByText('AI 测试工具平台')).toBeInTheDocument()
    // 标题按整行遮罩揭示渲染，这里按整体文本内容断言
    expect(container.querySelector('h1')?.textContent).toContain('一站生成')
  })

  it('renders all 6 tool cards', () => {
    render(<App />)
    // 卡片标题同时用于正文与悬浮 caption，用 getAllByText 断言存在
    expect(screen.getAllByText('Jmeter脚本').length).toBeGreaterThan(0)
    expect(screen.getAllByText('用例生成').length).toBeGreaterThan(0)
    expect(screen.getAllByText('测试报告').length).toBeGreaterThan(0)
    expect(screen.getAllByText('数据工厂').length).toBeGreaterThan(0)
    expect(screen.getAllByText('需求分析').length).toBeGreaterThan(0)
    expect(screen.getAllByText('开发工具').length).toBeGreaterThan(0)
  })

})
