/**
 * 报告 HTML 静态校验链（纯函数，无 IO）。
 * 生成与追改共用；失败项喂给修复重试，重试仍失败则降级错误提示。
 */

export interface ValidationIssue {
  rule: string;
  message: string;
}

export interface ValidateOptions {
  /** 定性输入时开启：HTML 中的百分比数字必须能溯源到素材或选型数据 */
  requireHonesty?: boolean;
  /** 原始素材文本（诚实校验的溯源池） */
  sourceText?: string;
  /** 阶段一选型 JSON（诚实校验的溯源池） */
  selection?: unknown;
}

/**
 * 语义状态色（reserved：只编码状态，不编码量/序/系列）。
 * 段序固定 通过 | 阻塞 | 失败 | 跳过 —— 绿红不得相邻（红绿色盲下 ΔE 仅 4.1）。
 */
const STATUS_COLORS = new Set(["#0b7a0b", "#c98500", "#c0392b"]);

/** 中性灰阶的饱和度上限（HSV S）：lieflat 的微色阶最高约 12%（暗卡 #2A2925）。 */
const NEUTRAL_SATURATION = 0.13;

/**
 * 色彩铁律：一切中性灰阶（Mono 全族，含暗卡与片段微色阶）放行；
 * 彩色只允许三个语义状态色。不枚举灰阶白名单——片段的微色阶会随抽取漂移，
 * 枚举过一遍就会漏（#CFCEC7 / #A8A7A0 / #D8D6CE 等均未在旧白名单内）。
 */
function isAllowedColor(hex: string): boolean {
  const h = hex.toLowerCase();
  if (STATUS_COLORS.has(h)) return true;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  if (max === 0) return true; // 纯黑
  return (max - Math.min(r, g, b)) / max <= NEUTRAL_SATURATION;
}

const EXTERNAL_HOST_ALLOWLIST = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

/**
 * 规则 1：文档解剖（五段式）+ 图卡四件套。
 * 报告是文档不是卡片墙：报头 → 结论 → 指标 → 分章图卡 → 明细 → 页脚。
 */
function checkStructure(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ① 报头：身份 + 结论式大标题
  if (!/class="masthead"/.test(html)) {
    issues.push({ rule: "structure", message: "缺少报头 .masthead（报告必须有身份与结论式大标题）" });
  } else if (!/class="report-title"/.test(html)) {
    issues.push({ rule: "structure", message: "报头缺少 .report-title 结论式大标题" });
  }

  // ② 结论：先给判断再给图
  const findings = html.match(/<ol class="findings">([\s\S]*?)<\/ol>/);
  if (!findings) {
    issues.push({ rule: "structure", message: "缺少结论清单 .findings（报告必须先给结论再给图）" });
  } else if (!/<li[\s>]/.test(findings[1])) {
    issues.push({ rule: "structure", message: ".findings 里没有任何 <li> 结论条" });
  }

  // ③ 指标：hero 全篇至多一个（dataviz：一屏只允许一个 hero 数字）
  const heroes = (html.match(/class="hero-fig"/g) ?? []).length;
  if (heroes > 1) {
    issues.push({ rule: "structure", message: `.hero-fig 出现 ${heroes} 次，全篇只允许一个 hero 数字` });
  }

  // ④ 图卡四件套（.fig 全出血图 与 .card 半宽卡 都要）
  const chunks = [...html.split(/<div class="card[ "]/).slice(1), ...html.split(/<figure class="fig[ "]/).slice(1)];
  if (chunks.length === 0) {
    issues.push({ rule: "structure", message: "HTML 中没有任何图卡（.fig / .card）" });
  }
  chunks.forEach((chunk, index) => {
    const label = `第 ${index + 1} 张图卡`;
    if (!/<h2[\s>]/.test(chunk)) issues.push({ rule: "structure", message: `${label}缺少 <h2> 标题` });
    if (!/class="sub"/.test(chunk)) issues.push({ rule: "structure", message: `${label}缺少 .sub 副标题` });
    if (!/class="src"/.test(chunk)) issues.push({ rule: "structure", message: `${label}缺少 .src 来源行` });
    const isPlaceholder = /card-placeholder/.test(chunk) || /data-missing/.test(chunk);
    if (!isPlaceholder && !/<svg[\s>]/.test(chunk) && !/<canvas[\s>]/.test(chunk) && !/class="ch"/.test(chunk)) {
      issues.push({ rule: "structure", message: `${label}缺少图容器（svg / canvas / .ch）` });
    }
  });

  // ⑤ 页脚：口径与生成信息
  if (!/class="colophon"/.test(html)) {
    issues.push({ rule: "structure", message: "缺少页脚 .colophon（报告必须交代口径与生成信息）" });
  }
  return issues;
}

