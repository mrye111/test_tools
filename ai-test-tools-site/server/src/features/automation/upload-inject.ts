/** P5 Test Files 注入：拦截文件选择对话框，从项目附件库取文件填入（解决「上传类步骤没文件」受阻）。 */

import { readFile } from "node:fs/promises";
import type { FileChooser, Page } from "playwright";
import { logger } from "../../logger.js";

export type UploadFileRef = {
  filename: string;
  /** 服务端绝对路径（由附件库存储，不出 API）。 */
  path: string;
};

/** chooser.setFiles 的文件载荷形状（playwright 未导出该类型名）。 */
type FilePayload = { name: string; mimeType: string; buffer: Buffer };

const MIME_BY_EXT: Record<string, string> = {
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
};

function toFilePayload(ref: UploadFileRef, buffer: Buffer): FilePayload {
  const dot = ref.filename.lastIndexOf(".");
  const ext = dot >= 0 ? ref.filename.slice(dot).toLowerCase() : "";
  return { name: ref.filename, mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream", buffer };
}

/**
 * 选注入文件（确定性优先级，全部命中即注入多文件）：
 * 1) 步骤文本提到附件文件名（大小写不敏感）→ 取全部命中；
 * 2) chooser 的 accept 属性带扩展名（.csv 等）→ 取第一个扩展名命中的；
 * 3) 库中仅一个文件 → 它；
 * 4) 否则取第一个（总好过卡死在原生对话框；注入结果记日志可追溯）。
 * accept 里的 MIME 项（image/*、text/csv 等）不做映射，落到 3/4 兜底。
 */
export function pickUploadFiles(files: UploadFileRef[], stepText: string, accept?: string | null): UploadFileRef[] {
  if (files.length === 0) return [];
  const text = stepText.toLowerCase();
  const named = files.filter((f) => text.includes(f.filename.toLowerCase()));
  if (named.length > 0) return named;
  const exts = (accept ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.startsWith("."));
  for (const ext of exts) {
    const hit = files.find((f) => f.filename.toLowerCase().endsWith(ext));
    if (hit) return [hit];
  }
  return [files[0]!];
}

/**
 * 在页面上安装文件选择拦截器：对话框弹出时按当前步骤文本从附件库选文件填入。
 * 返回 dispose（共享会话场景必须移除监听，防跨运行残留）。
 */
export function installUploadInjector(page: Page, files: UploadFileRef[], getStepText: () => string): () => void {
  const handler = (chooser: FileChooser): void => {
    void (async () => {
      try {
        const accept = await chooser
          .element()
          .getAttribute("accept")
          .catch(() => null);
        const picked = pickUploadFiles(files, getStepText(), accept);
        if (picked.length === 0) return;
        logger.info({ files: picked.map((f) => f.filename) }, "[automation] Test Files 注入：拦截文件选择对话框");
        // 传 FilePayload 而非路径：setFiles(path) 会把存储文件名（含 UUID 前缀）当上传名
        const payloads = await Promise.all(
          picked.map(async (f) => toFilePayload(f, await readFile(f.path))),
        );
        await chooser.setFiles(payloads);
      } catch (error) {
        logger.warn({ err: error }, "[automation] Test Files 注入失败");
      }
    })();
  };
  page.on("filechooser", handler);
  return () => page.off("filechooser", handler);
}
