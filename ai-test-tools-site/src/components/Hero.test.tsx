import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Hero } from './Hero'

describe('Hero', () => {
  it('renders the label badge', () => {
    render(<Hero />)
    expect(screen.getByText('AI 测试工具网站')).toBeInTheDocument()
  })

  it('renders the heading with gradient text', () => {
    render(<Hero />)
    expect(screen.getByText('AI测试工具，')).toBeInTheDocument()
    expect(screen.getByText('一站生成')).toBeInTheDocument()
  })

  it('renders the subtitle description', () => {
    render(<Hero />)
    expect(
      screen.getByText(/面向测试团队的 AI 工具集合/)
    ).toBeInTheDocument()
  })
})
