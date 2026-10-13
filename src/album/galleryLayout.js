export function orderedMemories(items) {
  return items.filter(item => item.photo?.src).slice().sort((a, b) => Number(a.day.day) - Number(b.day.day) || String(a.owner.id).localeCompare(String(b.owner.id)))
}

// Rows have reserved geometry, so late images cannot move the reader's place.
// Only a small window of these rows gets mounted; the rest is one spacer.
export function layoutMemories(items, width) {
  const mobile = width < 640
  const pageWidth = Math.min(1100, Math.max(240, width - (mobile ? 40 : width <= 900 ? 100 : 144)))
  const rows = []
  let offset = 0
  for (let index = 0; index < items.length;) {
    const feature = mobile || rows.length % 4 === 0
    const count = feature ? 1 : Math.min(2, items.length - index)
    const mediaHeight = mobile ? Math.min(420, Math.max(260, pageWidth * 1.12))
      : feature ? Math.min(530, pageWidth * .56) : Math.min(450, pageWidth * .45)
    const height = Math.round(mediaHeight + (mobile ? 104 : 132))
    rows.push({ key: items[index].key, items: items.slice(index, index + count), offset, height, mediaHeight, feature })
    offset += height
    index += count
  }
  return { rows, height: offset }
}

export function rowWindow(rows, top, viewport, overscan = 320) {
  let low = 0, high = rows.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (rows[mid].offset + rows[mid].height < Math.max(0, top - overscan)) low = mid + 1
    else high = mid
  }
  const start = low
  while (low < rows.length && rows[low].offset < top + viewport + overscan) low++
  return rows.slice(start, low)
}

export function monthLabel(date) {
  const match = /^(\d{4})-(\d{2})/.exec(date || '')
  return match ? `${match[1]} · ${Number(match[2])} 月` : '这些日子'
}
