/** 用户管理（管理员）：注册开关、创建账号、停用/启用、重置密码。 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, KeyRound, ShieldCheck, UserCheck, UserPlus, Users, UserX } from 'lucide-react'
import { useGoBack } from '../hooks/useGoBack'
import {
  adminCreateUser,
  adminGetRegistrationOpen,
  adminListUsers,
  adminSetRegistrationOpen,
  adminUpdateUser,
  type AuthUser,
} from '../lib/auth-api'
import { useAuth } from '../lib/auth-context'
import { normalizeErrorMessage } from '../lib/app-error'
import { ModalShell } from '../components/ui/ModalShell'
import { Tooltip } from '../components/ui/Tooltip'

// 与服务端校验规则一致的客户端预检
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/
const PASSWORD_MIN = 15
const PASSWORD_MAX = 64

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('zh-CN')
}

export function AdminUsersPage() {
  const goBack = useGoBack()
  const { user: currentUser } = useAuth()

  const [users, setUsers] = useState<AuthUser[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')

  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null)
  const [registrationBusy, setRegistrationBusy] = useState(false)

  const [createUsername, setCreateUsername] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createError, setCreateError] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const [resetTarget, setResetTarget] = useState<AuthUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  const refreshUsers = useCallback(async () => {
    setListLoading(true)
    setListError('')
    try {
      setUsers(await adminListUsers())
    } catch (err) {
      setListError(normalizeErrorMessage(err, { fallbackMessage: '用户列表加载失败，请刷新重试。' }))
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUsers()
    adminGetRegistrationOpen()
      .then(setRegistrationOpen)
      .catch(() => setRegistrationOpen(null))
  }, [refreshUsers])

  const handleToggleRegistration = async (open: boolean) => {
    if (registrationBusy) return
    setRegistrationBusy(true)
    setActionError('')
    try {
      setRegistrationOpen(await adminSetRegistrationOpen(open))
    } catch (err) {
      setActionError(normalizeErrorMessage(err, { fallbackMessage: '注册开关更新失败，请重试。' }))
    } finally {
      setRegistrationBusy(false)
    }
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createBusy) return
    const name = createUsername.trim()
    if (!USERNAME_RE.test(name)) {
      setCreateError('用户名须为 3–32 位字母/数字/下划线/中划线')
      return
    }
    if (createPassword.length < PASSWORD_MIN || createPassword.length > PASSWORD_MAX) {
      setCreateError(`初始密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 字符`)
      return
    }
    setCreateError('')
    setCreateBusy(true)
    try {
      await adminCreateUser(name, createPassword)
      setCreateUsername('')
      setCreatePassword('')
      await refreshUsers()
    } catch (err) {
      setCreateError(normalizeErrorMessage(err, { fallbackMessage: '创建账号失败，请稍后重试。' }))
    } finally {
      setCreateBusy(false)
    }
  }

  const handleToggleDisabled = async (target: AuthUser) => {
    setActionError('')
    try {
      const updated = await adminUpdateUser(target.id, { disabled: !target.disabled })
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) {
      setActionError(normalizeErrorMessage(err, { fallbackMessage: '账号状态更新失败，请重试。' }))
    }
  }

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (resetBusy || !resetTarget) return
    if (resetPassword.length < PASSWORD_MIN || resetPassword.length > PASSWORD_MAX) {
      setResetError(`新密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 字符`)
      return
    }
    setResetError('')
    setResetBusy(true)
    try {
      const updated = await adminUpdateUser(resetTarget.id, { newPassword: resetPassword })
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setResetTarget(null)
      setResetPassword('')
    } catch (err) {
      setResetError(normalizeErrorMessage(err, { fallbackMessage: '重置密码失败，请稍后重试。' }))
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <Tooltip content="返回">
            <button type="button" onClick={goBack} className="icon-action h-10 w-10 rounded-xl" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <div>
            <h1 className="page-title">用户管理</h1>
            <p className="page-subtitle">创建账号、停用启用与重置密码，并控制是否开放注册</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-accent/14 bg-white/64 px-3.5 py-1.5 text-xs font-medium text-accent shadow-[0_18px_40px_-32px_oklch(0.58_0.17_262/0.6)] backdrop-blur sm:flex">
          <ShieldCheck className="h-3.5 w-3.5" />
          管理员专属
        </div>
      </div>

      {actionError && (
        <p className="mb-4 rounded-2xl border border-[oklch(0.55_0.2_25/0.2)] bg-[oklch(0.55_0.2_25/0.06)] px-4 py-3 text-sm text-danger">
          {actionError}
        </p>
      )}

      {/* 注册开关 */}
      <section className="surface-panel motion-card mb-6 rounded-[28px] p-6">
        <div className="relative z-[1] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">注册开关</h2>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              关闭后新用户无法自行注册，仅管理员可创建账号。
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={registrationOpen ?? false}
              disabled={registrationOpen === null || registrationBusy}
              onChange={(event) => void handleToggleRegistration(event.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm font-semibold text-fg">
              {registrationOpen === null ? '加载中…' : registrationOpen ? '已开放注册' : '已关闭注册'}
            </span>
          </label>
        </div>
      </section>

      {/* 创建账号 */}
      <section className="surface-panel motion-card mb-6 rounded-[28px] p-6">
        <div className="relative z-[1]">
          <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">创建账号</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted">为团队成员创建普通账号，并设置初始密码。</p>
          <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-start gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="field-label field-label-required" htmlFor="create-username">
                用户名
              </label>
              <input
                id="create-username"
                value={createUsername}
                onChange={(event) => setCreateUsername(event.target.value)}
                placeholder="3–32 位字母/数字/下划线/中划线"
                autoComplete="off"
                className="field-control"
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="field-label field-label-required" htmlFor="create-password">
                初始密码
              </label>
              <input
                id="create-password"
                type="password"
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
                placeholder={`${PASSWORD_MIN}–${PASSWORD_MAX} 字符`}
                autoComplete="new-password"
                className="field-control"
              />
            </div>
            <button type="submit" disabled={createBusy} className="primary-action mt-0 px-4 py-2.5 text-sm max-sm:w-full">
              <UserPlus className="h-4 w-4" />
              {createBusy ? '创建中…' : '创建账号'}
            </button>
          </form>
          {createError && <p className="field-error">{createError}</p>}
        </div>
      </section>

      {/* 用户列表 */}
      <section className="surface-panel motion-card rounded-[28px] p-6">
        <div className="relative z-[1]">
          <div className="mb-5 flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">用户列表</h2>
            <span className="badge badge-accent">{users.length} 人</span>
          </div>

          {listError && <p className="field-error">{listError}</p>}

          {listLoading ? (
            <p className="text-sm text-muted">加载中…</p>
          ) : users.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Users className="h-5 w-5" />
              </div>
              <div className="empty-state-title">还没有任何用户</div>
              <div className="empty-state-description">通过上方「创建账号」添加第一个用户。</div>
            </div>
          ) : (
            <ul className="space-y-3">
              {users.map((item) => {
                const isSelf = item.id === currentUser?.id
                return (
                  <li
                    key={item.id}
                    className="motion-card rounded-[22px] border border-white/60 bg-white/50 p-4"
                  >
                    <div className="relative z-[1] flex flex-wrap items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/8 text-sm font-bold uppercase text-accent">
                        {item.username.slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-fg">{item.username}</span>
                          {item.isAdmin && <span className="badge badge-accent">管理员</span>}
                          {item.disabled && <span className="badge badge-danger">已停用</span>}
                          {isSelf && <span className="badge badge-success">当前账号</span>}
                        </div>
                        <p className="mt-1 text-xs text-muted">创建于 {formatDate(item.createdAt)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Tooltip content={`重置 ${item.username} 的密码`}>
                          <button
                            type="button"
                            onClick={() => {
                              setResetTarget(item)
                              setResetPassword('')
                              setResetError('')
                            }}
                            className="secondary-action px-3 py-2 text-xs"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            重置密码
                          </button>
                        </Tooltip>
                        {isSelf ? (
                          <Tooltip content="不能停用自己的账号">
                            <button type="button" disabled className="secondary-action px-3 py-2 text-xs">
                              <UserX className="h-3.5 w-3.5" />
                              停用
                            </button>
                          </Tooltip>
                        ) : item.disabled ? (
                          <button
                            type="button"
                            onClick={() => void handleToggleDisabled(item)}
                            className="secondary-action px-3 py-2 text-xs"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            启用
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleToggleDisabled(item)}
                            className="secondary-action px-3 py-2 text-xs"
                          >
                            <UserX className="h-3.5 w-3.5" />
                            停用
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 重置密码弹窗 */}
      <ModalShell
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        closeOnBackdrop={false}
      >
        <div
          className="flex min-h-full w-full items-center justify-center px-4 py-8"
          onClick={(event) => event.stopPropagation()}
        >
          <section
            className="modal-panel w-full max-w-[420px] overflow-hidden rounded-[28px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
          >
            <form onSubmit={handleResetPassword}>
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3
                      id="reset-password-title"
                      className="font-display text-lg font-semibold tracking-[-0.03em] text-fg"
                    >
                      重置密码
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      为 {resetTarget?.username ?? ''} 设置新密码，重置后立即生效。
                    </p>
                    <div className="mt-4">
                      <label className="field-label field-label-required" htmlFor="reset-new-password">
                        新密码
                      </label>
                      <input
                        id="reset-new-password"
                        type="password"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                        autoComplete="new-password"
                        className="field-control"
                      />
                      <p className="helper-text">密码长度须为 {PASSWORD_MIN}–{PASSWORD_MAX} 字符</p>
                      {resetError && <p className="field-error">{resetError}</p>}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-3 border-t border-white/60 bg-white/40 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="secondary-action px-4 py-2 text-sm"
                >
                  取消
                </button>
                <button type="submit" disabled={resetBusy} className="primary-action px-4 py-2 text-sm">
                  {resetBusy ? '提交中…' : '确认重置'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </ModalShell>
    </div>
  )
}
