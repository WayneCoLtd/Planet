import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderedMemories, layoutMemories, rowWindow } from '../src/album/galleryLayout.js'
import { createImageQueue } from '../src/album/imageQueue.js'

const memories = Array.from({ length: 132 }, (_, index) => ({
  key: `${300 + Math.floor(index / 2)}-${index % 2 ? 'pomelo' : 'orange'}`,
  day: { day: 300 + Math.floor(index / 2), date: '2026-08-09' },
  owner: { id: index % 2 ? 'pomelo' : 'orange' }, photo: { src: `photo-${index}.jpg` }
}))

test('all dates and owners survive editorial grouping without changing the source', () => {
  const reversed = memories.slice().reverse()
  const sorted = orderedMemories(reversed)
  assert.deepEqual(sorted, memories)
  assert.equal(reversed[0], memories.at(-1))
  for (const width of [320, 390, 768, 1440]) {
    const { rows, height } = layoutMemories(sorted, width)
    assert.deepEqual(rows.flatMap(row => row.items), memories)
    assert.equal(rows.at(-1).offset + rows.at(-1).height, height)
    assert.ok(rows.every((row, index) => index === 0 || row.offset === rows[index - 1].offset + rows[index - 1].height))
  }
})

test('large album mounts only a small window, including the last photograph', () => {
  for (const width of [390, 1440]) {
    const { rows, height } = layoutMemories(memories, width)
    for (const top of [0, height / 2, height - 844]) {
      const window = rowWindow(rows, top, 844)
      assert.ok(window.flatMap(row => row.items).length <= 12)
      assert.ok(window.length > 0)
    }
    assert.equal(rowWindow(rows, height - 844, 844).at(-1).items.at(-1).key, memories.at(-1).key)
  }
  assert.deepEqual(layoutMemories([], 390), { rows: [], height: 0 })
})

test('image queue limits concurrency, caches success, and cancels on close', async () => {
  const original = globalThis.Image
  const created = [], results = []
  globalThis.Image = class {
    naturalWidth = 800
    naturalHeight = 600
    constructor() { created.push(this) }
    set src(value) { this.url = value }
    decode() { return Promise.resolve() }
    removeAttribute() { this.cancelled = true }
  }
  const queue = createImageQueue(3)
  try {
    for (let i = 0; i < 12; i++) queue.request(`photo-${i}`, result => results.push(result))
    assert.equal(created.length, 3)
    await created[0].onload()
    assert.equal(created.length, 4)
    assert.equal(results[0].width, 800)
    queue.request('photo-0', result => results.push(result))
    assert.equal(created.length, 4)
    assert.equal(results.length, 2)
    queue.dispose()
    assert.equal(created.length, 4)
    assert.ok(created.slice(1).every(image => image.cancelled))
  } finally { queue.dispose(); globalThis.Image = original }
})

test('one broken image releases its queue slot without blocking the next', () => {
  const original = globalThis.Image
  const created = [], results = []
  globalThis.Image = class {
    constructor() { created.push(this) }
    set src(value) { this.url = value }
    removeAttribute() {}
  }
  const queue = createImageQueue(1)
  try {
    queue.request('broken', result => results.push(result))
    queue.request('next', () => {})
    created[0].onerror()
    assert.deepEqual(results, [{ error: true }])
    assert.equal(created[1].url, 'next')
  } finally { queue.dispose(); globalThis.Image = original }
})
