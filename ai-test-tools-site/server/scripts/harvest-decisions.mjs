/**
 * 决策数据收割器（票据 14 阶段 A）：回放自动化用例（视觉引擎执行），
 * 每个 act 步骤前取极速快照，把 Midscene 动作事件映射回快照元素序号，
 * 产出 (state, questions, answer) JSONL 训练数据。
 *
 * 用法：node server/scripts/harvest-decisions.mjs [--api http://localhost:3000] [--out artifacts/laya-ft] [--caseIds id1,id2]
 * 依赖：API 服务已启动（读用例）、server/.env 有模型配置、已 npm run server:build（import 自 server/dist）。
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { SNAPSHOT_SCRIPT } from '../dist/src/features/automation/fast/snapshot.js';
import { buildDecisionQuestions, buildDecisionState } from '../dist/src/features/automation/fast/questions.js';
import { mapActionToLabel } from '../dist/src/features/automation/fast/harvest-mapping.js';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = resolve(SITE_ROOT, '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const API = argOf('--api', 'http://localhost:3000');
const OUT_DIR = resolve(REPO_ROOT, argOf('--out', 'artifacts/laya-ft'));
const CASE_IDS = (argOf('--caseIds', '') || '').split(',').filter(Boolean);

function loadEnv(path) {
  const env = {};
  try {
    for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch { /* ignore */ }
  return env;
}

const dotenv = loadEnv(resolve(SITE_ROOT, 'server', '.env'));
for (const [key, value] of Object.entries(dotenv)) {
  process.env[key] ??= value;
}
process.env.MIDSCENE_RUN_DIR = resolve(OUT_DIR, 'midscene_run');

if (!process.env.MIDSCENE_MODEL_API_KEY) {
  console.error('server/.env 缺少 MIDSCENE_MODEL_API_KEY');
  process.exit(1);
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return payload.data;
}

function toSnapshot(raw) {
  return raw; // evaluate 返回的结构即 FastSnapshot（元素含 index/kind/role/name/bbox）
}

async function harvestCase(page, automationCase, stats) {
  if (!automationCase.entryUrl) {
    stats.skipped.push(`${automationCase.caseNo}: 无 entryUrl`);
    return;
  }
  await page.goto(automationCase.entryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  const history = [];
  const agent = new PlaywrightAgent(page);
  for (const step of automationCase.steps) {
    if (!step.enabled) continue;
    if (step.type !== 'act') {
      if (step.type === 'assert' || step.type === 'wait') {
        try {
          if (step.type === 'assert') await agent.aiAssert(step.text);
          else await agent.aiWaitFor(step.text, { timeout: 60000 });
        } catch (error) {
          stats.failedSteps.push(`${automationCase.caseNo} 步骤${step.id}: ${error.message}`);
          break;
        }
      }
      continue;
    }

    // 动作前快照 + 问题构建（训练/推理共用）
    const snapshot = toSnapshot(await page.evaluate(SNAPSHOT_SCRIPT));
    const questions = buildDecisionQuestions(snapshot, step.text);
    const state = buildDecisionState(snapshot, history);
    const actions = [];
    const seenSignatures = new Set();
    const unsubscribe = agent.addProgressListener((event) => {
      // 只收 action_done：action_running/action_done 对同一动作是两个不同对象，避免重复记录
      if (event.scope !== 'aiAct' || event.phase !== 'action_done') return;
      const action = event.data?.action;
      if (!action) return;
      const signature = JSON.stringify([action.name, action.point, action.param]);
      if (seenSignatures.has(signature)) return;
      seenSignatures.add(signature);
      actions.push(action);
    });

    let stepOk = true;
    try {
      await agent.aiAct(step.text);
    } catch (error) {
      stepOk = false;
      stats.failedSteps.push(`${automationCase.caseNo} 步骤${step.id}: ${error.message}`);
    } finally {
      unsubscribe?.();
    }

    const labels = [];
    for (const action of actions) {
      const label = mapActionToLabel(snapshot, action);
      if (label) labels.push(label);
    }
    for (const label of labels) {
      stats.records.push({
        goal: step.text,
        state,
        questions,
        answer: { operation: label.operation, target: label.target ?? null, text: label.text ?? null },
        source: { caseId: automationCase.caseNo, stepId: step.id, stepOk, harvestedAt: new Date().toISOString() },
      });
      history.push(`${label.operation}${label.target ? ` [${label.target}]` : ''}${label.text ? ` ← "${label.text}"` : ''}`);
    }
    if (labels.length === 0 && stepOk) stats.unmapped.push(`${automationCase.caseNo} 步骤${step.id}: 动作无法映射元素`);
    if (!stepOk) break;
  }
  await agent.destroy().catch(() => undefined);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const allCases = await getJson('/api/automation/cases');
  const cases = CASE_IDS.length > 0 ? allCases.filter((c) => CASE_IDS.includes(c.id)) : allCases;
  console.log(`收割范围：${cases.length} 条用例`);

  const stats = { records: [], skipped: [], failedSteps: [], unmapped: [] };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const automationCase of cases) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      try {
        console.log(`收割 ${automationCase.caseNo} · ${automationCase.title}（${automationCase.steps.filter((s) => s.type === 'act').length} act 步）`);
        await harvestCase(page, automationCase, stats);
      } catch (error) {
        stats.failedSteps.push(`${automationCase.caseNo}: ${error.message}`);
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }

  // 80/20 切分（按用例维度切，同一用例不跨集合）
  const byCase = new Map();
  for (const record of stats.records) {
    const list = byCase.get(record.source.caseId) ?? [];
    list.push(record);
    byCase.set(record.source.caseId, list);
  }
  const caseIds = [...byCase.keys()];
  const trainIds = new Set(caseIds.slice(0, Math.max(1, Math.ceil(caseIds.length * 0.8))));
  const train = stats.records.filter((r) => trainIds.has(r.source.caseId));
  const evalSet = stats.records.filter((r) => !trainIds.has(r.source.caseId));

  const trainPath = resolve(OUT_DIR, 'train.jsonl');
  const evalPath = resolve(OUT_DIR, 'eval.jsonl');
  writeFileSync(trainPath, train.map((r) => JSON.stringify(r)).join('\n') + (train.length ? '\n' : ''), 'utf-8');
  writeFileSync(evalPath, evalSet.map((r) => JSON.stringify(r)).join('\n') + (evalSet.length ? '\n' : ''), 'utf-8');

  console.log('\n===== 收割汇总 =====');
  console.log(`记录：${stats.records.length}（train ${train.length} / eval ${evalSet.length}）→ ${OUT_DIR}`);
  if (stats.skipped.length) console.log('跳过:', stats.skipped);
  if (stats.unmapped.length) console.log('未映射:', stats.unmapped);
  if (stats.failedSteps.length) console.log('失败步骤:', stats.failedSteps.slice(0, 5));
}

await main();
