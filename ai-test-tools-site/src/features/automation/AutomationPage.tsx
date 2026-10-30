/** 自动化测试路由壳：/automation=项目列表；/automation/new=建项目向导；/automation/p/:id/:section=项目工作台；/automation/cases/:id=用例编辑器。 */

import { useParams } from 'react-router-dom'
import { CaseEditorView } from './CaseEditorView'
import './automation.css'

export { ProjectListView } from './ProjectListView'
export { ProjectWizardView } from './ProjectWizardView'
export { ProjectWorkbenchView } from './ProjectWorkbenchView'

/** 用例编辑器独立路由（/automation/cases/:id，id=new 为新建）。 */
export function AutomationCaseEditorPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="at-page">
      <CaseEditorView caseId={id ?? 'new'} />
    </div>
  )
}
