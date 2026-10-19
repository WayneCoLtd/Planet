const STORAGE_KEY = 'wwcxrl-signed-media-v1'
export function createSignedUrlCache({ now = () => Date.now(), storage = null, limit = 256 } = {}) {
  const entries = new Map()
  function info(value) {
    try {
      const url = new URL(value, 'https://relative.invalid')
      if (!/\/(?:sb\/)?storage\/v1\/object\/sign\//.test(url.pathname)) return null
      const token = url.searchParams.get('token')
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const expiry = JSON.parse(atob(encoded)).exp * 1000
      if (!Number.isFinite(expiry) || expiry <= now() + 60000) return null
      url.searchParams.delete('token')
      url.searchParams.sort()
      return { key: url.href, expiry }
    } catch { return null }
  }
  try {
    for (const value of JSON.parse(storage?.getItem(STORAGE_KEY) || '[]')) {
      const meta = info(value)
      if (meta) entries.set(meta.key, { value, expiry: meta.expiry })
    }
  } catch { /* Restricted storage must not prevent viewing. */ }
  function persist() {
    for (const [key, item] of entries) if (item.expiry <= now() + 60000) entries.delete(key)
    while (entries.size > limit) entries.delete(entries.keys().next().value)
    try { storage?.setItem(STORAGE_KEY, JSON.stringify([...entries.values()].map(item => item.value))) } catch {}
  }
  return {
    reuse(value) {
      const meta = info(value)
      if (!meta) return value
      const cached = entries.get(meta.key)
      if (cached && cached.expiry > now() + 60000) return cached.value
      entries.set(meta.key, { value, expiry: meta.expiry }); persist()
      return value
    },
    invalidate(value) {
      const meta = info(value)
      if (meta) entries.delete(meta.key)
      persist()
    },
  }
}
let cache
function getCache() {
  if (!cache) {
    let storage
    try { storage = window.sessionStorage } catch {}
    cache = createSignedUrlCache({ storage })
  }
  return cache
}
export function reuseSignedMedia(data) {
  if (Array.isArray(data)) return data.map(reuseSignedMedia)
  if (!data || typeof data !== 'object') return data
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    ['url', 'thumbUrl', 'screenshotUrl', 'coverUrl'].includes(key) && typeof value === 'string'
      ? getCache().reuse(value) : value && typeof value === 'object' ? reuseSignedMedia(value) : value]))
}
export const invalidateSignedMedia = value => getCache().invalidate(value)
