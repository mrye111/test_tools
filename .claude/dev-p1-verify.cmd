@echo off
rem P1 验证专用：vite 代理指向 3001 的新构建（本机 3000 被 Grafana 容器占用）
set VITE_API_TARGET=http://localhost:3001
npm --prefix ai-test-tools-site run dev -- --port 5202 --strictPort
