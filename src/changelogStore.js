import { changelog, releaseNotes } from './data/changelog.js'
import { cloudEnabled, loadCloudChangelog, saveCloudChangelog } from './cloud.js'
import { createReadResource } from './readResource.js'
import { safeGetItem, safeSetItem } from './safeStorage.js'

const CACHE_KEY = 'wwcxrl-changelog-local'

function compareDates(a, b) {
  return String(b.date || '').trim().localeCompare(String(a.date || '').trim())
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => compareDates(a, b) || Number(b.sort || 0) - Number(a.sort || 0))
}

const resource = createReadResource({
  read: () => {
    try {
      const cached = JSON.parse(safeGetItem(CACHE_KEY) || 'null')
      if (Array.isArray(cached) && cached.every((item) => typeof item?.version === 'string' && Array.isArray(item.notes))) {
        return sortEntries(cached)
      }
    } catch {}
    return sortEntries(changelog)
  },
  load: async () => {
    const entries = await loadCloudChangelog()
    // The existing cloud writer can expose a temporary empty list during replacement.
    return entries?.length ? sortEntries(entries) : resource.peek()
  },
  save: (entries) => safeSetItem(CACHE_KEY, JSON.stringify(entries)),
})

export function visibleChangelog(entries = resource.peek()) {
  const versionKey = (version) => version.toLowerCase().replace(/\s+/g, '')
  const visible = new Map()
  for (const item of entries) {
    const key = versionKey(item.version)
    if (key && !visible.has(key)) visible.set(key, item)
  }
  const missing = releaseNotes.filter((item) => !visible.has(versionKey(item.version)))
  return [...missing, ...visible.values()].sort(compareDates)
}

export function loadChangelog() {
  return cloudEnabled ? resource.refresh().catch(() => resource.peek()) : Promise.resolve(resource.peek())
}

export async function saveChangelog(entries) {
  const saved = sortEntries(entries.filter((item) => item?.version?.trim())).map((item, index, rows) => ({
    version: item.version.trim(),
    date: String(item.date || '').trim(),
    title: String(item.title || '').trim(),
    notes: Array.isArray(item.notes) ? item.notes.map(String).filter(Boolean) : [],
    sort: rows.length - index - 1,
  }))
  const result = cloudEnabled ? await saveCloudChangelog(saved) : { ok: true }
  if (result.ok) resource.update(() => saved)
  return { ok: Boolean(result.ok), error: result.error || '', saved }
}
