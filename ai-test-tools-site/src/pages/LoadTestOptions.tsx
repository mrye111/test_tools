import { useMemo, useState } from 'react'
import { readOptions, removeOption, writeOption, type Json } from '../features/loadtest/options-editor'

const input = 'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm'
const executorFields: Record<string, string[]> = {
  'shared-iterations': ['vus', 'iterations', 'maxDuration'],
  'per-vu-iterations': ['vus', 'iterations', 'maxDuration'],
  'constant-vus': ['vus', 'duration'],
  'ramping-vus': ['startVUs', 'stages', 'gracefulRampDown'],
  'constant-arrival-rate': ['rate', 'timeUnit', 'duration', 'preAllocatedVUs', 'maxVUs'],
  'ramping-arrival-rate': ['startRate', 'timeUnit', 'stages', 'preAllocatedVUs', 'maxVUs'],
}
const common = ['vus', 'duration', 'iterations', 'maxRedirects', 'userAgent', 'insecureSkipTLSVerify', 'noConnectionReuse', 'noVUConnectionReuse', 'discardResponseBodies']
const advanced = ['batch', 'batchPerHost', 'throw', 'summaryTrendStats', 'summaryTimeUnit', 'systemTags', 'tags', 'ext', 'hosts', 'dns', 'tlsAuth', 'tlsCipherSuites', 'tlsVersion', 'localIPs', 'blacklistIPs', 'blockHostnames', 'setupTimeout', 'teardownTimeout', 'noCookiesReset', 'minIterationDuration']
const objectValue = (value: Json | undefined): Record<string, Json> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

