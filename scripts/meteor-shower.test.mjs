import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startMeteorShower } from '../src/meteorShower.js'

function fixture({ enabled = true, hidden = false, reduced = false, randomValue = .5 } = {}) {
  const visibility = Object.assign(new EventTarget(), { hidden })
  const motion = Object.assign(new EventTarget(), { matches: reduced })
  const timers = new Map(), meteors = [], pauses = []
  let id = 0
  const stop = startMeteorShower({ enabled, visibility, motion,
    onMeteor: value => meteors.push(value), onPause: value => pauses.push(value), random: () => randomValue,
    setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id },
    clearTimer: key => timers.delete(key),
  })
  const next = () => {
    assert.equal(timers.size, 1)
    const [key, { fn, delay }] = [...timers][0]
    timers.delete(key)
    fn()
    return delay
  }
  return { visibility, motion, timers, meteors, pauses, stop, next }
}

test('only one short-lived meteor is scheduled, with quiet intervals', () => {
  const f = fixture()
  assert.equal(f.next(), 2800)
  assert.deepEqual(f.meteors.at(-1), { left: 75, top: 15 })
  assert.equal(f.next(), 1400)
  assert.equal(f.meteors.at(-1), null)
  assert.equal(f.next(), 3100)
  f.stop()
  assert.equal(f.timers.size, 0)
})

test('consecutive meteor starts stay 4–5 seconds apart including the visible lifetime', () => {
  for (const randomValue of [0, .5, 1]) {
    const f = fixture({ randomValue })
    f.next()
    const lifetime = f.next()
    const gap = f.next()
    assert.ok(lifetime + gap >= 4000 && lifetime + gap <= 5000)
    f.stop()
  }
})

test('background tabs remove the active meteor and cancel pending work', () => {
  const f = fixture()
  f.next()
  f.visibility.hidden = true
  f.visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.timers.size, 0)
  assert.equal(f.meteors.at(-1), null)
  assert.equal(f.pauses.at(-1), true)
  f.visibility.hidden = false
  f.visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.next(), 2800)
  f.stop()
  f.visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.timers.size, 0)
})

test('reduced motion is respected on load and when changed while viewing', () => {
  const f = fixture({ reduced: true })
  assert.equal(f.timers.size, 0)
  f.motion.matches = false
  f.motion.dispatchEvent(new Event('change'))
  f.next()
  f.motion.matches = true
  f.motion.dispatchEvent(new Event('change'))
  assert.equal(f.timers.size, 0)
  assert.equal(f.meteors.at(-1), null)
  assert.equal(f.pauses.at(-1), true)
  f.stop()
})

test('light theme never schedules meteors, including after returning to the tab', () => {
  const f = fixture({ enabled: false })
  f.visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.timers.size, 0)
  assert.equal(f.meteors.some(Boolean), false)
  f.stop()
})
