import { useState } from 'react'
import {
  Activity,
  BarChart3,
  BookOpenCheck,
  Bot,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileCode2,
  FolderKanban,
  LayoutGrid,
  ListChecks,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { AllProjectsContent, Breadcrumbs, NewProjectContent, TestCasesContent, TestRunsContent } from '../PrototypeContent'
import { prototypeProjectName } from '../types'
import type { ShellVariantProps } from '../types'
import { useMobileNavigation } from '../useMobileNavigation'

const projectNavigation = [
  { section: 'Setup', items: [['Sources', BookOpenCheck], ['Test Files', FileCode2]] },
  { section: 'Workspace', items: [['Test Cases', ListChecks], ['Test Runs', Play], ['Test Lists', FolderKanban], ['Test Schedules', Clock3]] },
  { section: 'Analytics', items: [['Insights', BarChart3]] },
] as const

export function DedicatedShellVariant({ page, onNavigate }: ShellVariantProps) {
  const [railExpanded, setRailExpanded] = useState(false)
  const { mobileOpen, setMobileOpen, sidebarRef, menuButtonRef, closeButtonRef } = useMobileNavigation()
  const [chatOpen, setChatOpen] = useState(false)
  const inProject = page === 'cases' || page === 'runs'
  const navigate = (next: Parameters<typeof onNavigate>[0]) => {
    onNavigate(next)
    setMobileOpen(false)
  }

  return (
    <div className="tsp-dedicated-shell">
      <aside className={`tsp-global-rail ${railExpanded ? 'is-expanded' : ''}`} aria-label="Global navigation">
        <button type="button" className="tsp-brand-mark" onClick={() => navigate('projects')} aria-label="NexusKit home">N</button>
        <nav>
          <button type="button" onClick={() => navigate('projects')}><LayoutGrid aria-hidden="true" /><span>Home</span></button>
          <button type="button" className="is-active" onClick={() => navigate('projects')}><Bot aria-hidden="true" /><span>Automation</span></button>
          <button type="button" disabled><Sparkles aria-hidden="true" /><span>AI tools</span></button>
        </nav>
        <div className="tsp-rail-bottom">
          <button type="button" disabled><CircleHelp aria-hidden="true" /><span>Help</span></button>
          <button type="button" onClick={() => setRailExpanded(!railExpanded)} aria-label={railExpanded ? 'Collapse global navigation' : 'Expand global navigation'}>{railExpanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}<span>Collapse</span></button>
          <button type="button" className="tsp-avatar" aria-label="Workspace account">Y</button>
        </div>
      </aside>

      {mobileOpen && <button type="button" className="tsp-nav-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside ref={sidebarRef} id="prototype-a-navigation" className={`tsp-project-sidebar ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="Automation navigation" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined}>
        <div className="tsp-workspace-switcher"><span className="tsp-workspace-icon">N</span><span><strong>NexusKit Workspace</strong><small>Owner</small></span><ChevronDown aria-hidden="true" /><button ref={closeButtonRef} type="button" className="tsp-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X aria-hidden="true" /></button></div>
        <nav className="tsp-sidebar-nav">
          <button type="button" className={page === 'projects' || page === 'new-project' ? 'is-active' : ''} onClick={() => navigate('projects')}><FolderKanban aria-hidden="true" />All Projects</button>
          <button type="button" onClick={() => navigate('new-project')}><Plus aria-hidden="true" />New Project</button>
          {inProject && <div className="tsp-project-nav tsp-nav-reveal">
            <button type="button" className="tsp-current-project" onClick={() => navigate('cases')}><span className="tsp-project-icon"><Bot aria-hidden="true" /></span><span>{prototypeProjectName}</span><ChevronDown aria-hidden="true" /></button>
            {projectNavigation.map((group) => <div className="tsp-nav-group" key={group.section}><h2>{group.section}</h2>{group.items.map(([label, Icon]) => {
              const target = label === 'Test Cases' ? 'cases' : label === 'Test Runs' ? 'runs' : null
              return <button type="button" key={label as string} className={page === target ? 'is-active' : ''} onClick={() => target && navigate(target)} disabled={!target}><Icon aria-hidden="true" />{label as string}{label === 'Test Cases' && <span className="tsp-nav-count">4</span>}</button>
            })}</div>)}
            <div className="tsp-nav-group"><h2>Project Settings</h2><button type="button" disabled><Settings aria-hidden="true" />General</button><button type="button" disabled><Activity aria-hidden="true" />Activity</button></div>
          </div>}
        </nav>
        <div className="tsp-get-started"><span>Get Started</span><strong>2/5</strong><div><i /></div></div>
      </aside>

      <main className="tsp-main">
        <header className="tsp-topbar">
          <button ref={menuButtonRef} type="button" className="tsp-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-controls="prototype-a-navigation" aria-expanded={mobileOpen}><Menu aria-hidden="true" /></button>
          <Breadcrumbs items={inProject ? [prototypeProjectName, page === 'cases' ? 'Test Cases' : 'Test Runs'] : [page === 'new-project' ? 'New Project' : 'All Projects']} />
          <button type="button" className={`tsp-chat-toggle ${chatOpen ? 'is-active' : ''}`} onClick={() => setChatOpen(!chatOpen)}><MessageSquare aria-hidden="true" />Chats</button>
        </header>
        <div className="tsp-content-scroll">
          {page === 'projects' && <AllProjectsContent onNavigate={navigate} />}
          {page === 'new-project' && <NewProjectContent onNavigate={navigate} />}
          {page === 'cases' && <TestCasesContent />}
          {page === 'runs' && <TestRunsContent />}
        </div>
        <aside className={`tsp-chat-panel ${chatOpen ? 'is-open' : ''}`} aria-label="AI chat" aria-hidden={!chatOpen} inert={!chatOpen}>
          <div><strong>Chats</strong><button type="button" onClick={() => setChatOpen(false)} aria-label="Close chat"><X aria-hidden="true" /></button></div>
          <section><span className="tsp-project-icon"><Sparkles aria-hidden="true" /></span><h2>What would you like to test?</h2><p>Ask about this project, generate tests, or investigate a result.</p></section>
          <label><span className="tsp-sr-only">Message AI chat</span><textarea placeholder="Ask TestSprite…" /><button type="button" className="tsp-button tsp-primary">Send</button></label>
        </aside>
      </main>
    </div>
  )
}
