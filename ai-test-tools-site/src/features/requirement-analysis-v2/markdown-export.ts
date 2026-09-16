/** 需求分析 Markdown 导出（纯函数）：固定章节顺序、诚实口径、转义用户内容 */

import type { AnalysisRecordDetail, RtmView } from './analysis-api'

const ISSUE_TYPE_LABEL: Record<string, string> = { ambiguity: '歧义', missing: '缺失', conflict: '冲突', untestable: '不可测' }
const SEVERITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' }
const ISSUE_STATUS_LABEL: Record<string, string> = { open: '待澄清', resolved: '已澄清', accepted: '已接受' }
const CRITERION_STATUS_LABEL: Record<string, string> = { pending: '待确认', confirmed: '已确认', rejected: '已驳回' }
const CONDITION_KIND_LABEL: Record<string, string> = { normal: '正常', boundary: '边界', exception: '异常' }
const RELAY_LABEL: Record<string, string> = { none: '未接力', relayed: '已接力', generated: '已生成用例' }

/** 表格/行内文本转义：管道符与反斜杠，防止破坏 Markdown 结构 */
function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n/g, '\n')
}

/** 原文放进动态长度围栏，内容里的 ``` 不会提前闭合 */
function fenced(text: string): string {
  let ticks = 3
  while (text.includes('`'.repeat(ticks))) ticks += 1
  const fence = '`'.repeat(ticks)
  return `${fence}\n${text}\n${fence}`
}

/** 生成完整 Markdown 文档；rtm 为 null 时覆盖率区显示未知 */
export function buildAnalysisMarkdown(record: AnalysisRecordDetail, rtm: RtmView | null): string {
  const reqTextById = new Map(record.requirements.map((r) => [r.id, r.text]))
  const lines: string[] = []

  lines.push(`# ${record.title}`)
  lines.push('')
  lines.push(`> 来源：${record.sourceFileName ?? '粘贴文本'} · 问题 ${record.issues.length} · 准则 ${record.criteria.length} · 条件 ${record.conditions.length}`)
  lines.push('')

  lines.push('## 需求条目')
  lines.push('')
  if (record.requirements.length === 0) {
    lines.push('_未分解出需求条目_')
  }
  for (const req of [...record.requirements].sort((a, b) => a.sort - b.sort)) {
    lines.push(`${'- '.repeat(1)}${'  '.repeat(req.level)}${req.text}`)
  }
  lines.push('')

  lines.push('## 问题日志')
  lines.push('')
  if (record.issues.length === 0) {
    lines.push('_未发现问题_')
  }
  for (const issue of record.issues) {
    lines.push(`### [${ISSUE_TYPE_LABEL[issue.type] ?? issue.type}] 严重度 ${SEVERITY_LABEL[issue.severity] ?? issue.severity} · ${ISSUE_STATUS_LABEL[issue.status] ?? issue.status}`)
    lines.push('')
    lines.push(`- 需求条目：${esc(issue.reqId ? (reqTextById.get(issue.reqId) ?? issue.reqId) : '—')}`)
    lines.push(`- 原文引用：${esc(issue.quote)}`)
    lines.push(`- 问题描述：${esc(issue.description)}`)
    if (issue.example) lines.push(`- 示例：${esc(issue.example)}`)
    if (issue.suggestedQuestion) lines.push(`- 建议澄清：${esc(issue.suggestedQuestion)}`)
    lines.push('')
  }

  lines.push('## 验收准则')
  lines.push('')
  if (record.criteria.length === 0) {
    lines.push('_未产生验收准则改写_')
  }
  for (const criterion of record.criteria) {
    lines.push(`### ${CRITERION_STATUS_LABEL[criterion.status] ?? criterion.status} · ${esc(reqTextById.get(criterion.reqId) ?? criterion.reqId)}`)
    lines.push('')
    lines.push(`- 原文：${esc(criterion.originalText)}`)
    lines.push(`- 可测化改写：${esc(criterion.rewrittenText)}`)
    lines.push('')
  }

  lines.push('## 测试条件')
  lines.push('')
  if (record.conditions.length === 0) {
    lines.push('_未产出测试条件_')
  }
  const conditions = [...record.conditions].sort((a, b) => a.sort - b.sort)
  for (const condition of conditions) {
    const reqText = condition.reqId ? (reqTextById.get(condition.reqId) ?? condition.reqId) : '通用'
    lines.push(`- [${CONDITION_KIND_LABEL[condition.kind] ?? condition.kind}] ${esc(condition.text)}（${esc(reqText)} · ${RELAY_LABEL[condition.relay] ?? condition.relay}${condition.testsetId ? ` · 用例集 ${condition.testsetId}` : ''}）`)
  }
  lines.push('')

  lines.push('## 追溯矩阵')
  lines.push('')
  if (rtm) {
    lines.push(`已关联用例集的条件比例：${rtm.coverage}%（${rtm.coveredConditions}/${rtm.totalConditions}）——表示条件与用例集的关联覆盖，不代表已执行或通过。`)
  } else {
    lines.push('追溯数据未知。')
  }
  lines.push('')

  lines.push('## 需求原文')
  lines.push('')
  lines.push(fenced(record.sourceText))
  lines.push('')

  return lines.join('\n')
}

/** 浏览器端触发下载：Blob + 安全文件名 */
export function downloadAnalysisMarkdown(record: AnalysisRecordDetail, rtm: RtmView | null): void {
  const markdown = buildAnalysisMarkdown(record, rtm)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const safeTitle = record.title.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80) || 'analysis'
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeTitle}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}
