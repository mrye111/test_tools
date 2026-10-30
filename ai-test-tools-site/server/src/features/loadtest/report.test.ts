import { describe, expect, it } from 'vitest';
import { makeReport, reportHtml } from './report.js';

describe('load test report', () => {
  it('uses k6 threshold results and leaves absent data unavailable', () => {
    const report = makeReport({ status: 'succeeded', summaryText: null } as never, {
      metrics: { http_req_duration: { 'p(95)': 66, thresholds: { 'p(95)<100': false, 'p(95)<50': true } } },
    });
    expect(report.metrics).toContainEqual({ name: 'http_req_duration p(95)', value: 66, unit: 'ms' });
    expect(report.thresholds).toEqual([{ metric: 'http_req_duration', expression: 'p(95)<100', passed: true }, { metric: 'http_req_duration', expression: 'p(95)<50', passed: false }]);
    expect(report.monitoring).toContain('未采集');
    expect(report.series).toEqual([]);
  });
  it('does not misrepresent false samples as failed requests in either report format', () => {
    const report = makeReport({ status: 'succeeded', summaryText: null } as never, {
      metrics: { http_req_failed: { passes: 0, fails: 150, value: 0 } },
    });
    expect(report.metrics).toEqual([{ name: 'http_req_failed value', value: 0, unit: '' }]);
    expect(reportHtml(report)).not.toContain('http_req_failed fails');
  });
});
