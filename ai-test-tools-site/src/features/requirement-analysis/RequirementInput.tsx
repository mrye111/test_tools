import { useRef, useState } from 'react'
import { FileUp, Loader2, Sparkles, X } from 'lucide-react'
import {
  REQUIREMENT_FILE_ACCEPT,
  REQUIREMENT_FILE_MAX_BYTES,
  type AnalyzeRequirementInput,
} from '../../lib/requirement-analysis-api'

const SUPPORTED_HINT = '支持 .md / .txt / .docx / .xlsx / .xls / .csv / 文字型 .pdf，单个文件不超过 10MB'

type RequirementInputProps = {
  running: boolean
  onSubmit: (input: AnalyzeRequirementInput) => void
}

/** 需求输入区：上传文档或粘贴文本，提交后立即开始分析。 */
export function RequirementInput(props: RequirementInputProps) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null
    event.target.value = ''
    setInputError(null)
    if (!selected) return
    if (selected.size > REQUIREMENT_FILE_MAX_BYTES) {
      setInputError(`文件 ${selected.name} 超过 10MB，请精简后再上传，或改为粘贴文本。`)
      return
    }
    setFile(selected)
  }

  const handleSubmit = () => {
    setInputError(null)
    if (file) {
      props.onSubmit({ kind: 'file', file })
      return
    }
    if (!text.trim()) {
      setInputError('请先上传需求文档，或粘贴需求文本。')
      return
    }
    props.onSubmit({ kind: 'text', text: text.trim() })
  }

  return (
    <section className="surface-panel requirement-input-panel">
      <div className="requirement-input-header">
        <h2 className="requirement-panel-title">需求输入</h2>
        <p className="requirement-input-hint">{SUPPORTED_HINT}</p>
      </div>

      <div className="requirement-upload-row">
        <input
          ref={fileInputRef}
          type="file"
          accept={REQUIREMENT_FILE_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="secondary-action px-4 py-2.5 text-sm"
          disabled={props.running}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="h-4 w-4" />上传需求文档
        </button>
        {file && (
          <span className="requirement-file-chip">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              aria-label="移除已选文件"
              disabled={props.running}
              onClick={() => setFile(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {!file && (
        <textarea
          className="field-control requirement-text-input"
          rows={10}
          placeholder="粘贴需求文档文本，例如：用户可通过手机号 + 验证码登录，连续输错 5 次锁定 30 分钟……"
          value={text}
          disabled={props.running}
          onChange={(event) => { setText(event.target.value); setInputError(null) }}
        />
      )}

      {inputError && <p className="field-error">{inputError}</p>}

      <div className="requirement-input-actions">
        <button
          type="button"
          className="primary-action px-5 py-2.5 text-sm"
          disabled={props.running || (!file && !text.trim())}
          onClick={handleSubmit}
        >
          {props.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {props.running ? '正在分析…' : '开始分析'}
        </button>
        {file && <span className="field-hint">将解析「{file.name}」并立即开始分析</span>}
      </div>
    </section>
  )
}
