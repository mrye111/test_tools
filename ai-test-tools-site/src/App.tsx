import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
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
import { AutomationCaseEditorPage, ProjectListView, ProjectWizardView, ProjectWorkbenchView } from './features/automation/AutomationPage'
import { RunDetailView } from './features/automation/RunDetailView'
import { TestListsView } from './features/automation/TestListsView'
import { LoadTestPage } from './pages/LoadTestPage'
import { LoadTestWorkspacePage } from './pages/LoadTestWorkspacePage'
import { ErrorDialogProvider } from './components/ui/ErrorDialogProvider'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { AuthProvider, GuestOnly, RequireAdmin, RequireAuth } from './lib/auth-context'

// 路由切换时回到页面顶部。全局 html 开了 scroll-behavior: smooth，
// 必须显式传 instant，否则换页会看到一段从底部滚回顶部的动画
function ScrollToTop() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

/** 应用外壳：导航栏 + 主内容区。登录/注册为独立整页，不进此外壳。 */
function ShellLayout() {
  return (
    <>
      <Navbar />
      <main className="relative z-[1]">
        <Outlet />
      </main>
    </>
  )
}

export default function App() {
  return (
    <ErrorDialogProvider>
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <Routes>
            {/* 登录/注册：独立整页（无导航外壳），已登录则跳出（GuestOnly） */}
            <Route element={<GuestOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Route>
            <Route element={<ShellLayout />}>
              {/* 公开页：落地目录（工具详情能力均在受保护路由内） */}
              <Route path="/" element={<HomePage />} />
              {/* 登录后可用：后端 API 全量会话门禁，前端同步守卫 */}
              <Route element={<RequireAuth />}>
                <Route path="/jmeter" element={<JmeterPage />} />
                <Route path="/testcase" element={<TestCasePage />} />
                <Route path="/testcase/sets/:setId" element={<TestCasePage />} />
                <Route path="/testreport" element={<TestReportPage />} />
                <Route path="/testreport/reports/:id" element={<ReportViewPage />} />
                <Route path="/data-factory" element={<DataFactoryPage />} />
                <Route path="/requirement-analysis" element={<RequirementAnalysisPage />} />
                <Route path="/requirement-analysis/records/:id" element={<RequirementAnalysisViewPage />} />
                <Route path="/automation" element={<ProjectListView />} />
                <Route path="/automation/new" element={<ProjectWizardView />} />
                <Route path="/automation/lists" element={<TestListsView />} />
                <Route path="/automation/p/:projectId/runs/:runId" element={<RunDetailView />} />
                <Route path="/automation/p/:projectId/:section?" element={<ProjectWorkbenchView />} />
                <Route path="/automation/cases/:id" element={<AutomationCaseEditorPage />} />
                <Route path="/loadtest" element={<LoadTestPage />} />
                <Route path="/loadtest/projects/:id" element={<LoadTestWorkspacePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* 管理员路由 */}
                <Route element={<RequireAdmin />}>
                  <Route path="/admin/users" element={<AdminUsersPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorDialogProvider>
  )
}
