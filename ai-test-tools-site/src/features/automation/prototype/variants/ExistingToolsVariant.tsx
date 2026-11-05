import {
  BarChart3,
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Gauge,
  LayoutGrid,
  ListChecks,
  Menu,
  Play,
  Plus,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { AllProjectsContent, Breadcrumbs, NewProjectContent, TestCasesContent, TestRunsContent } from '../PrototypeContent'
import { prototypeProjectName } from '../types'
import type { PrototypePage, ShellVariantProps } from '../types'
import { useMobileNavigation } from '../useMobileNavigation'

const tools = [
  ['Overview', LayoutGrid],
  ['Requirement Analysis', ClipboardCheck],
  ['Test Case Generator', FileText],
  ['Test Reports', BarChart3],
  ['Performance Testing', Gauge],
] as const

export function ExistingToolsVariant({ page, onNavigate }: ShellVariantProps) {
  const { mobileOpen, setMobileOpen, sidebarRef, menuButtonRef, closeButtonRef } = useMobileNavigation()
  const inProject = page === 'cases' || page === 'runs'
  const navigate = (next: PrototypePage) => {
    onNavigate(next)
    setMobileOpen(false)
  }

  return (
    <div className="tsp-tools-shell">
      {mobileOpen && <button type="button" className="tsp-nav-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside ref={sidebarRef} id="prototype-b-navigation" className={`tsp-tools-sidebar ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="NexusKit tools" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined}>
        <div className="tsp-tools-brand"><span className="tsp-brand-mark">N</span><strong>NexusKit</strong><button ref={closeButtonRef} type="button" className="tsp-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X aria-hidden="true" /></button></div>
        <div className="tsp-tools-label">TOOLS</div>
        <nav>
          {tools.map(([label, Icon]) => <button type="button" key={label} disabled><Icon aria-hidden="true" />{label}</button>)}
          <button type="button" className="is-active" onClick={() => navigate('projects')}><Bot aria-hidden="true" />Automation<ChevronDown aria-hidden="true" /></button>
          <div className="tsp-tool-submenu">
            <button type="button" className={page === 'projects' ? 'is-active' : ''} onClick={() => navigate('projects')}>All Projects</button>
            <button type="button" className={page === 'new-project' ? 'is-active' : ''} onClick={() => navigate('new-project')}>New Project</button>
          </div>
        </nav>
        <div className="tsp-tools-user"><span className="tsp-avatar">Y</span><span><strong>Current user</strong><small>Owner</small></span><Settings aria-hidden="true" /></div>
      </aside>
      <main className="tsp-main">
        <header className="tsp-topbar">
          <button ref={menuButtonRef} type="button" className="tsp-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-controls="prototype-b-navigation" aria-expanded={mobileOpen}><Menu aria-hidden="true" /></button>
          <Breadcrumbs items={inProject ? ['Automation', prototypeProjectName, page === 'cases' ? 'Test Cases' : 'Test Runs'] : ['Automation', page === 'new-project' ? 'New Project' : 'All Projects']} />
        </header>
        {inProject && <div className="tsp-project-top-context">
          <button type="button" className="tsp-project-switch" onClick={() => navigate('projects')}><span className="tsp-project-icon"><Bot aria-hidden="true" /></span>{prototypeProjectName}<ChevronDown aria-hidden="true" /></button>
          <nav aria-label="Project pages">
            <button type="button" className={page === 'cases' ? 'is-active' : ''} onClick={() => navigate('cases')}><ListChecks aria-hidden="true" />Test Cases<span>4</span></button>
            <button type="button" className={page === 'runs' ? 'is-active' : ''} onClick={() => navigate('runs')}><Play aria-hidden="true" />Test Runs</button>
            <button type="button" disabled><FolderKanban aria-hidden="true" />Test Lists</button>
            <button type="button" disabled><Sparkles aria-hidden="true" />Insights</button>
          </nav>
          <button type="button" className="tsp-button" onClick={() => navigate('new-project')}><Plus aria-hidden="true" />New Project</button>
        </div>}
        <div className="tsp-content-scroll">
          {page === 'projects' && <AllProjectsContent onNavigate={navigate} />}
          {page === 'new-project' && <NewProjectContent onNavigate={navigate} />}
          {page === 'cases' && <TestCasesContent />}
          {page === 'runs' && <TestRunsContent />}
        </div>
        {!inProject && <div className="tsp-variant-hint"><ChevronRight aria-hidden="true" />Open a project to compare the project-tab navigation.</div>}
      </main>
    </div>
  )
}
