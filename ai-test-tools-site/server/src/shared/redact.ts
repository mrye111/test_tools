/**
 * 出站内容统一脱敏：任何对外错误/响应经过此处抹掉密钥明文。
 * 与 spec「脱敏四条」配套：出站错误必经本助手；日志禁钥走 pino redact；导出物零密钥。
 */

const REDACTED = "[redacted]";
const MAX_LEN = 500;

/** 把文本中出现的密钥明文逐一替换为 [redacted]，并截断到安全长度。 */
export function redactSecrets(textValue: string, secrets: Array<string | undefined | null>): string {
  let out = textValue;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.trim()) {
      out = out.split(secret).join(REDACTED);
    }
  }
  return out.slice(0, MAX_LEN);
}
