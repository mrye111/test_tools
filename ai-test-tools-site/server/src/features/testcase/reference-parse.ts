/**
 * 参考文件解析：转发 docling-serve（Python sidecar，端口 5001）提取文档文本。
 * 与 laya-sidecar 同构的运维形态：Node 侧只做 HTTP 转发 + 健康探测，模型与解析都在 Python 侧。
 */

const DEFAULT_DOCLING_BASE = "http://127.0.0.1:5001";
/** 单个参考文件解析后的最大字符数（沿用需求分析 MAX_TEXT_CHARS 惯例）。 */
export const MAX_REFERENCE_TEXT_CHARS = 50_000;
/** 单文件大小上限（含扫描件 PDF 放宽至 20MB）。 */
export const MAX_REFERENCE_FILE_BYTES = 20 * 1024 * 1024;

export class ReferenceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceParseError";
  }
}

export interface ParsedReference {
  text: string;
  truncated: boolean;
  /** docling 侧处理状态（success/partial_success/skipped/failure）。 */
  status: string;
}

function doclingBase(): string {
  const raw = process.env.DOCLING_SERVE_URL ?? DEFAULT_DOCLING_BASE;
  return raw.replace(/\/+$/, "");
}

/** 文件扩展名 → docling-serve multipart 用的 MIME（仅辅助服务端嗅探，docling 按内容识别）。 */
function mimeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    md: "text/markdown",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * 调 docling-serve `POST /v1/convert/file` 解析单个文件，返回 Markdown 文本（超长截断）。
 * 连接失败抛 ReferenceParseError（解析服务未启动/不可达），其余错误透传 docling 的 errors。
 */
export async function parseReferenceFile(
  filename: string,
  buffer: Buffer,
  options: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<ParsedReference> {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? doclingBase()).replace(/\/+$/, "");

  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buffer)], { type: mimeFor(filename) }), filename);
  form.append("to_formats", "md");

  let response: Response;
  try {
    response = await doFetch(`${base}/v1/convert/file`, { method: "POST", body: form });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReferenceParseError(`解析服务未启动或不可达（${message}）`);
  }
  if (!response.ok) {
    throw new ReferenceParseError(`解析服务返回 HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ReferenceParseError("解析服务返回了无法解析的响应");
  }
  const parsed = payload as { document?: { md_content?: unknown }; status?: unknown; errors?: unknown };
  const status = String(parsed.status ?? "success");
  const text = typeof parsed.document?.md_content === "string" ? parsed.document.md_content : "";

  // 移除 docling 的图片占位符（如 <!-- image -->、<!-- image: xxx.png -->）与 markdown 语法符号
  const meaningfulText = text
    .replace(/<!--\s*image[^>]*-->/gi, '')
    .replace(/[#*_`~>\-\+\|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 有效文字判定：至少包含 3 个连续字母/数字/中文字符的单词
  const hasValidWords = /\b[a-z0-9]{3,}\b|[一-龥]{2,}/i.test(meaningfulText);

  if (!text.trim() || !hasValidWords) {
    const reason = Array.isArray(parsed.errors) && parsed.errors.length > 0
      ? `（${parsed.errors.map(String).join("；")}）`
      : "";
    const hint = text.includes('<!-- image -->')
      ? '（图片无文字层或 OCR 未命中，仅支持带文字的图片/扫描件；纯图形请上传配套文字说明文档）'
      : '';
    throw new ReferenceParseError(`未能从该文件提取出有效文本${reason}${hint}`);
  }

  if (text.length <= MAX_REFERENCE_TEXT_CHARS) {
    return { text, truncated: false, status };
  }
  return { text: text.slice(0, MAX_REFERENCE_TEXT_CHARS), truncated: true, status };
}
