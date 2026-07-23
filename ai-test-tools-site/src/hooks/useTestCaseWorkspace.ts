import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createGenerateJob,
  createTestCaseProject,
  deleteTestCase,
  deleteTestCaseProject,
  deleteTestCaseSet,
  exportTestCaseExcel,
  exportTestCaseExcelAll,
  exportTestCaseXmind,
  exportTestCaseXmindAll,
  listTestCaseProjects,
  listTestCaseSets,
  loadStoredModelConfig,
  updateTestCaseProject,
  upsertTestCase,
  waitForGenerateJob,
  type TestCaseProject,
  type TestCaseSet,
} from '../lib/testcase-api'
import type { Language, TestType } from './testcase-constants'

export interface CreateTestSetInput {
  name: string
  context: string
  testType: TestType
  language: Language
}

export function useTestCaseWorkspace() {
  const mountedRef = useRef(true)
  const [projects, setProjects] = useState<TestCaseProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [testSets, setTestSets] = useState<TestCaseSet[]>([])
  const [selectedSetIds, setSelectedSetIds] = useState<Set<string>>(new Set())
  const [previewSetId, setPreviewSetId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingSets, setLoadingSets] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [supplementNotice, setSupplementNotice] = useState<string | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  const previewSet = useMemo(
    () => testSets.find((testSet) => testSet.id === previewSetId) ?? null,
    [testSets, previewSetId],
  )
  const hasBusySets = testSets.some((testSet) => testSet.status === 'queued' || testSet.status === 'running')

  const applyTestSet = useCallback((nextSet: TestCaseSet) => {
    setTestSets((current) => current.map((item) => item.id === nextSet.id ? nextSet : item))
  }, [])

  const refreshProjects = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const next = await listTestCaseProjects()
      if (mountedRef.current) setProjects(next)
    } catch (error) {
      if (mountedRef.current) setPageError(error instanceof Error ? error.message : '获取项目失败')
    } finally {
      if (mountedRef.current && showLoading) setLoading(false)
    }
  }, [])

  const refreshTestSets = useCallback(async (projectId: string, showLoading = false) => {
    if (showLoading) setLoadingSets(true)
    try {
      const next = await listTestCaseSets(projectId)
      if (!mountedRef.current) return
      setTestSets(next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
      setSelectedSetIds((current) => new Set([...current].filter((id) => next.some((item) => item.id === id && item.status === 'completed'))))
    } catch (error) {
      if (mountedRef.current) setPageError(error instanceof Error ? error.message : '获取用例集失败')
    } finally {
      if (mountedRef.current && showLoading) setLoadingSets(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refreshProjects(true)
    return () => { mountedRef.current = false }
  }, [refreshProjects])

  useEffect(() => {
    if (!selectedProjectId) {
      setTestSets([])
      setSelectedSetIds(new Set())
      setPreviewSetId(null)
      return
    }
    void refreshTestSets(selectedProjectId, true)
  }, [refreshTestSets, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId || !hasBusySets) return
    const timer = window.setInterval(() => void refreshTestSets(selectedProjectId), 1500)
    return () => window.clearInterval(timer)
  }, [hasBusySets, refreshTestSets, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId || hasBusySets || testSets.length === 0) return
    void refreshProjects()
  }, [hasBusySets, refreshProjects, selectedProjectId, testSets.length])

  async function createProject(name: string) {
    setCreatingProject(true)
    setPageError(null)
    try {
      const created = await createTestCaseProject(name.trim())
      await refreshProjects()
      setSelectedProjectId(created.id)
      return true
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '创建项目失败')
      return false
    } finally {
      setCreatingProject(false)
    }
  }

  async function renameProject(projectId: string, name: string) {
    setCreatingProject(true)
    setPageError(null)
    try {
      await updateTestCaseProject(projectId, name.trim())
      await refreshProjects()
      return true
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '更新项目失败')
      return false
    } finally {
      setCreatingProject(false)
    }
  }

  async function removeProject(projectId: string) {
    setPageError(null)
    try {
      await deleteTestCaseProject(projectId)
      await refreshProjects()
      return true
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除项目失败')
      return false
    }
  }

  async function createTestSet(input: CreateTestSetInput) {
    if (!selectedProject) return false
    setGenerating(true)
    setPageError(null)
    try {
      const aiConfig = loadStoredModelConfig()
      if (!aiConfig) throw new Error('请先在模型设置中配置统一供应商')
      const created = await createGenerateJob({
        mode: 'create',
        projectId: selectedProject.id,
        testSetName: input.name.trim(),
        featureName: input.name.trim(),
        context: input.context.trim(),
        testType: input.testType,
        language: input.language,
        aiConfig,
      })
      await refreshTestSets(selectedProject.id)
      void waitForGenerateJob(created.jobId)
        .catch(() => undefined)
        .finally(() => {
          if (!mountedRef.current) return
          void refreshTestSets(selectedProject.id)
          void refreshProjects()
        })
      return true
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '创建用例集失败')
      return false
    } finally {
      setGenerating(false)
    }
  }

  async function removeTestSet(testSet: TestCaseSet) {
    if (!selectedProject) return
    setPageError(null)
    try {
      await deleteTestCaseSet(selectedProject.id, testSet.id)
      if (previewSetId === testSet.id) setPreviewSetId(null)
      await Promise.all([refreshTestSets(selectedProject.id), refreshProjects()])
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除用例集失败')
    }
  }

  async function supplementTestSet(testSet: TestCaseSet, supplementContext: string) {
    if (!selectedProject) return false
    setGenerating(true)
    setPageError(null)
    setSupplementNotice(null)
    try {
      const aiConfig = loadStoredModelConfig()
      if (!aiConfig) throw new Error('请先在模型设置中配置统一供应商')
      const created = await createGenerateJob({
        mode: 'supplement',
        projectId: selectedProject.id,
        testSetId: testSet.id,
        testSetName: testSet.name,
        featureName: testSet.name,
        context: supplementContext.trim(),
        testType: testSet.testType,
        language: testSet.language,
        rows: testSet.rows,
        aiConfig,
      })
      await refreshTestSets(selectedProject.id)
      void waitForGenerateJob(created.jobId)
        .then((job) => {
          if (!mountedRef.current || job.status !== 'completed') return
          const added = job.addedCount
          const filtered = job.duplicatesFiltered ?? 0
          if (typeof added !== 'number') return
          if (added > 0) setSupplementNotice(`补充完成，本次新增 ${added} 条用例`)
          else if (filtered > 0) setSupplementNotice(`生成的 ${filtered} 条用例与已有用例重复，已自动过滤`)
          else setSupplementNotice('AI 判断当前用例覆盖已完整，无需新增')
        })
        .catch(() => undefined)
        .finally(() => {
          if (!mountedRef.current) return
          void refreshTestSets(selectedProject.id)
          void refreshProjects()
        })
      return true
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '补充需求失败')
      return false
    } finally {
      setGenerating(false)
    }
  }

  async function addTestCase(testSet: TestCaseSet, row: string[]) {
    setPageError(null)
    try {
      const updated = await upsertTestCase({ testSetId: testSet.id, row })
      applyTestSet(updated)
      await refreshProjects()
      return true
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '新增用例失败')
      return false
    }
  }

  async function removeTestCase(testSet: TestCaseSet, row: string[]) {
    const caseId = String(row[0] ?? '').trim()
    if (!caseId) return false
    setPageError(null)
    try {
      const updated = await deleteTestCase(testSet.id, caseId)
      applyTestSet(updated)
      await refreshProjects()
      return true
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除用例失败')
      return false
    }
  }

  function toggleSetSelection(testSet: TestCaseSet) {
    if (testSet.status !== 'completed') return
    setSelectedSetIds((current) => {
      const next = new Set(current)
      if (next.has(testSet.id)) next.delete(testSet.id)
      else next.add(testSet.id)
      return next
    })
  }

  function toggleAllCompleted() {
    const completedIds = testSets.filter((item) => item.status === 'completed' && item.rows.length > 0).map((item) => item.id)
    setSelectedSetIds((current) => current.size === completedIds.length ? new Set() : new Set(completedIds))
  }

  async function exportSingle(testSet: TestCaseSet, kind: 'excel' | 'xmind') {
    if (!testSet.rows.length) return
    setExporting(`${kind}:${testSet.id}`)
    setPageError(null)
    try {
      if (kind === 'excel') await exportTestCaseExcel({ featureName: testSet.name, format: 'default', rows: testSet.rows })
      else await exportTestCaseXmind({ featureName: testSet.name, rows: testSet.rows })
    } catch (error) {
      setPageError(error instanceof Error ? error.message : `导出 ${kind === 'excel' ? 'Excel' : 'XMind'} 失败`)
    } finally {
      setExporting(null)
    }
  }

  async function exportMerged(kind: 'excel' | 'xmind') {
    if (!selectedProject) return
    const selected = selectedSetIds.size
      ? testSets.filter((item) => selectedSetIds.has(item.id) && item.status === 'completed' && item.rows.length > 0)
      : testSets.filter((item) => item.status === 'completed' && item.rows.length > 0)
    if (!selected.length) return
    setExporting(`${kind}:merged`)
    setPageError(null)
    try {
      const payload = { projectName: selectedProject.name, testSets: selected.map((item) => ({ featureName: item.name, rows: item.rows })) }
      if (kind === 'excel') await exportTestCaseExcelAll(payload)
      else await exportTestCaseXmindAll(payload)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : `导出 ${kind === 'excel' ? 'Excel' : 'XMind'} 失败`)
    } finally {
      setExporting(null)
    }
  }

  return {
    projects,
    selectedProject,
    selectedProjectId,
    setSelectedProjectId,
    testSets,
    selectedSetIds,
    previewSet,
    setPreviewSetId,
    loading,
    loadingSets,
    creatingProject,
    generating,
    exporting,
    pageError,
    setPageError,
    supplementNotice,
    setSupplementNotice,
    createProject,
    renameProject,
    removeProject,
    createTestSet,
    removeTestSet,
    supplementTestSet,
    addTestCase,
    removeTestCase,
    toggleSetSelection,
    toggleAllCompleted,
    exportSingle,
    exportMerged,
  }
}
