import { describe, expect, it, vi } from "vitest";
import { MemoryAutomationRepository } from "./memory-repository.js";
import { startScheduleScanner } from "./scheduler.js";

/** 每分钟都命中的 cron（tick 即触发）。 */
const EVERY_MINUTE = "* * * * *";

describe("startScheduleScanner", () => {
  it("到点触发整集执行并回写 lastRunAt；禁用/未到点不触发", async () => {
    const repo = new MemoryAutomationRepository();
    const list = await repo.createTestList({ name: "回归集" });
    const due = await repo.createSchedule({ listId: list.id, cron: EVERY_MINUTE });
    const disabled = await repo.createSchedule({ listId: list.id, cron: EVERY_MINUTE, enabled: false });
    const later = await repo.createSchedule({ listId: list.id, cron: "59 23 31 12 *" });
    const triggerListRun = vi.fn(async () => undefined);
    const stop = startScheduleScanner({ repo, triggerListRun, intervalMs: 20 });

    await vi.waitFor(() => expect(triggerListRun).toHaveBeenCalledWith(list.id));
    stop();

    const schedules = await repo.listSchedules(list.id);
    expect(schedules.find((s) => s.id === due.id)?.lastRunAt).toBeTruthy();
    expect(schedules.find((s) => s.id === disabled.id)?.lastRunAt).toBeUndefined();
    expect(schedules.find((s) => s.id === later.id)?.lastRunAt).toBeUndefined();
    expect(triggerListRun).toHaveBeenCalledTimes(1);
  });

  it("同分钟不重复触发（lastRunAt 已在本分钟内）", async () => {
    const repo = new MemoryAutomationRepository();
    const list = await repo.createTestList({ name: "回归集" });
    await repo.createSchedule({ listId: list.id, cron: EVERY_MINUTE, enabled: true });
    await repo.updateSchedule((await repo.listSchedules(list.id))[0]!.id, { lastRunAt: new Date().toISOString() });
    const triggerListRun = vi.fn(async () => undefined);
    const stop = startScheduleScanner({ repo, triggerListRun, intervalMs: 20 });

    await new Promise((resolve) => setTimeout(resolve, 120));
    stop();
    expect(triggerListRun).not.toHaveBeenCalled();
  });

  it("单项触发异常不打断其余定时", async () => {
    const repo = new MemoryAutomationRepository();
    const listA = await repo.createTestList({ name: "A" });
    const listB = await repo.createTestList({ name: "B" });
    await repo.createSchedule({ listId: listA.id, cron: EVERY_MINUTE });
    await repo.createSchedule({ listId: listB.id, cron: EVERY_MINUTE });
    const triggerListRun = vi.fn(async (listId: string) => {
      if (listId === listA.id) throw new Error("boom");
    });
    const stop = startScheduleScanner({ repo, triggerListRun, intervalMs: 20 });

    await vi.waitFor(() => expect(triggerListRun).toHaveBeenCalledWith(listB.id));
    stop();
    expect(triggerListRun).toHaveBeenCalledTimes(2);
  });
});
