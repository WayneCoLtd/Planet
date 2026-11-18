export const ATTACHMENT_MAX_BYTES = 500_000

export async function withDecodedImage(file, useImage) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('请选择图片文件')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return await useImage(image)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function resizeJpeg(image, maxSide, maxBytes, quality) {
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

  return { blob, width: canvas.width, height: canvas.height }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('无法读取图片'))
    reader.readAsDataURL(blob)
  })
}

export function prepareJpegFile(file, maxSide = 1200, maxBytes = ATTACHMENT_MAX_BYTES, quality = 0.84) {
  return withDecodedImage(file, async (image) => (await resizeJpeg(image, maxSide, maxBytes, quality)).blob)
}

export async function shrinkLargeJpeg(file, maxSide, maxBytes) {
  if (file.type !== 'image/jpeg' || file.size <= maxBytes) return file
  try {
    return await prepareJpegFile(file, maxSide, maxBytes, 0.86)
  } catch {
    return file
  }
}
