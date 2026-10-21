export const JOURNAL_FIRST_DATE = '2026-10-14'
export const OWNERS = ['orange', 'pomelo']
export const OWNER_NAMES = { orange: '小琛', pomelo: '小琳' }
export const DEFAULT_GOAL = { nights: 5, before: '00:00' }

export function todayInShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type).value)
    .join('-')
}
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
export function shiftDate(date, days) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}
export function weekStart(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  return shiftDate(date, -((weekday + 6) % 7))
}
// A Monday journal page records Sunday night, which belongs to the prior week.
export function sleepWeekStart(pageDate) {
  return weekStart(shiftDate(pageDate, -1))
}
export function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}
export function emptyEntry(owner, date) {
  return {
    owner,
    date,
    sleepTime: '',
    sleepPreviousDay: true,
    activities: '',
    growthNote: '',
    studyMinutes: null,
    screenshotPath: '',
    screenshotUrl: '',
    checkedIn: false,
    version: 0,
  }
}
// Compare authored content, not versions or expiring image URLs.
export function entryFingerprint(entry) {
  return JSON.stringify({
    sleepTime: entry.sleepTime || '',
    studyMinutes: entry.studyMinutes ?? null,
    growthNote: entry.growthNote || '',
    screenshotPath: entry.screenshotPath || '',
    pendingImage: entry.pendingImage || null,
    notes: entryNotes(entry).filter(note => note.text || note.images.length).map(note => ({
      text: note.text,
      images: note.images.map(image => ({ id: image.id, path: image.path || '', thumbPath: image.thumbPath || '', pendingImage: image.pendingImage || null })),
    })),
  })
}
export function redundantDraft(draft, remote) {
  const value = entryFingerprint(draft.entry)
  return value === entryFingerprint(remote)
    || (draft.base != null && value === draft.base)
    || (draft.entry.version === 0 && value === entryFingerprint(emptyEntry(draft.entry.owner, draft.entry.date)))
}
export function mergeRemoteEntries(previous, incoming) {
  const records = new Map(previous.map(entry => [`${entry.date}:${entry.owner}`, entry]))
  for (const entry of incoming) {
    const key = `${entry.date}:${entry.owner}`
    if (!records.has(key) || records.get(key).version <= entry.version) records.set(key, entry)
  }
  return [...records.values()]
}
// Legacy text becomes one note without changing whitespace, checkin or sleep data.
export function entryNotes(entry) {
  if (Array.isArray(entry.notes)) return entry.notes
  return entry.activities
    ? [{ id: 'legacy-activities', text: entry.activities, images: [] }]
    : []
}
export function hasNoteContent(note) {
  return Boolean(note.text?.trim() || note.images?.length)
}
export function visibleNotes(notes, editingId = null) {
  return notes.filter((note) => note.id === editingId || hasNoteContent(note))
}
export function journalText(notes) {
  return notes
    .map((note) => note.text)
    .filter((text) => text.length > 0)
    .join('\n\n')
}
export function singleJournalNote(
  notes,
  text,
  images = notes.flatMap((note) => note.images),
) {
  return [{ id: notes[0]?.id || 'journal-body', text, images }]
}
export function bulletAtLine(text, position) {
  const start = position === 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1
  if (text.slice(start).startsWith('· ')) return { text, caret: position }
  return {
    text: `${text.slice(0, start)}· ${text.slice(start)}`,
    caret: position + 2,
  }
}
// Refresh expiring signed URLs without replacing a user's unsaved text or order.
export function mergeEntryMedia(local, remote) {
  const images = new Map(
    entryNotes(remote)
      .flatMap((note) => note.images)
      .filter((image) => image.path)
      .map((image) => [image.path, image]),
  )
  return {
    ...local,
    screenshotUrl:
      !local.pendingImage &&
      local.screenshotPath &&
      local.screenshotPath === remote.screenshotPath
        ? remote.screenshotUrl
        : local.screenshotUrl,
    notes: entryNotes(local).map((note) => ({
      ...note,
      images: note.images.map((image) => {
        const fresh = images.get(image.path)
        return !image.pendingImage && fresh
          ? { ...image, url: fresh.url, thumbUrl: fresh.thumbUrl }
          : image
      }),
    })),
  }
}
export function normalizeNotes(notes) {
  if (!Array.isArray(notes) || notes.length > 100)
    throw new Error('手记格式不正确或条目过多')
  const ids = new Set()
  let images = 0
  return notes.map((note) => {
    if (
      !note ||
      typeof note.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(note.id) ||
      ids.has(note.id)
    )
      throw new Error('手记编号格式不正确')
    ids.add(note.id)
    if (
      typeof note.text !== 'string' ||
      note.text.length > 10000 ||
      !Array.isArray(note.images)
    )
      throw new Error('手记格式不正确，每条文字请控制在一万字以内')
    images += note.images.length
    if (images > 100) throw new Error('单页附图过多，请分到其他日期记录')
    return {
      id: note.id,
      text: note.text,
      images: note.images.map((image) => {
        if (
          !image ||
          typeof image.id !== 'string' ||
          !/^[\w-]{1,80}$/.test(image.id)
        )
          throw new Error('附图编号格式不正确')
        return {
          id: image.id,
          path: String(image.path || ''),
          thumbPath: String(image.thumbPath || ''),
        }
      }),
    }
  })
}
export function normalizeEntry(value) {
  if (!OWNERS.includes(value.owner) || !validDate(value.date))
    throw new Error('记录日期或署名不正确')
  if (value.sleepTime && !validTime(value.sleepTime))
    throw new Error('入睡时间格式不正确')
  if (
    value.growthNote != null &&
    (typeof value.growthNote !== 'string' || value.growthNote.length > 500)
  )
    throw new Error('感受记录格式不正确，最多 500 字')
  const minutes =
    value.studyMinutes === '' || value.studyMinutes == null
      ? null
      : Number(value.studyMinutes)
  if (
    minutes !== null &&
    (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
  )
    throw new Error('自习时长应在 0 到 1440 分钟之间')
  if (typeof value.activities !== 'string' || value.activities.length > 10000)
    throw new Error('记录请控制在一万字以内')
  if (!Number.isInteger(value.version) || value.version < 0)
    throw new Error('记录版本不正确')
  return {
    ...emptyEntry(value.owner, value.date),
    sleepTime: value.sleepTime || '',
    sleepPreviousDay: value.sleepPreviousDay !== false,
    activities: value.activities,
    growthNote: value.growthNote || '',
    notes: normalizeNotes(entryNotes(value)),
    studyMinutes: minutes,
    screenshotPath: String(value.screenshotPath || ''),
    checkedIn: Boolean(value.checkedIn),
    version: value.version,
  }
}
export function normalizeGoal(value) {
  if (
    !Number.isInteger(value.nights) ||
    value.nights < 1 ||
    value.nights > 7 ||
    !validTime(value.before)
  )
    throw new Error('请设置每周 1–7 晚和有效时间')
  return { nights: value.nights, before: value.before }
}
export function sleepReached(entry, goal = DEFAULT_GOAL) {
  if (!validTime(entry.sleepTime)) return null
  const minutes = (value) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  // Compare within one night; the selected calendar date must not move
  // an after-midnight bedtime ahead of the deadline by an entire day.
  const sleep = minutes(entry.sleepTime) - (Number(entry.sleepTime.slice(0, 2)) >= 12 ? 1440 : 0)
  const deadline =
    minutes(goal.before) - (Number(goal.before.slice(0, 2)) >= 12 ? 1440 : 0)
  return sleep < deadline
}
export function weekSummary(entries, owner, start, goal = DEFAULT_GOAL) {
  const sleepDates = new Map()
  // Every journal page records the previous night, including after midnight.
  // Ignore the legacy date selector without rewriting stored records.
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    if (entry.owner !== owner || !validTime(entry.sleepTime)) continue
    const date = shiftDate(entry.date, -1)
    sleepDates.set(date, entry)
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(start, index)
    const entry = sleepDates.get(date)
    return { date, reached: entry ? sleepReached(entry, goal) : null }
  })
  return { days, reached: days.filter((day) => day.reached === true).length }
}
