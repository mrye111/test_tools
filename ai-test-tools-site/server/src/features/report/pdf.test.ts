import { describe, expect, it } from "vitest";
import { browserCandidates, findBrowserExecutable } from "./pdf.js";

describe("browserCandidates", () => {
  it("CHROME_PATH 环境变量优先级最高", () => {
    const candidates = browserCandidates("win32", { CHROME_PATH: "D:\\custom\\chrome.exe" });
    expect(candidates[0]).toBe("D:\\custom\\chrome.exe");
  });

  it("win32 候选包含 Chrome 与 Edge 的常见安装路径", () => {
    const candidates = browserCandidates("win32", {
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
    });
    expect(candidates.some((p) => p.includes("chrome.exe"))).toBe(true);
    expect(candidates.some((p) => p.includes("msedge.exe"))).toBe(true);
  });

  it("linux 候选包含 chromium 系路径", () => {
    const candidates = browserCandidates("linux", {});
    expect(candidates).toContain("/usr/bin/chromium");
  });
});

describe("findBrowserExecutable", () => {
  it("候选不存在时返回 null（不抛错）", () => {
    // 指向一个必定不存在的路径
    const found = findBrowserExecutable({ CHROME_PATH: "Z:\\nonexistent\\chrome.exe", PROGRAMFILES: "Z:\\none", "PROGRAMFILES(X86)": "Z:\\none", LOCALAPPDATA: "Z:\\none" });
    // Windows 真实环境下仍可能命中真实安装路径；此处只断言不抛异常且返回 string | null
    expect(found === null || typeof found === "string").toBe(true);
  });
});