/**
 * 规则 2：单一色彩系统——hex 与 rgb/rgba 通道都必须命中白名单。
 * rgb/rgba 同样要查：只扫 hex 的话 `rgba(255,0,0,.5)` 可直接绕过色彩纪律。
 * alpha 不受限（浅底/描边需要），但色相必须来自白名单。
 */
function checkColors(html: string): ValidationIssue[] {
  const offenders = new Set<string>();

  for (const m of html.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
    const c = m.toLowerCase();
    if (!isAllowedColor(c)) offenders.add(c);
  }
  for (const m of html.matchAll(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/gi)) {
    const hex =
      "#" +
      [m[1], m[2], m[3]]
        .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
        .join("");
    if (!isAllowedColor(hex)) offenders.add(`${m[0]}（≈${hex}）`);
  }

  if (offenders.size > 0) {
    return [{
      rule: "color",
      message: `出现非 Mono 灰阶 / 语义状态色的色值：${[...offenders].join("、")}（彩色只允许 STATUS 三色，其余一律中性灰阶）`,
    }];
  }
  return [];
}

/**
 * 规则 3：内联脚本语法检查（不执行）。
 * 注：脚本若因内容里带 script 闭合序列被 HTML 解析器提前截断，截断处的块注释
 * 往往未闭合，new Function 会直接抛语法错——本规则即可检出。
 */
