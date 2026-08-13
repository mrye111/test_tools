import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** 资源根：编译后位于 dist/src/features/report，需回退四级到包根再进 server/assets。 */
function assetsRoot(): string {
  // 源码运行（vitest）：server/src/features/report → 上三级到 server/
  // 编译运行（dist）：server/dist/src/features/report → 上四级到 server/
  const candidates = [
    join(here, "..", "..", "..", "assets"),
    join(here, "..", "..", "..", "..", "assets"),
  ];
  for (const dir of candidates) {
    try {
      readFileSync(join(dir, "lieflat-charts", "mono-tokens.js"));
      return dir;
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  throw new Error("未找到 server/assets 资源目录（lieflat-charts 未就位）");
}

let monoTokensCache: string | null = null;
const fragmentCache = new Map<string, string>();

/** mono-tokens.js 全文（风格唯一正本，内联进组装阶段 prompt）。 */
export function loadMonoTokens(): string {
  if (!monoTokensCache) {
    monoTokensCache = readFileSync(join(assetsRoot(), "lieflat-charts", "mono-tokens.js"), "utf8");
  }
  return monoTokensCache;
}

/** 按 catalog 编号读取图型片段（抽取自 gallery 的真实渲染代码）。 */
export function loadChartFragment(code: string): string {
  const cached = fragmentCache.get(code);
  if (cached) return cached;
  const text = readFileSync(join(assetsRoot(), "chart-fragments", `${code}.js`), "utf8");
  fragmentCache.set(code, text);
  return text;
}

/** 批量加载并去重。 */
export function loadChartFragments(codes: string[]): { code: string; text: string }[] {
  return [...new Set(codes)].map((code) => ({ code, text: loadChartFragment(code) }));
}

/** 测试专用：清空缓存。 */
export function resetAssetCaches(): void {
  monoTokensCache = null;
  fragmentCache.clear();
}
