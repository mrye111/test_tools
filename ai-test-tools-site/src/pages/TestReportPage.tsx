import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, FileSpreadsheet, Bug, Sparkles } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { CustomSelect } from '../components/ui/CustomSelect'
import { generateDemoReportData } from '../lib/test-report-demo'

const PLATFORM_OPTIONS = [
  { value: 'jira', label: 'Jira' },
  { value: 'zentao', label: '禅道 (ZenTao)' },
  { value: 'pingcode', label: 'PingCode' },
  { value: 'teambition', label: 'Teambition' },
  { value: 'bugzilla', label: 'Bugzilla' },
  { value: 'tapd', label: 'TAPD' },
  { value: 'excel', label: '通用 Excel/CSV' },
]

export function TestReportPage() {
  const navigate = useNavigate()
  const [platform, setPlatform] = useState('jira')
  const [caseFile, setCaseFile] = useState<File | null>(null)
  const [bugFile, setBugFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)

  const canGenerate = caseFile !== null && bugFile !== null

  const handleGenerate = () => {
    setGenerating(true)
    // 用演示数据生成报告，存储到 sessionStorage
    const data = generateDemoReportData()
    data.platform = PLATFORM_OPTIONS.find((p) => p.value === platform)?.label ?? platform
    sessionStorage.setItem('test-report-data', JSON.stringify(data))
    // 延迟跳转，模拟生成过程
    setTimeout(() => {
      navigate('/testreport/view')
    }, 800)
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
    <div className="page-shell max-w-[860px]">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回首页">
            <a href="/" className="icon-action h-10 w-10 rounded-xl" onClick={(e) => { e.preventDefault(); navigate('/') }}>
              <ArrowLeft className="h-4 w-4" />
            </a>
          </Tooltip>
          <div>
            <h1 className="page-title">测试报告</h1>
            <p className="page-subtitle">导入测试用例执行结果与 BUG 清单，自动生成可视化质量分析报告</p>
          </div>
        </div>
      </div>

      {/* Import Section */}
      <div className="surface-panel motion-card stagger-1 rounded-[28px] p-6">
        <div className="relative z-[1]">
          {/* Platform selector */}
          <div className="mb-6">
            <label className="field-label">数据来源平台</label>
            <CustomSelect
              value={platform}
              onChange={setPlatform}
              options={PLATFORM_OPTIONS}
              placeholder="选择测试管理平台"
              className="max-w-[320px]"
            />
            <p className="helper-text">选择数据来源，不同平台的导入格式会有所不同</p>
          </div>

          {/* File uploads */}
          <div className="grid gap-5 md:grid-cols-2">
            {/* Test case file */}
            <div>
              <label className="field-label">
                测试用例执行结果 <span className="text-[#dc2626]">*</span>
              </label>
              <FileDropZone
                file={caseFile}
                onFile={setCaseFile}
                icon={<FileSpreadsheet className="h-6 w-6 text-accent" />}
                accept=".csv,.xlsx,.xls,.json"
                label="上传用例执行结果文件"
                hint="支持 CSV、Excel、JSON 格式"
              />
            </div>

            {/* Bug file */}
            <div>
              <label className="field-label">
                BUG 清单 <span className="text-[#dc2626]">*</span>
              </label>
              <FileDropZone
                file={bugFile}
                onFile={setBugFile}
                icon={<Bug className="h-6 w-6 text-rose-500" />}
                accept=".csv,.xlsx,.xls,.json"
                label="上传 BUG 清单文件"
                hint="支持 CSV、Excel、JSON 格式"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate || generating}
              className="primary-action px-6 py-2.5 text-sm disabled:opacity-50"
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
              <Sparkles className="h-4 w-4" />
              查看演示报告
            </button>
          </div>
        </div>
      </div>

      {/* Format hint */}
      <div className="surface-panel motion-card stagger-2 mt-5 rounded-[24px] p-5">
        <div className="relative z-[1]">
          <h3 className="font-display text-base font-semibold tracking-[-0.03em] text-fg">导入格式说明</h3>
          <div className="mt-3 space-y-2 text-[13px] leading-6 text-muted">
            <p><span className="font-semibold text-fg">用例执行结果</span> — 必须包含列：用例编号、所属模块、用例标题、执行结果（Pass/Fail/Blocked/未执行）、优先级、执行人</p>
            <p><span className="font-semibold text-fg">BUG 清单</span> — 必须包含列：BUG 编号、所属模块、标题、严重程度、状态、指派人、创建时间、解决时间（可选）</p>
            <p className="text-[12px] text-[oklch(0.68_0.015_260)]">各平台导出的 CSV/Excel 文件均可直接使用，列名不区分大小写，支持中英文混合列名。</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 文件拖拽区域组件 ──

interface FileDropZoneProps {
  file: File | null
  onFile: (f: File | null) => void
  icon: React.ReactNode
  accept: string
  label: string
  hint: string
}

function FileDropZone({ file, onFile, icon, accept, label, hint }: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-all duration-200 ${
        dragOver
          ? 'border-accent bg-[oklch(0.62_0.18_265/0.06)]'
          : file
            ? 'border-[oklch(0.52_0.14_160/0.4)] bg-[oklch(0.52_0.14_160/0.04)]'
            : 'border-[oklch(0.88_0.01_260)] bg-[oklch(0.985_0.003_260/0.5)] hover:border-[oklch(0.78_0.02_260)]'
      }`}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleChange}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      {file ? (
        <>
          <FileSpreadsheet className="h-6 w-6 text-[oklch(0.52_0.14_160)]" />
          <div className="text-[13px] font-semibold text-fg">{file.name}</div>
          <div className="text-[11px] text-muted">{(file.size / 1024).toFixed(1)} KB</div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFile(null) }}
            className="mt-1 text-[11px] text-[#dc2626] hover:underline"
          >
            移除文件
          </button>
        </>
      ) : (
        <>
          {icon}
          <div className="text-[13px] font-medium text-muted">{label}</div>
          <div className="text-[11px] text-[oklch(0.68_0.015_260)]">{hint}</div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[oklch(0.58_0.02_260)]">
            <Upload className="h-3 w-3" />
            点击选择或拖拽文件至此处
          </div>
        </>
      )}
    </div>
  )
}
