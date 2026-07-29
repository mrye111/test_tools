import type { RequirementNode } from '../../../../lib/requirement-analysis-api'

/** 需求树参考图布局节点 */
export interface MindmapLayoutNode {
  id: string
  title: string
  x: number
  y: number
  depth: number
}

const COL_WIDTH = 200
const ROW_HEIGHT = 56

/**
 * 简化版 tidy 树布局：按深度分列，叶节点均分纵向空间，
 * 父节点纵向居中于直接子节点。
 */
export function layoutMindmap(tree: RequirementNode): MindmapLayoutNode[] {
  const result: MindmapLayoutNode[] = []
  let nextLeafY = 0

  function layoutNode(node: RequirementNode, depth: number): MindmapLayoutNode[] {
    const x = depth * COL_WIDTH

    if (node.children.length === 0) {
      const y = nextLeafY
      nextLeafY += ROW_HEIGHT
      return [{ id: node.id, title: node.title, x, y, depth }]
    }

    const childRoots: MindmapLayoutNode[] = []
    const childrenLayout: MindmapLayoutNode[] = []

    for (const child of node.children) {
      const childNodes = layoutNode(child, depth + 1)
      childrenLayout.push(...childNodes)
      childRoots.push(childNodes[0])
    }

    const firstChildY = childRoots[0].y
    const lastChildY = childRoots[childRoots.length - 1].y
    const y = (firstChildY + lastChildY) / 2
    const parent = { id: node.id, title: node.title, x, y, depth }

    return [parent, ...childrenLayout]
  }

  result.push(...layoutNode(tree, 0))
  return result
}
