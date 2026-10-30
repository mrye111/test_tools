/** 建项目向导（/automation/new）：三步——基本信息 → 登录方式 → 补充上下文。 */

import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Bot, Check, FileUp, Globe, KeyRound, Lock, Trash2, X } from 'lucide-react'
import { createAutomationProject, uploadTestFile } from '../../lib/automation-api'

type AuthKind = 'credentials' | 'none' | 'sso'

const STEPS = ['基本信息', '登录方式', '补充上下文'] as const

export function ProjectWizardView() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authKind, setAuthKind] = useState<AuthKind>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [prdText, setPrdText] = useState('')
  const [extraInstructions, setExtraInstructions] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canNext = useMemo(() => {
    // 与 create() 的 normalizedUrl() 对齐：缺协议时自动补 https://，所以只需非空
    if (step === 0) return name.trim().length > 0 && url.trim().length > 0
    if (step === 1) return authKind !== 'credentials' || (username.trim().length > 0 && password.length > 0)
    return true
  }, [step, name, url, authKind, username, password])

  const normalizedUrl = () => {
    const raw = url.trim()
    return /^https?:\/\//.test(raw) ? raw : `https://${raw}`
  }

  const create = async () => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await createAutomationProject({
        name: name.trim(),
        url: normalizedUrl(),
        authKind,
        username: authKind === 'credentials' ? username.trim() : undefined,
        password: authKind === 'credentials' ? password : undefined,
        extraInstructions: extraInstructions.trim() || undefined,
        prdText: prdText.trim() || undefined,
      })
      // 附件逐个上传（P1 先存，P5 接入执行）
      for (const file of files) {
        const buffer = await file.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buffer)
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        }
        await uploadTestFile(created.projectId, file.name, btoa(binary)).catch(() => undefined)
      }
      navigate(`/automation/p/${created.projectId}/sources`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  return (
    <div className="at-page at-wizard-page">
      <div className="at-wizard">
        <div className="at-toolbar" style={{ marginBottom: 18 }}>
          <button className="at-btn" onClick={() => navigate('/automation')}><ArrowLeft size={14} />返回</button>
          <span style={{ fontSize: 15.5, fontWeight: 750 }}>新建项目</span>
        </div>

        {/* 步进条 */}
        <div className="at-wizard-steps" role="list" aria-label="创建步骤">
          {STEPS.map((label, index) => (
            <div key={label} role="listitem" className={`at-wizard-step ${index < step ? 'is-done' : ''} ${index === step ? 'is-active' : ''}`}>
              <span className="at-wizard-dot">{index < step ? <Check size={12} /> : index + 1}</span>
              <span>{label}</span>
              {index < STEPS.length - 1 && <span className="at-wizard-link" />}
            </div>
          ))}
        </div>

        <div className="at-card" style={{ padding: 18 }}>
          {step === 0 && (
            <>
              <h3 className="at-section-title"><Globe size={14} />要测什么</h3>
              <p className="at-small at-muted at-card-hint">AI agent 将在这个地址上运行测试。类型本期仅 Web 前端（其余端后续逐个移植）。</p>
              <div className="at-fields is-stack">
                <div className="at-field">
                  <label>测试类型</label>
                  <div className="at-type-cards">
                    <div className="at-type-card is-active" aria-current="true">
                      <Globe size={16} />
                      <div>
                        <div style={{ fontWeight: 700 }}>前端 UI（Web）</div>
                        <div className="at-small at-muted">浏览器里真实操作你的站点</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="at-field">
                  <label htmlFor="atwz-url">被测地址 *</label>
                  <input id="atwz-url" className="at-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="例如 www.example.com（需公开可访问）" />
                </div>
                <div className="at-field">
                  <label htmlFor="atwz-name">项目名称 *</label>
                  <input id="atwz-name" className="at-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="我的项目" />
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h3 className="at-section-title"><Lock size={14} />怎么登录</h3>
              <p className="at-small at-muted at-card-hint">执行测试时 AI agent 用它进入你的应用。</p>
              <div className="at-type-cards">
                <button
                  type="button"
                  className={`at-type-card ${authKind === 'credentials' ? 'is-active' : ''}`}
                  onClick={() => setAuthKind('credentials')}
                >
                  <KeyRound size={16} />
                  <div>
                    <div style={{ fontWeight: 700 }}>测试账号凭据</div>
                    <div className="at-small at-muted">用你提供的用户名 + 密码登录（真实值只存服务端）</div>
                  </div>
                </button>
                <button
                  type="button"
                  className={`at-type-card ${authKind === 'none' ? 'is-active' : ''}`}
                  onClick={() => setAuthKind('none')}
                >
                  <Globe size={16} />
                  <div>
                    <div style={{ fontWeight: 700 }}>免登录</div>
                    <div className="at-small at-muted">页面公开可达，直接测</div>
                  </div>
                </button>
                <button
                  type="button"
                  className={`at-type-card ${authKind === 'sso' ? 'is-active' : ''}`}
                  onClick={() => setAuthKind('sso')}
                >
                  <Bot size={16} />
                  <div>
                    <div style={{ fontWeight: 700 }}>SSO / 扫码<span className="at-badge at-badge-blue" style={{ marginLeft: 6 }}>占位</span></div>
                    <div className="at-small at-muted">首次执行时需人工介入一次（后续复用会话）</div>
                  </div>
                </button>
              </div>
              {authKind === 'credentials' && (
                <div className="at-fields" style={{ marginTop: 12 }}>
                  <div className="at-field">
                    <label htmlFor="atwz-user">用户名</label>
                    <input id="atwz-user" className="at-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="testuser@example.com" autoComplete="off" />
                  </div>
                  <div className="at-field">
                    <label htmlFor="atwz-pass">密码</label>
                    <input id="atwz-pass" className="at-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h3 className="at-section-title"><FileUp size={14} />让 agent 多知道一点</h3>
              <div className="at-fields is-stack">
                <div className="at-field">
                  <label htmlFor="atwz-prd">需求文档（PRD）原文</label>
                  <textarea
                    id="atwz-prd"
                    className="at-input"
                    style={{ minHeight: 110, resize: 'vertical' }}
                    value={prdText}
                    onChange={(e) => setPrdText(e.target.value)}
                    placeholder="粘贴 PRD 原文。规划测试时它会让提案更贴你的需求（可选，强烈建议）"
                  />
                </div>
                <div className="at-field">
                  <label>测试附件（可选）</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const picked = [...(e.target.files ?? [])]
                      setFiles((prev) => [...prev, ...picked].slice(0, 3))
                      e.target.value = ''
                    }}
                  />
                  <button type="button" className="at-btn" onClick={() => fileInputRef.current?.click()}>
                    <FileUp size={14} />选择文件（最多 3 个，单个 ≤10MB）
                  </button>
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="at-file-row">
                      <span className="at-small">{f.name}</span>
                      <span className="at-muted at-small">{Math.ceil(f.size / 1024)} KB</span>
                      <button className="at-icon-btn danger" aria-label={`移除附件 ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, x) => x !== i))}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <span className="at-small at-muted">agent 执行到「上传文件」类步骤时会用它们（如头像、CSV 导入）</span>
                </div>
                <div className="at-field">
                  <label htmlFor="atwz-extra">额外指令（可选）</label>
                  <textarea
                    id="atwz-extra"
                    className="at-input"
                    style={{ minHeight: 72, resize: 'vertical' }}
                    value={extraInstructions}
                    onChange={(e) => setExtraInstructions(e.target.value)}
                    placeholder="如「重点测下单流程」「避免破坏性操作」"
                  />
                </div>
              </div>
            </>
          )}

          {error && <p className="at-note" style={{ marginTop: 12, color: 'var(--color-danger)' }}>{error}</p>}

          <div className="at-wizard-foot">
            <button className="at-btn" disabled={step === 0 || creating} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={14} />上一步
            </button>
            <span className="at-spacer" />
            {step < STEPS.length - 1 ? (
              <button className="at-btn at-btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                继续<ArrowRight size={14} />
              </button>
            ) : (
              <button className="at-btn at-btn-run" disabled={!canNext || creating} onClick={() => void create()}>
                {creating ? '创建中…' : '创建项目'}
              </button>
            )}
            <button className="at-icon-btn" aria-label="取消并返回" title="取消" onClick={() => navigate('/automation')}>
              <X size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
