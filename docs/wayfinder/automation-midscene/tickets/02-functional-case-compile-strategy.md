---
title: 功能用例→AI 指令编译策略调研
type: research
status: closed
assignee: agent-research-02
blocked_by: []
---

## Question

「测试用例页执行按钮」要把现有功能用例（前置条件 + 测试步骤 + 预期结果，均为自然语言文本）变成可执行的 AI 指令序列。对比两种策略并给出推荐：

- **A. 逐条直映**：每个步骤文本直接 `aiAct`，最后对预期结果整体 `aiAssert`。零额外成本，但步骤文本粒度/歧义直接影响成功率。
- **B. LLM 预编译**：先用文本 LLM 把整条用例编译成结构化指令序列（动作/断言/等待/数据提取，含歧义消解与参数化），再逐条执行。多一次 LLM 调用，换来指令质量。

需要做的具体工作：

1. 从 `server/src/features/testcase/`（types.ts、prompts.ts、mysql-persistence.ts）梳理功能用例的确切数据结构与文本形态；
2. 抽样真实用例文本（优先读 MySQL 中已有用例集——连接配置见 server 目录配置；DB 不可达则退而用仓库根 `TestCase/` 目录与导出器样例推断典型形态）；
3. 评估两种策略在抽样文本上的可执行性风险（步骤含合并操作、含糊谓词、测试数据变量等情况各占多少）；
4. 给出推荐与 B 策略的 prompt 设计草案（若推荐 B）。

## Resolution

**推荐 B（LLM 预编译）为主、A（逐条直映）为可选降级路径。** 依据：本机 MySQL 全量 115 条真实功能用例（登录集 20 + 包年套餐集 95）统计——38% 含浏览器内不可执行的后端操作（触发结算/发起调用/看日志/抓包）、23% 含合并操作步骤、59% 预期含多断言子句、66 条预期带"成功/正常"模糊谓词、100% 步骤为 `1.2.3.` 编号单段文本且换行存在两种形态（字面 `\n` 95 条 / 真实换行 20 条，须确定性归一化）、0% 含 URL（入口必须外部注入）。

定稿要点：

- 编译产物 **CompiledPlan**（JSON）：原子 act/assert/wait/extract 指令 + **manualItems 标注** + **executable（full/partial/manual）评级** + fromStep/fromExpected 溯源；按 caseId+文本 hash 缓存，改例自动重编
- 执行映射：act→aiAct / assert→aiAssert / wait→aiWaitFor / extract→aiQuery+变量表；manual→跳过并如实记入报告，partial 用例不得呈现为"全部自动化通过"
- 编译输入前做确定性预处理（换行归一化、编号切分，复用 csv.ts:64 同款逻辑）；编译产物用确定性校验（JSON schema + 溯源范围 + assert 非动作开头），失败自动重编一次，再失败降级 A 模式并标记 compileFailed
- `entryUrl` / `appBrief` 由项目/环境配置注入（给编译器页面结构先验，防编造导航路径）
- 数值断言编译期改写成纯比对形式（防 VLM 算错账）；"记录 X 供后续用"编译为 extract.saveAs + `{{var}}` 引用
- 执行结果回写位已存在：`TestSetRecord.executionStatus`（types.ts:3-8, 33），无需改数据模型
- zentao 类粗粒老手用例编译后基本全 manual——行为正确，UI 需明确提示"无可自动执行内容"

详细统计、策略对比表与预编译 prompt 草案见 [research/02-functional-case-compile.md](../research/02-functional-case-compile.md)。
