let memory
let pending = Promise.resolve()
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('wwcxrl-mailbox-drafts-v1', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('drafts')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
export async function loadMailboxDraft() {
  if (memory !== undefined) return memory
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly')
    const r = tx.objectStore('drafts').get('compose')
    tx.oncomplete = () => { db.close(); resolve(memory === undefined ? r.result : memory) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
export function saveMailboxDraft(value) {
  memory = value
  pending = pending.catch(() => {}).then(async () => {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').put(value, 'compose')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
    })
  })
  return pending
}
export async function clearMailboxComposer(expected) {
  const current = await loadMailboxDraft()
  if (!current || current.content !== expected.content || current.editingId !== expected.editingId) return
  if (JSON.stringify((current.composeItems || []).map(i => i.key)) !== JSON.stringify((expected.composeItems || []).map(i => i.key))) return
  await saveMailboxDraft({...current,content:'',composeItems:[],editingId:null,original:null})
}
