const SHELL_CACHE = 'wwcxrl-shell-v2'
const APP_SHELL = '/'
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    const response = await fetch(APP_SHELL, { cache: 'reload' })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('App shell unavailable')
    }
    const html = await response.clone().text()
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map(match => match[1])
    await cache.addAll([...new Set(assets)])
    await cache.put(APP_SHELL, response)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('wwcxrl-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

async function networkWithTimeout(request, timeoutMs = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(request, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sb/')) return

  if (request.mode === 'navigate') {
    // Games and diagnostic pages are independent documents, never the app shell.
    if (url.pathname !== '/') return
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      try {
        const response = await networkWithTimeout(request)
        if (!response.ok) return (await cache.match(APP_SHELL)) || response
        if (response.headers.get('content-type')?.includes('text/html')) {
          event.waitUntil(cache.put(APP_SHELL, response.clone()).catch(() => {}))
        }
        return response
      } catch {
        return (await cache.match(APP_SHELL)) || Response.error()
      }
    })())
    return
  }

  // Only hashed build assets are immutable. Images and games may change at the
  // same URL and should follow HTTP caching instead of staying stale forever.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
        event.waitUntil(cache.put(request, response.clone()).catch(() => {}))
      }
      return response
    })())
  }
})
