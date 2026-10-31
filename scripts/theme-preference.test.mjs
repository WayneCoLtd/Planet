import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { readVoyageAppearance, saveVoyageAppearance, clearVoyageAppearance } from '../src/themePreference.js'

function withStorage(run) {
  const previous = globalThis.window
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  globalThis.window = { localStorage: storage }
  try { run(storage, values) } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

test('first visit stays light; existing story-unlocked dark theme is retained', () => withStorage(storage => {
  assert.equal(readVoyageAppearance(), false)
  storage.setItem('wwcxrl-voyage-theme', 'yes')
  assert.equal(readVoyageAppearance(), true)
}))

test('manual appearance survives late cloud hydration without changing game progress', () => withStorage((storage, values) => {
  storage.setItem('wwcxrl-voyage-theme', 'yes')
  storage.setItem('wwcxrl-global-cloud-state', 'existing game progress')
  saveVoyageAppearance(false)
  storage.setItem('wwcxrl-voyage-theme', 'yes')
  assert.equal(readVoyageAppearance(), false)
  assert.equal(values.get('wwcxrl-global-cloud-state'), 'existing game progress')
  saveVoyageAppearance(true)
  storage.setItem('wwcxrl-voyage-theme', 'classic')
  assert.equal(readVoyageAppearance(), true)
}))

test('real story transition and reset override a manual appearance preference', () => withStorage(storage => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const setter = source.slice(source.indexOf('function setVoyageThemeLocal('), source.indexOf('function returnToInvitationLayer('))
  const events = []
  const context = vm.createContext({
    clearVoyageAppearance,
    localStorage: storage,
    loadGlobalLocalState: () => ({}),
    saveGlobalLocalState: () => {},
    window: { dispatchEvent: event => events.push(event.detail) },
    CustomEvent: class { constructor(type, options) { this.detail = options.detail } },
  })
  vm.runInContext(setter, context)
  saveVoyageAppearance(false)
  vm.runInContext("setVoyageThemeLocal(true, 'day4-stargate', { cloud: false })", context)
  assert.equal(readVoyageAppearance(), true)
  assert.equal(events.at(-1).theme, 'voyage')
  saveVoyageAppearance(true)
  vm.runInContext("setVoyageThemeLocal(false, 'full-site-reset-v31', { cloud: false })", context)
  assert.equal(readVoyageAppearance(), false)
  assert.equal(events.at(-1).theme, 'classic')
}))

test('unavailable browser storage does not break appearance controls', () => {
  const previous = globalThis.window
  globalThis.window = { localStorage: {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  } }
  try {
    assert.equal(readVoyageAppearance(), false)
    assert.doesNotThrow(() => saveVoyageAppearance(true))
    assert.doesNotThrow(clearVoyageAppearance)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})
