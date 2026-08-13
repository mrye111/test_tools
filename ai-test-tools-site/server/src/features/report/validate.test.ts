import { describe, expect, it } from "vitest";
import { validateReportHtml } from "./validate.js";

/** 一张能通过全部校验的最小报告 HTML。 */
function validHtml(extra: string = ""): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>报告</title></head>
<body>
<div class="grid2">
<div class="card">
<h2>本轮通过率 92%</h2>
<div class="sub">1 tick = 1% · 功能用例 · 第一轮</div>
<svg id="c1" viewBox="0 0 400 320"></svg>
<div class="src">TICK GAUGE · 用例执行 · 禅道导出</div>
</div>
${extra}
</div>
<script>const D = [92];</script>
</body>
</html>`;
}

describe("报告 HTML 静态校验链", () => {
  it("合法 HTML 通过全部校验", () => {
    const issues = validateReportHtml(validHtml(), {
      requireHonesty: true,
      sourceText: "执行 100 条通过 92 条",
      selection: { data: [92] },
    });
    expect(issues).toEqual([]);
  });

  it("结构：缺 .src 来源行 / 缺图容器被检出", () => {
    const html = `<!doctype html><html><body>
<div class="card"><h2>标题</h2><div class="sub">副</div></div>
</body></html>`;
    const issues = validateReportHtml(html);
    expect(issues.some((i) => i.rule === "structure" && i.message.includes(".src"))).toBe(true);
    expect(issues.some((i) => i.rule === "structure" && i.message.includes("图容器"))).toBe(true);
  });

  it("结构：没有任何卡片被检出", () => {
    const issues = validateReportHtml("<!doctype html><html><body>nothing</body></html>");
    expect(issues.some((i) => i.rule === "structure")).toBe(true);
  });

  it("色彩：白名单外色值被检出", () => {
    const issues = validateReportHtml(validHtml().replace("<svg", `<svg color="#ff0000"`));
    expect(issues.some((i) => i.rule === "color" && i.message.includes("#ff0000"))).toBe(true);
  });

  it("色彩：Mono/wire 白名单色值放行", () => {
    const issues = validateReportHtml(validHtml().replace("<svg", `<svg color="#F5572F" fill="#1C1C1A"`));
    expect(issues.filter((i) => i.rule === "color")).toEqual([]);
  });

  it("脚本：内联脚本语法错误被检出且不执行", () => {
    const issues = validateReportHtml(validHtml().replace("const D = [92];", "const D = [92;"));
    expect(issues.some((i) => i.rule === "script")).toBe(true);
  });

  it("外链：白名单外链接被检出，echarts CDN 与 Google Fonts 放行", () => {
    const bad = validHtml().replace("</head>", `<script src="https://evil.example.com/x.js"></script></head>`);
    expect(validateReportHtml(bad).some((i) => i.rule === "external")).toBe(true);

    const good = validHtml().replace(
      "</head>",
      `<script src="https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@700&display=swap" rel="stylesheet"></head>`,
    );
    expect(validateReportHtml(good).filter((i) => i.rule === "external")).toEqual([]);
  });

  it("占位卡：data-missing 卡内含 svg 被检出，纯文字占位放行", () => {
    const badPlaceholder = `<div class="card card-placeholder" data-missing="trend">
<h2>趋势</h2><div class="sub">补数据后可解锁</div><svg id="x"></svg><div class="src">PLACEHOLDER</div></div>`;
    expect(validateReportHtml(validHtml(badPlaceholder)).some((i) => i.rule === "placeholder")).toBe(true);

    const goodPlaceholder = `<div class="card card-placeholder" data-missing="trend">
<h2>趋势</h2><div class="sub">补数据后可解锁</div><p class="placeholder-need">需要：每日缺陷数</p><div class="src">PLACEHOLDER</div></div>`;
    const issues = validateReportHtml(validHtml(goodPlaceholder));
    expect(issues.filter((i) => i.rule === "placeholder" || i.rule === "structure")).toEqual([]);
  });

  it("诚实：定性输入时无法溯源的百分比被检出", () => {
    const issues = validateReportHtml(validHtml(), {
      requireHonesty: true,
      sourceText: "测试了登录功能，没有发现严重问题",
      selection: { data: [] },
    });
    expect(issues.some((i) => i.rule === "honesty" && i.message.includes("92%"))).toBe(true);
  });

  it("诚实：CSV 输入不启用百分比溯源", () => {
    const issues = validateReportHtml(validHtml(), { requireHonesty: false });
    expect(issues.filter((i) => i.rule === "honesty")).toEqual([]);
  });
});
