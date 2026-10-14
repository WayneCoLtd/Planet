import { cloudEnabled, resolveCloudAssetUrl } from '../cloud'
import { shiftDate, weekStart } from './journalModel'

// Keep the newest draft readable during a quick in-app page turn while IndexedDB
// is still committing. Persistent-write failures are still reported to the UI.
const draftMemory = new Map()
export function rememberDraft(key, entry) {
  draftMemory.set(key, { key, entry })
}

function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wwcxrl-journal-v1', 1)
    request.onupgradeneeded = () => {
      for (const name of ['drafts', 'entries', 'goals'])
        request.result.createObjectStore(name, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
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
    return data
  } finally {
    clearTimeout(timer)
  }
}
export async function loadWeek(date) {
  const start = weekStart(date),
    end = shiftDate(start, 6)
  if (cloudEnabled) return journalRequest(null, date)
  return {
    entries: (await journalStore('entries', 'getAll')).filter(
      (row) => row.date >= start && row.date <= end,
    ),
    goals: await journalStore('goals', 'getAll'),
  }
}
export async function saveEntry(entry) {
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
    return (
      await journalRequest({
        ...entry,
        pendingImage: undefined,
        screenshotPath,
        action: 'save',
      })
    ).entry
  }
  const key = entryKey(entry.owner, entry.date)
  return saveLocalVersion('entries', key, {
    ...entry,
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
