import {
  FINDING_TYPE_META,
  type Finding,
  type FindingType,
  type RequirementAnalysisResult,
  type RequirementNode,
} from './requirement-analysis-api'

/** 每个节点关联的分析结论数量（用于图表角标）。 */
export function findingCountByNode(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const finding of findings) {
    counts.set(finding.nodeId, (counts.get(finding.nodeId) ?? 0) + 1)
  }
  return counts
}

/** 树节点标题附带结论角标，如「登录模块 ⚠2」。 */
export function nodeLabelWithBadge(node: RequirementNode, counts: Map<string, number>): string {
  const count = counts.get(node.id) ?? 0
  return count > 0 ? `${node.title} ⚠${count}` : node.title
}

const FINDING_EXPORT_ORDER: FindingType[] = ['risk', 'ambiguity', 'clarification']

function findingsByType(findings: Finding[]): Array<{ type: FindingType; items: Finding[] }> {
  return FINDING_EXPORT_ORDER
    .map((type) => ({ type, items: findings.filter((finding) => finding.type === type) }))
    .filter((group) => group.items.length > 0)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function nodeTitleIndex(tree: RequirementNode): Map<string, string> {
  const index = new Map<string, string>()
  const walk = (node: RequirementNode) => {
    index.set(node.id, node.title)
    node.children.forEach(walk)
  }
  walk(tree)
  return index
}

function findingSummaryLine(finding: Finding): string {
  return `[${FINDING_TYPE_META[finding.type].label}] ${finding.title}`
}

/** FreeMind XML：分解树为主干，结论作为「分析结论」子节点挂在对应节点下。 */
export function buildFreeMindXml(result: RequirementAnalysisResult): string {
  const counts = findingCountByNode(result.findings)
  const findingsByNode = new Map<string, Finding[]>()
  for (const finding of result.findings) {
    const list = findingsByNode.get(finding.nodeId) ?? []
    list.push(finding)
    findingsByNode.set(finding.nodeId, list)
  }

  const renderNode = (node: RequirementNode, depth: number): string => {
    const indent = '  '.repeat(depth + 1)
    const lines: string[] = [`${indent}<node TEXT="${escapeXml(nodeLabelWithBadge(node, counts))}">`]
    for (const child of node.children) lines.push(renderNode(child, depth + 1))
    const nodeFindings = findingsByNode.get(node.id) ?? []
    if (nodeFindings.length) {
      lines.push(`${indent}  <node TEXT="${escapeXml('分析结论')}">`)
      for (const finding of nodeFindings) {
        const text = finding.detail ? `${findingSummaryLine(finding)}：${finding.detail}` : findingSummaryLine(finding)
        lines.push(`${indent}    <node TEXT="${escapeXml(text)}"/>`)
      }
      lines.push(`${indent}  </node>`)
    }
    lines.push(`${indent}</node>`)
    return lines.join('\n')
  }

  return `<map version="1.0.1">\n${renderNode(result.tree, 0)}\n</map>\n`
}

/** Markdown 大纲：嵌套列表 + 文末「风险与待澄清」章节。 */
export function buildMarkdownOutline(result: RequirementAnalysisResult): string {
  const titleIndex = nodeTitleIndex(result.tree)
  const lines: string[] = [`# ${result.title || '需求分析'}`, '', '## 需求分解树', '']

  const walk = (node: RequirementNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${node.title}`)
    node.children.forEach((child) => walk(child, depth + 1))
  }
  walk(result.tree, 0)

  lines.push('', '## 风险与待澄清', '')
  if (!result.findings.length) {
    lines.push('暂无分析结论。')
  } else {
    for (const group of findingsByType(result.findings)) {
      lines.push(`### ${FINDING_TYPE_META[group.type].label}`, '')
      for (const finding of group.items) {
        const nodeTitle = titleIndex.get(finding.nodeId)
        const suffix = nodeTitle ? `（关联：${nodeTitle}）` : ''
        lines.push(`- **${finding.title}**${suffix}${finding.detail ? `：${finding.detail}` : ''}`)
      }
      lines.push('')
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.click()
}
