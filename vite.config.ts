import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'

// mkcert 签名的本地证书(系统已信任 mkcert CA,Chrome/Safari 见绿锁不警告)
// 证书在仓库根 .certs/,已 gitignore
const CERT_DIR = path.resolve(__dirname, '.certs')
// lan.pem 覆盖 localhost + 当前/历史 LAN IP，IP 再变也不必改这里；
// IP 跳到新网段时重签：cd .certs && mkcert -cert-file lan.pem -key-file lan-key.pem localhost 127.0.0.1 <新IP> ...
const CERT_PATH = path.join(CERT_DIR, 'lan.pem')
const KEY_PATH = path.join(CERT_DIR, 'lan-key.pem')
const httpsConfig = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)
  ? { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) }
  : undefined

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 读 .env 里改图实际在用的中转站,构建时注入前端 → 分镜「中转站」零填写自动用。
  // OPENAI_* = 改图当前生效的那条(vectorengine,有额度、实测 gpt-4o/gpt-5 都通);
  // geeknow 是没额度的备用号,不用。不加 VITE_ 前缀也读得到(第三参 '' 不按前缀过滤)。
  // .env 已 gitignore,key 不进仓库。
  const env = loadEnv(mode, __dirname, '')
  const relayBase = env.OPENAI_BASE_URL || env.RELAY_VECTORENGINE_BASE || ''
  const relayKey = env.OPENAI_API_KEY || env.RELAY_VECTORENGINE_KEY || ''

  return {
  define: {
    __GEEKNOW_RELAY__: JSON.stringify({ baseURL: relayBase, apiKey: relayKey }),
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',  // 监听 IPv4 LAN,给另一台电脑访问
    https: httpsConfig as any,
    proxy: {
      // 改文走订阅: /v1/chat/completions 转给 Node claude-proxy.mjs(端口 8788),
      // 按模型名分流到 claude -p / codex exec / gemini CLI(订阅,不烧 API token)
      '/v1': {
        target: 'http://localhost:8788',
        changeOrigin: false,
        secure: false,
      },
      // 代下载图片(绕过 OSS 图床跨域):转给 8788 的 /img-download
      '/img-download': {
        target: 'http://localhost:8788',
        changeOrigin: false,
        secure: false,
      },
      '/gbrain-save': {
        target: 'http://localhost:8788',
        changeOrigin: false,
        secure: false,
      },
      '/gbrain-list': {
        target: 'http://localhost:8788',
        changeOrigin: false,
        secure: false,
      },
      '/api/redraw': {
        target: 'http://localhost:8789',
        changeOrigin: false,
      },
      '/api/create': {
        target: 'http://localhost:8789',
        changeOrigin: false,
      },
      '/cert': {
        target: 'http://localhost:8789',
        changeOrigin: false,
      },
    },
  },
  preview: { host: true, https: httpsConfig as any },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  }
})
