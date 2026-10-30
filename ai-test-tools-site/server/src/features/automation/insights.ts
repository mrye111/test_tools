/** P6 Insights：从项目运行轻量行聚合四块指标（趋势/引擎/耗时/失败热点），纯函数可测。 */

import type { RunInsightRow } from "./types.js";

export type TrendPoint = {
  /** MM-DD（服务器本地日）。 */
  date: string;
  total: number;
  passed: number;
  partial: number;
  failed: number;
  aborted: number;
};

export type EngineSlice = { engine: "auto" | "visual"; count: number };

export type DurationBucket = { label: string; count: number };

export type FailureHotspot = {
  caseId: string;
  caseNo: string;
  title: string;
  failCount: number;
  total: number;
};

export type ProjectInsights = {
  summary: {
    totalRuns: number;
    /** 有结论（verdict 非空）的运行数——通过率分母。 */
    finishedRuns: number;
    /** 0-100，保留 1 位小数；无结论运行时为 null。 */
    passRate: number | null;
    avgDurationMs: number | null;
  };
  trend: TrendPoint[];
  engines: EngineSlice[];
  durations: DurationBucket[];
  hotspots: FailureHotspot[];
};

const TREND_DAYS = 14;
const HOTSPOT_TOP = 8;

const DURATION_BUCKETS: { label: string; maxMs: number | null }[] = [
  { label: "<30s", maxMs: 30_000 },
  { label: "30s-1m", maxMs: 60_000 },
  { label: "1-2m", maxMs: 120_000 },
  { label: "2-5m", maxMs: 300_000 },
  { label: ">5m", maxMs: null },
];

function dateKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function dayKeyOf(iso: string): string {
  return dateKey(new Date(iso));
}

export function buildInsights(rows: RunInsightRow[], now = new Date()): ProjectInsights {
  // 趋势：近 TREND_DAYS 个本地自然日（含空日），按天数减一倒推
  const buckets = new Map<string, TrendPoint>();
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    buckets.set(key, { date: key, total: 0, passed: 0, partial: 0, failed: 0, aborted: 0 });
  }

  const engineCount = new Map<"auto" | "visual", number>([
    ["auto", 0],
    ["visual", 0],
  ]);
  const durationCount = new Map<string, number>(DURATION_BUCKETS.map((b) => [b.label, 0]));
  const hotspotMap = new Map<string, FailureHotspot>();
  const caseTotals = new Map<string, number>();

  let finished = 0;
  let passed = 0;
  let durationSum = 0;
  let durationN = 0;

  for (const row of rows) {
    const point = buckets.get(dayKeyOf(row.createdAt));
    if (point) {
      point.total += 1;
      if (row.verdict === "passed") point.passed += 1;
      else if (row.verdict === "partial") point.partial += 1;
      else if (row.verdict === "failed") point.failed += 1;
      else if (row.verdict === "aborted") point.aborted += 1;
    }

    engineCount.set(row.engine, (engineCount.get(row.engine) ?? 0) + 1);

    if (typeof row.durationMs === "number" && row.durationMs >= 0) {
      durationSum += row.durationMs;
      durationN += 1;
      const bucket = DURATION_BUCKETS.find((b) => b.maxMs === null || row.durationMs! < b.maxMs);
      const label = bucket?.label ?? ">5m";
      durationCount.set(label, (durationCount.get(label) ?? 0) + 1);
    }

    if (row.verdict) {
      finished += 1;
      if (row.verdict === "passed") passed += 1;
    }
    if (row.caseId) {
      caseTotals.set(row.caseId, (caseTotals.get(row.caseId) ?? 0) + 1);
      if (row.verdict === "failed") {
        const found = hotspotMap.get(row.caseId) ?? {
          caseId: row.caseId,
          caseNo: row.caseNo,
          title: row.title,
          failCount: 0,
          total: 0,
        };
        found.failCount += 1;
        hotspotMap.set(row.caseId, found);
      }
    }
  }

  for (const [caseId, entry] of hotspotMap) {
    entry.total = caseTotals.get(caseId) ?? entry.failCount;
  }

  return {
    summary: {
      totalRuns: rows.length,
      finishedRuns: finished,
      passRate: finished > 0 ? Math.round((passed / finished) * 1000) / 10 : null,
      avgDurationMs: durationN > 0 ? Math.round(durationSum / durationN) : null,
    },
    trend: [...buckets.values()],
    engines: [
      { engine: "auto", count: engineCount.get("auto") ?? 0 },
      { engine: "visual", count: engineCount.get("visual") ?? 0 },
    ],
    durations: DURATION_BUCKETS.map((b) => ({ label: b.label, count: durationCount.get(b.label) ?? 0 })),
    hotspots: [...hotspotMap.values()]
      .sort((a, b) => b.failCount - a.failCount || b.total - a.total)
      .slice(0, HOTSPOT_TOP),
  };
}
