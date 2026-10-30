import { describe, expect, it, vi } from "vitest";
import {
  MAX_REFERENCE_TEXT_CHARS,
  ReferenceParseError,
  parseReferenceFile,
} from "../src/features/testcase/reference-parse.js";

function fakeDoclingResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

describe("parseReferenceFile（docling-serve 转发）", () => {
  it("拼装 multipart 并取回 document.md_content（超长截断并标记）", async () => {
    const longText = "a".repeat(MAX_REFERENCE_TEXT_CHARS + 100);
    const fetchImpl = vi.fn(async () => fakeDoclingResponse({
      document: { md_content: longText },
      status: "success",
      errors: [],
    }));

    const result = await parseReferenceFile("需求.docx", Buffer.from("dummy"), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: "http://127.0.0.1:5001",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:5001/v1/convert/file");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("files")).toBeTruthy();
    expect(form.get("to_formats")).toBe("md");

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_REFERENCE_TEXT_CHARS);
  });

  it("短文本不截断，透传 docling 处理状态", async () => {
    const fetchImpl = vi.fn(async () => fakeDoclingResponse({
      document: { md_content: "# 需求\n登录页" },
      status: "partial_success",
      errors: ["page 3 failed"],
    }));

    const result = await parseReferenceFile("需求.pdf", Buffer.from("dummy"), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ text: "# 需求\n登录页", truncated: false, status: "partial_success" });
  });

  it("连接失败抛出「解析服务未启动或不可达」", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("connect ECONNREFUSED"); });

    await expect(
      parseReferenceFile("需求.pdf", Buffer.from("dummy"), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/解析服务未启动或不可达/);
  });

  it("HTTP 非 2xx 抛出带状态码的错误", async () => {
    const fetchImpl = vi.fn(async () => fakeDoclingResponse({}, 503));

    await expect(
      parseReferenceFile("需求.pdf", Buffer.from("dummy"), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("提取不出文本时抛错并透传 docling errors 原因", async () => {
    const fetchImpl = vi.fn(async () => fakeDoclingResponse({
      document: { md_content: "   " },
      status: "failure",
      errors: ["no text layer in scanned pdf"],
    }));

    await expect(
      parseReferenceFile("扫描件.pdf", Buffer.from("dummy"), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/未能从该文件提取出文本（no text layer in scanned pdf）/);
    await expect(
      parseReferenceFile("扫描件.pdf", Buffer.from("dummy"), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(ReferenceParseError);
  });
});
