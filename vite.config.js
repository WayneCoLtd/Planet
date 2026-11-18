import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'

function serveLocalAnniversaryPhoto(server) {
  server.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/anniversary-photo') return next()
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host || '')
    if (!local || !localHost) {
      res.statusCode = 403
      return res.end()
    }
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET')
      return res.end()
    }
    try {
      const photo = await readFile(new URL('./.cache/private-media/anniversary-365.jpg', import.meta.url))
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Type', 'image/jpeg')
      res.end(photo)
    } catch {
      res.statusCode = 404
      res.end()
    }
  })
}

export default defineConfig({
  plugins: [react(), {
    name: 'local-anniversary-photo',
    configureServer: serveLocalAnniversaryPhoto,
    configurePreviewServer: serveLocalAnniversaryPhoto,
  }],
  build: {
    rollupOptions: {
      output: {
        // React 运行时变化很少，单独成包后可配合 immutable 缓存跨业务版本复用；
        // Supabase 继续保持现有的动态导入，只有真正读取云端时才下载。
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react-vendor'
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.cache/private-media/**'] }
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true
  }
})
