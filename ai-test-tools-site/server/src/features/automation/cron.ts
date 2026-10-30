/** P5 定时：5 段 cron（分 时 日 月 周）分钟粒度匹配器——支持 * 、 、- 、步长（星号斜杠 n）与组合。 */

type FieldSpec = { min: number; max: number; label: string };

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59, label: "分" },
  { min: 0, max: 23, label: "时" },
  { min: 1, max: 31, label: "日" },
  { min: 1, max: 12, label: "月" },
  { min: 0, max: 7, label: "周" },
];

const DOW_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

/** 解析单段为值集合；非法返回 null。 */
function parseField(raw: string, spec: FieldSpec): Set<number> | null {
  const values = new Set<number>();
  if (raw.trim() === "") return null;
  for (const atomRaw of raw.split(",")) {
    const atom = atomRaw.trim();
    if (atom === "") return null;
    const [rangePart, stepPart, ...rest] = atom.split("/");
    if (rest.length > 0 || rangePart === undefined) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) return null;

    let from: number;
    let to: number;
    if (rangePart === "*") {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      from = Number(a);
      to = Number(b);
    } else {
      // 单值带步长（如 5/10）无通用语义，拒绝，防用户误配
      if (stepPart !== undefined) return null;
      from = Number(rangePart);
      to = from;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from < spec.min || to > spec.max || from > to) return null;
    for (let v = from; v <= to; v += step) {
      // 周段 7 与 0 同为周日，参与匹配前归一为 0（区间端点保持原值再展开，5-7 才能覆盖周五~周日）
      values.add(spec.label === "周" && v === 7 ? 0 : v);
    }
  }
  return values.size > 0 ? values : null;
}

/** 校验 cron 表达式；合法返回 null，否则返回中文错误说明。 */
export function validateCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return `需要 5 段（分 时 日 月 周），当前 ${parts.length} 段`;
  for (let i = 0; i < 5; i++) {
    const spec = FIELDS[i]!;
    if (parseField(parts[i]!, spec) === null) return `${spec.label}段「${parts[i]}」不合法（支持 * , - */n 与组合）`;
  }
  return null;
}

/**
 * date（分钟粒度）是否命中表达式。全字段 AND 语义——
 * 与 vixie cron 的「日/周任一命中」略有差异，同时限制两者属罕见配置，AND 更可预期。
 * 非法表达式返回 false（写入侧已用 validateCron 拦截）。
 */
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const values: number[] = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  for (let i = 0; i < 5; i++) {
    const parsed = parseField(parts[i]!, FIELDS[i]!);
    if (parsed === null) return false;
    if (!parsed.has(values[i]!)) return false;
  }
  return true;
}

/** 中文人话描述（UI 展示）；识别不了的组合返回原表达式。 */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || validateCron(expr) !== null) return expr;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const isNum = (v: string): boolean => /^\d+$/.test(v);
  const pad = (v: string): string => v.padStart(2, "0");
  const time = `${pad(hour)}:${pad(minute)}`;
  if (hour === "*" && dom === "*" && month === "*" && dow === "*") {
    const step = minute === "*" ? 1 : minute.startsWith("*/") ? Number(minute.slice(2)) : NaN;
    if (Number.isInteger(step) && step > 0) return step === 1 ? "每分钟" : `每 ${step} 分钟`;
  }
  if (!isNum(minute) || !isNum(hour)) return expr;
  if (dom === "*" && month === "*" && dow === "*") return `每天 ${time}`;
  if (isNum(dow) && dom === "*" && month === "*") return `每周${DOW_NAMES[Number(dow) % 7]} ${time}`;
  if (isNum(dom) && dow === "*" && month === "*") return `每月${Number(dom)}日 ${time}`;
  return expr;
}
