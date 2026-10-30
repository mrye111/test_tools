import { describe, expect, it } from 'vitest'
import { readOptions, removeOption, writeOption } from './options-editor'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

describe('k6 options source synchronization', () => {
  it('updates a literal option without discarding neighboring comments or custom options', () => {
    const source = 'export const options = { /* keep */ vus: 2, custom: { a: true } };'
    const result = writeOption(source, 'vus', 4)
    expect(result).toContain('/* keep */ vus: 4')
    expect(readOptions(result).options).toEqual({ vus: 4, custom: { a: true } })
  })
  it('refuses to rewrite dynamic options or comments inside the updated value', () => {
    expect(() => writeOption('export const options = { vus: Number(__ENV.VUS) };', 'vus', 4)).toThrow()
    expect(() => writeOption('export const options = { thresholds: { /* keep */ x: ["rate<1"] } };', 'thresholds', {})).toThrow()
  })
  it('adds options to a script without existing options and retains the rest', () => {
    const source = 'export default function () {}'
    expect(readOptions(writeOption(source, 'duration', '10s')).options).toEqual({ duration: '10s' })
  })
  it('removes only the requested option and keeps other fields', () => {
    const source = 'export const options = { vus: 3, duration: "10s", thresholds: {checks: ["rate>0.9"]} };'
    expect(readOptions(removeOption(source, 'duration')).options).toEqual({ vus: 3, thresholds: {checks: ['rate>0.9']} })
    expect(() => removeOption('export const options = { vus: 2, /* keep */ duration: "10s" };', 'duration')).toThrow()
  })
})

const k6 = resolve('tools/k6/k6.exe')
describe.skipIf(!existsSync(k6))('k6 executor compatibility', () => {
  it('executes all six generated scenarios with the local k6 binary', () => {
    const scenarios = [
      { executor: 'shared-iterations', vus: 1, iterations: 1 },
      { executor: 'per-vu-iterations', vus: 1, iterations: 1 },
      { executor: 'constant-vus', vus: 1, duration: '1s' },
      { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '1s', target: 1 }] },
      { executor: 'constant-arrival-rate', rate: 1, timeUnit: '1s', duration: '1s', preAllocatedVUs: 1 },
      { executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s', stages: [{ duration: '1s', target: 1 }], preAllocatedVUs: 1 },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'nexus-k6-options-'))
    try {
      for (const scenario of scenarios) {
        const path = join(dir, 'script.js')
        writeFileSync(path, writeOption('import { sleep } from "k6"; export default function () { sleep(0.1) }', 'scenarios', { check: scenario }))
        const result = spawnSync(k6, ['run', '--quiet', path], { encoding: 'utf8', timeout: 15000, env: {...process.env, K6_NO_USAGE_REPORT: 'true'} })
        expect(result.status, `${scenario.executor}: ${result.stderr}`).toBe(0)
      }
    } finally { rmSync(dir, {recursive:true, force:true}) }
  }, 90000)
})
