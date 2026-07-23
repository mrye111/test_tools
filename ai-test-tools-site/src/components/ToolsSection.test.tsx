import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { ToolsSection } from './ToolsSection'

const renderWithRouter = (ui: React.ReactElement) =>
  render(ui, { wrapper: BrowserRouter })

describe('ToolsSection', () => {
  it('renders all 6 tool cards', () => {
    renderWithRouter(<ToolsSection />)
    // 卡片标题同时用于正文与悬浮 caption，用 getAllByText 断言存在
    expect(screen.getAllByText('Jmeter脚本').length).toBeGreaterThan(0)
    expect(screen.getAllByText('用例生成').length).toBeGreaterThan(0)
    expect(screen.getAllByText('测试报告').length).toBeGreaterThan(0)
    expect(screen.getAllByText('数据工厂').length).toBeGreaterThan(0)
    expect(screen.getAllByText('需求分析').length).toBeGreaterThan(0)
    expect(screen.getAllByText('开发工具').length).toBeGreaterThan(0)
  })

  it('renders all 6 tool descriptions', () => {
    renderWithRouter(<ToolsSection />)
    expect(screen.getByText(/性能测试模板、AI智能生成/)).toBeInTheDocument()
    expect(screen.getByText(/AI 生成测试用例列表/)).toBeInTheDocument()
    expect(screen.getByText(/自动生成可视化质量分析报告/)).toBeInTheDocument()
    expect(screen.getByText(/测试数据生成、编码解码/)).toBeInTheDocument()
    expect(screen.getByText(/AI 分析生成需求脑图与风险结论/)).toBeInTheDocument()
    expect(screen.getByText(/JSON 格式化、正则测试/)).toBeInTheDocument()
  })
})
