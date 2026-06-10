import { randomUUID } from "node:crypto";
import { createZip } from "./zip.js";
import { escapeXml, safeSheetName } from "./utils.js";

type RowLike = string[] | Record<string, unknown>;

export type ExcelExportFormat = "default" | "jira" | "zentao";

export type ExcelExportOptions = {
  format?: string;
  projectName?: string;
  productName?: string;
  issueType?: string;
  component?: string;
  labels?: string;
};

type XMindTopic = {
  id: string;
  title: string;
  markers?: Array<{ markerId: string }>;
  style?: Record<string, unknown>;
  children?: { attached: XMindTopic[] };
};

const HEADERS = ["用例编号", "功能模块", "功能测试点", "用例标题", "优先级", "前置条件", "测试步骤", "预期结果"];

function normalizeFormat(format?: string): ExcelExportFormat {
  const value = String(format || "default").trim().toLowerCase();
  if (["jira", "atlassian"].includes(value)) return "jira";
  if (["zentao", "禅道", "zentao/禅道"].includes(value)) return "zentao";
  return "default";
}

function rowCells(row: RowLike): string[] {
  if (Array.isArray(row)) {
    return [...row.map((item) => String(item ?? "")), ...Array.from({ length: 8 }, () => "")].slice(0, 8);
  }
  return [
    row.caseId,
    row.module ?? row.apiName,
    row.testPoint ?? row.requestPath,
    row.title ?? row.caseTitle,
    row.priority,
    row.precondition ?? row.preconditions,
    row.steps ?? row.testSteps,
    row.expected ?? row.expectedResult ?? row.expectedResults,
  ].map((item) => String(item ?? ""));
}

function priorityStyle(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes("高") || p.includes("p0") || p.includes("high")) return "PriorityHigh";
  if (p.includes("中") || p.includes("p1") || p.includes("medium")) return "PriorityMedium";
  if (p.includes("低") || p.includes("p2") || p.includes("low")) return "PriorityLow";
  return "Cell";
}

function jiraPriority(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes("高") || p.includes("p0") || p.includes("high")) return "High";
  if (p.includes("中") || p.includes("p1") || p.includes("medium")) return "Medium";
  if (p.includes("低") || p.includes("p2") || p.includes("low")) return "Low";
  return priority || "Medium";
}

function zentaoPriority(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes("高") || p.includes("p0") || p.includes("high")) return "1";
  if (p.includes("中") || p.includes("p1") || p.includes("medium")) return "2";
  if (p.includes("低") || p.includes("p2") || p.includes("low")) return "3";
  return "2";
}

function priorityMarker(priority: string): string {
  const p = priority.toUpperCase();
  if (p.includes("P0") || p.includes("高") || p.includes("HIGH")) return "priority-1";
  if (p.includes("P1") || p.includes("中") || p.includes("MEDIUM")) return "priority-2";
  if (p.includes("P2") || p.includes("低") || p.includes("LOW")) return "priority-3";
  return "priority-4";
}

function parseList(value: string): string[] {
  return String(value || "")
    .split(/\n|\\n/)
    .map((line) => line.trim().replace(/^\d+[\.\、\s-]+|^-\s+|^Step\s*\d+[:：]\s*/i, ""))
    .filter(Boolean);
}

function excelStyles(): string {
  return `<Styles>
    <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="#4F46E5" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Cell"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
    <Style ss:ID="PriorityHigh"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#DC2626"/><Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/></Style>
    <Style ss:ID="PriorityMedium"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#D97706"/><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="PriorityLow"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#059669"/><Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CaseId"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#7C3AED"/></Style>
  </Styles>`;
}

function excelWorksheet(name: string, rows: RowLike[]): string {
  const widths = [80, 100, 120, 200, 60, 150, 250, 250];
  let xml = `<Worksheet ss:Name="${escapeXml(safeSheetName(name))}"><Table>\n`;
  for (const width of widths) xml += `<Column ss:Width="${width}"/>\n`;
  xml += `<Row ss:Height="30">${HEADERS.map((header) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join("")}</Row>\n`;
  for (const row of rows) {
    const cells = rowCells(row);
    xml += "<Row>\n";
    cells.forEach((cell, index) => {
      const style = index === 0 ? "CaseId" : index === 4 ? priorityStyle(cell) : "Cell";
      xml += `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>\n`;
    });
    xml += "</Row>\n";
  }
  xml += "</Table></Worksheet>";
  return xml;
}

function formattedHeaders(format: ExcelExportFormat): string[] {
  if (format === "jira") {
    return ["Summary", "Issue Type", "Description", "Priority", "Labels", "Component/s", "Test Steps", "Expected Result"];
  }
  if (format === "zentao") {
    return ["所属产品", "所属模块", "用例标题", "前置条件", "步骤", "预期", "优先级", "用例类型", "适用阶段", "关键词"];
  }
  return HEADERS;
}

