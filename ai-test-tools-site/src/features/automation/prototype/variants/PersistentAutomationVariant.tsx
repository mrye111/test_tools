import { useState } from 'react'
import {
  Activity,
  BarChart3,
  BookOpenCheck,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileCode2,
  FolderKanban,
  KeyRound,
  ListChecks,
  Menu,
  MessageSquare,
  Play,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react'
import { AllProjectsContent, Breadcrumbs, NewProjectContent, TestCasesContent, TestRunsContent } from '../PrototypeContent'
import { prototypeProjectName } from '../types'
import type { PrototypePage, ShellVariantProps } from '../types'
import { useMobileNavigation } from '../useMobileNavigation'

const projectItems = [
  ['Sources', BookOpenCheck, null],
  ['Test Files', FileCode2, null],
  ['Test Cases', ListChecks, 'cases'],
  ['Test Runs', Play, 'runs'],
  ['Test Lists', FolderKanban, null],
  ['Test Schedules', Clock3, null],
  ['Insights', BarChart3, null],
] as const

export function PersistentAutomationVariant({ page, onNavigate }: ShellVariantProps) {
  const { mobileOpen, setMobileOpen, sidebarRef, menuButtonRef, closeButtonRef } = useMobileNavigation()
  const [chatOpen, setChatOpen] = useState(false)
  const inProject = page === 'cases' || page === 'runs'
  const navigate = (next: PrototypePage) => {
    onNavigate(next)
    setMobileOpen(false)
  }

  return (
    <div className="tsp-hybrid-shell">
      {mobileOpen && <button type="button" className="tsp-nav-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside ref={sidebarRef} id="prototype-c-navigation" className={`tsp-hybrid-sidebar ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="Automation workspace" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined}>
        <div className="tsp-hybrid-brand"><span className="tsp-brand-mark">N</span><span><strong>NexusKit</strong><small>Automation</small></span><button ref={closeButtonRef} type="button" className="tsp-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X aria-hidden="true" /></button></div>
        <button type="button" className="tsp-hybrid-workspace"><span className="tsp-workspace-icon">N</span><span>NexusKit Workspace</span><ChevronDown aria-hidden="true" /></button>
        <nav className="tsp-sidebar-nav">
          <h2>AUTOMATION</h2>
          <button type="button" className={page === 'projects' ? 'is-active' : ''} onClick={() => navigate('projects')}><FolderKanban aria-hidden="true" />All Projects<span className="tsp-nav-count">2</span></button>
          <button type="button" className={page === 'new-project' ? 'is-active' : ''} onClick={() => navigate('new-project')}><Plus aria-hidden="true" />New Project</button>
          <div className={`tsp-hybrid-project ${inProject ? 'is-current' : ''}`}>
            <button type="button" className="tsp-current-project" onClick={() => navigate('cases')}><span className="tsp-project-icon"><Bot aria-hidden="true" /></span><span>{prototypeProjectName}</span><ChevronDown aria-hidden="true" /></button>
            <div className="tsp-hybrid-project-links">
              {projectItems.map(([label, Icon, target]) => <button type="button" key={label} className={page === target ? 'is-active' : ''} onClick={() => target && navigate(target)} disabled={!target}><Icon aria-hidden="true" />{label}{label === 'Test Cases' && <span className="tsp-nav-count">4</span>}</button>)}
            </div>
          </div>
          <h2>WORKSPACE</h2>
          <button type="button" disabled><Users aria-hidden="true" />Members</button>
          <button type="button" disabled><Activity aria-hidden="true" />Activity</button>
          <button type="button" disabled><KeyRound aria-hidden="true" />API Keys</button>
          <button type="button" disabled><Settings aria-hidden="true" />Settings</button>
        </nav>
        <button type="button" className="tsp-hybrid-chat" onClick={() => setChatOpen(!chatOpen)}><MessageSquare aria-hidden="true" />Open AI Chat<ChevronRight aria-hidden="true" /></button>
      </aside>
      <main className="tsp-main">
        <header className="tsp-topbar">
          <button ref={menuButtonRef} type="button" className="tsp-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-controls="prototype-c-navigation" aria-expanded={mobileOpen}><Menu aria-hidden="true" /></button>
          <Breadcrumbs items={inProject ? ['Automation', prototypeProjectName, page === 'cases' ? 'Test Cases' : 'Test Runs'] : ['Automation', page === 'new-project' ? 'New Project' : 'All Projects']} />
          <span className="tsp-environment-badge">Workspace · Owner</span>
        </header>
        <div className="tsp-content-scroll">
          {page === 'projects' && <AllProjectsContent onNavigate={navigate} />}
          {page === 'new-project' && <NewProjectContent onNavigate={navigate} />}
          {page === 'cases' && <TestCasesContent />}
          {page === 'runs' && <TestRunsContent />}
        </div>
        <aside className={`tsp-chat-panel ${chatOpen ? 'is-open' : ''}`} aria-label="AI chat" aria-hidden={!chatOpen} inert={!chatOpen}>
          <div><strong>AI Chat</strong><button type="button" onClick={() => setChatOpen(false)} aria-label="Close chat"><X aria-hidden="true" /></button></div>
          <section><span className="tsp-project-icon"><Bot aria-hidden="true" /></span><h2>Automation assistant</h2><p>This overlay stays available across project and workspace pages.</p></section>
          <label><span className="tsp-sr-only">Message AI chat</span><textarea placeholder="Ask about automation…" /><button type="button" className="tsp-button tsp-primary">Send</button></label>
        </aside>
      </main>
    </div>
  )
}
