import { AlertTriangle, CircleHelp, Diamond } from 'lucide-react'
import { FINDING_TYPE_META, type Finding, type FindingType } from '../../lib/requirement-analysis-api'

const FINDING_TYPE_ORDER: FindingType[] = ['risk', 'ambiguity', 'clarification']

const FINDING_TYPE_ICONS: Record<FindingType, typeof AlertTriangle> = {
  risk: AlertTriangle,
  ambiguity: Diamond,
  clarification: CircleHelp,
}

type FindingsPanelProps = {
  findings: Finding[]
  nodeTitles: Map<string, string>
  activeFindingId: string | null
  selectedNodeId: string | null
  onSelectFinding: (finding: Finding) => void
}

/** 分析结论面板：按类型分组展示，与图表节点双向联动。 */
export function FindingsPanel(props: FindingsPanelProps) {
  const groups = FINDING_TYPE_ORDER
    .map((type) => ({ type, items: props.findings.filter((finding) => finding.type === type) }))
    .filter((group) => group.items.length > 0)

  if (!groups.length) {
    return (
      <aside className="surface-panel requirement-findings-panel">
        <h2 className="requirement-panel-title">分析结论</h2>
        <p className="requirement-findings-empty">本次分析未发现明显风险点、歧义点或待澄清问题。</p>
      </aside>
    )
  }

  return (
    <aside className="surface-panel requirement-findings-panel">
      <h2 className="requirement-panel-title">
        分析结论
        <span className="requirement-findings-total">{props.findings.length}</span>
      </h2>
      {groups.map((group) => {
        const Icon = FINDING_TYPE_ICONS[group.type]
        return (
          <section key={group.type} className="requirement-finding-group">
            <h3 className={`requirement-finding-group-title is-${group.type}`}>
              <Icon className="h-3.5 w-3.5" />
              {FINDING_TYPE_META[group.type].label}
              <span>{group.items.length}</span>
            </h3>
            <ul className="requirement-finding-list">
              {group.items.map((finding) => {
                const nodeTitle = props.nodeTitles.get(finding.nodeId)
                const isActive = finding.id === props.activeFindingId
                const isLinked = finding.nodeId === props.selectedNodeId
                return (
                  <li key={finding.id}>
                    <button
                      type="button"
                      id={`finding-${finding.id}`}
                      className={`requirement-finding-item${isActive ? ' is-active' : ''}${isLinked ? ' is-linked' : ''}`}
                      onClick={() => props.onSelectFinding(finding)}
                    >
                      <span className="requirement-finding-title">{finding.title}</span>
                      {finding.detail && <span className="requirement-finding-detail">{finding.detail}</span>}
                      {nodeTitle && <span className="requirement-finding-node">关联节点：{nodeTitle}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
