import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileChooser, Page } from "playwright";
import { installUploadInjector, pickUploadFiles, type UploadFileRef } from "./upload-inject.js";

// 附件库真实存储名是 <uuid>-<safeName>，与展示名不同——用真临时文件覆盖这条差异
let tmpDir = "";
let FILES: UploadFileRef[] = [];

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "upload-inject-test-"));
  const specs: [UploadFileRef, string][] = [
    [{ filename: "users.csv", path: join(tmpDir, "1-users.csv") }, "id,name\n1,alice\n"],
    [{ filename: "avatar.png", path: join(tmpDir, "2-avatar.png") }, "png-bytes"],
    [{ filename: "合同.pdf", path: join(tmpDir, "3-合同.pdf") }, "pdf-bytes"],
  ];
  for (const [ref, content] of specs) {
    await writeFile(ref.path, content);
  }
  FILES = specs.map(([ref]) => ref);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("pickUploadFiles", () => {
  it("步骤文本提到文件名时优先命中（大小写不敏感，可多文件）", () => {
    expect(pickUploadFiles(FILES, "上传 Users.CSV 和 avatar.png 到表单")).toEqual([FILES[0], FILES[1]]);
    expect(pickUploadFiles(FILES, "点击导入按钮，选择 合同.pdf")).toEqual([FILES[2]]);
  });

  it("无文件名命中时按 accept 扩展名匹配取第一个", () => {
    expect(pickUploadFiles(FILES, "点击上传按钮", ".png,.pdf")).toEqual([FILES[1]]);
    expect(pickUploadFiles(FILES, "点击上传按钮", " .PDF ")).toEqual([FILES[2]]);
  });

  it("accept 只有 MIME 项时不匹配扩展名，落到单文件/首文件兜底", () => {
    expect(pickUploadFiles([FILES[0]!], "上传附件", "image/*,text/csv")).toEqual([FILES[0]]);
    expect(pickUploadFiles(FILES, "上传附件", "image/*")).toEqual([FILES[0]]);
  });

  it("无 accept 时单文件取它，多文件取第一个", () => {
    expect(pickUploadFiles([FILES[1]!], "上传附件")).toEqual([FILES[1]]);
    expect(pickUploadFiles(FILES, "上传附件", null)).toEqual([FILES[0]]);
    expect(pickUploadFiles(FILES, "上传附件")).toEqual([FILES[0]]);
  });

  it("附件库为空时不注入", () => {
    expect(pickUploadFiles([], "上传 users.csv")).toEqual([]);
  });
});

describe("installUploadInjector", () => {
  function makePage() {
    const handlers: ((chooser: FileChooser) => void)[] = [];
    const page = {
      on: (_event: string, handler: (chooser: FileChooser) => void) => handlers.push(handler),
      off: (_event: string, handler: (chooser: FileChooser) => void) => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      },
    } as unknown as Page;
    return { page, handlers };
  }

  function makeChooser(accept: string | null) {
    const setFiles = vi.fn(async () => undefined);
    const chooser = {
      element: () => ({ getAttribute: async () => accept }),
      setFiles,
    } as unknown as FileChooser;
    return { chooser, setFiles };
  }

  it("弹出文件选择对话框时按步骤文本注入（载荷带原始文件名与内容，非存储路径）", async () => {
    const { page, handlers } = makePage();
    let stepText = "在导入页点击上传，选择 users.csv";
    const dispose = installUploadInjector(page, FILES, () => stepText);
    const { chooser, setFiles } = makeChooser(".csv");
    handlers[0]!(chooser);
    await vi.waitFor(() =>
      expect(setFiles).toHaveBeenCalledWith([
        { name: "users.csv", mimeType: "text/csv", buffer: Buffer.from("id,name\n1,alice\n") },
      ]),
    );

    stepText = "点击上传按钮";
    const png = makeChooser(".png");
    handlers[0]!(png.chooser);
    await vi.waitFor(() =>
      expect(png.setFiles).toHaveBeenCalledWith([
        { name: "avatar.png", mimeType: "image/png", buffer: Buffer.from("png-bytes") },
      ]),
    );
    dispose();
  });

  it("dispose 移除监听（共享会话不残留）", () => {
    const { page, handlers } = makePage();
    const dispose = installUploadInjector(page, FILES, () => "");
    expect(handlers).toHaveLength(1);
    dispose();
    expect(handlers).toHaveLength(0);
  });
});
