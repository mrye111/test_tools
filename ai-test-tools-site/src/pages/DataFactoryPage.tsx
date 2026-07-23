import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Database,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Type,
  Users,
  X,
} from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import {
  batchExecuteTool,
  executeTool,
  getCategories,
  type ToolCategory,
  type ToolParam,
  type ToolResponse,
} from '../lib/data-factory-api'

function ToolIcon({ name, className }: { name?: string; className?: string }) {
  switch (name) {
    case 'test_data':
      return <Users className={className} />
    case 'random':
      return <Shuffle className={className} />
    case 'string':
      return <Type className={className} />
    case 'encoding':
      return <Code2 className={className} />
    case 'json':
      return <Braces className={className} />
    case 'crypto':
      return <Lock className={className} />
    case 'crontab':
      return <Clock className={className} />
    default:
      return <Database className={className} />
  }
}

function formatResult(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function formatBatchResult(results: unknown[]): string {
  return results
    .map((item) => {
      if (typeof item === 'object' && item !== null && 'value' in item && Object.keys(item).length === 1) {
        return formatResult((item as { value: unknown }).value)
      }
      return formatResult(item)
    })
    .join('\n')
}

interface ParamFieldProps {
  param: ToolParam
  value: unknown
  onChange: (name: string, value: unknown) => void
}

function ParamField({ param, value, onChange }: ParamFieldProps) {
  const inputId = `param-${param.name}`
  const commonProps = {
    id: inputId,
    className: 'field-control',
    placeholder: param.placeholder,
  }

  let control: React.ReactNode

  switch (param.type) {
    case 'textarea':
      control = (
        <textarea
          {...commonProps}
          rows={5}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(param.name, e.target.value)}
        />
      )
      break
    case 'number':
      control = (
        <input
          {...commonProps}
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(param.name, e.target.value === '' ? '' : Number(e.target.value))}
        />
      )
      break
    case 'select':
      control = (
        <select
          {...commonProps}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(param.name, e.target.value)}
        >
          {param.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )
      break
    case 'boolean':
      control = (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          aria-label={param.label}
          onClick={() => onChange(param.name, !value)}
          className={`data-factory-switch ${value ? 'is-active' : ''}`}
        >
          <span />
        </button>
      )
      break
    default:
      control = (
        <input
          {...commonProps}
          type="text"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(param.name, e.target.value)}
        />
      )
  }

  return (
    <div className="data-factory-field">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="field-label">
          {param.label}
          {param.required && <span className="text-danger"> *</span>}
        </label>
      </div>
      {control}
      {param.helper && <p className="helper-text">{param.helper}</p>}
    </div>
  )
}

interface ToolWorkspaceProps {
  tool: ToolResponse
  onClose: () => void
}

function ToolWorkspace({ tool, onClose }: ToolWorkspaceProps) {
  const { showError } = useErrorDialog()
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {}
    for (const param of tool.params) {
      if (param.default !== undefined) defaults[param.name] = param.default
    }
    return defaults
  })
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  const handleExecute = async () => {
    setLoading(true)
    try {
      const data = await executeTool<unknown>(tool.id, values)
      setResult(formatResult(data))
    } catch (error) {
      showError(error, { title: `${tool.name} 执行失败`, fallbackMessage: '工具执行失败，请检查输入参数。' })
    } finally {
      setLoading(false)
    }
  }

  const handleBatch = async () => {
    setLoading(true)
    try {
      const data = await batchExecuteTool<unknown>(tool.id, values, 10)
      setResult(formatBatchResult(data.results))
    } catch (error) {
      showError(error, { title: `${tool.name} 批量生成失败`, fallbackMessage: '批量生成失败，请检查输入参数。' })
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="data-factory-workspace"
    >
      <div>
        <div className="data-factory-workspace-header">
          <div className="data-factory-workspace-title">
            <span className="data-factory-workspace-icon">
              <ToolIcon name={tool.icon} className="h-[18px] w-[18px] stroke-[1.8]" />
            </span>
            <div>
              <span className="data-factory-eyebrow">运行工作区</span>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
            </div>
          </div>
          <Tooltip content="返回工具列表">
            <button type="button" onClick={onClose} className="data-factory-icon-button" aria-label="返回工具列表">
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        <div className="data-factory-workspace-grid">
          <section className="data-factory-step" aria-labelledby="data-factory-config-title">
            <div className="data-factory-step-heading">
              <span>01</span>
              <div>
                <h4 id="data-factory-config-title">配置参数</h4>
                <p>按需填写输入条件，未标记必填的参数可保持默认。</p>
              </div>
            </div>
            <div className="data-factory-fields">
              {tool.params.length === 0 && (
                <div className="data-factory-parameter-empty">
                  <Database className="h-5 w-5" />
                  <div>
                    <strong>无需额外参数</strong>
                    <p>该工具已经准备就绪，可直接开始处理。</p>
                  </div>
                </div>
              )}
              {tool.params.map((param) => (
                <ParamField key={param.name} param={param} value={values[param.name]} onChange={handleChange} />
              ))}
            </div>
            <div className="data-factory-actions">
              <button type="button" onClick={handleExecute} disabled={loading} className="data-factory-primary">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {loading ? '正在处理' : '生成结果'}
              </button>
              <button type="button" onClick={handleBatch} disabled={loading} className="data-factory-secondary">
                <RefreshCw className="h-4 w-4" />
                批量生成 10 组
              </button>
            </div>
          </section>

          <section className="data-factory-step data-factory-result-step" aria-labelledby="data-factory-result-title">
            <div className="data-factory-step-heading data-factory-result-heading">
              <span>02</span>
              <div>
                <h4 id="data-factory-result-title">处理结果</h4>
                <p>结果会在运行完成后即时更新。</p>
              </div>
              <button type="button" onClick={handleCopy} disabled={!result} className="data-factory-copy">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? '已复制' : '复制结果'}
              </button>
            </div>
            <div className={`data-factory-result ${result ? 'has-result' : ''}`}>
              {loading ? (
                <div className="data-factory-loading">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <div><strong>正在处理数据</strong><span>结果生成后会自动更新</span></div>
                </div>
              ) : (
                <pre>{result || <span>完成参数配置并运行工具，结果会在此处即时呈现。</span>}</pre>
              )}
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  )
}

