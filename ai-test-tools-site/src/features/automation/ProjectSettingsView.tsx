/** 项目设置（工作台「设置」区）：General / 环境 / 运行行为 / 测试文件 / 执行配置。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, Globe, KeyRound, Plus, RefreshCw, Settings2, Trash2, Zap } from 'lucide-react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import {
  createEnvironment,
  deleteEnvironment,
  deleteTestFile,
  getProjectExt,
  listEnvironments,
  listTestFiles,
  saveProjectExt,
  setDefaultEnvironment,
  updateEnvironment,
  uploadTestFile,
  type AutomationEnvironment,
  type AutomationProjectExt,
  type AutomationTestFile,
} from '../../lib/automation-api'
import { deleteTestCaseProject, updateTestCaseProject } from '../../lib/testcase-api'
import { AutomationConfigView } from './AutomationConfigView'

type SectionKey = 'general' | 'environments' | 'behavior' | 'files' | 'engine'

const SECTIONS: { key: SectionKey; label: string; icon: typeof Settings2 }[] = [
  { key: 'general', label: 'General', icon: Settings2 },
  { key: 'environments', label: '环境', icon: Globe },
  { key: 'behavior', label: '运行行为', icon: RefreshCw },
  { key: 'files', label: '测试文件', icon: FileUp },
  { key: 'engine', label: '执行配置（全局）', icon: Zap },
]

const VIEWPORT_OPTIONS = [
  { value: '1920x1080', label: '1920 × 1080（Full HD，默认）' },
  { value: '1440x900', label: '1440 × 900' },
  { value: '1280x720', label: '1280 × 720' },
  { value: '375x812', label: '375 × 812（窄屏近似，不模拟触控）' },
]

function authLabel(auth: AutomationEnvironment['auth']): string {
  if (auth.kind === 'credentials') return `测试账号 · ${auth.usernameKey}`
  if (auth.kind === 'sso') return 'SSO（首跑人工介入）'
  return '免登录'
}

export function ProjectSettingsView({ projectId, projectName, systemUrl }: { projectId: string; projectName: string; systemUrl: string }) {
  const navigate = useNavigate()
  const [section, setSection] = useState<SectionKey>('general')
  const [ext, setExt] = useState<AutomationProjectExt | null>(null)
  const [environments, setEnvironments] = useState<AutomationEnvironment[]>([])
  const [files, setFiles] = useState<AutomationTestFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // General 表单
  const [name, setName] = useState(projectName)
  const [extraInstructions, setExtraInstructions] = useState('')
  const [prdText, setPrdText] = useState('')
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [deletingProject, setDeletingProject] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // 环境表单
  const [envName, setEnvName] = useState('')
  const [envUrl, setEnvUrl] = useState('')
  const [envAuthKind, setEnvAuthKind] = useState<'credentials' | 'none' | 'sso'>('none')
  const [envUsernameKey, setEnvUsernameKey] = useState('')
  const [envPasswordKey, setEnvPasswordKey] = useState('')
  const [deletingEnv, setDeletingEnv] = useState<AutomationEnvironment | null>(null)
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null)

  // 运行行为表单
  const [loginOnce, setLoginOnce] = useState(false)
  const [viewport, setViewport] = useState('1920x1080')
  const [concurrency, setConcurrency] = useState('3')
  const [savingBehavior, setSavingBehavior] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [extData, envs, fileList] = await Promise.all([getProjectExt(projectId), listEnvironments(projectId), listTestFiles(projectId)])
      setExt(extData)
      setEnvironments(envs)
      setFiles(fileList)
      setExtraInstructions(extData.extraInstructions)
      setPrdText(extData.prdText)
      setLoginOnce(extData.runBehavior.loginOncePerRun)
      setViewport(extData.runBehavior.viewport)
      setConcurrency(String(extData.runBehavior.concurrency))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projectId])

  useEffect(() => {
    setName(projectName)
  }, [projectName])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveGeneral = async () => {
    if (!name.trim() || savingGeneral) return
    setSavingGeneral(true)
    setError(null)
    try {
      await updateTestCaseProject(projectId, { name: name.trim(), systemUrl })
      await saveProjectExt(projectId, { extraInstructions: extraInstructions.trim(), prdText })
      setNotice('项目设置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingGeneral(false)
    }
  }

  const saveBehavior = async () => {
    if (savingBehavior || !ext) return
    setSavingBehavior(true)
    setError(null)
    try {
      await saveProjectExt(projectId, {
        runBehavior: { loginOncePerRun: loginOnce, viewport, concurrency: Number(concurrency) },
      })
      setNotice('运行行为已保存，下一批执行即生效')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingBehavior(false)
    }
  }

  const addEnvironment = async () => {
    if (!envName.trim() || !envUrl.trim()) return
    setError(null)
    try {
      await createEnvironment(projectId, {
        name: envName.trim(),
        url: envUrl.trim(),
        auth:
          envAuthKind === 'credentials'
            ? { kind: 'credentials', usernameKey: envUsernameKey.trim(), passwordKey: envPasswordKey.trim() }
            : { kind: envAuthKind },
      })
      setEnvName('')
      setEnvUrl('')
      setEnvAuthKind('none')
      setEnvUsernameKey('')
      setEnvPasswordKey('')
      setNotice('环境已添加')
      void refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const uploadFiles = async (picked: File[]) => {
    if (picked.length === 0 || uploading) return
    setUploading(true)
    setError(null)
    try {
      for (const file of picked.slice(0, 3)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        await uploadTestFile(projectId, file.name, btoa(binary))
      }
      setNotice('附件已上传（执行到上传类步骤时 agent 可用）')
      void refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="at-settings-grid">
      <nav className="at-settings-nav" aria-label="项目设置分区">
        {SECTIONS.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.key}
              type="button"
              className={`at-settings-nav-item ${section === s.key ? 'is-active' : ''}`}
              onClick={() => setSection(s.key)}
            >
              <Icon size={13} />
              {s.label}
            </button>
          )
        })}
      </nav>

      <div>
        {error && <p className="at-note" style={{ marginBottom: 12, color: 'var(--color-danger)' }}>{error}</p>}
        {notice && <p className="at-note" style={{ marginBottom: 12 }} role="status">{notice}</p>}

        {section === 'general' && (
          <>
            <div className="at-card at-editor-card" style={{ marginBottom: 12 }}>
              <h3 className="at-section-title"><Settings2 size={14} />General</h3>
              <div className="at-fields">
                <div className="at-field">
                  <label htmlFor="atps-name">项目名称</label>
                  <input id="atps-name" className="at-input" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="at-field">
                  <label>项目类型</label>
                  <div className="at-small" style={{ padding: '7px 0', color: 'var(--color-muted)' }}>前端 UI（Web）· 创建后不可更改</div>
                </div>
                <div className="at-field is-wide">
                  <label htmlFor="atps-extra">额外指令</label>
                  <textarea
                    id="atps-extra"
                    className="at-input"
                    style={{ minHeight: 64, resize: 'vertical' }}
                    value={extraInstructions}
                    onChange={(e) => setExtraInstructions(e.target.value)}
                    placeholder="生成测试时的注意事项：重点领域、优先流程、约束（如「避免破坏性操作」）"
                  />
                </div>
                <div className="at-field is-wide">
                  <label htmlFor="atps-prd">需求文档（PRD）原文</label>
                  <textarea
                    id="atps-prd"
                    className="at-input"
                    style={{ minHeight: 110, resize: 'vertical' }}
                    value={prdText}
                    onChange={(e) => setPrdText(e.target.value)}
                    placeholder="粘贴 PRD 原文。规划测试时它会让提案更贴你的需求（可选，强烈建议）"
                  />
                </div>
              </div>
              <div className="at-card-foot">
                <button className="at-btn at-btn-primary" disabled={savingGeneral || !name.trim()} onClick={() => void saveGeneral()}>
                  {savingGeneral ? '保存中…' : '保存'}
                </button>
              </div>
            </div>

            <div className="at-card at-editor-card" style={{ borderColor: 'oklch(0.9 0.05 25)' }}>
              <h3 className="at-section-title" style={{ color: 'var(--color-danger)' }}><Trash2 size={14} />Danger Zone</h3>
              <p className="at-small at-muted at-card-hint">删除项目将连带删除其用例、运行记录与设置，不可恢复。</p>
              <button className="at-btn at-btn-danger" onClick={() => setDeletingProject(true)}>
                <Trash2 size={13} />删除项目
              </button>
            </div>
          </>
        )}

        {section === 'environments' && (
          <div className="at-card at-editor-card">
            <h3 className="at-section-title"><Globe size={14} />环境</h3>
            <p className="at-small at-muted at-card-hint">被测系统跑在哪、agent 怎么登录。第一个是默认环境。</p>
            {environments.map((env) => (
              <div key={env.id} className="at-env-row">
                {editingEnvId === env.id ? (
                  <div className="at-env-edit">
                    <input className="at-input" value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="环境名" aria-label="环境名" />
                    <input className="at-input" style={{ flex: 1 }} value={envUrl} onChange={(e) => setEnvUrl(e.target.value)} placeholder="https://…" aria-label="环境地址" />
                    <button className="at-btn at-btn-sm at-btn-primary" onClick={() => void (async () => {
                      try {
                        await updateEnvironment(env.id, { name: envName.trim(), url: envUrl.trim() })
                        setEditingEnvId(null)
                        void refresh()
                      } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
                    })()}>保存</button>
                    <button className="at-btn at-btn-sm" onClick={() => setEditingEnvId(null)}>取消</button>
                  </div>
                ) : (
                  <>
                    <span className="at-env-name">{env.name}{env.isDefault && <span className="at-badge at-badge-blue" style={{ marginLeft: 6 }}>默认</span>}</span>
                    <span className="at-small at-muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{env.url} · {authLabel(env.auth)}</span>
                    {!env.isDefault && (
                      <button className="at-btn at-btn-sm" onClick={() => void setDefaultEnvironment(projectId, env.id).then(refresh).catch((err) => setError(err instanceof Error ? err.message : String(err)))}>设为默认</button>
                    )}
                    <button className="at-btn at-btn-sm" onClick={() => { setEditingEnvId(env.id); setEnvName(env.name); setEnvUrl(env.url) }}>编辑</button>
                    <button className="at-icon-btn danger" aria-label={`删除环境 ${env.name}`} onClick={() => setDeletingEnv(env)}><Trash2 size={13} /></button>
                  </>
                )}
              </div>
            ))}
            <div className="at-card" style={{ padding: 12, marginTop: 12, background: 'var(--color-surface-2)' }}>
              <div className="at-fields">
                <div className="at-field">
                  <label htmlFor="atps-env-name">新环境名称</label>
                  <input id="atps-env-name" className="at-input" value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="如 staging" />
                </div>
                <div className="at-field">
                  <label htmlFor="atps-env-url">地址</label>
                  <input id="atps-env-url" className="at-input" value={envUrl} onChange={(e) => setEnvUrl(e.target.value)} placeholder="https://…" />
                </div>
                <div className="at-field is-wide">
                  <label htmlFor="atps-env-auth">登录方式</label>
                  <select id="atps-env-auth" className="at-select" value={envAuthKind} onChange={(e) => setEnvAuthKind(e.target.value as typeof envAuthKind)}>
                    <option value="none">免登录</option>
                    <option value="credentials">测试账号凭据（引用凭据键名）</option>
                    <option value="sso">SSO / 扫码（首跑人工介入）</option>
                  </select>
                </div>
                {envAuthKind === 'credentials' && (
                  <>
                    <div className="at-field">
                      <label htmlFor="atps-env-user">用户名凭据键名</label>
                      <input id="atps-env-user" className="at-input" value={envUsernameKey} onChange={(e) => setEnvUsernameKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="PROJ_XXX_USERNAME" />
                    </div>
                    <div className="at-field">
                      <label htmlFor="atps-env-pass">密码凭据键名</label>
                      <input id="atps-env-pass" className="at-input" value={envPasswordKey} onChange={(e) => setEnvPasswordKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="PROJ_XXX_PASSWORD" />
                    </div>
                  </>
                )}
              </div>
              <div className="at-card-foot">
                <button
                  className="at-btn at-btn-primary"
                  disabled={!envName.trim() || !envUrl.trim() || (envAuthKind === 'credentials' && (!envUsernameKey.trim() || !envPasswordKey.trim()))}
                  onClick={() => void addEnvironment()}
                >
                  <Plus size={14} />添加环境
                </button>
                <span className="at-small at-muted">凭据键名在「执行配置（全局）」里管理真实值</span>
              </div>
            </div>
          </div>
        )}

        {section === 'behavior' && ext && (
          <div className="at-card at-editor-card">
            <h3 className="at-section-title"><RefreshCw size={14} />运行行为</h3>
            <p className="at-small at-muted at-card-hint">这个项目每次运行的行为。</p>
            <div className="at-fields is-stack">
              <div className="at-field">
                <label htmlFor="atps-login-once" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                  <input id="atps-login-once" type="checkbox" checked={loginOnce} onChange={(e) => setLoginOnce(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                  每次运行只登录一次
                </label>
                <span className="at-small at-muted">运行开始时登录一次，会话复用到每条用例；被限流/锁号的系统建议开启</span>
              </div>
              <div className="at-field">
                <label htmlFor="atps-viewport">视口</label>
                <select id="atps-viewport" className="at-select" value={viewport} onChange={(e) => setViewport(e.target.value)}>
                  {VIEWPORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="at-small at-muted">每条用例渲染的浏览器尺寸；窄屏会让响应式布局生效（不模拟触控）</span>
              </div>
              <div className="at-field">
                <label htmlFor="atps-concurrency">同时执行的用例数</label>
                <select id="atps-concurrency" className="at-select" value={concurrency} onChange={(e) => setConcurrency(e.target.value)}>
                  {['1', '2', '3', '4', '5'].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="at-small at-muted">同一运行内并行数；其余排队</span>
              </div>
            </div>
            <div className="at-card-foot">
              <button className="at-btn at-btn-primary" disabled={savingBehavior} onClick={() => void saveBehavior()}>
                {savingBehavior ? '保存中…' : '保存运行行为'}
              </button>
            </div>
          </div>
        )}

        {section === 'files' && (
          <div className="at-card at-editor-card">
            <h3 className="at-section-title"><FileUp size={14} />测试文件</h3>
            <p className="at-small at-muted at-card-hint">agent 执行到「上传文件」类步骤时可用的附件（头像、CSV、合同 PDF 等）。</p>
            {files.length === 0 && <p className="at-small at-muted">还没有附件。</p>}
            {files.map((f) => (
              <div key={f.id} className="at-env-row">
                <span className="at-env-name">{f.filename}</span>
                <span className="at-small at-muted" style={{ flex: 1 }}>{Math.ceil(f.size / 1024)} KB</span>
                <button
                  className="at-icon-btn danger"
                  aria-label={`删除附件 ${f.filename}`}
                  onClick={() => void deleteTestFile(f.id).then(refresh).catch((err) => setError(err instanceof Error ? err.message : String(err)))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                void uploadFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <div className="at-card-foot">
              <button className="at-btn at-btn-primary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                <FileUp size={14} />{uploading ? '上传中…' : '添加文件'}
              </button>
              <span className="at-small at-muted">最多 3 个，单个 ≤10MB</span>
            </div>
          </div>
        )}

        {section === 'engine' && <AutomationConfigView />}
      </div>

      <ConfirmDialog
        open={deletingProject}
        title="删除项目"
        description={(
          <>
            将永久删除「<span className="font-semibold">{projectName}</span>」及其全部用例、运行记录与设置，不可恢复。
            <label className="at-small" style={{ display: 'block', marginTop: 10, marginBottom: 4 }} htmlFor="atps-delete-confirm">
              输入项目名 <b>{projectName}</b> 确认
            </label>
            <input
              id="atps-delete-confirm"
              className="at-input"
              style={{ width: '100%' }}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={projectName}
              autoComplete="off"
            />
          </>
        )}
        confirmText="永久删除"
        danger
        onCancel={() => { setDeletingProject(false); setDeleteConfirmText('') }}
        onConfirm={async () => {
          if (deleteConfirmText !== projectName) return
          try {
            await deleteTestCaseProject(projectId)
            navigate('/automation')
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            setDeletingProject(false)
            setDeleteConfirmText('')
          }
        }}
      />

      <ConfirmDialog
        open={deletingEnv !== null}
        title="删除环境"
        description={`确定删除环境「${deletingEnv?.name}」吗？`}
        confirmText="删除"
        danger
        onConfirm={async () => {
          try {
            if (deletingEnv) await deleteEnvironment(deletingEnv.id)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setDeletingEnv(null)
            void refresh()
          }
        }}
        onCancel={() => setDeletingEnv(null)}
      />
    </div>
  )
}
