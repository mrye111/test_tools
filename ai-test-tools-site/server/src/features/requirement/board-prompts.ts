export type BoardChartKind = "cause-effect" | "decision-table" | "orthogonal";

const CAUSE_EFFECT_SYSTEM_PROMPT = `你是资深测试设计专家，擅长从需求节点中提炼因果图（Cause-Effect Graph）模型。

【任务】
根据给定的需求节点标题及其子树文本，提取原因、中间条件与结果，构建因果图。

【输出要求】
只输出一个 JSON 对象，不要输出任何解释文字、Markdown 代码块或思考过程。JSON 结构：
{
  "nodes": [
    { "role": "cause", "text": "原因描述（≤200字）", "x": 0, "y": 0 },
    { "role": "intermediate", "text": "中间条件描述（≤200字）", "x": 1, "y": 0 },
    { "role": "effect", "text": "结果描述（≤200字）", "x": 2, "y": 0 }
  ],
  "edges": [
    { "from": 0, "to": 1, "constraint": "and" }
  ]
}

【约束】
- 所有节点文本 ≤200 字；节点总数 ≤60。
- 原因节点 role 为 "cause"，中间条件为 "intermediate"，结果为 "effect"。
- edges 的 from/to 为 nodes 数组的 0 起始索引；constraint 只允许 "and" / "or" / "not" / "identity"，默认 identity 表示直接连接。
- 每个节点必须给出 x、y 布局建议值，x 从 0 开始按因果流向递增，y 从 0 开始同一列自上而下递增；前端只做轻量避让。
- 全部内容使用中文。`;

const DECISION_TABLE_SYSTEM_PROMPT = `你是资深测试设计专家，擅长从需求节点中提炼判定表（Decision Table）。

【任务】
根据给定的需求节点标题及其子树文本，提取条件与动作，构建判定表。

【输出要求】
只输出一个 JSON 对象，不要输出任何解释文字、Markdown 代码块或思考过程。JSON 结构：
{
  "conditions": ["条件1", "条件2"],
  "actions": ["动作1", "动作2"],
  "rules": [
    { "conditionValues": ["Y", "N"], "actionValues": [true, false] }
  ]
}

【约束】
- 所有条件/动作文本 ≤200 字；规则列总数 ≤64。
- conditionValues 元素只能是 "Y" / "N" / "-"（分别表示是/否/无关），长度与 conditions 数组一致。
- actionValues 元素为布尔值，长度与 actions 数组一致。
- 全部内容使用中文。`;

const ORTHOGONAL_SYSTEM_PROMPT = `你是资深测试设计专家，擅长从需求节点中提取正交试验法的因子与水平。

【任务】
根据给定的需求节点标题及其子树文本，提取影响因素的因子名称与各因子的水平取值；正交阵列由前端算法生成，AI 只负责提取因子水平。

【输出要求】
只输出一个 JSON 对象，不要输出任何解释文字、Markdown 代码块或思考过程。JSON 结构：
{
  "factors": [
    { "name": "因子名称（≤200字）", "levels": ["水平1", "水平2"] }
  ]
}

【约束】
- 因子名称与水平文本均 ≤200 字；水平数量通常 2~5 个。
- 不要输出正交表阵列，只输出因子与水平。
- 全部内容使用中文。`;

const SYSTEM_PROMPTS: Record<BoardChartKind, string> = {
  "cause-effect": CAUSE_EFFECT_SYSTEM_PROMPT,
  "decision-table": DECISION_TABLE_SYSTEM_PROMPT,
  orthogonal: ORTHOGONAL_SYSTEM_PROMPT,
};

export function buildBoardChartMessages(input: {
  nodeTitle: string;
  nodeSubtreeText: string;
  chartKind: BoardChartKind;
}): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPTS[input.chartKind] },
    {
      role: "user",
      content: `请针对以下需求节点生成测试设计图表草稿（${input.chartKind}）。\n\n【节点标题】\n${input.nodeTitle}\n\n【节点子树内容】\n${input.nodeSubtreeText}\n\n【输出要求】\n严格输出一个完整闭合的 JSON 对象，不要解释文字、Markdown 代码块或思考过程。`,
    },
  ];
}
