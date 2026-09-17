// 站点访问密码（服务端校验）。
//
// 为什么要放在服务端：之前管理端密码是写在前端里的，会随打包一起公开，
// 任何人查看网页源代码就能搜到。这里改成只在服务端比对，浏览器永远拿不到密码。
//
// 接口：
//   GET    /api/access              -> { enabled, ok, level }
//   POST   /api/access  { password, scope } -> 成功后种下 HttpOnly Cookie
//   DELETE /api/access              -> 退出
import {
  LEVEL_ADMIN,
  LEVEL_NONE,
  LEVEL_SITE,
  buildCookie,
  clearCookie,
  getAdminPassword,
  getClientIp,
  getSitePassword,
  isGateEnabled,
  readLevel,
  safeEqual,
  signToken
} from './_lib/session.js'

const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX_FAILURES = 6

// 内存限速：函数实例之间不共享，属于尽力而为的挡一层，
// 用来补偿 4 位数字密码本身强度不高的问题。
const failures = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const record = failures.get(ip)
  if (!record || now - record.firstAt > RATE_WINDOW_MS) return { blocked: false }
  if (record.count >= RATE_MAX_FAILURES) {
    return { blocked: true, retryAfterSeconds: Math.ceil((RATE_WINDOW_MS - (now - record.firstAt)) / 1000) }
  }
  return { blocked: false }
}

function noteFailure(ip) {
  const now = Date.now()
  const record = failures.get(ip)
  if (!record || now - record.firstAt > RATE_WINDOW_MS) {
    failures.set(ip, { count: 1, firstAt: now })
    return
  }
  record.count += 1
}

function clearFailures(ip) {
  failures.delete(ip)
}

function readBody(request) {
  const raw = request.body
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch {
    return {}
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')

  const enabled = isGateEnabled()
  const currentLevel = readLevel(request)

  if (request.method === 'GET') {
    return response.status(200).json({
      enabled,
      ok: !enabled || currentLevel >= LEVEL_SITE,
      level: enabled ? currentLevel : LEVEL_ADMIN
    })
  }

  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', clearCookie())
    return response.status(200).json({ ok: true, level: LEVEL_NONE })
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST, DELETE')
    return response.status(405).json({ ok: false, error: '不支持的请求方式' })
  }

  // 没配密码时不做校验，避免刚部署就把自己关在外面。
  if (!enabled) {
    return response.status(200).json({ enabled: false, ok: true, level: LEVEL_ADMIN })
  }

  const body = readBody(request)
  const scope = body.scope === 'admin' ? 'admin' : 'site'
  const expected = scope === 'admin' ? getAdminPassword() : getSitePassword()

  if (!expected) {
    return response.status(400).json({ ok: false, error: scope === 'admin' ? '未配置管理密码' : '未配置访问密码' })
  }

  // 管理端必须先通过站点密码，不允许越级。
  if (scope === 'admin' && currentLevel < LEVEL_SITE) {
    return response.status(403).json({ ok: false, error: '请先通过站点访问密码' })
  }

  const ip = getClientIp(request)
  const rate = checkRateLimit(ip)
  if (rate.blocked) {
    response.setHeader('Retry-After', String(rate.retryAfterSeconds))
    return response.status(429).json({ ok: false, error: `尝试次数过多，请 ${Math.ceil(rate.retryAfterSeconds / 60)} 分钟后再试` })
  }

  if (!safeEqual(body.password, expected)) {
    noteFailure(ip)
    const record = failures.get(ip)
    const left = Math.max(0, RATE_MAX_FAILURES - (record ? record.count : 0))
    return response.status(401).json({
      ok: false,
      error: left > 0 ? `密码不对哦，还能再试 ${left} 次` : '尝试次数过多，请稍后再试'
    })
  }

  clearFailures(ip)
  const nextLevel = scope === 'admin' ? LEVEL_ADMIN : Math.max(currentLevel, LEVEL_SITE)
  const token = signToken({ lv: nextLevel, exp: Date.now() + 180 * 24 * 60 * 60 * 1000 })
  response.setHeader('Set-Cookie', buildCookie(token))
  return response.status(200).json({ enabled: true, ok: true, level: nextLevel })
}
