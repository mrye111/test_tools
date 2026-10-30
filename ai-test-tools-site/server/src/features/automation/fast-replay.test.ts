// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFastReplayDump, writeFastReplayReport, type FastReplayInput } from "./fast-replay.js";

const INPUT: FastReplayInput = {
  caseNo: "ATC-001",
  title: "登录",
  entryUrl: "https://staging.example.com/login",
  verdict: "passed",
  steps: [{ stepId: 1, type: "act", text: "在账号框输入 user_normal", status: "passed", durationMs: 500, engine: "fast" }],
  frames: [
    {
      iteration: 0,
      phase: "decision",
      operation: "TYPE_TEXT",
      targetLabel: "[2] 账号输入框",
      targetBox: { x: 100, y: 50, w: 200, h: 28 },
      confidence: 0.92,
      screenshot: "ZmFrZS1qcGVn",
      at: "2026-09-23T10:00:00.000Z",
      durationMs: 800,
      stepId: 1,
    },
    {
      iteration: 0,
      phase: "action",
      operation: "TYPE_TEXT",
      targetLabel: "[2] 账号输入框",
      text: "user_normal",
      screenshot: "ZmFrZS1qcGVn",
      at: "2026-09-23T10:00:01.000Z",
      durationMs: 120,
      stepId: 1,
    },
  ],
};

describe("buildFastReplayDump", () => {
  it("产出 Midscene dump 结构：executions → tasks → recorder 内联截图", () => {
    const dump = buildFastReplayDump(INPUT) as {
      sdkVersion: string;
      groupName: string;
      groupDescription: string;
      executions: Array<{
        name: string;
        description: string;
        tasks: Array<Record<string, unknown>>;
      }>;
    };
    expect(dump.groupName).toBe("ATC-001 · 登录");
    expect(dump.groupDescription).toContain("通过");
    expect(dump.executions).toHaveLength(1);
    expect(dump.executions[0].name).toBe("第 1 步");
    expect(dump.executions[0].description).toContain("账号框");

    const [decisionTask, actionTask] = dump.executions[0].tasks;
    expect(decisionTask.type).toBe("Planning");
    // 带目标 bbox 的决策帧映射为 Locate 任务（回放查看器据此缩放镜头与移动指针）
    expect(decisionTask.subType).toBe("Locate");
    expect(String(decisionTask.thought)).toContain("92%");
    const output = decisionTask.output as { element: { center: [number, number]; rect: { left: number; width: number } } };
    expect(output.element.center).toEqual([200, 64]);
    expect(output.element.rect).toMatchObject({ left: 100, width: 200 });
    // 回放脚本的强制门槛：uiContext.shotSize
    const uiContext = decisionTask.uiContext as { shotSize: { width: number; height: number } };
    expect(uiContext.shotSize).toEqual({ width: 1440, height: 900 });
    expect(actionTask.type).toBe("Action Space");
    expect(actionTask.subType).toBe("Input");

    const recorder = actionTask.recorder as Array<{ type: string; screenshot: { base64: string } }>;
    expect(recorder).toHaveLength(1);
    expect(recorder[0].type).toBe("screenshot");
    // 查看器直接当 <img src>：必须带 data:image 前缀
    expect(recorder[0].screenshot.base64).toBe("data:image/jpeg;base64,ZmFrZS1qcGVn");
  });

  it("失败帧产出 failed 任务并带 errorMessage", () => {
    const dump = buildFastReplayDump({
      ...INPUT,
      verdict: "failed",
      frames: [{ ...INPUT.frames[1], phase: "failed", reason: "元素被遮挡" }],
    }) as { executions: Array<{ tasks: Array<Record<string, unknown>> }> };
    const task = dump.executions[0].tasks[0];
    expect(task.status).toBe("failed");
    expect(task.errorMessage).toBe("元素被遮挡");
  });
});

describe("writeFastReplayReport", () => {
  let runDir: string;
  let prev: string | undefined;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "at-replay-"));
    prev = process.env.MIDSCENE_RUN_DIR;
    process.env.MIDSCENE_RUN_DIR = runDir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.MIDSCENE_RUN_DIR;
    else process.env.MIDSCENE_RUN_DIR = prev;
  });

  it("写入 MIDSCENE_RUN_DIR/report/fast-replay-*.html 并含 dump 标记", () => {
    const path = writeFastReplayReport(INPUT);
    expect(path).toContain("fast-replay-");
    expect(path.toLowerCase().endsWith(".html")).toBe(true);
    expect(existsSync(path)).toBe(true);
    const html = readFileSync(path, "utf-8");
    expect(html).toContain("midscene_web_dump");
    expect(html).toContain("ATC-001");
  });
});
