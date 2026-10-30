import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importProjectFromDir, pickMainScript, pickPayloadFile } from "./routes.js";

describe("pickMainScript", () => {
  it("优先与目录同名的脚本（survey 目录选中 survey.js 而非 submit-only.js）", () => {
    expect(pickMainScript("survey", ["submit-only.js", "survey.js"])).toBe("survey.js");
  });

  it("无同名脚本时用常见入口名", () => {
    expect(pickMainScript("demo", ["helper.js", "main.js"])).toBe("main.js");
    expect(pickMainScript("demo", ["index.js", "script.js"])).toBe("index.js");
  });

  it("都没有时按字母序取第一个（内部自行排序）", () => {
    expect(pickMainScript("demo", ["b.js", "a.js"])).toBe("a.js");
  });

  it("空列表抛错", () => {
    expect(() => pickMainScript("demo", [])).toThrow("未找到 k6 脚本");
  });
});

describe("pickPayloadFile", () => {
  it("优先文件名含 body/payload 的（captured_request_body 胜过 headers）", () => {
    expect(pickPayloadFile(["captured_request_headers.json", "captured_request_body.json"])).toBe("captured_request_body.json");
  });

  it("无特征名时按字母序取第一个，空列表返回 undefined", () => {
    expect(pickPayloadFile(["b.json", "a.json"])).toBe("a.json");
    expect(pickPayloadFile([])).toBeUndefined();
  });
});

describe("importProjectFromDir", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function makeFixture(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "lt-import-"));
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, name);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    return root;
  }

  it("解析 project.env + 主脚本 + 请求体，目标地址取 ONLINE_API_BASE", async () => {
    dir = await makeFixture({
      "project.env": [
        "# 注释行",
        "PROJECT_NAME=问卷系统",
        'ONLINE_API_BASE="https://example.com/api"',
        "STAGES=30s:10,30s:0",
        "invalid line",
        "lowercase=忽略",
      ].join("\n"),
      "k6/submit-only.js": "// 烟雾脚本",
      "k6/demo.js": "// 主脚本",
      "data/payload.json": '{"a":1}',
      "data/headers.json": "{}",
    });
    // 目录名是随机临时名，脚本无同名 → 字母序取 demo.js 而非 submit-only.js？字母序 demo < submit-only
    const input = importProjectFromDir(dir);
    expect(input.name).toBe("问卷系统");
    expect(input.targetBaseUrl).toBe("https://example.com/api");
    expect(input.envVars?.STAGES).toBe("30s:10,30s:0");
    expect(input.envVars?.lowercase).toBeUndefined();
    expect(input.scriptSource).toBe("// 主脚本");
    expect(input.payloadTemplate).toBe('{"a":1}');
  });

  it("目录不存在时报错", () => {
    expect(() => importProjectFromDir("D:/no/such/dir")).toThrow("目录不存在");
  });
});
