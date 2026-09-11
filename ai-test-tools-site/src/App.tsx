import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useLayoutEffect } from 'react'
import { Navbar } from './components/Navbar'
import { HomePage } from './pages/HomePage'
import { JmeterPage } from './pages/JmeterPage'
import { SettingsPage } from './pages/SettingsPage'
import { TestCasePage } from './pages/TestCasePage'
import { TestReportPage } from './pages/TestReportPage'
import { ReportViewPage } from './pages/ReportViewPage'
import { DataFactoryPage } from './pages/DataFactoryPage'
import { RequirementAnalysisPage } from './pages/RequirementAnalysisPage'
import { RequirementAnalysisViewPage } from './pages/RequirementAnalysisViewPage'
import { ErrorDialogProvider } from './components/ui/ErrorDialogProvider'

// 路由切换时回到页面顶部。全局 html 开了 scroll-behavior: smooth，
// 必须显式传 instant，否则换页会看到一段从底部滚回顶部的动画
function ScrollToTop() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

export default function App() {
  return (
    <ErrorDialogProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Navbar />
        <main className="relative z-[1]">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/jmeter" element={<JmeterPage />} />
            <Route path="/testcase" element={<TestCasePage />} />
            <Route path="/testcase/sets/:setId" element={<TestCasePage />} />
            <Route path="/testreport" element={<TestReportPage />} />
            <Route path="/testreport/reports/:id" element={<ReportViewPage />} />
            <Route path="/data-factory" element={<DataFactoryPage />} />
            <Route path="/requirement-analysis" element={<RequirementAnalysisPage />} />
            <Route path="/requirement-analysis/records/:id" element={<RequirementAnalysisViewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </ErrorDialogProvider>
  )
}
