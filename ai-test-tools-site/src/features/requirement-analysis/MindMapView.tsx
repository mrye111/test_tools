import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Markmap } from 'markmap-view'
import type { IPureNode } from 'markmap-common'
import type { RequirementNode } from '../../lib/requirement-analysis-api'
import { nodeLabelWithBadge } from '../../lib/requirement-export'

export interface ChartExportHandle {
  getPngDataUrl: () => Promise<string | null>
}

type MindMapViewProps = {
  tree: RequirementNode
  findingCounts: Map<string, number>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toMarkmapNode(node: RequirementNode, counts: Map<string, number>): IPureNode {
  return {
    content: escapeHtml(nodeLabelWithBadge(node, counts)),
    payload: { rid: node.id },
    children: node.children.map((child) => toMarkmapNode(child, counts)),
  }
}

/** 从 d3 绑定的 DOM datum 中读取需求节点 id（payload.rid）。 */
function ridOf(element: Element | null): string | null {
  if (!element) return null
  const datum = (element as unknown as { __data__?: { data?: { payload?: { rid?: unknown } } } }).__data__
  const rid = datum?.data?.payload?.rid
  return typeof rid === 'string' ? rid : null
}

async function svgToPngDataUrl(svg: SVGSVGElement): Promise<string | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const width = Math.max(svg.clientWidth, 1)
  const height = Math.max(svg.clientHeight, 1)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('SVG 转图片失败'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 思维导图：markmap 渲染需求分解树。 */
export const MindMapView = forwardRef<ChartExportHandle, MindMapViewProps>(function MindMapView(props, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const markmapRef = useRef<Markmap | null>(null)
  const onSelectNodeRef = useRef(props.onSelectNode)
  onSelectNodeRef.current = props.onSelectNode

  const data = useMemo(() => toMarkmapNode(props.tree, props.findingCounts), [props.tree, props.findingCounts])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const markmap = Markmap.create(svg, { autoFit: true, duration: 200 }, data)
    markmapRef.current = markmap

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('.markmap-node') : null
      onSelectNodeRef.current(ridOf(target))
    }
    svg.addEventListener('click', handleClick)
    return () => {
      svg.removeEventListener('click', handleClick)
      markmap.destroy()
      markmapRef.current = null
    }
  }, [data])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.querySelectorAll('.markmap-node').forEach((element) => {
      element.classList.toggle('is-selected', ridOf(element) === props.selectedNodeId)
    })
  }, [props.selectedNodeId, data])

  useImperativeHandle(ref, () => ({
    getPngDataUrl: async () => (svgRef.current ? svgToPngDataUrl(svgRef.current) : null),
  }), [])

  return <svg ref={svgRef} className="requirement-chart-canvas requirement-mindmap" aria-label="需求分解树思维导图" />
})
