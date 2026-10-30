/** 项目工作台（/automation/p/:projectId/:section?）：子导航 + 各区常驻挂载。 */

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, Bot, ClipboardList, FlaskConical, History, Radar, ScrollText, Settings2 } from 'lucide-react'
import { listAutomationProjects } from '../../lib/automation-api'
import { ActivityLogView } from './ActivityLogView'
import { BenchView } from './BenchView'
import { CaseListView } from './CaseListView'
import { InsightsView } from './InsightsView'
import { PlanReviewView } from './PlanReviewView'
import { ProjectSettingsView } from './ProjectSettingsView'
import { RunHistoryView } from './RunHistoryView'
import { SourcesView } from './SourcesView'

type SectionKey = 'sources' | 'plan' | 'cases' | 'bench' | 'runs' | 'insights' | 'activity' | 'settings'

const SECTIONS: { key: SectionKey; label: string; icon: typeof Radar }[] = [
  { key: 'sources', label: '探源', icon: Radar },
  { key: 'plan', label: '规划', icon: ClipboardList },
  { key: 'cases', label: '用例', icon: Bot },
  { key: 'bench', label: '执行台', icon: FlaskConical },
  { key: 'runs', label: '运行', icon: History },
  { key: 'insights', label: '洞察', icon: BarChart3 },
  { key: 'activity', label: '活动', icon: ScrollText },
  { key: 'settings', label: '设置', icon: Settings2 },
]

export function ProjectWorkbenchView() {
  const { projectId = '', section = 'cases' } = useParams<{ projectId: string; section?: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<{ id: string; name: string; systemUrl: string } | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    listAutomationProjects()
      .then((list) => {
        if (cancelled) return
        const found = list.find((p) => p.id === projectId)
        if (found) setProject(found)
        else setMissing(true)
      })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const active: SectionKey = SECTIONS.some((s) => s.key === section) ? (section as SectionKey) : 'cases'

  if (missing) {
    return (
      <div className="at-page">
        <div className="at-card">
          <div className="at-empty">
            <Bot size={28} />
            <div>项目不存在或已被删除</div>
            <button className="at-btn" style={{ marginTop: 6 }} onClick={() => navigate('/automation')}>返回项目列表</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="at-page">
      <div className="at-header">
        <div>
          <button className="at-btn at-btn-sm" style={{ marginBottom: 6 }} onClick={() => navigate('/automation')}>
            <ArrowLeft size={13} />全部项目
          </button>
          <h1 className="at-title" style={{ fontSize: 20 }}>{project?.name ?? '…'}</h1>
          <p className="at-subtitle">{project?.systemUrl || '未设置入口地址'}</p>
        </div>
      </div>
      <div className="at-tabs" role="tablist" aria-label="项目工作台导航">
        {SECTIONS.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={active === s.key}
              className={`at-tab ${active === s.key ? 'is-active' : ''}`}
              onClick={() => navigate(`/automation/p/${projectId}/${s.key}`)}
            >
              <Icon size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
              {s.label}
            </button>
          )
        })}
      </div>

      {/* 用例/执行台/运行常驻挂载：执行台的浏览器会话不因切区销毁（评审 M7） */}
      <div style={{ display: active === 'sources' ? '' : 'none' }}>
        <SourcesView projectId={projectId} systemUrl={project?.systemUrl ?? ''} />
      </div>
      <div style={{ display: active === 'plan' ? '' : 'none' }}>
        <PlanReviewView projectId={projectId} systemUrl={project?.systemUrl ?? ''} />
      </div>
      <div style={{ display: active === 'cases' ? '' : 'none' }}><CaseListView projectId={projectId} /></div>
      <div style={{ display: active === 'bench' ? '' : 'none' }}><BenchView /></div>
      <div style={{ display: active === 'runs' ? '' : 'none' }}><RunHistoryView projectId={projectId} /></div>
      <div style={{ display: active === 'insights' ? '' : 'none' }}>
        {active === 'insights' && <InsightsView projectId={projectId} />}
      </div>
      <div style={{ display: active === 'activity' ? '' : 'none' }}>
        {active === 'activity' && <ActivityLogView projectId={projectId} />}
      </div>
      <div style={{ display: active === 'settings' ? '' : 'none' }}>
        {active === 'settings' && <ProjectSettingsView projectId={projectId} projectName={project?.name ?? ''} systemUrl={project?.systemUrl ?? ''} />}
      </div>
    </div>
  )
}
