import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryLoadTestRepository } from './repository.js';
import { RunManager } from './run-manager.js';
import { createLoadTestTools } from './mcp-tools.js';
import { JmeterMcpRuntime } from '../../mcp-runtime.js';

describe('loadtest MCP', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, {recursive:true, force:true}); });
  it('lists projects and runs through the same queue to read the report', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lt-mcp-'));
    const repo = new MemoryLoadTestRepository();
    const project = await repo.createProject({name:'local',targetBaseUrl:'http://127.0.0.1',scriptSource:'export default function() {}',envVars:{API_SECRET:'hidden'}});
    const runner = { start: async (spec: {workDir:string}) => { await writeFile(join(spec.workDir, 'summary.json'), JSON.stringify({metrics:{http_req_failed:{rate:0,thresholds:{'rate<0.1':false}}}})); return {exitCode:0}; }, stop: () => {} };
    const manager = new RunManager({repo, runner, workDirRoot:dir});
    const runtime = new JmeterMcpRuntime();
    runtime.registerAsyncTools(createLoadTestTools(repo,{runManager:manager,workDirRoot:dir}));
    const call = async (name:string, args:object = {}) => {
      const response = await runtime.dispatchAsync({jsonrpc:'2.0', id:1, method:'tools/call',params:{name, arguments:args}});
      return response?.result as {data?: { total?: number; runId?: string; run?: { status: string }; report?: { thresholds: unknown } }; isError?: boolean};
    };
    expect((await call('loadtest_list_projects')).data?.total).toBe(1);
    expect(JSON.stringify(await call('loadtest_get_project',{projectId:project.id}))).not.toContain('hidden');
    const started = await call('loadtest_run',{projectId:project.id});
    const runId = started.data?.runId as string;
    let status = '';
    for (let i=0;i<50;i++) { status = (await call('loadtest_run_status',{runId})).data?.run?.status ?? ''; if (status === 'succeeded') break; await new Promise(r=>setTimeout(r,20)); }
    expect(status).toBe('succeeded');
    const report = await call('loadtest_report',{runId});
    expect(report.data?.report?.thresholds).toEqual([{metric:'http_req_failed',expression:'rate<0.1',passed:true}]);
    expect((await call('loadtest_stop',{runId})).isError).toBe(true);
    expect((await call('loadtest_get_project',{projectId:'missing'})).isError).toBe(true);
    const foreign = await repo.createRun({projectId:project.id, envSnapshot:{}, scriptSnapshot:project.scriptSource});
    await repo.updateRun(foreign.id, {status:'running'});
    const rejected = await call('loadtest_stop',{runId:foreign.id});
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected)).toContain('其他服务实例管理');
    await repo.updateRun(foreign.id, {status:'failed',error:'本机压测执行锁端口 39841 已占用，另一实例可能正在运行，请稍后重试'});
    const failed = await call('loadtest_run_status',{runId:foreign.id});
    expect(JSON.stringify(failed)).toContain('执行锁端口 39841 已占用');
  });
});
