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
    // 会话登录要求同源（Cookie + CSRF Origin 校验）：dev 一律经 vite 代理到后端，不经跨域直连。
    // 后端端口可用 VITE_API_TARGET 覆盖（如本机 3000 被其他应用占用时指向 3001）。
    proxy: Object.fromEntries(
      ['/api', '/tools', '/health', '/ai', '/files', '/sse', '/messages', '/rpc'].map((prefix) => [
        prefix,
        { target: process.env.VITE_API_TARGET ?? 'http://localhost:3000', changeOrigin: false, timeout: 0 },
      ]),
    ),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // dist 是 tsc 编译产物，其中的 *.test.js 是源测试的副本，不应重复运行
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
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
