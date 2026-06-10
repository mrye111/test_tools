import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { Gauge } from 'lucide-react'
import { ToolCard } from './ToolCard'

const mockTool = {
  id: 'jmeter-script',
  title: 'Jmeter脚本',
  description: '性能测试模板、AI智能生成、自定义脚本',
  icon: Gauge,
  href: '/jmeter',
}

const renderWithRouter = (ui: React.ReactElement) =>
  render(ui, { wrapper: BrowserRouter })

describe('ToolCard', () => {
  it('renders the tool title', () => {
    renderWithRouter(<ToolCard tool={mockTool} />)
    expect(screen.getByText('Jmeter脚本')).toBeInTheDocument()
  })

  it('renders the tool description', () => {
    renderWithRouter(<ToolCard tool={mockTool} />)
    expect(screen.getByText('性能测试模板、AI智能生成、自定义脚本')).toBeInTheDocument()
  })

  it('renders as a link', () => {
    renderWithRouter(<ToolCard tool={mockTool} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/jmeter')
  })

  it('renders the icon', () => {
    const { container } = renderWithRouter(<ToolCard tool={mockTool} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('renders the arrow icon', () => {
    const { container } = renderWithRouter(<ToolCard tool={mockTool} />)
    const arrows = container.querySelectorAll('svg')
    expect(arrows.length).toBeGreaterThanOrEqual(2)
  })
})
