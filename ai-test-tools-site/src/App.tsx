import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { lazy, Suspense, useLayoutEffect } from 'react'
import { Navbar } from './components/Navbar'
import { HomePage } from './pages/HomePage'
import { JmeterPage } from './pages/JmeterPage'
import { SettingsPage } from './pages/SettingsPage'
import { TestCasePage } from './pages/TestCasePage'
import { TestReportPage } from './pages/TestReportPage'
import { ReportViewPage } from './pages/ReportViewPage'
import { DataFactoryPage } from './pages/DataFactoryPage'
import { ErrorDialogProvider } from './components/ui/ErrorDialogProvider'
import { ChatShell } from './features/requirement-analysis/chat/ChatShell'
import { NewChatHome } from './features/requirement-analysis/chat/NewChatHome'
import { ChatView } from './features/requirement-analysis/chat/ChatView'
import { LibraryPage } from './features/requirement-analysis/library/LibraryPage'

// 需求分析页携带 echarts/markmap 等重型图表依赖，按路由懒加载，
// 避免首页为首屏动画之外的代码付出解析成本

// 分析画板为独立路由（ADR 0006），同样懒加载并与需求分析页共享重型依赖分包
const AnalysisBoardPage = lazy(() =>
  import('./pages/AnalysisBoardPage').then((module) => ({ default: module.AnalysisBoardPage })),
)

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
            <Route path="/testreport" element={<TestReportPage />} />
            <Route path="/testreport/view" element={<ReportViewPage />} />
            <Route path="/data-factory" element={<DataFactoryPage />} />
            <Route path="/requirement-analysis" element={<ChatShell />}>
              <Route index element={<NewChatHome />} />
              <Route path="chat/:sessionId" element={<ChatView />} />
              <Route path="library" element={<LibraryPage />} />
            </Route>
            <Route
              path="/requirement-analysis/board/:id"
              element={
                <Suspense fallback={<div className="mx-auto max-w-[1200px] px-6 py-16 text-center text-muted">分析画板加载中…</div>}>
                  <AnalysisBoardPage />
                </Suspense>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </ErrorDialogProvider>
  )
}
