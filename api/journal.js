import { LEVEL_SITE, readLevel } from './_lib/session.js'
import { checkServiceConfig, getAdminClient } from './_lib/supabaseAdmin.js'
import { decodePhotoUpload, PHOTO_UPLOAD_TYPE, readJpegBytes } from '../src/media/photoUpload.js'
import {
  JOURNAL_FIRST_DATE,
  OWNERS,
  normalizeEntry,
  entryNotes,
  normalizeGoal,
  shiftDate,
  sleepWeekStart,
  todayInShanghai,
  validDate,
  weekStart,
} from '../src/journal/journalModel.js'

const ENTRIES = 'wwcxrl_journal_entries'
const COMMENTS = 'wwcxrl_journal_comments'
const GOALS = 'wwcxrl_journal_goals'
const BUCKET = 'wwcxrl-journal'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const shape = (row) => ({
  ...row.content,
  owner: row.owner,
  date: row.date,
  version: row.version,
  updatedAt: row.updated_at,
})

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (readLevel(req) < LEVEL_SITE)
    return res.status(401).json({ error: '请先通过网站密码' })
  if (!checkServiceConfig().ok)
    return res
      .status(503)
      .json({ error: '暂时无法连接记录服务，草稿会留在本机' })
  const db = getAdminClient()
  async function withImage(entry) {
    const notes = entryNotes(entry)
    const paths = [
      ...new Set(
        [
          entry.screenshotPath,
          ...notes.flatMap((note) =>
            note.images.flatMap((image) => [image.path, image.thumbPath]),
          ),
        ].filter(Boolean),
      ),
    ]
    if (!paths.length) return entry
    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUrls(paths, 3600)
    const urls = new Map(
      (error ? [] : data || []).map((item) => [item.path, item.signedUrl]),
    )
    return {
      ...entry,
      screenshotUrl: urls.get(entry.screenshotPath) || '',
      notes: notes.map((note) => ({
        ...note,
        images: note.images.map((image) => ({
          ...image,
          url: urls.get(image.path) || '',
          thumbUrl: urls.get(image.thumbPath) || '',
        })),
      })),
    }
  }
  try {
    if (req.method === 'GET') {
      const params = new URL(req.url, 'https://local.invalid').searchParams
      const date = params.get('date')
      if (!validDate(date)) return res.status(400).json({ error: '请选择有效日期' })
      if (params.has('comments')) {
        const owner = params.get('comments')
        if (!OWNERS.includes(owner)) return res.status(400).json({ error: '书页署名不正确' })
        const comments = []
        let after = ''
        do {
          let query = db.from(COMMENTS).select('id,owner,date,text,created_at')
            .eq('owner', owner).eq('date', date).order('id').limit(200)
          if (after) query = query.gt('id', after)
          const { data, error } = await query
          if (error) throw error
          comments.push(...data)
          after = data.length === 200 ? data.at(-1).id : ''
        } while (after)
        return res.status(200).json({ comments })
      }
      const start = sleepWeekStart(date)
      const [records, ...goalResults] = await Promise.all([
        db
          .from(ENTRIES)
          .select('*')
          .gte('date', start)
          // Next Monday can contain a backfilled Sunday bedtime.
          .lte('date', shiftDate(start, 7)),
        ...OWNERS.map((owner) =>
          db
            .from(GOALS)
            .select('*')
            .eq('owner', owner)
            // Monday needs both the previous sleep week's goal and this week's setting.
            .lte('week_start', weekStart(date))
            .order('week_start', { ascending: false })
            .limit(2),
        ),
      ])
      const error = [records, ...goalResults].find(
        (result) => result.error,
      )?.error
      if (error) throw error
      return res.status(200).json({
        entries: await Promise.all(
          records.data.map((row) => row.date === date ? withImage(shape(row)) : shape(row)),
        ),
        goals: goalResults.flatMap((result) => result.data),
      })
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: '不支持的操作' })
    }
    const binary = req.headers?.['content-type'] === PHOTO_UPLOAD_TYPE
    const raw = req.body
    const body = binary ? decodePhotoUpload(raw, false) : typeof raw === 'string' ? JSON.parse(raw) : raw || {}
    if (binary && body?.action !== 'image')
      return res.status(400).json({ error: '图片上传格式不正确' })
    if (!OWNERS.includes(body.owner))
      return res.status(400).json({ error: '署名不正确' })
    if (body.action === 'goal') {
      const goal = normalizeGoal(body)
      const currentWeek = weekStart(todayInShanghai())
      if (
        body.week_start !== currentWeek ||
        !Number.isInteger(body.version) ||
        body.version < 0
      )
        return res
          .status(400)
          .json({ error: '仅可设置当前周的目标，请刷新后重试' })
      const payload = {
        owner: body.owner,
        week_start: currentWeek,
        nights: goal.nights,
        before_time: goal.before,
        version: body.version + 1,
      }
      const result =
        body.version === 0
          ? await db.from(GOALS).insert(payload).select('*').single()
          : await db
              .from(GOALS)
              .update(payload)
              .eq('owner', body.owner)
              .eq('week_start', currentWeek)
              .eq('version', body.version)
              .select('*')
              .maybeSingle()
      if (result.error?.code === '23505' || (!result.error && !result.data))
        return res
          .status(409)
          .json({ error: '目标已在另一台设备修改，请刷新后重新设置' })
      if (result.error) throw result.error
      return res.status(200).json({ goal: result.data })
    }
    if (
      !validDate(body.date) ||
      body.date < JOURNAL_FIRST_DATE ||
      body.date > todayInShanghai()
    )
      return res.status(400).json({ error: '只能记录已到来的日期' })
    if (body.action === 'comment') {
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!uuid.test(body.id) || !text || text.length > 10000)
        return res.status(400).json({ error: '请填写一万字以内的留言' })
      const row = { id: body.id, owner: body.owner, date: body.date, text }
      const inserted = await db.from(COMMENTS).insert(row).select('*').single()
      if (!inserted.error) return res.status(200).json({ comment: inserted.data })
      if (inserted.error.code !== '23505') throw inserted.error
      const existing = await db.from(COMMENTS).select('*').eq('id', row.id).single()
      if (existing.error) throw existing.error
      if (existing.data.owner !== row.owner || existing.data.date !== row.date || existing.data.text !== text)
        return res.status(409).json({ error: '这条留言已提交，请重新打开后再写一条' })
      return res.status(200).json({ comment: existing.data })
    }
    if (body.action === 'image') {
      if (!uuid.test(body.id))
        return res.status(400).json({ error: '截图格式不正确' })
      const bytes = readJpegBytes(body.image, 2097152)
      if (!bytes)
        return res.status(400).json({ error: '截图过大或格式不正确' })
      const path = `${body.owner}/${body.date}/${body.id}${body.variant === 'thumb' ? '-thumb' : ''}.jpg`
      const result = await db.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '3600', upsert: true })
      if (result.error) throw result.error
      return res.status(200).json({ screenshotPath: path })
    }
    if (body.action !== 'save')
      return res.status(400).json({ error: '操作不正确' })
    const entry = normalizeEntry(body)
    const prefix = `${entry.owner}/${entry.date}/`
    const paths = [
      entry.screenshotPath,
      ...entry.notes.flatMap((note) =>
        note.images.flatMap((image) => [image.path, image.thumbPath]),
      ),
    ].filter(Boolean)
    if (
      paths.some(
        (path) =>
          !path.startsWith(prefix) ||
          !path.endsWith('.jpg') ||
          !uuid.test(
            path.slice(prefix.length).replace(/(?:-thumb)?\.jpg$/, ''),
          ),
      )
    )
      return res.status(400).json({ error: '图片不属于这张书页' })
    // An older cached client must not silently erase notes it cannot render.
    if (
      (!Array.isArray(body.notes) || !Object.hasOwn(body, 'growthNote')) &&
      body.version > 0
    ) {
      const existing = await db
        .from(ENTRIES)
        .select('*')
        .eq('owner', body.owner)
        .eq('date', body.date)
        .maybeSingle()
      if (existing.error) throw existing.error
      if (
        !Object.hasOwn(body, 'growthNote') &&
        existing.data?.content?.growthNote
      )
        return res
          .status(409)
          .json({
            error: '书页已更新，请刷新后再保存，避免丢失进步记录',
            current: await withImage(shape(existing.data)),
          })
      if (
        !Array.isArray(body.notes) &&
        Array.isArray(existing.data?.content?.notes)
      )
        return res.status(409).json({
          error: '书页已升级为今日手记，请刷新页面后再保存',
          current: await withImage(shape(existing.data)),
        })
    }
    const { owner, date, version, screenshotUrl, ...content } = entry
    const payload = {
      owner,
      date,
      content,
      version: version + 1,
      updated_at: new Date().toISOString(),
    }
    const result =
      version === 0
        ? await db.from(ENTRIES).insert(payload).select('*').single()
        : await db
            .from(ENTRIES)
            .update(payload)
            .eq('owner', owner)
            .eq('date', date)
            .eq('version', version)
            .select('*')
            .maybeSingle()
    if (result.error?.code === '23505' || (!result.error && !result.data)) {
      const current = await db
        .from(ENTRIES)
        .select('*')
        .eq('owner', owner)
        .eq('date', date)
        .single()
      if (current.error) throw current.error
      return res.status(409).json({
        error: '另一台设备更新了这一页，你的草稿仍保留',
        current: await withImage(shape(current.data)),
      })
    }
    if (result.error) throw result.error
    return res.status(200).json({ entry: await withImage(shape(result.data)) })
  } catch (error) {
    if (
      error instanceof Error &&
      /格式|时长|一万|版本|署名|设置每周|过多/.test(error.message)
    )
      return res.status(400).json({ error: error.message })
    console.warn('[journal]', error.code || error.message)
    return res
      .status(503)
      .json({ error: '记录暂未同步，请稍后重试；本机草稿仍保留' })
  }
}
