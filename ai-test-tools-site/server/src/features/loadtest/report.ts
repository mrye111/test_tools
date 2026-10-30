import type { LoadTestRun } from './types.js';

type Summary = { metrics?: Record<string, Record<string, unknown> & { thresholds?: Record<string, boolean> }> };
export interface ReportSeries { name: string; unit: string; points: { time: number; value: number }[] }

export function makeReport(run: LoadTestRun, summary: Summary | null, series: ReportSeries[] = [], monitoring = '未采集监控数据', errors: string[] = [], collecting = false) {
  const sanitize = (input: string) => {
    let result = input.replace(/https?:\/\/[^\s"']+/gi, '[地址已隐藏]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[地址已隐藏]');
    for (const [key, value] of Object.entries(run.envSnapshot ?? {})) if (/token|secret|password|credential|key|cookie/i.test(key) && value.length >= 4) result = result.split(value).join('[已隐藏]');
    return result;
  };
  const metrics: { name: string; value: number | null; unit: string }[] = [];
  const thresholds: { metric: string; expression: string; passed: boolean | null }[] = [];
  for (const [name, metric] of Object.entries(summary?.metrics ?? {})) {
    for (const [key, value] of Object.entries(metric)) {
      if (typeof value !== 'number') continue;
      // Rate 统计的 fails 是 false 采样数；对 http_req_failed 来说代表请求成功，
      // 直接展示为「fails」会被误认成失败请求数。保留 value（失败率）。
      if (/^http_req_failed(?:\{|$)/.test(name) && (key === 'passes' || key === 'fails')) continue;
      metrics.push({ name: sanitize(`${name} ${key}`), value: Number.isFinite(value) ? value : null, unit: name.includes('duration') || name.includes('waiting') || name.includes('connecting') ? 'ms' : '' });
    }
    for (const [expression, result] of Object.entries(metric.thresholds ?? {})) {
      thresholds.push({ metric: sanitize(name), expression: sanitize(expression), passed: typeof result === 'boolean' ? !result : null });
    }
  }
  return { run: { id: run.id, projectId: run.projectId, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt, exitCode: run.exitCode, summaryText: run.summaryText ? sanitize(run.summaryText) : null }, metrics, thresholds, series, monitoring, errors, collecting };
}

export function reportHtml(report: ReturnType<typeof makeReport>): string {
  const esc = (value: unknown) => String(value ?? '未采集').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const metrics = report.metrics.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.value)} ${esc(m.unit)}</td></tr>`).join('');
  const thresholds = report.thresholds.map(t => `<tr><td>${esc(t.metric)}</td><td>${esc(t.expression)}</td><td>${t.passed === null ? '未知' : t.passed ? '通过' : '未通过'}</td></tr>`).join('');
  const charts = report.series.map(s => {
    if (!s.points.length) return '';
    const minT = s.points[0].time, maxT = s.points[s.points.length - 1].time;
    const min = Math.min(...s.points.map(p => p.value)), max = Math.max(...s.points.map(p => p.value));
    const points = s.points.map(p => `${40 + (p.time - minT) / (maxT - minT || 1) * 720},${180 - (p.value - min) / (max - min || 1) * 150}`).join(' ');
    return `<h3>${esc(s.name)} (${esc(s.unit)})</h3><svg viewBox="0 0 800 210" role="img" aria-label="${esc(s.name)} 曲线"><path d="M40 15V180H760" fill="none" stroke="#94a3b8"/><polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2"/><text x="0" y="20">${esc(max.toFixed(2))}</text><text x="0" y="180">${esc(min.toFixed(2))}</text></svg>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>压测报告</title><style>body{font:16px sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#1a2533}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}pre{white-space:pre-wrap}svg{width:100%;max-width:800px}</style><h1>压测报告</h1><p>执行 ${esc(report.run.id)} · ${esc(report.run.status)}</p><p>${esc(report.monitoring)}</p><h2>指标</h2><table>${metrics || '<tr><td>未采集</td></tr>'}</table><h2>阈值判定</h2><table>${thresholds || '<tr><td>未采集</td></tr>'}</table><h2>曲线</h2>${charts || '<p>未采集</p>'}<h2>摘要</h2><pre>${esc(report.run.summaryText)}</pre><h2>错误样本</h2><pre>${esc(report.errors.join('\n') || '未采集')}</pre></html>`;
}
