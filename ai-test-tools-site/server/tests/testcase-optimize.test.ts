import { describe, expect, it } from "vitest";
import { mergeJobRows } from "../src/features/testcase/generation.js";
import { optimizeGapBatch, reconcileOptimizedRows } from "../src/features/testcase/optimize.js";
import type { GenerateJobRecord, TestCaseExecutionItem } from "../src/features/testcase/types.js";

const HEADER = ["用例编号", "功能模块", "功能测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"];

const OLD_ROWS = [
  ["TC001", "登录", "正常登录", "账密登录成功", "高", "已注册", "1. 输入账密", "1. 登录成功"],
  ["TC002", "登录", "密码校验", "错误密码登录", "高", "已注册", "1. 输入错误密码", "1. 提示密码错误"],
  ["TC003", "登录", "界面逻辑", "点击密码框登录", "中", "浏览器打开", "1. 点击密码框", "1. 允许输入密码"],
  ["TC004", "登录", "会话", "登录后保持会话", "中", "已登录", "1. 刷新页面", "1. 仍处登录态"],
];

describe("reconcileOptimizedRows 执行状态指纹合并", () => {
  const executionStatus: Record<string, TestCaseExecutionItem> = {
    TC001: { status: "passed", updatedAt: "2026-09-20T00:00:00.000Z" },
    TC002: { status: "failed", bugId: "BUG-001", note: "提示未出现", updatedAt: "2026-09-20T00:01:00.000Z" },
    TC003: { status: "blocked", updatedAt: "2026-09-20T00:02:00.000Z" },
    TC004: { status: "passed", updatedAt: "2026-09-20T00:03:00.000Z" },
  };

  it("未动→保留、变更→重置、删除→清除、新增→无记录，并产出正确统计", () => {
    const NEW_ROWS = [
      OLD_ROWS[0], // 未动 → 保留 TC001 记录
      ["TC002", "登录", "密码校验", "错误密码登录", "高", "已注册", "1. 输入错误密码", "1. 提示「密码错误」（红字）"], // 变更 → 重置
      ["TC005", "登录", "验证码登录", "手机号+验证码登录", "高", "已注册手机号", "1. 输入手机号获取验证码", "1. 登录成功"], // 新增
      // TC003 被删除 → 清除记录
      OLD_ROWS[3], // 未动 → 保留 TC004 记录
    ];

    const result = reconcileOptimizedRows(OLD_ROWS, NEW_ROWS, executionStatus);

    expect(result.stats).toEqual({ modified: 1, added: 1, removed: 1 });
    expect(result.executionStatus.TC001).toEqual(executionStatus.TC001); // 保留（含全部字段）
    expect(result.executionStatus.TC002).toBeUndefined(); // 内容变更 → 重置为未执行
    expect(result.executionStatus.TC003).toBeUndefined(); // 删除 → 连同阻塞记录清除
    expect(result.executionStatus.TC004).toEqual(executionStatus.TC004);
    expect(result.executionStatus.TC005).toBeUndefined(); // 新增无记录
  });

  it("无任何变化时统计全零且记录全保留", () => {
    const result = reconcileOptimizedRows(OLD_ROWS, [...OLD_ROWS], executionStatus);
    expect(result.stats).toEqual({ modified: 0, added: 0, removed: 0 });
    expect(Object.keys(result.executionStatus)).toHaveLength(4);
  });

  it("用例行单元格内容相同但顺序/格式差异经 heal 后仍判定为未动", () => {
    const sloppy = [OLD_ROWS[0].map((cell) => cell), OLD_ROWS[1], OLD_ROWS[2], OLD_ROWS[3]];
    const result = reconcileOptimizedRows(OLD_ROWS, sloppy, executionStatus);
    expect(result.stats.modified).toBe(0);
  });
});

describe("optimizeGapBatch 优化批次 prompt", () => {
  it("包含原始需求基准、优化指令、现有全集与改写契约", () => {
    const batch = optimizeGapBatch("登录", "原始需求：账号密码登录", "登录页实际是手机号+验证码登录，没有密码框", OLD_ROWS);

    expect(batch.scope).toContain("原始需求：账号密码登录");
    expect(batch.scope).toContain("登录页实际是手机号+验证码登录，没有密码框");
    for (const row of OLD_ROWS) {
      expect(batch.scope).toContain(row[3]); // 现有全集逐行呈现（改写需要全文）
    }
    expect(batch.scope).toContain("完整新用例集");
    expect(batch.scope).toContain("保持用例编号与全部内容完全一致");
    expect(batch.scope).toContain("视为删除");
    expect(batch.scope).toContain("模糊断言");
    expect(batch.coverageItems).toEqual(["登录页实际是手机号+验证码登录，没有密码框"]);
  });
});

describe("mergeJobRows optimize 模式整体替换", () => {
  it("不与旧集合并：AI 输出即最终集合（删除生效）", () => {
    const job: GenerateJobRecord = {
      id: "job_1",
      projectId: "proj_1",
      testSetId: "set_1",
      mode: "optimize",
      status: "running",
      request: { rows: OLD_ROWS },
      generatedCount: 0,
      error: "",
      resultHeader: HEADER,
      resultRows: [],
      selectedIndices: [],
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    };
    const generated = [OLD_ROWS[0], ["TC005", "登录", "验证码登录", "手机号验证码登录", "高", "已注册", "1. 获取验证码", "1. 登录成功"]];

    const next = mergeJobRows(job, generated);

    expect(next).toHaveLength(2); // 旧 TC002~TC004 不合并（被优化删除）
    expect(next[0][0]).toBe("TC001");
    expect(next[1][0]).toBe("TC002"); // 重排编号为新集合顺序
  });
});
