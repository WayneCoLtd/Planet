import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function runtime(fetch) {
  const storage = new Map()
  const source = readFileSync(new URL('../src/cloud.js', import.meta.url), 'utf8')
    .replace(/^import .*$/m, '')
    .replaceAll('import.meta.env.VITE_SUPABASE_URL', "'https://test.supabase.co'")
    .replaceAll('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY', "'test-key'")
    .replaceAll('export ', '')
    .replace('const CLOUD_REQUEST_TIMEOUT_MS = 10000', 'const CLOUD_REQUEST_TIMEOUT_MS = 100')
    .replace('const CLOUD_HEDGE_DELAY_MS = 700', 'const CLOUD_HEDGE_DELAY_MS = 10')
  const context = vm.createContext({
    fetch, Response, AbortController, URLSearchParams, console, setTimeout, clearTimeout,
    installStorageGuard() {},
    safeGetItem: (k, fallback = null) => storage.get(k) ?? fallback,
    safeSetItem: (k, v) => storage.set(k, v),
    CustomEvent: class {},
    window: { location: { hostname: 'planet.test', origin: 'https://planet.test', search: '' },
      setTimeout, clearTimeout, dispatchEvent() {} }
  })
  vm.runInContext(source + '\nglobalThis.run = cloudFetch;', context)
  return { run: context.run, storage }
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const url = 'https://test.supabase.co/rest/v1/tasks'

test('fast direct read does not start a second request', async () => {
  let calls = 0
  const { run } = runtime(async () => { calls++; return json([1]) })
  assert.deepEqual(await (await run(url)).json(), [1])
  await new Promise(r => setTimeout(r, 25))
  assert.equal(calls, 1)
})

test('stalled response body loses to complete fallback JSON', async () => {
  let cancelled = false
  const { run } = runtime(async (target, { signal }) => {
    if (target.startsWith('https://planet.test')) return json([2])
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => { cancelled = true; controller.error(new Error('aborted')) })
    } }), { headers: { 'content-type': 'application/json' } })
  })
  assert.deepEqual(await (await run(url)).json(), [2])
  assert.equal(cancelled, true)
})

test('HTML fallback cannot win against valid database response', async () => {
  const { run } = runtime(async target => {
    if (target.startsWith('https://planet.test')) return new Response('<html>error</html>')
    await new Promise(r => setTimeout(r, 30))
    return json([3])
  })
  assert.deepEqual(await (await run(url)).json(), [3])
})

test('failed writes are submitted only once', async () => {
  let calls = 0
  const { run } = runtime(async () => { calls++; throw new Error('offline') })
  await assert.rejects(run(url, { method: 'POST', body: '{}' }))
  assert.equal(calls, 1)
})

test('expired route is re-evaluated without reloading page', async () => {
  const paths = []
  const { run, storage } = runtime(async target => { paths.push(target); return json([]) })
  storage.set('wwcxrl-cloud-transport-v3', JSON.stringify({ mode: 'proxy', expiresAt: Date.now() + 1000 }))
  await run(url)
  storage.set('wwcxrl-cloud-transport-v3', JSON.stringify({ mode: 'proxy', expiresAt: 1 }))
  await run(url)
  assert.ok(paths[0].startsWith('https://planet.test'))
  assert.equal(paths[1], url)
})

test('failed task reads preserve last successful calendar', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('async function hydrateDailyAdventures()'), source.indexOf('function isAdminPageRequested()'))
  const cached = [{ day: 350 }]
  const context = vm.createContext({ loadCloudDailyTasks: async () => null, getDailyAdventures: () => cached })
  vm.runInContext(fn + '\nglobalThis.run = hydrateDailyAdventures;', context)
  return context.run().then(result => assert.equal(result, cached))
})

test('caller cancellation aborts both read routes', async () => {
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
  assert.equal(aborted, 2)
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
