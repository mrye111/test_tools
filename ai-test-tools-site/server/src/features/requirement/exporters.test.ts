import { describe, expect, it } from "vitest";
import { readZipEntries } from "../testcase/zip.js";
import { buildRequirementXmind } from "./exporters.js";
import type { Finding, RequirementNode } from "./types.js";

const tree: RequirementNode = {
  id: "n1",
  title: "订单系统",
  children: [
    {
      id: "n2",
      title: "订单管理",
      children: [{ id: "n3", title: "退款规则", children: [] }],
    },
  ],
};

const findings: Finding[] = [
  { id: "f1", type: "risk", title: "并发退款风险", detail: "重复提交可能重复退款", nodeId: "n3" },
  { id: "f2", type: "clarification", title: "退款时限未定", detail: "需确认退款到账时限", nodeId: "n2" },
];

type XMindNote = { plain: { content: string } };
type XMindTopicShape = {
  title: string;
  notes?: XMindNote;
  children?: { attached: XMindTopicShape[] };
};

function readContentJson(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const content = entries.get("content.json");
  expect(content).toBeDefined();
  const sheets = JSON.parse(content!.toString("utf8")) as Array<{
    rootTopic: XMindTopicShape & { structureClass: string };
  }>;
  return sheets;
}

describe("buildRequirementXmind", () => {
  it("structureClass 跟随图表类型", () => {
    const cases = [
      { chartType: "mindmap" as const, expected: "org.xmind.ui.map.unbalanced" },
      { chartType: "tree" as const, expected: "org.xmind.ui.orgChart" },
      { chartType: "logic" as const, expected: "org.xmind.ui.logic.right" },
    ];
    for (const { chartType, expected } of cases) {
      const [sheet] = readContentJson(buildRequirementXmind({ title: "订单系统", tree, findings, chartType }));
      expect(sheet.rootTopic.structureClass).toBe(expected);
    }
  });

  it("findings 写入对应 topic 的 notes", () => {
    const [sheet] = readContentJson(buildRequirementXmind({ title: "订单系统", tree, findings, chartType: "mindmap" }));
    const moduleTopic = sheet.rootTopic.children?.attached[0];
    expect(moduleTopic?.title).toBe("订单管理");
    expect(moduleTopic?.notes?.plain.content).toContain("退款时限未定");
    const ruleTopic = moduleTopic?.children?.attached[0];
    expect(ruleTopic?.title).toBe("退款规则");
    expect(ruleTopic?.notes?.plain.content).toContain("并发退款风险");
    expect(ruleTopic?.notes?.plain.content).toContain("【风险点】");
  });

  it("标题缺省时回退为根节点标题", () => {
    const [sheet] = readContentJson(buildRequirementXmind({ title: "", tree, findings: [], chartType: "tree" }));
    expect(sheet.rootTopic.title).toBe("订单系统");
  });
});
