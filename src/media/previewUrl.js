const PUBLIC_PHOTO_BUCKET = 'wwcxrl-photos'
const TASK_MEDIA_BUCKET = 'wwcxrl-task-media'

export function canPreviewPhoto(bucket, path) {
  if (!path || path.length > 800 || path.startsWith('/') || path.includes('..') || /[\\%\x00-\x1f]/.test(path)) return false
  if (bucket === PUBLIC_PHOTO_BUCKET) {
    return !path.startsWith('media-previews/') && /\.(jpe?g|png|webp|avif)$/i.test(path)
  }
  return bucket === TASK_MEDIA_BUCKET && /^daily-best\/[0-9a-f-]{36}\.(jpe?g|png|webp)$/i.test(path)
}

export function previewUrl(src, projectUrl, siteOrigin = '', enabled = true) {
  if (!enabled || !src || !projectUrl) return src
  try {
    const project = new URL(projectUrl)
    const url = new URL(src, siteOrigin || project.origin)
    const ownProxy = siteOrigin && url.origin === siteOrigin && url.pathname.startsWith('/sb/storage/')
    if (url.origin !== project.origin && !ownProxy) return src
    const pathname = ownProxy ? url.pathname.slice(3) : url.pathname
    const object = pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
    if (!object) return src
    const [, bucket, encodedPath] = object
    const path = decodeURIComponent(encodedPath)
    if (!canPreviewPhoto(bucket, path)) return src
    const sourceBucket = bucket === PUBLIC_PHOTO_BUCKET ? '' : `&bucket=${bucket}`
    return `/api/media-preview?v=1&path=${encodeURIComponent(path)}${sourceBucket}`
  } catch { return src }
}

export function mediaPreviewUrl(src) {
  return previewUrl(src, import.meta.env?.VITE_SUPABASE_URL,
    typeof window === 'undefined' ? '' : window.location.origin,
    Boolean(import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY))
}
