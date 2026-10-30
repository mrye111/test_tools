# Docling 文档解析 Sidecar

把开源的 [Docling](https://github.com/docling-project/docling)（MIT）以官方 [docling-serve](https://github.com/docling-project/docling-serve)（MIT）REST 服务的形式跑成本地 sidecar，为「测试用例」模块的三个 AI 生成弹窗（添加测试用例集 / 补充需求 / 优化用例）提供**参考文件解析**：PDF、Word、PPT、Excel、HTML、Markdown、图片（OCR）等提取为 Markdown 文本。

与 `laya-sidecar/` 同构的运维形态：独立 Python 服务，手动启动；Node 端 `server/src/features/testcase/reference-parse.ts` 只做 HTTP 转发（`POST /v1/convert/file`，取 `document.md_content`）。

## 启动

```bash
cd ai-test-tools-site/server/docling-sidecar
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
docling-serve run --host 127.0.0.1 --port 5001
```

服务地址默认 `http://127.0.0.1:5001`；Node 端可用环境变量 `DOCLING_SERVE_URL` 覆盖。

## ⚠️ 首次启动必须联网预热一次

docling 首次转换会下载版面分析/OCR 等模型（合计约几百 MB），之后**缓存到本地、断网也能用**。
建议启动后立即用一份样例文档预热：

```bash
curl -X POST http://127.0.0.1:5001/v1/convert/file -F "files=@样例需求.docx" -F "to_formats=md"
```

返回 JSON 中出现 `document.md_content` 即预热完成。预热之后即可在内网/离线环境正常使用。

## 接口（Node 侧对接的最小面）

- `POST /v1/convert/file`（multipart，字段名 `files`，选项 `to_formats=md`）
- 响应：`{ document: { md_content, ... }, status, processing_time, errors[] }`

单文件限制：20MB（Node 路由层限制）；解析文本超过 5 万字符自动截断（前端卡片提示）。

## 与需求分析解析器的关系

平台上有两套文档解析并存：

1. **需求分析（requirement-v2）**：Node 内的 JS 解析器（mammoth / pdf-parse / xlsx），接口 `/api/requirement-analysis-v2/parse-document`；
2. **测试用例参考文件（本 sidecar）**：docling 提取文本，接口 `/api/testcase/parse-reference`，OCR/复杂排版能力更强。

后续可评估统一到 docling 一套，届时需求分析的解析入口也切到本 sidecar。
