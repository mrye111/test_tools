import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { logger } from "../../logger.js";

/** 本机浏览器未安装/未找到时抛出；路由据此返回 503 并提示浏览器打印兜底。 */
export class BrowserNotFoundError extends Error {
  constructor(message = "未找到本机 Chrome/Edge 浏览器，无法渲染 PDF；可改用浏览器打印（另存为 PDF）兜底") {
    super(message);
    this.name = "BrowserNotFoundError";
  }
}

/** 浏览器可执行文件候选路径（纯函数，便于测试）。env 优先级最高。 */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  if (env.CHROME_PATH) candidates.push(env.CHROME_PATH);
  if (platform === "win32") {
    const programFiles = [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]].filter(
      (v): v is string => Boolean(v),
    );
    for (const base of programFiles) {
      candidates.push(
        join(base, "Google", "Chrome", "Application", "chrome.exe"),
        join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge");
  }
  return candidates;
}

/** 探测本机 Chrome/Edge 可执行文件；找不到返回 null。 */
export function findBrowserExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const candidate of browserCandidates(process.platform, env)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 渲染报告 HTML 为 PDF。
 * 关键点：报告的 reveal 动画由 IntersectionObserver 驱动（滚入视野才渲染图表），
 * 因此打印前必须逐屏滚动触发全部图表，再回顶部输出。
 */
export async function renderReportPdf(html: string, env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const executablePath = findBrowserExecutable(env);
  if (!executablePath) {
    throw new BrowserNotFoundError();
  }

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
    });
    const page = await browser.newPage();
    // A4 宽度约 794px（96dpi），让打印布局与屏幕一致
    await page.setViewport({ width: 794, height: 1123 });
    // 动画强制终态（与报告 HTML 的 @media print / reduced-motion 契约咬合）
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    // 等 CDN（echarts/字体）静默；弱网超时不阻塞导出
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});

    // 逐屏滚动触发 obsReveal，再回顶部（字符串形式传入，避免服务端 TS 无 DOM lib 的报错）
    await page.evaluate(`(async () => {
      const step = window.innerHeight;
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    return Buffer.from(pdf);
  } catch (error) {
    if (error instanceof BrowserNotFoundError) throw error;
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "PDF 渲染失败");
    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}
