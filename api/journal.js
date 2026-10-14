import { LEVEL_SITE, readLevel } from './_lib/session.js'
import { checkServiceConfig, getAdminClient } from './_lib/supabaseAdmin.js'
import {
  JOURNAL_FIRST_DATE,
  OWNERS,
  normalizeEntry,
  normalizeGoal,
  shiftDate,
  todayInShanghai,
  validDate,
  weekStart,
} from '../src/journal/journalModel.js'

const ENTRIES = 'wwcxrl_journal_entries'
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
    if (!entry.screenshotPath) return entry
    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUrl(entry.screenshotPath, 3600)
    return { ...entry, screenshotUrl: error ? '' : data.signedUrl }
  }
  try {
    if (req.method === 'GET') {
      const date = new URL(req.url, 'https://local.invalid').searchParams.get(
        'date',
      )
      if (!validDate(date))
        return res.status(400).json({ error: '请选择有效日期' })
      const start = weekStart(date),
        next = shiftDate(start, 7)
      const [records, ...goalResults] = await Promise.all([
        db
          .from(ENTRIES)
          .select('*')
          .gte('date', start)
          .lte('date', shiftDate(start, 6)),
        ...OWNERS.map((owner) =>
          db
            .from(GOALS)
            .select('*')
            .eq('owner', owner)
            .lte('week_start', next)
            .order('week_start', { ascending: false })
            .limit(2),
        ),
      ])
      const error = [records, ...goalResults].find(
        (result) => result.error,
      )?.error
      if (error) throw error
      return res
        .status(200)
        .json({
          entries: await Promise.all(
            records.data.map((row) => withImage(shape(row))),
          ),
          goals: goalResults.flatMap((result) => result.data),
        })
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: '不支持的操作' })
    }
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (!OWNERS.includes(body.owner))
      return res.status(400).json({ error: '署名不正确' })
    if (body.action === 'goal') {
      const goal = normalizeGoal(body)
      const nextWeek = shiftDate(weekStart(todayInShanghai()), 7)
      if (
        body.week_start !== nextWeek ||
        !Number.isInteger(body.version) ||
        body.version < 0
      )
        return res
          .status(400)
          .json({ error: '目标从下周开始生效，请刷新后重试' })
      const payload = {
        owner: body.owner,
        week_start: nextWeek,
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
              .eq('week_start', nextWeek)
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
    if (body.action === 'image') {
      if (
        !uuid.test(body.id) ||
        typeof body.image !== 'string' ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image)
      )
        return res.status(400).json({ error: '截图格式不正确' })
      const bytes = Buffer.from(body.image.split(',')[1], 'base64')
      if (bytes.length > 2097152 || bytes[0] !== 255 || bytes[1] !== 216)
        return res.status(400).json({ error: '截图过大或格式不正确' })
      const path = `${body.owner}/${body.date}/${body.id}.jpg`
      const result = await db.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
      if (result.error) throw result.error
      return res.status(200).json({ screenshotPath: path })
    }
    if (body.action !== 'save')
      return res.status(400).json({ error: '操作不正确' })
    const entry = normalizeEntry(body)
    if (entry.screenshotPath) {
      const prefix = `${entry.owner}/${entry.date}/`
      if (
        !entry.screenshotPath.startsWith(prefix) ||
        !uuid.test(
          entry.screenshotPath.slice(prefix.length).replace(/\.jpg$/, ''),
        )
      )
        return res.status(400).json({ error: '截图不属于这张书页' })
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
      return res
        .status(409)
        .json({
          error: '另一台设备更新了这一页，你的草稿仍保留',
          current: await withImage(shape(current.data)),
        })
    }
    if (result.error) throw result.error
    return res.status(200).json({ entry: await withImage(shape(result.data)) })
  } catch (error) {
    if (
      error instanceof Error &&
      /格式|时长|一万|版本|署名|设置每周/.test(error.message)
    )
      return res.status(400).json({ error: error.message })
    console.warn('[journal]', error.code || error.message)
    return res
      .status(503)
      .json({ error: '记录暂未同步，请稍后重试；本机草稿仍保留' })
  }
}
