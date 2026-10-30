import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { TestCasePage } from './TestCasePage'
import * as testcaseApi from '../lib/testcase-api'
import type { TestCaseProject, TestCaseSet } from '../lib/testcase-api'

vi.mock('../lib/testcase-api', async () => {
  const actual = await vi.importActual<typeof testcaseApi>('../lib/testcase-api')
  return {
    ...actual,
    listTestCaseProjects: vi.fn(),
    listTestCaseSets: vi.fn(),
    getTestCaseSet: vi.fn(),
    updateTestCaseExecution: vi.fn(),
    createGenerateJob: vi.fn(),
    waitForGenerateJob: vi.fn(),
    parseReferenceFileApi: vi.fn(),
  }
})

vi.mock('../lib/active-ai-config', () => ({
  loadActiveAiConfigSelection: vi.fn(async () => ({
    storage: 'local',
    payload: { provider: 'codex', endpointType: 'openai_responses', baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model' },
    name: '测试模型',
    model: 'test-model',
    apiFormat: 'openai_responses',
  })),
}))

describe('TestCasePage - 执行看板与质量门禁 (software-testing-guide)', () => {
  const project: TestCaseProject = {
    id: 'proj-1',
    name: '电商平台',
    createdAt: '2026-09-10T00:00:00.000Z',
  }

  const testSet: TestCaseSet = {
    id: 'set-1',
    projectId: 'proj-1',
    name: '结算与支付模块',
    featureName: '结算与支付模块',
    testType: 'functional',
    language: 'zh',
    promptPreset: 'google_qa',
    context: '订单结算',
    status: 'completed',
    header: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
    rows: [
      ['TC-PAY-001', '支付', '正常支付', '微信全额支付', '高', '用户已登录且有待支付订单', '1. 选择微信支付\n2. 确认付款', '1. 唤起微信支付成功\n2. 订单状态更新为已支付'],
      ['TC-PAY-002', '支付', '余额校验', '余额不足支付', '高', '用户账户余额为0', '1. 选择余额支付\n2. 确认付款', '1. 提示余额不足\n2. 引导用户充值且订单状态不变'],
    ],
    executionStatus: {
      'TC-PAY-001': { status: 'passed', updatedAt: '2026-09-10T01:00:00.000Z' },
    },
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([testSet])
  })

  it('在用例详情窗口中支持切换到执行看板，并展示质量门禁', async () => {
    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))

    // 打开维护窗口后，可看到模式切换按钮
    expect(await screen.findByRole('button', { name: /执行看板/ })).toBeInTheDocument()

    // 切换到执行看板
    fireEvent.click(screen.getByRole('button', { name: /执行看板/ }))

    // 质量门禁仪表盘呈现
    expect(await screen.findByText('发版质量门禁 (Quality Gates)')).toBeInTheDocument()
    expect(screen.getByText('执行完成率')).toBeInTheDocument()
    expect(screen.getByText('用例通过率')).toBeInTheDocument()
    expect(screen.getByText('阻塞缺陷 (P0/高)')).toBeInTheDocument()

    // 状态统计：1条通过，1条未执行
    expect(screen.getByText('50%')).toBeInTheDocument() // 1/2 = 50% 执行率
    expect(screen.getByText('(1 / 2 条)')).toBeInTheDocument()
  })

  it('支持在执行看板中对未执行用例进行打标（通过、失败提单）', async () => {
    vi.mocked(testcaseApi.updateTestCaseExecution).mockResolvedValue({
      ...testSet,
      executionStatus: {
        'TC-PAY-001': { status: 'passed' },
        'TC-PAY-002': { status: 'passed' },
      },
    })

    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))

    fireEvent.click(await screen.findByRole('button', { name: /执行看板/ }))

    // 点击第二条用例的“通过”按钮
    const passButtons = screen.getAllByRole('button', { name: /通过/ })
    fireEvent.click(passButtons[passButtons.length - 1])

    await waitFor(() => {
      expect(testcaseApi.updateTestCaseExecution).toHaveBeenCalledWith(
        'set-1',
        expect.objectContaining({
          'TC-PAY-002': expect.objectContaining({ status: 'passed' }),
        }),
      )
    })
  })

  it('点击规范性体检能够弹出质量工程体检报告', async () => {
    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))

    const checkBtn = await screen.findByRole('button', { name: /规范性体检/ })
    fireEvent.click(checkBtn)

    expect(await screen.findByText('Google QA 质量工程体检')).toBeInTheDocument()
    expect(screen.getByText('模糊断言数')).toBeInTheDocument()
    expect(screen.getByText('前置条件缺失')).toBeInTheDocument()
    expect(screen.getByText('非标编号数')).toBeInTheDocument()
  })

  it('点击失败能够弹出标准缺陷单窗口并展示 Markdown 模板', async () => {
    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))

    fireEvent.click(await screen.findByRole('button', { name: /执行看板/ }))

    const failBtn = await screen.findAllByTitle('标记失败并提缺陷单')
    fireEvent.click(failBtn[0])

    expect(await screen.findByText('标记失败并生成标准缺陷单')).toBeInTheDocument()
    expect(screen.getByLabelText('缺陷编号 (Bug ID)')).toBeInTheDocument()
    expect(screen.getByText(/生成的标准缺陷单 Markdown/)).toBeInTheDocument()
  })

  it('从详情 URL 进入时，点击返回用例集列表一次即可返回列表', async () => {
    vi.mocked(testcaseApi.getTestCaseSet).mockResolvedValue(testSet)

    render(
      <MemoryRouter initialEntries={['/testcase/sets/set-1']}>
        <Routes>
          <Route path="/testcase" element={<TestCasePage />} />
          <Route path="/testcase/sets/:setId" element={<TestCasePage />} />
        </Routes>
      </MemoryRouter>,
    )

    // 直达详情页：模式切换器出现，说明详情已渲染
    expect(await screen.findByRole('button', { name: /执行看板/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回用例集列表' }))

    // 一次点击后应直接回到列表：详情 UI 消失且不再复活
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /执行看板/ })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('button', { name: /^结算与支付模块/ })).toBeInTheDocument()
  })

  it('用例维护头部提供优化用例入口，空指令不提交', async () => {
    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))

    fireEvent.click(await screen.findByRole('button', { name: '优化用例' }))
    expect(await screen.findByRole('heading', { name: '优化用例' })).toBeInTheDocument()

    // 空指令直接提交：行内报错且不发起生成任务
    fireEvent.click(screen.getByRole('button', { name: '开始优化' }))
    expect(await screen.findByText('请输入优化指令')).toBeInTheDocument()
    expect(testcaseApi.createGenerateJob).not.toHaveBeenCalled()
  })

  it('提交优化指令后以 optimize 模式发起任务，完成后展示变更统计', async () => {
    vi.mocked(testcaseApi.createGenerateJob).mockResolvedValue({ jobId: 'job-opt', status: 'queued', testSetId: 'set-1', mode: 'optimize' })
    vi.mocked(testcaseApi.waitForGenerateJob).mockResolvedValue({
      jobId: 'job-opt',
      status: 'completed',
      mode: 'optimize',
      testSetId: 'set-1',
      projectId: 'proj-1',
      generatedCount: 3,
      error: '',
      optimizeStats: { modified: 2, added: 1, removed: 1 },
      createdAt: '2026-09-23T00:00:00.000Z',
      resultHeader: testSet.header,
      resultRows: testSet.rows,
    })

    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))
    fireEvent.click(await screen.findByRole('button', { name: '优化用例' }))

    fireEvent.change(screen.getByLabelText('优化指令（界面实际操作逻辑）'), {
      target: { value: '支付页实际是余额+验证码组合支付' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始优化' }))

    await waitFor(() => expect(testcaseApi.createGenerateJob).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'optimize',
      testSetId: 'set-1',
      context: '支付页实际是余额+验证码组合支付',
      rows: testSet.rows,
      testType: 'functional',
      language: 'zh',
    })))

    // 完成后按 optimizeStats 展示变更统计
    expect(await screen.findByText('优化完成：修改 2 条 / 新增 1 条 / 删除 1 条')).toBeInTheDocument()
  })

  it('优化弹窗粘贴参考文件：解析文本以标记段并入优化指令提交', async () => {
    vi.mocked(testcaseApi.parseReferenceFileApi).mockResolvedValue({ text: '实际界面：登录页只有验证码登录', truncated: false })
    vi.mocked(testcaseApi.createGenerateJob).mockResolvedValue({ jobId: 'job-opt2', status: 'queued', testSetId: 'set-1', mode: 'optimize' })
    vi.mocked(testcaseApi.waitForGenerateJob).mockResolvedValue({
      jobId: 'job-opt2', status: 'completed', mode: 'optimize', testSetId: 'set-1', projectId: 'proj-1',
      generatedCount: 2, error: '', createdAt: '2026-09-24T00:00:00.000Z',
      resultHeader: testSet.header, resultRows: testSet.rows,
    })

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))
    fireEvent.click(await screen.findByRole('button', { name: '优化用例' }))

    // 粘贴文件 → 卡片出现在输入框上方 → 解析完成
    fireEvent.paste(screen.getByLabelText('优化指令（界面实际操作逻辑）'), {
      clipboardData: { files: [new File(['x'], '界面说明.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] },
    })
    expect(screen.getByRole('listitem')).toHaveTextContent('界面说明.docx')
    await waitFor(() => expect(screen.getByLabelText('解析完成')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('优化指令（界面实际操作逻辑）'), { target: { value: '按附件修正登录流程' } })
    fireEvent.click(screen.getByRole('button', { name: '开始优化' }))

    await waitFor(() => expect(testcaseApi.createGenerateJob).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'optimize',
      context: '按附件修正登录流程\n\n【参考文件：界面说明.docx】\n实际界面：登录页只有验证码登录',
    })))
  })

  it('参考文件解析中或失败时阻止提交', async () => {
    let rejectParse: (err: Error) => void = () => undefined
    vi.mocked(testcaseApi.parseReferenceFileApi).mockImplementation(
      () => new Promise((_resolve, reject) => { rejectParse = reject }),
    )
    vi.mocked(testcaseApi.createGenerateJob).mockResolvedValue({ jobId: 'job-x', status: 'queued', testSetId: 'set-1', mode: 'supplement' })

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
    fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))
    fireEvent.click(await screen.findByRole('button', { name: '补充需求' }))

    fireEvent.paste(screen.getByLabelText('本次补充说明'), {
      clipboardData: { files: [new File(['x'], '补充协议.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.change(screen.getByLabelText('本次补充说明'), { target: { value: '补充协议边界' } })

    // 解析中：阻止提交
    fireEvent.click(screen.getByRole('button', { name: '开始补充' }))
    expect(await screen.findByText(/参考文件解析中/)).toBeInTheDocument()
    expect(testcaseApi.createGenerateJob).not.toHaveBeenCalled()

    // 解析失败：阻止提交并给出原因
    rejectParse(new Error('解析服务未启动或不可达（ECONNREFUSED）'))
    await waitFor(() => expect(screen.getByLabelText('解析失败')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '开始补充' }))
    expect(await screen.findByText(/补充协议.pdf.*解析服务未启动/)).toBeInTheDocument()
    expect(testcaseApi.createGenerateJob).not.toHaveBeenCalled()
  })
})
