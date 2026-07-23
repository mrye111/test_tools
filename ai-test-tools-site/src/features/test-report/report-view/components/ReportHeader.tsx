import { ArrowLeft } from 'lucide-react'
import { Tooltip } from '../../../../components/ui/Tooltip'
import { CustomSelect } from '../../../../components/ui/CustomSelect'
import type { ReportData } from '../../../../data/test-report-types'
import { REPORT_THEME_OPTIONS } from '../constants'
import type { ReportTheme, ReportThemeKey } from '../types'

export function ReportHeader({
  data,
  theme,
  themeKey,
  onThemeChange,
  onBack,
}: {
  data: ReportData
  theme: ReportTheme
  themeKey: ReportThemeKey
  onThemeChange: (value: ReportThemeKey) => void
  onBack: () => void
}) {
  return (
    <div className="page-header mb-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-center gap-3 xl:flex-1">
          <Tooltip content="返回导入页">
            <button
              onClick={onBack}
              className="icon-action h-10 w-10 rounded-2xl"
              style={{ background: theme.iconButton.bg, color: theme.iconButton.text, border: theme.iconButton.border }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ background: theme.headerBadge.bg, color: theme.headerBadge.text, border: theme.headerBadge.border }}
              >
                Quality Dashboard
              </span>
              <span
                className="rounded-full px-3 py-1 text-[11px] font-semibold"
                style={{ background: theme.platformBadge.bg, color: theme.platformBadge.text, border: theme.platformBadge.border }}
              >
                {data.platform}
              </span>
            </div>
            <h1 className="page-title text-[30px] tracking-[-0.05em]" style={{ color: theme.text.primary }}>{data.title}</h1>
            <p className="page-subtitle mt-2 text-[13px]" style={{ color: theme.text.secondary }}>
              生成时间：{new Date(data.generatedAt).toLocaleString('zh-CN')}，从测试结果与缺陷清单中提炼关键质量信号。
            </p>
          </div>
        </div>

        <div
          className="w-full rounded-[24px] p-3 xl:ml-auto xl:w-[280px] xl:flex-none"
          style={{ background: theme.switcher.bg, border: theme.switcher.border, boxShadow: theme.surface.nestedShadow }}
        >
          <div>
            <CustomSelect
              value={themeKey}
              onChange={(value) => onThemeChange(value as ReportThemeKey)}
              options={REPORT_THEME_OPTIONS}
              placeholder="选择风格"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
