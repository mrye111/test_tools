/**
 * Mind2Web steps.ndjson → Kaggle 训练行（HF typed-decisions 行格式）。
 * 渲染 cleaned_html → 我们自己的极速快照 → 用 pos_candidate 的 bounding_box_rect
 * 映射回快照元素序号 → 产出 {state, questions, gold}（gold=one-hot）。
 *
 * 用法：node server/scripts/convert-mind2web.mjs --steps <steps.ndjson> --out <rows.jsonl> [--limit N]
 * 依赖：npm run server:build（import 自 server/dist）+ playwright
 */
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SNAPSHOT_SCRIPT } from '../dist/src/features/automation/fast/snapshot.js';
import { buildDecisionQuestions, buildDecisionState } from '../dist/src/features/automation/fast/questions.js';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const STEPS_PATH = argOf('--steps', resolve(SITE_ROOT, '..', 'artifacts', 'laya-ft', 'mind2web', 'steps.ndjson'));
const OUT_PATH = argOf('--out', resolve(SITE_ROOT, '..', 'artifacts', 'laya-ft', 'mind2web', 'rows.jsonl'));
const LIMIT = Number(argOf('--limit', '0'));
const VIEWPORT = { width: 1280, height: 720 };
const MAX_NEG = 24;

const OP_MAP = { CLICK: 'CLICK', TYPE: 'TYPE_TEXT', SELECT: 'SELECT' };

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function centerDistance(a, b) {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
}

function centerInsideBbox(el, bbox, slack = 10) {
  const cx = el.bbox.x + el.bbox.w / 2;
  const cy = el.bbox.y + el.bbox.h / 2;
  return cx >= bbox.x - slack && cx <= bbox.x + bbox.w + slack && cy >= bbox.y - slack && cy <= bbox.y + bbox.h + slack;
}

function mapTarget(snapshot, targetBbox) {
  if (!targetBbox) return null;
  // 1. IoU 最佳（≥0.3）
  let best = null;
  let bestIou = 0;
  for (const el of snapshot.elements) {
    const overlap = iou(el.bbox, targetBbox);
    if (overlap > bestIou) {
      bestIou = overlap;
      best = el;
    }
  }
  if (bestIou >= 0.3) return best;
  // 2. 容器包裹：Mind2Web 的候选常是 <a>/<li> 容器，我们的交互元素在其内部
  const contained = snapshot.elements.filter((el) => centerInsideBbox(el, targetBbox));
  if (contained.length > 0) {
    return contained.sort((a, b) => iou(b.bbox, targetBbox) - iou(a.bbox, targetBbox))[0];
  }
  // 3. 最近中心兜底（cleaned_html 去包装导致的布局位移，阈值放宽到 120px）
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const el of snapshot.elements) {
    const distance = centerDistance(el.bbox, targetBbox);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = el;
    }
  }
  return nearestDistance <= 120 ? nearest : null;
}

function targetElementOf(step) {
  return step.posCandidates.find((c) => c.is_top_level_target || c.is_original_target) ?? step.posCandidates[0] ?? null;
}

