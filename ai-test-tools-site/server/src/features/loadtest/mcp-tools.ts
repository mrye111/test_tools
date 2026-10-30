import type { JsonObject } from '../../jmx-serializer.js';
import { err, ok, type ToolResult } from '../../tool-result.js';
import type { LoadTestRepository } from './types.js';
import { getLoadTestReport, type LoadTestRouteDeps } from './routes.js';

export interface AsyncLoadTestTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
  execute(args: JsonObject): Promise<ToolResult>;
}

export function createLoadTestTools(repo: LoadTestRepository, deps: LoadTestRouteDeps): AsyncLoadTestTool[] {
  const schema = (key?: string): JsonObject => ({ type: 'object', properties: key ? { [key]: { type: 'string' } } : {}, ...(key ? { required: [key] } : {}) });
  const id = (args: JsonObject, key: string) => typeof args[key] === 'string' ? (args[key] as string).trim() : '';
  return [
    { name: 'loadtest_list_projects', description: '列出在线压测项目。', inputSchema: schema(), execute: async () => ok('压测项目列表', { projects: await repo.listProjects() as unknown as JsonObject[], total: await repo.countProjects() }) },
    { name: 'loadtest_get_project', description: '查看压测项目配置，不返回环境变量值。', inputSchema: schema('projectId'), execute: async args => {
      const key = id(args, 'projectId'); if (!key) return err('invalid-args', 'projectId 不能为空');
      const project = await repo.getProject(key); if (!project) return err('not-found', '压测项目不存在');
      const { envVars, ...safe } = project;
      return ok('压测项目信息', { project: { ...safe, envKeys: Object.keys(envVars) } as unknown as JsonObject });
    } },
    { name: 'loadtest_run', description: '将项目加入串行压测队列。调用前应由用户确认目标和负载。', inputSchema: schema('projectId'), execute: async args => {
      const key = id(args, 'projectId'); if (!key) return err('invalid-args', 'projectId 不能为空');
      const project = await repo.getProject(key); if (!project) return err('not-found', '压测项目不存在');
      const run = await deps.runManager.enqueue(project, {}); return ok('压测已排队', { runId: run.id, status: run.status });
    } },
    { name: 'loadtest_run_status', description: '查询压测执行状态。', inputSchema: schema('runId'), execute: async args => {
      const key = id(args, 'runId'); if (!key) return err('invalid-args', 'runId 不能为空');
      const run = await repo.getRun(key); if (!run) return err('not-found', '压测执行不存在');
      const safeError = run.error && (/^(本机压测执行锁端口 39841 已占用|k6 进程仍在运行|无法确认 k6 进程状态|k6 退出码 \d+$)/.test(run.error))
        ? run.error : run.error ? '执行失败，请在发起执行的实例查看日志' : null;
      return ok('压测执行状态', { run: { id: run.id, projectId: run.projectId, status: run.status, error: safeError, exitCode: run.exitCode, startedAt: run.startedAt?.toISOString() ?? null, endedAt: run.endedAt?.toISOString() ?? null } });
    } },
    { name: 'loadtest_stop', description: '停止已排队或正在执行的压测。', inputSchema: schema('runId'), execute: async args => {
      const key = id(args, 'runId'); if (!key) return err('invalid-args', 'runId 不能为空');
      const run = await repo.getRun(key); if (!run) return err('not-found', '压测执行不存在');
      if (!['queued', 'running'].includes(run.status)) return err('invalid-state', '执行已结束，无需停止');
      try {
        const updated = await deps.runManager.stop(key); return ok('已请求停止压测', { runId: updated.id, status: updated.status });
      } catch (error) {
        return err('invalid-state', error instanceof Error ? error.message : '无法停止执行');
      }
    } },
    { name: 'loadtest_report', description: '读取压测报告及阈值判定。', inputSchema: schema('runId'), execute: async args => {
      const key = id(args, 'runId'); if (!key) return err('invalid-args', 'runId 不能为空');
      const report = await getLoadTestReport(repo, deps, key); if (!report) return err('not-found', '压测执行不存在');
      return ok('压测报告', { report: report as unknown as JsonObject });
    } },
  ];
}
