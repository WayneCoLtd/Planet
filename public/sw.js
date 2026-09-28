const SHELL_CACHE = 'wwcxrl-shell-v1'
const APP_SHELL = '/'
const PRECACHE = [APP_SHELL, '/connection-check.html']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
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
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      try {
        const response = await networkWithTimeout(request)
        if (response.ok) await cache.put(APP_SHELL, response.clone())
        return response
      } catch {
        return (await cache.match(APP_SHELL)) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/') || url.pathname.startsWith('/games/')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    })())
  }
})
