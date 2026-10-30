/**
 * 批量预编译（票据 10）：遍历功能用例集 → 每条用例调 /api/automation/compile → 聚合可自动化率。
 * 用法：node server/scripts/batch-compile.mjs [apiBase] [projectFilter]
 *   apiBase 默认 http://localhost:3000（需服务已启动）
 *   projectFilter 可选：项目 id 或名称（如 "自动化测试"），只编译该项目下的用例集
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSetCases } from '../dist/src/features/testcase/functional-case-rows.js';

const API = process.argv[2] ?? 'http://localhost:3000';
const PROJECT_FILTER = process.argv[3] ?? '';
const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = resolve(SITE_ROOT, '..');

function loadEnv(path) {
  const env = {};
  try {
    for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch { /* 文件不存在则空 */ }
  return env;
}

const dotenv = loadEnv(resolve(SITE_ROOT, 'server', '.env'));
const aiConfig = {
  provider: 'codex',
  endpointType: 'openai_chat',
  baseUrl: dotenv.MIDSCENE_MODEL_BASE_URL,
  apiKey: dotenv.MIDSCENE_MODEL_API_KEY,
  model: dotenv.MIDSCENE_MODEL_NAME,
};
if (!aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
  console.error('server/.env 缺少 MIDSCENE_MODEL_* 配置');
  process.exit(1);
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  return res.json();
}

const MANUAL_PATTERNS = [
  [/批处理|定时任务|结算|job/i, '后端批处理/结算'],
  [/api|接口|调用|请求|压测/i, 'API/调用构造'],
  [/日志|log|落库|数据库|db\b/i, '日志/数据库检查'],
  [/抓包|断网|网络|弱网/i, '网络构造/抓包'],
  [/准备|造数|预置|初始化/i, '数据准备'],
];

function categorizeManual(text) {
  for (const [pattern, category] of MANUAL_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return '其他非 UI 操作';
}

async function compileOne(item, setName) {
  const res = await fetch(`${API}/api/automation/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caseRef: item.caseId,
      title: item.title,
      precondition: item.precondition,
      steps: item.steps,
      expectedResult: item.expectedResult,
      env: {},
      aiConfig,
    }),
  });
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return { ...payload.data, setName, caseId: item.caseId, title: item.title };
}

const allProjects = (await getJson('/api/projects')).data;
const projects = PROJECT_FILTER
  ? allProjects.filter((p) => p.id === PROJECT_FILTER || p.name === PROJECT_FILTER)
  : allProjects;
if (PROJECT_FILTER && projects.length === 0) {
  console.error(`找不到项目：${PROJECT_FILTER}`);
  process.exit(1);
}
console.log(`编译范围：${projects.map((p) => p.name).join('、')}`);
const allResults = [];
const skipped = [];

for (const project of projects) {
  const sets = (await getJson(`/api/test-sets?project_id=${project.id}`)).data;
  for (const set of sets) {
    if (set.testType && set.testType !== 'functional') {
      skipped.push({ set: set.name, reason: `非功能用例集(${set.testType})` });
      continue;
    }
    const detail = (await getJson(`/api/test-sets/${set.id}`)).data;
    const cases = parseSetCases(detail);
    if (cases.length === 0) {
      skipped.push({ set: set.name, reason: '无可编译用例行' });
      continue;
    }
    console.log(`编译「${set.name}」${cases.length} 条…`);
    // 并发 3（票据 03 节流参数）
    for (let i = 0; i < cases.length; i += 3) {
      const batch = await Promise.all(
        cases.slice(i, i + 3).map((item) =>
          compileOne(item, set.name).catch((error) => ({ setName: set.name, caseId: item.caseId, title: item.title, error: error.message })),
        ),
      );
      allResults.push(...batch);
      process.stdout.write(`  ${Math.min(i + 3, cases.length)}/${cases.length}\r`);
    }
  }
}

// ── 聚合 ──
const ok = allResults.filter((r) => !r.error);
const failed = allResults.filter((r) => r.error);
const byExecutable = { full: 0, partial: 0, manual: 0 };
const manualCategories = {};
const validationErrors = {};
let fallbackCount = 0;
let cacheHitCount = 0;
const setStats = {};

for (const r of ok) {
  byExecutable[r.plan.executable]++;
  if (r.usedFallback) fallbackCount++;
  if (r.cacheHit) cacheHitCount++;
  const s = (setStats[r.setName] ??= { total: 0, full: 0, partial: 0, manual: 0, fallback: 0 });
  s.total++;
  s[r.plan.executable]++;
  if (r.usedFallback) s.fallback++;
  for (const item of r.plan.manualItems) {
    const cat = categorizeManual(item.text + item.reason);
    manualCategories[cat] = (manualCategories[cat] ?? 0) + 1;
  }
  for (const err of r.validationErrors) {
    validationErrors[err] = (validationErrors[err] ?? 0) + 1;
  }
}

const lines = [];
lines.push('# 存量功能用例批量预编译与可自动化率报告');
lines.push('');
lines.push(`- 时间：${new Date().toISOString()}`);
lines.push(`- 编译用例总数：${ok.length}（编译 API 失败 ${failed.length} 条）`);
lines.push(`- 缓存命中：${cacheHitCount} 条（重复文本零成本）`);
lines.push('');
lines.push('## 可自动化程度分布');
lines.push('');
lines.push('| 评级 | 用例数 | 占比 |');
lines.push('|---|---|---|');
for (const [level, count] of Object.entries(byExecutable)) {
  lines.push(`| ${level} | ${count} | ${ok.length ? Math.round((count / ok.length) * 100) : 0}% |`);
}
lines.push(`| （其中降级直映 compileFailed） | ${fallbackCount} | ${ok.length ? Math.round((fallbackCount / ok.length) * 100) : 0}% |`);
lines.push('');
lines.push('## 按用例集');
lines.push('');
lines.push('| 用例集 | 总数 | full | partial | manual | 降级 |');
lines.push('|---|---|---|---|---|---|');
for (const [name, s] of Object.entries(setStats)) {
  lines.push(`| ${name} | ${s.total} | ${s.full} | ${s.partial} | ${s.manual} | ${s.fallback} |`);
}
lines.push('');
lines.push('## 人工项原因分类（执行器 API 动作通道的需求依据）');
lines.push('');
lines.push('| 类别 | 次数 |');
lines.push('|---|---|');
for (const [cat, count] of Object.entries(manualCategories).sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${cat} | ${count} |`);
}
if (Object.keys(validationErrors).length > 0) {
  lines.push('');
  lines.push('## 校验错误 TOP（编译器 prompt 改进线索）');
  lines.push('');
  lines.push('| 错误 | 次数 |');
  lines.push('|---|---|');
  for (const [err, count] of Object.entries(validationErrors).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    lines.push(`| ${err} | ${count} |`);
  }
}
if (failed.length > 0) {
  lines.push('');
  lines.push('## 编译 API 失败明细');
  lines.push('');
  for (const f of failed) lines.push(`- ${f.setName} / ${f.caseId}：${f.error}`);
}

const outDir = resolve(REPO_ROOT, 'docs', 'wayfinder', 'automation-midscene', 'research');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, '10-batch-compile-report.md'), lines.join('\n'), 'utf-8');

console.log('\n===== 汇总 =====');
console.log(`编译 ${ok.length} 条：full=${byExecutable.full} partial=${byExecutable.partial} manual=${byExecutable.manual}；降级 ${fallbackCount}；缓存命中 ${cacheHitCount}；API 失败 ${failed.length}`);
console.log('报告：docs/wayfinder/automation-midscene/research/10-batch-compile-report.md');
