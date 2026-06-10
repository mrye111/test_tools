import { Plus, Trash2 } from 'lucide-react'
import type { ParamItem } from '../../data/http-request-types'
import { createEmptyParam } from '../../data/http-request-types'

interface ParamTableProps {
  value: ParamItem[]
  onChange: (value: ParamItem[]) => void
  label?: string
  showEncode?: boolean
}

export function ParamTable({ value, onChange, label = '参数', showEncode = true }: ParamTableProps) {
  const handleAdd = () => onChange([...value, createEmptyParam()])
  const handleRemove = (index: number) => onChange(value.filter((_, i) => i !== index))
  const handleUpdate = (index: number, field: keyof ParamItem, val: string | boolean) => {
    onChange(value.map((item, i) => i === index ? { ...item, [field]: val } : item))
  }
  const handleToggle = (index: number) => handleUpdate(index, 'enabled', !value[index].enabled)

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</span>
        <button type="button" onClick={handleAdd} className="secondary-action px-2 py-1 text-[11px]">
          <Plus className="h-3 w-3" />
          添加
        </button>
      </div>

      {value.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300/80 bg-white/70 py-5 text-center text-[12px] text-slate-400">
          暂无参数
        </div>
      ) : (
        <div className="table-shell overflow-hidden rounded-xl">
          <div className={`grid gap-2 bg-slate-50 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted ${showEncode ? 'grid-cols-[20px_1fr_1fr_36px_36px] max-sm:grid-cols-[20px_1fr_1fr_36px]' : 'grid-cols-[20px_1fr_1fr_36px]'}`}>
            <div></div>
            <div>Key</div>
            <div>Value</div>
            {showEncode && <div className="text-center">Enc</div>}
            <div></div>
          </div>
          {value.map((param, index) => (
            <div key={index} className={`grid items-center gap-2 border-t border-slate-100 px-3 py-1.5 transition-colors duration-150 hover:bg-slate-50/70 ${param.enabled ? '' : 'opacity-40'} ${showEncode ? 'grid-cols-[20px_1fr_1fr_36px_36px] max-sm:grid-cols-[20px_1fr_1fr_36px]' : 'grid-cols-[20px_1fr_1fr_36px]'}`}>
              <input type="checkbox" checked={param.enabled} onChange={() => handleToggle(index)} className="h-3.5 w-3.5 cursor-pointer accent-[#2563eb]" />
              <input type="text" value={param.key} onChange={(e) => handleUpdate(index, 'key', e.target.value)} placeholder="key" className="rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-fg outline-none transition-all duration-150 focus:border-accent focus:bg-white focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]" />
              <input type="text" value={param.value} onChange={(e) => handleUpdate(index, 'value', e.target.value)} placeholder="value" className="rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-fg outline-none transition-all duration-150 focus:border-accent focus:bg-white focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]" />
              {showEncode && <input type="checkbox" checked={param.encode} onChange={() => handleUpdate(index, 'encode', !param.encode)} className="h-3.5 w-3.5 cursor-pointer accent-[#2563eb]" title="URL 编码" />}
              <button type="button" onClick={() => handleRemove(index)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-all duration-150 hover:bg-[#fef2f2] hover:text-[#dc2626]">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
