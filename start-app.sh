#!/bin/bash
# 自媒体图文工坊 启动器：同时拉起 代理(8788) + 前端Vite(5173)
# 由 launchd (com.stylecloner.app) 托管，开机自启 + 崩溃自动重启
cd "$(dirname "$0")" || exit 1

# 清掉旧的端口占用，避免重启时冲突
lsof -ti tcp:8788 2>/dev/null | xargs kill -9 2>/dev/null
lsof -ti tcp:5173 2>/dev/null | xargs kill -9 2>/dev/null

# 后台起代理，前台起 vite（vite 挂掉 → 整个脚本退出 → launchd 自动重启）
npm run proxy &
exec npm run dev
