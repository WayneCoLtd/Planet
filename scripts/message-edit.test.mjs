import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createClient } from '@supabase/supabase-js'

const cloud = readFileSync(new URL('../src/cloud.js', import.meta.url), 'utf8')
const source = cloud.slice(cloud.indexOf('const MESSAGE_COLUMNS_LEGACY'), cloud.indexOf('export async function deleteCloudMessage')).replace(/^export /gm, '')
const row = (patch = {}) => ({ id: 'one', content: 'original', image_url: '', image_urls: [], user_id: 'test', ...patch })
function setup(initial = row(), options = {}) {
  let current = initial && structuredClone(initial)
  const calls = []
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    const filters = [...url.searchParams].filter(([key]) => key !== 'select')
    calls.push({ method, filters, body })
    assert.ok(['GET', 'PATCH'].includes(method), 'editing must never insert or delete')
    const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (options.legacy && (url.searchParams.get('select') || '').includes('image_urls'))
      return reply({ code: '42703', message: 'column wwcxrl_messages.image_urls does not exist' }, 400)
    if (method === 'GET' && options.readError) return reply(options.readError, 503)
    if (method === 'PATCH' && options.writeError) return reply(options.writeError, 403)
    if (method === 'PATCH') {
      const patchCount = calls.filter(call => call.method === 'PATCH').length
      if (options.beforePatch) current = options.beforePatch(current, patchCount)
    }
    const matches = current && filters.every(([key, filter]) => {
      const dot = filter.indexOf('.'), op = filter.slice(0, dot), value = filter.slice(dot + 1)
      if (op === 'is') return value === 'null' && current[key] == null
      assert.equal(op, 'eq')
      return key === 'image_urls' ? JSON.stringify(current[key]) === JSON.stringify(JSON.parse(value)) : current[key] === value
    })
    const visible = matches && (method !== 'PATCH' || !options.rlsBlocked)
    if (visible && method === 'PATCH') current = { ...current, ...body }
    const rows = visible ? [structuredClone(current)] : []
    const accept = new Headers(init.headers).get('Accept') || ''
    return reply(accept.includes('vnd.pgrst.object') ? (rows[0] || null) : rows)
  }
  const client = createClient('https://local-fixture.invalid', 'local-test-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const context = vm.createContext({
    getSupabase: async () => client,
    toCanonicalCloudUrl: value => typeof value === 'string' ? value.replace('https://site.test/sb/', 'https://db.test/') : value,
    resolveCloudAssetUrl: value => value,
    console,
  })
  vm.runInContext(source + ';globalThis.api={updateCloudMessage,normalizeMessageRow};', context)
  return { calls, update: context.api.updateCloudMessage, normalize: context.api.normalizeMessageRow, current: () => current }
}

test('real client retains atomic text and all-image predicates, including punctuation and newlines', async () => {
  const original = row({ content: '你好，\n(eq.test) "quote"', image_url: 'one.jpg', image_urls: ['one.jpg', 'two.jpg'] })
  const h = setup(original)
  const result = await h.update('one', { content: 'edited', imageUrls: ['two.jpg'] }, h.normalize(original))
  assert.equal(result.ok, true)
  assert.deepEqual(h.calls[0].filters, [['id', 'eq.one'], ['content', 'eq.' + original.content], ['image_url', 'eq.one.jpg'], ['image_urls', 'eq.["one.jpg","two.jpg"]']])
  assert.equal(h.current().content, 'edited')
})

test('RLS zero rows with unchanged content is not reported as another device editing', async () => {
  const original = row(), h = setup(original, { rlsBlocked: true })
  const result = await h.update('one', { content: 'edited' }, h.normalize(original))
  assert.equal(result.ok, false)
  assert.equal(result.conflict, false)
  assert.equal(result.reason, 'not_applied')
  assert.match(result.error, /权限/)
  assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 1)
})

