import { randomUUID } from 'node:crypto'
import { LEVEL_SITE, readLevel } from './_lib/session.js'
import { checkServiceConfig, getAdminClient } from './_lib/supabaseAdmin.js'
import { decodePhotoUpload, PHOTO_UPLOAD_TYPE, readJpegBytes } from '../src/media/photoUpload.js'

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
function imagePair(body) {
  const original = readJpegBytes(body.image, 1800000)
  const thumbnail = readJpegBytes(body.thumbnail, 1800000)
  if (!original || !thumbnail || ![body.width, body.height].every(n => Number.isInteger(n) && n > 0 && n <= 2400)) return null
  return { original, thumbnail }
}
async function uploadPair(storage, paths, images, upsert) {
  const files = [[paths.image_path, images.original], [paths.thumb_path, images.thumbnail]]
  const uploads = await Promise.allSettled(files.map(async ([path, bytes]) => {
    const { error } = await storage.upload(path, bytes, {
      contentType: 'image/jpeg', cacheControl: '604800', upsert,
    })
    if (error) throw error
  }))
  const failed = uploads.find(result => result.status === 'rejected')
  if (failed) throw failed.reason
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
    const binary = req.headers?.['content-type'] === PHOTO_UPLOAD_TYPE
    const raw = req.body
    const body = binary ? decodePhotoUpload(raw, true) : typeof raw === 'string' ? JSON.parse(raw) : raw || {}
    if (binary && (!body || !(req.method === 'POST' || (req.method === 'PATCH' && body.action === 'edit'))))
      return res.status(400).json({ error: '照片上传格式不正确' })
    if (!isId(body.id)) return res.status(400).json({ error: '照片编号不正确' })
    if (req.method === 'POST') {
      if (!['orange', 'pomelo'].includes(body.owner) || !isDate(body.taken_on))
        return res.status(400).json({ error: '请检查日期和署名' })
      const images = imagePair(body)
      if (!images)
        return res.status(400).json({ error: '图片过大或无法识别' })
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
      const storage = db.storage.from(BUCKET)
      await uploadPair(storage, { image_path, thumb_path }, images, true)
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
    if (req.method === 'PATCH' && body.action === 'edit') {
      if (!isId(body.editId) || !(body.base === null || isId(body.base)) ||
          !['orange', 'pomelo'].includes(body.owner) || !isDate(body.taken_on) ||
          typeof body.caption !== 'string' || body.caption.length > 2000)
        return res.status(400).json({ error: '请检查日期、署名和配文' })
      const read = () => db.from(TABLE).select('*').eq('id', body.id).is('deleted_at', null).maybeSingle()
      const current = await read()
      if (current.error) throw current.error
      if (!current.data) return res.status(404).json({ error: '照片已收起或不存在' })
      if (current.data.edit_id === body.editId) return res.status(200).json({ photo: shape(current.data) })
      const conflict = row => res.status(409).json({
        error: '另一台设备修改了这张照片，你填写的内容还在。',
        current: row ? shape(row) : null,
      })
      if ((current.data.edit_id ?? null) !== body.base) return conflict(current.data)
      const patch = { owner: body.owner, taken_on: body.taken_on, caption: body.caption, edit_id: body.editId }
      const storage = db.storage.from(BUCKET)
      let paths
      if (binary) {
        const images = imagePair(body)
        if (!images) return res.status(400).json({ error: '替换图片过大或无法识别' })
        const prefix = 'life-album/' + body.id + '/' + randomUUID()
        paths = { image_path: prefix + '.jpg', thumb_path: prefix + '-thumb.jpg' }
        try {
          await uploadPair(storage, paths, images, false)
        } catch (error) {
          await storage.remove(Object.values(paths))
          throw error
        }
        Object.assign(patch, paths, { width: body.width, height: body.height })
      }
      let update = db.from(TABLE).update(patch).eq('id', body.id).is('deleted_at', null)
      update = body.base === null ? update.is('edit_id', null) : update.eq('edit_id', body.base)
      const saved = await update.select('*').maybeSingle()
      if (saved.error) throw saved.error
      if (!saved.data) {
        if (paths) await storage.remove(Object.values(paths))
        const latest = await read()
        if (latest.error) throw latest.error
        if (latest.data?.edit_id === body.editId) return res.status(200).json({ photo: shape(latest.data) })
        return conflict(latest.data)
      }
      return res.status(200).json({ photo: shape(saved.data) })
    }
    if (req.method === 'PATCH') {
      const patch =
        typeof body.hidden === 'boolean'
          ? { deleted_at: body.hidden ? new Date().toISOString() : null }
          : { caption: String(body.caption || '').slice(0, 2000) }
      const { data, error } = await db
        .from(TABLE)
        .update({ ...patch, edit_id: randomUUID() })
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
