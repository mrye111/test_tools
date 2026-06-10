import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGenerateJob,
  getTestCaseExportFormats,
  loadStoredModelConfig,
  waitForGenerateJob,
} from '../lib/testcase-api'
import { TestCasePage } from './TestCasePage'

vi.mock('../lib/testcase-api', () => ({
  createGenerateJob: vi.fn(),
  exportTestCaseExcel: vi.fn(),
  exportTestCaseXmind: vi.fn(),
  getTestCaseExportFormats: vi.fn(),
  loadStoredModelConfig: vi.fn(),
  toTestCaseAiConfig: vi.fn((config) => ({
    base_url: config.baseUrl,
    api_key: config.apiKey,
    model: config.modelId,
  })),
  waitForGenerateJob: vi.fn(),
}))

const modelConfig = {
  name: '测试模型',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  modelId: 'test-model',
  temperature: 0.2,
}

describe('TestCasePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.mocked(loadStoredModelConfig).mockReturnValue(modelConfig)
    vi.mocked(getTestCaseExportFormats).mockResolvedValue([
      {
        key: 'default',
        name: '默认测试用例格式',
        description: '默认格式',
      },
    ])
  })

  it('离开用例生成页面后再次进入，会从本地恢复已创建的任务', async () => {
    vi.mocked(createGenerateJob).mockResolvedValue({
      jobId: 'job_persisted',
      status: 'queued',
      testSetId: 'tool-result-job_persisted',
      mode: 'create',
    })
    vi.mocked(waitForGenerateJob).mockImplementation(async () => new Promise(() => undefined))

    const firstRender = render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(screen.getByRole('button', { name: /新建用例/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(screen.getByText('任务列表')).toBeInTheDocument()
    })
    expect(screen.getByText(/AI 正在生成用例/)).toBeInTheDocument()

    firstRender.unmount()
    render(<TestCasePage />, { wrapper: BrowserRouter })

    expect(screen.getByText('任务列表')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录功能/ })).toBeInTheDocument()
    expect(screen.queryByText('还没有生成用例')).not.toBeInTheDocument()
  })

  it('创建生成任务后立即显示任务列表，点击任务可查看实时用例结果', async () => {
    vi.mocked(createGenerateJob).mockResolvedValue({
      jobId: 'job_1',
      status: 'queued',
      testSetId: 'tool-result-job_1',
      mode: 'create',
    })
    vi.mocked(waitForGenerateJob).mockImplementation(async (_jobId, onTick) => {
      onTick?.({
        jobId: 'job_1',
        status: 'running',
        mode: 'create',
        testSetId: 'tool-result-job_1',
        projectId: '',
        generatedCount: 0,
        error: '',
        featureName: '登录功能',
        context: '用户名必填，密码必填，登录成功后跳转首页，失败时展示错误提示。',
        streamText: '好的，我来生成。\n用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果\nTC001,登录,用户名密码验证,正常登录,高,用户已注册,输入正确用户名和密码,跳转首页\n',
        createdAt: '2026-06-09T00:00:00.000Z',
        resultHeader: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
        resultRows: [['TC001', '登录', '用户名密码验证', '正常登录', '高', '用户已注册', '输入正确用户名和密码', '跳转首页']],
      })
      return new Promise(() => undefined)
    })

    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(screen.getByRole('button', { name: /新建用例/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(createGenerateJob).toHaveBeenCalledTimes(1)
    })
    expect(createGenerateJob).toHaveBeenCalledWith(expect.objectContaining({
      coverageMode: 'standard',
      maxCases: 20,
    }))
    await waitFor(() => {
      expect(screen.queryByText('新建用例生成')).not.toBeInTheDocument()
    })

    expect(screen.getByText('任务列表')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /登录功能/ }))
    expect(screen.getByText(/登录功能 正在生成，已解析 1 条用例/)).toBeInTheDocument()
    expect(screen.queryByText('流式输出预览')).not.toBeInTheDocument()
    expect(screen.queryByText('好的，我来生成。')).not.toBeInTheDocument()
    expect(screen.getAllByText('TC001').length).toBeGreaterThan(0)
    expect(screen.getByText('跳转首页')).toBeInTheDocument()
  })

  it('快速失败的生成任务仍保留在列表中显示失败状态', async () => {
    vi.mocked(createGenerateJob).mockResolvedValue({
      jobId: 'job_failed',
      status: 'queued',
      testSetId: 'tool-result-job_failed',
      mode: 'create',
    })
    vi.mocked(waitForGenerateJob).mockResolvedValue({
      jobId: 'job_failed',
      status: 'failed',
      mode: 'create',
      testSetId: 'tool-result-job_failed',
      projectId: '',
      generatedCount: 0,
      error: 'fetch failed',
      featureName: '登录功能',
      context: '用户名必填，密码必填，登录成功后跳转首页，失败时展示错误提示。',
      streamText: '',
      createdAt: '2026-06-09T00:00:00.000Z',
      startedAt: '2026-06-09T00:00:00.000Z',
      finishedAt: '2026-06-09T00:00:00.010Z',
      resultHeader: [],
      resultRows: [],
    })

    render(<TestCasePage />, { wrapper: BrowserRouter })

    fireEvent.click(screen.getByRole('button', { name: /新建用例/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(screen.getByText('任务列表')).toBeInTheDocument()
    })

    expect(screen.getByText(/任务状态：失败/)).toBeInTheDocument()
    expect(screen.getAllByText('fetch failed').length).toBeGreaterThan(0)
    expect(screen.queryByText('还没有生成用例')).not.toBeInTheDocument()
  })

  it('已生成的用例支持从当前任务中删除', () => {
    window.localStorage.setItem('ai_test_tools_testcase_jobs', JSON.stringify([
      {
        jobId: 'job_done',
        status: 'completed',
        mode: 'create',
        testSetId: 'tool-result-job_done',
        projectId: '',
        featureName: '登录功能',
        context: '登录需求',
        generatedCount: 2,
        error: '',
        createdAt: '2026-06-09T00:00:00.000Z',
        resultHeader: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
        resultRows: [
          ['TC001', '登录', '正向登录', '正常登录成功', '高', '已注册', '1. 输入用户名\\n2. 输入密码', '进入首页'],
          ['TC002', '登录', '异常登录', '密码错误提示', '中', '已注册', '1. 输入用户名\\n2. 输入错误密码', '提示密码错误'],
        ],
      },
    ]))

    render(<TestCasePage />, { wrapper: BrowserRouter })

    expect(screen.getByText('正常登录成功')).toBeInTheDocument()
    expect(screen.getByText('密码错误提示')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /删除用例 TC001/ }))

    expect(screen.queryByText('正常登录成功')).not.toBeInTheDocument()
    expect(screen.getByText('密码错误提示')).toBeInTheDocument()
    expect(screen.getByText(/共 1 条，任务状态：已完成/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录功能[\s\S]*1 条用例/ })).toBeInTheDocument()
  })

  it('本地缓存中的坏表头会自动恢复为标准表头', () => {
    window.localStorage.setItem('ai_test_tools_testcase_jobs', JSON.stringify([
      {
        jobId: 'job_bad_header',
        status: 'completed',
        mode: 'create',
        testSetId: 'tool-result-job_bad_header',
        projectId: '',
        featureName: '登录功能',
        context: '登录需求',
        generatedCount: 1,
        error: '',
        createdAt: '2026-06-09T00:00:00.000Z',
        resultHeader: ['这样设计下来，应该能很好地覆盖正向、反向、边界、安全性等各个场景，符合标准覆盖的要求。', '用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤,预期结果'],
        resultRows: [
          ['TC001', '登录', '正向登录', '正常登录成功', '高', '已注册', '1. 输入用户名\\n2. 输入密码', '进入首页'],
        ],
      },
    ]))

    render(<TestCasePage />, { wrapper: BrowserRouter })

    expect(screen.queryByText(/这样设计下来/)).not.toBeInTheDocument()
    expect(screen.getByText('用例编号')).toBeInTheDocument()
    expect(screen.getByText('预期结果')).toBeInTheDocument()
  })

  it('任务列表中的生成任务支持删除并同步本地缓存', async () => {
    window.localStorage.setItem('ai_test_tools_testcase_jobs', JSON.stringify([
      {
        jobId: 'job_login',
        status: 'completed',
        mode: 'create',
        testSetId: 'tool-result-job_login',
        projectId: '',
        featureName: '登录功能',
        context: '登录需求',
        generatedCount: 1,
        error: '',
        createdAt: '2026-06-09T00:00:00.000Z',
        resultHeader: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
        resultRows: [
          ['TC001', '登录', '正向登录', '正常登录成功', '高', '已注册', '1. 输入用户名', '进入首页'],
        ],
      },
      {
        jobId: 'job_pay',
        status: 'completed',
        mode: 'create',
        testSetId: 'tool-result-job_pay',
        projectId: '',
        featureName: '支付功能',
        context: '支付需求',
        generatedCount: 1,
        error: '',
        createdAt: '2026-06-09T00:10:00.000Z',
        resultHeader: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
        resultRows: [
          ['TC001', '支付', '正向支付', '支付成功', '高', '订单已创建', '1. 选择支付方式', '支付完成'],
        ],
      },
    ]))

    render(<TestCasePage />, { wrapper: BrowserRouter })

    expect(screen.getByRole('button', { name: /登录功能/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /支付功能/ })).toBeInTheDocument()
    expect(screen.getByText('正常登录成功')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /删除任务 1/ }))

    expect(screen.queryByRole('button', { name: /登录功能/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /支付功能/ })).toBeInTheDocument()
    expect(screen.queryByText('正常登录成功')).not.toBeInTheDocument()
    expect(screen.getByText('支付成功')).toBeInTheDocument()
    expect(screen.getByText('共 1 个生成任务')).toBeInTheDocument()

    await waitFor(() => {
      const storedJobs = JSON.parse(window.localStorage.getItem('ai_test_tools_testcase_jobs') ?? '[]')
      expect(storedJobs.map((item: { jobId: string }) => item.jobId)).toEqual(['job_pay'])
    })
  })

  it('用例结果默认分页显示 10 条并支持切换到下一页', () => {
    const rows = Array.from({ length: 12 }, (_, index) => {
      const caseNumber = String(index + 1).padStart(3, '0')
      return [`TC${caseNumber}`, '登录', '分页测试', `分页用例 ${caseNumber}`, '中', '已打开页面', '1. 执行操作\\n2. 检查结果', '展示正确结果']
    })
    window.localStorage.setItem('ai_test_tools_testcase_jobs', JSON.stringify([
      {
        jobId: 'job_paged',
        status: 'completed',
        mode: 'create',
        testSetId: 'tool-result-job_paged',
        projectId: '',
        featureName: '登录功能',
        context: '登录需求',
        generatedCount: rows.length,
        error: '',
        createdAt: '2026-06-09T00:00:00.000Z',
        resultHeader: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
        resultRows: rows,
      },
    ]))

    render(<TestCasePage />, { wrapper: BrowserRouter })

    expect(screen.getByText('分页用例 001')).toBeInTheDocument()
    expect(screen.getByText('分页用例 010')).toBeInTheDocument()
    expect(screen.queryByText('分页用例 011')).not.toBeInTheDocument()
    expect(screen.getByText('显示第 1-10 条，共 12 条')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.queryByText('分页用例 001')).not.toBeInTheDocument()
    expect(screen.getByText('分页用例 011')).toBeInTheDocument()
    expect(screen.getByText('分页用例 012')).toBeInTheDocument()
    expect(screen.getByText('显示第 11-12 条，共 12 条')).toBeInTheDocument()
  })
})
