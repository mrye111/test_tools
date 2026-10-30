/** 导航栏用户菜单：未登录给出登录入口；已登录显示用户名下拉（改密 / 用户管理 / 登出）。 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, LogIn, UserRound } from 'lucide-react'
import { MenuButton } from './ui/MenuButton'
import { ModalShell } from './ui/ModalShell'
import { useAuth } from '../lib/auth-context'
import { normalizeErrorMessage } from '../lib/app-error'

// 与服务端密码规则一致的客户端预检
const PASSWORD_MIN = 15
const PASSWORD_MAX = 64

export function UserMenu() {
  const { user, status, isAdmin, logout, changePassword } = useAuth()
  const navigate = useNavigate()
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  // 会话未决不渲染，避免已登录用户闪一下「登录」入口
  if (status === 'loading') return null

  if (!user) {
    return (
      <Link to="/login" className="nav-pill flex items-center gap-1.5">
        <LogIn className="h-3.5 w-3.5" />
        <span className="max-sm:hidden">登录</span>
      </Link>
    )
  }

  const options = [
    { value: 'password', label: '修改密码' },
    ...(isAdmin ? [{ value: 'admin', label: '用户管理' }] : []),
    { value: 'logout', label: '退出登录' },
  ]

  const handleSelect = async (value: string) => {
    if (value === 'password') {
      setCurrentPassword('')
      setNewPassword('')
      setPasswordError('')
      setShowPasswordModal(true)
      return
    }
    if (value === 'admin') {
      navigate('/admin/users')
      return
    }
    if (value === 'logout') {
      await logout()
      navigate('/login')
    }
  }

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (passwordBusy) return
    if (!currentPassword) {
      setPasswordError('请输入当前密码')
      return
    }
    if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
      setPasswordError(`新密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 字符`)
      return
    }
    setPasswordError('')
    setPasswordBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      setShowPasswordModal(false)
    } catch (err) {
      setPasswordError(normalizeErrorMessage(err, { fallbackMessage: '修改密码失败，请稍后重试。' }))
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <>
      <MenuButton
        options={options}
        onSelect={(value) => void handleSelect(value)}
        ariaLabel={`用户菜单：${user.username}`}
        menuMinWidth={180}
      >
        <span className={`nav-pill flex items-center gap-1.5 ${isAdmin ? 'nav-pill-active' : ''}`}>
          <UserRound className="h-3.5 w-3.5" />
          <span className="max-sm:hidden">{user.username}</span>
        </span>
      </MenuButton>

      <ModalShell open={showPasswordModal} onClose={() => setShowPasswordModal(false)} closeOnBackdrop={false}>
        <div
          className="flex min-h-full w-full items-center justify-center px-4 py-8"
          onClick={(event) => event.stopPropagation()}
        >
          <section
            className="modal-panel w-full max-w-[420px] overflow-hidden rounded-[28px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-password-title"
          >
            <form onSubmit={handlePasswordSubmit}>
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3
                      id="change-password-title"
                      className="font-display text-lg font-semibold tracking-[-0.03em] text-fg"
                    >
                      修改密码
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted">修改后请使用新密码登录</p>

                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="field-label field-label-required" htmlFor="current-password">
                          当前密码
                        </label>
                        <input
                          id="current-password"
                          type="password"
                          value={currentPassword}
                          onChange={(event) => setCurrentPassword(event.target.value)}
                          autoComplete="current-password"
                          className="field-control"
                        />
                      </div>
                      <div>
                        <label className="field-label field-label-required" htmlFor="new-password">
                          新密码
                        </label>
                        <input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          autoComplete="new-password"
                          className="field-control"
                        />
                        <p className="helper-text">密码长度须为 {PASSWORD_MIN}–{PASSWORD_MAX} 字符</p>
                      </div>
                      {passwordError && <p className="field-error">{passwordError}</p>}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-3 border-t border-white/60 bg-white/40 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="secondary-action px-4 py-2 text-sm"
                >
                  取消
                </button>
                <button type="submit" disabled={passwordBusy} className="primary-action px-4 py-2 text-sm">
                  {passwordBusy ? '提交中…' : '确认修改'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </ModalShell>
    </>
  )
}
