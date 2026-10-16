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
    storage: {
      from() {
        return {
          createSignedUrls: async (paths) => ({
            data: paths.map((path) => ({
              path,
              signedUrl: `https://test.invalid/${path}`,
            })),
          }),
        }
      },
    },
    from(table) {
      tables.push(table)
      let filters = [],
        mode = 'read',
        payload
      function execute(single) {
        const matching = records.filter(
          (row) =>
            row._table === table &&
            filters.every(([key, value, op]) =>
              op === 'gte'
                ? row[key] >= value
                : op === 'lte'
                  ? row[key] <= value
                  : row[key] === value,
            ),
        )
        if (mode === 'insert') {
          if (
            records.some(
              (row) =>
                row._table === table &&
                row.owner === payload.owner &&
                (row.date || row.week_start) ===
                  (payload.date || payload.week_start),
            )
          )
            return { error: { code: '23505' } }
          records.push({ ...payload, _table: table })
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
        gte(key, value) {
          filters.push([key, value, 'gte'])
          return query
        },
        lte(key, value) {
          filters.push([key, value, 'lte'])
          return query
        },
        order() {
          return query
        },
        limit() {
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
        { method, body, headers: {}, url: '/api/journal?date=2026-10-14' },
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
    notes: [{ id: 'first-note', text: '第一行\n\n第二行', images: [] }],
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

test('legacy text becomes one note without losing original whitespace or mutating the record', () => {
  const legacy = {
    ...model.emptyEntry('pomelo', '2026-10-14'),
    activities: '旧文字\n\n  原始缩进',
  }
  const notes = model.entryNotes(legacy)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].text, legacy.activities)
  assert.equal(legacy.notes, undefined)
  assert.deepEqual(model.entryNotes({ ...legacy, notes: [] }), [])
})

test('note serialization preserves ordering and image-only notes but excludes signed URLs and pending bytes', () => {
  const note = {
    id: 'n1',
    text: '',
    images: [
      {
        id: 'image1',
        path: 'some-path',
        thumbPath: 'thumb-path',
        url: 'secret-token',
        pendingImage: { data: 'bytes' },
      },
    ],
  }
  const normalized = model.normalizeNotes([
    note,
    { id: 'n2', text: '第二条', images: [] },
  ])
  assert.deepEqual(
    normalized.map((n) => n.id),
    ['n1', 'n2'],
  )
  assert.equal(normalized[0].images[0].url, undefined)
  assert.equal(normalized[0].images[0].pendingImage, undefined)
  assert.equal(normalized[0].images[0].path, 'some-path')
  assert.throws(() => model.normalizeNotes([note, note]))
})

test('current-week goal updates are versioned and reject writes to past or next week', async () => {
  const h = harness()
  const goal = {
    action: 'goal',
    owner: 'pomelo',
    week_start: '2026-10-12',
    nights: 5,
    before: '00:00',
    version: 0,
  }
  assert.equal((await h.run(goal)).code, 200)
  assert.equal((await h.run({ ...goal, nights: 4, version: 1 })).code, 200)
  assert.equal((await h.run({ ...goal, nights: 3, version: 1 })).code, 409)
  assert.equal((await h.run({ ...goal, week_start: '2026-10-05' })).code, 400)
  assert.equal((await h.run({ ...goal, week_start: '2026-10-19' })).code, 400)
})

test('an old client cannot erase the new note structure', async () => {
  const h = harness()
  const old = {
    ...model.emptyEntry('pomelo', '2026-10-14'),
    action: 'save',
    activities: '原记录',
  }
  assert.equal((await h.run(old)).code, 200)
  const result = await h.run({ ...old, version: 1, activities: '旧客户端改写' })
  assert.equal(result.code, 409)
  assert.equal(result.data.current.notes[0].text, '原记录')
})

test('a note cannot attach another person’s private image', async () => {
  const h = harness()
  const result = await h.run({
    ...model.emptyEntry('pomelo', '2026-10-14'),
    action: 'save',
    notes: [
      {
        id: 'n',
        text: '',
        images: [
          {
            id: 'i',
            path: 'orange/2026-10-14/11111111-1111-4111-8111-111111111111.jpg',
            thumbPath: '',
          },
        ],
      },
    ],
  })
  assert.equal(result.code, 400)
  assert.equal(h.records.length, 0)
})

test('signed media refresh never replaces a draft’s text, order or pending image', () => {
  const remote = {
    notes: [
      {
        id: 'n',
        text: 'remote',
        images: [
          { id: 'i', path: 'a.jpg', url: 'fresh', thumbUrl: 'fresh-thumb' },
        ],
      },
    ],
  }
  const local = {
    activities: 'legacy',
    notes: [
      {
        id: 'n',
        text: 'unsaved edits',
        images: [
          { id: 'i', path: 'a.jpg', url: 'expired', thumbUrl: 'expired-thumb' },
          { id: 'pending', path: '', pendingImage: { data: 'local' } },
        ],
      },
    ],
  }
  const result = model.mergeEntryMedia(local, remote)
  assert.equal(result.notes[0].text, 'unsaved edits')
  assert.equal(result.notes[0].images[0].url, 'fresh')
  assert.equal(result.notes[0].images[1].pendingImage.data, 'local')
  assert.equal(local.notes[0].images[0].url, 'expired')
})

test('reading a legacy record with a sleep screenshot keeps the original activity text', async () => {
  const h = harness()
  h.records.push({
    _table: 'wwcxrl_journal_entries',
    owner: 'pomelo',
    date: '2026-10-14',
    version: 3,
    content: {
      activities: '旧记录\n\n原文',
      screenshotPath:
        'pomelo/2026-10-14/11111111-1111-4111-8111-111111111111.jpg',
    },
  })
  const result = await h.run({}, 'GET')
  assert.equal(result.code, 200)
  assert.equal(result.data.entries[0].notes[0].text, '旧记录\n\n原文')
  assert.equal(result.data.entries[0].activities, '旧记录\n\n原文')
  assert.equal(h.records[0].content.notes, undefined)
})

test('blank saved notes do not produce empty reading rows and remain recoverable', () => {
  const notes = [
    { id: 'empty-a', text: '', images: [] },
    { id: 'empty-b', text: '  \n', images: [] },
    { id: 'text', text: '今天的记录', images: [] },
    { id: 'photo', text: '', images: [{ id: 'image' }] },
  ]
  const original = JSON.stringify(notes)
  assert.deepEqual(
    model.visibleNotes(notes).map((note) => note.id),
    ['text', 'photo'],
  )
  assert.deepEqual(
    model.visibleNotes(notes, 'empty-a').map((note) => note.id),
    ['empty-a', 'text', 'photo'],
  )
  assert.equal(JSON.stringify(notes), original)
})

test('growth note is optional, preserves line breaks, and is bounded', () => {
  const old = { ...model.emptyEntry('pomelo', '2026-10-14') }
  delete old.growthNote
  assert.equal(model.normalizeEntry(old).growthNote, '')
  assert.equal(
    model.normalizeEntry({
      ...old,
      growthNote: '把问题写清楚了。\n少着急了一点。',
    }).growthNote,
    '把问题写清楚了。\n少着急了一点。',
  )
  assert.throws(() =>
    model.normalizeEntry({ ...old, growthNote: '字'.repeat(501) }),
  )
})

test('growth note can be saved and cleared explicitly, but not erased by old clients', async () => {
  const h = harness()
  const entry = {
    ...model.emptyEntry('pomelo', '2026-10-14'),
    notes: [],
    action: 'save',
    growthNote: '今天问出了一个不懂的问题。',
  }
  assert.equal((await h.run(entry)).code, 200)
  const legacy = { ...entry, version: 1 }
  delete legacy.growthNote
  const conflict = await h.run(legacy)
  assert.equal(conflict.code, 409)
  assert.equal(conflict.data.current.growthNote, entry.growthNote)
  const cleared = await h.run({ ...entry, version: 1, growthNote: '' })
  assert.equal(cleared.code, 200)
  assert.equal(cleared.data.entry.growthNote, '')
})

test('single editor combines legacy text in order without mutating or losing photos', () => {
  const notes = [
    {
      id: 'a',
      text: '第一段\n原来的换行',
      images: [{ id: 'p1', path: 'first' }],
    },
    { id: 'blank', text: '', images: [] },
    { id: 'b', text: '第二段', images: [{ id: 'p2', path: 'second' }] },
  ]
  const original = JSON.stringify(notes)
  assert.equal(model.journalText(notes), '第一段\n原来的换行\n\n第二段')
  const edited = model.singleJournalNote(notes, '· 修改后的文字')
  assert.equal(edited.length, 1)
  assert.deepEqual(
    edited[0].images.map((image) => image.id),
    ['p1', 'p2'],
  )
  assert.equal(model.singleJournalNote(notes, '')[0].images.length, 2)
  assert.equal(JSON.stringify(notes), original)
})

test('bullet formatting modifies the current line and does not create new records', () => {
  assert.deepEqual(model.bulletAtLine('第一点\n第二点', 6), {
    text: '第一点\n· 第二点',
    caret: 8,
  })
  assert.deepEqual(model.bulletAtLine('· 第一点', 4), {
    text: '· 第一点',
    caret: 4,
  })
  assert.deepEqual(model.bulletAtLine('\n第二行', 0), {
    text: '· \n第二行',
    caret: 2,
  })
})

test('sleep week distinguishes reached, missed and unrecorded across midnight', () => {
  const rows = [
    {
      ...model.emptyEntry('pomelo', '2026-10-14'),
      sleepTime: '23:40',
      sleepPreviousDay: true,
    },
    {
      ...model.emptyEntry('pomelo', '2026-10-15'),
      sleepTime: '00:30',
      sleepPreviousDay: false,
    },
    { ...model.emptyEntry('pomelo', '2026-10-16'), checkedIn: true },
    {
      ...model.emptyEntry('pomelo', '2026-10-17'),
      sleepTime: '00:10',
      sleepPreviousDay: false,
    },
  ]
  const summary = model.weekSummary(rows, 'pomelo', '2026-10-12', {
    nights: 5,
    before: '00:20',
  })
  assert.deepEqual(
    summary.days.map((day) => day.reached),
    [null, true, false, null, true, null, null],
  )
  assert.equal(summary.reached, 2)
  assert.equal(
    model.sleepReached(
      { sleepTime: '00:20', sleepPreviousDay: false },
      { nights: 5, before: '00:20' },
    ),
    false,
  )
  assert.deepEqual(
    model
      .weekSummary(rows, 'orange', '2026-10-12')
      .days.map((day) => day.reached),
    Array(7).fill(null),
  )
})

test('October 13 at 01:53 recorded on October 14 marks Tuesday missed, not Wednesday reached', () => {
  const row = { ...model.emptyEntry('orange', '2026-10-14'), sleepTime: '01:53', sleepPreviousDay: true }
  const original = JSON.stringify(row)
  const summary = model.weekSummary([row], 'orange', '2026-10-12', { nights: 5, before: '00:20' })
  assert.deepEqual(summary.days.map(day => day.reached), [null, false, null, null, null, null, null])
  assert.equal(summary.reached, 0)
  assert.equal(JSON.stringify(row), original)
})

test('night belongs to previous day even for legacy same-day flags, including Sunday backfill', () => {
  const rows = [
    { ...model.emptyEntry('orange', '2026-10-18'), sleepTime: '23:30', sleepPreviousDay: false },
    { ...model.emptyEntry('orange', '2026-10-19'), sleepTime: '01:53', sleepPreviousDay: true },
  ]
  const summary = model.weekSummary(rows, 'orange', '2026-10-12', { nights: 5, before: '00:20' })
  assert.equal(summary.days[5].reached, true)
  assert.equal(summary.days[6].reached, false)
  assert.equal(summary.reached, 1)
  assert.deepEqual(model.weekSummary([...rows].reverse(), 'orange', '2026-10-12', { nights: 5, before: '00:20' }), summary)
  assert.equal(model.weekSummary(rows, 'orange', '2026-10-19').reached, 0)
})