interface ToolMiniCardProps {
  tool: ToolResponse
  onClick: () => void
  index: number
  selected: boolean
}

function ToolMiniCard({ tool, onClick, index, selected }: ToolMiniCardProps) {
  return (
    <motion.button
      onClick={onClick}
      className={`data-factory-tool-card ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 7) * 0.035, ease: [0.16, 1, 0.3, 1] }}
      whileTap={{ scale: 0.99 }}
    >
      <span className="data-factory-tool-number">{String(index + 1).padStart(2, '0')}</span>
      <div className="data-factory-tool-icon">
        <ToolIcon name={tool.icon} className="h-[17px] w-[17px] stroke-[1.8]" />
      </div>
      <div className="data-factory-tool-copy">
        <div className="data-factory-tool-name">{tool.name}</div>
        <div className="data-factory-tool-description">{tool.description}</div>
      </div>
      <span className="data-factory-tool-meta">{tool.params.length === 0 ? '无需参数' : `${tool.params.length} 个参数`}</span>
      <ChevronRight className="data-factory-tool-arrow" />
    </motion.button>
  )
}

export function DataFactoryPage() {
  const { showError } = useErrorDialog()
  const [categories, setCategories] = useState<ToolCategory[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeCategoryId) ?? categories[0],
    [categories, activeCategoryId],
  )

  const selectedTool = useMemo(
    () => activeCategory?.tools.find((t) => t.id === selectedToolId) ?? null,
    [activeCategory, selectedToolId],
  )

  const totalTools = useMemo(() => categories.reduce((sum, category) => sum + category.tools.length, 0), [categories])

  const filteredTools = useMemo(() => {
    if (!activeCategory) return []
    const keyword = searchQuery.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return activeCategory.tools
    return activeCategory.tools.filter((tool) =>
      `${tool.name} ${tool.description}`.toLocaleLowerCase('zh-CN').includes(keyword),
    )
  }, [activeCategory, searchQuery])

  useEffect(() => {
    async function load() {
      try {
        const data = await getCategories()
        setCategories(data)
        if (data[0]) setActiveCategoryId(data[0].id)
      } catch (error) {
        showError(error, { title: '数据工厂加载失败', fallbackMessage: '无法连接到数据工厂后端服务。' })
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [showError])

  return (
    <div className="data-factory-page">
      <div className="data-factory-ambient" aria-hidden="true" />

      <header className="data-factory-topbar">
        <div className="data-factory-brand">
          <Tooltip content="返回首页">
            <Link to="/" className="data-factory-back" aria-label="返回首页">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Tooltip>
          <div>
            <span className="data-factory-eyebrow">DATA LAB · 数据处理空间</span>
            <div className="data-factory-title-line">
              <h1>数据工厂</h1>
              <span className="data-factory-status"><i />服务就绪</span>
            </div>
            <p>把测试数据生成、格式转换与开发计算集中在一个高效工作台中。</p>
          </div>
        </div>
        <div className="data-factory-summary" aria-label="数据工厂能力概览">
          <div><strong>{totalTools}</strong><span>工具</span></div>
          <div><strong>{categories.length}</strong><span>分类</span></div>
          <div className="data-factory-summary-live"><Activity className="h-4 w-4" /><span>即时处理</span></div>
        </div>
      </header>

      {loading ? (
        <div className="data-factory-page-loading">
          <Loader2 className="h-6 w-6 animate-spin" />
          <div><strong>正在准备工具集</strong><span>加载数据生成与转换能力…</span></div>
        </div>
      ) : (
        <div className={`data-factory-shell ${selectedTool ? 'has-selection' : ''}`}>
          <nav className="data-factory-category-rail" aria-label="工具分类">
            <div className="data-factory-rail-label">分类</div>
            <div className="data-factory-category-list">
              {categories.map((category) => {
                const isActive = activeCategory?.id === category.id
                return (
                  <Tooltip key={category.id} content={`${category.name} · ${category.tools.length} 个工具`} placement="right">
                    <button
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => {
                        setActiveCategoryId(category.id)
                        setSelectedToolId(null)
                        setSearchQuery('')
                      }}
                      className={`data-factory-category ${isActive ? 'is-active' : ''}`}
                    >
                      <span className="data-factory-category-icon">
                        <ToolIcon name={category.icon} className="h-[18px] w-[18px] stroke-[1.8]" />
                      </span>
                      <span>{category.name}</span>
                      <small>{category.tools.length}</small>
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </nav>

          <div className="data-factory-mobile-category">
            <label htmlFor="data-factory-category-select">能力分类</label>
            <select
              id="data-factory-category-select"
              value={activeCategory?.id ?? ''}
              onChange={(event) => {
                setActiveCategoryId(event.target.value)
                setSelectedToolId(null)
                setSearchQuery('')
              }}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} · {category.tools.length} 个工具
                </option>
              ))}
            </select>
          </div>

          <aside className="data-factory-tool-browser" aria-label="工具库">
            {activeCategory && (
              <div className="data-factory-browser-heading">
                <div className="data-factory-browser-title">
                  <span><ToolIcon name={activeCategory.icon} className="h-[18px] w-[18px] stroke-[1.8]" /></span>
                  <div>
                    <small>当前分类</small>
                    <h2>{activeCategory.name}</h2>
                  </div>
                </div>
                <p>{activeCategory.description}</p>
              </div>
            )}

            <label className="data-factory-search" htmlFor="data-factory-search-input">
              <Search className="h-4 w-4" />
              <input
                id="data-factory-search-input"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索当前分类工具"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} aria-label="清空搜索">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>

            <div className="data-factory-browser-meta">
              <span>工具列表</span>
              <small>{filteredTools.length} / {activeCategory?.tools.length ?? 0}</small>
            </div>

            <motion.section
              key={`${activeCategory?.id ?? 'tools'}-${searchQuery}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
              className="data-factory-tool-list"
              aria-label={activeCategory ? `${activeCategory.name}工具列表` : '工具列表'}
            >
              {filteredTools.map((tool, index) => (
                <ToolMiniCard
                  key={tool.id}
                  tool={tool}
                  onClick={() => setSelectedToolId(tool.id)}
                  index={index}
                  selected={selectedToolId === tool.id}
                />
              ))}
              {filteredTools.length === 0 && (
                <div className="data-factory-search-empty">
                  <Search className="h-5 w-5" />
                  <strong>没有找到匹配工具</strong>
                  <span>尝试缩短关键词或清空搜索条件。</span>
                </div>
              )}
            </motion.section>
          </aside>

          <main className="data-factory-workbench">
            <AnimatePresence mode="wait">
              {selectedTool ? (
                <ToolWorkspace key={selectedTool.id} tool={selectedTool} onClose={() => setSelectedToolId(null)} />
              ) : (
                <motion.section
                  key={activeCategory?.id ?? 'welcome'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="data-factory-welcome"
                >
                  <div className="data-factory-welcome-visual" aria-hidden="true">
                    <span className="data-factory-orbit orbit-one" />
                    <span className="data-factory-orbit orbit-two" />
                    <div><Sparkles className="h-7 w-7" /></div>
                  </div>
                  <span className="data-factory-welcome-kicker">WORKSPACE READY</span>
                  <h2>选择工具，开始构造数据</h2>
                  <p>{activeCategory?.description ?? '从左侧工具库选择一项能力，配置参数后即可获得结果。'}</p>
                  <div className="data-factory-flow" aria-label="使用流程">
                    <div><span>01</span><strong>选择工具</strong><small>浏览或搜索工具库</small></div>
                    <ChevronRight className="h-4 w-4" />
                    <div><span>02</span><strong>配置参数</strong><small>填写生成与转换条件</small></div>
                    <ChevronRight className="h-4 w-4" />
                    <div><span>03</span><strong>获取结果</strong><small>复制或继续批量生成</small></div>
                  </div>
                  {activeCategory?.tools[0] && (
                    <button
                      type="button"
                      className="data-factory-start-button"
                      onClick={() => setSelectedToolId(activeCategory.tools[0].id)}
                    >
                      推荐：{activeCategory.tools[0].name}
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </main>
        </div>
      )}
    </div>
  )
}

