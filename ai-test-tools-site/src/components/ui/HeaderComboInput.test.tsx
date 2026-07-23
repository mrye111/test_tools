import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HeaderComboInput } from './HeaderComboInput'

const SUGGESTIONS = Array.from({ length: 40 }, (_, i) => `Header-${i}`)

function setup() {
  const onChange = vi.fn()
  render(
    <HeaderComboInput
      value=""
      onChange={onChange}
      placeholder="Header 名称"
      suggestions={SUGGESTIONS}
    />,
  )
  const input = screen.getByPlaceholderText('Header 名称') as HTMLInputElement
  return { input, onChange }
}

describe('HeaderComboInput', () => {
  beforeEach(() => {
    // Provide a stable viewport size for positioning calculations.
    Object.defineProperty(window, 'innerHeight', { value: 600, writable: true, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the dropdown panel as an overflow-y-auto scrollable list', async () => {
    const { input } = setup()
    fireEvent.focus(input)

    const panel = await waitFor(() => document.querySelector('.dropdown-panel'))
    expect(panel).toBeTruthy()
    expect(panel!.className).toContain('overflow-y-auto')
  })

  it('keeps the dropdown open when the panel is scrolled', async () => {
    const { input } = setup()
    fireEvent.focus(input)

    const panel = await waitFor(() => document.querySelector('.dropdown-panel'))
    expect(panel).toBeTruthy()

    fireEvent.scroll(panel!)

    await waitFor(() => {
      expect(document.querySelector('.dropdown-panel')).toBeTruthy()
    })
  })

  it('does not collapse the dropdown to an unusable max-height', async () => {
    const { input } = setup()
    fireEvent.focus(input)

    const panel = await waitFor(() => document.querySelector('.dropdown-panel'))
    expect(panel).toBeTruthy()

    const maxHeight = parseFloat(window.getComputedStyle(panel!).maxHeight)
    expect(maxHeight).toBeGreaterThanOrEqual(160)
  })

  it('closes the dropdown when scrolling the input out of view', async () => {
    const { input } = setup()
    fireEvent.focus(input)

    const panel = await waitFor(() => document.querySelector('.dropdown-panel'))
    expect(panel).toBeTruthy()

    // Simulate the input moving off-screen by mocking its bounding rect.
    const originalGetBoundingClientRect = input.getBoundingClientRect
    input.getBoundingClientRect = vi.fn(() => ({
      top: 650,
      bottom: 680,
      left: 0,
      right: 200,
      width: 200,
      height: 30,
      x: 0,
      y: 650,
      toJSON: () => {},
    }))

    fireEvent.scroll(window)

    await waitFor(() => {
      expect(document.querySelector('.dropdown-panel')).toBeFalsy()
    })

    input.getBoundingClientRect = originalGetBoundingClientRect
  })
})
