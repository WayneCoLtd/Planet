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
