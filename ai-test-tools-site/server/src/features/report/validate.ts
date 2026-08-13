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

/** Mono 灰阶 + wire 预设的合法色值（小写）。 */
const COLOR_ALLOWLIST = new Set([
  // Mono 主色
  "#1c1c1a", "#f0efeb", "#8f8e88", "#c6c5bf", "#deddd6",
  // Mono ladder
  "#4a4944", "#6a6963", "#b0afa9", "#d8d7d1",
  // 暗卡
  "#2e2d29", "#2a2925", "#55554f", "#dcdad2", "#c9c7bd", "#b3b0a4",
  // wire 预设
  "#f0f0ee", "#1f1e1c", "#22211f", "#8f8e86", "#f5572f",
]);

const EXTERNAL_HOST_ALLOWLIST = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

/** 规则 1：结构四件套——每个 .card 必须有 h2 / .sub / .src；非占位卡必须有图容器。 */
function checkStructure(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const chunks = html.split(/<div class="card[ "]/).slice(1);
  if (chunks.length === 0) {
    issues.push({ rule: "structure", message: "HTML 中没有任何 .card 卡片" });
    return issues;
  }
  chunks.forEach((chunk, index) => {
    const label = `第 ${index + 1} 张卡片`;
    if (!/<h2[\s>]/.test(chunk)) issues.push({ rule: "structure", message: `${label}缺少 <h2> 标题` });
    if (!/class="sub"/.test(chunk)) issues.push({ rule: "structure", message: `${label}缺少 .sub 副标题` });
    if (!/class="src"/.test(chunk)) issues.push({ rule: "structure", message: `${label}缺少 .src 来源行` });
    const isPlaceholder = /card-placeholder/.test(chunk) || /data-missing/.test(chunk);
    if (!isPlaceholder && !/<svg[\s>]/.test(chunk) && !/<canvas[\s>]/.test(chunk) && !/class="ch"/.test(chunk)) {
      issues.push({ rule: "structure", message: `${label}缺少图容器（svg / canvas / .ch）` });
    }
  });
  return issues;
}

/** 规则 2：单一色彩系统——hex 色值全部命中 Mono/wire 白名单。 */
function checkColors(html: string): ValidationIssue[] {
  const found = html.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const offenders = [...new Set(found.map((c) => c.toLowerCase()))].filter((c) => !COLOR_ALLOWLIST.has(c));
  if (offenders.length > 0) {
    return [{ rule: "color", message: `出现非 Mono/wire 白名单色值：${offenders.join("、")}（仅允许 Mono 灰阶与 wire 预设色）` }];
  }
  return [];
}

/** 规则 3：内联脚本语法检查（不执行）。 */
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

/** 规则 5：缺数占位卡不得包含任何真实图形。 */
function checkPlaceholders(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const chunks = html.split(/<div class="card[ "]/).slice(1);
  chunks.forEach((chunk, index) => {
    const isPlaceholder = /data-missing/.test(chunk);
    if (!isPlaceholder) return;
    if (/<svg[\s>]/.test(chunk) || /<canvas[\s>]/.test(chunk) || /echarts\.init/.test(chunk)) {
      issues.push({ rule: "placeholder", message: `第 ${index + 1} 张为缺数占位卡，不得包含 svg/canvas/echarts 实例` });
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

/** 执行全部校验规则，返回问题清单（空数组 = 通过）。 */
export function validateReportHtml(html: string, options: ValidateOptions = {}): ValidationIssue[] {
  return [
    ...checkStructure(html),
    ...checkColors(html),
    ...checkScripts(html),
    ...checkExternalLinks(html),
    ...checkPlaceholders(html),
    ...checkHonesty(html, options),
  ];
}
