export type PrototypePage = 'projects' | 'new-project' | 'cases' | 'runs'

export type PrototypeVariant = 'A' | 'B' | 'C'

export interface ShellVariantProps {
  page: PrototypePage
  onNavigate: (page: PrototypePage) => void
}

export const prototypeProjectName = 'Customer Portal'
