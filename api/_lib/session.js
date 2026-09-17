// 访问会话的公共逻辑：签名、校验、Cookie 读写。
// 这个目录以 _ 开头，Vercel 不会把它当成接口路由。
import crypto from 'node:crypto'

export const COOKIE_NAME = 'wwcxrl_access'
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180 // 180 天：平时访问不必反复输密码

export const LEVEL_NONE = 0
export const LEVEL_SITE = 1
export const LEVEL_ADMIN = 2

// 站点访问密码；没配置就让门保持关闭状态（见 isGateEnabled）。
export function getSitePassword() {
  return String(process.env.SITE_ACCESS_PASSWORD || '').trim()
}

export function getAdminPassword() {
  // 没单独配管理密码时退回用站点密码，避免出现「管理页进不去」的锁死情况。
  return String(process.env.ADMIN_PASSWORD || '').trim() || getSitePassword()
}

// 只有配了【站点访问密码】这道门才生效。
// 这样先部署、再去 Vercel 配环境变量也不会把自己锁在外面；
// 只配了管理密码时，站点照常打开，管理页仍然要密码。
export function isGateEnabled() {
  return Boolean(getSitePassword())
}

function getSecret() {
  // SESSION_SECRET 是可选的；没配就退回用密码本身派生，改密码即让所有会话失效。
  return String(process.env.SESSION_SECRET || '').trim() || getSitePassword() || getAdminPassword()
}

function base64url(input) {
  return Buffer.from(input).toString('base64url')
}

export function signToken(payload) {
  const secret = getSecret()
  if (!secret) return ''
  const body = base64url(JSON.stringify(payload))
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyToken(token) {
  const secret = getSecret()
  if (!secret || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function parseCookies(header) {
  const out = {}
  if (!header || typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (!key) continue
    out[key] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

// 读取当前请求的访问等级（0 = 未通过，1 = 站点，2 = 管理员）。
export function readLevel(request) {
  if (!isGateEnabled()) return LEVEL_SITE
  const cookies = parseCookies(request.headers && request.headers.cookie)
  const payload = verifyToken(cookies[COOKIE_NAME])
  if (!payload) return LEVEL_NONE
  return Number(payload.lv) >= LEVEL_ADMIN ? LEVEL_ADMIN : LEVEL_SITE
}

export function buildCookie(value) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  ]
  return parts.join('; ')
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

// 定长比较，避免通过响应时间猜密码。
export function safeEqual(input, expected) {
  const a = Buffer.from(String(input == null ? '' : input))
  const b = Buffer.from(String(expected == null ? '' : expected))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function getClientIp(request) {
  const headers = request.headers || {}
  const forwarded = headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim()
  return headers['x-real-ip'] || 'unknown'
}
