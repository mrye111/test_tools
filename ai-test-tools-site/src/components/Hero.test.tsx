import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Hero } from './Hero'

describe('Hero', () => {
  it('renders the label badge', () => {
    render(<Hero />)
    expect(screen.getByText('AI 测试工具平台')).toBeInTheDocument()
  })

  it('renders the heading with gradient text', () => {
    const { container } = render(<Hero />)
    // 标题按整行遮罩揭示渲染，这里按整体文本内容断言
    expect(container.querySelector('h1')?.textContent).toContain('AI测试工具')
    expect(container.querySelector('h1')?.textContent).toContain('一站生成')
  })

  it('renders the subtitle description', () => {
    render(<Hero />)
    expect(
      screen.getByText(/面向测试团队的专业 AI 工具集合/)
    ).toBeInTheDocument()
  })
})
