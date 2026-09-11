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
  }
})

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
})
