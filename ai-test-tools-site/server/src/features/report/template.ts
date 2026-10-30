/**
 * 报告拼装器（B 层）：确定性骨架 + 模板填槽。
 *
 * 设计立场：模型负责「写什么」，服务端负责「长什么样」。
 * 模型只产出 ReportDraft（槽位 JSON），整份单文件 HTML 由本模块拼装 ——
 * 版式 100% 确定，不再漂移；组装阶段也不再消耗一次 LLM 调用。
 *
 * 图型渲染代码仍来自 chart-fragments 的真实片段，数据经 __DATA__ 槽位注入：
 * 片段里的 `__DATA__` 会被整体替换为 JSON 字面量。
 */
import type { PlaceholderSelection, ReportDraft, FigureSlot } from "./prompts.js";

/** 全出血图的 viewBox 高度（与各片段作图高度对齐）。G7/G15 走 .ch 容器，无 viewBox。 */
const FIGURE_VB_HEIGHT: Record<string, number> = {
  F11: 340, F4: 150, F5: 350, L4: 400, L14: 340, F2: 340,
  F1: 380, F6: 380, F7: 380, F9: 380, F10: 440, L3: 360, L5: 580, L12: 420,
};
const DEFAULT_VB_HEIGHT = 400;
const ECHARTS_CODES = new Set(["G7", "G15"]);

/**
 * 文本进 HTML 必须转义：槽位内容来自模型输出，是不可信输入。
 * 不转义就是给报告开一个 XSS 面（iframe 虽有 sandbox，下载的单文件 HTML 没有）。
 */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON 字面量注入脚本：U+2028/2029 是合法 JSON 却会截断 JS 源码，必须转义。 */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? null).split("\u2028").join("\\u2028").split("\u2029").join("\\u2029");
}

/** 把片段里的 __DATA__ 槽位替换为真实数据字面量。 */
export function bindFragmentData(fragmentCode: string, data: unknown): string {
  return fragmentCode.split("__DATA__").join(jsLiteral(data));
}

