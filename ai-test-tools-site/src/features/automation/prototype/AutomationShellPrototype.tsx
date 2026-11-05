import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PrototypeSwitcher } from './PrototypeSwitcher'
import type { PrototypePage, PrototypeVariant } from './types'
import { DedicatedShellVariant } from './variants/DedicatedShellVariant'
import { ExistingToolsVariant } from './variants/ExistingToolsVariant'
import { PersistentAutomationVariant } from './variants/PersistentAutomationVariant'
import './prototype.css'

const variants: PrototypeVariant[] = ['A', 'B', 'C']
const pages: PrototypePage[] = ['projects', 'new-project', 'cases', 'runs']

export default function AutomationShellPrototype() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedVariant = searchParams.get('variant') as PrototypeVariant
  const requestedPage = searchParams.get('page') as PrototypePage
  const variant = variants.includes(requestedVariant) ? requestedVariant : 'A'
  const page = pages.includes(requestedPage) ? requestedPage : 'cases'

  const navigate = useCallback((nextPage: PrototypePage) => {
    setSearchParams({ variant, page: nextPage }, { replace: true })
  }, [setSearchParams, variant])

  const changeVariant = useCallback((nextVariant: PrototypeVariant) => {
    setSearchParams({ variant: nextVariant, page }, { replace: true })
  }, [page, setSearchParams])

  return (
    <div className="tsp-prototype">
      <div className="tsp-prototype-label">THROWAWAY PROTOTYPE · IN-MEMORY DEMO DATA</div>
      {variant === 'A' && <DedicatedShellVariant page={page} onNavigate={navigate} />}
      {variant === 'B' && <ExistingToolsVariant page={page} onNavigate={navigate} />}
      {variant === 'C' && <PersistentAutomationVariant page={page} onNavigate={navigate} />}
      {import.meta.env.DEV && <PrototypeSwitcher current={variant} onChange={changeVariant} />}
    </div>
  )
}
