import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      'react': resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    },
  },
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
    exclude: ['motion', 'motion/react', 'framer-motion'],
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
