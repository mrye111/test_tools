/**
 * 被测系统地址（SystemUrl）校验与归一化。
 *
 * 规则（领域决策）：
 * - 可选：空串合法，表示未配置；
 * - 无协议自动补全：localhost / IP 形态补 http://，其余补 https://；
 * - 允许内网地址、IP、带端口（测试环境常态）；不做可达性探活；
 * - 拒绝明显非地址输入：内含空白、含中文、非 http(s) 协议。
 */

export type SystemUrlResult = { ok: true; value: string } | { ok: false; error: string }

const CJK_PATTERN = /[一-鿿]/
const LOCAL_HOST_PATTERN = /^(localhost|127\.|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3}|\[::1\])/i

function pickScheme(hostPart: string): 'http://' | 'https://' {
  return LOCAL_HOST_PATTERN.test(hostPart) ? 'http://' : 'https://'
}

export function normalizeSystemUrl(input: string): SystemUrlResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: true, value: '' }

  if (/\s/.test(trimmed)) return { ok: false, error: '地址不能包含空格' }
  if (CJK_PATTERN.test(trimmed)) return { ok: false, error: '地址不能包含中文，请填写 URL 形式' }

  const candidate = trimmed.includes('://') ? trimmed : `${pickScheme(trimmed)}${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, error: '格式不是有效地址' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: '仅支持 http / https 地址' }
  }
  return { ok: true, value: parsed.href }
}

/** 展示用主机名（含端口），如 `staging.shop.com` / `10.20.30.4:8080`。 */
export function systemUrlHost(value: string | undefined): string {
  const normalized = normalizeSystemUrl(value ?? '')
  if (!normalized.ok || !normalized.value) return ''
  try {
    return new URL(normalized.value).host
  } catch {
    return ''
  }
}
