import { describe, expect, it } from "vitest";
import { validateReportHtml } from "./validate.js";

/** 一张能通过全部校验的最小五段式报告 HTML。 */
function validHtml(extra: string = ""): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>报告</title></head>
<body>
<div class="sheet">
<header class="masthead">
  <h1 class="report-title">本轮通过率 92%</h1>
  <p class="verdict"><span class="stamp stamp-good">通过</span><span>核心链路达标</span></p>
</header>
<section class="sec">
  <h2 class="sec-title">结论与建议</h2>
  <ol class="findings"><li><span class="tag tag-good">● 达标</span>核心链路无阻塞</li></ol>
</section>
<section class="sec">
  <h2 class="sec-title">执行情况</h2>
  <div class="grid2">
    <div class="card">
      <h2>本轮通过率 92%</h2>
      <div class="sub">1 tick = 1% · 功能用例 · 第一轮</div>
      <svg id="c1" viewBox="0 0 400 320"></svg>
      <div class="src">TICK GAUGE · 用例执行 · 禅道导出</div>
    </div>
    ${extra}
  </div>
</section>
</div>
<footer class="colophon"><span>NexusKit</span></footer>
<script>const D = [92];</script>
</body>
</html>`;
}

describe("报告 HTML 静态校验链", () => {
  it("合法五段式 HTML 通过全部校验", () => {
    const issues = validateReportHtml(validHtml(), {
      requireHonesty: true,
      sourceText: "执行 100 条通过 92 条",
      selection: { data: [92] },
    });
    expect(issues).toEqual([]);
  });

  it("结构：缺 .src 来源行 / 缺图容器被检出", () => {
    const bad = `<div class="card"><h2>标题</h2><div class="sub">副</div></div>`;
    const issues = validateReportHtml(validHtml(bad));
    expect(issues.some((i) => i.rule === "structure" && i.message.includes(".src"))).toBe(true);
    expect(issues.some((i) => i.rule === "structure" && i.message.includes("图容器"))).toBe(true);
  });

  it("结构：缺报头 / 缺结论清单 / 缺页脚被检出", () => {
    const bare = `<!doctype html><html><body>
<div class="grid2"><div class="card"><h2>标题</h2><div class="sub">副</div><svg id="x"></svg><div class="src">S</div></div></div>
</body></html>`;
    const messages = validateReportHtml(bare).filter((i) => i.rule === "structure").map((i) => i.message);
    expect(messages.some((m) => m.includes(".masthead"))).toBe(true);
    expect(messages.some((m) => m.includes(".findings"))).toBe(true);
    expect(messages.some((m) => m.includes(".colophon"))).toBe(true);
  });

  it("结构：没有任何图卡被检出", () => {
    const issues = validateReportHtml(validHtml().replace(/<div class="grid2">[\s\S]*?<\/section>/, "</section>"));
    expect(issues.some((i) => i.rule === "structure" && i.message.includes(".card"))).toBe(true);
  });

  it("结构：.hero-fig 超过一个被检出（全篇只允许一个 hero 数字）", () => {
    const two = `<div class="kpi"><div class="hero-fig">1</div><div class="hero-fig">2</div></div>`;
    const issues = validateReportHtml(validHtml(two));
    expect(issues.some((i) => i.rule === "structure" && i.message.includes("hero 数字"))).toBe(true);
  });

  it("结构：恰好一个 .hero-fig 放行", () => {
    const one = `<div class="kpi"><div class="hero-fig">92</div></div>`;
    expect(validateReportHtml(validHtml(one)).filter((i) => i.rule === "structure")).toEqual([]);
  });

  it("色彩：白名单外 hex 被检出", () => {
    const issues = validateReportHtml(validHtml().replace("<svg", `<svg color="#ff0000"`));
    expect(issues.some((i) => i.rule === "color" && i.message.includes("#ff0000"))).toBe(true);
  });

  it("色彩：rgba 绕过同样被检出（只扫 hex 拦不住它）", () => {
    const issues = validateReportHtml(validHtml().replace("<svg", `<svg style="fill:rgba(255,0,0,.5)"`));
    expect(issues.some((i) => i.rule === "color" && i.message.includes("255,0,0"))).toBe(true);
  });

  it("色彩：Mono 灰阶与语义状态色放行（含 rgba 浅底）", () => {
    const good = validHtml().replace(
      "<svg",
      `<svg color="#0B7A0B" stroke="#C0392B" fill="#C98500" data-x="#1C1C1A" style="background:rgba(11,122,11,.15)"`,
    );
    expect(validateReportHtml(good).filter((i) => i.rule === "color")).toEqual([]);
  });

  it("脚本：内联脚本语法错误被检出且不执行", () => {
    const issues = validateReportHtml(validHtml().replace("const D = [92];", "const D = [92;"));
    expect(issues.some((i) => i.rule === "script")).toBe(true);
  });

  it("脚本：运行时错误同样被检出（语法检查只解析，抓不到未定义变量）", () => {
    const boom = validHtml().replace("const D = [92];", "const D = [92]; const x = notDefined;");
    const issues = validateReportHtml(boom);
    expect(issues.some((i) => i.rule === "script" && i.message.includes("执行失败"))).toBe(true);
  });

  it("脚本：可执行的脚本不误报", () => {
    const ok = validHtml().replace("const D = [92];", "const D = [92]; const x = D.map((v) => v + 1);");
    expect(validateReportHtml(ok).filter((i) => i.rule === "script")).toEqual([]);
  });

  it("外链：白名单外链接被检出，echarts CDN 与 Google Fonts 放行", () => {
    const bad = validHtml().replace("</head>", `<script src="https://evil.example.com/x.js"></script></head>`);
    expect(validateReportHtml(bad).some((i) => i.rule === "external")).toBe(true);

    const good = validHtml().replace(
      "</head>",
      `<script src="https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@600&display=swap" rel="stylesheet"></head>`,
    );
    expect(validateReportHtml(good).filter((i) => i.rule === "external")).toEqual([]);
  });

  const placeholder = (body: string) =>
    `<div class="placeholder" data-missing="trend"><div><h3>轮次对比</h3>${body}</div></div>`;

  it("占位卡：内含 svg 被检出", () => {
    const issues = validateReportHtml(validHtml(placeholder(`<svg id="x"></svg>`)));
    expect(issues.some((i) => i.rule === "placeholder" && i.message.includes("svg"))).toBe(true);
  });

  it("占位卡：缺补录按钮被检出", () => {
    const issues = validateReportHtml(validHtml(placeholder(`<p class="placeholder-need">需要：每日缺陷数</p>`)));
    expect(issues.some((i) => i.rule === "placeholder" && i.message.includes("补录按钮"))).toBe(true);
  });

  it("占位卡：纯文字 + 补录按钮放行", () => {
    const ok = placeholder(
      `<p class="placeholder-need">需要：每日缺陷数</p>
       <button onclick="parent.postMessage({type:'nexus-report-supplement',missing:'trend'},'*')">补录数据</button>`,
    );
    expect(validateReportHtml(validHtml(ok)).filter((i) => i.rule === "placeholder" || i.rule === "structure")).toEqual([]);
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
