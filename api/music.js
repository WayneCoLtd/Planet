// 音乐室的服务端接口。
//
// 为什么全部放在服务端：
//   * 曲库表开了 RLS 且没有任何匿名策略 —— 前端拿着网页里的公开密钥根本读不到；
//   * 音乐桶是私有桶 —— 匿名密钥签不出任何链接；
//   * 只有这里（带 service_role）能访问，而且先校验访问口令签发的 Cookie。
// 于是「没通过口令的人一个音频文件都拿不到」这件事才真正成立。
//
// 接口：
//   GET  /api/music                   曲目列表（默认只给已发布；管理员加 ?all=1 连草稿一起）
//   GET  /api/music?sign=<曲目id>      这一首的限时播放地址
//   POST /api/music { action: ... }    管理操作：上传签名 / 新建 / 修改 / 删除
import crypto from 'node:crypto'
import { LEVEL_ADMIN, LEVEL_SITE, readLevel } from './_lib/session.js'
import { MUSIC_BUCKET, getAdminClient, isAdminConfigured } from './_lib/supabaseAdmin.js'

const PLAY_TTL_SECONDS = 4 * 60 * 60 // 播放链接 4 小时
const COVER_TTL_SECONDS = 6 * 60 * 60 // 封面链接 6 小时
const MAX_TITLE_LENGTH = 80
const MAX_SHORT_TEXT = 60

const AUDIO_EXT_BY_TYPE = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav'
}

const COVER_EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