function formattedCells(row: RowLike, format: ExcelExportFormat, options: ExcelExportOptions): string[] {
  const cells = rowCells(row);
  const [caseId, module, testPoint, title, priority, precondition, steps, expected] = cells;
  if (format === "jira") {
    const labels = options.labels || [module, testPoint].filter(Boolean).join(",");
    const description = [
      caseId ? `Case ID: ${caseId}` : "",
      module ? `Module: ${module}` : "",
      testPoint ? `Test Point: ${testPoint}` : "",
      precondition ? `Preconditions: ${precondition}` : "",
    ].filter(Boolean).join("\\n");
    return [
      title || `${module} ${testPoint}`.trim() || caseId,
      options.issueType || "Test",
      description,
      jiraPriority(priority),
      labels,
      options.component || module,
      steps,
      expected,
    ];
  }
  if (format === "zentao") {
    return [
      options.productName || options.projectName || "",
      module,
      title || `${caseId} ${testPoint}`.trim(),
      precondition,
      steps,
      expected,
      zentaoPriority(priority),
      "功能测试",
      "功能测试阶段",
      [caseId, testPoint].filter(Boolean).join(","),
    ];
  }
  return cells;
}

function formattedWorksheet(name: string, rows: RowLike[], options: ExcelExportOptions): string {
  const format = normalizeFormat(options.format);
  if (format === "default") return excelWorksheet(name, rows);
  const headers = formattedHeaders(format);
  let xml = `<Worksheet ss:Name="${escapeXml(safeSheetName(name))}"><Table>\n`;
  const widths = format === "jira"
    ? [260, 90, 360, 90, 140, 140, 320, 320]
    : [120, 140, 260, 220, 320, 320, 70, 100, 120, 160];
  for (const width of widths) xml += `<Column ss:Width="${width}"/>\n`;
  xml += `<Row ss:Height="30">${headers.map((header) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join("")}</Row>\n`;
  for (const row of rows) {
    const cells = formattedCells(row, format, options);
    xml += "<Row>\n";
    cells.forEach((cell, index) => {
      const style = format === "jira" && index === 3 ? priorityStyle(cell) : format === "zentao" && index === 6 ? priorityStyle(cell) : "Cell";
      xml += `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>\n`;
    });
    xml += "</Row>\n";
  }
  xml += "</Table></Worksheet>";
  return xml;
}

export function buildExcelWorkbook(sheets: Array<{ name: string; rows: RowLike[] }>, options: ExcelExportOptions = {}): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${excelStyles()}
${sheets.map((sheet) => formattedWorksheet(sheet.name, sheet.rows, options)).join("\n")}
</Workbook>`;
  return Buffer.from(xml, "utf8");
}

function caseTopic(row: string[]): XMindTopic {
  const [caseId, , , title, priority, precondition, steps, expected] = row;
  const detailNodes: XMindTopic[] = [];
  if (precondition && precondition !== "无") {
    detailNodes.push({ id: randomUUID(), title: `前置条件: ${precondition}`, markers: [{ markerId: "symbol-info" }] });
  }
  const stepNodes = parseList(steps).map((step, index) => {
    const expectedItems = parseList(expected);
    const targetExpected = expectedItems.length === 1
      ? index === parseList(steps).length - 1 ? expectedItems[0] : ""
      : expectedItems[index] ?? "";
    const node: XMindTopic = { id: randomUUID(), title: `步骤 ${index + 1}: ${step}` };
    if (targetExpected) {
      node.children = { attached: [{ id: randomUUID(), title: `预期: ${targetExpected}`, markers: [{ markerId: "symbol-check" }] }] };
    }
    return node;
  });
  if (stepNodes.length) {
    detailNodes.push({ id: randomUUID(), title: "测试步骤与预期", markers: [{ markerId: "task-start" }], children: { attached: stepNodes } });
  }
  const topic: XMindTopic = {
    id: randomUUID(),
    title: `${caseId} ${title}`.trim() || "未命名用例",
    markers: [{ markerId: priorityMarker(priority) }],
  };
  if (detailNodes.length) topic.children = { attached: detailNodes };
  return topic;
}

function rowsToXmindTopics(rows: RowLike[]): XMindTopic[] {
  const modules = new Map<string, string[][]>();
  for (const row of rows) {
    const cells = rowCells(row);
    const moduleName = cells[1] || "未分类模块";
    if (!modules.has(moduleName)) modules.set(moduleName, []);
    modules.get(moduleName)?.push(cells);
  }
  return [...modules.entries()].map(([moduleName, moduleRows]) => ({
    id: randomUUID(),
    title: moduleName,
    children: { attached: moduleRows.map(caseTopic) },
  }));
}

export function buildXmindWorkbook(title: string, collections: Array<{ name?: string; rows: RowLike[] }>): Buffer {
  const attached = collections.length === 1 && !collections[0].name
    ? rowsToXmindTopics(collections[0].rows)
    : collections.map((collection) => ({
        id: randomUUID(),
        title: collection.name || "测试集",
        children: { attached: rowsToXmindTopics(collection.rows) },
      }));
  const xmindData = [{
    id: randomUUID(),
    class: "sheet",
    title,
    rootTopic: {
      id: randomUUID(),
      title,
      structureClass: "org.xmind.ui.logic.right",
      children: { attached },
    },
  }];
  return createZip([
    { name: "content.json", data: Buffer.from(JSON.stringify(xmindData), "utf8") },
    { name: "metadata.json", data: Buffer.from(JSON.stringify({ creator: { name: "TestGen.AI" } }), "utf8") },
    { name: "manifest.json", data: Buffer.from(JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {} } }), "utf8") },
  ]);
}
