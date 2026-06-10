import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App integration', () => {
  it('renders the navbar', () => {
    render(<App />)
    expect(screen.getByText('AI测试工具')).toBeInTheDocument()
  })

  it('renders the compact hero on the home page', () => {
    render(<App />)
    expect(screen.getByText('AI 测试工具网站')).toBeInTheDocument()
    expect(screen.getByText('一站生成')).toBeInTheDocument()
  })

  it('renders all 6 tool cards', () => {
    render(<App />)
    expect(screen.getByText('Jmeter脚本')).toBeInTheDocument()
    expect(screen.getByText('用例生成')).toBeInTheDocument()
    expect(screen.getByText('数据可视化')).toBeInTheDocument()
    expect(screen.getByText('加密解密')).toBeInTheDocument()
    expect(screen.getByText('智能助手')).toBeInTheDocument()
    expect(screen.getByText('开发工具')).toBeInTheDocument()
  })

})
