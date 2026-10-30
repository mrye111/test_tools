/** 收割映射：把 Midscene 动作事件（Tap@point / Input / SelectOption / Scroll）映射回快照元素序号，产出训练标签。 */

import type { FastElement, FastSnapshot } from "./snapshot.js";
import type { FastOperation } from "./decision-backend.js";

/** Midscene 进度事件里 action 的最小结构（@midscene/core 的 action 形态）。 */
export type MidsceneAction = {
  name?: string;
  point?: [number, number];
  param?: unknown;
};

export type HarvestedLabel = {
  operation: "CLICK" | "TYPE_TEXT" | "SELECT" | "SCROLL_UP" | "SCROLL_DOWN";
  target?: string;
  text?: string;
};

/** 动作名归类（Midscene 1.13 常见动作名）。 */
const CLICK_NAMES = new Set(["Tap", "Click", "LeftClick", "DoubleClick", "RightClick", "Hover", "LongPress"]);
const INPUT_NAMES = new Set(["Input", "Type", "TypeText", "Fill"]);
const SELECT_NAMES = new Set(["SelectOption", "Select"]);
const SCROLL_NAMES = new Set(["Scroll", "ScrollDown", "ScrollUp", "MouseWheel"]);

function bboxContains(el: FastElement, x: number, y: number, slack = 2): boolean {
  return x >= el.bbox.x - slack && x <= el.bbox.x + el.bbox.w + slack && y >= el.bbox.y - slack && y <= el.bbox.y + el.bbox.h + slack;
}

function centerDistance(el: FastElement, x: number, y: number): number {
  const cx = el.bbox.x + el.bbox.w / 2;
  const cy = el.bbox.y + el.bbox.h / 2;
  return Math.hypot(cx - x, cy - y);
}

/** 用坐标找目标元素：先精确命中 bbox，否则取最近中心（阈值内）。 */
export function findElementAtPoint(snapshot: FastSnapshot, x: number, y: number, maxDistancePx = 40): FastElement | null {
  const hits = snapshot.elements.filter((el) => bboxContains(el, x, y));
  if (hits.length > 0) {
    return hits.sort((a, b) => centerDistance(a, x, y) - centerDistance(b, x, y))[0];
  }
  let nearest: FastElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const el of snapshot.elements) {
    const distance = centerDistance(el, x, y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = el;
    }
  }
  return nearestDistance <= maxDistancePx ? nearest : null;
}

/** 从动作 param 提取输入文本（Midscene Input 的 param 形态：{value} 或 {text} 或字符串）。 */
function extractInputText(param: unknown): string | null {
  if (typeof param === "string") return param || null;
  if (typeof param === "object" && param !== null) {
    const record = param as Record<string, unknown>;
    for (const key of ["value", "text", "content"]) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
  }
  return null;
}

/** 从动作 param 提取下拉选择值。 */
function extractSelectValue(param: unknown): string | null {
  if (typeof param === "string") return param || null;
  if (typeof param === "object" && param !== null) {
    const record = param as Record<string, unknown>;
    for (const key of ["value", "optionValue", "label"]) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
  }
  return null;
}

function scrollDirectionOf(param: unknown): "SCROLL_UP" | "SCROLL_DOWN" {
  if (typeof param === "object" && param !== null) {
    const direction = String((param as Record<string, unknown>).direction ?? "").toLowerCase();
    if (direction === "up") return "SCROLL_UP";
  }
  return "SCROLL_DOWN";
}

/** 单条动作 → 训练标签；无法映射（键盘/JS 动作/坐标无元素命中）返回 null。 */
export function mapActionToLabel(snapshot: FastSnapshot, action: MidsceneAction): HarvestedLabel | null {
  const name = action.name ?? "";
  const point = action.point;

  if (INPUT_NAMES.has(name)) {
    const element = point ? findElementAtPoint(snapshot, point[0], point[1]) : null;
    const text = extractInputText(action.param);
    if (!element || !text) return null;
    return { operation: "TYPE_TEXT", target: String(element.index), text };
  }

  if (SELECT_NAMES.has(name)) {
    const element = point ? findElementAtPoint(snapshot, point[0], point[1]) : null;
    const value = extractSelectValue(action.param);
    if (!element || element.kind !== "select" || !value) return null;
    const option = element.options?.find((o) => o.value === value || o.label === value);
    if (!option) return null;
    return { operation: "SELECT", target: option.index };
  }

  if (SCROLL_NAMES.has(name)) {
    return { operation: scrollDirectionOf(action.param) };
  }

  if (CLICK_NAMES.has(name)) {
    if (!point) return null;
    const element = findElementAtPoint(snapshot, point[0], point[1]);
    if (!element) return null;
    return { operation: "CLICK", target: String(element.index) };
  }

  return null;
}
