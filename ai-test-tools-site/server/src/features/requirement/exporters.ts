import { randomUUID } from "node:crypto";
import { createZip } from "../testcase/zip.js";
import { FINDING_TYPE_LABELS, type Finding, type RequirementChartType, type RequirementNode } from "./types.js";

const STRUCTURE_CLASSES: Record<RequirementChartType, string> = {
  mindmap: "org.xmind.ui.map.unbalanced",
  tree: "org.xmind.ui.orgChart",
  logic: "org.xmind.ui.logic.right",
};

type XMindTopic = {
  id: string;
  title: string;
  structureClass?: string;
  notes?: { plain: { content: string } };
  children?: { attached: XMindTopic[] };
};

function findingsNote(findings: Finding[]): string | null {
  if (!findings.length) return null;
  return findings
    .map((finding) => `【${FINDING_TYPE_LABELS[finding.type]}】${finding.title}\n${finding.detail}`)
    .join("\n\n");
}

function toTopic(node: RequirementNode, findingsByNode: Map<string, Finding[]>): XMindTopic {
  const topic: XMindTopic = { id: randomUUID(), title: node.title };
  const note = findingsNote(findingsByNode.get(node.id) ?? []);
  if (note) topic.notes = { plain: { content: note } };
  if (node.children.length) {
    topic.children = { attached: node.children.map((child) => toTopic(child, findingsByNode)) };
  }
  return topic;
}

/**
 * 生成需求分析 XMind 工作簿：分解树为 topic 树，
 * 分析结论写入对应 topic 的 notes，structureClass 跟随当前图表类型。
 */
export function buildRequirementXmind(args: {
  title: string;
  tree: RequirementNode;
  findings: Finding[];
  chartType: RequirementChartType;
}): Buffer {
  const title = args.title.trim() || "需求分析";
  const findingsByNode = new Map<string, Finding[]>();
  for (const finding of args.findings) {
    const list = findingsByNode.get(finding.nodeId) ?? [];
    list.push(finding);
    findingsByNode.set(finding.nodeId, list);
  }

  const rootTopic = toTopic(args.tree, findingsByNode);
  rootTopic.structureClass = STRUCTURE_CLASSES[args.chartType] ?? STRUCTURE_CLASSES.mindmap;

  const xmindData = [{
    id: randomUUID(),
    class: "sheet",
    title,
    rootTopic,
  }];
  return createZip([
    { name: "content.json", data: Buffer.from(JSON.stringify(xmindData), "utf8") },
    { name: "metadata.json", data: Buffer.from(JSON.stringify({ creator: { name: "NexusKit 需求分析" } }), "utf8") },
    { name: "manifest.json", data: Buffer.from(JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {} } }), "utf8") },
  ]);
}