test('actual concurrent changes remain protected without a retry', async () => {
  const original = row(), h = setup(row({ content: 'newer device text' }))
  const result = await h.update('one', { content: 'my draft' }, h.normalize(original))
  assert.equal(result.conflict, true)
  assert.equal(h.current().content, 'newer device text')
  assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 1)
})

test('a retry after a committed write is acknowledged when the desired content is already present', async () => {
  const h = setup(row({ content: 'already saved' }))
  const result = await h.update('one', { content: 'already saved' }, h.normalize(row()))
  assert.equal(result.ok, true)
  assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 1)
})

test('null-to-empty-array migration is safely rebased once, retaining CAS', async () => {
  const original = row({ image_urls: null }), h = setup(row())
  const result = await h.update('one', { content: 'edited' }, h.normalize(original))
  assert.equal(result.ok, true)
  const writes = h.calls.filter(c => c.method === 'PATCH')
  assert.equal(writes.length, 2)
  assert.ok(writes[0].filters.some(([k, v]) => k === 'image_urls' && v === 'is.null'))
  assert.ok(writes[1].filters.some(([k, v]) => k === 'image_urls' && v === 'eq.[]'))
})

test('a real edit racing the format-only retry is never overwritten', async () => {
  const original = row({ image_urls: null })
  const h = setup(row(), { beforePatch: (value, count) => count === 2 ? { ...value, content: 'racing edit' } : value })
  const result = await h.update('one', { content: 'my draft' }, h.normalize(original))
  assert.equal(result.conflict, true)
  assert.equal(h.current().content, 'racing edit')
  assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 2)
})

test('canonical and proxy URL formatting can be rebased without losing photos', async () => {
  const original = row({ image_url: 'https://site.test/sb/photo.jpg', image_urls: ['https://site.test/sb/photo.jpg'] })
  const h = setup(row({ image_url: 'https://db.test/photo.jpg', image_urls: ['https://db.test/photo.jpg'] }))
  const result = await h.update('one', { content: 'edited', imageUrls: ['https://site.test/sb/photo.jpg'] }, h.normalize(original))
  assert.equal(result.ok, true)
  assert.deepEqual(h.current().image_urls, ['https://db.test/photo.jpg'])
})

test('a server error mentioning image_urls must not drop the multi-image guard', async () => {
  const h = setup(row(), { writeError: { code: '42501', message: 'permission denied for image_urls' } })
  const result = await h.update('one', { content: 'edited' }, h.normalize(row()))
  assert.equal(result.ok, false)
  assert.equal(result.conflict, false)
  assert.equal(h.calls.length, 1)
})

test('only a missing image_urls column uses the legacy single-image path', async () => {
  const original = row(); delete original.image_urls
  const h = setup(original, { legacy: true })
  const result = await h.update('one', { content: 'edited' }, h.normalize(original))
  assert.equal(result.ok, true)
  assert.equal(h.current().content, 'edited')
  assert.ok(!Object.hasOwn(h.calls.at(-1).body, 'image_urls'))
})

test('read failure and unreadable row are not asserted to be conflicts', async () => {
  for (const [initial, options] of [[null, {}], [row(), { rlsBlocked: true, readError: { message: 'offline' } }]]) {
    const h = setup(initial, options)
    const result = await h.update('one', { content: 'edited' }, h.normalize(row()))
    assert.equal(result.ok, false)
    assert.equal(result.conflict, false)
  }
})

test('legacy cached messages acquire a raw snapshot before any write', async () => {
  const h = setup(row())
  const result = await h.update('one', { content: 'edited' }, { content: 'original', images: [] })
  assert.equal(result.ok, true)
  assert.equal(h.calls[0].method, 'GET')
  assert.ok(h.calls[1].filters.some(([k]) => k === 'content'))
})

test('missing edit reference is refused without an unguarded write', async () => {
  const h = setup(row())
  const result = await h.update('one', { content: 'edited' })
  assert.equal(result.ok, false)
  assert.equal(h.calls.length, 0)
})
