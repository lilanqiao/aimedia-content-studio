import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
