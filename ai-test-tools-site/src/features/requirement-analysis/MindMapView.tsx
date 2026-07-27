import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Markmap } from 'markmap-view'
import type { IPureNode } from 'markmap-common'
import type { RequirementNode } from '../../lib/requirement-analysis-api'
import { nodeLabelWithBadge } from '../../lib/requirement-export'

export interface ChartExportHandle {
  getPngDataUrl: () => Promise<string | null>
}

/** 图表画布需要的缩放控制：fit 后缩放比基线为 1（100%）。 */
export interface ChartCanvasHandle extends ChartExportHandle {
  /** 以视口中心为锚点，按 factor 相对当前缩放增量缩放。 */
  zoomBy: (factor: number) => void
  /** 回到"适应屏幕"状态并以其为缩放基线；resolve 时图表已稳定，可安全取图。 */
  fit: () => Promise<void>
}

type MindMapViewProps = {
  tree: RequirementNode
  findingCounts: Map<string, number>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  /** 缩放比变化回调（1 = 适应屏幕基线）；画布工具栏用于显示当前百分比。 */
  onZoomScaleChange?: (ratio: number) => void
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

/** 读取 markmap 当前 d3-zoom 变换的缩放值（d3 将 transform 存于 svg 元素的 __zoom 属性）。 */
function readMarkmapScale(svg: SVGSVGElement): number | null {
  const zoom = (svg as unknown as { __zoom?: { k?: unknown } }).__zoom
  if (!zoom) warnPrivateApiOnce('__zoom')
  return typeof zoom?.k === 'number' && zoom.k > 0 ? zoom.k : null
}

// markmap.zoom / __zoom 均为私有 API（markmap-view 仍是 0.x，升级可能改名/移除）：
// 缺失时一次性告警，而不是让缩放百分比无声停更
let privateApiWarned = false
function warnPrivateApiOnce(what: string) {
  if (privateApiWarned) return
  privateApiWarned = true
  console.warn(`思维导图依赖的 markmap/d3 内部 API（${what}）缺失，缩放百分比将停更，请检查 markmap-view 版本。`)
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
export const MindMapView = forwardRef<ChartCanvasHandle, MindMapViewProps>(function MindMapView(props, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const markmapRef = useRef<Markmap | null>(null)
  const onSelectNodeRef = useRef(props.onSelectNode)
  onSelectNodeRef.current = props.onSelectNode
  const onZoomScaleChangeRef = useRef(props.onZoomScaleChange)
  onZoomScaleChangeRef.current = props.onZoomScaleChange
  // fit（适应屏幕）状态的 transform.k，作为缩放比基线（1 = 100%）
  const zoomBaselineRef = useRef<number | null>(null)

  const data = useMemo(() => toMarkmapNode(props.tree, props.findingCounts), [props.tree, props.findingCounts])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    zoomBaselineRef.current = null
    const markmap = Markmap.create(svg, { autoFit: true, duration: 200 })
    markmapRef.current = markmap

    const reportZoomRatio = () => {
      const scale = readMarkmapScale(svg)
      const baseline = zoomBaselineRef.current
      if (scale !== null && baseline !== null) {
        onZoomScaleChangeRef.current?.(scale / baseline)
      }
    }
    // markmap.zoom 是实例内部字段（d3-zoom behavior），缺失时告警而非静默停更
    if (typeof markmap.zoom?.on === 'function') {
      markmap.zoom.on('zoom.canvas', reportZoomRatio)
    } else {
      warnPrivateApiOnce('markmap.zoom')
    }

    let cancelled = false
    // 数据渲染完成后再等一次 fit 过渡结束，以稳定后的缩放作为基线（初始 = 100%）
    void (async () => {
      try {
        await markmap.setData(data)
        if (cancelled) return
        await markmap.fit()
        if (cancelled) return
        zoomBaselineRef.current = readMarkmapScale(svg) ?? 1
        onZoomScaleChangeRef.current?.(1)
      } catch (error) {
        // 渲染/过渡失败（含卸载后 destroy 引发的拒绝）：回退基线为 1，避免缩放百分比永久停更
        console.error('思维导图初始化渲染失败', error)
        if (!cancelled) zoomBaselineRef.current = 1
      }
    })()

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('.markmap-node') : null
      onSelectNodeRef.current(ridOf(target))
    }
    svg.addEventListener('click', handleClick)
    return () => {
      cancelled = true
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
    zoomBy: (factor) => {
      if (!(factor > 0) || !Number.isFinite(factor)) return
      // markmap rescale：以视口中心为锚点，相对当前 transform 乘以 factor
      void markmapRef.current?.rescale(factor)
    },
    fit: async () => {
      const markmap = markmapRef.current
      const svg = svgRef.current
      if (!markmap || !svg) return
      try {
        await markmap.fit()
      } catch (error) {
        // 过渡被中断/组件已卸载：保持现状，不刷新基线
        console.error('思维导图适应屏幕失败', error)
        return
      }
      zoomBaselineRef.current = readMarkmapScale(svg) ?? 1
      onZoomScaleChangeRef.current?.(1)
    },
  }), [])

  return <svg ref={svgRef} className="requirement-chart-canvas requirement-mindmap" aria-label="需求分解树思维导图" />
})
