import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeTextFileWithRetry } from '../../server/src/features/testcase/store'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('writeTextFileWithRetry', () => {
  it('本地 JSON 存储遇到短暂 UNKNOWN 写入错误时会重试而不是崩溃', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'testcase-store-'))
    tempDirs.push(tempDir)
    const storePath = join(tempDir, 'server', 'data', 'testcase-store.json')
    let writeAttempts = 0

    writeTextFileWithRetry(storePath, JSON.stringify({ generationJobs: [{ id: 'job_retry' }] }), {
      retryDelayMs: 0,
      wait: () => undefined,
      writeFile: ((...args: Parameters<typeof writeFileSync>) => {
        writeAttempts += 1
        if (writeAttempts === 1) {
          const error = new Error('temporary file lock') as NodeJS.ErrnoException
          error.code = 'UNKNOWN'
          throw error
        }
        return writeFileSync(...args)
      }) as typeof writeFileSync,
    })

    expect(writeAttempts).toBeGreaterThan(1)
    expect(existsSync(storePath)).toBe(true)
    expect(JSON.parse(readFileSync(storePath, 'utf8')).generationJobs).toHaveLength(1)
  })
})
