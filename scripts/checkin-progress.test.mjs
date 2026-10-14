import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countJourneySignedDays, JOURNEY_TOTAL_DAYS } from '../src/checkinProgress.js'

test('complete Day 300–365 history gives 65 without changing records', () => {
  const days = Array.from({ length: 66 }, (_, index) => index + 300)
  const original = [...days]
  assert.equal(JOURNEY_TOTAL_DAYS, 65)
  assert.equal(countJourneySignedDays(days), 65)
  assert.deepEqual(days, original)
  assert.equal(countJourneySignedDays([300]), 0)
})

test('the starting day cannot compensate for a missing journey day', () => {
  const days = Array.from({ length: 66 }, (_, index) => index + 300).filter(day => day !== 320)
  assert.equal(countJourneySignedDays(days), 64)
})

test('merged histories count unique whole days inside the journey only', () => {
  assert.equal(countJourneySignedDays([300, 301, '301', 365, '365', 366, 1, 302.5, null, 'invalid']), 2)
  assert.equal(countJourneySignedDays(), 0)
})
