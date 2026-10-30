// 服务端 Playwright + Midscene 运行环境最小验证脚本（不接入 Express，独立运行）。
// 用法: node ai-test-tools-site/server/scripts/verify-midscene.mjs
// - 模型配置读取 artifacts/midscene-poc/.env（PoC 已验证的 kimi 配置），可用同名环境变量覆盖；绝不把 key 写进本文件。
// - 目标页优先用 http://localhost:5199 本站首页（可用 TARGET_URL 覆盖）；不可达时退化为内联静态页。
// - 报告通过 MIDSCENE_RUN_DIR 落到 artifacts/midscene-server-verify/（该目录在根 .gitignore 内，不污染仓库）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

// 1. 注入模型配置：已有环境变量优先，否则读 PoC 的 .env
const envFile = path.join(repoRoot, 'artifacts', 'midscene-poc', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const missing = ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_API_KEY', 'MIDSCENE_MODEL_NAME']
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[verify] missing env: ${missing.join(', ')} (expect them in ${envFile})`);
  process.exit(1);
}

// 2. 报告目录：Midscene 解析 path.resolve(cwd, MIDSCENE_RUN_DIR)，给绝对路径即原样使用
const runDir = path.join(repoRoot, 'artifacts', 'midscene-server-verify');
process.env.MIDSCENE_RUN_DIR = runDir;

const { chromium } = await import('playwright');
const { PlaywrightAgent } = await import('@midscene/web/playwright');

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const TARGET = process.env.TARGET_URL || 'http://localhost:5199';
const reachable = await fetch(TARGET, { signal: AbortSignal.timeout(3000) })
  .then((r) => r.ok)
  .catch(() => false);

const FALLBACK_HTML = `<!doctype html><html><body style="font-family:sans-serif;padding:48px">
  <h1>Midscene 服务端验证页</h1>
  <p>这是一个用于验证 aiAct / aiAssert 的静态页面。</p>
  <button id="start" style="padding:12px 28px;font-size:18px"
    onclick="document.getElementById('done').style.display='block'">立即开始</button>
  <p id="done" style="display:none;font-size:20px;color:green">已开始</p>
</body></html>`;

const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let actPrompt;
  let assertPrompt;
  if (reachable) {
    console.log(`[${elapsed()}] open ${TARGET}`);
    await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
    actPrompt = '点击页面中的「立即开始」按钮';
    assertPrompt = '页面展示了工具矩阵区域，能看到多个 AI 测试工具卡片（如需求分析）';
  } else {
    console.log(`[${elapsed()}] ${TARGET} unreachable, fallback to inline page`);
    await page.setContent(FALLBACK_HTML);
    actPrompt = '点击页面中的「立即开始」按钮';
    assertPrompt = '页面中出现了「已开始」文本';
  }

  const agent = new PlaywrightAgent(page);
  console.log(`[${elapsed()}] aiAct: ${actPrompt}`);
  await agent.aiAct(actPrompt);
  console.log(`[${elapsed()}] aiAct done`);
  console.log(`[${elapsed()}] aiAssert: ${assertPrompt}`);
  await agent.aiAssert(assertPrompt);
  console.log(`[${elapsed()}] aiAssert done`);
} catch (err) {
  failed = err;
} finally {
  await browser.close();
}

const reportDir = path.join(runDir, 'report');
if (existsSync(reportDir)) {
  const newest = readdirSync(reportDir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(reportDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (newest) console.log(`[${elapsed()}] report: ${newest}`);
}

if (failed) {
  console.error(`[${elapsed()}] VERIFY FAILED: ${failed?.message || failed}`);
  process.exit(1);
}
console.log(`[${elapsed()}] VERIFY PASSED (target=${reachable ? TARGET : 'inline-fallback'})`);
