import { useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, FileSpreadsheet, Bug, Sparkles, Eye } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { useGoBack } from '../hooks/useGoBack'
import { CustomSelect } from '../components/ui/CustomSelect'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { generateDemoReportData } from '../lib/test-report-demo'
import { parseZentaoReport } from '../lib/zentao-csv-parser'

const PLATFORM_OPTIONS = [
  { value: 'zentao', label: '禅道 (ZenTao)' },
]

export function TestReportPage() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const { showError } = useErrorDialog()
  const [platform, setPlatform] = useState('zentao')
  const [caseFile, setCaseFile] = useState<File | null>(null)
  const [bugFile, setBugFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ caseFile?: string; bugFile?: string }>({})

  const handleGenerate = async () => {
    const nextErrors: typeof fieldErrors = {}
    if (!caseFile) nextErrors.caseFile = '请上传测试用例执行结果文件'
    if (!bugFile) nextErrors.bugFile = '请上传 BUG 清单文件'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    if (!caseFile || !bugFile) return

    setGenerating(true)
    try {
      const data = await parseZentaoReport(caseFile, bugFile)
      sessionStorage.setItem('test-report-data', JSON.stringify(data))
      navigate('/testreport/view')
    } catch (error) {
      console.error('报告生成失败:', error)
      showError(error, {
        title: '生成测试报告失败',
        fallbackMessage: '文件解析失败，请检查文件格式是否正确。',
      })
    } finally {
      setGenerating(false)
    }
  }

  const handleDemo = () => {
    setGenerating(true)
    const data = generateDemoReportData()
    data.title = '演示报告 — V2.1 版本质量分析'
    data.platform = '演示数据'
    sessionStorage.setItem('test-report-data', JSON.stringify(data))
    setTimeout(() => {
      navigate('/testreport/view')
    }, 600)
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回">
            <button type="button" onClick={goBack} className="icon-action h-10 w-10 rounded-xl" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <div>
            <h1 className="page-title">测试报告</h1>
            <p className="page-subtitle">选择数据来源平台并上传两个文件后生成质量分析报告</p>
          </div>
        </div>
      </div>

      <div className="surface-panel motion-card stagger-1 rounded-[26px] p-6 max-sm:p-4">
        <div className="relative z-[1] space-y-6">
          <div className="max-w-[360px]">
            <label className="field-label">数据来源平台</label>
            <CustomSelect
              value={platform}
              onChange={setPlatform}
              options={PLATFORM_OPTIONS}
              placeholder="选择测试管理平台"
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="field-label">
                测试用例执行结果 <span className="text-danger">*</span>
              </label>
              <FileDropZone
                file={caseFile}
                onFile={(file) => {
                  setCaseFile(file)
                  setFieldErrors((current) => ({ ...current, caseFile: undefined }))
                }}
                icon={<FileSpreadsheet className="h-6 w-6 text-accent" />}
                accept=".csv,.xlsx,.xls,.json"
                label="上传用例执行结果文件"
                hint="支持 CSV、Excel、JSON"
                accent="accent"
                error={fieldErrors.caseFile}
              />
            </div>

            <div>
              <label className="field-label">
                BUG 清单 <span className="text-danger">*</span>
              </label>
              <FileDropZone
                file={bugFile}
                onFile={(file) => {
                  setBugFile(file)
                  setFieldErrors((current) => ({ ...current, bugFile: undefined }))
                }}
                icon={<Bug className="h-6 w-6 text-danger" />}
                accept=".csv,.xlsx,.xls,.json"
                label="上传 BUG 清单文件"
                hint="支持 CSV、Excel、JSON"
                accent="danger"
                error={fieldErrors.bugFile}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="primary-action px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {generating ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generating ? '生成中...' : '生成测试报告'}
            </button>

            <button
              type="button"
              onClick={handleDemo}
              disabled={generating}
              className="secondary-action px-5 py-2.5 text-sm disabled:opacity-50"
            >
              <Eye className="h-4 w-4" />
              查看演示报告
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface FileDropZoneProps {
  file: File | null
  onFile: (f: File | null) => void
  icon: ReactNode
  accept: string
  label: string
  hint: string
  accent: 'accent' | 'danger'
  error?: string
}

function FileDropZone({ file, onFile, icon, accept, label, hint, accent, error }: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  const palette = {
    accent: {
      border: 'oklch(0.58 0.17 262 / 0.28)',
      background: 'oklch(0.58 0.17 262 / 0.05)',
      strong: 'oklch(0.58 0.17 262)',
    },
    danger: {
      border: 'oklch(0.72 0.15 20 / 0.28)',
      background: 'oklch(0.72 0.15 20 / 0.05)',
      strong: 'oklch(0.55 0.2 25)',
    },
  }[accent]

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className="relative flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed px-5 py-8 text-center transition-all duration-200"
        style={{
          borderColor: error
            ? 'oklch(0.72 0.15 25 / 0.68)'
            : dragOver || file
              ? palette.border
              : 'oklch(0.88 0.01 264)',
          background: error
            ? 'linear-gradient(180deg, oklch(1 0 0 / 0.92), oklch(0.97 0.01 25 / 0.5))'
            : dragOver || file
              ? `linear-gradient(180deg, oklch(1 0 0 / 0.86), ${palette.background})`
              : 'oklch(0.995 0.002 264 / 0.72)',
          boxShadow: error ? '0 0 0 4px oklch(0.52 0.18 25 / 0.08)' : undefined,
        }}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-invalid={Boolean(error)}
        />

        {file ? (
          <>
            <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/90 shadow-[0_12px_32px_-20px_oklch(0.2_0.03_262/0.2)]" style={{ color: palette.strong }}>
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <div className="max-w-[240px] truncate text-[14px] font-semibold text-fg">{file.name}</div>
            <div className="text-[11px] text-muted">{(file.size / 1024).toFixed(1)} KB</div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFile(null) }}
              className="mt-2 text-[11px] font-medium text-muted hover:text-fg"
            >
              移除文件
            </button>
          </>
        ) : (
          <>
            <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/90 shadow-[0_12px_32px_-20px_oklch(0.2_0.03_262/0.2)]">
              {icon}
            </div>
            <div className="text-[14px] font-semibold text-fg">{label}</div>
            <div className="text-[11px] text-muted">{hint}</div>
            <div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: palette.strong }}>
              <Upload className="h-3 w-3" />
              点击选择或拖拽文件到此处
            </div>
          </>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}
