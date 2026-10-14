import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { mergeLifePhotos } from '../src/album/lifeAlbumStore.js'

const source = readFileSync(
  new URL('../api/life-album.js', import.meta.url),
  'utf8',
)
  .replace(/^import .*$/gm, '')
  .replace('export default async function handler', 'async function handler')
function harness({ level = 1, existing = null } = {}) {
  const calls = []
  const db = {
    from(table) {
      calls.push(['table', table])
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        maybeSingle: async () => ({ data: existing }),
        insert(row) {
          calls.push(['insert', row])
          return { select: () => ({ single: async () => ({ data: row }) }) }
        },
        update(row) {
          calls.push(['update', row])
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { ...existing, ...row } }),
              }),
            }),
          }
        },
      }
      return q
    },
    storage: {
      from() {
        return {
          getPublicUrl: (path) => ({
            data: { publicUrl: `https://test.invalid/${path}` },
          }),
          upload: async (path) => {
            calls.push(['upload', path])
            return {}
          },
        }
      },
    },
  }
  const context = vm.createContext({
    LEVEL_SITE: 1,
    readLevel: () => level,
    checkServiceConfig: () => ({ ok: true }),
    getAdminClient: () => db,
    Buffer,
    URL,
    console,
  })
  vm.runInContext(source + ';globalThis.run=handler', context)
  return {
    calls,
    async run(method, body) {
      const res = {
        setHeader() {},
        status(code) {
          this.code = code
          return this
        },
        json(data) {
          this.data = data
          return this
        },
      }
      await context.run({ method, body, url: '/api/life-album' }, res)
      return res
    },
  }
}
const body = {
  id: '11111111-1111-4111-8111-111111111111',
  owner: 'orange',
  taken_on: '2026-10-14',
  width: 800,
  height: 1200,
  caption: '第一行\n\n第二行',
  image: 'data:image/jpeg;base64,/9j/2Q==',
  thumbnail: 'data:image/jpeg;base64,/9j/2Q==',
}
test('life album rejects unauthenticated reads and writes before database access', async () => {
  for (const method of ['GET', 'POST', 'PATCH']) {
    const h = harness({ level: 0 })
    assert.equal((await h.run(method, body)).code, 401)
    assert.equal(h.calls.length, 0)
  }
})
test('retry after a lost upload response does not duplicate a photo', async () => {
  const h = harness({
    existing: { ...body, image_path: 'one.jpg', thumb_path: 'small.jpg' },
  })
  assert.equal((await h.run('POST', body)).code, 200)
  assert.equal(
    h.calls.filter((c) => ['insert', 'upload'].includes(c[0])).length,
    0,
  )
})
test('separate photos on the same date have distinct IDs and preserve multiline captions', async () => {
  const h = harness()
  await h.run('POST', body)
  await h.run('POST', { ...body, id: '22222222-2222-4222-8222-222222222222' })
  const rows = h.calls.filter((c) => c[0] === 'insert').map((c) => c[1])
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].id, rows[1].id)
  assert.equal(rows[0].caption, body.caption)
  assert.ok(
    h.calls
      .filter((c) => c[0] === 'table')
      .every((c) => c[1] === 'wwcxrl_life_photos'),
  )
})
test('invalid date and role cannot reach storage', async () => {
  for (const patch of [
    { taken_on: '2026-02-30' },
    { taken_on: '2026-99-99' },
    { owner: 'unknown' },
  ]) {
    const h = harness()
    assert.equal((await h.run('POST', { ...body, ...patch })).code, 400)
    assert.equal(h.calls.length, 0)
  }
})
test('hide and undo use reversible metadata changes, leaving image files intact', async () => {
  const h = harness({ existing: body })
  await h.run('PATCH', { id: body.id, hidden: true })
  await h.run('PATCH', { id: body.id, hidden: false })
  const updates = h.calls.filter((c) => c[0] === 'update')
  assert.ok(updates[0][1].deleted_at)
  assert.equal(updates[1][1].deleted_at, null)
})
test('pagination deduplicates records; hiding and restoring does not lose other photographs', () => {
  const a = { id: 'a', taken_on: '2026-10-14' },
    b = { id: 'b', taken_on: '2026-10-14' }
  assert.equal(mergeLifePhotos([a], [a, b]).length, 2)
  assert.deepEqual(mergeLifePhotos([a, b], [{ ...a, deleted_at: 'now' }]), [b])
  assert.equal(mergeLifePhotos([b], [a]).length, 2)
})
