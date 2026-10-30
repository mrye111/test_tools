/** 登录页：账号密码登录，成功后回跳 redirect 目标（登录流程内附带本地偏好上送）。 */

import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, ShieldCheck } from 'lucide-react'
import { safeRedirectPath, useAuth } from '../lib/auth-context'
import { normalizeErrorMessage } from '../lib/app-error'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const redirect = safeRedirectPath(new URLSearchParams(location.search).get('redirect'))
  const registerHref = redirect === '/' ? '/register' : `/register?redirect=${encodeURIComponent(redirect)}`

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    if (!username.trim()) {
      setError('请输入用户名')
      return
    }
    if (!password) {
      setError('请输入密码')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await login(username.trim(), password)
      navigate(redirect, { replace: true })
    } catch (err) {
      // 429 限速退避、账密错误等文案由服务端归一化，这里兜底展示
      setError(normalizeErrorMessage(err, { fallbackMessage: '登录失败，请稍后重试。' }))
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
            <h1 className="page-title">登录</h1>
            <p className="page-subtitle">登录后使用 AI 测试工具平台的全部能力</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/14 bg-white/64 px-3.5 py-1.5 text-xs font-medium text-accent shadow-[0_18px_40px_-32px_oklch(0.58_0.17_262/0.6)] backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5" />
            会话安全保护
          </div>
        </div>

        <form onSubmit={handleSubmit} className="surface-panel motion-card rounded-[28px] p-6">
          <div className="relative z-[1] space-y-4">
            <div>
              <label className="field-label field-label-required" htmlFor="login-username">
                用户名
              </label>
              <input
                id="login-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="3–32 位字母/数字/下划线/中划线"
                autoComplete="username"
                className="field-control"
              />
            </div>

            <div>
              <label className="field-label field-label-required" htmlFor="login-password">
                密码
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                className="field-control"
              />
            </div>

            {error && <p className="field-error">{error}</p>}

            <button type="submit" disabled={submitting} className="primary-action w-full px-4 py-2.5 text-sm">
              <LogIn className="h-4 w-4" />
              {submitting ? '登录中…' : '登录'}
            </button>

            <p className="helper-text text-center">
              还没有账号？
              <Link to={registerHref} className="font-semibold text-accent hover:underline">
                注册
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
