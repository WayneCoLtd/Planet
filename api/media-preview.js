import crypto from 'node:crypto'
import sharp from 'sharp'
import { LEVEL_SITE, readLevel } from './_lib/session.js'
import { checkServiceConfig, getAdminClient } from './_lib/supabaseAdmin.js'

const BUCKET = 'wwcxrl-photos' // Only public photo originals; never private journal/music.
const pending = new Map()
const MAX_BYTES = 20 * 1024 * 1024

async function buildPreview(db, path, key) {
  const storage = db.storage.from(BUCKET)
  const stored = await storage.download(key)
  if (stored.data) return Buffer.from(await stored.data.arrayBuffer())
  const missing = String(stored.error?.statusCode) === '404' || stored.error?.code === 'NoSuchKey' || /not found|does not exist/i.test(stored.error?.message || '')
  if (!missing) throw new Error('Preview store unavailable')
  const source = storage.getPublicUrl(path).data.publicUrl
  const response = await fetch(source, { signal: AbortSignal.timeout(15000), redirect: 'error' })
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Source unavailable or too large')
  const reader = response.body.getReader(), parts = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Source too large') }
    parts.push(Buffer.from(chunk.value))
  }
  const bytes = Buffer.concat(parts)
  const metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata()
  if (!['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('Unsupported preview format')
  const preview = await sharp(bytes, { limitInputPixels: 40000000 }).rotate()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 }).toBuffer()
  const result = await storage.upload(key, preview, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })
  if (result.error && String(result.error.statusCode) !== '409' && result.error.code !== 'Duplicate') throw result.error
  return preview
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (readLevel(req) < LEVEL_SITE) return res.status(401).json({ error: '请先通过网站密码' })
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: '不支持的操作' })
  const url = new URL(req.url, 'https://local.invalid')
  const path = url.searchParams.get('path') || ''
  if (url.searchParams.get('v') !== '1' || path.length > 800 || !path || /[\\%\x00-\x1f]/.test(path) || path.startsWith('/') || path.includes('..') || path.startsWith('media-previews/') || !/\.(jpe?g|png|webp|avif)$/i.test(path)) return res.status(400).json({ error: '照片路径不正确' })
  if (!checkServiceConfig().ok) return res.status(503).json({ error: '预览暂不可用' })
  const key = `media-previews/v1/${crypto.createHash('sha256').update(path).digest('hex')}.webp`
  const etag = `"${crypto.createHash('sha256').update(key).digest('hex')}"`
  if (req.headers?.['if-none-match'] === etag) {
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable')
    res.setHeader('ETag', etag)
    return res.status(304).end()
  }
  try {
    if (!pending.has(key)) {
      const task = buildPreview(getAdminClient(), path, key)
      pending.set(key, task)
      task.finally(() => pending.delete(key)).catch(() => {})
    }
    const bytes = await pending.get(key)
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable')
    res.setHeader('ETag', etag)
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Content-Length', String(bytes.length))
    return res.status(200).end(req.method === 'HEAD' ? undefined : bytes)
  } catch {
    return res.status(502).json({ error: '预览暂未生成，可查看原图' })
  }
}
