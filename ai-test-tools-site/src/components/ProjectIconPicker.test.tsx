import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectIconPicker } from './ProjectIconPicker'

describe('ProjectIconPicker', () => {
  it('渲染图形隐喻与品牌标志两组网格及色板', () => {
    render(<ProjectIconPicker iconKey="sem:folder-kanban" iconColor="" onSelectIcon={() => undefined} onSelectColor={() => undefined} />)

    expect(screen.getByText('图形隐喻')).toBeInTheDocument()
    expect(screen.getByText('品牌标志')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '图标配色' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: '图标配色' })).getAllByRole('button')).toHaveLength(10)
    expect(screen.getByRole('button', { name: '项目' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'WeChat' })).toBeInTheDocument()
  })

  it('搜索同时过滤两组，无匹配时给出空提示', () => {
    render(<ProjectIconPicker iconKey="" iconColor="" onSelectIcon={() => undefined} onSelectColor={() => undefined} />)
    fireEvent.change(screen.getByLabelText('搜索图标'), { target: { value: 'wechat' } })

    expect(screen.getByRole('button', { name: 'WeChat' })).toBeInTheDocument()
    expect(screen.queryByText('图形隐喻')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('搜索图标'), { target: { value: '不存在的东西' } })
    expect(screen.getByText(/没有匹配/)).toBeInTheDocument()
  })

  it('点语义图标只增量回调图标 key，点品牌图标带品牌官方色', () => {
    const onSelectIcon = vi.fn()
    render(<ProjectIconPicker iconKey="" iconColor="" onSelectIcon={onSelectIcon} onSelectColor={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    expect(onSelectIcon).toHaveBeenLastCalledWith('sem:rocket')

    fireEvent.click(screen.getByRole('button', { name: 'WeChat' }))
    expect(onSelectIcon).toHaveBeenLastCalledWith('brand:wechat', '#07C160')
  })

  it('点色板只增量回调配色，选中项反映在 aria-pressed', () => {
    const onSelectColor = vi.fn()
    const { rerender } = render(<ProjectIconPicker iconKey="sem:rocket" iconColor="#E5484D" onSelectIcon={() => undefined} onSelectColor={onSelectColor} />)

    const swatches = within(screen.getByRole('group', { name: '图标配色' })).getAllByRole('button')
    expect(swatches[7]).toHaveAttribute('aria-pressed', 'true') // 红 #E5484D
    fireEvent.click(screen.getByRole('button', { name: '配色 绿' }))
    expect(onSelectColor).toHaveBeenLastCalledWith('#30A46C')

    rerender(<ProjectIconPicker iconKey="sem:rocket" iconColor="#30A46C" onSelectIcon={() => undefined} onSelectColor={onSelectColor} />)
    expect(screen.getByRole('button', { name: '配色 绿' })).toHaveAttribute('aria-pressed', 'true')
  })
})
