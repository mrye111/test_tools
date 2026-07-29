import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as testcaseApi from '../lib/testcase-api'
import { TestCasePage } from './TestCasePage'

vi.mock('../lib/testcase-api', () => ({
  createGenerateJob: vi.fn(),
  createTestCaseProject: vi.fn(),
  deleteTestCase: vi.fn(),
  deleteTestCaseProject: vi.fn(),
  deleteTestCaseSet: vi.fn(),
  exportTestCaseExcel: vi.fn(),
  exportTestCaseExcelAll: vi.fn(),
  exportTestCaseXmind: vi.fn(),
  exportTestCaseXmindAll: vi.fn(),
  listTestCaseProjects: vi.fn(),
  listTestCaseSets: vi.fn(),
  loadStoredModelConfig: vi.fn(),
  updateTestCaseProject: vi.fn(),
  upsertTestCase: vi.fn(),
  waitForGenerateJob: vi.fn(),
}))

const project = {
  id: 'project-order',
  name: '订单中心',
  createdAt: '2026-07-10T01:00:00.000Z',
  testSetCount: 3,
  testCaseCount: 21,
}

const completedSet = {
  id: 'set-login',
  projectId: project.id,
  name: '登录与会话管理',
  featureName: '登录与会话管理',
  testType: 'functional' as const,
  language: 'zh' as const,
  context: '登录需求',
  status: 'completed' as const,
  header: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
  rows: [['TC001', '登录', '正常登录', '正确账号登录成功', '高', '用户已注册', '输入账号密码', '进入首页']],
  createdAt: '2026-07-10T01:00:00.000Z',
  updatedAt: '2026-07-10T01:01:00.000Z',
}

