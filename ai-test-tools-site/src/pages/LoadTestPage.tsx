import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, FolderInput, Plus, Trash2 } from 'lucide-react'
import {
  createProject,
  deleteProject,
  importProject,
  listProjects,
  type LoadTestProjectSummary,
} from '../features/loadtest/loadtest-api'

const DEFAULT_SCRIPT = `import http from 'k6/http';
import { check } from 'k6';

const API_BASE = __ENV.API_BASE || 'https://example.com';

export const options = {
  scenarios: {
    default: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '60s', target: 30 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const response = http.get(API_BASE);
  check(response, { 'status is 200': (r) => r.status === 200 });
}
`

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export function LoadTestPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<LoadTestProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDir, setImportDir] = useState('')
  const [form, setForm] = useState({ name: '', targetBaseUrl: '', description: '' })
  const [confirmDelete, setConfirmDelete] = useState<LoadTestProjectSummary | null>(null)

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    listProjects()
      .then((list) => {
        setProjects(list)
        setError('')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
     
  }, [])

  const submitCreate = async () => {
    if (!form.name.trim() || !form.targetBaseUrl.trim()) {
      setError('名称与目标地址必填')
      return
    }
    try {
      const project = await createProject({
        name: form.name.trim(),
        description: form.description.trim(),
        targetBaseUrl: form.targetBaseUrl.trim(),
        scriptSource: DEFAULT_SCRIPT,
        envVars: { API_BASE: form.targetBaseUrl.trim() },
      })
      navigate(`/loadtest/projects/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  const submitImport = async () => {
    if (!importDir.trim()) return
    try {
      const project = await importProject(importDir.trim())
      navigate(`/loadtest/projects/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    }
  }

  const submitDelete = async () => {
    if (!confirmDelete) return
    try {
      await deleteProject(confirmDelete.id)
      setConfirmDelete(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="mx-auto max-w-shell px-6 py-10 max-lg:px-4">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="glass-chip mb-3 inline-block px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            在线压测
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight text-fg">压测项目</h1>
          <p className="mt-2 text-sm text-muted">k6 引擎 · 可视化配置 · 在线运行 · 串行队列</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setImporting(true); setError('') }}
            className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-4 py-2.5 text-sm font-medium text-fg transition hover:border-accent"
          >
            <FolderInput className="h-4 w-4" />
            从目录导入
          </button>
          <button
            type="button"
            onClick={() => { setCreating(true); setError('') }}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-accent-strong"
          >
            <Plus className="h-4 w-4" />
            新建项目
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">加载中…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center">
          <Activity className="mx-auto mb-4 h-10 w-10 text-muted/50" />
          <p className="text-sm text-muted">还没有压测项目。新建一个，或从既有 k6 项目目录导入。</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-white/80 px-6 py-5 transition hover:border-accent hover:shadow-lg"
            >
              <Link to={`/loadtest/projects/${project.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className="truncate text-base font-semibold text-fg">{project.name}</span>
                  <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs text-accent">{project.targetBaseUrl}</span>
                </div>
                <p className="mt-1 truncate text-sm text-muted">{project.description || '（无描述）'} · 更新于 {formatTime(project.updatedAt)}</p>
              </Link>
              <button
                type="button"
                aria-label={`删除 ${project.name}`}
                onClick={() => setConfirmDelete(project)}
                className="rounded-lg p-2 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-5 text-lg font-semibold text-fg">新建压测项目</h2>
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-fg">项目名称 *</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：问卷系统"
                  className="rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-fg">目标地址 *</span>
                <input
                  value={form.targetBaseUrl}
                  onChange={(e) => setForm({ ...form, targetBaseUrl: e.target.value })}
                  placeholder="https://example.com/api"
                  className="rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-fg">描述</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
                />
              </label>
              <p className="text-xs text-muted">创建后自带 ramping-vus 阶梯模板脚本，可在工作区中编辑。</p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCreating(false)} className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-bg">取消</button>
              <button type="button" onClick={() => void submitCreate()} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-strong">创建</button>
            </div>
          </div>
        </div>
      )}

      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-2 text-lg font-semibold text-fg">从目录导入</h2>
            <p className="mb-4 text-sm text-muted">读取目录下的 project.env、k6/*.js、data/*.json（旧框架项目结构），导入后独立演化。</p>
            <input
              value={importDir}
              onChange={(e) => setImportDir(e.target.value)}
              placeholder="D:\code\压力测试\projects\survey"
              className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setImporting(false)} className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-bg">取消</button>
              <button type="button" onClick={() => void submitImport()} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-strong">导入</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-2 text-lg font-semibold text-fg">删除项目</h2>
            <p className="text-sm text-muted">将删除「{confirmDelete.name}」及其全部执行记录，不可恢复。</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-bg">取消</button>
              <button type="button" onClick={() => void submitDelete()} className="rounded-lg bg-danger px-5 py-2 text-sm font-semibold text-white">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
