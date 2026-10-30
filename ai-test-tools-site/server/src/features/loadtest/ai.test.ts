import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { registerLoadTestAiRoutes } from './ai.js';
import { parseAiRequestConfig } from '../testcase/ai.js';

let server: Server | undefined;
let modelServer: Server | undefined;
afterEach(() => { server?.close(); modelServer?.close(); });

describe('在线压测 AI 接口', () => {
  it('将自然语言转为可编辑的脚本草稿，不执行脚本', async () => {
    const app = express(); app.use(express.json());
    const complete = vi.fn().mockResolvedValue('```javascript\nexport default function () {}\n```');
    registerLoadTestAiRoutes(app, { resolveConfig: async () => ({} as never), complete, getReport: async () => null });
    server = app.listen(0); const port = (server.address() as {port:number}).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/loadtest/ai-draft`, {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'访问首页'})});
    expect(await response.json()).toEqual({success:true,script:'export default function () {}'});
    expect(complete).toHaveBeenCalledOnce();
  });

  it('仅将报告的指标和错误样本用于解读，不信任客户端报告', async () => {
    const app = express(); app.use(express.json());
    const complete = vi.fn().mockResolvedValue('响应正常');
    registerLoadTestAiRoutes(app, { resolveConfig: async () => ({} as never), complete, getReport: async () => ({run:{status:'succeeded'}, metrics:[{name:'p95',value:42}], thresholds:[], errors:['HTTP 500'], monitoring:'已采集'}) as never });
    server = app.listen(0); const port = (server.address() as {port:number}).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/loadtest/runs/run1/ai-interpret`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({report:'invented'})});
    expect(await response.json()).toEqual({success:true,analysis:'响应正常'});
    const prompt = JSON.stringify(complete.mock.calls[0]);
    expect(prompt).toContain('HTTP 500'); expect(prompt).toContain('42'); expect(prompt).not.toContain('invented');
  });

  it('通过本地 OpenAI 兼容服务生成草稿', async () => {
    const model = express(); model.use(express.json());
    model.post('/v1/chat/completions', (_req, res) => res.json({choices:[{message:{content:'export default function () {}'}}]}));
    modelServer = model.listen(0); const modelPort = (modelServer.address() as {port:number}).port;
    const app = express(); app.use(express.json());
    registerLoadTestAiRoutes(app, { resolveConfig: async (_req, body) => parseAiRequestConfig(body), getReport: async () => null });
    server = app.listen(0); const port = (server.address() as {port:number}).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/loadtest/ai-draft`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({prompt:'轻量访问', ai_config:{base_url:`http://127.0.0.1:${modelPort}/v1`, model:'local',isLocalModel:true}})});
    expect(await response.json()).toEqual({success:true,script:'export default function () {}'});
  });
});
