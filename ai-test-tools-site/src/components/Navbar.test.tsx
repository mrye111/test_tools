import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { Navbar } from './Navbar'

const renderWithRouter = (ui: React.ReactElement) =>
  render(ui, { wrapper: BrowserRouter })

describe('Navbar', () => {
  it('renders the brand icon with AI text', () => {
    renderWithRouter(<Navbar />)
    expect(screen.getByText('AI')).toBeInTheDocument()
  })

  it('renders the AI testing tools brand name', () => {
    renderWithRouter(<Navbar />)
    expect(screen.getByText('AI测试工具')).toBeInTheDocument()
  })

  it('renders navigation links', () => {
    renderWithRouter(<Navbar />)
    expect(screen.getByText('工具')).toBeInTheDocument()
    expect(screen.getByText('文档')).toBeInTheDocument()
    expect(screen.getByText('定价')).toBeInTheDocument()
  })

  it('renders settings link', () => {
    renderWithRouter(<Navbar />)
    expect(screen.getByText('设置')).toBeInTheDocument()
  })

  it('has sticky positioning', () => {
    const { container } = renderWithRouter(<Navbar />)
    const nav = container.querySelector('nav')
    expect(nav).toHaveClass('sticky')
  })
})
