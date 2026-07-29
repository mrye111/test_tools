import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// 「从哪里来，回哪里去」：应用内存在上一条历史记录时后退一步；
// 直接打开链接/刷新后的首条记录（idx 为 0）兜底回首页，避免后退跳出应用
export function useGoBack(fallbackPath = '/') {
  const navigate = useNavigate()
  return useCallback(() => {
    if (window.history.state?.idx > 0) {
      navigate(-1)
    } else {
      navigate(fallbackPath, { replace: true })
    }
  }, [navigate, fallbackPath])
}
