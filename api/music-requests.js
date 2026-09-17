// 点歌台留言（与网站建议箱、小信箱相互独立，各自一张表）。
//
//   GET    /api/music-requests           列表，新的在前面
//   POST   /api/music-requests           写一条 { content, role, displayName, trackId }
//   DELETE /api/music-requests?id=<id>   删一条
//
// 与曲库一样，表开了 RLS 且没有匿名策略，前端只能经由这里访问。
import { LEVEL_SITE, readLevel } from './_lib/session.js'
import { checkServiceConfig, getAdminClient, getSupabaseTargetInfo } from './_lib/supabaseAdmin.js'

const MAX_CONTENT_LENGTH = 200
const ROLE_NAMES = { orange: '小琛', pomelo: '小琳', guest: '神秘访客' }

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
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

function isSafeId(value) {
  return /^[0-9a-fA-F-]{36}$/.test(String(value || ''))
}

function shapeRow(row) {
  return {
    id: row.id,
    role: row.role || 'pomelo',
    displayName: row.display_name || ROLE_NAMES[row.role] || '神秘访客',
    content: row.content || '',
    trackId: row.track_id || null,
    status: row.status || 'open',
    createdAt: row.created_at
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')

  if (readLevel(request) < LEVEL_SITE) {
    return response.status(401).json({ ok: false, error: '请先通过站点访问密码' })
  }
  const config = checkServiceConfig()
  if (!config.ok) {
    return response.status(503).json({
      ok: false,
      error: config.reason === 'missing'
        ? '服务端还没配置 SUPABASE_SERVICE_ROLE_KEY'
        : `服务端密钥属于另一个项目（${config.keyRef}），请换成 ${config.host} 这个项目的 service_role 密钥`
    })
  }
  const admin = getAdminClient()

  try {
    if (request.method === 'GET') {
      const { data, error } = await admin
        .from('wwcxrl_music_requests')
        .select('id,role,display_name,content,track_id,status,created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) return response.status(500).json({ ok: false, error: error.message })
      return response.status(200).json({ ok: true, requests: (data || []).map(shapeRow) })
    }

    if (request.method === 'POST') {
      const body = readBody(request)
      const content = cleanText(body.content, MAX_CONTENT_LENGTH)
      if (!content) return response.status(400).json({ ok: false, error: '还没写想听什么' })
      const role = ['orange', 'pomelo'].includes(body.role) ? body.role : 'pomelo'
      const row = {
        user_id: `wwcxrl-${role}-main`,
        role,
        display_name: cleanText(body.displayName, 20) || ROLE_NAMES[role],
        content,
        track_id: isSafeId(body.trackId) ? body.trackId : null,
        status: 'open'
      }
      const { data, error } = await admin
        .from('wwcxrl_music_requests')
        .insert(row)
        .select('id,role,display_name,content,track_id,status,created_at')
        .single()
      if (error) return response.status(500).json({ ok: false, error: error.message })
      return response.status(200).json({ ok: true, request: shapeRow(data) })
    }

    if (request.method === 'DELETE') {
      const url = new URL(request.url || '/api/music-requests', 'https://placeholder.local')
      const id = url.searchParams.get('id')
      if (!isSafeId(id)) return response.status(400).json({ ok: false, error: '记录 ID 不合法' })
      const { error } = await admin.from('wwcxrl_music_requests').delete().eq('id', id)
      if (error) return response.status(500).json({ ok: false, error: error.message })
      return response.status(200).json({ ok: true })
    }

    response.setHeader('Allow', 'GET, POST, DELETE')
    return response.status(405).json({ ok: false, error: '不支持的请求方式' })
  } catch (error) {
    console.warn('[wwcxrl music] requests handler error', error)
    return response.status(500).json({
      ok: false,
      error: error.message || '服务端出错了',
      target: getSupabaseTargetInfo()
    })
  }
}
