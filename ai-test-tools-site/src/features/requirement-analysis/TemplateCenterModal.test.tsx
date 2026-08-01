import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TemplateCenterModal } from './TemplateCenterModal'
import { BOARD_TEMPLATES } from './templates'

describe('TemplateCenterModal', () => {
  it('默认展示全部模板，测试设计分类包含五项图表模板', () => {
    render(<TemplateCenterModal open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '模板中心' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '测试设计' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '测试设计' }))

    const testDesignTemplates = BOARD_TEMPLATES.filter((t) => t.categoryId === 'test-design')
    expect(testDesignTemplates).toHaveLength(5)
    for (const template of testDesignTemplates) {
      expect(screen.getByText(template.name)).toBeInTheDocument()
    }
  })

  it('点击测试设计模板的使用模板按钮触发 onUseTemplate 并关闭弹窗', () => {
    const onUseTemplate = vi.fn()
    const onClose = vi.fn()
    render(<TemplateCenterModal open onClose={onClose} onUseTemplate={onUseTemplate} />)

    fireEvent.click(screen.getByRole('button', { name: '测试设计' }))
    const card = screen.getByText('因果图').closest('article') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '使用模板' }))

    expect(onUseTemplate).toHaveBeenCalledTimes(1)
    const calledTemplate = onUseTemplate.mock.calls[0][0]
    expect(calledTemplate.id).toBe('td-cause-effect')
    expect(calledTemplate.chartKind).toBe('cause-effect')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('非测试设计模板按钮显示即将上线且不可点击', () => {
    render(<TemplateCenterModal open onClose={vi.fn()} onUseTemplate={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '绘图&创作' }))
    const card = screen.getByText('组织结构图').closest('article') as HTMLElement
    const button = within(card).getByRole('button', { name: '该模板即将上线' })

    expect(button).toBeDisabled()
  })
})
