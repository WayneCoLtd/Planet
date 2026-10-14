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
    studyMinutes: null,
    screenshotPath: '',
    screenshotUrl: '',
    checkedIn: false,
    version: 0,
  }
}
export function normalizeEntry(value) {
  if (!OWNERS.includes(value.owner) || !validDate(value.date))
    throw new Error('记录日期或署名不正确')
  if (value.sleepTime && !validTime(value.sleepTime))
    throw new Error('入睡时间格式不正确')
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
  const sleep = minutes(entry.sleepTime) - (entry.sleepPreviousDay ? 1440 : 0)
  const deadline =
    minutes(goal.before) - (Number(goal.before.slice(0, 2)) >= 12 ? 1440 : 0)
  return sleep < deadline
}
export function weekSummary(entries, owner, start, goal = DEFAULT_GOAL) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(start, index)
    const entry = entries.find(
      (item) => item.owner === owner && item.date === date,
    )
    return { date, reached: entry ? sleepReached(entry, goal) : null }
  })
  return { days, reached: days.filter((day) => day.reached === true).length }
}
