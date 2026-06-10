import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Layers, Loader2, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { TemplateTab } from '../components/jmeter/TemplateTab'
import { AIGenerateTab } from '../components/jmeter/AIGenerateTab'
import { getJmeterHealth, getJmeterTools, type JmeterHealth, type JmeterTool } from '../lib/jmeter-api'

type TabKey = 'template' | 'ai'

const tabs = [
  { key: 'template' as TabKey, label: '模板选择', icon: Layers, description: '预设模板，填写参数即生成' },
  { key: 'ai' as TabKey, label: 'AI 生成', icon: Sparkles, description: '自然语言驱动工具调用生成脚本' },
]

export function JmeterPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('template')
  const [loading, setLoading] = useState(true)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [health, setHealth] = useState<JmeterHealth | null>(null)
  const [tools, setTools] = useState<JmeterTool[]>([])

  const loadBackendMeta = async () => {
    setLoading(true)
    setBackendError(null)
    try {
      const [nextHealth, nextTools] = await Promise.all([
        getJmeterHealth(),
        getJmeterTools(),
      ])
      setHealth(nextHealth)
      setTools(nextTools)
    } catch (error) {
      setHealth(null)
      setTools([])
      setBackendError(error instanceof Error ? error.message : '后端服务未连接')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBackendMeta()
  }, [])

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="icon-action h-10 w-10"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="page-title">
              Jmeter 脚本生成器
            </h1>
            <p className="page-subtitle">
              模板选择与 AI 生成两种方式，直接驱动后端生成 .jmx 测试计划
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/settings"
            className="secondary-action px-3 py-2 text-xs no-underline"
          >
            <Settings className="h-3.5 w-3.5" />
            模型设置
          </Link>
          <button
            type="button"
            onClick={() => void loadBackendMeta()}
            disabled={loading}
            className="secondary-action px-3 py-2 text-xs disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新后端状态
          </button>
        </div>
      </div>

      <div className={`mb-5 px-4 py-3 ${
        backendError
          ? 'status-panel danger-panel'
          : 'status-panel'
      }`}>
        {backendError ? (
          <div className="relative z-[1] flex items-start gap-2 text-sm text-[#b91c1c]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">后端服务未连接</div>
              <div className="mt-1 text-xs leading-5">{backendError}</div>
            </div>
          </div>
        ) : (
          <div className="relative z-[1] flex flex-wrap items-center justify-between gap-3 text-sm text-[#1d4ed8]">
            <div className="flex items-center gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span className="font-semibold">
                {loading ? '正在连接后端...' : '后端服务已连接'}
              </span>
            </div>
            {health && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-[#475569]">
                <span>服务: {health.server}</span>
                <span>版本: {health.version}</span>
                <span>工具数: {tools.length || health.tools}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab Bar */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 max-sm:grid-cols-1 max-sm:gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`group motion-card flex items-center gap-3 rounded-2xl px-4 py-3 text-left ${
                isActive
                  ? 'border-[rgba(37,99,235,0.42)] bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] text-white shadow-[0_24px_46px_-30px_rgba(37,99,235,0.9)]'
                  : ''
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-[rgba(37,99,235,0.08)] text-muted group-hover:text-accent'
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div>
                <div className={`text-[13px] font-semibold ${isActive ? 'text-white' : 'text-fg'}`}>
                  {tab.label}
                </div>
                <div className={`text-[11px] max-sm:hidden ${isActive ? 'text-white/75' : 'text-muted'}`}>
                  {tab.description}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="surface-panel motion-card stagger-2 rounded-[24px] p-5 max-sm:p-3.5">
        <div className="relative z-[1]">
        {activeTab === 'template' && <TemplateTab />}
        {activeTab === 'ai' && (
          <AIGenerateTab
            tools={tools}
            loading={loading}
            backendError={backendError}
          />
        )}
        </div>
      </div>
    </div>
  )
}
