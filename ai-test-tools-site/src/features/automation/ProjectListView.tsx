/** 项目列表（/automation）：项目 + 自动化用例数 + 最近一次运行结论 + 新建入口。 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Globe, ListChecks, Plus, Search } from 'lucide-react'
import { listAutomationProjects, type AutomationProjectSummary } from '../../lib/automation-api'

function timeAgo(iso?: string): string {
  if (!iso) return '从未运行'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

function ResultBadge({ item }: { item: AutomationProjectSummary }) {
  const stats = item.lastRunStats
  if (!stats || stats.total === 0) return <span className="at-muted at-small">尚无运行</span>
  return (
    <span className="at-proj-result">
      {stats.passed > 0 && <span className="at-badge at-badge-green">{stats.passed} 通过</span>}
      {stats.failed > 0 && <span className="at-badge at-badge-red">{stats.failed} 失败</span>}
      {stats.partial > 0 && <span className="at-badge at-badge-amber">{stats.partial} 部分</span>}
      <span className="at-muted at-small">共 {stats.total}</span>
    </span>
  )
}

export function ProjectListView() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<AutomationProjectSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await listAutomationProjects())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = projects.filter((p) => {
    const q = query.trim().toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || p.systemUrl.toLowerCase().includes(q)
  })

  return (
    <div className="at-page">
      <div className="at-header">
        <div>
          <h1 className="at-title">自动化测试</h1>
          <p className="at-subtitle">选择一个项目进入工作台，或新建项目开始</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="at-btn" onClick={() => navigate('/automation/lists')}>
            <ListChecks size={14} />Test Lists · 定时
          </button>
          <button className="at-btn at-btn-primary" onClick={() => navigate('/automation/new')}>
            <Plus size={14} />新建项目
          </button>
        </div>
      </div>

      <div className="at-toolbar">
        <div className="at-proj-search">
          <Search size={14} className="at-muted" />
          <input
            className="at-input"
            style={{ border: 'none', background: 'transparent', flex: 1, outline: 'none' }}
            placeholder="搜索项目名称 / 地址"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索项目"
          />
        </div>
      </div>

      {error && <p className="at-note" style={{ marginBottom: 12, color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && filtered.length === 0 && projects.length === 0 && (
        <div className="at-card">
          <div className="at-empty">
            <Bot size={28} />
            <div>还没有自动化项目</div>
            <div className="at-small at-muted">新建一个项目，把被测系统的地址交给 AI，它会探索并帮你写测试</div>
            <button className="at-btn at-btn-primary" style={{ marginTop: 6 }} onClick={() => navigate('/automation/new')}>
              <Plus size={14} />新建第一个项目
            </button>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && projects.length > 0 && (
        <p className="at-muted at-small" style={{ padding: '20px 4px' }}>没有匹配「{query}」的项目</p>
      )}

      <div className="at-proj-grid">
        {filtered.map((p) => (
          <button key={p.id} type="button" className="at-proj-card" onClick={() => navigate(`/automation/p/${p.id}/cases`)}>
            <div className="at-proj-card-top">
              <span className="at-proj-name">{p.name}</span>
              <ResultBadge item={p} />
            </div>
            <div className="at-proj-url">
              <Globe size={12} />
              <span>{p.systemUrl || '未设置入口地址'}</span>
            </div>
            <div className="at-proj-meta">
              <span>{p.caseCount} 条用例</span>
              <span className="at-muted">{timeAgo(p.lastRunAt)}</span>
            </div>
          </button>
        ))}
      </div>

      {loading && <p className="at-muted at-small" style={{ padding: 28, textAlign: 'center' }}>加载中…</p>}
    </div>
  )
}