function cleanText(value, max = MAX_SHORT_TEXT) {
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

// 只接受我们自己生成的路径，避免被指向桶里的任意文件。
function isOurPath(value, prefix) {
  const path = String(value || '')
  return path.startsWith(prefix) && path.length <= 160 && !path.includes('..') && /^[A-Za-z0-9._/-]+$/.test(path)
}

function isSafeId(value) {
  return /^[0-9a-fA-F-]{36}$/.test(String(value || ''))
}

function shapeTrack(row, coverUrl) {
  return {
    id: row.id,
    title: row.title || '',
    artist: row.artist || '',
    mood: row.mood || '',
    duration: Number(row.duration_seconds || 0),
    sort: Number(row.sort || 0),
    status: row.status || 'draft',
    hasAudio: Boolean(row.audio_path),
    coverUrl: coverUrl || ''
  }
}

// 一次性给整页封面签名，避免每首歌各发一次请求。
async function signCovers(admin, rows) {
  const paths = Array.from(new Set(rows.map(row => row.cover_path).filter(Boolean)))
  if (!paths.length) return {}
  const { data, error } = await admin.storage.from(MUSIC_BUCKET).createSignedUrls(paths, COVER_TTL_SECONDS)
  if (error) {
    console.warn('[wwcxrl music] cover sign failed', error.message)
    return {}
  }
  const map = {}
  for (const item of data || []) {
    if (item && item.path && item.signedUrl) map[item.path] = item.signedUrl
  }
  return map
}

async function listTracks(admin, includeDrafts) {
  let query = admin
    .from('wwcxrl_music_tracks')
    .select('id,title,artist,mood,audio_path,cover_path,duration_seconds,sort,status,created_at')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (!includeDrafts) query = query.eq('status', 'published')
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data || []
  const covers = await signCovers(admin, rows)
  return rows.map(row => shapeTrack(row, covers[row.cover_path]))
}

async function handleSignPlay(response, admin, id) {
  if (!isSafeId(id)) return response.status(400).json({ ok: false, error: '曲目 ID 不合法' })
  const { data: row, error } = await admin
    .from('wwcxrl_music_tracks')
    .select('id,audio_path')
    .eq('id', id)
    .maybeSingle()
  if (error) return response.status(500).json({ ok: false, error: error.message })
  if (!row || !row.audio_path) return response.status(404).json({ ok: false, error: '这首还没有音频文件' })
  const { data: signed, error: signError } = await admin.storage
    .from(MUSIC_BUCKET)
    .createSignedUrl(row.audio_path, PLAY_TTL_SECONDS)
  if (signError || !signed || !signed.signedUrl) {
    return response.status(502).json({ ok: false, error: (signError && signError.message) || '签名失败' })
  }
  return response.status(200).json({ ok: true, url: signed.signedUrl, expiresIn: PLAY_TTL_SECONDS })
}

async function handleSignUpload(response, admin, body) {
  const kind = body.kind === 'cover' ? 'cover' : 'audio'
  const contentType = cleanText(body.contentType, 60).toLowerCase()
  const ext = kind === 'cover' ? COVER_EXT_BY_TYPE[contentType] : AUDIO_EXT_BY_TYPE[contentType]
  if (!ext) {
    return response.status(400).json({
      ok: false,
      error: kind === 'cover' ? '封面只支持 JPG / PNG / WebP' : '音频只支持 MP3 / M4A / WAV'
    })
  }
  const path = `${kind === 'cover' ? 'covers' : 'tracks'}/${crypto.randomUUID()}.${ext}`
  const { data, error } = await admin.storage.from(MUSIC_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return response.status(502).json({ ok: false, error: (error && error.message) || '上传地址生成失败' })
  return response.status(200).json({ ok: true, path, token: data.token, uploadUrl: data.signedUrl })
}

async function handleCreate(response, admin, body) {
  const title = cleanText(body.title, MAX_TITLE_LENGTH)
  const audioPath = cleanText(body.audioPath, 160)
  if (!title) return response.status(400).json({ ok: false, error: '还没写歌名' })
  if (!isOurPath(audioPath, 'tracks/')) return response.status(400).json({ ok: false, error: '音频还没上传成功' })
  const coverPath = cleanText(body.coverPath, 160)
  const row = {
    title,
    artist: cleanText(body.artist),
    mood: cleanText(body.mood),
    audio_path: audioPath,
    cover_path: isOurPath(coverPath, 'covers/') ? coverPath : '',
    duration_seconds: Number.isFinite(Number(body.duration)) ? Math.max(0, Math.round(Number(body.duration))) : 0,
    sort: Number.isFinite(Number(body.sort)) ? Math.round(Number(body.sort)) : 0,
    status: body.status === 'published' ? 'published' : 'draft',
    created_by: cleanText(body.createdBy, 20) || 'pomelo',
    updated_at: new Date().toISOString()
  }
  const { data, error } = await admin.from('wwcxrl_music_tracks').insert(row).select('id').single()
  if (error) return response.status(500).json({ ok: false, error: error.message })
  return response.status(200).json({ ok: true, id: data.id })
}

async function handleUpdate(response, admin, body) {
  const id = cleanText(body.id, 40)
  if (!isSafeId(id)) return response.status(400).json({ ok: false, error: '曲目 ID 不合法' })
  const patch = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) {
    const title = cleanText(body.title, MAX_TITLE_LENGTH)
    if (!title) return response.status(400).json({ ok: false, error: '歌名不能为空' })
    patch.title = title
  }
  if (body.artist !== undefined) patch.artist = cleanText(body.artist)
  if (body.mood !== undefined) patch.mood = cleanText(body.mood)
  if (body.status !== undefined) patch.status = body.status === 'published' ? 'published' : 'draft'
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.round(Number(body.sort))
  if (body.duration !== undefined && Number.isFinite(Number(body.duration))) {
    patch.duration_seconds = Math.max(0, Math.round(Number(body.duration)))
  }
  if (body.audioPath !== undefined && isOurPath(body.audioPath, 'tracks/')) patch.audio_path = cleanText(body.audioPath, 160)
  if (body.coverPath !== undefined) {
    patch.cover_path = isOurPath(body.coverPath, 'covers/') ? cleanText(body.coverPath, 160) : ''
  }
  const { error } = await admin.from('wwcxrl_music_tracks').update(patch).eq('id', id)
  if (error) return response.status(500).json({ ok: false, error: error.message })
  return response.status(200).json({ ok: true })
}

async function handleDelete(response, admin, body) {
  const id = cleanText(body.id, 40)
  if (!isSafeId(id)) return response.status(400).json({ ok: false, error: '曲目 ID 不合法' })
  const { data: row, error } = await admin
    .from('wwcxrl_music_tracks')
    .select('id,audio_path,cover_path')
    .eq('id', id)
    .maybeSingle()
  if (error) return response.status(500).json({ ok: false, error: error.message })
  if (!row) return response.status(404).json({ ok: false, error: '这首已经不在了' })

  const { error: deleteError } = await admin.from('wwcxrl_music_tracks').delete().eq('id', id)
  if (deleteError) return response.status(500).json({ ok: false, error: deleteError.message })

  // 顺手把桶里的音频和封面也清掉，避免留下孤儿文件白占容量。
  const files = [row.audio_path, row.cover_path].filter(Boolean)
  if (files.length) {
    const { error: removeError } = await admin.storage.from(MUSIC_BUCKET).remove(files)
    if (removeError) console.warn('[wwcxrl music] file cleanup failed', removeError.message)
  }
  return response.status(200).json({ ok: true })
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')

  const level = readLevel(request)
  if (level < LEVEL_SITE) {
    return response.status(401).json({ ok: false, error: '请先通过站点访问密码' })
  }
  if (!isAdminConfigured()) {
    return response.status(503).json({ ok: false, error: '服务端还没配置 SUPABASE_SERVICE_ROLE_KEY' })
  }
  const admin = getAdminClient()

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url || '/api/music', 'https://placeholder.local')
      const signId = url.searchParams.get('sign')
      if (signId) return await handleSignPlay(response, admin, signId)
      const includeDrafts = url.searchParams.get('all') === '1' && level >= LEVEL_ADMIN
      const tracks = await listTracks(admin, includeDrafts)
      return response.status(200).json({ ok: true, tracks, canManage: level >= LEVEL_ADMIN })
    }

    if (request.method === 'POST') {
      const body = readBody(request)
      if (level < LEVEL_ADMIN) {
        return response.status(403).json({ ok: false, error: '只有管理员能改曲库' })
      }
      switch (body.action) {
        case 'sign-upload':
          return await handleSignUpload(response, admin, body)
        case 'create':
          return await handleCreate(response, admin, body)
        case 'update':
          return await handleUpdate(response, admin, body)
        case 'delete':
          return await handleDelete(response, admin, body)
        default:
          return response.status(400).json({ ok: false, error: '未知操作' })
      }
    }

    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ ok: false, error: '不支持的请求方式' })
  } catch (error) {
    console.warn('[wwcxrl music] handler error', error)
    return response.status(500).json({ ok: false, error: error.message || '服务端出错了' })
  }
}
