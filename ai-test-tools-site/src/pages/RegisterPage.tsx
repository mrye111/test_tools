/** 注册页：创建账号（首个注册用户自动成为管理员），成功即登录并回跳。 */

import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck, UserPlus } from 'lucide-react'
import { safeRedirectPath, useAuth } from '../lib/auth-context'
import { normalizeErrorMessage } from '../lib/app-error'

// 与服务端校验规则一致的客户端预检（服务端仍是权威校验）
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/
const PASSWORD_MIN = 15
const PASSWORD_MAX = 64

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const redirect = safeRedirectPath(new URLSearchParams(location.search).get('redirect'))
  const loginHref = redirect === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    const name = username.trim()
    if (!USERNAME_RE.test(name)) {
      setError('用户名须为 3–32 位字母/数字/下划线/中划线')
      return
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setError(`密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 字符`)
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await register(name, password)
      navigate(redirect, { replace: true })
    } catch (err) {
      setError(normalizeErrorMessage(err, { fallbackMessage: '注册失败，请稍后重试。' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        {/* 品牌区：独立页的视觉锚点（与导航栏同一品牌标识） */}
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-base font-bold tracking-tight text-white shadow-[0_12px_28px_-14px_oklch(0.58_0.17_262/0.7),inset_0_1px_0_oklch(1_0_0/0.32)]">
            AI
          </div>
          <div>
            <h1 className="page-title">注册</h1>
            <p className="page-subtitle">创建账号，开始使用 AI 测试工具平台</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/14 bg-white/64 px-3.5 py-1.5 text-xs font-medium text-accent shadow-[0_18px_40px_-32px_oklch(0.58_0.17_262/0.6)] backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5" />
            首个用户自动管理员
          </div>
        </div>

        <form onSubmit={handleSubmit} className="surface-panel motion-card rounded-[28px] p-6">
          <div className="relative z-[1] space-y-4">
            <div>
              <label className="field-label field-label-required" htmlFor="register-username">
                用户名
              </label>
              <input
                id="register-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="3–32 位字母/数字/下划线/中划线"
                autoComplete="username"
                className="field-control"
              />
              <p className="helper-text">仅支持字母、数字、下划线与中划线</p>
            </div>

            <div>
              <label className="field-label field-label-required" htmlFor="register-password">
                密码
              </label>
              <input
                id="register-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`密码长度 ${PASSWORD_MIN}–${PASSWORD_MAX} 字符`}
                autoComplete="new-password"
                className="field-control"
              />
              <p className="helper-text">密码长度须为 {PASSWORD_MIN}–{PASSWORD_MAX} 字符</p>
            </div>

            {error && <p className="field-error">{error}</p>}

            <button type="submit" disabled={submitting} className="primary-action w-full px-4 py-2.5 text-sm">
              <UserPlus className="h-4 w-4" />
              {submitting ? '注册中…' : '注册并登录'}
            </button>

            <p className="helper-text text-center">
              已有账号？
              <Link to={loginHref} className="font-semibold text-accent hover:underline">
                返回登录
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
