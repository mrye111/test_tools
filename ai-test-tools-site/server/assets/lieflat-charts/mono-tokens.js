/* ═══════════════════════════════════════════════════════════════
   MONO TOKENS — 风格的唯一正本
   所有 mono 图表（Chart.js / ECharts / 手写 SVG）共享这一份。
   任何文件里出现与本文件冲突的颜色、字体、动画参数，以本文件为准。
   用法：作为 <script src="mono-tokens.js"> 外链引入（标签按标准写全），全部挂在 window.MONO 上；
   也可以直接把本文件内容内联进单文件 HTML（开源分发时推荐内联）。
   ⚠ 本文件会被原样内联进报告的 <script> 块：注释里不得出现 script 的
   闭合序列（写成 </scr"+"ipt> 拆开即可）。HTML 解析器不认 JS 注释，
   一遇到闭合序列就提前截断脚本，报告里的图会全部画不出来。
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── 1 · 色板 ──────────────────────────────────────────────
     纸灰底 + 炭黑墨。没有彩色。明度即数据：最重要 = 最黑。   */
  const INK   = '#1C1C1A';   // 墨：主数据、标题、强调
  const PAPER = '#F0EFEB';   // 纸：页面底色 = 浅卡底色（卡片无边框，靠留白分卡）
  const MUTED = '#8F8E88';   // 次级文字、副标题
  const FAINT = '#C6C5BF';   // 来源行、辅助刻度
  const GRID  = '#DEDDD6';   // 网格线、发丝线

  // 7 级灰阶 ladder：多系列时按重要性从黑到浅分配
  const L   = ['#1C1C1A', '#4A4944', '#6A6963', '#8F8E88', '#B0AFA9', '#C6C5BF', '#D8D7D1'];
  // 5 级简版（waffle 等少系列场景）
  const LAD = ['#1C1C1A', '#4A4944', '#8F8E88', '#B0AFA9', '#D8D7D1'];

  // 暗卡（dark card）专用：底 #1C1C1A，其上的"墨"反转为纸色
  const DARK = {
    bg: '#1C1C1A',
    ink: '#F0EFEB',          // 暗卡上的主数据色
    muted: '#8F8E88',
    faint: '#55554F',        // 暗卡来源行
    grid: '#2E2D29',         // 暗卡网格 / 发丝线
    gridSoft: '#2A2925',
    ladder: ['#F0EFEB', '#DCDAD2', '#C9C7BD', '#B3B0A4', '#8F8E88', '#6A6963', '#4A4944'],
  };

  /* ── 1b · 语义状态色（reserved）────────────────────────────
     分工铁律：一切「量」（计数/密度）与「序」（严重度致命→提示）
     走上面的灰阶明度；状态色只编码「状态」，永不用作「第 N 个系列」
     或量的深浅。状态色必配 icon + label，不靠颜色单独承载语义。
     段序约束：通过 | 阻塞 | 失败 | 跳过 —— 绿红不得相邻
     （绿|红 相邻在红绿色盲下 ΔE 仅 4.1；此序为 9.7，常视 17.5）。
     琥珀 #C98500 对纸面对比 2.67、灰 2.86，低于 3:1 → 必须配可见直标。 */
  const STATUS = {
    good: '#0B7A0B',   // 通过 · 已修复
    warn: '#C98500',   // 阻塞 · 处理中
    crit: '#C0392B',   // 失败 · 激活
    mute: '#8F8E88',   // 跳过 · 已关闭（缺席/归档，非色相）
    // 状态序列（堆叠/图例的固定次序，勿重排）
    order: ['good', 'warn', 'crit', 'mute'],
  };

  // 量与序的明度阶梯（sequential：越深 = 越多 / 越重）
  const RAMP = ['#EDECE6', '#C6C5BF', '#8F8E88', '#4A4944', '#1C1C1A'];

  /* ── 2 · 字体 ──────────────────────────────────────────────
     两个 webfont 家族（性能预算上限）：衬线做章节/图标题的文档性格，
     等宽做眉题/数据/轴的档案性格。中文不走 webfont —— 中文字库太重，
     与单文件交付物冲突，由系统栈承担。                            */
  const FONT = {
    display: "'Newsreader','Songti SC','Source Han Serif SC','Noto Serif CJK SC','SimSun',serif",
    text: "'PingFang SC','Microsoft YaHei','Hiragino Sans GB',system-ui,-apple-system,'Segoe UI',sans-serif",
    mono: "'IBM Plex Mono',ui-monospace,SFMono-Regular,Consolas,monospace",
    // Google Fonts 引入行（放 <head>）：
    link: 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
    // 文档级字号阶梯：靠尺度对比（46 ↔ 9.5）建立层级，不靠加粗堆叠
    title:    { size: 46,   weight: 700, spacing: '-.025em' }, // 报告大标题（CJK 黑体粗）
    verdict:  { size: 22,   weight: 400 },                     // 一句话结论（衬线）
    sec:      { size: 25,   weight: 600 },                     // 章节名（衬线）
    fig:      { size: 19,   weight: 600 },                     // 图标题（衬线，写结论不写图型名）
    body:     { size: 15,   weight: 400 },                     // 正文 / 导语
    sub:      { size: 12.5, weight: 400 },                     // 图副标（单位口径 · 图例 · 范围）
    src:      { size: 9.5,  weight: 500, spacing: '.12em' },   // 来源行 / 眉题，等宽大写
    value:    { weight: 650 },                                 // hero 与 stat tile 数值（比例数字）
    axis:     { size: 10,  weight: 500 },                      // 轴标签（tabular-nums）
    // SVG 内最小字号下限：半宽卡 6.5px，通栏/大图 5.5px。低于下限改 hover 出。
    minHalf: 6.5, minWide: 5.5,
  };

  /* ── 3 · 形状 ────────────────────────────────────────────── */
  const SHAPE = {
    cardRadius: 4,           // 图卡圆角（文档感，不再是 24px 胶囊）
    cardPad: '18px 0 8px',   // 卡片只留上规线下的呼吸，不套盒
    barRadius: 99,           // 柱端胶囊圆角（竖柱只圆上端，横柱只圆外端）
    tooltipRadius: 12,
  };

  /* ── 4 · 动画性格 ────────────────────────────────────────
     快进快停，quarticOut / cubicOut，不弹跳（elasticOut 只给波浪入场）。 */
  const MOTION = {
    enter: 900,              // 常规入场 ms
    enterSlow: 1200,         // 大元素 / 关系图
    easing: 'quarticOut',
    staggerDot: 12,          // 点阵逐个延迟 ms（8–15 区间）
    staggerBar: 100,         // 条形逐根延迟 ms（80–130 区间）
    // CSS 动画类（手写 SVG 用）：pop 缩放入场 / fade 淡入 / draw 描线
    css: `
  .pop{transform-box:fill-box;transform-origin:center;animation:pop .5s cubic-bezier(.2,.7,.3,1.3) both}
  @keyframes pop{from{transform:scale(0)}to{transform:none}}
  .fade{animation:fade .9s ease both}
  @keyframes fade{from{opacity:0}}
  .draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1s cubic-bezier(.4,0,.2,1) both}
  @keyframes draw{to{stroke-dashoffset:0}}
  @media (prefers-reduced-motion:reduce){
    .pop,.fade{animation:none}
    .draw{animation:none;stroke-dasharray:none;stroke-dashoffset:0}
  }`,
  };

  /* ── 5 · Tooltip ─────────────────────────────────────────
     浅卡用黑底纸字，暗卡用纸底黑字。ECharts 直接展开这两个对象。 */
  const tipLight = { backgroundColor: INK, borderWidth: 0, padding: [10, 14],
    textStyle: { color: PAPER, fontFamily: 'Inter', fontSize: 12 } };
  const tipDark  = { backgroundColor: PAPER, borderWidth: 0, padding: [10, 14],
    textStyle: { color: INK, fontFamily: 'Inter', fontSize: 12 } };

  /* ── 6 · 确定性伪随机 ────────────────────────────────────
     演示数据一律用它，不用 Math.random()——刷新必须长一样，
     否则截图 / 录屏 / 回归对比全部失效。                       */
  const rnd = (i, k) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;

  /* ── 7 · 几何 ────────────────────────────────────────────── */
  const D2R = Math.PI / 180;
  const pol = (cx, cy, r, deg) => [cx + r * Math.cos(deg * D2R), cy + r * Math.sin(deg * D2R)];
  // 环形扇区 path（cornerRadius 自己在调用处用 ECharts sector 或手动倒角）
  const sect = (cx, cy, r0, r1, a0, a1) => {
    const big = a1 - a0 > 180 ? 1 : 0;
    const [xa, ya] = pol(cx, cy, r1, a0), [xb, yb] = pol(cx, cy, r1, a1);
    const [xc, yc] = pol(cx, cy, r0, a1), [xd, yd] = pol(cx, cy, r0, a0);
    return `M${xa} ${ya} A${r1} ${r1} 0 ${big} 1 ${xb} ${yb} L${xc} ${yc} A${r0} ${r0} 0 ${big} 0 ${xd} ${yd} Z`;
  };
  // 手绘感圆（editorial 系气泡用）：圆周叠两个慢波 + 噪声，seed 定形
  const blob = (x, y, r, seed) => {
    const n = Math.max(14, Math.round(r * 1.6)), pts = [];
    for (let t = 0; t < n; t++) {
      const a = t / n * Math.PI * 2;
      const w = 1 + .055 * Math.sin(a * 2 + seed * 7) + .04 * Math.sin(a * 3 + seed * 13)
              + (rnd(seed + t, 3) - .5) * .03;
      pts.push([x + Math.cos(a) * r * w, y + Math.sin(a) * r * w]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let t = 0; t < n; t++) {
      const p = pts[t], q = pts[(t + 1) % n];
      d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${((p[0]+q[0])/2).toFixed(1)} ${((p[1]+q[1])/2).toFixed(1)}`;
    }
    return d + ' Z';
  };

  // 横条 path：基线端（左）方角，数据端（右）4px 圆角。
  // 标记规格：条厚 ≤24px；条与条之间用 2px 表面间隙分开，绝不描边。
  const barH = (x, y, w, h, r = 4) => {
    if (w <= 0) return '';
    const rr = Math.min(r, w, h / 2);
    return `M${x} ${y} H${x + w - rr} Q${x + w} ${y} ${x + w} ${y + rr} V${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h} H${x} Z`;
  };
  // 竖柱 path：基线端（下）方角，数据端（上）4px 圆角。(x,y) 为柱顶左角，h 为柱高。
  const barV = (x, y, w, h, r = 4) => {
    if (h <= 0) return '';
    const rr = Math.min(r, h, w / 2);
    return `M${x} ${y + h} V${y + rr} Q${x} ${y} ${x + rr} ${y} H${x + w - rr} Q${x + w} ${y} ${x + w} ${y + rr} V${y + h} Z`;
  };

  /* ── 8 · SVG 快捷 ────────────────────────────────────────── */
  const NS = 'http://www.w3.org/2000/svg';
  const el  = (p, t, a) => { const n = document.createElementNS(NS, t);
    for (const k in a) n.setAttribute(k, a[k]); p.appendChild(n); return n; };
  const txt = (p, a, s) => { const n = el(p, 'text', a); n.textContent = s; return n; };
  const tip = (n, s) => { const t = document.createElementNS(NS, 'title');
    t.textContent = s; n.appendChild(t); };

  /* ── 9 · 统一 reveal：滚入视野才播，点击重播 ──────────────
     带 timer 登记（keep），重播前清干净，防动画叠加。          */
  const timers = {};
  const keep = (id, t) => { (timers[id] = timers[id] || []).push(t); };
  const obsReveal = (id, fn) => {
    const n = document.getElementById(id);
    const go = () => {
      (timers[id] || []).forEach(clearInterval); timers[id] = [];
      if (n.tagName === 'svg' || n.tagName === 'SVG') n.innerHTML = '';
      fn(n);
    };
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting) { go(); io.disconnect(); }
    }, { threshold: .3 });
    io.observe(n);
    n.style.cursor = 'pointer';
    n.addEventListener('click', go);
  };
  // ECharts 版 reveal
  const eReveal = (id, opt) => obsReveal(id, elDom => {
    const g = echarts.getInstanceByDom(elDom) || echarts.init(elDom);
    g.clear(); g.setOption(opt);
  });

  /* ── 10 · 文档骨架（生成新报告时照抄这个结构） ────────────
     立场：报告是文档，不是卡片墙。五段式竖向叙事流：
     ① <header class="masthead"> 眉题 / h1.report-title / .verdict / dl.meta-grid
     ② <section class="sec"> 结论与建议 → ol.findings
     ③ <section class="sec"> 本轮指标 → .kpi（1 个 .hero-fig + .meter + .tiles）
     ④ <section class="sec"> 分章叙事 → h2.sec-title + p.sec-lede + .grid2 > .card
     ⑤ 明细 table.data · 缺数 .placeholder · 页脚 footer.colophon
     图卡四件套：
     <div class="card">
       <h2>结论式标题</h2>
       <div class="sub">单位口径 · 图例 · 范围</div>
       <svg id="xx" viewBox="0 0 400 320"></svg>
       <div class="src">图型名 · 系列 · 数据来源</div>
     </div>
     图卡保持 400×320 viewBox 原生比例（.grid2 双列 ≈529px → 缩放 ≈1.3，
     片段内 5.5–11px 的字号落在可读区间）。                        */
  const DOC_CSS = `
  :root{--bg:${PAPER};--dark:${DARK.bg};--ink:${INK};--muted:${MUTED};--faint:${FAINT};--grid:${GRID};
    --good:${STATUS.good};--warn:${STATUS.warn};--crit:${STATUS.crit};--mute:${STATUS.mute}}
  *{margin:0;padding:0;box-sizing:border-box}
  html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  body{background:var(--bg);color:var(--ink);font-family:${FONT.text};font-size:${FONT.body.size}px;
    line-height:1.75;padding:0 32px 96px}
  .sheet{max-width:1080px;margin:0 auto}

  /* ── 报头 ── */
  .kicker{font-family:${FONT.mono};font-size:11px;font-weight:500;letter-spacing:.16em;
    color:var(--muted);text-transform:uppercase}
  .rule-heavy{height:2px;background:var(--ink);border:0}
  .masthead{padding-bottom:38px;border-bottom:1px solid var(--grid);margin-bottom:8px}
  .masthead-top{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:10px}
  h1.report-title{font-family:${FONT.text};font-size:clamp(30px,3.6vw,${FONT.title.size}px);
    font-weight:${FONT.title.weight};line-height:1.22;letter-spacing:${FONT.title.spacing};
    max-width:640px;margin:26px 0 0}
  h1.report-title em{font-style:normal;color:var(--crit)}
  .verdict{display:flex;align-items:baseline;gap:11px;margin-top:22px;
    font-family:${FONT.display};font-size:${FONT.verdict.size}px;line-height:1.5}
  .verdict .stamp{flex:none;font-family:${FONT.mono};font-size:10.5px;font-weight:600;letter-spacing:.12em;
    padding:3px 8px;border-radius:3px;transform:translateY(-2px);border:1.5px solid currentColor}
  .stamp-crit{color:var(--crit)} .stamp-warn{color:var(--warn)} .stamp-good{color:var(--good)}
  .meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px 32px;
    margin-top:34px;padding-top:22px;border-top:1px solid var(--grid)}
  .meta-grid dt{font-family:${FONT.mono};font-size:10px;letter-spacing:.13em;color:var(--faint);text-transform:uppercase}
  .meta-grid dd{font-size:13.5px;margin-top:5px;font-weight:500}

  /* ── 章节 ── */
  .sec{padding:40px 0;border-top:1px solid var(--grid)}
  h2.sec-title{font-family:${FONT.display};font-size:${FONT.sec.size}px;font-weight:${FONT.sec.weight};
    line-height:1.3;letter-spacing:-.01em;margin-bottom:14px}
  .sec-num{font-family:${FONT.mono};font-size:11px;font-weight:600;letter-spacing:.14em;
    color:var(--faint);display:block;margin-bottom:6px}
  .sec-lede{font-size:${FONT.body.size}px;line-height:1.85;max-width:60ch;margin-bottom:30px}

  /* ── 结论要点 ── */
  ol.findings{list-style:none;counter-reset:f;max-width:64ch}
  ol.findings li{counter-increment:f;position:relative;padding:16px 0 16px 46px;
    border-bottom:1px solid var(--grid);font-size:${FONT.body.size}px;line-height:1.8}
  ol.findings li:last-child{border-bottom:0}
  ol.findings li::before{content:counter(f,decimal-leading-zero);position:absolute;left:0;top:19px;
    font-family:${FONT.mono};font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--faint)}
  .tag{display:inline-flex;align-items:center;gap:5px;font-family:${FONT.mono};font-size:10.5px;
    font-weight:600;letter-spacing:.08em;padding:2px 8px;border-radius:3px;margin-right:9px;vertical-align:2px}
  .tag-crit{color:var(--crit);background:rgba(192,57,43,.10);border:1px solid rgba(192,57,43,.28)}
  .tag-warn{color:var(--warn);background:rgba(201,133,0,.10);border:1px solid rgba(201,133,0,.30)}
  .tag-good{color:var(--good);background:rgba(11,122,11,.15);border:1px solid rgba(11,122,11,.26)}
  .tag-mute{color:var(--muted);background:#EDECE6;border:1px solid var(--grid)}

  /* ── 指标带：1 hero + stat tiles（非对称，不是等分卡片墙）── */
  .kpi{display:grid;grid-template-columns:minmax(280px,1fr) 2fr;gap:44px;align-items:start}
  .hero-label{font-family:${FONT.mono};font-size:10.5px;letter-spacing:.14em;color:var(--muted);
    text-transform:uppercase;margin-bottom:14px}
  .hero-fig{font-family:${FONT.text};font-size:76px;font-weight:${FONT.value.weight};
    line-height:.94;letter-spacing:-.045em}
  .hero-fig .pct{font-size:34px;font-weight:500;letter-spacing:-.02em;margin-left:2px}
  .hero-sub{font-size:13px;color:var(--muted);margin-top:12px;line-height:1.7}
  /* meter：fill = 状态色，track = 同色相浅步（状态能跨整条读出） */
  .meter{position:relative;height:12px;border-radius:99px;background:rgba(11,122,11,.15);margin-top:18px}
  .meter-fill{height:100%;border-radius:99px;background:var(--good)}
  .meter-mark{position:absolute;top:-5px;bottom:-5px;width:0;border-left:1.5px dashed var(--muted)}
  .meter-mark span{position:absolute;left:5px;top:-2px;white-space:nowrap;
    font-family:${FONT.mono};font-size:9.5px;letter-spacing:.06em;color:var(--muted)}
  .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;padding-top:4px}
  .tile{border-top:1px solid var(--ink);padding-top:12px}
  .tile-label{font-family:${FONT.mono};font-size:10px;letter-spacing:.13em;color:var(--muted);text-transform:uppercase}
  .tile-val{font-family:${FONT.text};font-size:38px;font-weight:${FONT.value.weight};
    letter-spacing:-.03em;line-height:1.1;margin-top:8px}
  .tile-val small{font-size:15px;font-weight:500;color:var(--muted);letter-spacing:0;margin-left:3px}
  .tile-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:8px}
  .delta{font-family:${FONT.mono};font-size:11px;font-weight:600}
  .delta-good{color:var(--good)} .delta-bad{color:var(--crit)} .delta-flat{color:var(--muted)}

  /* ── 图卡：上规线分卡（纸面同底，不套盒；规线负责可辨识）── */
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px 40px}
  .card{background:var(--bg);border-top:1px solid var(--ink);border-radius:${SHAPE.cardRadius}px;
    padding:${SHAPE.cardPad}}
  .card.wide{grid-column:1/-1}
  h2{font-family:${FONT.display};font-weight:${FONT.fig.weight};font-size:${FONT.fig.size}px;
    letter-spacing:-.005em;margin-bottom:4px;line-height:1.35}
  .sub{font-size:${FONT.sub.size}px;color:var(--muted);margin-bottom:14px;line-height:1.65}
  .src{font-size:${FONT.src.size}px;color:var(--faint);margin-top:10px;letter-spacing:${FONT.src.spacing};
    font-weight:${FONT.src.weight};font-family:${FONT.mono};text-transform:uppercase}
  .ch{height:320px}
  /* 400×320 旧图型（半宽卡）：宽度必须锁住，否则通栏会把缩放推到 2.7x、
     7px 说明放大成 19px。560px → 缩放 ≈1.4x，最小字号渲染后约 8–10px。 */
  svg{width:100%;height:auto;display:block;overflow:visible}
  .card svg{max-width:560px;margin-inline:auto}
  svg text{font-family:${FONT.mono}}

  /* ── 全出血图（1080 宽新图型用）────────────────────────────
     新图型按 1080 viewBox 作图，字号即最终渲染字号，不得再被放大。
     旧图型走 .grid2 > .card，新图型走 .fig。                          */
  .fig{border-top:1px solid var(--ink);padding:18px 0 8px;margin:0 0 46px}
  .fig:last-child{margin-bottom:0}
  .fig h2{margin-bottom:4px}
  .fig svg{max-width:none}
  /* ECharts 图型用 .ch 容器（不是 svg）；全出血下给足高度 */
  .fig .ch{height:520px}
  .fig-legend{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:16px}
  .fig-legend .item{display:flex;align-items:center;gap:8px;font-size:12.5px}
  .fig-legend .chip{width:11px;height:11px;border-radius:2.5px;flex:none}
  .fig-legend .ico{font-family:${FONT.mono};font-size:10px;font-weight:600;line-height:1}
  .fig-legend .n{font-family:${FONT.mono};font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
  .fig-legend .p{font-family:${FONT.mono};font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}

  /* 数据表孪生：任何色编码都必须有等价的可读通路（默认折叠） */
  .tv{margin-top:14px}
  .tv > summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;
    font-family:${FONT.mono};font-size:10.5px;letter-spacing:.11em;color:var(--muted);text-transform:uppercase}
  .tv > summary::-webkit-details-marker{display:none}
  .tv > summary::before{content:"▸";font-size:9px;transition:transform .15s ease;display:inline-block}
  .tv[open] > summary::before{transform:rotate(90deg)}
  .tv > summary:hover{color:var(--ink)}

  /* ── 状态 / 严重度标记：色永不单独承载语义，必带 icon + label ── */
  .st{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;
    font-family:${FONT.mono};font-size:11px;font-weight:600;letter-spacing:.04em}
  .st i{width:8px;height:8px;border-radius:99px;flex:none;display:inline-block}
  .sev{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;font-size:12.5px}
  .sev i{width:10px;height:10px;border-radius:2px;flex:none;display:inline-block}

  /* ── 明细表：正文用阅读字号，数值列用等宽对齐 ── */
  table.data{width:100%;border-collapse:collapse;font-family:${FONT.text};font-size:13px}
  table.data th{text-align:left;font-family:${FONT.mono};font-weight:600;font-size:9.5px;letter-spacing:.12em;
    text-transform:uppercase;color:var(--muted);padding:0 16px 9px 0;border-bottom:1px solid var(--ink);white-space:nowrap}
  table.data td{padding:12px 16px 12px 0;border-bottom:1px solid var(--grid);vertical-align:top;line-height:1.55}
  table.data tr:hover td{background:rgba(28,28,26,.03)}
  table.data .num{font-family:${FONT.mono};font-variant-numeric:tabular-nums;white-space:nowrap}
  table.data .did{font-family:${FONT.mono};font-size:11.5px;font-weight:600;color:var(--muted);white-space:nowrap}

  /* ── 缺数占位卡 ── */
  .placeholder{border:1.5px dashed var(--faint);border-radius:${SHAPE.cardRadius}px;padding:26px 28px;
    display:grid;grid-template-columns:1fr auto;gap:26px;align-items:center}
  .placeholder h3{font-family:${FONT.display};font-size:19px;font-weight:600;margin-bottom:6px}
  .placeholder-need{font-size:13px;color:var(--muted);line-height:1.85}
  .btn{font-family:${FONT.mono};font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
    border:1.5px solid var(--ink);background:none;color:var(--ink);padding:11px 20px;border-radius:3px;
    cursor:pointer;white-space:nowrap;transition:background .16s ease,color .16s ease}
  .btn:hover{background:var(--ink);color:var(--bg)}

  /* ── 附录 / 页脚 ── */
  dl.dl-note{display:grid;grid-template-columns:130px 1fr;gap:8px 22px;font-size:13px;max-width:78ch}
  dl.dl-note dt{font-family:${FONT.mono};font-size:10px;letter-spacing:.12em;color:var(--faint);
    text-transform:uppercase;padding-top:4px}
  dl.dl-note dd{line-height:1.75}
  .colophon{margin-top:56px;padding-top:18px;border-top:2px solid var(--ink);
    display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;
    font-family:${FONT.mono};font-size:10px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}

  /* ── 打印 / PDF：A4，块不跨页断，色彩强制还原 ── */
  @page{size:A4;margin:16mm 14mm}
  @media print{
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{padding:0;font-size:10.5pt}
    .card,.kpi,table.data tr,.placeholder{break-inside:avoid}
    .sec{padding:22pt 0}
  }
  @media (max-width:860px){
    .grid2{grid-template-columns:1fr}
    .kpi{grid-template-columns:1fr}
    .tiles{grid-template-columns:1fr}
    .meta-grid{grid-template-columns:repeat(2,1fr)}
    .placeholder{grid-template-columns:1fr}
  }
  ` + MOTION.css;

  global.MONO = { INK, PAPER, MUTED, FAINT, GRID, L, LAD, DARK, STATUS, RAMP,
    FONT, SHAPE, MOTION, tipLight, tipDark,
    D2R, rnd, pol, sect, blob, barH, barV, el, txt, tip, obsReveal, eReveal, keep, DOC_CSS };
})(typeof window !== 'undefined' ? window : globalThis);
