import type { ParsedDocument } from "./types.js";

/** 解析后需求原文的最大长度，超出部分截断并给出 warning。 */
export const MAX_TEXT_CHARS = 50_000;
/** PDF 提取文本低于该长度时视为疑似扫描件。 */
export const PDF_MIN_TEXT_CHARS = 50;
/** 上传文件大小上限（与路由层 express.raw limit 保持一致）。 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_EXTENSIONS = [".md", ".txt", ".docx", ".xlsx", ".xls", ".csv", ".pdf"] as const;

export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentParseError";
  }
}

function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

/** 超长截断：返回截断后的文本与（可能的）warning。 */
export function truncateText(text: string): ParsedDocument {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.length <= MAX_TEXT_CHARS) return { text: normalized, warnings: [], truncated: false };
  return {
    text: normalized.slice(0, MAX_TEXT_CHARS),
    warnings: [`需求文本超过 ${MAX_TEXT_CHARS.toLocaleString()} 字符，已截断为前 ${MAX_TEXT_CHARS.toLocaleString()} 字符进行分析，超出部分不会被覆盖。`],
    truncated: true,
  };
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parseSpreadsheet(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(workbook.SheetNames.length > 1 ? `# ${sheetName}\n${csv}` : csv);
  }
  return parts.join("\n\n");
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = result.text ?? "";
    if (text.trim().length < PDF_MIN_TEXT_CHARS) {
      return {
        text,
        warnings: ["该 PDF 可提取的文本过少，疑似扫描件或图片型 PDF，分析结果可能不完整。"],
        truncated: false,
      };
    }
    return { text, warnings: [], truncated: false };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/**
 * 按扩展名分发解析上传的需求文档，返回纯文本与 warning 列表。
 * 不支持的格式、空文本直接抛 DocumentParseError。
 */
export async function parseRequirementDocument(filename: string, buffer: Buffer): Promise<ParsedDocument> {
  const ext = extensionOf(filename);
  if (!ext) throw new DocumentParseError("缺少文件扩展名，无法识别文档格式。");
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new DocumentParseError(`不支持 ${ext} 格式，请上传 ${SUPPORTED_EXTENSIONS.join(" / ")} 文档，或直接粘贴文本。`);
  }

  let parsed: ParsedDocument;
  if (ext === ".md" || ext === ".txt" || ext === ".csv") {
    // CSV 直接按纯文本处理：XLSX.read 对 UTF-8 中文 CSV 会按错误代码页解码产生乱码。
    parsed = { text: buffer.toString("utf8"), warnings: [], truncated: false };
  } else if (ext === ".docx") {
    parsed = { text: await parseDocx(buffer), warnings: [], truncated: false };
  } else if (ext === ".pdf") {
    parsed = await parsePdf(buffer);
  } else {
    parsed = { text: await parseSpreadsheet(buffer), warnings: [], truncated: false };
  }

  if (!parsed.text.trim()) {
    throw new DocumentParseError("未能从文档中提取到文本内容，请确认文件不是空文档或扫描件。");
  }

  const truncated = truncateText(parsed.text);
  return {
    text: truncated.text,
    warnings: [...parsed.warnings, ...truncated.warnings],
    truncated: truncated.truncated,
  };
}
