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
async function resizePhoto(image, maxSide, maxBytes, quality) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const imageSide = Math.max(image.naturalWidth, image.naturalHeight)
  let blob

  do {
    const scale = Math.min(1, maxSide / imageSide)
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.type !== 'image/jpeg') throw new Error('这张图片无法压缩')
    if (blob.size > maxBytes) {
      const shrink = Math.min(0.9, Math.sqrt(maxBytes / blob.size) * 0.95)
      maxSide = Math.floor(Math.max(canvas.width, canvas.height) * shrink)
    }
  } while (blob.size > maxBytes)

  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('无法读取压缩后的图片'))
    reader.readAsDataURL(blob)
  })
  return { data, width: canvas.width, height: canvas.height }
}

export async function prepareLifePhoto(file, metadata, { includeThumbnail = true } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const full = await resizePhoto(image, 2400, 750000, 0.82)
    const thumb = includeThumbnail ? await resizePhoto(image, 640, 100000, 0.78) : null
    return {
      ...metadata,
      id: crypto.randomUUID(),
      image: full.data,
      thumbnail: thumb?.data,
      width: full.width,
      height: full.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
