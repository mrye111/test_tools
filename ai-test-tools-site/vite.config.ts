import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // 后端运行时文件变化不应触发前端整页刷新，否则生成中的页面状态会被清空。
      ignored: ['**/server/data/**', '**/server/generated/**', '**/server/dist/**'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },

  optimizeDeps: {
    include: [
      'codemirror',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lang-json',
      '@codemirror/lang-xml',
      '@codemirror/theme-one-dark',
    ],
  },
})
