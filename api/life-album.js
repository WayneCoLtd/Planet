import { LEVEL_SITE, readLevel } from './_lib/session.js'
import { checkServiceConfig, getAdminClient } from './_lib/supabaseAdmin.js'

const TABLE = 'wwcxrl_life_photos'
const BUCKET = 'wwcxrl-photos'
const isId = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value || '',
  )
const isDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value
function jpeg(value) {
  if (
    typeof value !== 'string' ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    throw new Error('图片格式不正确')
  const bytes = Buffer.from(value.split(',')[1], 'base64')
  if (bytes.length > 1800000 || bytes[0] !== 255 || bytes[1] !== 216)
    throw new Error('图片过大或无法识别')
  return bytes
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (readLevel(req) < LEVEL_SITE)
    return res.status(401).json({ error: '请先通过站点访问密码' })
  if (!checkServiceConfig().ok)
    return res.status(503).json({ error: '相册服务暂不可用' })
  const db = getAdminClient()
  const shape = (row) => ({
    ...row,
    src: db.storage.from(BUCKET).getPublicUrl(row.image_path).data.publicUrl,
    thumb: db.storage.from(BUCKET).getPublicUrl(row.thumb_path).data.publicUrl,
  })
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'https://local.invalid')
      let query = db
        .from(TABLE)
        .select('*')
        .order('taken_on', { ascending: false })
        .order('id', { ascending: false })
        .limit(31)
      query = url.searchParams.get('hidden') === '1'
        ? query.not('deleted_at', 'is', null)
        : query.is('deleted_at', null)
      const before = url.searchParams.get('before'),
        id = url.searchParams.get('id')
      if (before || id) {
        if (!isDate(before) || !isId(id))
          return res.status(400).json({ error: '分页参数不正确' })
        query = query.or(
          `taken_on.lt.${before},and(taken_on.eq.${before},id.lt.${id})`,
        )
      }
      const { data, error } = await query
      if (error) throw error
      return res
        .status(200)
        .json({ photos: data.slice(0, 30).map(shape), more: data.length > 30 })
    }
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (!isId(body.id)) return res.status(400).json({ error: '照片编号不正确' })
    if (req.method === 'POST') {
      if (
        !['orange', 'pomelo'].includes(body.owner) ||
        !isDate(body.taken_on) ||
        !Number.isInteger(body.width) ||
        !Number.isInteger(body.height) ||
        body.width < 1 ||
        body.height < 1 ||
        body.width > 2400 ||
        body.height > 2400
      )
        return res.status(400).json({ error: '请检查日期、署名和照片尺寸' })
      const original = jpeg(body.image),
        thumb = jpeg(body.thumbnail)
      // A retry after an uncertain response returns the existing record, never duplicates it.
      const { data: existing, error: readError } = await db
        .from(TABLE)
        .select('*')
        .eq('id', body.id)
        .maybeSingle()
      if (readError) throw readError
      if (existing) return res.status(200).json({ photo: shape(existing) })
      const image_path = `life-album/${body.id}/image.jpg`,
        thumb_path = `life-album/${body.id}/thumb.jpg`
      for (const [path, bytes] of [
        [image_path, original],
        [thumb_path, thumb],
      ]) {
        const { error } = await db.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '604800', upsert: true })
        if (error) throw error
      }
      const { data, error } = await db
        .from(TABLE)
        .insert({
          id: body.id,
          owner: body.owner,
          taken_on: body.taken_on,
          caption: String(body.caption || '').slice(0, 2000),
          image_path,
          thumb_path,
          width: body.width,
          height: body.height,
        })
        .select('*')
        .single()
      if (error) throw error
      return res.status(200).json({ photo: shape(data) })
    }
    if (req.method === 'PATCH') {
      const patch =
        typeof body.hidden === 'boolean'
          ? { deleted_at: body.hidden ? new Date().toISOString() : null }
          : { caption: String(body.caption || '').slice(0, 2000) }
      const { data, error } = await db
        .from(TABLE)
        .update(patch)
        .eq('id', body.id)
        .select('*')
        .single()
      if (error) throw error
      return res.status(200).json({ photo: shape(data) })
    }
    res.setHeader('Allow', 'GET, POST, PATCH')
    return res.status(405).json({ error: '不支持的操作' })
  } catch (error) {
    console.warn('[life album]', error.code || error.message)
    return res
      .status(500)
      .json({ error: '照片暂未同步，请稍后重试；已选照片仍会保留。' })
  }
}
