/** 极速引擎 DOM 快照：页面内收集可见可交互元素（编号动作表），借鉴 jev-ultrafast snapshot.js 的角色/命名逻辑。 */

export type FastElementKind = "click" | "fill" | "select";

export type FastElementOption = {
  /** "元素序号:选项序号"（如 "3:2"）。 */
  index: string;
  label: string;
  value: string;
};

export type FastElement = {
  /** 从 1 开始的元素序号（页面内 data-at-fidx 标记同源）。 */
  index: number;
  kind: FastElementKind;
  role: string;
  name: string;
  value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  bbox: { x: number; y: number; w: number; h: number };
  /** select 的候选选项（option 目标用 "i:j" 复合序号）。 */
  options?: FastElementOption[];
};

export type FastSnapshot = {
  url: string;
  title: string;
  text: string;
  elements: FastElement[];
};

/** 快照上限：超出后决策质量下降（Jev 高基数弱项），按 DOM 序截断。 */
const MAX_ELEMENTS = 80;

/** 页面内执行的快照脚本（字符串形式注入 page.evaluate）。 */
export const SNAPSHOT_SCRIPT = `(async () => {
  const MAX = ${MAX_ELEMENTS};
  const TEXT_LIMIT = 4000;
  const MARK = 'data-at-fidx';
  // 清掉上次标记，保证序号与本次快照一致
  for (const el of document.querySelectorAll('[' + MARK + ']')) el.removeAttribute(MARK);

  // 只排 file/hidden：与 jev-ultrafast 不同，密码框保留——测试工具的登录流程就是要填密码（凭据走服务端配置）
  const safe = (e) => !['file', 'hidden'].includes(e.type);
  const visible = (e) => {
    if (e.closest('[aria-hidden="true"],[inert]')) return false;
    if (typeof e.checkVisibility === 'function') {
      try { if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; } catch {}
    }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const nameOf = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const labelledBy = (e.getAttribute('aria-labelledby') || '').split(/\\s+/)
      .map((id) => nameOf(document.getElementById(id), seen)).filter(Boolean).join(' ');
    if (labelledBy) return labelledBy;
    const aria = e.getAttribute('aria-label');
    if (aria) return aria;
    if (e.labels && e.labels.length) {
      const text = [...e.labels].map((l) => l.innerText.trim()).filter(Boolean).join(' ');
      if (text) return text;
    }
    if (['button', 'submit', 'reset'].includes(e.type) && e.value) return e.value;
    if (e.tagName !== 'INPUT' && e.tagName !== 'SELECT' && e.tagName !== 'TEXTAREA') {
      const text = (e.innerText || '').trim().replace(/\\s+/g, ' ');
      if (text) return text.slice(0, 80);
    }
    return e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('name') || '';
  };
  const ROLES = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'combobox', 'textbox', 'searchbox', 'spinbutton', 'listbox'];
  const roleOf = (e) => {
    const explicit = e.getAttribute('role');
    if (ROLES.includes(explicit)) return explicit;
    if (e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') return 'button';
    if (e.tagName === 'A') return 'link';
    if (e.tagName === 'SELECT') return 'combobox';
    if (e.tagName === 'TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName === 'INPUT') {
      if (['checkbox', 'radio'].includes(e.type)) return e.type;
      if (['button', 'submit', 'reset', 'image'].includes(e.type)) return 'button';
      if (e.type === 'search') return 'searchbox';
      if (e.type === 'number') return 'spinbutton';
      return 'textbox';
    }
    return null;
  };

  const selector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],' +
    ROLES.map((r) => '[role="' + r + '"]').join(',');
  const elements = [];
  let index = 0;
  for (const e of document.querySelectorAll(selector)) {
    if (index >= MAX) break;
    if (!safe(e) || !visible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) continue;
    const role = roleOf(e);
    if (!role) continue;
    const r = e.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue;
    index++;
    e.setAttribute(MARK, String(index));
    const base = {
      index,
      role,
      name: nameOf(e) || role,
      bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
    for (const key of ['checked', 'selected', 'expanded']) {
      const value = e.getAttribute('aria-' + key);
      if (value !== null) base[key] = value;
    }
    if (['checkbox', 'radio'].includes(e.type)) base.checked = String(e.checked);
    if (e.tagName === 'SELECT') {
      const options = [];
      let optIndex = 0;
      for (const o of e.options) {
        if (o.disabled || o.closest('optgroup[disabled]')) continue;
        optIndex++;
        options.push({ index: index + ':' + optIndex, label: o.label || o.textContent.trim(), value: o.value });
      }
      elements.push({ ...base, kind: 'select', value: [...e.selectedOptions].map((o) => o.label).join(', '), options });
      continue;
    }
    const editable = !e.readOnly && e.getAttribute('aria-readonly') !== 'true' &&
      (['textbox', 'searchbox', 'spinbutton'].includes(role) || (role === 'combobox' && ['INPUT', 'TEXTAREA'].includes(e.tagName)));
    const value = 'value' in e ? String(e.value ?? '') : (e.isContentEditable ? (e.innerText || '').trim() : '');
    elements.push({ ...base, kind: editable ? 'fill' : 'click', value });
  }

  let text = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
  if (text.length > TEXT_LIMIT) text = text.slice(0, TEXT_LIMIT) + '…';
  return { url: location.href, title: document.title, text, elements };
})()`;

export type FastPageLike = {
  evaluate<T>(fn: string | (() => Promise<T> | T)): Promise<T>;
};

/** 采集一次快照（同时给元素打上 data-at-fidx 标记，供后续精确定位）。 */
export async function takeSnapshot(page: { evaluate: FastPageLike["evaluate"] }): Promise<FastSnapshot> {
  return page.evaluate<FastSnapshot>(SNAPSHOT_SCRIPT);
}