async function* iterSteps() {
  const rl = createInterface({ input: createReadStream(STEPS_PATH, 'utf-8'), crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
    count++;
    if (LIMIT > 0 && count >= LIMIT) break;
  }
}

async function main() {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const out = createWriteStream(OUT_PATH, { flags: 'w' });
  const stats = { ok: 0, noTarget: 0, noMap: 0, noElements: 0, renderFail: 0, total: 0, scrollRecords: 0 };

  const browser = await chromium.launch({ headless: true });
  // JavaScript 关闭：cleaned_html 是静态训练数据，不需要跑脚本——脚本（定时器/rAF）会在共享页面上累积直至拖死渲染
  let context = await browser.newContext({ viewport: VIEWPORT, javaScriptEnabled: false });
  let page = await context.newPage();
  let pagesSinceRotate = 0;
  const rotatePage = async () => {
    await context.close().catch(() => undefined);
    context = await browser.newContext({ viewport: VIEWPORT, javaScriptEnabled: false });
    page = await context.newPage();
    pagesSinceRotate = 0;
  };
  try {
    for await (const step of iterSteps()) {
      const i = stats.total++;
      if (i % 200 === 0) console.log(`  ${i} ok=${stats.ok} noMap=${stats.noMap} scroll=${stats.scrollRecords} renderFail=${stats.renderFail}`);
      if (++pagesSinceRotate >= 300) await rotatePage();
      const operation = OP_MAP[step.operation?.op];
      if (!operation) {
        stats.noTarget++;
        continue;
      }
      const target = targetElementOf(step);
      if (!target?.bbox) {
        stats.noTarget++;
        continue;
      }
      try {
        await page.goto('about:blank');
        await page.setContent(step.cleanedHtml, { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch {
        stats.renderFail++;
        continue;
      }

      const goal = step.goal || step.actionRepr || 'complete the task';
      // 匹配目标元素（三层）：① backend_node_id 直查（cleaned_html 保留该属性）→ 滚入视口后读快照标记
      // ② 该元素的渲染 bbox 做视口内匹配 ③ 文档坐标滚动搜索
      let mapped = null;
      let snapshot = null;
      let scrollY = 0;
      let scrollRecordsEmitted = 0;
      let firstSnapshotEmpty = false;
      const targetNodeId = target.backend_node_id ?? null;

      if (targetNodeId != null) {
        const idxAttr = await page.evaluate(
          `(() => {
            const el = document.querySelector('[backend_node_id="${targetNodeId}"]');
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            return true;
          })()`,
        );
        if (idxAttr) {
          scrollY = await page.evaluate('window.scrollY');
          snapshot = await page.evaluate(SNAPSHOT_SCRIPT);
          const fidx = await page.evaluate(
            `document.querySelector('[backend_node_id="${targetNodeId}"]')?.getAttribute('data-at-fidx') ?? null`,
          );
          if (fidx) {
            mapped = snapshot.elements.find((el) => el.index === Number(fidx)) ?? null;
          }
          if (!mapped) {
            const renderedBbox = await page.evaluate(
              `(() => { const el = document.querySelector('[backend_node_id="${targetNodeId}"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
            );
            if (renderedBbox) mapped = mapTarget(snapshot, renderedBbox);
          }
        }
      }

      if (!mapped) {
        for (let scrollRound = 0; scrollRound <= 30 && !mapped; scrollRound++) {
          snapshot = await page.evaluate(SNAPSHOT_SCRIPT);
          if (scrollRound === 0 && snapshot.elements.length === 0) firstSnapshotEmpty = true;
          const docSnapshot = {
            ...snapshot,
            elements: snapshot.elements.map((el) => ({ ...el, bbox: { ...el.bbox, y: el.bbox.y + scrollY } })),
          };
          mapped = mapTarget(docSnapshot, target.bbox);
          if (mapped) break;
          // 目标不可见 → 这也是一条训练记录：此刻应该 SCROLL_DOWN（教会模型"找不到先滚"）
          if (scrollRecordsEmitted < 2 && snapshot.elements.length > 0) {
            const scrollQuestions = buildDecisionQuestions(snapshot, goal);
            const scrollState = buildDecisionState(snapshot, []);
            if (scrollQuestions.operation.criteria.SCROLL_DOWN) {
              out.write(JSON.stringify({
                state: JSON.stringify(scrollState),
                questions: JSON.stringify(scrollQuestions),
                gold: JSON.stringify({ operation: { probabilities: { SCROLL_DOWN: 1.0 } } }),
                source: 'mind2web-scroll',
                annotationId: step.annotationId,
                stepIndex: step.stepIndex,
              }) + '\n');
              stats.scrollRecords++;
              scrollRecordsEmitted++;
            }
          }
          // 只有"不再前进"才停：空视口轮次不代表到底（长页中间可能是空段）
          const prevY = scrollY;
          await page.evaluate('window.scrollBy(0, 600)');
          scrollY = await page.evaluate('window.scrollY');
          if (scrollY <= prevY) break;
        }
      }

      if (!mapped || !snapshot) {
        if (firstSnapshotEmpty) stats.noElements++;
        else stats.noMap++;
        continue;
      }

      const questions = buildDecisionQuestions(snapshot, goal);
      const state = buildDecisionState(snapshot, []);
      const gold = { operation: { probabilities: { [operation]: 1.0 } } };

      let targetKey = null;
      if (operation === 'CLICK' || operation === 'TYPE_TEXT') targetKey = String(mapped.index);
      if (operation === 'SELECT') {
        const option = mapped.options?.find((o) => o.value === step.operation.value || o.label === step.operation.value);
        if (!option) {
          stats.noMap++;
          continue;
        }
        targetKey = option.index;
      }
      const headKey = `${operation.toLowerCase()}_target`;
      const head = questions[headKey];
      if (!head || !(targetKey in head.criteria)) {
        stats.noMap++;
        continue;
      }
      gold[headKey] = { probabilities: { [targetKey]: 1.0 } };

      out.write(
        JSON.stringify({
          state: JSON.stringify(state),
          questions: JSON.stringify(questions),
          gold: JSON.stringify(gold),
          source: 'mind2web',
          annotationId: step.annotationId,
          stepIndex: step.stepIndex,
        }) + '\n',
      );
      stats.ok++;
    }
  } finally {
    await browser.close();
  }  out.end();
  console.log(`done: ok=${stats.ok} scroll=${stats.scrollRecords} noTarget=${stats.noTarget} noMap=${stats.noMap} noElements=${stats.noElements} renderFail=${stats.renderFail} → ${OUT_PATH}`);
}

await main();
