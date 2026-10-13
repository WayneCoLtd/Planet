// Per-viewer queue: no background photo downloads after the curtain closes.
export function createImageQueue(limit = 3) {
  const waiting = []
  const active = new Set()
  const cache = new Map()
  let disposed = false
  function pump() {
    while (!disposed && active.size < limit && waiting.length) {
      const job = waiting.shift()
      if (job.cancelled) continue
      active.add(job)
      const image = new Image()
      job.image = image
      image.decoding = 'async'
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(job.timer)
        image.onload = image.onerror = null
        active.delete(job)
        if (!job.cancelled && !disposed) {
          if (error) job.callback({ error: true })
          else {
            const result = { width: image.naturalWidth, height: image.naturalHeight }
            cache.set(job.src, result)
            if (cache.size > 32) cache.delete(cache.keys().next().value)
            job.callback(result)
          }
        }
        pump()
      }
      job.cancelActive = () => { finish(true); image.removeAttribute('src') }
      image.onload = async () => {
        try { await image.decode() } catch { /* onload succeeded; decode is optional */ }
        finish(false)
      }
      image.onerror = () => finish(true)
      job.timer = setTimeout(() => { finish(true); image.removeAttribute('src') }, 18000)
      image.src = job.src
    }
  }
  return {
    request(src, callback) {
      if (disposed) return () => {}
      if (cache.has(src)) { callback(cache.get(src)); return () => {} }
      const job = { src, callback, cancelled: false }
      waiting.push(job)
      pump()
      return () => { job.cancelled = true; job.cancelActive?.() }
    },
    dispose() {
      disposed = true
      waiting.length = 0
      for (const job of [...active]) { job.cancelled = true; job.cancelActive?.() }
      cache.clear()
    }
  }
}
