export function previewUrl(src, projectUrl, siteOrigin = '', enabled = true) {
  if (!enabled || !src || !projectUrl) return src
  try {
    const project = new URL(projectUrl)
    const url = new URL(src, siteOrigin || project.origin)
    const ownProxy = siteOrigin && url.origin === siteOrigin && url.pathname.startsWith('/sb/storage/')
    if (url.origin !== project.origin && !ownProxy) return src
    const pathname = ownProxy ? url.pathname.slice(3) : url.pathname
    const prefix = '/storage/v1/object/public/wwcxrl-photos/'
    if (!pathname.startsWith(prefix)) return src
    const path = decodeURIComponent(pathname.slice(prefix.length))
    if (!path || path.includes('..') || path.includes('%') || path.startsWith('media-previews/') || !/\.(jpe?g|png|webp|avif)$/i.test(path)) return src
    return `/api/media-preview?v=1&path=${encodeURIComponent(path)}`
  } catch { return src }
}

export function mediaPreviewUrl(src) {
  return previewUrl(src, import.meta.env?.VITE_SUPABASE_URL,
    typeof window === 'undefined' ? '' : window.location.origin,
    Boolean(import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY))
}
