import { blobToDataUrl, resizeJpeg, withDecodedImage } from '../media/imagePreparation.js'

const database = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('wwcxrl-life-album-v1', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('drafts', { keyPath: 'id' })
      req.result.createObjectStore('photos', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
export async function albumStore(store, action, value) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      store,
      action === 'getAll' ? 'readonly' : 'readwrite',
    )
    const request = tx.objectStore(store)[action](value)
    tx.oncomplete = () => {
      db.close()
      resolve(request.result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error || new Error('照片保存中断'))
    }
  })
}
export async function editLocalPhoto(body) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite')
    const store = tx.objectStore('photos')
    let saved, conflict
    const read = store.get(body.id)
    read.onsuccess = () => {
      const row = read.result
      if (row?.edit_id === body.editId) { saved = row; return }
      if (!row || (row.edit_id ?? null) !== body.base) {
        conflict = Object.assign(new Error('另一台设备修改了这张照片，你填写的内容还在。'), { current: row })
        tx.abort()
        return
      }
      saved = { ...row, owner: body.owner, taken_on: body.taken_on, caption: body.caption, edit_id: body.editId }
      if (body.image) Object.assign(saved, {
        image: body.image, thumbnail: body.thumbnail, src: body.image, thumb: body.thumbnail,
        width: body.width, height: body.height,
      })
      store.put(saved)
    }
    tx.oncomplete = () => { db.close(); resolve(saved) }
    tx.onabort = tx.onerror = () => { db.close(); reject(conflict || tx.error) }
  })
}
export function mergeLifePhotos(previous, next) {
  return [
    ...new Map(
      [...previous, ...next].map((photo) => [photo.id, photo]),
    ).values(),
  ]
    .filter((photo) => !photo.deleted_at)
    .sort(
      (a, b) =>
        b.taken_on.localeCompare(a.taken_on) || b.id.localeCompare(a.id),
    )
}
export function prepareLifePhoto(file, metadata, { includeThumbnail = true } = {}) {
  return withDecodedImage(file, async (image) => {
    const full = await resizeJpeg(image, 2400, 750000, 0.82)
    const thumb = includeThumbnail ? await resizeJpeg(image, 640, 100000, 0.78) : null
    return {
      ...metadata,
      id: crypto.randomUUID(),
      image: await blobToDataUrl(full.blob),
      thumbnail: thumb ? await blobToDataUrl(thumb.blob) : undefined,
      width: full.width,
      height: full.height,
    }
  })
}
