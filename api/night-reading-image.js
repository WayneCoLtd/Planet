const ALLOWED_IMAGE_HOSTS = new Set([
  'mmbiz.qpic.cn'
])

export default async function handler(request, response) {
  const target = String(request.query.url || '').trim()

  if (!target) {
    return response.status(400).send('Missing url parameter')
  }

  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return response.status(400).send('Invalid url')
  }

  if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    return response.status(403).send('Host not allowed')
  }

  const upstream = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
      Referer: 'https://mp.weixin.qq.com/'
    }
  })

  if (!upstream.ok) {
    return response.status(upstream.status).send('Upstream image failed')
  }

  const contentType = upstream.headers.get('content-type') || 'image/jpeg'
  const body = Buffer.from(await upstream.arrayBuffer())

  response.setHeader('Content-Type', contentType)
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Cache-Control', 'public, max-age=3600')
  return response.status(200).send(body)
}
