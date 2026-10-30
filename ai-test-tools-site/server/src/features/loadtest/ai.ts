import type { Express, Request } from 'express';
import { AppError } from '../../app-error.js';
import { callChatCompletion } from '../testcase/ai.js';
import type { AiRequestConfig, JsonObject } from '../testcase/types.js';
import { isObject } from '../testcase/utils.js';
import type { makeReport } from './report.js';

type Report = ReturnType<typeof makeReport>;
type Complete = typeof callChatCompletion;
export type LoadTestAiDeps = {
  resolveConfig: (req: Request, body: JsonObject) => Promise<AiRequestConfig>;
  getReport: (id: string) => Promise<Report | null>;
  complete?: Complete;
};

/** 将草稿或报告交给当前用户主动配置的模型；不会执行或自动保存模型生成的脚本。 */
export function registerLoadTestAiRoutes(app: Express, deps: LoadTestAiDeps): void {
  const complete = deps.complete ?? callChatCompletion;
  const resolve = async (req: Request): Promise<AiRequestConfig> => deps.resolveConfig(req, isObject(req.body) ? req.body : {});

  app.post('/api/loadtest/ai-draft', async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const target = typeof body.targetBaseUrl === 'string' ? body.targetBaseUrl.trim() : '';
    if (!prompt || prompt.length > 10000 || target.length > 500) {
      res.status(400).json({ success: false, error: '请填写不超过 10000 字的脚本需求，目标地址不超过 500 字' }); return;
    }
    let config: AiRequestConfig;
    try { config = await resolve(req); }
    catch (error) { res.status(error instanceof AppError ? error.httpStatus : 400).json({ success: false, error: error instanceof Error ? error.message : '模型配置无效' }); return; }
    try {
      const raw = await complete(config, { messages: [
        { role: 'system', content: '你是 k6 脚本工程师。根据用户需求生成可编辑的 k6 JavaScript 脚本草稿，仅输出脚本源码，不运行脚本。包含合理的 checks、options 和阈值；不要编造认证信息。' },
        { role: 'user', content: `需求：${prompt}\n${target ? `目标地址：${target}` : '目标地址由用户配置'}` },
      ], temperature: 0.2, maxTokens: 8192 });
      const script = raw.trim().replace(/^```(?:javascript|js|k6)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
      if (!script || script.length > 512 * 1024) throw new Error('empty or oversized AI result');
      res.json({ success: true, script });
    } catch (error) {
      res.status(error instanceof AppError ? error.httpStatus : 502).json({ success: false, error: error instanceof AppError ? error.message : 'AI 脚本生成失败，请检查模型配置或稍后重试' });
    }
  });

  app.post('/api/loadtest/runs/:id/ai-interpret', async (req, res) => {
    const report = await deps.getReport(req.params.id);
    if (!report) { res.status(404).json({ success: false, error: '压测执行不存在' }); return; }
    let config: AiRequestConfig;
    try { config = await resolve(req); }
    catch (error) { res.status(error instanceof AppError ? error.httpStatus : 400).json({ success: false, error: error instanceof Error ? error.message : '模型配置无效' }); return; }
    try {
      // 只发送经过报告模块清洗的指标及错误摘要，不发送脚本、环境变量、目标地址和日志。
      const evidence = { status: report.run.status, metrics: report.metrics, thresholds: report.thresholds, errors: report.errors, monitoring: report.monitoring };
      const analysis = (await complete(config, { messages: [
        { role: 'system', content: '你是性能测试分析师。仅依据提供的压测报告指标、阈值和错误样本给出中文结论及排查建议；明确缺失信息，不得编造原因、指标或容量结论。' },
        { role: 'user', content: JSON.stringify(evidence) },
      ], temperature: 0.2, maxTokens: 4096 })).trim();
      if (!analysis) throw new Error('empty AI result');
      res.json({ success: true, analysis });
    } catch (error) {
      res.status(error instanceof AppError ? error.httpStatus : 502).json({ success: false, error: error instanceof AppError ? error.message : 'AI 报告解读失败，请检查模型配置或稍后重试' });
    }
  });
}
