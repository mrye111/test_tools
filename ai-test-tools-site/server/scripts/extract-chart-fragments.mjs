#!/usr/bin/env node
/**
 * 图型片段抽取器：从 lieflat-charts gallery 正本中抽出白名单图型的渲染代码块，
 * 写入 server/assets/chart-fragments/，供 AI 报告生成管线在组装阶段注入 prompt。
 *
 * 用法：node server/scripts/extract-chart-fragments.mjs
 * 上游 lieflat-charts 更新时替换 server/assets/lieflat-charts/ 后重跑本脚本。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "..", "assets");
const galleryDir = join(assetsDir, "lieflat-charts", "templates");
const outDir = join(assetsDir, "chart-fragments");

/** 白名单：catalog 编号 → gallery 文件与代码块匹配串（L2 为暗卡图，按研究结论排除）。 */
const WHITELIST = [
  { code: "F1", gallery: "basics-gallery.html", match: "rung bars", cardTitle: "Revenue by plan, rung by rung", contract: "少类目比较（≤8），单位可数；1 档 = 1 个诚实单位" },
  { code: "F2", gallery: "basics-gallery.html", match: "hairline line", cardTitle: "Thirty days of sign-ups", contract: "日序列（≤30 天，逐日读数）" },
  { code: "F4", gallery: "basics-gallery.html", match: "tick donut", cardTitle: "Where the traffic comes from", contract: "100% 构成（≤6 段）；1 tick = 1%" },
  { code: "F5", gallery: "basics-gallery.html", match: "tick rows", cardTitle: "Six teams, shipped and counted", contract: "横向排名比较，单位可数（≤8 行）" },
  { code: "F6", gallery: "basics-gallery.html", match: "paired rungs", cardTitle: "This year against last, plan by plan", contract: "分组对比（每类 2 系列，如今昔）" },
  { code: "F7", gallery: "basics-gallery.html", match: "stacked rungs", cardTitle: "Where each region's revenue sits", contract: "堆叠构成（≤4 类 × ≤3 段）" },
  { code: "F9", gallery: "basics-gallery.html", match: "rung waterfall", cardTitle: "From gross to net, step by step", contract: "瀑布 / 增减分解（≤6 级）" },
  { code: "F10", gallery: "basics-gallery.html", match: "dot heat", cardTitle: "When support gets loud", contract: "星期×小时×量（小热力）" },
  { code: "F11", gallery: "basics-gallery.html", match: "tick gauge", cardTitle: "How far to the quarter's goal", contract: "单值进度（0–100%）" },
  { code: "L3", gallery: "lupi-gallery.html", match: "barcode lollipop", cardTitle: "Ninety days as a barcode", contract: "每天一个读数的日序列（90 天级，要肌理）" },
  { code: "L4", gallery: "lupi-gallery.html", match: "arc bubble matrix", cardTitle: "Eight products land in twelve cities", contract: "分类×分类+量，小数据（≤100 格）" },
  { code: "L5", gallery: "lupi-gallery.html", match: "radial convergence", cardTitle: "48 requests pull toward five themes", contract: "多对一归属，不丢明细（≤60 条）" },
  { code: "L12", gallery: "lupi-gallery.html", match: "type colonnade", cardTitle: "Forty-four repos, ten owners", contract: "多对一归属+逐条名单（≤50 条）" },
  { code: "L14", gallery: "lupi-gallery.html", match: "hundred field", cardTitle: "A hundred of us, four minds", contract: "100% 构成（占比），≤6 类小数据；1 点 = 1 单位" },
  { code: "G7", gallery: "glance-gallery.html", match: "LR tree", cardTitle: "Everything the platform ships", contract: "层级结构（2–3 层）；ECharts", echarts: true },
  { code: "G15", gallery: "glance-gallery.html", match: "jitter strip", cardTitle: "Response times, spread out", contract: "分组分布，逐条记录（几百点）；ECharts", echarts: true },
];

const BLOCK_RE = /^\/\/ ════ (.+?) ════\s*$/;

/** 把 gallery 的 script 区按 ════ 注释块切分，返回 [{label, code}]。 */
function splitBlocks(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(BLOCK_RE);
    if (m) {
      if (current) blocks.push(current);
      current = { label: m[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({ label: b.label, code: b.lines.join("\n").trimEnd() }));
}

function header(entry) {
  return [
    "// ═══════════════════════════════════════════════════════════",
    `// 图型片段 ${entry.code} · ${entry.cardTitle}`,
    `// 数据契约：${entry.contract}`,
    `// 引擎：${entry.echarts ? "ECharts（HTML 需引入 echarts@6 CDN）" : "手写 SVG（零依赖，可离线）"}`,
    "// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取",
    "// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画",
    "// ═══════════════════════════════════════════════════════════",
    "",
  ].join("\n");
}

const galleries = new Map();
for (const entry of WHITELIST) {
  if (!galleries.has(entry.gallery)) {
    galleries.set(entry.gallery, splitBlocks(readFileSync(join(galleryDir, entry.gallery), "utf8")));
  }
}

mkdirSync(outDir, { recursive: true });
const manifest = [];
let failed = 0;

for (const entry of WHITELIST) {
  const blocks = galleries.get(entry.gallery);
  const block = blocks.find((b) => b.label.toLowerCase().includes(entry.match.toLowerCase()));
  if (!block) {
    console.error(`✗ ${entry.code} 未在 ${entry.gallery} 找到匹配块（${entry.match}）`);
    failed++;
    continue;
  }
  writeFileSync(join(outDir, `${entry.code}.js`), header(entry) + block.code + "\n", "utf8");
  manifest.push({
    code: entry.code,
    cardTitle: entry.cardTitle,
    contract: entry.contract,
    echarts: Boolean(entry.echarts),
    file: `${entry.code}.js`,
  });
  console.log(`✓ ${entry.code} · ${entry.cardTitle}（${block.code.split("\n").length} 行）`);
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

if (failed > 0) {
  console.error(`\n${failed} 个图型抽取失败`);
  process.exit(1);
}
console.log(`\n完成：${manifest.length} 个图型片段 → ${outDir}`);
