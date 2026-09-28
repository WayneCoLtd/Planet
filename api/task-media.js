import crypto from 'node:crypto'
import { LEVEL_ADMIN, readLevel } from './_lib/session.js'
import { TASK_MEDIA_BUCKET, checkServiceConfig, getAdminClient } from './_lib/supabaseAdmin.js'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const MEDIA_TYPES = {
  'image/jpeg': { kind: 'image', ext: 'jpg', max: MAX_IMAGE_BYTES },
  'image/png': { kind: 'image', ext: 'png', max: MAX_IMAGE_BYTES },
  'image/webp': { kind: 'image', ext: 'webp', max: MAX_IMAGE_BYTES },
  'image/gif': { kind: 'image', ext: 'gif', max: MAX_IMAGE_BYTES },
  'video/mp4': { kind: 'video', ext: 'mp4', max: MAX_VIDEO_BYTES },
  'video/webm': { kind: 'video', ext: 'webm', max: MAX_VIDEO_BYTES },
  'video/quicktime': { kind: 'video', ext: 'mov', max: MAX_VIDEO_BYTES }
}

let bucketPromise = null

function readBody(request) {
  if (!request.body) return {}
  if (typeof request.body === 'object') return request.body
  try { return JSON.parse(String(request.body)) } catch { return {} }
}

function validMediaPath(value) {
  return /^daily-best\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif|mp4|webm|mov)$/i.test(String(value || ''))
}

async function ensureMediaBucket(admin) {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const options = {
        public: true,
        fileSizeLimit: MAX_VIDEO_BYTES,
        allowedMimeTypes: Object.keys(MEDIA_TYPES)
      }
      const { data: buckets, error: listError } = await admin.storage.listBuckets()
      if (listError) throw listError
      const exists = (buckets || []).some(bucket => bucket.id === TASK_MEDIA_BUCKET)
      const result = exists
        ? await admin.storage.updateBucket(TASK_MEDIA_BUCKET, options)
        : await admin.storage.createBucket(TASK_MEDIA_BUCKET, options)
      if (result.error) throw result.error
      return true
    })().catch(error => {
      bucketPromise = null
      throw error
    })
  }
  return bucketPromise
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  if (readLevel(request) < LEVEL_ADMIN) {
    return response.status(403).json({ ok: false, error: '只有管理员能上传今日最佳素材' })
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ ok: false, error: '不支持的请求方式' })
  }
  const config = checkServiceConfig()
  if (!config.ok) return response.status(503).json({ ok: false, error: '服务端媒体存储尚未配置' })

  const body = readBody(request)
  const admin = getAdminClient()
  if (body.action === 'delete') {
    const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).filter(validMediaPath).slice(0, 3)
    if (!paths.length) return response.status(400).json({ ok: false, error: '媒体路径不合法' })
    const { error } = await admin.storage.from(TASK_MEDIA_BUCKET).remove(paths)
    if (error) return response.status(500).json({ ok: false, error: error.message })
    return response.status(200).json({ ok: true })
  }
  if (body.action !== 'sign-upload') return response.status(400).json({ ok: false, error: '未知操作' })
  const contentType = String(body.contentType || '').trim().toLowerCase()
  const media = MEDIA_TYPES[contentType]
  const size = Math.max(0, Number(body.size || 0))
  if (!media) return response.status(400).json({ ok: false, error: '仅支持 JPG、PNG、WebP、GIF、MP4、WebM 和 MOV' })
  if (!size || size > media.max) {
    const limit = Math.round(media.max / 1024 / 1024)
    return response.status(400).json({ ok: false, error: `${media.kind === 'video' ? '视频' : '图片'}不能超过 ${limit}MB` })
  }

  try {
    await ensureMediaBucket(admin)
    const path = `daily-best/${crypto.randomUUID()}.${media.ext}`
    const { data, error } = await admin.storage.from(TASK_MEDIA_BUCKET).createSignedUploadUrl(path)
    if (error || !data?.signedUrl) throw error || new Error('上传地址生成失败')
    const { data: publicData } = admin.storage.from(TASK_MEDIA_BUCKET).getPublicUrl(path)
    return response.status(200).json({
      ok: true,
      kind: media.kind,
      path,
      uploadUrl: data.signedUrl,
      publicUrl: publicData.publicUrl
    })
  } catch (error) {
    console.warn('[wwcxrl task media] sign upload failed', error)
    return response.status(500).json({ ok: false, error: error.message || '媒体上传准备失败' })
  }
}
