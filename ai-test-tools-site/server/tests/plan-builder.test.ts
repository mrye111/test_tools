import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFromTemplate,
  PlanBuildError,
  type PlanBuildEvent,
  type TemplateBuildSpec,
} from "../src/plan-builder.js";

// ── Helpers ──

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-builder-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function httpSpec(overrides: Partial<TemplateBuildSpec> = {}): TemplateBuildSpec {
  return {
    planName: "端到端压测计划",
    seed: "e2e-plan",
    steps: [
      { tool: "create_test_plan", args: { name: "端到端压测计划", comments: "plan-builder test" } },
      { tool: "add_thread_group", args: { name: "主线程组", num_threads: 5, ramp_up: 5, loops: 2 } },
      { tool: "add_http_request", args: { name: "查询接口", method: "GET", domain: "example.com", path: "/api/users" } },
      { tool: "add_listener", args: { type: "aggregate_report" } },
    ],
    ...overrides,
  };
}

async function catchBuild(spec: TemplateBuildSpec, generatedRoot: string): Promise<unknown> {
  return buildFromTemplate(spec, { generatedRoot }).then(
    () => {
      throw new Error("build unexpectedly succeeded");
    },
    (error: unknown) => error,
  );
}

// ── Template build end-to-end ──

describe("buildFromTemplate", () => {
  it("builds a template spec end-to-end and writes a real JMX", async () => {
    const dir = makeTempDir();
    const built = await buildFromTemplate(httpSpec(), { generatedRoot: dir });

    expect(built.planName).toBe("端到端压测计划");
    expect(built.filename).toMatch(/^e2e-plan-\d{8}-\d{6}\.jmx$/);
    expect(built.path).toBe(join(dir, built.filename));
    expect(existsSync(built.path)).toBe(true);

    const jmx = readFileSync(built.path, "utf8");
    expect(jmx).toContain("jmeterTestPlan");
    expect(jmx).toContain("端到端压测计划");
    expect(jmx).toContain("主线程组");
    expect(jmx).toContain("example.com");
    expect(jmx).toContain("/api/users");

    // 4 construction steps + server-owned validate/save/tree tail
    expect(built.steps.map((step) => step.tool)).toEqual([
      "create_test_plan",
      "add_thread_group",
      "add_http_request",
      "add_listener",
      "validate_test_plan",
      "save_test_plan",
      "list_test_plan_tree",
    ]);
    expect(built.validation).toContain("Validation summary");
    expect(built.saveMessage).toContain("Test plan saved");
    expect(built.tree).toContain("主线程组");
  });

  it("fails with a typed error naming the step when a tool is unknown", async () => {
    const dir = makeTempDir();
    const failure = await catchBuild(httpSpec({
      steps: [
        { tool: "create_test_plan", args: { name: "X" } },
        { tool: "definitely_not_a_tool", args: {} },
      ],
    }), dir);

    expect(failure).toBeInstanceOf(PlanBuildError);
    const error = failure as PlanBuildError;
    expect(error.code).toBe("not-found");
    expect(error.step).toBe("definitely_not_a_tool");
    expect(error.message).toContain("definitely_not_a_tool");
  });

  it("short-circuits on the first failing step and reports which step failed", async () => {
    const dir = makeTempDir();
    const started: string[] = [];
    const failure = await buildFromTemplate(httpSpec({
      steps: [
        { tool: "create_test_plan", args: { name: "X" } },
        { tool: "add_extended_assertion", args: { type: "bogus" } },
        { tool: "add_listener", args: { type: "aggregate_report" } },
      ],
    }), {
      generatedRoot: dir,
      onStep: (event: PlanBuildEvent) => {
        if (event.phase === "start") started.push(event.tool);
      },
    }).then(
      () => {
        throw new Error("build unexpectedly succeeded");
      },
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(PlanBuildError);
    const error = failure as PlanBuildError;
    expect(error.code).toBe("unknown-type");
    expect(error.step).toBe("add_extended_assertion");
    expect(error.message).toContain("add_extended_assertion");
    // The failing step ran; nothing after it did (no listener, no finalize tail).
    expect(started).toEqual(["create_test_plan", "add_extended_assertion"]);
  });

  it("rejects path traversal in seed and planName", async () => {
    const dir = makeTempDir();

    const seedFailure = await catchBuild(httpSpec({ seed: "../../evil" }), dir);
    expect(seedFailure).toBeInstanceOf(PlanBuildError);
    expect((seedFailure as PlanBuildError).code).toBe("invalid-args");

    const nameFailure = await catchBuild(httpSpec({ planName: "../escape" }), dir);
    expect(nameFailure).toBeInstanceOf(PlanBuildError);
    expect((nameFailure as PlanBuildError).code).toBe("invalid-args");

    const absSeedFailure = await catchBuild(httpSpec({ seed: "D:/evil/abs" }), dir);
    expect(absSeedFailure).toBeInstanceOf(PlanBuildError);
    expect((absSeedFailure as PlanBuildError).code).toBe("invalid-args");

    // Nothing may have been written outside (or inside) the generated root.
    expect(existsSync(join(dir, "evil.jmx"))).toBe(false);
  });

  it("rejects malformed specs", async () => {
    const dir = makeTempDir();
    for (const spec of [
      { ...httpSpec(), planName: "" },
      { ...httpSpec(), seed: "" },
      { ...httpSpec(), steps: [] },
      { ...httpSpec(), steps: [{}] as TemplateBuildSpec["steps"] },
    ]) {
      const failure = await catchBuild(spec, dir);
      expect(failure).toBeInstanceOf(PlanBuildError);
      expect((failure as PlanBuildError).code).toBe("invalid-args");
    }
  });

  it("enforces the denylist on spec steps (AI construction tools)", async () => {
    const dir = makeTempDir();
    const started: string[] = [];
    const failure = await buildFromTemplate(httpSpec({
      steps: [
        { tool: "create_test_plan", args: { name: "X" } },
        { tool: "save_test_plan", args: { path: "anywhere.jmx" } },
      ],
    }), {
      generatedRoot: dir,
      denylist: new Set(["save_test_plan", "run_test_plan", "load_test_plan"]),
      onStep: (event: PlanBuildEvent) => {
        if (event.phase === "start") started.push(event.tool);
      },
    }).then(
      () => {
        throw new Error("build unexpectedly succeeded");
      },
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(PlanBuildError);
    const error = failure as PlanBuildError;
    expect(error.code).toBe("invalid-args");
    expect(error.step).toBe("save_test_plan");
    expect(started).toEqual(["create_test_plan"]);
  });

  it("keeps two concurrent builds isolated (regression: shared singleton service)", async () => {
    const dir = makeTempDir();
    const interleave = () => new Promise<void>((resolve) => setTimeout(resolve, 2));

    const specA = httpSpec({
      planName: "并发计划 Alpha",
      seed: "plan-alpha",
      steps: [
        { tool: "create_test_plan", args: { name: "并发计划 Alpha" } },
        { tool: "add_thread_group", args: { name: "Alpha 线程组", num_threads: 1, ramp_up: 1, loops: 1 } },
        { tool: "add_http_request", args: { name: "Alpha 请求", method: "GET", domain: "alpha.example.com", path: "/" } },
      ],
    });
    const specB = httpSpec({
      planName: "并发计划 Beta",
      seed: "plan-beta",
      steps: [
        { tool: "create_test_plan", args: { name: "并发计划 Beta" } },
        { tool: "add_thread_group", args: { name: "Beta 线程组", num_threads: 2, ramp_up: 1, loops: 1 } },
        { tool: "add_jdbc_request", args: { name: "Beta JDBC", data_source: "jdbc_pool", sql: "select 1" } },
      ],
    });

    const [a, b] = await Promise.all([
      buildFromTemplate(specA, { generatedRoot: dir, onStep: interleave }),
      buildFromTemplate(specB, { generatedRoot: dir, onStep: interleave }),
    ]);

    expect(a.path).not.toBe(b.path);

    // Each build sees exactly its own tree — no cross-contamination.
    expect(a.tree).toContain("Alpha 线程组");
    expect(a.tree).toContain("Alpha 请求");
    expect(a.tree).not.toContain("Beta");
    expect(b.tree).toContain("Beta 线程组");
    expect(b.tree).toContain("Beta JDBC");
    expect(b.tree).not.toContain("Alpha");

    const jmxA = readFileSync(a.path, "utf8");
    const jmxB = readFileSync(b.path, "utf8");
    expect(jmxA).toContain("并发计划 Alpha");
    expect(jmxA).toContain("alpha.example.com");
    expect(jmxA).not.toContain("Beta");
    expect(jmxB).toContain("并发计划 Beta");
    expect(jmxB).toContain("select 1");
    expect(jmxB).not.toContain("Alpha");
  });
});
