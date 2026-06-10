import { useState } from 'react'
import { Code2, Loader2 } from 'lucide-react'
import { downloadGeneratedJmx } from '../../lib/jmeter-api'
import { type GeneratedPlanResult, generateCustomScriptPlan } from '../../lib/jmeter-builders'
import { GeneratedPlanResult as GeneratedPlanResultPanel } from './GeneratedPlanResult'

export function CustomScriptTab() {
  const [language, setLanguage] = useState('groovy')
  const [script, setScript] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GeneratedPlanResult | null>(null)

  const handleGenerate = async () => {
    if (!script.trim()) return
    setLoading(true)
    setError(null)
    try {
      const nextResult = await generateCustomScriptPlan({
        language,
        script,
      })
      setResult(nextResult)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : '生成 JMX 文件失败，请检查后端服务是否启动')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!result) return
    setDownloading(true)
    setError(null)
    try {
      await downloadGeneratedJmx(result.savedPath, result.downloadName)
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载 JMX 文件失败')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="mb-4 font-display text-xl font-semibold tracking-[-0.035em] text-fg">自定义脚本</h2>
      <p className="mb-6 text-sm leading-6 text-muted">
        使用 JSR223 采样器编写自定义测试逻辑，支持 Groovy、JavaScript、Python
      </p>

      {/* Language Selector */}
      <div className="mb-4">
        <label className="field-label">脚本语言</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="field-control max-w-[220px]"
        >
          <option value="groovy">Groovy</option>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="beanshell">BeanShell</option>
        </select>
      </div>

      {/* Code Editor */}
      <div className="mb-4">
        <label className="field-label">脚本内容</label>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={`// ${language} 示例\nlog.info("Starting test...")\nsampleResult.setSuccessful(true)\nsampleResult.setResponseData("OK", "UTF-8")`}
          rows={16}
          className="field-control bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100 focus:bg-slate-950"
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          onClick={handleGenerate}
          disabled={loading || !script.trim()}
          className="primary-action px-6 py-2.5 text-sm disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}
          {loading ? '生成中...' : '生成并保存 .jmx'}
        </button>
      </div>

      <GeneratedPlanResultPanel
        result={result}
        error={error}
        downloading={downloading}
        onDownload={handleDownload}
      />
    </div>
  )
}
