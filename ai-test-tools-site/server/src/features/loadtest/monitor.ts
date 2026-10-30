import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { resolveK6Binary } from './k6-runner.js';
import type { ReportSeries } from './report.js';

export type MonitorConfig = { prometheusUrl: string; targets: string[]; loadGeneratorTarget?: string | null };
type Stage = { ok: boolean; message: string };
export type Verification = { ready: Stage; remoteWrite: Stage; targets: Stage; verified: boolean };
const call = promisify(execFile);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyMonitor(config: MonitorConfig, fetcher: typeof fetch = fetch, probe?: (url: string) => Promise<boolean>): Promise<Verification> {
  const result: Verification = { ready: { ok: false, message: '未验证' }, remoteWrite: { ok: false, message: '未验证' }, targets: { ok: false, message: '未验证' }, verified: false };
  try {
    const response = await fetcher(`${config.prometheusUrl}/-/ready`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result.ready = { ok: true, message: 'Prometheus 已就绪' };
  } catch { result.ready.message = 'Prometheus 未就绪或无法访问'; return result; }
  try {
    if (!await (probe ?? remoteWriteProbe)(config.prometheusUrl)) throw new Error('loopback failed');
    result.remoteWrite = { ok: true, message: 'remote-write 写入并查回成功' };
  } catch { result.remoteWrite.message = 'remote-write 写入或查询失败'; return result; }
  try {
    if (!config.targets.length) throw new Error('targets missing');
    const response = await fetcher(`${config.prometheusUrl}/api/v1/targets`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('targets request failed');
    const json = await response.json() as { status?: string; data?: { activeTargets?: { health?: string; labels?: { instance?: string } }[] } };
    const active = json.data?.activeTargets ?? [];
    if (json.status !== 'success' || !config.targets.every(target => active.some(item => item.labels?.instance === target && item.health === 'up'))) throw new Error('target unhealthy');
    result.targets = { ok: true, message: '目标均健康' };
  } catch { result.targets.message = '目标未配置、不存在或不健康'; return result; }
  result.verified = true;
  return result;
}

async function remoteWriteProbe(url: string): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-monitor-'));
  const id = randomUUID();
  try {
    const script = join(dir, 'probe.js');
    await writeFile(script, "import { Counter } from 'k6/metrics'; const probe = new Counter('nexus_monitor_probe'); export default function(){probe.add(1)}", 'utf8');
    await call(resolveK6Binary(process.cwd()), ['run', '--iterations', '1', '--vus', '1', '--tag', `probe=${id}`, '-o', 'experimental-prometheus-rw', script], { timeout: 20000, env: { ...process.env, K6_PROMETHEUS_RW_SERVER_URL: `${url}/api/v1/write`, K6_PROMETHEUS_RW_PUSH_INTERVAL: '1s', K6_NO_USAGE_REPORT: 'true' } });
    for (let i = 0; i < 5; i++) {
      const query = encodeURIComponent(`k6_nexus_monitor_probe_total{probe="${id}"}`);
      const response = await fetch(`${url}/api/v1/query?query=${query}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      const json = await response.json() as { status?: string; data?: { result?: unknown[] } };
      if (json.status === 'success' && (json.data?.result?.length ?? 0) > 0) return true;
      await pause(1000);
    }
    return false;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export class MonitorService {
  private config: MonitorConfig = { prometheusUrl: '', targets: [] };
  private verified = false;
  constructor(private path: string) {}
  async load() { try { this.config = JSON.parse(await readFile(this.path, 'utf8')) as MonitorConfig; } catch { /* no saved config */ } }
  get() { return { config: this.config, verified: this.verified }; }
  async set(config: MonitorConfig) {
    const url = new URL(config.prometheusUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Prometheus 地址必须为不含凭据、查询参数的 HTTP(S) 地址');
    if (!Array.isArray(config.targets) || config.targets.some(t => typeof t !== 'string' || !t.trim()) || config.targets.length > 20) throw new Error('监控目标必须是实例名称数组（最多 20 个）');
    if (config.loadGeneratorTarget && !config.targets.includes(config.loadGeneratorTarget)) throw new Error('压测机必须是已配置的监控目标');
    this.config = { prometheusUrl: config.prometheusUrl.replace(/\/+$/, ''), targets: config.targets.map(t => t.trim()), loadGeneratorTarget: config.loadGeneratorTarget || null };
    this.verified = false;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.config), 'utf8');
    return this.get();
  }
  async verify() { const snapshot = JSON.stringify(this.config); const verification = await verifyMonitor(this.config); this.verified = verification.verified && snapshot === JSON.stringify(this.config); if (!this.verified) verification.verified = false; return verification; }
  activeUrl() { return this.verified ? this.config.prometheusUrl : undefined; }
}

export async function queryErrorSamples(url: string, runId: string, end: Date): Promise<string[]> {
  try {
    const label = runId.replace(/[^a-zA-Z0-9_-]/g, '');
    const params = new URLSearchParams({ query: `k6_http_req_failed_rate{testid="${label}"} > 0`, time: String(end.getTime() / 1000) });
    const response = await fetch(`${url}/api/v1/query?${params}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const json = await response.json() as { status?: string; data?: { result?: { metric?: Record<string, string>; value?: [number, string] }[] } };
    if (!response.ok || json.status !== 'success') return [];
    return (json.data?.result ?? []).slice(0, 10).map(item => {
      const status = /^\d{3}$/.test(item.metric?.status ?? '') ? item.metric!.status : '未知';
      const method = /^[A-Z]{1,12}$/.test(item.metric?.method ?? '') ? item.metric!.method : '未知';
      const code = /^\d{1,10}$/.test(item.metric?.error_code ?? '') ? item.metric!.error_code : '无';
      const rate = Number(item.value?.[1]);
      return `HTTP ${method}，状态 ${status}，错误码 ${code}，该标签组失败率 ${Number.isFinite(rate) ? (rate * 100).toFixed(2) + '%' : '未采集'}`;
    });
  } catch { return []; }
}

export async function querySeries(url: string, runId: string, start: Date, end: Date, targets: string[] = []): Promise<ReportSeries[]> {
  const label = `testid="${runId.replace(/[^a-zA-Z0-9_-]/g, '')}"`;
  const queries = [
    { name: '虚拟用户', unit: 'VU', query: `sum(k6_vus{${label}})`, multiplier: 1 },
    { name: '响应时间 P95', unit: 'ms', query: `max(k6_http_req_duration_p95{${label}})`, multiplier: 1000 },
    { name: '响应时间 P99', unit: 'ms', query: `max(k6_http_req_duration_p99{${label}})`, multiplier: 1000 },
    { name: '请求失败率', unit: '%', query: `sum(k6_http_req_failed_rate{${label}} * k6_http_reqs_total{${label}}) / sum(k6_http_reqs_total{${label}}) * 100`, multiplier: 1 },
  ];
  for (const [index, target] of targets.entries()) {
    const instance = target.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const name = `监控目标 ${index + 1}`;
    queries.push(
      { name: `${name} Linux CPU`, unit: '%', query: `100 - avg(irate(node_cpu_seconds_total{instance="${instance}",mode="idle"}[1m])) * 100`, multiplier: 1 },
      { name: `${name} Windows CPU`, unit: '%', query: `100 - avg(irate(windows_cpu_time_total{instance="${instance}",mode="idle"}[1m])) * 100`, multiplier: 1 },
      { name: `${name} Linux 内存`, unit: '%', query: `(1 - node_memory_MemAvailable_bytes{instance="${instance}"} / node_memory_MemTotal_bytes{instance="${instance}"}) * 100`, multiplier: 1 },
      { name: `${name} Windows 内存`, unit: '%', query: `(1 - windows_memory_physical_free_bytes{instance="${instance}"} / windows_memory_physical_total_bytes{instance="${instance}"}) * 100`, multiplier: 1 },
    );
  }
  const output: ReportSeries[] = [];
  await Promise.all(queries.map(async (entry) => {
    try {
      const params = new URLSearchParams({ query: entry.query, start: String(start.getTime() / 1000), end: String(end.getTime() / 1000), step: String(Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1000 / 500))) });
      const response = await fetch(`${url}/api/v1/query_range?${params}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      const data = await response.json() as { status?: string; data?: { result?: { values?: [number, string][] }[] } };
      if (!response.ok || data.status !== 'success') return;
      const points = (data.data?.result?.[0]?.values ?? []).map(([time, value]) => ({ time: time * 1000, value: Number(value) * entry.multiplier })).filter(p => Number.isFinite(p.value));
      if (points.length) output.push({ name: entry.name, unit: entry.unit, points });
    } catch { /* unavailable data is not zero */ }
  }));
  return output;
}
