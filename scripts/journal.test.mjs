import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../src/journal/journalModel.js'

test('Shanghai dates and Monday-based weeks cross months and years correctly', () => {
  assert.equal(
    model.todayInShanghai(new Date('2026-10-13T17:00:00Z')),
    '2026-10-14',
  )
  assert.equal(model.weekStart('2027-01-01'), '2026-12-28')
  assert.equal(model.shiftDate('2026-12-31', 1), '2027-01-01')
  assert.equal(model.validDate('2026-02-30'), false)
})
test('previous-night bedtime is distinct from after-midnight bedtime', () => {
  assert.equal(
    model.sleepReached({ sleepTime: '23:50', sleepPreviousDay: true }),
    true,
  )
  assert.equal(
    model.sleepReached({ sleepTime: '00:10', sleepPreviousDay: false }),
    false,
  )
  assert.equal(
    model.sleepReached({ sleepTime: '00:00', sleepPreviousDay: false }),
    false,
  )
  assert.equal(model.sleepReached({ sleepTime: '' }), null)
  assert.equal(
    model.sleepReached(
      { sleepTime: '23:40', sleepPreviousDay: true },
      { nights: 5, before: '23:30' },
    ),
    false,
  )
})
test('empty entries may check in; missing study time remains distinct from zero', () => {
  const blank = model.emptyEntry('pomelo', '2026-10-14')
  const signed = model.normalizeEntry({ ...blank, checkedIn: true })
  assert.equal(signed.checkedIn, true)
  assert.equal(signed.studyMinutes, null)
  assert.equal(
    model.normalizeEntry({ ...blank, studyMinutes: 0 }).studyMinutes,
    0,
  )
  assert.throws(() => model.normalizeEntry({ ...blank, studyMinutes: -1 }))
  assert.throws(() => model.normalizeEntry({ ...blank, studyMinutes: 1441 }))
})
test('weekly progress counts recorded sleep without requiring screenshots or checkin', () => {
  const rows = [
    { ...model.emptyEntry('orange', '2026-10-14'), sleepTime: '23:30' },
    { ...model.emptyEntry('pomelo', '2026-10-14'), sleepTime: '23:30' },
    { ...model.emptyEntry('orange', '2026-10-15'), checkedIn: true },
    {
      ...model.emptyEntry('orange', '2026-10-16'),
      sleepTime: '00:30',
      sleepPreviousDay: false,
    },
  ]
  assert.equal(model.weekSummary(rows, 'orange', '2026-10-12').reached, 1)
  assert.equal(model.weekSummary(rows, 'orange', '2026-10-19').reached, 0)
})

const source = readFileSync(
  new URL('../api/journal.js', import.meta.url),
  'utf8',
)
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?$/gm, '')
  .replace('export default async function handler', 'async function handler')
function harness(level = 1) {
  const records = [],
    tables = []
  const db = {
    from(table) {
      tables.push(table)
      let filters = [],
        mode = 'read',
        payload
      function execute(single) {
        const matching = records.filter((row) =>
          filters.every(([key, value]) => row[key] === value),
        )
        if (mode === 'insert') {
          if (
            records.some(
              (row) => row.owner === payload.owner && row.date === payload.date,
            )
          )
            return { error: { code: '23505' } }
          records.push(payload)
          return { data: payload }
        }
        if (mode === 'update')
          for (const row of matching) Object.assign(row, payload)
        return { data: single ? matching[0] || null : matching }
      }
      const query = {
        select() {
          return query
        },
        eq(key, value) {
          filters.push([key, value])
          return query
        },
        insert(value) {
          mode = 'insert'
          payload = value
          return query
        },
        update(value) {
          mode = 'update'
          payload = value
          return query
        },
        single: async () => execute(true),
        maybeSingle: async () => execute(true),
        then(resolve) {
          return Promise.resolve(execute(false)).then(resolve)
        },
      }
      return query
    },
  }
  const context = vm.createContext({
    ...model,
    todayInShanghai: () => '2026-10-17',
    LEVEL_SITE: 1,
    readLevel: () => level,
    checkServiceConfig: () => ({ ok: true }),
    getAdminClient: () => db,
    Buffer,
    URL,
    Error,
    console,
  })
  vm.runInContext(source + ';globalThis.handler = handler', context)
  return {
    records,
    tables,
    async run(body, method = 'POST') {
      const response = {
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
      await context.handler(
        { method, body, headers: {}, url: '/api/journal' },
        response,
      )
      return response
    },
  }
}
test('journal endpoints refuse access before database reads when site login is missing', async () => {
  const h = harness(0)
  assert.equal((await h.run({}, 'GET')).code, 401)
  assert.equal((await h.run({})).code, 401)
  assert.equal(h.tables.length, 0)
})
test('backfill preserves separate owners and an outdated device cannot overwrite a saved page', async () => {
  const h = harness()
  const entry = {
    ...model.emptyEntry('pomelo', '2026-10-14'),
    action: 'save',
    checkedIn: true,
    activities: '第一行\n\n第二行',
  }
  const first = await h.run(entry)
  assert.equal(first.code, 200)
  assert.equal(first.data.entry.activities, entry.activities)
  assert.equal(first.data.entry.version, 1)
  assert.equal((await h.run({ ...entry, owner: 'orange' })).code, 200)
  const stale = await h.run({ ...entry, activities: 'stale' })
  assert.equal(stale.code, 409)
  assert.equal(stale.data.current.activities, entry.activities)
  assert.equal(
    (await h.run({ ...entry, version: 1, activities: 'revised' })).code,
    200,
  )
  assert.equal(
    (await h.run({ ...entry, version: 1, activities: 'another stale edit' }))
      .code,
    409,
  )
  assert.ok(h.tables.every((table) => table === 'wwcxrl_journal_entries'))
})
test('future checkins and cross-owner screenshot references are rejected', async () => {
  const h = harness()
  const entry = { ...model.emptyEntry('pomelo', '2026-10-14'), action: 'save' }
  assert.equal((await h.run({ ...entry, date: '2026-10-18' })).code, 400)
  assert.equal(
    (
      await h.run({
        ...entry,
        screenshotPath:
          'orange/2026-10-14/11111111-1111-4111-8111-111111111111.jpg',
      })
    ).code,
    400,
  )
  assert.equal(h.records.length, 0)
})