describe('TestCasePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([])
    vi.mocked(testcaseApi.loadStoredModelConfig).mockReturnValue({
      id: 'model-1',
      name: '测试模型',
      providerType: 'openrouter',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      apiFormat: 'openai_responses',
    })
    vi.mocked(testcaseApi.waitForGenerateJob).mockImplementation(async () => new Promise(() => undefined))
  })

  it('没有项目时在页面中央显示添加项目入口', async () => {
    render(<TestCasePage />, { wrapper: BrowserRouter })

    expect(await screen.findByText('还没有测试用例项目')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加项目' })).toBeInTheDocument()
    expect(screen.queryByText('任务列表')).not.toBeInTheDocument()
  })

  it('创建项目后直接进入该项目的用例集页面', async () => {
    vi.mocked(testcaseApi.createTestCaseProject).mockResolvedValue(project)
    vi.mocked(testcaseApi.listTestCaseProjects)
      .mockResolvedValueOnce([])
      .mockResolvedValue([project])

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '添加项目' }))
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '订单中心' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '添加项目' }))

    await waitFor(() => expect(testcaseApi.createTestCaseProject).toHaveBeenCalledWith('订单中心'))
    expect(await screen.findByRole('heading', { name: '订单中心' })).toBeInTheDocument()
    expect(await screen.findByText('这个项目还没有用例集')).toBeInTheDocument()
    // 弹窗退出动画（200ms）结束后才真正卸载
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('以大卡片展示项目和当前测试用例条数', async () => {
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    render(<TestCasePage />, { wrapper: BrowserRouter })

    const card = await screen.findByRole('button', { name: '订单中心' })
    expect(within(card).getByText('3 个用例集')).toBeInTheDocument()
    expect(within(card).getByText('21 条用例')).toBeInTheDocument()
  })

  it('项目卡片支持重命名，提交后调用更新接口', async () => {
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.updateTestCaseProject).mockResolvedValue(undefined)

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '重命名项目 订单中心' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '编辑项目' })).toBeInTheDocument()
    const input = within(dialog).getByLabelText('项目名称')
    expect(input).toHaveValue('订单中心')
    fireEvent.change(input, { target: { value: '订单中心二期' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(testcaseApi.updateTestCaseProject).toHaveBeenCalledWith(project.id, '订单中心二期'))
    expect(testcaseApi.createTestCaseProject).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('删除项目前展示级联数量，确认后调用删除接口', async () => {
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.deleteTestCaseProject).mockResolvedValue(undefined)

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '删除项目 订单中心' }))

    expect(await screen.findByText('删除这个项目？')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('21')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(testcaseApi.deleteTestCaseProject).toHaveBeenCalledWith(project.id))
    await waitFor(() => expect(screen.queryByText('删除这个项目？')).not.toBeInTheDocument())
  })

  it('用例集列表展示生成状态，完成项可打开维护窗口', async () => {
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([
      completedSet,
      { ...completedSet, id: 'set-thinking', name: '支付流程', status: 'running', rows: [] },
      { ...completedSet, id: 'set-running', name: '发货流程', status: 'running' },
      { ...completedSet, id: 'set-failed', name: '退款流程', status: 'failed', rows: [], error: '模型请求超时' },
    ])

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '订单中心' }))

    expect(await screen.findByText('生成完成')).toBeInTheDocument()
    expect(screen.getByText('AI 分析中')).toBeInTheDocument()
    expect(screen.getByText('生成中')).toBeInTheDocument()
    expect(screen.getByText('生成失败')).toBeInTheDocument()
    expect(screen.getByText('模型请求超时')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^登录与会话管理/ }))
    expect(await screen.findByText('测试用例维护')).toBeInTheDocument()
    expect(screen.getByText('正确账号登录成功')).toBeInTheDocument()
    expect(screen.getByText(/共 1 条用例/)).toBeInTheDocument()
  })

  it('维护窗口支持补充需求、新增用例和删除已有用例', { timeout: 10000 }, async () => {
    const addedSet = {
      ...completedSet,
      rows: [
        ...completedSet.rows,
        ['TC002', '通讯录', '成员搜索', '按姓名搜索成员', '中', '已登录', '1. 输入姓名', '1. 展示成员'],
      ],
    }
    const deletedSet = { ...completedSet, rows: [] }
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([completedSet])
    vi.mocked(testcaseApi.createGenerateJob).mockResolvedValue({ jobId: 'job-supplement', status: 'queued', testSetId: completedSet.id, mode: 'supplement' })
    vi.mocked(testcaseApi.upsertTestCase).mockResolvedValue(addedSet)
    vi.mocked(testcaseApi.deleteTestCase).mockResolvedValue(deletedSet)

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '订单中心' }))
    fireEvent.click(await screen.findByRole('button', { name: /^登录与会话管理/ }))

    fireEvent.click(await screen.findByRole('button', { name: '补充需求' }))
    fireEvent.change(screen.getByLabelText('本次补充说明'), { target: { value: '补充异常登录场景' } })
    fireEvent.click(screen.getByRole('button', { name: '开始补充' }))
    await waitFor(() => expect(testcaseApi.createGenerateJob).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'supplement',
      testSetId: completedSet.id,
      rows: completedSet.rows,
      context: '补充异常登录场景',
    })))

    fireEvent.click(screen.getByRole('button', { name: '新增用例' }))
    fireEvent.change(screen.getByLabelText('功能模块'), { target: { value: '通讯录' } })
    fireEvent.change(screen.getByLabelText('功能测试点'), { target: { value: '成员搜索' } })
    fireEvent.change(screen.getByLabelText('用例标题'), { target: { value: '按姓名搜索成员' } })
    fireEvent.change(screen.getByLabelText('测试步骤'), { target: { value: '1. 输入姓名' } })
    fireEvent.change(screen.getByLabelText('预期结果'), { target: { value: '1. 展示成员' } })
    fireEvent.click(screen.getByRole('button', { name: '保存用例' }))
    await waitFor(() => expect(testcaseApi.upsertTestCase).toHaveBeenCalledWith(expect.objectContaining({
      testSetId: completedSet.id,
      row: expect.arrayContaining(['通讯录', '成员搜索', '按姓名搜索成员']),
    })))

    fireEvent.click(screen.getByRole('button', { name: '删除用例 TC001' }))
    expect(await screen.findByText('删除这条用例？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(testcaseApi.deleteTestCase).toHaveBeenCalledWith(completedSet.id, 'TC001'))
  }, { timeout: 10000 })

  it('补充需求生成内容全部重复时提示已过滤数量', async () => {
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([completedSet])
    vi.mocked(testcaseApi.createGenerateJob).mockResolvedValue({ jobId: 'job-supplement-dup', status: 'queued', testSetId: completedSet.id, mode: 'supplement' })
    vi.mocked(testcaseApi.waitForGenerateJob).mockResolvedValue({
      jobId: 'job-supplement-dup',
      status: 'completed',
      mode: 'supplement',
      testSetId: completedSet.id,
      projectId: project.id,
      generatedCount: 1,
      generatedCountRaw: 3,
      addedCount: 0,
      duplicatesFiltered: 3,
      error: '',
      createdAt: '2026-07-10T01:00:00.000Z',
      resultHeader: completedSet.header,
      resultRows: completedSet.rows,
    })

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '订单中心' }))
    fireEvent.click(await screen.findByRole('button', { name: /^登录与会话管理/ }))
    fireEvent.click(await screen.findByRole('button', { name: '补充需求' }))
    fireEvent.change(screen.getByLabelText('本次补充说明'), { target: { value: '补充异常登录场景' } })
    fireEvent.click(screen.getByRole('button', { name: '开始补充' }))

    expect(await screen.findByText('生成的 3 条用例与已有用例重复，已自动过滤')).toBeInTheDocument()
  })

  it('API 测试模式下可粘贴 Swagger 文档生成，上下文包含标记且需求描述可留空', async () => {
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([])
    vi.mocked(testcaseApi.createGenerateJob).mockResolvedValue({ jobId: 'job-api', status: 'queued', testSetId: 'set-api', mode: 'create' })

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '订单中心' }))
    fireEvent.click(await screen.findByRole('button', { name: '添加用例集' }))

    // 功能测试模式不显示 Swagger 输入区
    expect(screen.queryByLabelText('Swagger/OpenAPI 文档')).not.toBeInTheDocument()

    // 切换测试类型为 API 测试
    fireEvent.click(screen.getByRole('button', { name: '功能测试' }))
    fireEvent.click(await screen.findByRole('option', { name: 'API 测试' }))

    const swaggerInput = await screen.findByLabelText('Swagger/OpenAPI 文档')
    fireEvent.change(swaggerInput, { target: { value: '{"openapi":"3.0.0","paths":{"/login":{"post":{}}}}' } })
    fireEvent.change(screen.getByLabelText('用例集名称'), { target: { value: '登录接口' } })
    fireEvent.click(screen.getByRole('button', { name: '开始 AI 生成' }))

    await waitFor(() => expect(testcaseApi.createGenerateJob).toHaveBeenCalledWith(expect.objectContaining({
      testSetName: '登录接口',
      testType: 'api',
    })))
    const request = vi.mocked(testcaseApi.createGenerateJob).mock.calls[0][0]
    expect(request.context).toContain('【Swagger/OpenAPI 文档】')
    expect(request.context).toContain('"openapi":"3.0.0"')
  })

  it('Swagger 超过 8 万字符且不是 JSON 时阻止提交并提示', async () => {
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([])

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '订单中心' }))
    fireEvent.click(await screen.findByRole('button', { name: '添加用例集' }))
    fireEvent.click(screen.getByRole('button', { name: '功能测试' }))
    fireEvent.click(await screen.findByRole('option', { name: 'API 测试' }))

    fireEvent.change(screen.getByLabelText('用例集名称'), { target: { value: '登录接口' } })
    fireEvent.change(await screen.findByLabelText('Swagger/OpenAPI 文档'), { target: { value: `paths:\n${'  /a: get\n'.repeat(8_000)}` } })
    fireEvent.click(screen.getByRole('button', { name: '开始 AI 生成' }))

    expect(await screen.findByText(/无法自动拆分/)).toBeInTheDocument()
    expect(testcaseApi.createGenerateJob).not.toHaveBeenCalled()
  })

  it('开始 AI 生成后关闭窗口并在列表中显示新用例集状态', async () => {    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...completedSet, id: 'set-new', name: '创建订单', status: 'queued', rows: [] }])
    vi.mocked(testcaseApi.createGenerateJob).mockResolvedValue({ jobId: 'job-new', status: 'queued', testSetId: 'set-new', mode: 'create' })

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '订单中心' }))
    fireEvent.click(await screen.findByRole('button', { name: '添加用例集' }))

    fireEvent.change(screen.getByLabelText('用例集名称'), { target: { value: '创建订单' } })
    fireEvent.change(screen.getByLabelText('需求描述'), { target: { value: '用户提交有效商品后创建订单' } })
    expect(screen.queryByLabelText('覆盖模式')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('最大条数上限')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始 AI 生成' }))

    await waitFor(() => expect(testcaseApi.createGenerateJob).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
      testSetName: '创建订单',
      featureName: '创建订单',
    })))
    const request = vi.mocked(testcaseApi.createGenerateJob).mock.calls[0][0]
    expect(request).not.toHaveProperty('coverageMode')
    expect(request).not.toHaveProperty('maxCases')
    expect(await screen.findByText('等待生成')).toBeInTheDocument()
    // 弹窗退出动画（200ms）结束后才真正卸载
    await waitFor(() => expect(screen.queryByText('添加测试用例集')).not.toBeInTheDocument())
  })

  it('未选择时批量导出当前项目全部已完成用例集，选择后仅导出所选', async () => {
    const secondSet = { ...completedSet, id: 'set-pay', name: '支付流程' }
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([completedSet, secondSet])

    render(<TestCasePage />, { wrapper: BrowserRouter })
    fireEvent.click(await screen.findByRole('button', { name: '订单中心' }))
    await screen.findByText('登录与会话管理')

    const excelButtons = screen.getAllByRole('button', { name: 'Excel' })
    fireEvent.click(excelButtons[0])
    await waitFor(() => expect(testcaseApi.exportTestCaseExcelAll).toHaveBeenCalledWith(expect.objectContaining({
      projectName: '订单中心',
      testSets: expect.arrayContaining([
        expect.objectContaining({ featureName: '登录与会话管理' }),
        expect.objectContaining({ featureName: '支付流程' }),
      ]),
    })))

    fireEvent.click(screen.getByLabelText('选择用例集 登录与会话管理'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Excel' })[0])
    await waitFor(() => {
      const lastCall = vi.mocked(testcaseApi.exportTestCaseExcelAll).mock.calls.at(-1)?.[0]
      expect(lastCall?.testSets).toHaveLength(1)
      expect(lastCall?.testSets[0].featureName).toBe('登录与会话管理')
    })
  })
})
