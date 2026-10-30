import { describe, expect, it } from "vitest";
import { buildInsights } from "./insights.js";
import type { RunInsightRow } from "./types.js";

const NOW = new Date(2026, 9, 30, 12, 0, 0); // 2026-10-30 本地正午

function row(partial: Partial<RunInsightRow> & { createdAt: string }): RunInsightRow {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    caseNo: "ATC-001",
    title: "登录",
    engine: "auto",
    ...partial,
  };
}

describe("buildInsights", () => {
  it("空输入：趋势 14 天全空日，通过率/耗时为 null", () => {
    const out = buildInsights([], NOW);
    expect(out.trend).toHaveLength(14);
    expect(out.trend.every((p) => p.total === 0)).toBe(true);
    expect(out.summary).toEqual({ totalRuns: 0, finishedRuns: 0, passRate: null, avgDurationMs: null });
    expect(out.hotspots).toEqual([]);
    expect(out.engines.map((e) => e.count)).toEqual([0, 0]);
    expect(out.durations.map((d) => d.count)).toEqual([0, 0, 0, 0, 0]);
  });

  it("趋势按本地日归桶且含空日，窗口外的行不入桶但入总量", () => {
    const out = buildInsights(
      [
        row({ createdAt: "2026-10-30T01:00:00.000Z", verdict: "passed" }), // 本地 10-30
        row({ createdAt: "2026-10-29T02:00:00.000Z", verdict: "failed" }), // 本地 10-29
        row({ createdAt: "2025-01-01T02:00:00.000Z", verdict: "passed" }), // 窗口外
      ],
      NOW,
    );
    const today = out.trend[13]!;
    const yesterday = out.trend[12]!;
    expect(today).toMatchObject({ date: "10-30", total: 1, passed: 1 });
    expect(yesterday).toMatchObject({ date: "10-29", total: 1, failed: 1 });
    expect(out.summary.totalRuns).toBe(3); // 窗口外也计总量
  });

  it("通过率按有结论运行计算，保留 1 位小数", () => {
    const out = buildInsights(
      [
        row({ createdAt: "2026-10-30T01:00:00.000Z", verdict: "passed" }),
        row({ createdAt: "2026-10-30T02:00:00.000Z", verdict: "passed" }),
        row({ createdAt: "2026-10-30T03:00:00.000Z", verdict: "failed" }),
        row({ createdAt: "2026-10-30T04:00:00.000Z" }), // 无结论不进分母
      ],
      NOW,
    );
    expect(out.summary.finishedRuns).toBe(3);
    expect(out.summary.passRate).toBe(66.7);
  });

  it("引擎分布与耗时分桶（左闭右开，边界值归上界桶）", () => {
    const out = buildInsights(
      [
        row({ createdAt: "2026-10-30T01:00:00.000Z", engine: "auto", durationMs: 29_999 }),
        row({ createdAt: "2026-10-30T02:00:00.000Z", engine: "auto", durationMs: 30_000 }),
        row({ createdAt: "2026-10-30T03:00:00.000Z", engine: "visual", durationMs: 90_000 }),
        row({ createdAt: "2026-10-30T04:00:00.000Z", engine: "visual", durationMs: 280_000 }),
        row({ createdAt: "2026-10-30T05:00:00.000Z", engine: "visual", durationMs: 350_000 }),
        row({ createdAt: "2026-10-30T06:00:00.000Z", engine: "visual" }), // 无时长不入桶
      ],
      NOW,
    );
    expect(out.engines).toEqual([
      { engine: "auto", count: 2 },
      { engine: "visual", count: 4 },
    ]);
    expect(out.durations).toEqual([
      { label: "<30s", count: 1 },
      { label: "30s-1m", count: 1 },
      { label: "1-2m", count: 1 },
      { label: "2-5m", count: 1 },
      { label: ">5m", count: 1 },
    ]);
    expect(out.summary.avgDurationMs).toBe(Math.round((29_999 + 30_000 + 90_000 + 280_000 + 350_000) / 5));
  });

  it("失败热点按失败次数降序取前 8，total 含同用例全部运行", () => {
    const rows: RunInsightRow[] = [];
    for (let i = 0; i < 3; i += 1) {
      rows.push(row({ caseId: "case-a", caseNo: "ATC-001", title: "登录", verdict: "failed", createdAt: "2026-10-30T01:00:00.000Z" }));
    }
    rows.push(row({ caseId: "case-a", caseNo: "ATC-001", title: "登录", verdict: "passed", createdAt: "2026-10-30T01:00:00.000Z" }));
    rows.push(row({ caseId: "case-b", caseNo: "ATC-002", title: "下单", verdict: "failed", createdAt: "2026-10-30T01:00:00.000Z" }));
    rows.push(row({ caseId: "case-c", caseNo: "ATC-003", title: "从未失败", verdict: "passed", createdAt: "2026-10-30T01:00:00.000Z" }));
    for (let i = 0; i < 9; i += 1) {
      rows.push(row({ caseId: `filler-${i}`, caseNo: `ATC-1${i}`, title: `填充${i}`, verdict: "failed", createdAt: "2026-10-30T01:00:00.000Z" }));
    }
    const out = buildInsights(rows, NOW);
    expect(out.hotspots).toHaveLength(8);
    expect(out.hotspots[0]).toMatchObject({ caseId: "case-a", failCount: 3, total: 4 });
    expect(out.hotspots.map((h) => h.caseId)).not.toContain("case-c"); // 未失败不入榜
    expect(out.hotspots.map((h) => h.caseId)).not.toContain("filler-8"); // 截断到 8
  });
});
