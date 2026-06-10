import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Footer } from './Footer'

describe('Footer', () => {
  it('renders the copyright text', () => {
    render(<Footer />)
    expect(screen.getByText(/AI测试工具/)).toBeInTheDocument()
  })

  it('renders the contact link', () => {
    render(<Footer />)
    expect(screen.getByText('联系我们')).toBeInTheDocument()
  })
})
