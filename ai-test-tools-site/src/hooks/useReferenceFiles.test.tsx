import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ReferenceFileStrip } from '../components/ReferenceFileStrip'
import { useReferenceFiles } from './useReferenceFiles'
import * as testcaseApi from '../lib/testcase-api'
import type { ReferenceFileEntry } from '../lib/reference-file'

vi.mock('../lib/testcase-api', () => ({
  parseReferenceFileApi: vi.fn(),
}))

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useReferenceFiles>) => void }) {
  const api = useReferenceFiles()
  onReady(api)
  return (
    <div>
      <textarea aria-label="指令输入" onPaste={api.handlePaste} />
      <ReferenceFileStrip files={api.files} onRemove={api.removeFile} />
    </div>
  )
}

function pasteFile(target: HTMLElement, file: File) {
  fireEvent.paste(target, { clipboardData: { files: [file] } })
}

describe('useReferenceFiles + ReferenceFileStrip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('粘贴文件即解析：卡片经历 解析中→完成，解析文本可提取', async () => {
    let apiRef: ReturnType<typeof useReferenceFiles> | null = null
    vi.mocked(testcaseApi.parseReferenceFileApi).mockResolvedValue({ text: '# 需求正文', truncated: false })

    render(<Harness onReady={(api) => { apiRef = api }} />)
    pasteFile(screen.getByLabelText('指令输入'), new File(['x'], '需求.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))

    expect(screen.getByRole('listitem')).toHaveTextContent('需求.docx')
    await waitFor(() => expect(screen.getByLabelText('解析完成')).toBeInTheDocument())
    expect(apiRef!.parsedReferences()).toEqual([{ name: '需求.docx', text: '# 需求正文' }])
  })

  it('不支持的格式与超大文件就地标红失败，不发解析请求', () => {
    vi.mocked(testcaseApi.parseReferenceFileApi).mockResolvedValue({ text: '', truncated: false })
    render(<Harness onReady={() => undefined} />)

    pasteFile(screen.getByLabelText('指令输入'), new File(['x'], '病毒.exe', { type: 'application/octet-stream' }))
    pasteFile(screen.getByLabelText('指令输入'), new File([new ArrayBuffer(21 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' }))

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('不支持的文件格式')
    expect(items[1]).toHaveTextContent('超过 20MB 大小限制')
    expect(testcaseApi.parseReferenceFileApi).not.toHaveBeenCalled()
  })

  it('解析中/解析失败阻止提交，移除后放行', async () => {
    let apiRef: ReturnType<typeof useReferenceFiles> | null = null
    vi.mocked(testcaseApi.parseReferenceFileApi).mockRejectedValue(new Error('解析服务未启动或不可达（ECONNREFUSED）'))

    render(<Harness onReady={(api) => { apiRef = api }} />)
    const input = screen.getByLabelText('指令输入')
    pasteFile(input, new File(['x'], '需求.pdf', { type: 'application/pdf' }))

    // 解析中：阻止提交
    expect(apiRef!.submitBlocker()).toMatch(/解析中/)

    await waitFor(() => expect(screen.getByLabelText('解析失败')).toBeInTheDocument())
    expect(apiRef!.submitBlocker()).toMatch(/需求.pdf.*解析服务未启动/)

    fireEvent.click(screen.getByRole('button', { name: '移除 需求.pdf' }))
    await waitFor(() => expect(screen.queryByRole('listitem')).not.toBeInTheDocument())
    expect(apiRef!.submitBlocker()).toBeNull()
    expect(apiRef!.parsedReferences()).toEqual([])
  })

  it('卡片为紧凑类型徽标 + 文件名形态，带移除按钮', () => {
    render(<ReferenceFileStrip
      files={[{ id: 'f1', name: '计费规则说明.pdf', text: 'ok', status: 'done' } as ReferenceFileEntry]}
      onRemove={() => undefined}
    />)

    const chip = within(screen.getByRole('listitem'))
    expect(chip.getByText('PDF')).toBeInTheDocument() // 类型徽标
    expect(chip.getByText('计费规则说明.pdf')).toBeInTheDocument()
    expect(chip.getByRole('button', { name: '移除 计费规则说明.pdf' })).toBeInTheDocument()
    expect(screen.getByLabelText('解析完成')).toBeInTheDocument()
  })

  it('超过 5 个文件后的新粘贴被丢弃', () => {
    let apiRef: ReturnType<typeof useReferenceFiles> | null = null
    vi.mocked(testcaseApi.parseReferenceFileApi).mockResolvedValue({ text: 't', truncated: false })
    render(<Harness onReady={(api) => { apiRef = api }} />)
    const input = screen.getByLabelText('指令输入')

    pasteFile(input, new File(['x'], 'a.md', { type: 'text/markdown' }))
    pasteFile(input, new File(['x'], 'b.md', { type: 'text/markdown' }))
    pasteFile(input, new File(['x'], 'c.md', { type: 'text/markdown' }))
    pasteFile(input, new File(['x'], 'd.md', { type: 'text/markdown' }))
    pasteFile(input, new File(['x'], 'e.md', { type: 'text/markdown' }))
    pasteFile(input, new File(['x'], 'f.md', { type: 'text/markdown' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByText('f.md')).not.toBeInTheDocument()
  })
})
