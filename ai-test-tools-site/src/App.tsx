import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Navbar } from './components/Navbar'
import { HomePage } from './pages/HomePage'
import { JmeterPage } from './pages/JmeterPage'
import { SettingsPage } from './pages/SettingsPage'
import { TestCasePage } from './pages/TestCasePage'
import { TestReportPage } from './pages/TestReportPage'
import { ReportViewPage } from './pages/ReportViewPage'

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <main className="relative z-[1]">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/jmeter" element={<JmeterPage />} />
          <Route path="/testcase" element={<TestCasePage />} />
          <Route path="/testreport" element={<TestReportPage />} />
          <Route path="/testreport/view" element={<ReportViewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