export function LoadTestOptions({source, onChange}: {source: string; onChange: (source: string) => void}) {
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [scenarioName, setScenarioName] = useState('scenario1')
  const [executor, setExecutor] = useState('constant-vus')
  const parsed = useMemo(() => { try { return {data: readOptions(source), error: ''} } catch (e) { return {data: null, error: e instanceof Error ? e.message : '无法读取参数'} } }, [source])
  const options = parsed.data?.options ?? {}
  function change(key: string, value: Json) { try { onChange(writeOption(source, key, value)); setError(''); setInfo('已更新源码中的 options；修改参数值内部的注释需要在源码中手动编辑。') } catch (e) { setError(e instanceof Error ? e.message : '参数更新失败') } }
  const scenarioValues = objectValue(options.scenarios)
  function setScenario(name: string, field: string, value: Json) { change('scenarios', {...scenarioValues, [name]: {...objectValue(scenarioValues[name]), [field]: value}}) }
  function parseField(raw: string): Json { try { return JSON.parse(raw) as Json } catch { return raw } }
  const cli = source.match(/^\/\/ nexuskit-k6-args: (.*)$/m)
  function applyCli(raw: string) {
    try {
      const args: unknown = JSON.parse(raw)
      if (!Array.isArray(args) || args.some(x => typeof x !== 'string' || !/^--[a-z][a-z0-9-]*(?:=.*)?$/.test(x))) throw Error('请输入仅包含 --长参数 或 --长参数=值 的 JSON 字符串数组')
      const line = `// nexuskit-k6-args: ${JSON.stringify(args)}`
      const without = cli ? source.replace(cli[0], '').replace(/^\r?\n/, '') : source
      onChange(`${line}\n${without}`); setError(''); setInfo('命令行参数已保存至脚本；保存项目后执行时生效。')
    } catch (e) { setError(e instanceof Error ? e.message : '参数格式不正确') }
  }
  return <section className="rounded-2xl border border-border bg-white/80 p-5"><h2 className="text-sm font-semibold">k6 参数面板</h2><p className="mt-1 text-xs text-muted">可静态解析的 options 与源码同步；动态表达式保留原样，请直接编辑源码。高级 JSON 接受任意 k6 options 字段，CLI 专用项在下方独立配置。</p>
    {parsed.error && <p role="alert" className="mt-3 text-sm text-danger">无法安全同步：{parsed.error}</p>}{error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}{info && <p className="mt-3 text-xs text-muted">{info}</p>}
    {parsed.data && <><div className="mt-4 grid gap-3 md:grid-cols-3">{common.map(key => <label key={key} className="grid gap-1 text-xs text-muted">{key}<input className={input} key={`${key}:${JSON.stringify(options[key])}`} defaultValue={options[key] === undefined ? '' : JSON.stringify(options[key])} placeholder="JSON 值，留空不修改" onBlur={e => {if (e.target.value.trim()) change(key, parseField(e.target.value.trim()))}} /></label>)}</div>
      <div className="mt-5"><h3 className="text-sm font-semibold">场景与执行器</h3><div className="mt-2 flex flex-wrap gap-2"><input aria-label="新场景名称" className={`${input} max-w-48`} value={scenarioName} onChange={e => setScenarioName(e.target.value)} /><select aria-label="执行器" className={`${input} max-w-64`} value={executor} onChange={e => setExecutor(e.target.value)}>{Object.keys(executorFields).map(x => <option key={x}>{x}</option>)}</select><button type="button" className="rounded-lg border border-border px-3 text-sm" onClick={() => {if (!scenarioName.trim() || Object.hasOwn(scenarioValues, scenarioName.trim())) {setError('场景名称不能为空或重复'); return} if (['vus','duration','iterations','stages'].some(key => Object.hasOwn(options,key))) {setError('请先通过高级参数删除 vus、duration、iterations、stages 简写项，再添加场景'); return} change('scenarios', {...scenarioValues, [scenarioName.trim()]: {executor}})}}>添加场景</button></div>
        {Object.entries(scenarioValues).map(([name, item]) => {const scene = objectValue(item); const type = typeof scene.executor === 'string' ? scene.executor : ''; return <div key={name} className="mt-3 rounded-xl bg-bg p-3"><div className="flex justify-between text-sm font-semibold"><span>{name} · {type || '未设置执行器'}</span><button type="button" className="text-danger" onClick={() => {const next = {...scenarioValues}; delete next[name]; change('scenarios', next)}}>删除场景</button></div><div className="mt-2 grid gap-2 md:grid-cols-3">{['startTime','gracefulStop','exec','env','tags',...(executorFields[type] ?? [])].map(field => <label key={field} className="grid gap-1 text-xs text-muted">{field}<input className={input} key={`${name}:${field}:${JSON.stringify(scene[field])}`} defaultValue={scene[field] === undefined ? '' : JSON.stringify(scene[field])} placeholder="JSON 值" onBlur={e => {if (e.target.value.trim()) setScenario(name, field, parseField(e.target.value.trim()))}} /></label>)}</div></div>})}</div>
      <div className="mt-5"><h3 className="text-sm font-semibold">阈值模板</h3><div className="mt-2 flex flex-wrap gap-2">{([['P95 < 800 ms','http_req_duration','p(95)<800'],['错误率 < 1%','http_req_failed','rate<0.01'],['检查成功率 > 99%','checks','rate>0.99']] as const).map(([label,metric,rule]) => <button type="button" className="rounded-lg border border-border px-3 py-1 text-xs" key={metric} onClick={() => {const thresholds = objectValue(options.thresholds); const prior = Array.isArray(thresholds[metric]) ? thresholds[metric] as Json[] : []; change('thresholds', {...thresholds, [metric]: [...prior.filter(x => x !== rule), rule]})}}>{label}</button>)}</div></div>
      <details className="mt-5"><summary className="cursor-pointer text-sm font-semibold">高级参数</summary><p className="mt-2 text-xs text-muted">编辑完整 options JSON；删除键会删除对应参数，未修改的字段和注释会保留。可用字段示例：{advanced.join('、')}。</p><textarea aria-label="高级 options JSON" key={source} id="lt-options-json" className={`${input} mt-2 h-36 font-mono text-xs`} defaultValue={JSON.stringify(options, null, 2)} /><button type="button" className="mt-2 rounded-lg border border-border px-3 py-1 text-sm" onClick={() => {try {const raw = (document.getElementById('lt-options-json') as HTMLTextAreaElement).value; const fields: unknown = JSON.parse(raw); if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw Error('请输入 JSON 对象'); let updated = source; for (const key of Object.keys(options)) if (!Object.hasOwn(fields, key)) updated = removeOption(updated, key); for (const [key, value] of Object.entries(fields)) if (JSON.stringify(options[key]) !== JSON.stringify(value)) updated = writeOption(updated, key, value as Json); onChange(updated); setError(''); setInfo('高级参数已写回源码')} catch(e) {setError(e instanceof Error ? e.message : 'JSON 无效')}}}>应用高级参数</button></details></>}
    <details className="mt-5"><summary className="cursor-pointer text-sm font-semibold">命令行专用参数</summary><p className="mt-2 text-xs text-muted">JSON 数组，每项为 --参数 或 --参数=值。框架保留 summary-export 和 testid 标签，不能覆盖；输出可通过 --out 添加。</p><textarea aria-label="k6 命令行参数" key={cli?.[1] ?? ''} id="lt-cli-args" className={`${input} mt-2 h-20 font-mono text-xs`} defaultValue={cli?.[1] ?? '[]'} /><button type="button" className="mt-2 rounded-lg border border-border px-3 py-1 text-sm" onClick={() => applyCli((document.getElementById('lt-cli-args') as HTMLTextAreaElement).value)}>保存命令行参数</button></details>
  </section>
}
