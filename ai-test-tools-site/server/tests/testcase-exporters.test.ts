import { describe, expect, it } from "vitest";
import { buildExcelExport, buildXlsxWorkbook } from "../src/features/testcase/exporters.js";
import { readZipEntries } from "../src/features/testcase/zip.js";

const sampleRows = [
  ["TC001", "登录", "正常登录", "正确账密登录成功", "高", "用户已注册", "1. 打开登录页\n2. 输入账密", "1. 登录成功"],
  ["TC002", "登录", "异常登录", "错误密码登录失败", "低", "用户已注册", "1. 输入错误密码", "1. 提示密码错误"],
];

describe("buildXlsxWorkbook", () => {
  it("生成包含必要部件的 xlsx，最后一列为执行结果下拉框", () => {
    const buffer = buildXlsxWorkbook([{ name: "登录模块", rows: sampleRows }]);
    const entries = readZipEntries(buffer);

    for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) {
      expect(entries.has(part), `缺少部件 ${part}`).toBe(true);
    }

    const sheet = entries.get("xl/worksheets/sheet1.xml")!.toString("utf8");
    // 表头包含执行结果列
    expect(sheet).toContain("执行结果");
    // 每行预填未执行
    expect(sheet.match(/未执行/g)!.length).toBeGreaterThanOrEqual(sampleRows.length);
    // 下拉框验证：列表选项 + 作用于执行结果列（I 列，表头之下）
    expect(sheet).toContain('<dataValidation type="list"');
    expect(sheet).toContain("sqref=\"I2:I1048576\"");
    expect(sheet).toContain("未执行,通过,失败,阻塞");
    // 单元格文本保留换行
    expect(sheet).toContain("1. 打开登录页\n2. 输入账密");

    const workbook = entries.get("xl/workbook.xml")!.toString("utf8");
    expect(workbook).toContain('name="登录模块"');
  });

  it("支持多个 sheet", () => {
    const buffer = buildXlsxWorkbook([
      { name: "模块A", rows: sampleRows },
      { name: "模块B", rows: sampleRows },
    ]);
    const entries = readZipEntries(buffer);
    expect(entries.has("xl/worksheets/sheet2.xml")).toBe(true);
    const workbook = entries.get("xl/workbook.xml")!.toString("utf8");
    expect(workbook).toContain('name="模块A"');
    expect(workbook).toContain('name="模块B"');
    const contentTypes = entries.get("[Content_Types].xml")!.toString("utf8");
    expect(contentTypes).toContain("/xl/worksheets/sheet2.xml");
  });
});

describe("buildExcelExport", () => {
  it("默认格式返回 xlsx", () => {
    const result = buildExcelExport([{ name: "测试用例", rows: sampleRows }], { format: "default" });
    expect(result.extension).toBe("xlsx");
    expect(result.contentType).toContain("spreadsheetml");
    expect(readZipEntries(result.buffer).has("xl/worksheets/sheet1.xml")).toBe(true);
  });

  it("jira / zentao 格式保持原有 XML 表格导出", () => {
    for (const format of ["jira", "zentao"]) {
      const result = buildExcelExport([{ name: "测试用例", rows: sampleRows }], { format });
      expect(result.extension).toBe("xls");
      expect(result.buffer.toString("utf8")).toContain("mso-application");
    }
  });
});
