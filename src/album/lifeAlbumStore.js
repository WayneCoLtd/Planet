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
export async function prepareLifePhoto(file, metadata) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const resize = (maxSide) => {
      const scale = Math.min(
        1,
        maxSide / Math.max(image.naturalWidth, image.naturalHeight),
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      let quality = 0.86,
        result = canvas.toDataURL('image/jpeg', quality)
      while (result.length > 2300000 && quality > 0.4) {
        quality -= 0.1
        result = canvas.toDataURL('image/jpeg', quality)
      }
      if (result.length > 2400000)
        throw new Error('这张图片过大，请选择较小版本')
      return { data: result, width: canvas.width, height: canvas.height }
    }
    const full = resize(2400),
      thumb = resize(640)
    return {
      ...metadata,
      id: crypto.randomUUID(),
      image: full.data,
      thumbnail: thumb.data,
      width: full.width,
      height: full.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
