import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  DocumentParseError,
  MAX_TEXT_CHARS,
  parseRequirementDocument,
  truncateText,
} from "./parsers.js";

function buildXlsxBuffer(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "需求");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseRequirementDocument", () => {
  it("解析 .txt 为纯文本", async () => {
    const result = await parseRequirementDocument("登录需求.txt", Buffer.from("用户可通过手机号登录", "utf8"));
    expect(result.text).toBe("用户可通过手机号登录");
    expect(result.warnings).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("解析 .md 为纯文本", async () => {
    const result = await parseRequirementDocument("需求.md", Buffer.from("# 订单系统\n- 支持退款", "utf8"));
    expect(result.text).toContain("订单系统");
    expect(result.truncated).toBe(false);
  });

  it("解析 .csv 时保留 UTF-8 中文", async () => {
    const result = await parseRequirementDocument("需求.csv", Buffer.from("模块,说明\n支付,支持退款", "utf8"));
    expect(result.text).toContain("支付,支持退款");
  });

  it("解析 .xlsx 提取表格文本", async () => {
    const buffer = buildXlsxBuffer([["模块", "说明"], ["登录", "支持手机号登录"]]);
    const result = await parseRequirementDocument("需求.xlsx", buffer);
    expect(result.text).toContain("模块,说明");
    expect(result.text).toContain("登录,支持手机号登录");
    expect(result.warnings).toEqual([]);
  });

  it("超长文本截断并返回 warning", async () => {
    const longText = `需求内容${"一".repeat(MAX_TEXT_CHARS)}`;
    const result = await parseRequirementDocument("长需求.txt", Buffer.from(longText, "utf8"));
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(MAX_TEXT_CHARS);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("截断");
  });

  it("不支持的扩展名直接报错", async () => {
    await expect(parseRequirementDocument("需求.doc", Buffer.from("x"))).rejects.toThrow(DocumentParseError);
    await expect(parseRequirementDocument("需求.png", Buffer.from("x"))).rejects.toThrow(/不支持/);
  });

  it("空文本报错", async () => {
    await expect(parseRequirementDocument("空.txt", Buffer.from("   \n "))).rejects.toThrow(/未能从文档中提取到文本/);
  });
});

describe("truncateText", () => {
  it("未超限时原样返回", () => {
    const result = truncateText("短文本");
    expect(result).toEqual({ text: "短文本", warnings: [], truncated: false });
  });

  it("超限截断到最大长度", () => {
    const result = truncateText("x".repeat(MAX_TEXT_CHARS + 100));
    expect(result.text.length).toBe(MAX_TEXT_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
