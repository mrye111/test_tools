import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileDown,
  FileText,
  ImageDown,
  ListTree,
  Map as MapIcon,
  Network,
  RotateCcw,
  Settings,
  Share2,
} from 'lucide-react'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { getPreferredAiConfig } from '../shared/api-types'
import {
  analyzeRequirement,
  exportRequirementXmind,
  REQUIREMENT_HANDOFF_KEY,
  type AnalysisStage,
  type AnalyzeRequirementInput,
  type Finding,
  type RequirementAnalysisResult,
  type RequirementChartType,
  type RequirementNode,
} from '../lib/requirement-analysis-api'
import {
  buildFreeMindXml,
  buildMarkdownOutline,
  downloadDataUrl,
  downloadTextFile,
  findingCountByNode,
} from '../lib/requirement-export'
import { RequirementInput } from '../features/requirement-analysis/RequirementInput'
import { AnalysisProgress } from '../features/requirement-analysis/AnalysisProgress'
import { MindMapView, type ChartExportHandle } from '../features/requirement-analysis/MindMapView'
import { TreeChartView } from '../features/requirement-analysis/TreeChartView'
import { FindingsPanel } from '../features/requirement-analysis/FindingsPanel'

const CHART_TABS: Array<{ type: RequirementChartType; label: string; icon: typeof MapIcon }> = [
  { type: 'mindmap', label: '思维导图', icon: MapIcon },
  { type: 'tree', label: '树状图', icon: ListTree },
  { type: 'logic', label: '逻辑图', icon: Network },
]

function indexNodeTitles(tree: RequirementNode): Map<string, string> {
  const index = new Map<string, string>()
  const walk = (node: RequirementNode) => {
    index.set(node.id, node.title)
    node.children.forEach(walk)
  }
  walk(tree)
  return index
}

