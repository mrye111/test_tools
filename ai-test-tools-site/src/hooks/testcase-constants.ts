// ── Types ──────────────────────────────────────────────────────────────────────

export type TestType = 'functional' | 'api'
export type Language = 'zh' | 'en'

// ── Constants ──────────────────────────────────────────────────────────────────

export const DEFAULT_HEADER = ['用例编号', '功能模块/接口名称', '功能测试点/请求方式及路径', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
export const FUNCTIONAL_HEADER = ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
export const API_HEADER = ['用例编号', '接口名称', '请求方式及路径', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
export const EN_FUNCTIONAL_HEADER = ['Case ID', 'Module', 'Test Point', 'Case Title', 'Priority', 'Preconditions', 'Test Steps', 'Expected Results']
export const EN_API_HEADER = ['Case ID', 'API Name', 'Request Method & Path', 'Case Title', 'Priority', 'Preconditions', 'Test Steps', 'Expected Results']
export const KNOWN_HEADERS = [FUNCTIONAL_HEADER, API_HEADER, EN_FUNCTIONAL_HEADER, EN_API_HEADER, DEFAULT_HEADER]

export const TEST_TYPE_OPTIONS = [
  { value: 'functional', label: '功能测试' },
  { value: 'api', label: 'API 测试' },
]

export const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

export const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 条/页' },
  { value: '20', label: '20 条/页' },
  { value: '30', label: '30 条/页' },
  { value: '50', label: '50 条/页' },
]
