import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { ToolsSection } from './ToolsSection'

const renderWithRouter = (ui: React.ReactElement) =>
  render(ui, { wrapper: BrowserRouter })

describe('ToolsSection', () => {
  it('renders all 6 tool cards', () => {
    renderWithRouter(<ToolsSection />)
    expect(screen.getByText('Jmeter脚本')).toBeInTheDocument()
    expect(screen.getByText('用例生成')).toBeInTheDocument()
    expect(screen.getByText('数据可视化')).toBeInTheDocument()
    expect(screen.getByText('加密解密')).toBeInTheDocument()
    expect(screen.getByText('智能助手')).toBeInTheDocument()
    expect(screen.getByText('开发工具')).toBeInTheDocument()
  })

  it('renders all 6 tool descriptions', () => {
    renderWithRouter(<ToolsSection />)
    expect(screen.getByText(/性能测试模板、AI智能生成/)).toBeInTheDocument()
    expect(screen.getByText(/AI 生成测试用例列表/)).toBeInTheDocument()
    expect(screen.getByText(/粘贴表格数据即时生成图表/)).toBeInTheDocument()
    expect(screen.getByText(/Base64、MD5、AES/)).toBeInTheDocument()
    expect(screen.getByText(/AI 驱动的写作/)).toBeInTheDocument()
    expect(screen.getByText(/JSON 格式化、正则测试/)).toBeInTheDocument()
  })
})