export function RequirementAnalysisPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'input' | 'analyzing' | 'result'>('input')
  const [stage, setStage] = useState<AnalysisStage>('parsing')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RequirementAnalysisResult | null>(null)
  const [chartType, setChartType] = useState<RequirementChartType>('mindmap')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null)
  const [showSourceText, setShowSourceText] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const chartRef = useRef<ChartExportHandle | null>(null)

  const findingCounts = useMemo(
    () => (result ? findingCountByNode(result.findings) : new Map<string, number>()),
    [result],
  )
  const nodeTitles = useMemo(() => (result ? indexNodeTitles(result.tree) : new Map<string, string>()), [result])

  const handleAnalyze = useCallback(async (input: AnalyzeRequirementInput) => {
    const provider = loadStoredModelConfig()
    const aiConfig = provider ? getPreferredAiConfig(provider) : null
    if (!aiConfig) {
      setPhase('analyzing')
      setStage('parsing')
      setWarnings([])
      setError('请先在模型设置中配置统一供应商，再开始需求分析。')
      return
    }

    setPhase('analyzing')
    setStage('parsing')
    setWarnings([])
    setError(null)
    setResult(null)
    setSelectedNodeId(null)
    setActiveFindingId(null)

    try {
      const analysis = await analyzeRequirement(input, aiConfig, async (event) => {
        if (event.type === 'stage') setStage(event.stage)
        if (event.type === 'warning') setWarnings((current) => [...current, ...event.warnings])
        if (event.type === 'error') setError(event.message)
      })
      setResult(analysis)
      setPhase('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : '需求分析失败，请稍后重试。')
    }
  }, [])

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
    setActiveFindingId(null)
  }, [])

  const handleSelectFinding = useCallback((finding: Finding) => {
    setActiveFindingId(finding.id)
    setSelectedNodeId(finding.nodeId)
  }, [])

  useEffect(() => {
    if (!selectedNodeId || activeFindingId || !result) return
    const firstLinked = result.findings.find((finding) => finding.nodeId === selectedNodeId)
    if (firstLinked) {
      document.getElementById(`finding-${firstLinked.id}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedNodeId, activeFindingId, result])

  const handleExport = async (kind: 'xmind' | 'freemind' | 'markdown' | 'png') => {
    if (!result) return
    setExporting(kind)
    setError(null)
    try {
      const title = result.title || '需求分析'
      if (kind === 'xmind') {
        await exportRequirementXmind({ title, tree: result.tree, findings: result.findings, chartType })
      } else if (kind === 'freemind') {
        downloadTextFile(buildFreeMindXml(result), `${title}.mm`, 'text/xml')
      } else if (kind === 'markdown') {
        downloadTextFile(buildMarkdownOutline(result), `${title}.md`, 'text/markdown')
      } else {
        const dataUrl = await chartRef.current?.getPngDataUrl()
        if (!dataUrl) throw new Error('当前图表暂不支持导出 PNG，请切换图表后重试。')
        downloadDataUrl(dataUrl, `${title}.png`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
    } finally {
      setExporting(null)
    }
  }

  const handleHandoff = () => {
    if (!result) return
    localStorage.setItem(REQUIREMENT_HANDOFF_KEY, JSON.stringify({
      requirement: result.sourceText,
      name: result.title,
    }))
    navigate('/testcase')
  }

  const resetToInput = () => {
    setPhase('input')
    setError(null)
    setWarnings([])
    setResult(null)
    setSelectedNodeId(null)
    setActiveFindingId(null)
  }

  return (
    <div className="page-shell requirement-page">
      <header className="testcase-workspace-header">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="icon-action h-10 w-10 shrink-0 rounded-xl" aria-label="返回首页">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="page-title"><span className="text-gradient">需求分析</span></h1>
            <p className="page-subtitle">上传需求文档或粘贴文本，AI 以测试视角产出需求分解树与分析结论</p>
          </div>
        </div>
        <Link to="/settings" className="secondary-action shrink-0 px-3 py-2 text-xs no-underline">
          <Settings className="h-3.5 w-3.5" />模型设置
        </Link>
      </header>

      {phase !== 'result' && (
        <main className="requirement-input-layout">
          <RequirementInput running={phase === 'analyzing' && !error} onSubmit={(input) => void handleAnalyze(input)} />
          {phase === 'analyzing' && (
            <>
              <AnalysisProgress stage={stage} warnings={warnings} error={error} />
              {error && (
                <button type="button" className="secondary-action px-4 py-2.5 text-sm" onClick={resetToInput}>
                  <RotateCcw className="h-4 w-4" />返回重新输入
                </button>
              )}
            </>
          )}
        </main>
      )}

      {phase === 'result' && result && (
        <main className="requirement-result-layout">
          <div className="surface-panel requirement-result-toolbar">
            <div className="requirement-chart-tabs" role="tablist" aria-label="分析结果图表类型">
              {CHART_TABS.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.type}
                    type="button"
                    role="tab"
                    aria-selected={chartType === tab.type}
                    className={`requirement-chart-tab${chartType === tab.type ? ' is-active' : ''}`}
                    onClick={() => setChartType(tab.type)}
                  >
                    <Icon className="h-3.5 w-3.5" />{tab.label}
                  </button>
                )
              })}
            </div>

            <div className="requirement-toolbar-actions">
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('xmind')}>
                <FileDown className="h-3.5 w-3.5" />XMind
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('freemind')}>
                <FileDown className="h-3.5 w-3.5" />FreeMind
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('markdown')}>
                <FileText className="h-3.5 w-3.5" />Markdown
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('png')}>
                <ImageDown className="h-3.5 w-3.5" />PNG
              </button>
              <button type="button" className="primary-action px-4 py-2 text-xs" onClick={handleHandoff}>
                <Share2 className="h-3.5 w-3.5" />基于此需求生成测试用例
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" onClick={resetToInput}>
                <RotateCcw className="h-3.5 w-3.5" />重新分析
              </button>
            </div>
          </div>

          {error && <p className="field-error">{error}</p>}
          {result.warnings.length > 0 && (
            <ul className="requirement-warning-list surface-panel">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="requirement-result-grid">
            <section className="surface-panel requirement-chart-panel">
              <h2 className="requirement-panel-title">需求分解树<span className="requirement-title-suffix">{result.title}</span></h2>
              {chartType === 'mindmap' && (
                <MindMapView
                  ref={chartRef}
                  tree={result.tree}
                  findingCounts={findingCounts}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                />
              )}
              {chartType === 'tree' && (
                <TreeChartView
                  ref={chartRef}
                  tree={result.tree}
                  findingCounts={findingCounts}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  orientation="TB"
                />
              )}
              {chartType === 'logic' && (
                <TreeChartView
                  ref={chartRef}
                  tree={result.tree}
                  findingCounts={findingCounts}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  orientation="LR"
                />
              )}
            </section>

            <FindingsPanel
              findings={result.findings}
              nodeTitles={nodeTitles}
              activeFindingId={activeFindingId}
              selectedNodeId={selectedNodeId}
              onSelectFinding={handleSelectFinding}
            />
          </div>

          <section className="surface-panel requirement-source-panel">
            <button
              type="button"
              className="requirement-source-toggle"
              aria-expanded={showSourceText}
              onClick={() => setShowSourceText((current) => !current)}
            >
              {showSourceText ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              解析原文
              {result.truncated && <span className="requirement-source-note">（已截断）</span>}
            </button>
            {showSourceText && <pre className="requirement-source-text">{result.sourceText}</pre>}
          </section>
        </main>
      )}
    </div>
  )
}
