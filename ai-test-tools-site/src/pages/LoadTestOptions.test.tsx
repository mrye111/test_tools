import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { LoadTestOptions } from './LoadTestOptions'
import { readOptions } from '../features/loadtest/options-editor'

function Editor({initial}: {initial: string}) {
  const [source, setSource] = useState(initial)
  return <><LoadTestOptions source={source} onChange={setSource}/><output data-testid="source">{source}</output></>
}
describe('参数面板', () => {
  it('adds executor and threshold template to the saved script while retaining unknown fields', () => {
    render(<Editor initial={'export const options = {custom: true}; export default function() {}'} />)
    fireEvent.change(screen.getByLabelText('执行器'), {target: {value: 'constant-arrival-rate'}})
    fireEvent.click(screen.getByRole('button', {name: '添加场景'}))
    fireEvent.click(screen.getByRole('button', {name: 'P95 < 800 ms'}))
    const options = readOptions(screen.getByTestId('source').textContent ?? '').options
    expect(options).toEqual({custom: true, scenarios: {scenario1: {executor:'constant-arrival-rate'}}, thresholds: {http_req_duration:['p(95)<800']}})
  })
  it('retains dynamic source and displays an actionable warning', () => {
    const source = 'export const options = { vus: Number(__ENV.VUS) };'
    render(<Editor initial={source}/>)
    expect(screen.getByText(/无法安全同步/)).toBeInTheDocument()
    expect(screen.getByTestId('source')).toHaveTextContent(source)
    expect(screen.queryByRole('button', {name: '添加场景'})).not.toBeInTheDocument()
  })
  it('saves CLI metadata at the first line', () => {
    render(<Editor initial={'export default function() {}'} />)
    fireEvent.change(screen.getByLabelText('k6 命令行参数'), {target: {value:'["--quiet"]'}})
    fireEvent.click(screen.getByRole('button', {name:'保存命令行参数'}))
    expect(screen.getByTestId('source').textContent).toMatch(/^\/\/ nexuskit-k6-args: \["--quiet"\]/)
  })
})
