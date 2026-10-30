import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorWizard, ReportPanel } from './LoadTestMonitoring'
import * as api from '../features/loadtest/loadtest-api'
vi.mock('../features/loadtest/loadtest-api', () => ({getMonitorConfig: vi.fn(), saveMonitorConfig: vi.fn(), verifyMonitor: vi.fn(), getReport: vi.fn(), downloadReport: vi.fn()}))
describe('监控与报告', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('保存监控配置并显示三段验证结果', async () => {
    vi.mocked(api.getMonitorConfig).mockResolvedValue({config: {prometheusUrl: '', targets: [], loadGeneratorTarget: null}, verified: false})
    vi.mocked(api.saveMonitorConfig).mockResolvedValue({config: {prometheusUrl:'http://localhost:9090', targets:['localhost:9100'], loadGeneratorTarget:'localhost:9100'}, verified:false})
    vi.mocked(api.verifyMonitor).mockResolvedValue({verification: {ready:{ok:true,message:'就绪'}, remoteWrite:{ok:true,message:'回环成功'}, targets:{ok:false,message:'不健康'}, verified:false}})
    render(<MonitorWizard />)
    await screen.findByText('监控未验证通过')
    fireEvent.change(screen.getByLabelText('Prometheus 地址'), {target:{value:'http://localhost:9090'}})
    fireEvent.change(screen.getByLabelText('监控目标'), {target:{value:'localhost:9100'}})
    fireEvent.change(screen.getByLabelText('压测机目标'), {target:{value:'localhost:9100'}})
    fireEvent.click(screen.getByRole('button', {name:'保存并验证'}))
    await waitFor(() => expect(api.saveMonitorConfig).toHaveBeenCalledWith({prometheusUrl:'http://localhost:9090', targets:['localhost:9100'], loadGeneratorTarget:'localhost:9100'}))
    expect(await screen.findByText(/目标健康：不健康/)).toBeInTheDocument()
    expect(screen.getByText('监控未验证通过')).toBeInTheDocument()
  })
  it('报告显示缺失数据与后端阈值结果并触发导出', async () => {
    vi.mocked(api.getReport).mockResolvedValue({collecting:false, run:{} as never, metrics:[{name:'P95',value:null,unit:'ms'}], thresholds:[{metric:'duration',expression:'p(95)<100',passed:false}], series:[], monitoring:'未采集', errors:[]})
    vi.mocked(api.downloadReport).mockResolvedValue(undefined)
    render(<ReportPanel runId="run1" />)
    expect(await screen.findByText('未采集')).toBeInTheDocument()
    expect(screen.getByText(/p\(95\)<100：未通过/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'导出 HTML'}))
    expect(api.downloadReport).toHaveBeenCalledWith('run1')
  })
})
