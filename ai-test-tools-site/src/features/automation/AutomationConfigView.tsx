/** 配置主区：状态横幅（视觉/极速引擎）+ 模型与极速引擎 + 执行参数 + 凭据键值管理（真实值永不回显）。 */

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Plus, RefreshCw, Settings2, Trash2, XCircle, Zap } from 'lucide-react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import {
  deleteAutomationCredential,
  getAutomationConfig,
  listAutomationCredentials,
  saveAutomationExecutionConfig,
  saveAutomationModelConfig,
  saveFastEngineConfig,
  setAutomationCredential,
  type AutomationConfigView,
  type CredentialItem,
  type EngineMode,
} from '../../lib/automation-api'

export function AutomationConfigView() {
  const [config, setConfig] = useState<AutomationConfigView | null>(null)
  const [credentials, setCredentials] = useState<CredentialItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 模型表单
  const [baseUrl, setBaseUrl] = useState('')
  const [modelName, setModelName] = useState('')
  const [family, setFamily] = useState('kimi')
  const [apiKey, setApiKey] = useState('')
  const [savingModel, setSavingModel] = useState(false)
  // 执行参数表单
  const [timeoutSec, setTimeoutSec] = useState('180')
  const [concurrency, setConcurrency] = useState('3')
  const [cacheDefault, setCacheDefault] = useState(true)
  const [savingExec, setSavingExec] = useState(false)
  // 极速引擎表单
  const [fastMode, setFastMode] = useState<EngineMode>('auto')
  const [fastBackend, setFastBackend] = useState<'off' | 'openai' | 'jev' | 'laya'>('openai')
  const [jevBaseUrl, setJevBaseUrl] = useState('')
  const [jevApiKey, setJevApiKey] = useState('')
  const [layaBaseUrl, setLayaBaseUrl] = useState('')
  const [savingFast, setSavingFast] = useState(false)
  // 凭据表单
  const [credName, setCredName] = useState('')
  const [credValue, setCredValue] = useState('')
  const [deletingCred, setDeletingCred] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [cfg, creds] = await Promise.all([getAutomationConfig(), listAutomationCredentials()])
      setConfig(cfg)
      setCredentials(creds)
      setBaseUrl(cfg.model.baseUrl)
      setModelName(cfg.model.modelName)
      setFamily(cfg.model.family || 'kimi')
      setTimeoutSec(String(Math.round(cfg.execution.modelTimeoutMs / 1000)))
      setConcurrency(String(cfg.execution.concurrency))
      setCacheDefault(cfg.execution.cacheDefault)
      setFastMode(cfg.fastEngine.mode)
      setFastBackend(cfg.fastEngine.backend)
      setJevBaseUrl(cfg.fastEngine.jevBaseUrl)
      setLayaBaseUrl(cfg.fastEngine.layaBaseUrl)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveModel = async () => {
    setSavingModel(true)
    setError(null)
    try {
      const result = await saveAutomationModelConfig({
        baseUrl: baseUrl.trim() || undefined,
        modelName: modelName.trim() || undefined,
        family: family.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      })
      setConfig((prev) => (prev ? { ...prev, model: result.model, engine: result.engine } : prev))
      setApiKey('')
      setNotice(
        result.engine.ready
          ? `模型配置已保存，定位冒烟通过（${result.engine.tier} 档，${result.engine.smokeLatencyMs}ms）`
          : `已保存，但定位冒烟失败：${result.engine.reason}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingModel(false)
    }
  }

  const saveExecution = async () => {
    setSavingExec(true)
    setError(null)
    try {
      const next = await saveAutomationExecutionConfig({
        modelTimeoutMs: Number(timeoutSec) * 1000,
        concurrency: Number(concurrency),
        cacheDefault,
      })
      setConfig((prev) => (prev ? { ...prev, execution: next } : prev))
      setNotice('执行参数已保存，下一批执行即生效')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingExec(false)
    }
  }

  const saveFast = async () => {
    setSavingFast(true)
    setError(null)
    try {
      const next = await saveFastEngineConfig({
        mode: fastMode,
        backend: fastBackend,
        jevBaseUrl: jevBaseUrl.trim() || undefined,
        jevApiKey: jevApiKey.trim() || undefined,
        layaBaseUrl: layaBaseUrl.trim() || undefined,
      })
      setConfig((prev) => (prev ? { ...prev, fastEngine: next } : prev))
      setJevApiKey('')
      setNotice(
        next.state.available
          ? `极速引擎已启用（${next.state.backendName ?? fastBackend} 后端）：act 步骤优先走极速，失败自动降级视觉`
          : `已保存：${next.state.reason ?? '极速引擎未启用'}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingFast(false)
    }
  }

  const addCredential = async () => {
    if (!credName.trim() || !credValue) return
    setError(null)
    try {
      await setAutomationCredential(credName.trim(), credValue)
      setCredName('')
      setCredValue('')
      setNotice(`凭据 ${credName.trim()} 已保存（真实值只存服务端，界面不回显）`)
      void refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      {/* 状态横幅：视觉/极速两个引擎的状态与全局反馈集中一处 */}
      <div className={`at-status-banner ${config?.engine.ready ? 'is-ok' : 'is-warn'}`}>
        <span className={`at-status-item ${config?.engine.ready ? 'at-status-ok' : 'at-status-bad'}`}>
          {config?.engine.ready ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          <b>视觉引擎</b>
          {config?.engine.ready
            ? `就绪 · ${config.engine.tier} 档 · 冒烟 ${config.engine.smokeLatencyMs}ms`
            : config?.engine.reason ?? '检测中…'}
        </span>
        <span className={`at-status-item ${config?.fastEngine.state.available ? 'at-status-ok' : 'at-status-bad'}`}>
          {config?.fastEngine.state.available ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          <b>极速引擎</b>
          {!config
            ? '检测中…'
            : config.fastEngine.state.available
              ? `可用（${config.fastEngine.state.backendName} 后端）`
              : `未启用 · ${config.fastEngine.state.reason}`}
        </span>
        <span className="at-status-spacer" />
        {(error || notice) && (
          <span className="at-small" role="status" style={{ color: error ? 'var(--color-danger)' : undefined }}>
            {error ?? notice}
          </span>
        )}
      </div>

      <div className="at-config-grid">
        <div className="at-cards-col">
          <div className="at-card at-editor-card">
            <h3 className="at-section-title"><Settings2 size={14} />UI 自动化模型（视觉定位 VLM）</h3>
            <div className="at-fields">
              <div className="at-field is-wide">
                <label htmlFor="atcv-base-url">Base URL</label>
                <input id="atcv-base-url" className="at-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.kimi.com/coding/v1" />
              </div>
              <div className="at-field">
                <label htmlFor="atcv-model">模型名称</label>
                <input id="atcv-model" className="at-input" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="kimi-for-coding" />
              </div>
              <div className="at-field">
                <label htmlFor="atcv-family">模型族</label>
                <select id="atcv-family" className="at-select" value={family} onChange={(e) => setFamily(e.target.value)}>
                  <option value="kimi">kimi（K2.x，默认禁思考）</option>
                  <option value="kimi3">kimi3（K3 系列）</option>
                  <option value="doubao-seed">doubao-seed</option>
                  <option value="qwen3">qwen3</option>
                  <option value="gemini">gemini</option>
                  <option value="glm">glm</option>
                </select>
              </div>
              <div className="at-field is-wide">
                <label htmlFor="atcv-key">API Key</label>
                <input
                  id="atcv-key"
                  className="at-input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config?.model.hasApiKey ? `已设置（尾号 ${config.model.apiKeyLast4}），输入以更换` : '输入 API Key'}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="at-card-foot">
              <button className="at-btn at-btn-primary" disabled={savingModel} onClick={() => void saveModel()}>
                {savingModel ? '保存并冒烟中…' : '保存并验证'}
              </button>
              <span className="at-small at-muted">保存后自动跑定位冒烟，无需重启</span>
            </div>
          </div>

          <div className="at-card at-editor-card">
            <h3 className="at-section-title"><Zap size={14} />极速引擎（DOM 动作表 + 决策模型）</h3>
            <p className="at-small at-muted at-card-hint">
              act 步骤优先走极速引擎（不发截图、按元素表决策，快且省），断言/提取始终走视觉引擎；极速未达成自动降级视觉。
              内网被测系统建议 openai/自托管后端，页面文本不出网。
            </p>
            <div className="at-fields">
              <div className="at-field">
                <label htmlFor="atcv-fast-mode">模式</label>
                <select id="atcv-fast-mode" className="at-select" value={fastMode} onChange={(e) => setFastMode(e.target.value as EngineMode)}>
                  <option value="auto">混合（act 极速优先，失败降级视觉）</option>
                  <option value="visual">纯视觉（全部走视觉引擎）</option>
                </select>
              </div>
              <div className="at-field">
                <label htmlFor="atcv-fast-backend">决策后端</label>
                <select id="atcv-fast-backend" className="at-select" value={fastBackend} onChange={(e) => setFastBackend(e.target.value as typeof fastBackend)}>
                  <option value="openai">openai 兼容（复用当前视觉模型配置，开箱即用）</option>
                  <option value="laya">laya 本地 sidecar（微调自托管，毫秒级，需先启动）</option>
                  <option value="jev">Jev API（TypeSafe，$0.0002/决策，页面文本发海外）</option>
                  <option value="off">关闭</option>
                </select>
              </div>
              {fastBackend === 'laya' && (
                <div className="at-field is-wide">
                  <label htmlFor="atcv-laya-url">Sidecar 地址</label>
                  <input id="atcv-laya-url" className="at-input" value={layaBaseUrl} onChange={(e) => setLayaBaseUrl(e.target.value)} placeholder="http://127.0.0.1:8765" />
                  <p className="at-small at-muted" style={{ margin: '4px 0 0' }}>
                    启动方式见 server/laya-sidecar/README.md；未微调的基础 checkpoint 决策质量不可用，仅验证管线。
                  </p>
                </div>
              )}
              {fastBackend === 'jev' && (
                <>
                  <div className="at-field">
                    <label htmlFor="atcv-jev-url">Jev Base URL</label>
                    <input id="atcv-jev-url" className="at-input" value={jevBaseUrl} onChange={(e) => setJevBaseUrl(e.target.value)} placeholder="https://api.typesafe.ai" />
                  </div>
                  <div className="at-field">
                    <label htmlFor="atcv-jev-key">Jev API Key</label>
                    <input
                      id="atcv-jev-key"
                      className="at-input"
                      type="password"
                      value={jevApiKey}
                      onChange={(e) => setJevApiKey(e.target.value)}
                      placeholder={config?.fastEngine.jevHasApiKey ? `已设置（尾号 ${config.fastEngine.jevApiKeyLast4}），输入以更换` : '输入 TYPESAFE_API_KEY'}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="at-card-foot">
              <button className="at-btn at-btn-primary" disabled={savingFast} onClick={() => void saveFast()}>
                {savingFast ? '保存中…' : '保存极速引擎配置'}
              </button>
            </div>
          </div>
        </div>

        <aside className="at-cards-col">
          <div className="at-card at-editor-card">
            <h3 className="at-section-title"><RefreshCw size={14} />执行参数</h3>
            <div className="at-fields is-stack">
              <div className="at-field">
                <label htmlFor="atcv-timeout">单步超时</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input id="atcv-timeout" className="at-input" style={{ width: 90 }} value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} />
                  <span className="at-small at-muted">秒（10–1800）</span>
                </div>
              </div>
              <div className="at-field">
                <label htmlFor="atcv-concurrency">全局并发</label>
                <select id="atcv-concurrency" className="at-select" value={concurrency} onChange={(e) => setConcurrency(e.target.value)}>
                  {['1', '2', '3', '4', '5'].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="at-small at-muted">套件成员按并发闸排队，同一用例/用例集始终串行</span>
              </div>
              <div className="at-field">
                <label htmlFor="atcv-cache" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                  <input id="atcv-cache" type="checkbox" checked={cacheDefault} onChange={(e) => setCacheDefault(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                  执行缓存默认开启
                </label>
                <span className="at-small at-muted">read-write，命中步骤跳过模型调用</span>
              </div>
            </div>
            <div className="at-card-foot">
              <button className="at-btn at-btn-primary" disabled={savingExec} onClick={() => void saveExecution()}>
                {savingExec ? '保存中…' : '保存执行参数'}
              </button>
            </div>
          </div>

          <div className="at-card at-editor-card">
            <h3 className="at-section-title"><KeyRound size={14} />凭据键值（真实值只存服务端）</h3>
            <p className="at-small at-muted at-card-hint">
              用例里写 <span className="at-var-chip">{'${KEY_NAME}'}</span> 占位，执行时从这里解析真实值。界面只显示键名与掩码，永不回显真实值。
            </p>
            {credentials.length === 0 && <p className="at-small at-muted" style={{ margin: '0 0 8px' }}>还没有凭据，添加一个吧（如登录密码）。</p>}
            {credentials.map((cred) => (
              <div key={cred.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span className="at-var-chip">{cred.name}</span>
                <span className="at-small at-muted">已设置 ····{cred.last4}</span>
                <div className="at-spacer" style={{ flex: 1 }} />
                <button className="at-icon-btn danger" aria-label={`删除凭据 ${cred.name}`} onClick={() => setDeletingCred(cred.name)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <div className="at-fields is-stack" style={{ marginTop: 12 }}>
              <div className="at-field">
                <label htmlFor="atcv-cred-name">键名</label>
                <input id="atcv-cred-name" className="at-input" placeholder="KEY_NAME" value={credName} onChange={(e) => setCredName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} />
              </div>
              <div className="at-field">
                <label htmlFor="atcv-cred-value">真实值</label>
                <input id="atcv-cred-value" className="at-input" type="password" placeholder="如登录密码" value={credValue} onChange={(e) => setCredValue(e.target.value)} autoComplete="new-password" />
              </div>
            </div>
            <div className="at-card-foot">
              <button className="at-btn at-btn-primary" disabled={!credName.trim() || !credValue} onClick={() => void addCredential()}>
                <Plus size={14} />添加
              </button>
              <span className="at-small at-muted">键名限大写字母/数字/下划线</span>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={deletingCred !== null}
        title="删除凭据"
        description={`确定删除凭据 ${deletingCred} 吗？引用它的用例执行时将找不到真实值。`}
        confirmText="删除"
        danger
        onConfirm={async () => {
          if (deletingCred) await deleteAutomationCredential(deletingCred).catch(() => undefined)
          setDeletingCred(null)
          void refresh()
        }}
        onCancel={() => setDeletingCred(null)}
      />
    </div>
  )
}
