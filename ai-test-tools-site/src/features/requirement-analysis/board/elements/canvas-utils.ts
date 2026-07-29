/** Canvas 绘制通用工具函数 */

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 按最大宽度截断文本，超出加 "…" */
export function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let i = text.length
  while (i > 0) {
    const candidate = `${text.slice(0, i)}…`
    if (ctx.measureText(candidate).width <= maxW) return candidate
    i -= 1
  }
  return '…'
}

/** 绘制选中图元的外描 accent 框 */
export function drawSelectionOutline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  selected: boolean,
  accent: string
): void {
  if (!selected) return
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  roundRect(ctx, -2, -2, w + 4, h + 4, 14)
  ctx.stroke()
}
