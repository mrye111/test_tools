import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLoadTestRepository } from "./repository.js";
import { RunManager, extractSummary, type LoadTestEvent } from "./run-manager.js";
import type { K6Runner, K6RunSpec, K6RunResult } from "./k6-runner.js";
import type { LoadTestProject } from "./types.js";

/** 可控假 runner：exitCode 可配，stop 后按 stopExitCode 收尾 */
class FakeRunner implements K6Runner {
  specs: K6RunSpec[] = [];
  exitCode = 0;
  stopExitCode = -1;
  logs = ["running (0m01.0s)", "checks_succeeded...: 100.00% 42 out of 42", "iterations.........: 42 1.0/s"];
  private stops = new Set<string>();

  async start(spec: K6RunSpec, onLog: (line: string) => void): Promise<K6RunResult> {
    this.specs.push(spec);
    for (const line of this.logs) onLog(line);
    return { exitCode: this.stops.has(spec.runId) ? this.stopExitCode : this.exitCode };
  }

  stop(runId: string): void {
    this.stops.add(runId);
  }
}

const BASE_PROJECT: LoadTestProject = {
  id: "ltp_test",
  name: "问卷系统",
  description: "",
  targetBaseUrl: "https://example.com/api",
  scriptSource: "export default function () {}",
  payloadTemplate: '{"a":1}',
  envVars: { API_BASE: "https://example.com/api", STAGES: "10s:2,5s:0" },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("RunManager", () => {
  let repo: MemoryLoadTestRepository;
  let runner: FakeRunner;
  let manager: RunManager;
  let workDir: string;

  beforeEach(async () => {
    repo = new MemoryLoadTestRepository();
    runner = new FakeRunner();
    workDir = await mkdtemp(join(tmpdir(), "loadtest-"));
    manager = new RunManager({ repo, runner, workDirRoot: workDir });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('拒绝停止其他实例持有的运行中和排队执行', async () => {
    for (const status of ['queued', 'running'] as const) {
      const run = await repo.createRun({ projectId: BASE_PROJECT.id, envSnapshot: {}, scriptSnapshot: BASE_PROJECT.scriptSource });
      if (status === 'running') await repo.updateRun(run.id, { status });
      await expect(manager.stop(run.id)).rejects.toThrow('其他服务实例管理');
      expect((await repo.getRun(run.id))?.status).toBe(status);
      expect(runner.specs).toHaveLength(0);
    }
  });

  it("执行成功：queued→running→succeeded，摘要提取，快照落库", async () => {
    const events: LoadTestEvent[] = [];
    const run = await manager.enqueue(BASE_PROJECT, {});
    manager.subscribe(run.id, (event) => events.push(event));

    // FakeRunner 同步完成，pump 链结束后断言
    await new Promise((resolve) => setTimeout(resolve, 50));

    const finished = await repo.getRun(run.id);
    expect(finished!.status).toBe("succeeded");
    expect(finished!.exitCode).toBe(0);
    expect(finished!.summaryText).toContain("checks_succeeded");
    expect(finished!.envSnapshot.STAGES).toBe("10s:2,5s:0");
    expect(finished!.envSnapshot.API_BASE).toBe("https://example.com/api");
    expect(events.some((e) => e.type === "status" && e.status === "running")).toBe(true);
    expect(events.some((e) => e.type === "summary")).toBe(true);
  });

  it("k6 非零退出码判定为 failed", async () => {
    runner.exitCode = 99;
    const run = await manager.enqueue(BASE_PROJECT, {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    const finished = await repo.getRun(run.id);
    expect(finished!.status).toBe("failed");
    expect(finished!.exitCode).toBe(99);
  });

  it("串行队列：第二个执行等第一个完成后才开始", async () => {
    const order: string[] = [];
    class SlowRunner extends FakeRunner {
      override async start(spec: K6RunSpec, onLog: (line: string) => void): Promise<K6RunResult> {
        order.push(spec.runId);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return super.start(spec, onLog);
      }
    }
    manager = new RunManager({ repo, runner: new SlowRunner(), workDirRoot: workDir });
    const first = await manager.enqueue(BASE_PROJECT, {});
    const second = await manager.enqueue(BASE_PROJECT, {});
    expect((await repo.getRun(second.id))!.status).toBe("queued");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(order).toEqual([first.id, second.id]);
    expect((await repo.getRun(second.id))!.status).toBe("succeeded");
  });

  it("停止排队中的执行：直接标记 stopped 且不再运行", async () => {
    class HangingRunner extends FakeRunner {
      override async start(spec: K6RunSpec, onLog: (line: string) => void): Promise<K6RunResult> {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return super.start(spec, onLog);
      }
    }
    manager = new RunManager({ repo, runner: new HangingRunner(), workDirRoot: workDir });
    const first = await manager.enqueue(BASE_PROJECT, {});
    const second = await manager.enqueue(BASE_PROJECT, {});
    await manager.stop(second.id);
    expect((await repo.getRun(second.id))!.status).toBe("stopped");
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 排队任务被移除后不再执行
    expect((await repo.getRun(second.id))!.status).toBe("stopped");
    expect((await repo.getRun(first.id))!.status).toBe("succeeded");
  });

  it("停止运行中的执行：runner.stop 被调用且状态为 stopped", async () => {
    class HangingRunner extends FakeRunner {
      override async start(spec: K6RunSpec, onLog: (line: string) => void): Promise<K6RunResult> {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return super.start(spec, onLog);
      }
    }
    manager = new RunManager({ repo, runner: new HangingRunner(), workDirRoot: workDir });
    const run = await manager.enqueue(BASE_PROJECT, {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    await manager.stop(run.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await repo.getRun(run.id))!.status).toBe("stopped");
  });

  it("拒绝覆盖框架管理的环境变量", async () => {
    await expect(manager.enqueue(BASE_PROJECT, { TEST_ID: "hack" })).rejects.toThrow("框架管理");
    await expect(manager.enqueue(BASE_PROJECT, { lowercase: "x" })).rejects.toThrow("不合法");
  });

  it("断线恢复：后订阅者能回放到完整事件流", async () => {
    const run = await manager.enqueue(BASE_PROJECT, {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    const replayed: LoadTestEvent[] = [];
    manager.subscribe(run.id, (event) => replayed.push(event));
    expect(replayed.some((e) => e.type === "log")).toBe(true);
    expect(replayed.some((e) => e.type === "status" && e.status === "succeeded")).toBe(true);
  });
});

describe("extractSummary", () => {
  it("从日志尾部提取关键指标行", () => {
    const log = [
      "running (1m10.9s), 0/5 VUs",
      "     checks_succeeded...: 100.00% 770 out of 770",
      "     http_req_duration..............: avg=29.05ms",
      "     iterations.....................: 154     2.17/s",
    ].join("\n");
    const summary = extractSummary(log)!;
    expect(summary).toContain("checks_succeeded");
    expect(summary).toContain("http_req_duration");
    expect(summary).not.toContain("running (");
  });

  it("进度行（[ 69% ]）不混入摘要", () => {
    const log = [
      "survey_submit   [  69% ] 4/5 VUs  0m48.0s/1m10.0s",
      "     survey_submit_success..........: 100.00% 148 out of 148",
      "survey_submit ✓ [ 100% ] 0/5 VUs  1m10s",
    ].join("\n");
    const summary = extractSummary(log)!;
    expect(summary).toContain("survey_submit_success");
    expect(summary).not.toContain("4/5 VUs");
  });

  it("无指标行返回 null", () => {
    expect(extractSummary("plain log\nnothing here")).toBeNull();
  });
});
