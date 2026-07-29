import { useMemo, useState } from 'react'
import { LayoutTemplate, Search, X } from 'lucide-react'
import { ModalShell } from '../../components/ui/ModalShell'
import { BOARD_TEMPLATES, TEMPLATE_CATEGORIES } from './templates'

type TemplateCenterModalProps = {
  open: boolean
  onClose: () => void
}

/**
 * 模板中心：分析画板"插入模板"工具的入口窗口（本期纯骨架，ADR 0005）。
 * 左侧分类导航 + 右侧模板卡片网格，"使用模板"暂不真正插入画布——
 * 画板当前为只读形态，尚无可插入的对象模型，按钮置灰并说明原因。
 */
export function TemplateCenterModal({ open, onClose }: TemplateCenterModalProps) {
  const [categoryId, setCategoryId] = useState('all')
  const [keyword, setKeyword] = useState('')

  const visibleTemplates = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return BOARD_TEMPLATES.filter((template) => {
      if (categoryId !== 'all' && template.categoryId !== categoryId) return false
      if (!term) return true
      return template.name.toLowerCase().includes(term) || template.description.toLowerCase().includes(term)
    })
  }, [categoryId, keyword])

  const activeCategory = TEMPLATE_CATEGORIES.find((category) => category.id === categoryId)

  return (
    <ModalShell open={open} onClose={onClose} closeOnBackdrop closeOnEscape>
      <div
        className="modal-panel template-center"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-center-title"
      >
        <aside className="template-center-nav">
          <div className="template-center-brand">
            <span className="template-center-brand-icon">
              <LayoutTemplate className="h-4 w-4" />
            </span>
            <h2 id="template-center-title">模板中心</h2>
          </div>
          <nav className="template-center-menu" aria-label="模板分类">
            {TEMPLATE_CATEGORIES.map((category) => {
              const Icon = category.icon
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`template-center-menu-item${category.id === categoryId ? ' is-active' : ''}`}
                  aria-current={category.id === categoryId ? 'true' : undefined}
                  onClick={() => setCategoryId(category.id)}
                >
                  <Icon className="h-4 w-4" />
                  {category.label}
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="template-center-main">
          <header className="template-center-header">
            <label className="template-center-search">
              <Search className="h-3.5 w-3.5" />
              <input
                type="search"
                value={keyword}
                placeholder="搜索模板"
                aria-label="搜索模板"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </label>
            <button type="button" className="icon-action h-9 w-9" aria-label="关闭模板中心" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </header>

          <h3 className="template-center-heading">{activeCategory?.label ?? '全部模板'}</h3>

          {visibleTemplates.length === 0 ? (
            <p className="template-center-empty">没有匹配的模板，换个关键词试试。</p>
          ) : (
            <div className="template-center-grid">
              {visibleTemplates.map((template) => {
                const Icon = template.icon
                return (
                  <article key={template.id} className="template-card">
                    <div className="template-card-thumb" aria-hidden="true">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="template-card-body">
                      <div className="template-card-name">{template.name}</div>
                      <p className="template-card-desc">{template.description}</p>
                      <button
                        type="button"
                        className="secondary-action px-3 py-1.5 text-xs"
                        disabled
                        title="画板编辑能力上线后开放"
                      >
                        使用模板
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}