function checkScripts(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    const code = match[1].trim();
    if (!code) return;
    try {
      new Function(code);
    } catch (error) {
      issues.push({
        rule: "script",
        message: `第 ${index + 1} 个内联脚本语法错误：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
  return issues;
}

/** 规则 4：外链白名单——仅 echarts CDN 与 Google Fonts。 */
function checkExternalLinks(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const links = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  for (const url of links) {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      issues.push({ rule: "external", message: `非法外链 URL：${url}` });
      continue;
    }
    if (!EXTERNAL_HOST_ALLOWLIST.includes(host)) {
      issues.push({ rule: "external", message: `外链 ${url} 不在白名单（仅允许 ${EXTERNAL_HOST_ALLOWLIST.join(" / ")}）` });
    }
  }
  return issues;
}

/** 取 marker 起始处所在 <div> 的完整块（按 div 开合配对，不用固定切片）。 */
function divBlockAt(html: string, markerIndex: number): string {
  const open = html.lastIndexOf("<div", markerIndex);
  if (open < 0) return html.slice(markerIndex);
  let depth = 0;
  for (const m of html.slice(open).matchAll(/<\/?div\b[^>]*>/g)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(open, open + m.index + m[0].length);
  }
  return html.slice(open);
}

/**
 * 规则 5：缺数占位卡——不得包含任何真实图形，且必须带补录按钮（postMessage 桥接宿主补数入口）。
 * 占位块按 data-missing 定位，逐块取其所在 <div> 全文。
 */
function checkPlaceholders(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const marks = [...html.matchAll(/data-missing="/g)];
  marks.forEach((mark, index) => {
    const label = `第 ${index + 1} 张缺数占位卡`;
    const block = divBlockAt(html, mark.index ?? 0);
    if (/<svg[\s>]/.test(block) || /<canvas[\s>]/.test(block) || /echarts\.init/.test(block)) {
      issues.push({ rule: "placeholder", message: `${label}不得包含 svg/canvas/echarts 实例` });
    }
    if (!/nexus-report-supplement/.test(block)) {
      issues.push({ rule: "placeholder", message: `${label}缺少补录按钮（需 postMessage {type:'nexus-report-supplement'}）` });
    }
  });
  return issues;
}

/** 从素材与选型中提取全部数字（归一化后），作为百分比溯源池。 */
function collectTraceableNumbers(sourceText: string, selection: unknown): Set<string> {
  const pool = new Set<string>();
  const harvest = (text: string) => {
    for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
      pool.add(String(Number(m[0])));
    }
  };
  harvest(sourceText);
  if (selection !== undefined) {
    harvest(JSON.stringify(selection));
  }
  return pool;
}

/**
 * 规则 6：诚实校验——定性输入时，卡片标题（结论句）中的百分比必须可溯源。
 * 只扫 h2：副标题允许携带单位注释（如"1 tick = 1%"），不构成数据断言。
 */
function checkHonesty(html: string, options: ValidateOptions): ValidationIssue[] {
  if (!options.requireHonesty) return [];
  const pool = collectTraceableNumbers(options.sourceText ?? "", options.selection);
  const headlines = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " "));
  const issues: ValidationIssue[] = [];
  for (const headline of headlines) {
    for (const m of headline.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
      const value = String(Number(m[1]));
      if (!pool.has(value)) {
        issues.push({ rule: "honesty", message: `标题中的百分比 ${m[1]}% 无法溯源到素材或选型数据，疑似编造指标` });
      }
    }
  }
  // 去重（同一数字多处出现只报一次）
  const seen = new Set<string>();
  return issues.filter((i) => {
    if (seen.has(i.message)) return false;
    seen.add(i.message);
    return true;
  });
}

/**
 * 规则 7：脚本可执行性检查。
 * new Function 只解析不运行 —— 数据形状错、TDZ、未定义变量全都漏网
 * （实测连踩四个：__DATA__.map 形状不符、FILL 先用后声明、D/val 未定义）。
 * 这里用最小 DOM 桩把脚本真跑一遍：obsReveal 立即触发绘图回调，能画出来才算过。
 */
function checkScriptExecution(html: string): ValidationIssue[] {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (scripts.length === 0) return [];

  // 记录型 SVG/DOM 桩：只收不画，属性写进 attrs，子节点计数即可
  const makeNode = (tag: string): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      tagName: tag,
      children: [] as unknown[],
      style: {},
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: unknown) {
        (node.attrs as Record<string, string>)[k] = String(v);
      },
      appendChild(c: unknown) {
        (node.children as unknown[]).push(c);
        return c;
      },
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: 1080, height: 400, x: 0, y: 0 }),
      set innerHTML(_v: string) {
        (node.children as unknown[]).length = 0;
      },
    };
    return node;
  };

  const nodes = new Map<string, Record<string, unknown>>();
  const docStub = {
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
    createElement: (tag: string) => makeNode(tag),
    getElementById: (id: string) => {
      if (!nodes.has(id)) nodes.set(id, makeNode("svg"));
      return nodes.get(id);
    },
    head: makeNode("head"),
    body: makeNode("body"),
  };
  const winStub: Record<string, unknown> = { document: docStub };
  // obsReveal 用 IntersectionObserver 触发绘图：这里立刻判定为可见
  class IOStub {
    private readonly cb: (entries: { isIntersecting: boolean; target: unknown }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean; target: unknown }[]) => void) {
      this.cb = cb;
    }
    observe(target: unknown) {
      this.cb([{ isIntersecting: true, target }]);
    }
    disconnect() {}
  }
  const echartsStub = {
    getInstanceByDom: () => null,
    init: () => ({ setOption() {}, clear() {}, resize() {}, dispose() {} }),
  };

  const issues: ValidationIssue[] = [];
  try {
    // 第一段：mono-tokens IIFE，把 MONO 挂到 window。
    // echarts 必须注入到这一层 —— eReveal 是这里的闭包，自由变量按它自己的作用域链解析。
    new Function("window", "globalThis", "document", "IntersectionObserver", "echarts", scripts[0])(
      winStub, winStub, docStub, IOStub, echartsStub,
    );
    const MONO = winStub.MONO as Record<string, unknown> | undefined;
    // 其余段：解构 + 各图型渲染代码。MONO 缺失会在解构处抛错，同样被本规则接住。
    for (const code of scripts.slice(1)) {
      new Function("MONO", "document", "window", "echarts", code)(MONO, docStub, winStub, echartsStub);
    }
  } catch (error) {
    issues.push({
      rule: "script",
      message: `内联脚本执行失败（图会画不出来）：${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return issues;
}

/** 执行全部校验规则，返回问题清单（空数组 = 通过）。 */
export function validateReportHtml(html: string, options: ValidateOptions = {}): ValidationIssue[] {
  return [
    ...checkStructure(html),
    ...checkColors(html),
    ...checkScripts(html),
    ...checkScriptExecution(html),
    ...checkExternalLinks(html),
    ...checkPlaceholders(html),
    ...checkHonesty(html, options),
  ];
}
