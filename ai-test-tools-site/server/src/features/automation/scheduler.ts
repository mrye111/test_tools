/** P5 定时扫描器：分钟粒度检查 at_schedules，到点触发整集执行（同分钟不重复触发）。 */

import { logger } from "../../logger.js";
import { cronMatches } from "./cron.js";
import type { AutomationRepository } from "./types.js";

export type ScheduleScannerDeps = {
  repo: AutomationRepository;
  /** 到点回调：触发整集执行（失败继续语义由实现方保证）；异常不打断扫描。 */
  triggerListRun: (listId: string) => Promise<void>;
  /** 扫描间隔（默认 60s；测试可调小）。 */
  intervalMs?: number;
};

/** 启动扫描器；返回 stop（unref 定时器不阻止进程退出）。 */
export function startScheduleScanner(deps: ScheduleScannerDeps): () => void {
  const intervalMs = deps.intervalMs ?? 60_000;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const now = new Date();
    let schedules;
    try {
      schedules = await deps.repo.listSchedules();
    } catch (error) {
      logger.warn({ err: error }, "[automation] 定时扫描读取失败");
      return;
    }
    for (const schedule of schedules) {
      if (!schedule.enabled) continue;
      if (!cronMatches(schedule.cron, now)) continue;
      // 分钟级去重：本分钟已触发过（lastRunAt >= 分钟起点）则跳过，防间隔抖动重复触发
      const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
      if (schedule.lastRunAt && schedule.lastRunAt >= minuteStart.toISOString()) continue;
      await deps.repo
        .updateSchedule(schedule.id, { lastRunAt: new Date().toISOString() })
        .catch((error) => logger.warn({ err: error }, "[automation] 定时 lastRunAt 回写失败"));
      try {
        await deps.triggerListRun(schedule.listId);
        logger.info({ scheduleId: schedule.id, listId: schedule.listId, cron: schedule.cron }, "[automation] 定时触发整集执行");
      } catch (error) {
        logger.warn({ err: error, scheduleId: schedule.id }, "[automation] 定时触发整集执行失败");
      }
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
