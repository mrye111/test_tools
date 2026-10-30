import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { getMonitorConfig, saveMonitorConfig, verifyMonitor, getReport, downloadReport, interpretLoadTestReport, type LoadTestReport, type MonitorVerification } from '../features/loadtest/loadtest-api'
import { loadActiveAiConfigSelection } from '../lib/active-ai-config'

const box = 'rounded-2xl border border-border bg-white/80 p-5'
export function MonitorWizard() {
  const [url, setUrl] = useState('')
  const [targets, setTargets] = useState('')
  const [loadGeneratorTarget, setLoadGeneratorTarget] = useState('')
  const [verified, setVerified] = useState(false)
  const [result, setResult] = useState<MonitorVerification | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getMonitorConfig().then(({config, verified}) => { setUrl(config.prometheusUrl); setTargets(config.targets.join('\n')); setLoadGeneratorTarget(config.loadGeneratorTarget ?? ''); setVerified(verified) }).catch((e: Error) => setMessage(e.message)) }, [])
  async function saveAndVerify() {
    setBusy(true); setMessage(''); setResult(null); setVerified(false)
    try {
      await saveMonitorConfig({prometheusUrl: url.trim(), targets: targets.split('\n').map(x => x.trim()).filter(Boolean), loadGeneratorTarget: loadGeneratorTarget || null})
      const {verification} = await verifyMonitor(); setResult(verification); setVerified(verification.verified)
    } catch (e) { setMessage(e instanceof Error ? e.message : '验证失败') } finally { setBusy(false) }
  }
  return <section className={box}><h2 className="text-sm font-semibold">监控接入</h2><p className="mt-2 text-xs text-muted">配置 Prometheus 并确保已启用 remote-write 接收；每行填写一个 node_exporter 目标。保存后依次验证服务就绪、写入回环和目标健康。</p>
    <div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm">Prometheus 地址<input className="rounded-lg border border-border px-3 py-2" value={url} onChange={e => {setUrl(e.target.value); setVerified(false); setResult(null)}} placeholder="http://localhost:9090" /></label><label className="grid gap-1 text-sm">监控目标<textarea className="rounded-lg border border-border px-3 py-2" value={targets} onChange={e => {setTargets(e.target.value); if (!e.target.value.split('\n').map(x => x.trim()).includes(loadGeneratorTarget)) setLoadGeneratorTarget(''); setVerified(false); setResult(null)}} placeholder="host:9100" /></label><label className="grid gap-1 text-sm">压测机目标<select className="rounded-lg border border-border px-3 py-2" value={loadGeneratorTarget} onChange={e => {setLoadGeneratorTarget(e.target.value); setVerified(false); setResult(null)}}><option value="">未设置</option>{targets.split('\n').map(x => x.trim()).filter(Boolean).map(target => <option key={target} value={target}>{target}</option>)}</select></label></div>
    <div className="mt-3 flex items-center gap-3"><button type="button" disabled={busy} onClick={() => void saveAndVerify()} className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? '验证中…' : '保存并验证'}</button><span className="text-xs text-muted">{verified ? '监控验证通过' : '监控未验证通过'}</span></div>
    {message && <p role="alert" className="mt-2 text-sm text-danger">{message}</p>}{result && <ol className="mt-3 grid gap-1 text-xs">{([['服务就绪', result.ready], ['写入回环', result.remoteWrite], ['目标健康', result.targets]] as const).map(([name, step]) => <li key={name}>{step.ok ? '✓' : '✕'} {name}：{step.message}</li>)}</ol>}
  </section>
}
function Chart({series}: {series: LoadTestReport['series'][number]}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!ref.current) return; const chart = echarts.init(ref.current); chart.setOption({tooltip:{trigger:'axis'}, grid:{left:55,right:20,top:20,bottom:40}, xAxis:{type:'time'}, yAxis:{type:'value',name:series.unit,scale:true}, series:[{type:'line',showSymbol:false,data:series.points.map(p => [p.time,p.value])}]}); const resize = () => chart.resize(); window.addEventListener('resize',resize); return () => {window.removeEventListener('resize',resize); chart.dispose()} }, [series])
  return <div ref={ref} role="img" aria-label={`${series.name} 曲线`} className="h-52 w-full" />
}
export function ReportPanel({runId, live = false}: {runId: string; live?: boolean}) {
  const [report, setReport] = useState<LoadTestReport | null>(null)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  async function interpret() {
    setAnalyzing(true); setError('')
    try {
      const config = await loadActiveAiConfigSelection()
      if (!config) throw new Error('请先在设置中配置并选择 AI 模型')
      setAnalysis(await interpretLoadTestReport(runId, config.payload))
    } catch (e) { setError(e instanceof Error ? e.message : '解读失败') } finally { setAnalyzing(false) }
  }
  useEffect(() => { let active = true; let timer: number | undefined; const refresh = () => getReport(runId).then(r => {if(active) {setReport(r); setError(''); if (live || r.collecting) timer = window.setTimeout(refresh, 5000)}}).catch((e: Error) => {if(active) {setError(e.message); if (live) timer = window.setTimeout(refresh, 5000)}}); void refresh(); return () => {active = false; if(timer) window.clearTimeout(timer)} }, [runId, live])
  if (!report) return <section className={box}>{error || '加载报告中…'}</section>
  return <section className={box}><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{live ? '实时指标' : '压测报告'}</h2>{!live && <div className="flex gap-2"><button type="button" disabled={analyzing} onClick={() => void interpret()} className="rounded-lg border border-border px-3 py-1 text-sm disabled:opacity-50">{analyzing ? '解读中…' : 'AI 解读'}</button><button type="button" onClick={() => void downloadReport(runId).catch((e: Error) => setError(e.message))} className="rounded-lg border border-border px-3 py-1 text-sm">导出 HTML</button></div>}</div>
    {error && <p role="alert" className="text-danger text-xs">{error}</p>}<p className="mt-2 text-xs text-muted">监控：{report.monitoring}{report.collecting && ' · 数据采集中'}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">{report.metrics.map(m => <div key={m.name} className="rounded-xl bg-bg p-3"><div className="text-xs text-muted">{m.name}</div><div className="mt-1 font-mono text-lg">{m.value === null ? '未采集' : `${m.value} ${m.unit}`}</div></div>)}{report.metrics.length === 0 && <p className="text-sm text-muted">尚无指标数据</p>}</div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">{report.series.filter(s => s.points.length).map(s => <div key={s.name}><h3 className="text-xs font-semibold">{s.name} ({s.unit})</h3><Chart series={s}/></div>)}</div>{!report.series.some(s => s.points.length) && <p className="mt-3 text-xs text-muted">曲线数据尚未采集</p>}
    {!live && <><h3 className="mt-5 text-sm font-semibold">阈值判定</h3>{report.thresholds.length ? report.thresholds.map((t,i) => <p key={i} className="mt-1 text-xs">{t.metric} {t.expression}：{t.passed === null ? '无法判定' : t.passed ? '通过' : '未通过'}</p>) : <p className="mt-1 text-xs text-muted">无阈值数据</p>}<h3 className="mt-5 text-sm font-semibold">错误样本</h3>{report.errors.length ? report.errors.map((e,i) => <p key={i} className="mt-1 break-all text-xs">{e}</p>) : <p className="mt-1 text-xs text-muted">未采集或无失败样本</p>}{analysis && <><h3 className="mt-5 text-sm font-semibold">AI 解读</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{analysis}</p></>}</>}
  </section>
}
