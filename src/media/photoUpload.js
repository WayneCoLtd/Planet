export const PHOTO_UPLOAD_TYPE = 'application/octet-stream'
const MAX_METADATA_BYTES = 16_384

// One JSON line carries the metadata and byte count, followed by the JPEGs.
export async function encodePhotoUpload({ image, thumbnail, ...metadata }) {
  const original = await (await fetch(image)).blob()
  const preview = thumbnail ? await (await fetch(thumbnail)).blob() : new Blob()
  const header = JSON.stringify({ ...metadata, imageBytes: original.size })
  return new Blob([header, '\n', original, preview], { type: PHOTO_UPLOAD_TYPE })
}

export function decodePhotoUpload(bytes, withThumbnail) {
  if (!Buffer.isBuffer(bytes)) return null
  const separator = bytes.subarray(0, MAX_METADATA_BYTES).indexOf(10)
  if (separator < 1) return null
  try {
    const metadata = JSON.parse(bytes.toString('utf8', 0, separator))
    const imageBytes = metadata?.imageBytes
    if (!Number.isInteger(imageBytes) || imageBytes < 2) return null
    const start = separator + 1
    const end = start + imageBytes
    if (withThumbnail ? end >= bytes.length : end !== bytes.length) return null
    return { ...metadata, image: bytes.subarray(start, end), thumbnail: bytes.subarray(end) }
  } catch {
    return null
  }
}

export function readJpegBytes(value, maxBytes) {
  let bytes = value
  if (typeof value === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)) {
    bytes = Buffer.from(value.slice('data:image/jpeg;base64,'.length), 'base64')
  }
  return Buffer.isBuffer(bytes) && bytes.length <= maxBytes && bytes[0] === 255 && bytes[1] === 216
    ? bytes
    : null
}
