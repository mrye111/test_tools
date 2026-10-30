/** 用例编辑器：基本信息 + 结构化步骤 + 人工项 + 变量占位 + 从功能用例导入（编译预填）。 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Database,
  MinusCircle,
  Play,
  Plus,
  Trash2,
  User,
  Wand2,
} from 'lucide-react'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'
import {
  compileFunctionalCase,
  createAutomationCase,
  getAutomationCase,
  listAutomationCredentials,
  listAutomationSets,
  startAutomationRun,
  updateAutomationCase,
  type AutomationSet,
  type AutomationStep,
  type AutomationStepType,
  type CredentialItem,
  type ManualItem,
} from '../../lib/automation-api'
import { getTestCaseSet, listTestCaseProjects, listTestCaseSets } from '../../lib/testcase-api'
import { RunProgressModal, type RunProgressHandle } from './RunProgressModal'

type Project = { id: string; name: string }
type TestSetOption = { id: string; name: string }
type FunctionalCaseOption = { caseId: string; title: string; precondition: string; steps: string; expectedResult: string }

const STEP_TYPES: { value: AutomationStepType; label: string }[] = [
  { value: 'act', label: 'act 动作' },
  { value: 'assert', label: 'assert 断言' },
  { value: 'extract', label: 'extract 提取' },
  { value: 'wait', label: 'wait 等待' },
]

let stepSeq = 1
function newStep(type: AutomationStepType = 'act'): AutomationStep {
  return { id: stepSeq++, type, text: '', enabled: true }
}

export function CaseEditorView({ caseId }: { caseId: string }) {
  const isNew = caseId === 'new'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromFunctional = searchParams.get('from') === 'functional'
  // 工作台上下文带来的项目预选（用例管理 → 新建）
  const presetProject = searchParams.get('project') ?? ''

  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(presetProject)
  const [setId, setSetId] = useState('')
  const [entryUrl, setEntryUrl] = useState('')
  const [preconditionText, setPreconditionText] = useState('')
  const [varDefs, setVarDefs] = useState<[string, string][]>([])
  const [steps, setSteps] = useState<AutomationStep[]>([newStep()])
  const [manualItems, setManualItems] = useState<ManualItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [sets, setSets] = useState<AutomationSet[]>([])
  const [credentials, setCredentials] = useState<CredentialItem[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : caseId)
  const [runHandle, setRunHandle] = useState<RunProgressHandle | null>(null)
  const [engineMode, setEngineMode] = useState<'' | 'auto' | 'visual'>('')

  // 路由参数变化（/cases/1 → /cases/2）时同步 savedId（评审 L20）
  useEffect(() => {
    setSavedId(isNew ? null : caseId)
  }, [caseId, isNew])

  // 从功能用例导入的状态
  const [testSets, setTestSets] = useState<TestSetOption[]>([])
  const [testSetId, setTestSetId] = useState('')
  const [functionalCases, setFunctionalCases] = useState<FunctionalCaseOption[]>([])
  const [functionalCaseId, setFunctionalCaseId] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [compileNotes, setCompileNotes] = useState<string[]>([])

  useEffect(() => {
    listTestCaseProjects()
      .then((list) => setProjects((list as { projects?: Project[] }).projects ?? (list as unknown as Project[])))
      .catch(() => setProjects([]))
    listAutomationSets()
      .then((list) => setSets(list))
      .catch(() => setSets([]))
    listAutomationCredentials()
      .then((list) => setCredentials(list))
      .catch(() => setCredentials([]))
  }, [])

  useEffect(() => {
    if (isNew) return
    getAutomationCase(caseId)
      .then((item) => {
        setTitle(item.title)
        setProjectId(item.projectId)
        setSetId(item.setId ?? '')
        setEntryUrl(item.entryUrl)
        setPreconditionText(item.preconditionText)
        setVarDefs(Object.entries(item.varDefs))
        setSteps(item.steps.length > 0 ? item.steps : [newStep()])
        setManualItems(item.manualItems)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [caseId, isNew])

  useEffect(() => {
    if (!fromFunctional || !projectId) {
      setTestSets([])
      return
    }
    listTestCaseSets(projectId)
      .then((list) => setTestSets((list as { testSets?: TestSetOption[] }).testSets ?? (list as unknown as TestSetOption[])))
      .catch(() => setTestSets([]))
  }, [fromFunctional, projectId])

  useEffect(() => {
    if (!fromFunctional || !testSetId) {
      setFunctionalCases([])
      return
    }
    getTestCaseSet(testSetId)
      .then((detail) => {
        // 用例集详情没有 testCases 键，用例在 header+rows 里——按列名映射出编译所需字段
        const header = ((detail as { header?: string[] }).header ?? []).map((h) => h.trim())
        const rows = (detail as { rows?: string[][] }).rows ?? []
        const col = (candidates: string[]) => header.findIndex((h) => candidates.some((c) => h.includes(c)))
        const idx = {
          caseId: col(['用例编号', '编号', 'caseId']),
          title: col(['标题']),
          precondition: col(['前置条件']),
          steps: col(['测试步骤', '步骤']),
          expected: col(['预期结果', '预期']),
        }
        const cases: FunctionalCaseOption[] = rows
          .map((row) => ({
            caseId: idx.caseId >= 0 ? String(row[idx.caseId] ?? '') : '',
            title: idx.title >= 0 ? String(row[idx.title] ?? '') : '',
            precondition: idx.precondition >= 0 ? String(row[idx.precondition] ?? '') : '',
            steps: idx.steps >= 0 ? String(row[idx.steps] ?? '') : '',
            expectedResult: idx.expected >= 0 ? String(row[idx.expected] ?? '') : '',
          }))
          // 编译必须有标题/步骤/预期三要素，缺字段的行（如 API 用例集）不可选
          .filter((c) => c.caseId && c.title && c.steps && c.expectedResult)
        setFunctionalCases(cases)
      })
      .catch(() => setFunctionalCases([]))
  }, [fromFunctional, testSetId])

  const importFromFunctional = useCallback(async () => {
    const selected = functionalCases.find((c) => c.caseId === functionalCaseId)
    if (!selected) return
    setCompiling(true)
    setError(null)
    try {
      const aiSelection = await loadActiveAiConfigSelection()
      if (!aiSelection) {
        setError('请先在「设置」中配置 AI 模型')
        return
      }
      const result = await compileFunctionalCase({
        caseRef: selected.caseId,
        title: selected.title,
        precondition: selected.precondition,
        steps: selected.steps,
        expectedResult: selected.expectedResult,
        env: entryUrl ? { entryUrl } : {},
        aiConfig: aiSelection.payload,
      })
      setTitle(selected.title)
      setPreconditionText(selected.precondition)
      setSteps(result.plan.instructions.length > 0 ? result.plan.instructions : [newStep()])
      setManualItems(result.plan.manualItems)
      setCompileNotes([
        `编译结果：${result.plan.executable === 'full' ? '全自动' : result.plan.executable === 'partial' ? '部分自动' : '需人工'}${result.usedFallback ? '（校验未过，已降级直映，请人工核查）' : ''}${result.cacheHit ? '（缓存命中）' : ''}`,
        ...result.plan.compileNotes,
        ...result.validationErrors.map((e) => `校验：${e}`),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCompiling(false)
    }
  }, [functionalCases, functionalCaseId, entryUrl])

  const updateStep = (index: number, patch: Partial<AutomationStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      // 只对调两行、保留各自 id（全量重排会让所有行 key 抖动、输入焦点丢失，评审 L20）
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const save = async (): Promise<string | null> => {
    if (!title.trim() || !projectId) {
      setError('标题与所属项目不能为空')
      return null
    }
    setSaving(true)
    setError(null)
    const payload = {
      title: title.trim(),
      projectId,
      setId: setId || undefined,
      entryUrl: entryUrl.trim() || undefined,
      preconditionText,
      varDefs: Object.fromEntries(varDefs.filter(([k]) => k.trim())),
      steps: steps.filter((s) => s.text.trim()).map((s, i) => ({ ...s, id: i + 1 })),
      manualItems: manualItems.filter((m) => m.text.trim()),
    }
    try {
      const saved = savedId
        ? await updateAutomationCase(savedId, payload)
        : await createAutomationCase({ ...payload, source: fromFunctional ? 'functional-import' : 'manual' })
      setSavedId(saved.id)
      return saved.id
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setSaving(false)
    }
  }

  const saveAndRun = async () => {
    const id = await save()
    if (!id) return
    try {
      const run = await startAutomationRun(id, engineMode ? { engine: engineMode } : undefined)
      setRunHandle({ runId: run.id, title: `${title} · 立即执行` })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) return <p className="at-muted" style={{ padding: 30 }}>加载中…</p>

  return (
    <div>
      <div className="at-toolbar">
        <button className="at-btn" onClick={() => navigate(-1)}><ArrowLeft size={14} />返回</button>
        <span style={{ fontSize: 15.5, fontWeight: 750 }}>{isNew ? '新建自动化用例' : `编辑用例`}</span>
        <div className="at-spacer" />
        <select className="at-select" value={engineMode} onChange={(e) => setEngineMode(e.target.value as typeof engineMode)} title="本次执行的引擎模式">
          <option value="">跟随全局引擎</option>
          <option value="auto">混合（act 极速优先）</option>
          <option value="visual">纯视觉</option>
        </select>
        <button className="at-btn" disabled={saving} onClick={() => void save().then((id) => id && navigate('/automation'))}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="at-btn at-btn-run" disabled={saving} onClick={() => void saveAndRun()}>
          <Play size={14} />保存并执行
        </button>
      </div>

      {error && <p className="at-note" style={{ marginBottom: 12, color: 'var(--color-danger)' }}>{error}</p>}

      {fromFunctional && isNew && (
        <div className="at-card" style={{ padding: 13, marginBottom: 12 }}>
          <h3 className="at-section-title"><Wand2 size={14} />从功能用例导入（LLM 编译为指令序列）</h3>
          <div className="at-form-grid">
            <dt>项目</dt>
            <dd>
              <select className="at-select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setTestSetId(''); setFunctionalCaseId('') }}>
                <option value="">选择项目</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </dd>
            <dt>用例集</dt>
            <dd>
              <select className="at-select" value={testSetId} onChange={(e) => { setTestSetId(e.target.value); setFunctionalCaseId('') }} disabled={!projectId}>
                <option value="">选择用例集</option>
                {testSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </dd>
            <dt>功能用例</dt>
            <dd style={{ display: 'flex', gap: 8 }}>
              <select className="at-select" style={{ flex: 1 }} value={functionalCaseId} onChange={(e) => setFunctionalCaseId(e.target.value)} disabled={!testSetId}>
                <option value="">选择用例</option>
                {functionalCases.map((c) => <option key={c.caseId} value={c.caseId}>{c.caseId} · {c.title}</option>)}
              </select>
              <button className="at-btn at-btn-primary" disabled={!functionalCaseId || compiling} onClick={() => void importFromFunctional()}>
                {compiling ? '编译中…' : '编译并填入'}
              </button>
            </dd>
            {testSetId && functionalCases.length === 0 && (
              <>
                <dt></dt>
                <dd className="at-small at-muted">该用例集没有可编译的功能用例（缺标题/步骤/预期字段的行不可选，API 用例集不适用）</dd>
              </>
            )}
          </div>
          {compileNotes.length > 0 && (
            <div className="at-note" style={{ marginTop: 10 }}>
              {compileNotes.map((note, i) => <div key={i}>{note}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="at-card at-editor-card" style={{ marginBottom: 13 }}>
        <h3 className="at-section-title"><Database size={14} />基本信息与前置条件</h3>
        <div className="at-fields">
          <div className="at-field">
            <label htmlFor="atce-title">标题 <span className="at-req">*</span></label>
            <input id="atce-title" className="at-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="用例标题" />
          </div>
          <div className="at-field">
            <label htmlFor="atce-project">所属项目 <span className="at-req">*</span></label>
            <select id="atce-project" className="at-select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setSetId('') }} disabled={fromFunctional && isNew && !!functionalCaseId}>
              <option value="">选择项目</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="at-field">
            <label htmlFor="atce-set">用例集</label>
            <select id="atce-set" className="at-select" value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">未分组</option>
              {sets.filter((s) => !projectId || s.projectId === projectId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="at-field">
            <label htmlFor="atce-url">目标环境</label>
            <input id="atce-url" className="at-input" value={entryUrl} onChange={(e) => setEntryUrl(e.target.value)} placeholder="https://…（执行入口 URL）" />
          </div>
          <div className="at-field is-wide">
            <label htmlFor="atce-pre">前置条件</label>
            <textarea
              id="atce-pre"
              className="at-input"
              style={{ minHeight: 56, resize: 'vertical' }}
              value={preconditionText}
              onChange={(e) => setPreconditionText(e.target.value)}
              placeholder="前置条件；凭据用 ${VAR_NAME} 占位，真实值只存服务端配置"
            />
          </div>
          <div className="at-field is-wide">
            <label>变量占位</label>
            {varDefs.length > 0 && (
              <div className="at-var-list">
                {varDefs.map(([key, value], index) => (
                  <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="at-input" style={{ width: 200 }} value={key} placeholder="VAR_NAME" onChange={(e) => setVarDefs((prev) => prev.map((kv, i) => (i === index ? [e.target.value, kv[1]] : kv)))} />
                    <span className="at-muted">←</span>
                    <input
                      className="at-input"
                      style={{ flex: 1 }}
                      value={value}
                      placeholder="服务端配置键名（process.env 里的 key）"
                      list="at-credential-names"
                      onChange={(e) => setVarDefs((prev) => prev.map((kv, i) => (i === index ? [kv[0], e.target.value] : kv)))}
                    />
                    <button className="at-icon-btn danger" aria-label="删除变量" onClick={() => setVarDefs((prev) => prev.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <datalist id="at-credential-names">
              {credentials.map((c) => <option key={c.name} value={c.name} />)}
            </datalist>
            <div>
              <button className="at-btn at-btn-sm" onClick={() => setVarDefs((prev) => [...prev, ['', '']])}><Plus size={13} />添加变量</button>
              {credentials.length > 0 && <span className="at-small at-muted" style={{ marginLeft: 8 }}>可从已配置的凭据键名中选择（「配置」页管理）</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="at-editor-grid">
        <div className="at-card at-editor-card">
          <h3 className="at-section-title">执行步骤 <span className="at-muted at-small" style={{ fontWeight: 400 }}>（{(steps.filter((s) => s.enabled)).length} 步启用）</span></h3>
          {steps.map((step, index) => (
            <div key={step.id} className={`at-step t-${step.type} ${step.enabled ? '' : 'is-disabled'}`}>
              <span className="at-step-no">{index + 1}</span>
              <select className={`at-step-kind k-${step.type}`} value={step.type} aria-label={`步骤 ${index + 1} 类型`} onChange={(e) => updateStep(index, { type: e.target.value as AutomationStepType })}>
                {STEP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input type="text" className="at-input at-step-text" value={step.text} placeholder={step.type === 'assert' ? '一句可视觉判定的断言' : step.type === 'act' ? '一个原子 UI 动作' : step.type === 'extract' ? '要读取的内容' : '等待条件'} onChange={(e) => updateStep(index, { text: e.target.value })} />
              {step.type === 'extract' && (
                <input className="at-input at-step-saveas" value={step.saveAs ?? ''} placeholder="→ 变量名" aria-label={`步骤 ${index + 1} 保存到变量名`} onChange={(e) => updateStep(index, { saveAs: e.target.value || undefined })} />
              )}
              <div className="at-step-ops">
                <input type="checkbox" className="at-step-enable" checked={step.enabled} aria-label={`启用步骤 ${index + 1}`} title="启用/停用" onChange={(e) => updateStep(index, { enabled: e.target.checked })} />
                <button className="at-icon-btn" aria-label="上移步骤" onClick={() => moveStep(index, -1)} disabled={index === 0}><ArrowUp size={13} /></button>
                <button className="at-icon-btn" aria-label="下移步骤" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1}><ArrowDown size={13} /></button>
                <button className="at-icon-btn danger" aria-label="删除步骤" onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          <button className="at-btn at-btn-sm" onClick={() => setSteps((prev) => [...prev, newStep()])}><Plus size={13} />添加步骤</button>
        </div>

        <aside className="at-editor-rail">
          <div className="at-manual-card" style={{ marginBottom: 12 }}>
            <h3 className="at-section-title" style={{ color: 'oklch(0.6 0.14 75)' }}><User size={14} />需人工执行 · {manualItems.length} 项</h3>
            {manualItems.length === 0 && (
              <div className="at-manual-empty">
                <span>无人工项 — 该用例结论可为「通过」。</span>
                <button className="at-btn at-btn-sm" onClick={() => setManualItems((prev) => [...prev, { text: '', reason: '' }])}><Plus size={13} />添加</button>
              </div>
            )}
            {manualItems.map((item, index) => (
              <div key={index} className="at-manual-item">
                <User size={14} />
                <div style={{ flex: 1 }}>
                  <input className="at-input" style={{ width: '100%' }} value={item.text} placeholder="需人工执行的操作" onChange={(e) => setManualItems((prev) => prev.map((m, i) => (i === index ? { ...m, text: e.target.value } : m)))} />
                  <input className="at-input at-small" style={{ width: '100%', marginTop: 4 }} value={item.reason} placeholder="原因（如：后端批处理，UI 无入口）" onChange={(e) => setManualItems((prev) => prev.map((m, i) => (i === index ? { ...m, reason: e.target.value } : m)))} />
                </div>
                <button className="at-icon-btn danger" onClick={() => setManualItems((prev) => prev.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
              </div>
            ))}
            {manualItems.length > 0 && <button className="at-btn at-btn-sm" style={{ marginTop: 8 }} onClick={() => setManualItems((prev) => [...prev, { text: '', reason: '' }])}><Plus size={13} />添加人工项</button>}
            {manualItems.length > 0 && <p className="at-small at-muted" style={{ marginTop: 7, marginBottom: 0 }}>执行时自动跳过并计入报告；本用例结论最高为「部分通过」。</p>}
          </div>

          <details className="at-card at-details">
            <summary><MinusCircle size={14} />编写约定<ChevronRight size={14} className="at-details-arrow" /></summary>
            <div className="at-details-body">
              <div className="at-kind-ref"><b className="k-act">act</b><span>一个原子 UI 动作（点击/输入/导航其一），不写验证性措辞</span></div>
              <div className="at-kind-ref"><b className="k-assert">assert</b><span>一句看截图就能判真假的陈述（保留具体数值/文案）</span></div>
              <div className="at-kind-ref"><b className="k-extract">extract</b><span>读取页面内容存入变量，后续步骤用 {'{{变量名}}'} 引用</span></div>
              <div className="at-kind-ref"><b className="k-wait">wait</b><span>等待某个可见状态出现</span></div>
              <div className="at-kind-ref"><b>凭据</b><span>用 <span className="at-var-chip">{'${VAR_NAME}'}</span> 占位，真实值只存服务端配置</span></div>
              <div className="at-kind-ref"><b>人工项</b><span>浏览器做不了的操作（API/日志/批处理）放进「需人工执行」</span></div>
            </div>
          </details>
        </aside>
      </div>

      <RunProgressModal handle={runHandle} onClose={() => setRunHandle(null)} />
    </div>
  )
}
