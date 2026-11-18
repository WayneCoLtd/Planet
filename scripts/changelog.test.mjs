import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { changelog, releaseNotes } from '../src/data/changelog.js'
import { createReadResource } from '../src/readResource.js'

const source = readFileSync(new URL('../src/changelogStore.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')

const entry = (version, sort = 0) => ({ version, date: '2026-11-17', title: version, notes: [], sort })
const versions = (rows) => Array.from(rows, (row) => row.version)

function setup({ cache, load = async () => null, save = async () => ({ ok: true }) } = {}) {
  const context = vm.createContext({
    changelog,
    releaseNotes,
    createReadResource,
    cloudEnabled: true,
    loadCloudChangelog: load,
    saveCloudChangelog: save,
    safeGetItem: () => JSON.stringify(cache),
    safeSetItem: (_, value) => { cache = JSON.parse(value) },
  })
  vm.runInContext(source + '\nObject.assign(globalThis, { visibleChangelog, loadChangelog, saveChangelog })', context)
  return context
}

test('cached history and the bundled release are available during one shared slow fetch', async () => {
  let finish
  const store = setup({ cache: [entry('v4.1'), entry('v4.2', 1)], load: () => new Promise(resolve => { finish = resolve }) })
  assert.deepEqual(versions(store.visibleChangelog()), ['v4.3', 'v4.2', 'v4.1'])
  const pending = store.loadChangelog()
  const reopened = store.loadChangelog()
  await Promise.resolve()
  finish([entry('v4.2', 1), entry('v4.0')])
  await Promise.all([pending, reopened])
  assert.deepEqual(versions(store.visibleChangelog()), ['v4.3', 'v4.2', 'v4.0'])
})

test('an empty or unavailable cloud response keeps the last good history', async () => {
  const cache = [entry('v4.2')]
  for (const response of [null, []]) {
    const store = setup({ cache, load: async () => response })
    await store.loadChangelog()
    assert.deepEqual(versions(store.visibleChangelog()), ['v4.3', 'v4.2'])
  }
})

test('a matching cloud version replaces the bundled version without a duplicate', async () => {
  const store = setup({ load: async () => [{ ...releaseNotes[0], version: 'v 4.3', title: '已编辑' }] })
  await store.loadChangelog()
  assert.deepEqual(versions(store.visibleChangelog()), ['v 4.3'])
  assert.equal(store.visibleChangelog()[0].title, '已编辑')
})

test('saving preserves same-day order and ends an older read without replacing the new cache', async () => {
  let finish
  let written
  const store = setup({
    load: () => new Promise(resolve => { finish = resolve }),
    save: async (entries) => { written = entries; return { ok: true } },
  })
  const pending = store.loadChangelog()
  await store.saveChangelog([entry('v4.2'), entry('v4.1')])
  assert.deepEqual(Array.from(written, (item) => item.sort), [1, 0])
  finish([entry('v4.0')])
  await pending
  assert.deepEqual(versions(store.visibleChangelog()), ['v4.3', 'v4.2', 'v4.1'])
})
