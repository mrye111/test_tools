import { describe, expect, it } from 'vitest';
import { verifyMonitor } from './monitor.js';

describe('monitor verification', () => {
  it('does not enable monitoring when the remote-write loopback fails', async () => {
    const result = await verifyMonitor({ prometheusUrl: 'http://localhost:9090', targets: ['host:9100'] }, async () => new Response('', { status: 200 }), async () => false);
    expect(result.ready.ok).toBe(true);
    expect(result.remoteWrite.ok).toBe(false);
    expect(result.verified).toBe(false);
  });
  it('enables monitoring only when every configured target is healthy', async () => {
    const fetcher = async (input: string | URL | Request) => String(input).endsWith('/-/ready')
      ? new Response('', { status: 200 })
      : Response.json({ status: 'success', data: { activeTargets: [{ health: 'up', labels: { instance: 'host:9100' } }] } });
    const config = { prometheusUrl: 'http://localhost:9090', targets: ['host:9100', 'db:9100'] };
    expect((await verifyMonitor(config, fetcher, async () => true)).verified).toBe(false);
    config.targets.pop();
    expect((await verifyMonitor(config, fetcher, async () => true)).verified).toBe(true);
  });
});