/** 片段自带的容器 id（rungs / gauge …）改写成模板分配的 ch{n}。 */
function rebindChartId(fragmentCode: string, index: number): string {
  return fragmentCode.replace(
    /((?:obsReveal|eReveal)\(\s*)(['"])[^'"]*\2/,
    `$1'ch${index}'`,
  );
}

function renderTable(columns: string[], rows: (string | number)[][]): string {
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`)
    .join("\n            ");
  return `<table class="data">
          <thead><tr>${head}</tr></thead>
          <tbody>
            ${body}
          </tbody>
        </table>`;
}

/** 单张图：.fig 四件套 + 数据表孪生。 */
function renderFigure(fig: FigureSlot, index: number): string {
  const echarts = ECHARTS_CODES.has(fig.code);
  const container = echarts
    ? `<div class="ch" id="ch${index}"></div>`
    : `<svg id="ch${index}" viewBox="0 0 1080 ${FIGURE_VB_HEIGHT[fig.code] ?? DEFAULT_VB_HEIGHT}"></svg>`;
  const table = fig.table
    ? `\n      <details class="tv"><summary>数据表</summary>
        ${renderTable(fig.table.columns, fig.table.rows)}
      </details>`
    : "";
  return `<figure class="fig">
      <h2>${esc(fig.title)}</h2>
      <div class="sub">${esc(fig.sub)}</div>
      ${container}
      <div class="src">${esc(fig.source)}</div>${table}
    </figure>`;
}

function renderKpi(kpi: NonNullable<ReportDraft["kpi"]>): string {
  const hero = kpi.hero;
  const pct = hero.unit ? `<span class="pct">${esc(hero.unit)}</span>` : "";
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const meter =
    hero.meterPct === undefined
      ? ""
      : `<div class="meter">
          <div class="meter-fill" style="width:${clamp(hero.meterPct)}%"></div>${
            hero.threshold === undefined
              ? ""
              : `\n          <div class="meter-mark" style="left:${clamp(hero.threshold)}%"><span>${esc(hero.thresholdLabel ?? "阈值")}</span></div>`
          }
        </div>`;
  const tiles = (kpi.tiles ?? [])
    .map(
      (t) => `<div class="tile">
          <div class="tile-label">${esc(t.label)}</div>
          <div class="tile-val">${esc(t.value)}${t.unit ? `<small>${esc(t.unit)}</small>` : ""}</div>
          <div class="tile-foot"><span class="delta delta-${esc(t.deltaTone)}">${esc(t.delta)}</span></div>
        </div>`,
    )
    .join("\n        ");
  return `<div class="kpi">
      <div>
        <div class="hero-label">${esc(hero.label)}</div>
        <div class="hero-fig">${esc(hero.value)}${pct}</div>
        ${meter}${hero.note ? `\n        <p class="hero-sub">${esc(hero.note)}</p>` : ""}
      </div>
      <div class="tiles">
        ${tiles}
      </div>
    </div>`;
}

function renderPlaceholder(p: PlaceholderSelection): string {
  return `<section class="sec">
    <div class="placeholder" data-missing="${esc(p.missing)}">
      <div>
        <h3>${esc(p.title)}</h3>
        <p class="placeholder-need">${esc(p.need)}</p>
      </div>
      <button type="button" class="btn" onclick="parent.postMessage({type:'nexus-report-supplement',missing:'${esc(p.missing)}'},'*')">补录数据</button>
    </div>
  </section>`;
}

export interface RenderAssets {
  monoTokens: string;
  /** 取某图型的渲染片段全文（含 __DATA__ 槽位）。 */
  fragment: (code: string) => string;
}

/**
 * 把槽位 JSON 拼成单文件 HTML 报告。
 * 结构（五段式编辑排版）一字不差，模型无从改排布。
 */
export function renderReportHtml(draft: ReportDraft, assets: RenderAssets): string {
  const figures: { fig: FigureSlot; index: number }[] = [];
  const placeholders: PlaceholderSelection[] = [];
  draft.charts.forEach((c, index) => {
    if (c.code === "PLACEHOLDER") placeholders.push(c as PlaceholderSelection);
    else figures.push({ fig: c as FigureSlot, index });
  });
  const byIndex = new Map(figures.map((f) => [f.index, f]));

  const chartScripts = figures
    .map(({ fig, index }) => rebindChartId(bindFragmentData(assets.fragment(fig.code), fig.data), index))
    .join("\n");

  const claimed = new Set<number>();
  const sections = (draft.sections ?? [])
    .map((sec) => {
      const figs = (sec.figureIndexes ?? [])
        .filter((idx) => !claimed.has(idx) && byIndex.has(idx))
        .map((idx) => {
          claimed.add(idx);
          const f = byIndex.get(idx)!;
          return renderFigure(f.fig, f.index);
        })
        .join("\n    ");
      return `<section class="sec">
    <span class="sec-num">${esc(sec.num)}</span>
    <h2 class="sec-title">${esc(sec.title)}</h2>${sec.lede ? `\n    <p class="sec-lede">${esc(sec.lede)}</p>` : ""}
    ${figs}
  </section>`;
    })
    .join("\n\n  ");

  // 未被任何 section 引用的图兜底排到末尾，保证不丢图
  const orphans = figures.filter((f) => !claimed.has(f.index));
  const orphanSection = orphans.length
    ? `<section class="sec">
    <span class="sec-num">§ 补</span>
    <h2 class="sec-title">补充图</h2>
    ${orphans.map((f) => renderFigure(f.fig, f.index)).join("\n    ")}
  </section>`
    : "";

  const detail = draft.detail
    ? `<section class="sec">
    <span class="sec-num">${esc(draft.detail.num)}</span>
    <h2 class="sec-title">${esc(draft.detail.title)}</h2>${draft.detail.sub ? `\n    <p class="sec-lede">${esc(draft.detail.sub)}</p>` : ""}
    ${renderTable(draft.detail.columns, draft.detail.rows)}
  </section>`
    : "";

  const appendix = draft.appendix
    ? `<section class="sec">
    <span class="sec-num">${esc(draft.appendix.num)}</span>
    <h2 class="sec-title">${esc(draft.appendix.title)}</h2>
    <dl class="dl-note">
      ${(draft.appendix.items ?? []).map((it) => `<dt>${esc(it.term)}</dt><dd>${esc(it.text)}</dd>`).join("\n      ")}
    </dl>
  </section>`
    : "";

  const needEcharts = figures.some((f) => ECHARTS_CODES.has(f.fig.code));

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(draft.title)}</title>${needEcharts ? `\n<script src="https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js"></script>` : ""}
</head>
<body>
<div class="sheet">

  <header class="masthead">
    <div class="masthead-top">
      <span class="kicker">${esc(draft.kicker?.[0] ?? "测试报告")}</span>
      <span class="kicker">${esc(draft.kicker?.[1] ?? "")}</span>
    </div>
    <hr class="rule-heavy" />
    <h1 class="report-title">${esc(draft.title)}</h1>${
      draft.verdict
        ? `\n    <p class="verdict">\n      <span class="stamp stamp-${esc(draft.verdict.stamp)}">${esc(draft.verdict.label)}</span>\n      <span>${esc(draft.verdict.text)}</span>\n    </p>`
        : ""
    }${
      draft.meta?.length
        ? `\n    <dl class="meta-grid">\n      ${draft.meta
            .map((m) => `<div><dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd></div>`)
            .join("\n      ")}\n    </dl>`
        : ""
    }
  </header>

  ${
    draft.findings?.length
      ? `<section class="sec">
    <span class="sec-num">§ 00</span>
    <h2 class="sec-title">结论与建议</h2>
    <ol class="findings">
      ${draft.findings
        .map((f) => `<li><span class="tag tag-${esc(f.tag)}">● ${esc(f.label)}</span>${esc(f.text)}</li>`)
        .join("\n      ")}
    </ol>
  </section>`
      : ""
  }

  ${draft.kpi ? `<section class="sec">
    <span class="sec-num">§ 01</span>
    <h2 class="sec-title">本轮指标</h2>
    ${renderKpi(draft.kpi)}
  </section>` : ""}

  ${sections}
  ${orphanSection}
  ${detail}
  ${placeholders.map(renderPlaceholder).join("\n  ")}
  ${appendix}

  <footer class="colophon">
    <span>${esc(draft.colophon?.[0] ?? "")}</span>
    <span>${esc(draft.colophon?.[1] ?? "")}</span>
    <span>${esc(draft.colophon?.[2] ?? "")}</span>
  </footer>

</div>
<script>
${assets.monoTokens}
</script>
<script>
const {INK,PAPER,MUTED,FAINT,GRID,L,LAD,DARK,STATUS,RAMP,FONT,SHAPE,MOTION,tipLight,tipDark,
  D2R,rnd,pol,sect,blob,barH,barV,el,txt,tip,obsReveal,eReveal,keep} = MONO;
document.head.appendChild(Object.assign(document.createElement('link'), { rel:'stylesheet', href: MONO.FONT.link }));
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: MONO.DOC_CSS }));
${chartScripts}
</script>
</body>
</html>
`;
}
