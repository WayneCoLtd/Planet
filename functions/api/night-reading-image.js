const ALLOWED_IMAGE_HOSTS = new Set([
  'mmbiz.qpic.cn',
  'mmbiz.qpic.cn'
])

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url)
  const target = requestUrl.searchParams.get('url')

  if (!target) {
    return new Response('Missing url parameter', { status: 400 })
  }

  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return new Response('Invalid url', { status: 400 })
  }

  if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    return new Response('Host not allowed', { status: 403 })
  }

  const upstream = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
      Referer: 'https://mp.weixin.qq.com/'
    }
  })

  if (!upstream.ok) {
    return new Response('Upstream image failed', { status: upstream.status })
  }

  const body = await upstream.arrayBuffer()
  const contentType = upstream.headers.get('content-type') || 'image/jpeg'

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600'
    }
  })
}
