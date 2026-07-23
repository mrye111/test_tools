import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Layers, Loader2, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { TemplateTab } from '../components/jmeter/TemplateTab'
import { AIGenerateTab } from '../components/jmeter/AIGenerateTab'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { getJmeterHealth, getJmeterTools, type JmeterHealth, type JmeterTool } from '../lib/jmeter-api'
import { Tooltip } from '../components/ui/Tooltip'

type TabKey = 'template' | 'ai'

const tabs = [
  { key: 'template' as TabKey, label: '模板选择', icon: Layers, description: '预设模板，填写参数即生成' },
  { key: 'ai' as TabKey, label: 'AI 生成', icon: Sparkles, description: '自然语言驱动工具调用生成脚本' },
]

export function JmeterPage() {
  const { showError } = useErrorDialog()
  const [activeTab, setActiveTab] = useState<TabKey>('template')
  const [loading, setLoading] = useState(true)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [, setHealth] = useState<JmeterHealth | null>(null)
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

  useEffect(() => {
    if (!backendError) return
    showError(backendError, {
      title: 'JMeter 服务连接失败',
      fallbackMessage: 'JMeter 后端服务暂不可用，请检查服务状态后重试。',
    })
  }, [backendError, showError])

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回首页">
            <Link to="/" className="icon-action h-10 w-10 rounded-xl">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Tooltip>
          <div>
            <h1 className="page-title">Jmeter <span className="text-gradient">脚本生成器</span></h1>
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

      {/* Tab Bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 max-sm:grid-cols-1 max-sm:gap-2">
        {tabs.map((tab, i) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`motion-card stagger-${
                i + 1
              } group flex items-center gap-3.5 rounded-[20px] px-5 py-3.5 text-left transition-all duration-300 ${
                isActive
                  ? '!border-accent/50 !bg-gradient-to-br !from-accent !to-accent-strong !text-white !shadow-[0_24px_46px_-30px_oklch(0.56_0.24_208/0.75)]'
                  : ''
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300 ${
                  isActive
                    ? 'bg-white/20 text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.2)]'
                    : 'bg-accent/7 text-muted group-hover:text-accent'
                }`}
              >
                <Icon className="h-[18px] w-[18px] stroke-[1.8]" />
              </div>
              <div>
                <div className={`text-[14px] font-semibold ${isActive ? 'text-white' : 'text-fg'}`}>
                  {tab.label}
                </div>
                <div
                  className={`text-[11.5px] leading-[1.5] max-sm:hidden ${
                    isActive ? 'text-white/70' : 'text-muted'
                  }`}
                >
                  {tab.description}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="surface-panel motion-card stagger-3 rounded-[26px] p-6 max-sm:p-4">
        <div className="relative z-[1]">
          {activeTab === 'template' && <TemplateTab />}
          {activeTab === 'ai' && (
            <AIGenerateTab tools={tools} loading={loading} backendError={backendError} />
          )}
        </div>
      </div>
    </div>
  )
}
