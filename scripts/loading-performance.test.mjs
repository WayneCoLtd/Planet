import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReadResource } from '../src/readResource.js'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('album shares pending reads and returns its cached snapshot immediately', async () => {
  let finish, calls = 0
  const resource = createReadResource({ read: () => ({ old: true }), load: () => {
    calls++
    return new Promise(resolve => { finish = resolve })
  } })
  const first = resource.refresh()
  assert.equal(first, resource.refresh())
  assert.deepEqual(resource.peek(), { old: true })
  await Promise.resolve()
  finish({ current: true })
  assert.deepEqual(await first, { current: true })
  assert.equal(calls, 1)
})

test('failed reads retain the album and allow a later retry', async () => {
  let failed = true
  const resource = createReadResource({ read: () => ({ old: true }), load: async () => {
    if (failed) throw new Error('offline')
    return {}
  } })
  await assert.rejects(resource.refresh(), /offline/)
  assert.deepEqual(resource.peek(), { old: true })
  failed = false
  assert.deepEqual(await resource.refresh(), {})
})

test('an older read cannot resurrect a removed photo or overwrite an upload', async () => {
  let finish
  const saved = []
  const resource = createReadResource({ read: () => ({ old: true }), save: v => saved.push(v),
    load: () => new Promise(resolve => { finish = resolve }) })
  const pending = resource.refresh()
  await Promise.resolve()
  resource.update(() => ({ uploaded: true }))
  finish({ old: true })
  assert.deepEqual(await pending, { uploaded: true })
  assert.deepEqual(saved, [{ uploaded: true }])
})

function workerRuntime(fetch, { cached, quotaFailure = false } = {}) {
  const handlers = {}, puts = [], waits = []
  const cache = {
    match: async () => cached,
    addAll: async () => {},
    put: async (key, response) => {
      if (quotaFailure) throw new Error('quota exceeded')
      puts.push([key, await response.text()])
    }
  }
  const context = vm.createContext({ fetch, URL, Response, AbortController, setTimeout, clearTimeout,
    caches: { open: async () => cache },
    self: { location: { origin: 'https://planet.test' }, addEventListener: (name, handler) => { handlers[name] = handler } }
  })
  vm.runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context)
  return {
    puts,
    async request(path, mode = 'navigate') {
      let response
      handlers.fetch({ request: { url: `https://planet.test${path}`, method: 'GET', mode },
        respondWith: promise => { response = promise }, waitUntil: promise => waits.push(promise) })
      const result = await response
      await Promise.all(waits)
      return result
    }
  }
}

test('game navigation cannot replace the offline homepage and private routes bypass cache', async () => {
  let calls = 0
  const worker = workerRuntime(async () => { calls++; return new Response('game') })
  for (const path of ['/games/snake/', '/connection-check.html', '/api/music', '/sb/rest/v1/tasks']) {
    assert.equal(await worker.request(path), undefined)
  }
  assert.equal(calls, 0)
  assert.deepEqual(worker.puts, [])
})

test('homepage falls back on HTTP failures as well as offline errors', async () => {
  for (const fetch of [async () => new Response('unavailable', { status: 503 }), async () => { throw new Error('offline') }]) {
    const worker = workerRuntime(fetch, { cached: new Response('saved homepage') })
    assert.equal(await (await worker.request('/')).text(), 'saved homepage')
    assert.deepEqual(worker.puts, [])
  }
})

test('cache quota failure must not prevent healthy pages or scripts from loading', async () => {
  const worker = workerRuntime(async () => new Response('healthy', { headers: { 'content-type': 'text/html' } }), { quotaFailure: true })
  assert.equal(await (await worker.request('/')).text(), 'healthy')
  const scripts = workerRuntime(async () => new Response('script'), { quotaFailure: true })
  assert.equal(await (await scripts.request('/assets/app-hash.js', 'cors')).text(), 'script')
})

test('album online/manual retries share one upload and active uploads are skipped', async () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const flush = source.slice(source.indexOf('function flushPendingPhotoWallSync()'), source.indexOf('function reconcileLocalPhotosToPending('))
  let finish, calls = 0
  const removed = []
  const context = vm.createContext({
    cloudEnabled: true, console,
    photoWallActiveUploads: new Set(['301-orange']),
    loadPhotoWallPending: () => [{ type: 'upload', day: 300, owner: 'orange' }, { type: 'upload', day: 301, owner: 'orange' }],
    uploadPendingPhotoItem: () => { calls++; return new Promise(resolve => { finish = resolve }) },
    removePhotoWallPending: (...args) => removed.push(args),
    loadPhotoWallLocal: () => ({}), savePhotoWallLocal() {}
  })
  vm.runInContext('let photoWallFlushPromise = null;\n' + flush + '\nglobalThis.run = flushPendingPhotoWallSync;', context)
  const first = context.run()
  assert.equal(first, context.run())
  finish(true)
  assert.equal((await first).synced, 1)
  assert.equal(calls, 1)
  assert.deepEqual(removed, [['upload', 300, 'orange']])
})

test('pending removals stay hidden even if an old cloud read still contains the photo', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const merge = source.slice(source.indexOf('function mergePhotoWallViews('), source.indexOf('async function uploadPendingPhotoItem('))
  const context = vm.createContext({ STATIC_PHOTOS: {}, loadPhotoWallPending: () => [{type:'remove',day:300,owner:'orange'}] })
  vm.runInContext(merge + '\nglobalThis.run = mergePhotoWallViews;', context)
  assert.equal(Object.keys(context.run({'300-orange':{src:'old'}}, {})).length, 0)
})
