import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Filter,
  Globe2,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Sparkles,
} from 'lucide-react'
import type { PrototypePage } from './types'
import { prototypeProjectName } from './types'

interface ContentProps {
  onNavigate: (page: PrototypePage) => void
}

export function Breadcrumbs({ items }: { items: string[] }) {
  return (
    <nav className="tsp-breadcrumbs" aria-label="breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={item}>
            {index > 0 && <ChevronRight aria-hidden="true" />}
            <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function ProjectActions() {
  return (
    <div className="tsp-page-actions">
      <button type="button" className="tsp-button"><Share2 aria-hidden="true" />Share</button>
      <button type="button" className="tsp-icon-button" aria-label="Copy link to this page"><Copy aria-hidden="true" /></button>
    </div>
  )
}

export function AllProjectsContent({ onNavigate }: ContentProps) {
  return (
    <div className="tsp-page tsp-enter">
      <div className="tsp-title-row">
        <div><h1>All Projects</h1><p>Every project in this workspace, with its latest results.</p></div>
        <button type="button" className="tsp-button tsp-primary" onClick={() => onNavigate('new-project')}><Plus aria-hidden="true" />New Project</button>
      </div>
      <div className="tsp-toolbar">
        <label className="tsp-search"><Search aria-hidden="true" /><input aria-label="Search projects" placeholder="Search" /></label>
        <button type="button" className="tsp-icon-button" aria-label="Filter projects"><Filter aria-hidden="true" /></button>
        <button type="button" className="tsp-icon-button" aria-label="Sort projects"><ChevronDown aria-hidden="true" /></button>
      </div>
      <div className="tsp-tabs" role="tablist" aria-label="Project source">
        {['All', 'Web Portal', 'CLI', 'MCP'].map((tab, index) => <button key={tab} type="button" role="tab" aria-selected={index === 0} className={index === 0 ? 'is-active' : ''}>{tab}{index === 0 && <span>2</span>}</button>)}
      </div>
      <div className="tsp-table-wrap">
        <table className="tsp-table">
          <thead><tr><th>Project Name</th><th>Latest Results</th><th>Last Activity</th><th>Created At</th><th>Source</th><th>Type</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            <tr>
              <td><button type="button" className="tsp-project-link" onClick={() => onNavigate('cases')}><span className="tsp-project-icon"><Globe2 aria-hidden="true" /></span>{prototypeProjectName}</button></td>
              <td><span className="tsp-result passed">8</span><span className="tsp-result failed">1</span><span className="tsp-result blocked">1</span></td><td>2m ago</td><td>Nov 4, 2026</td><td>Web Portal</td><td>Frontend</td><td><MoreHorizontal aria-hidden="true" /></td>
            </tr>
            <tr>
              <td><button type="button" className="tsp-project-link" onClick={() => onNavigate('cases')}><span className="tsp-project-icon"><Sparkles aria-hidden="true" /></span>Order Service API</button></td>
              <td><span className="tsp-result passed">12</span><span className="tsp-result failed">0</span><span className="tsp-result blocked">0</span></td><td>1h ago</td><td>Nov 3, 2026</td><td>Web Portal</td><td>Backend</td><td><MoreHorizontal aria-hidden="true" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="tsp-pagination"><span>25 Rows</span><button type="button">Previous</button><strong>1</strong><button type="button">Next</button></div>
    </div>
  )
}

export function NewProjectContent({ onNavigate }: ContentProps) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  return (
    <div className="tsp-page tsp-enter">
      <button type="button" className="tsp-back-link" onClick={() => onNavigate('projects')}><ArrowLeft aria-hidden="true" />All Projects</button>
      <div className="tsp-title-row"><div><h1>Create a project</h1><p>Where the AI agent will run your tests.</p></div></div>
      <div className="tsp-create-layout">
        <section className="tsp-create-card">
          <ol className="tsp-stepper">
            {['Basics', 'Access details', 'Extra Context'].map((label, index) => <li key={label} className={step === index + 1 ? 'is-active' : step > index + 1 ? 'is-complete' : ''}><span>{step > index + 1 ? <Check aria-hidden="true" /> : index + 1}</span>{label}</li>)}
          </ol>
          <div className="tsp-form-stage" key={step}>
            {step === 1 && <><h2>What to test</h2><div className="tsp-type-options"><button type="button" className="is-selected"><Globe2 aria-hidden="true" /><strong>Frontend</strong><span>Test a web application</span></button><button type="button"><Sparkles aria-hidden="true" /><strong>Backend</strong><span>Test an API</span></button></div><label className="tsp-field"><span>Project name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="My application" /></label></>}
            {step === 2 && <><h2>Access details</h2><label className="tsp-field"><span>Website URL</span><input defaultValue="https://example.com" /></label><label className="tsp-field"><span>Test account <em>Optional</em></span><input placeholder="user@example.com" /></label></>}
            {step === 3 && <><h2>Extra Context</h2><label className="tsp-field"><span>Extra instructions</span><textarea placeholder="What should the agent pay attention to?" /></label><label className="tsp-upload"><Plus aria-hidden="true" /><span>Add source documents</span></label></>}
          </div>
          <div className="tsp-form-actions"><button type="button" className="tsp-button" onClick={() => step === 1 ? onNavigate('projects') : setStep(step - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button><button type="button" className="tsp-button tsp-primary" disabled={step === 1 && !name.trim()} onClick={() => step < 3 ? setStep(step + 1) : onNavigate('cases')}>{step === 3 ? 'Create project' : 'Continue'}<ChevronRight aria-hidden="true" /></button></div>
        </section>
        <aside className="tsp-other-ways"><h2>Other Ways to Start</h2><button type="button">Start with the CLI<ChevronRight aria-hidden="true" /></button><button type="button">Start with AI chat<ChevronRight aria-hidden="true" /></button><button type="button">MCP client<ChevronRight aria-hidden="true" /></button></aside>
      </div>
    </div>
  )
}

export function TestCasesContent() {
  const [tab, setTab] = useState('All')
  return (
    <div className="tsp-page tsp-enter">
      <div className="tsp-title-row"><div><div className="tsp-title-with-help"><h1>Test Cases</h1><CircleHelp aria-label="How testing works" /></div><p>Every test in this project, grouped by use case, with its latest result.</p></div><ProjectActions /></div>
      <div className="tsp-toolbar"><label className="tsp-search"><Search aria-hidden="true" /><input aria-label="Search tests" placeholder="Search Tests" /></label><button type="button" className="tsp-icon-button" aria-label="Filter tests"><Filter aria-hidden="true" /></button><span className="tsp-toolbar-spacer" /><button type="button" className="tsp-button">Edit Test Plan</button><button type="button" className="tsp-button"><Plus aria-hidden="true" />Add More Tests</button><button type="button" className="tsp-button tsp-primary">Run All 4</button></div>
      <div className="tsp-tabs tsp-status-tabs" role="tablist" aria-label="Test status">{[['All', '4'], ['Planned', '0'], ['Generated', '0'], ['Running', '0'], ['Passed', '2'], ['Failed', '1'], ['Blocked', '1']].map(([label, count]) => <button key={label} type="button" role="tab" aria-selected={tab === label} className={tab === label ? 'is-active' : ''} onClick={() => setTab(label)}>{label}<span>{count}</span></button>)}</div>
      <div className="tsp-table-wrap"><table className="tsp-table tsp-cases-table"><thead><tr><th><input type="checkbox" aria-label="Select all tests" /></th><th>ID</th><th>Latest Status</th><th>Test Name</th><th>Priority</th></tr></thead><tbody><tr className="tsp-group-row"><td><input type="checkbox" aria-label="Select Account tests" /></td><td colSpan={4}><ChevronDown aria-hidden="true" /><strong>Account &amp; Access</strong><span>4</span><i><b /></i></td></tr>{[['ACC-001', 'Passed', 'Sign in with valid credentials', 'High'], ['ACC-002', 'Failed', 'Reset a forgotten password', 'High'], ['ACC-003', 'Passed', 'Create a new account', 'Medium'], ['ACC-004', 'Blocked', 'Verify email with an expired link', 'Medium']].map(([id, status, name, priority]) => <tr key={id}><td><input type="checkbox" aria-label={`Select ${id}`} /></td><td className="tsp-mono">{id}</td><td><span className={`tsp-status tsp-${status.toLowerCase()}`}>{status}</span><small> · 2m ago</small></td><td>{name}</td><td>{priority}</td></tr>)}</tbody></table></div>
      <div className="tsp-pagination"><span>25 Rows</span><button type="button">Previous</button><strong>1</strong><button type="button">Next</button></div>
    </div>
  )
}

export function TestRunsContent() {
  return (
    <div className="tsp-page tsp-enter">
      <div className="tsp-title-row"><div><h1>Test Runs</h1><p>Every execution in this project, newest first.</p></div><ProjectActions /></div>
      <div className="tsp-toolbar"><label className="tsp-search"><Search aria-hidden="true" /><input aria-label="Search runs" placeholder="Search Runs" /></label><button type="button" className="tsp-button"><Filter aria-hidden="true" />Status</button></div>
      <div className="tsp-table-wrap"><table className="tsp-table"><thead><tr><th>Run</th><th>Status</th><th>Results</th><th>Triggered</th><th>Duration</th><th /></tr></thead><tbody><tr><td><strong>Manual Run</strong><small> #1004</small></td><td><span className="tsp-status tsp-completed">Completed</span></td><td><span className="tsp-result passed">8</span><span className="tsp-result failed">1</span><span className="tsp-result blocked">1</span></td><td><Clock3 aria-hidden="true" /> 2m ago</td><td>4m 18s</td><td><button type="button" className="tsp-button">View Report</button></td></tr></tbody></table></div>
    </div>
  )
}
