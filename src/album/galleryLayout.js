export const displayPhotoSource = item => item.photo.previewSrc || item.photo.src
export function orderedMemories(items) {
  return items.filter(item => item.photo?.src).slice().sort((a, b) => Number(a.day.day) - Number(b.day.day) || String(a.owner.id).localeCompare(String(b.owner.id)))
}

// Keep each date together on desktop. Heights follow actual image proportions;
// the viewer restores its scroll anchor when newly decoded dimensions arrive.
export function layoutMemories(items, width, dimensions = new Map(), viewportHeight = 900) {
  const mobile = width < 640
  const pageWidth = Math.min(1100, Math.max(240, width - (mobile ? 40 : width <= 900 ? 100 : 144)))
  const rows = []
  let offset = 0
  for (let index = 0; index < items.length;) {
    const count = !mobile && items[index + 1]?.day.day === items[index].day.day ? 2 : 1
    const rowItems = items.slice(index, index + count)
    const columnWidth = mobile ? pageWidth : (pageWidth - (width <= 900 ? 28 : 56)) / 2
    const edges = mobile ? 20 : 28
    const mediaSizes = rowItems.map(item => {
      const size = dimensions.get(displayPhotoSource(item))
      const ratio = size?.width > 0 && size?.height > 0 ? size.width / size.height : .8
      const maxImageHeight = mobile
        ? Math.min(220, Math.max(100, viewportHeight * .32))
        : Math.max(140, viewportHeight - 112 - edges)
      const imageWidth = Math.min(columnWidth - edges, maxImageHeight * ratio)
      return { width: imageWidth + edges, height: imageWidth / ratio + edges }
    })
    const mediaHeights = mediaSizes.map(size => size.height)
    const mediaWidths = mediaSizes.map(size => size.width)
    const height = Math.ceil(Math.max(...mediaHeights) + (mobile ? 104 : 132))
    rows.push({ key: items[index].key, items: rowItems, offset, height, mediaHeights, mediaWidths, mobile })
    offset += height
    index += count
  }
  return { rows, height: offset }
}

export function rowWindow(rows, top, viewport, overscan = 700) {
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

export function needsImagesAhead(rows, top, viewport, states) {
  return rowWindow(rows, top, viewport + 120, 0).some(row => row.offset + row.height > top
    && row.items.some(item => {
      const state = states.get(displayPhotoSource(item))
      return !state || state.pending || state.error
    }))
}
