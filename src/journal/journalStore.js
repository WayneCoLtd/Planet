import { cloudEnabled, resolveCloudAssetUrl } from '../cloud'
import { reuseSignedMedia } from '../media/signedUrlCache'
import { entryNotes, entryFingerprint, shiftDate, weekStart } from './journalModel'

// Keep the newest draft readable during a quick in-app page turn while IndexedDB
// is still committing. Persistent-write failures are still reported to the UI.
const draftMemory = new Map()
export function rememberDraft(key, entry, base) {
  draftMemory.set(key, { key, entry, base })
}

function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wwcxrl-journal-v1', 2)
    request.onupgradeneeded = () => {
      for (const name of ['drafts', 'entries', 'goals', 'recovery'])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
// Archive first and remove only the exact draft we read, in one transaction.
// A newer draft from another tab must never be deleted by this cleanup.
export async function parkDraft(key, draft) {
  const db = await openStore()
  const backup = { ...draft, key: `${key}:${crypto.randomUUID()}`, sourceKey: key, archivedAt: new Date().toISOString() }
  const matches = value => value && value.entry.version === draft.entry.version
    && entryFingerprint(value.entry) === entryFingerprint(draft.entry)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['drafts', 'recovery'], 'readwrite')
    tx.objectStore('recovery').put(backup)
    const read = tx.objectStore('drafts').get(key)
    read.onsuccess = () => {
      if (matches(read.result)) tx.objectStore('drafts').delete(key)
    }
    tx.oncomplete = () => {
      if (matches(draftMemory.get(key))) draftMemory.delete(key)
      db.close()
      resolve(backup)
    }
    tx.onerror = tx.onabort = () => {
      db.close()
      reject(tx.error || new Error('本机草稿保留失败'))
    }
  })
}
export async function clearMatchingDraft(key, entry) {
  const db = await openStore()
  const matches = value => value && value.entry.version === entry.version
    && entryFingerprint(value.entry) === entryFingerprint(entry)
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    const store = tx.objectStore('drafts')
    const read = store.get(key)
    read.onsuccess = () => { if (matches(read.result)) store.delete(key) }
    tx.oncomplete = () => {
      if (matches(draftMemory.get(key))) draftMemory.delete(key)
      db.close()
      resolve()
    }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('草稿清理失败')) }
  })
}
export async function journalStore(store, operation, value) {
  if (store === 'drafts' && operation === 'get' && draftMemory.has(value))
    return draftMemory.get(value)
  const db = await openStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      store,
      ['get', 'getAll'].includes(operation) ? 'readonly' : 'readwrite',
    )
    const request = tx.objectStore(store)[operation](value)
    tx.oncomplete = () => {
      db.close()
      if (store === 'drafts' && operation === 'delete')
        draftMemory.delete(value)
      resolve(request.result)
    }
    tx.onerror = tx.onabort = () => {
      db.close()
      reject(tx.error || new Error('本机存储不可用'))
    }
  })
}
export const entryKey = (owner, date) => `${date}:${owner}`
// One read/write transaction also protects two local preview tabs from lost updates.
async function saveLocalVersion(store, key, value) {
  const db = await openStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const objectStore = tx.objectStore(store)
    let conflict, saved
    const read = objectStore.get(key)
    read.onsuccess = () => {
      const current = read.result
      if ((current?.version || 0) !== value.version) {
        conflict = Object.assign(new Error('另一张页面已更新了这条记录'), {
          status: 409,
          current,
        })
        tx.abort()
        return
      }
      saved = { ...value, key, version: value.version + 1 }
      objectStore.put(saved)
    }
    tx.oncomplete = () => {
      db.close()
      resolve(saved)
    }
    tx.onerror = tx.onabort = () => {
      db.close()
      reject(conflict || tx.error || new Error('记录未保存'))
    }
  })
}
export async function journalRequest(body, date) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(
      date ? `/api/journal?date=${date}` : '/api/journal',
      {
        method: date ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: date ? undefined : JSON.stringify(body),
        signal: controller.signal,
      },
    )
    const data = await response.json()
    if (!response.ok)
      throw Object.assign(new Error(data.error || '暂时无法同步'), {
        status: response.status,
        current: data.current,
      })
    return reuseSignedMedia(data)
  } finally {
    clearTimeout(timer)
  }
}
export async function loadWeek(date) {
  const start = weekStart(date),
    end = shiftDate(start, 7)
  if (cloudEnabled) return journalRequest(null, date)
  return {
    entries: (await journalStore('entries', 'getAll')).filter(
      (row) => row.date >= start && row.date <= end,
    ),
    goals: await journalStore('goals', 'getAll'),
  }
}
export async function saveEntry(entry) {
  const notes = entryNotes(entry)
  if (cloudEnabled) {
    let screenshotPath = entry.screenshotPath
    if (entry.pendingImage)
      screenshotPath = (
        await journalRequest({
          action: 'image',
          owner: entry.owner,
          date: entry.date,
          id: entry.pendingImage.id,
          image: entry.pendingImage.data,
        })
      ).screenshotPath
    const uploaded = []
    for (const note of notes) {
      const images = []
      for (const image of note.images) {
        let path = image.path,
          thumbPath = image.thumbPath
        if (image.pendingImage) {
          path = (
            await journalRequest({
              action: 'image',
              owner: entry.owner,
              date: entry.date,
              id: image.id,
              image: image.pendingImage.data,
            })
          ).screenshotPath
          thumbPath = (
            await journalRequest({
              action: 'image',
              owner: entry.owner,
              date: entry.date,
              id: image.id,
              variant: 'thumb',
              image: image.pendingImage.thumbnail,
            })
          ).screenshotPath
        }
        images.push({ id: image.id, path, thumbPath })
      }
      uploaded.push({ id: note.id, text: note.text, images })
    }
    return (
      await journalRequest({
        ...entry,
        notes: uploaded,
        pendingImage: undefined,
        screenshotPath,
        action: 'save',
      })
    ).entry
  }
  const key = entryKey(entry.owner, entry.date)
  return saveLocalVersion('entries', key, {
    ...entry,
    notes: notes.map((note) => ({
      ...note,
      images: note.images.map((image) => ({
        id: image.id,
        path: image.path || '',
        thumbPath: image.thumbPath || '',
        url: image.pendingImage?.data || image.url,
        thumbUrl: image.pendingImage?.thumbnail || image.thumbUrl,
      })),
    })),
    screenshotUrl: entry.pendingImage?.data || entry.screenshotUrl,
    pendingImage: undefined,
    updatedAt: new Date().toISOString(),
  })
}
export async function saveGoal(goal) {
  if (cloudEnabled)
    return (await journalRequest({ ...goal, action: 'goal' })).goal
  const key = entryKey(goal.owner, goal.week_start)
  return saveLocalVersion('goals', key, { ...goal, before_time: goal.before })
}
export const imageUrl = (entry) =>
  entry.pendingImage?.data ||
  (entry.screenshotUrl ? resolveCloudAssetUrl(entry.screenshotUrl) : '')
