import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function runtime(fetch, timeout = 100) {
  const storage = new Map()
  const source = readFileSync(new URL('../src/cloud.js', import.meta.url), 'utf8')
    .replace(/^import .*$/m, '')
    .replaceAll('import.meta.env.VITE_SUPABASE_URL', "'https://test.supabase.co'")
    .replaceAll('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY', "'test-key'")
    .replaceAll('export ', '')
    .replace('const CLOUD_REQUEST_TIMEOUT_MS = 15000', `const CLOUD_REQUEST_TIMEOUT_MS = ${timeout}`)
  const context = vm.createContext({
    fetch, Response, AbortController, URLSearchParams, console, setTimeout, clearTimeout,
    installStorageGuard() {},
    safeGetItem: (k, fallback = null) => storage.get(k) ?? fallback,
    safeSetItem: (k, v) => storage.set(k, v),
    CustomEvent: class {},
    window: { location: { hostname: 'planet.test', origin: 'https://planet.test', search: '' },
      setTimeout, clearTimeout, dispatchEvent() {} }
  })
  vm.runInContext(source + '\nglobalThis.run = cloudFetch; globalThis.apiUrl = getCloudApiUrl; globalThis.assetUrl = resolveCloudAssetUrl;', context)
  return { run: context.run, apiUrl: context.apiUrl, assetUrl: context.assetUrl, storage }
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const url = 'https://planet.test/sb/rest/v1/tasks'

test('fast direct read does not start a second request', async () => {
  let calls = 0
  const { run } = runtime(async () => { calls++; return json([1]) })
  assert.deepEqual(await (await run(url)).json(), [1])
  await new Promise(r => setTimeout(r, 25))
  assert.equal(calls, 1)
})

test('stalled response body times out without duplicate requests', async () => {
  let calls = 0
  let cancelled = false
  const { run } = runtime(async (_target, { signal }) => {
    calls++
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => { cancelled = true; controller.error(new Error('aborted')) })
    } }), { headers: { 'content-type': 'application/json' } })
  })
  await assert.rejects(run(url))
  assert.equal(cancelled, true)
  assert.equal(calls, 1)
})

test('slow but successful direct response never starts fallback', async () => {
  let calls = 0
  const { run } = runtime(async target => {
    calls++
    await new Promise(r => setTimeout(r, 800))
    return json([3])
  }, 2000)
  assert.deepEqual(await (await run(url)).json(), [3])
  assert.equal(calls, 1)
})

test('failed writes are submitted only once', async () => {
  let calls = 0
  const { run } = runtime(async () => { calls++; throw new Error('offline') })
  await assert.rejects(run(url, { method: 'POST', body: '{}' }))
  assert.equal(calls, 1)
})

test('production cloud API and stored assets use the site origin', () => {
  const { apiUrl, assetUrl } = runtime(async () => json([]))
  assert.equal(apiUrl(), 'https://planet.test/sb')
  assert.equal(assetUrl('https://test.supabase.co/storage/v1/object/public/p/a.jpg'), 'https://planet.test/sb/storage/v1/object/public/p/a.jpg')
})

test('old persisted route values do not affect the single endpoint', async () => {
  const paths = []
  const { run, storage } = runtime(async target => { paths.push(target); return json([]) })
  storage.set('wwcxrl-cloud-transport-v3', JSON.stringify({ mode: 'direct', expiresAt: Date.now() + 1000 }))
  await run(url)
  assert.deepEqual(paths, [url])
})

test('failed task reads preserve last successful calendar', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('async function hydrateDailyAdventures()'), source.indexOf('function isAdminPageRequested()'))
  const cached = [{ day: 350 }]
  const context = vm.createContext({ loadCloudDailyTasks: async () => null, getDailyAdventures: () => cached })
  vm.runInContext(fn + '\nglobalThis.run = hydrateDailyAdventures;', context)
  return context.run().then(result => assert.equal(result, cached))
})

test('caller cancellation never starts fallback', async () => {
  let aborted = 0
  const { run } = runtime((_url, { signal }) => new Promise((resolve, reject) => {
    const stop = () => { aborted++; reject(new Error('cancelled')) }
    if (signal.aborted) stop()
    else signal.addEventListener('abort', stop, { once: true })
  }))
  const controller = new AbortController()
  const result = run(url, { signal: controller.signal })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(result)
  assert.equal(aborted, 1)
})

test('service worker leaves API and cloud data uncached', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(source, /pathname\.startsWith\('\/api\/'\)/)
  assert.match(source, /pathname\.startsWith\('\/sb\/'\)/)
  assert.match(source, /cache\.match\(APP_SHELL\)/)
})

test('access check tolerates responses past the former four-second cutoff', async () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('async function callAccessApi('), source.indexOf('// 验证管理端密码：'))
  let requestedTimeout
  const context = vm.createContext({ AbortController, ACCESS_API: '/api/access',
    window: { setTimeout: (_fn, ms) => { requestedTimeout = ms; return 1 }, clearTimeout() {} },
    fetch: async () => json({ enabled: true, ok: true })
  })
  vm.runInContext(fn + '\nglobalThis.run = callAccessApi;', context)
  assert.equal((await context.run()).data.ok, true)
  assert.equal(requestedTimeout, 12000)
})
