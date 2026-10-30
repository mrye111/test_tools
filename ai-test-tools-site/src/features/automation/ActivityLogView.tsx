/** P6 活动日志：项目级审计表（谁 / 何时 / 触发了什么——运行、编辑、生成）。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ScrollText } from 'lucide-react'
import { listProjectActivity, type ActivityEntry } from '../../lib/automation-api'

const ACTION_BADGE: Record<ActivityEntry['action'], { label: string; cls: string }> = {
  run: { label: '运行', cls: 'at-badge-blue' },
  edit: { label: '编辑', cls: 'at-badge-violet' },
  generate: { label: '生成', cls: 'at-badge-cyan' },
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ActivityLogView({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const refresh = useCallback(() => {
    setLoading(true)
    listProjectActivity(projectId, 100)
      .then((list) => {
        if (mountedRef.current) setEntries(list)
      })
      .catch(() => {
        if (mountedRef.current) setEntries([])
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [projectId])

  useEffect(() => {
    mountedRef.current = true
    refresh()
    return () => {
      mountedRef.current = false
    }
  }, [refresh])

  return (
    <div className="at-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 className="at-subtitle" style={{ margin: 0 }}>项目活动</h3>
        <button className="at-btn at-btn-sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={12} />刷新
        </button>
      </div>
      {loading && entries.length === 0 ? (
        <p className="at-muted at-small">加载活动…</p>
      ) : entries.length === 0 ? (
        <div className="at-empty">
          <ScrollText size={28} />
          <div>还没有活动记录</div>
          <div className="at-small at-muted">运行用例、编辑用例、生成提案后，这里会留下审计痕迹</div>
        </div>
      ) : (
        <table className="at-table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>时间</th>
              <th style={{ width: 110 }}>谁</th>
              <th style={{ width: 80 }}>动作</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const badge = ACTION_BADGE[entry.action] ?? { label: entry.action, cls: 'at-badge-gray' }
              return (
                <tr key={entry.id}>
                  <td className="at-muted at-small">{formatWhen(entry.createdAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{entry.actor}</td>
                  <td><span className={`at-badge ${badge.cls}`}>{badge.label}</span></td>
                  <td className="at-small">{entry.detail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
