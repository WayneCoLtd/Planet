import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import sharp from 'sharp'

const source = readFileSync(new URL('../api/media-preview.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace('export default async function handler', 'async function handler')
function fixture({ level = 1, failure = null } = {}) {
  const files = new Map(), counts = { source: 0, download: 0, upload: 0 }
  const storage = {
    download: async key => { counts.download++; return files.has(key) ? { data: new Blob([files.get(key)]) } : { error: failure || { statusCode: 404 } } },
    getPublicUrl: path => ({ data: { publicUrl: 'https://fixture.invalid/' + path } }),
    upload: async (key, bytes, options) => { counts.upload++; assert.equal(options.upsert, false); files.set(key, bytes); return {} },
  }
  const ctx = vm.createContext({ crypto, sharp, Buffer, URL, AbortSignal, LEVEL_SITE: 1,
    readLevel: () => level, checkServiceConfig: () => ({ ok: true }),
    getAdminClient: () => ({ storage: { from: bucket => { assert.equal(bucket, 'wwcxrl-photos'); return storage } } }),
    fetch: async () => { counts.source++; return new Response(await sharp({ create: { width: 800, height: 1600, channels: 3, background: '#bbccdd' } }).jpeg().toBuffer()) },
  })
  vm.runInContext(source + ';globalThis.handler=handler', ctx)
  async function request({ path = 'owner/photo.jpg', headers = {}, method = 'GET' } = {}) {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(n) { this.code = n; return this }, json(v) { this.body = v; return this }, end(v) { this.body = v; return this } }
    await ctx.handler({ url: '/api/media-preview?v=1&path=' + encodeURIComponent(path), headers, method }, res)
    return res
  }
  return { request, counts, files }
}
test('preview is bounded without cropping, coalesces requests and reuses persisted derivative', async () => {
  const f = fixture(), [a, b] = await Promise.all([f.request(), f.request()])
  assert.equal(a.code, 200); assert.equal(b.code, 200)
  const meta = await sharp(a.body).metadata()
  assert.equal(meta.width, 480); assert.equal(meta.height, 960); assert.equal(meta.format, 'webp')
  assert.equal(f.counts.source, 1); assert.equal(f.counts.upload, 1)
  assert.match(a.headers['Cache-Control'], /^private,/)
  const c = await f.request(); assert.deepEqual(c.body, a.body); assert.equal(f.counts.source, 1)
  const before = f.counts.download
  assert.equal((await f.request({ headers: { 'if-none-match': a.headers.ETag } })).code, 304)
  assert.equal(f.counts.download, before)
  assert.equal((await f.request({ method: 'HEAD' })).body, undefined)
})
test('unauthorized, invalid and unavailable requests never fetch originals', async () => {
  const locked = fixture({ level: 0 }); assert.equal((await locked.request()).code, 401); assert.equal(locked.counts.download, 0)
  const f = fixture()
  for (const path of ['../secret.jpg', 'media-previews/a.webp', 'a.svg', 'a%2fb.jpg']) assert.equal((await f.request({ path })).code, 400)
  assert.equal((await f.request({ method: 'POST' })).code, 405)
  assert.equal(f.counts.source, 0)
  const failed = fixture({ failure: { statusCode: 503 } })
  const res = await failed.request(); assert.equal(res.code, 502); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(failed.counts.source, 0)
})
