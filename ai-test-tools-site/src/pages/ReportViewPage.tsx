import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { REPORT_THEMES, ReportHeader, TestReportView, buildReportViewModel, type ReportThemeKey } from '../features/test-report/report-view'
import type { ReportData } from '../data/test-report-types'

export function ReportViewPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<ReportData | null>(null)
  const [themeKey, setThemeKey] = useState<ReportThemeKey>('current')

  useEffect(() => {
    const raw = sessionStorage.getItem('test-report-data')
    if (!raw) {
      navigate('/testreport')
      return
    }
    try {
      setData(JSON.parse(raw))
    } catch {
      navigate('/testreport')
    }
  }, [navigate])

  const theme = REPORT_THEMES[themeKey]
  const viewModel = useMemo(() => (data ? buildReportViewModel(data) : null), [data])

  if (!data || !viewModel) return null

  return (
    <div className="page-shell">
      <div
        className="relative overflow-hidden rounded-[36px] px-4 py-4 sm:px-5 sm:py-5"
        style={{
          background: theme.page.background,
          border: theme.page.border,
          boxShadow: theme.page.shadow,
        }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-6 top-4 h-44 w-44 rounded-full blur-3xl" style={{ background: theme.shellAuras[0] }} />
          <div className="absolute right-8 top-2 h-40 w-40 rounded-full blur-3xl" style={{ background: theme.shellAuras[1] }} />
          <div className="absolute bottom-0 left-1/3 h-52 w-52 rounded-full blur-3xl" style={{ background: theme.shellAuras[2] }} />
        </div>

        <div className="relative z-[1]">
          <ReportHeader
            data={data}
            theme={theme}
            themeKey={themeKey}
            onThemeChange={setThemeKey}
            onBack={() => navigate('/testreport')}
          />
          <TestReportView theme={theme} viewModel={viewModel} />
        </div>
      </div>
    </div>
  )
}
