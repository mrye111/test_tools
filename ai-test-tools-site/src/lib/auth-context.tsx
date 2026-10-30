/** 登录态上下文：启动探测会话、登录/注册/登出/改密、401 统一跳转，以及路由守卫。 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  changePassword as changePasswordApi,
  fetchMe,
  login as loginApi,
  logout as logoutApi,
  register as registerApi,
  setUnauthorizedHandler,
  type AuthUser,
} from './auth-api'
import { migrateLocalPreferences } from './preference-migration'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  user: AuthUser | null
  status: AuthStatus
  isAdmin: boolean
  csrfToken: string
  login: (username: string, password: string) => Promise<AuthUser>
  register: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

/**
 * 未挂 AuthProvider 时的兜底（Navbar 等组件可脱离 Provider 独立渲染/测试）：一律视为未登录。
 */
const ANONYMOUS_VALUE: AuthContextValue = {
  user: null,
  status: 'anonymous',
  isAdmin: false,
  csrfToken: '',
  login: async () => {
    throw new Error('AuthProvider 未挂载')
  },
  register: async () => {
    throw new Error('AuthProvider 未挂载')
  },
  logout: async () => undefined,
  changePassword: async () => {
    throw new Error('AuthProvider 未挂载')
  },
}

const AuthContext = createContext<AuthContextValue>(ANONYMOUS_VALUE)

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

/** 只允许站内相对路径回跳，防开放重定向（`//evil.com`、绝对 URL 一律丢弃）。 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  return raw
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [csrfToken, setCsrfTokenState] = useState('')

  // 启动探测：GET /me 建立登录态与 CSRF 令牌（令牌仅存内存，见 auth-api）
  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((session) => {
        if (cancelled) return
        setUser(session.user)
        setCsrfTokenState(session.csrfToken)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        setCsrfTokenState('')
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 会话过期（任意受保护 API 401）：清态并带 redirect 跳登录页
  useEffect(() => {
    setUnauthorizedHandler((redirectPath) => {
      setUser(null)
      setCsrfTokenState('')
      setStatus('anonymous')
      navigate(`/login?redirect=${encodeURIComponent(redirectPath)}`, { replace: true })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  // 登录/注册成功：建态后异步上送本地历史偏好（失败不阻塞，见 preference-migration）
  const applySession = useCallback((sessionUser: AuthUser, token: string) => {
    setUser(sessionUser)
    setCsrfTokenState(token)
    setStatus('authenticated')
    void migrateLocalPreferences()
  }, [])

  const login = useCallback(
    async (username: string, password: string) => {
      const session = await loginApi(username, password)
      applySession(session.user, session.csrfToken)
      return session.user
    },
    [applySession],
  )

  const register = useCallback(
    async (username: string, password: string) => {
      const session = await registerApi(username, password)
      applySession(session.user, session.csrfToken)
      return session.user
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    try {
      await logoutApi()
    } finally {
      setUser(null)
      setCsrfTokenState('')
      setStatus('anonymous')
    }
  }, [])

  const changePassword = useCallback(
    (currentPassword: string, newPassword: string) => changePasswordApi(currentPassword, newPassword),
    [],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAdmin: user?.isAdmin ?? false,
      csrfToken,
      login,
      register,
      logout,
      changePassword,
    }),
    [user, status, csrfToken, login, register, logout, changePassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** 登录守卫（layout 路由）：会话未决时空渲染，未登录带 redirect 跳登录页。 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (status === 'anonymous') {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return <Outlet />
}

/** 管理员守卫（layout 路由）：未登录去登录页，已登录非管理员回首页。 */
export function RequireAdmin() {
  const { status, isAdmin } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (status === 'anonymous') {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  if (!isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}

/** 登录/注册页守卫（layout 路由）：已登录则跳出，回到 redirect 目标（仅站内路径）。 */
export function GuestOnly() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (status === 'authenticated') {
    const target = safeRedirectPath(new URLSearchParams(location.search).get('redirect'))
    return <Navigate to={target} replace />
  }
  return <Outlet />
}
