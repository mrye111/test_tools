import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadTestPage } from './LoadTestPage'
import * as loadtestApi from '../features/loadtest/loadtest-api'

vi.mock('../features/loadtest/loadtest-api', () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  importProject: vi.fn(),
}))

const mockList = vi.mocked(loadtestApi.listProjects)
const mockCreate = vi.mocked(loadtestApi.createProject)
const mockDelete = vi.mocked(loadtestApi.deleteProject)
const mockImport = vi.mocked(loadtestApi.importProject)

const SAMPLE = {
  id: 'ltp_1',
  name: '问卷系统',
  description: '线上',
  targetBaseUrl: 'https://example.com/api',
  createdAt: '2026-10-15T01:00:00Z',
  updatedAt: '2026-10-15T02:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/loadtest']}>
      <Routes>
        <Route path="/loadtest" element={<LoadTestPage />} />
        <Route path="/loadtest/projects/:id" element={<div data-testid="workspace" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoadTestPage（压测项目列表）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('空列表展示空态引导', async () => {
    mockList.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/还没有压测项目/)).toBeInTheDocument()
  })

  it('列表渲染项目名称与目标地址', async () => {
    mockList.mockResolvedValue([SAMPLE])
    renderPage()
    expect(await screen.findByText('问卷系统')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/api')).toBeInTheDocument()
  })

  it('新建时名称与目标地址必填校验', async () => {
    mockList.mockResolvedValue([])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByText('名称与目标地址必填')).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('新建成功后跳转工作区', async () => {
    mockList.mockResolvedValue([])
    mockCreate.mockResolvedValue({ ...SAMPLE, scriptSource: '', payloadTemplate: null, envVars: {} } as never)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }))
    fireEvent.change(screen.getByPlaceholderText('如：问卷系统'), { target: { value: '演示项目' } })
    fireEvent.change(screen.getByPlaceholderText('https://example.com/api'), { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '演示项目' })))
    expect(await screen.findByTestId('workspace')).toBeInTheDocument()
  })

  it('删除需经确认弹窗，确认后刷新列表', async () => {
    mockList.mockResolvedValue([SAMPLE])
    mockDelete.mockResolvedValue(undefined)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除 问卷系统' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('ltp_1'))
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('目录导入调用 importProject 并跳转', async () => {
    mockList.mockResolvedValue([])
    mockImport.mockResolvedValue({ ...SAMPLE, scriptSource: '', payloadTemplate: null, envVars: {} } as never)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /从目录导入/ }))
    fireEvent.change(screen.getByPlaceholderText(/projects/), { target: { value: 'D:\\code\\压力测试\\projects\\survey' } })
    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    await waitFor(() => expect(mockImport).toHaveBeenCalledWith('D:\\code\\压力测试\\projects\\survey'))
  })
})
