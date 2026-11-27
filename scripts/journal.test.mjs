import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../src/journal/journalModel.js'
import { decodePhotoUpload, encodePhotoUpload, PHOTO_UPLOAD_TYPE, readJpegBytes } from '../src/media/photoUpload.js'

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
function harness(level = 1, today = '2026-10-17') {
  const records = [],
    tables = [],
    uploads = [],
    signBatches = []
  const db = {
    storage: {
      from() {
        return {
          upload: async (path, bytes) => { uploads.push({ path, bytes }); return {} },
          createSignedUrls: async (paths) => {
            signBatches.push(paths)
            return { data: paths.map((path) => ({ path, signedUrl: 'https://test.invalid/' + path })) }
          },
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
                (payload.id ? row.id === payload.id : row.owner === payload.owner &&
                  (row.date || row.week_start) === (payload.date || payload.week_start)),
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
    todayInShanghai: () => today,
    LEVEL_SITE: 1,
    readLevel: () => level,
    checkServiceConfig: () => ({ ok: true }),
    getAdminClient: () => db,
    decodePhotoUpload,
    PHOTO_UPLOAD_TYPE,
    readJpegBytes,
    Buffer,
    URL,
    Error,
    console,
  })
  vm.runInContext(source + ';globalThis.handler = handler', context)
  return {
    records,
    tables,
    uploads,
    signBatches,
    async run(body, method = 'POST', date = '2026-10-14', headers = {}) {
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
        { method, body, headers, url: `/api/journal?date=${date}` },
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
    model.normalizeEntry({ ...old, growthNote: '字'.repeat(model.MAX_FEELING_LENGTH + 1) }),
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

test('draft recovery skips initial blanks and identical records without discarding real edits', () => {
  const blank = model.emptyEntry('pomelo', '2026-10-14')
  const remote = {...blank, version:4, notes:[{id:'a', text:'已同步内容', images:[]}]}
  assert.equal(model.redundantDraft({entry:blank}, remote), true)
  assert.equal(model.redundantDraft({entry:{...remote, version:1}}, remote), true)
  assert.equal(model.redundantDraft({entry:{...blank, version:1}}, remote), false, 'intentional deletion of a saved entry is retained')
  assert.equal(model.redundantDraft({entry:{...blank, growthNote:'新想法'}}, remote), false)
  assert.equal(model.redundantDraft({entry:{...blank, pendingImage:{id:'new',data:'bytes'}}}, remote), false)
  const previous = {...blank, version:1, sleepTime:'23:40'}
  assert.equal(model.redundantDraft({entry:previous,base:model.entryFingerprint(previous)}, remote), true)
  assert.equal(model.redundantDraft({entry:{...previous,sleepTime:'00:30'},base:model.entryFingerprint(previous)}, remote), false)
})

test('a late device read cannot replace a newer save; equal-version media URLs refresh', () => {
  const a = {...model.emptyEntry('pomelo','2026-10-14'), version:4, growthNote:'new', screenshotUrl:'old-url'}
  const stale = {...a, version:3, growthNote:'old'}
  assert.equal(model.mergeRemoteEntries([a],[stale])[0].growthNote,'new')
  assert.equal(model.mergeRemoteEntries([a],[{...a,screenshotUrl:'fresh-url'}])[0].screenshotUrl,'fresh-url')
  assert.equal(model.mergeRemoteEntries([a],[{...a,owner:'orange'}]).length,2)
})

test('two devices read saved text and signed photos and cannot overwrite with an old version', async () => {
  const h = harness()
  const id = '11111111-1111-4111-8111-111111111111'
  const entry = {...model.emptyEntry('pomelo','2026-10-14'), action:'save', notes:[{id:'note',text:'第一行\n第二行',images:[{id,path:`pomelo/2026-10-14/${id}.jpg`,thumbPath:`pomelo/2026-10-14/${id}-thumb.jpg`}]}]}
  const saved = await h.run(entry)
  assert.equal(saved.code,200)
  const readOnOtherDevice = await h.run({},'GET')
  const received = readOnOtherDevice.data.entries.find(e => e.owner === 'pomelo')
  assert.equal(received.notes[0].text,entry.notes[0].text)
  assert.ok(received.notes[0].images[0].url)
  assert.ok(received.notes[0].images[0].thumbUrl)
  const newer = await h.run({...received, action:'save', growthNote:'另一设备的新修改'})
  assert.equal(newer.code,200)
  const rejected = await h.run({...received, action:'save', notes:[{id:'note',text:'旧设备未保存内容',images:[]}]})
  assert.equal(rejected.code,409)
  assert.equal(rejected.data.current.growthNote,'另一设备的新修改')
  assert.equal(rejected.data.current.notes[0].images.length,1)
})

test('weekly sleep data only includes signed images for the open date', async () => {
  const h = harness()
  const id = '11111111-1111-4111-8111-111111111111'
  for (const date of ['2026-10-14', '2026-10-15']) {
    const saved = await h.run({ ...model.emptyEntry('pomelo', date), action: 'save', sleepTime: '23:58',
      screenshotPath: `pomelo/${date}/${id}.jpg` })
    assert.equal(saved.code, 200)
  }
  const first = (await h.run({}, 'GET', '2026-10-14')).data.entries
  const second = (await h.run({}, 'GET', '2026-10-15')).data.entries
  assert.ok(first.find(row => row.date === '2026-10-14').screenshotUrl)
  const previous = second.find(row => row.date === '2026-10-14')
  assert.equal(previous.sleepTime, '23:58')
  assert.equal(previous.screenshotUrl, undefined)
  assert.ok(second.find(row => row.date === '2026-10-15').screenshotUrl)
  assert.ok(model.mergeRemoteEntries(first, second).find(row => row.date === '2026-10-14').screenshotUrl)
})

test('sleep weeks follow the previous night across Monday, month and year boundaries', () => {
  for (const [page, expected] of [
    ['2026-10-19', '2026-10-12'],
    ['2026-10-20', '2026-10-19'],
    ['2026-11-02', '2026-10-26'],
    ['2027-01-04', '2026-12-28'],
    ['2026-10-14', '2026-10-12'],
  ]) assert.equal(model.sleepWeekStart(page), expected)
})

test('Monday can save Sunday night and a fresh GET returns its full sleep week and both goal versions', async () => {
  const h = harness(1, '2026-10-19')
  for (const date of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']) {
    const saved = await h.run({ ...model.emptyEntry('pomelo', date), sleepTime: '23:30', action: 'save' })
    assert.equal(saved.code, 200)
  }
  h.records.push({ _table: 'wwcxrl_journal_goals', owner: 'pomelo', week_start: '2026-10-12', nights: 5, before_time: '00:00', version: 1 })
  assert.equal((await h.run({ owner: 'pomelo', action: 'goal', week_start: '2026-10-19', nights: 4, before: '22:00', version: 0 })).code, 200)
  const monday = await h.run({}, 'GET', '2026-10-19')
  assert.equal(monday.code, 200)
  assert.equal(monday.data.entries.length, 6, 'a fresh Monday load must include last week, not only Monday')
  const oldGoal = monday.data.goals.find(g => g.week_start === '2026-10-12')
  assert.ok(oldGoal)
  assert.ok(monday.data.goals.find(g => g.week_start === '2026-10-19'))
  const summary = model.weekSummary(monday.data.entries, 'pomelo', model.sleepWeekStart('2026-10-19'), { nights: oldGoal.nights, before: oldGoal.before_time })
  assert.equal(summary.days[6].date, '2026-10-18')
  assert.equal(summary.days[6].reached, true)
  assert.equal(summary.reached, 6, 'new Monday target must not retroactively change last week')
  const tuesday = await h.run({}, 'GET', '2026-10-20')
  assert.equal(model.weekSummary(tuesday.data.entries, 'pomelo', model.sleepWeekStart('2026-10-20')).reached, 0)
  assert.equal((await h.run({ owner: 'pomelo', action: 'goal', week_start: '2026-10-12', nights: 1, before: '22:00', version: 1 })).code, 400)
})

const storeSource = readFileSync(new URL('../src/journal/journalStore.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?$/gm, '')
  .replace(/^export /gm, '')

test('media reads share pending work and a changed photo still needs its own links', async () => {
  const valid = new Set(['signed-full', 'signed-thumb'])
  let calls = 0, finish
  const context = vm.createContext({
    entryNotes: model.entryNotes,
    hasSignedMedia: url => valid.has(url),
    request: () => { calls++; return new Promise(resolve => { finish = resolve }) },
  })
  vm.runInContext(storeSource + '\njournalRequest = request; globalThis.load = loadPageMedia; globalThis.ready = hasPageMedia;', context)
  const date = '2026-11-25'
  const first = context.load(date), second = context.load(date)
  assert.equal(first, second)
  assert.equal(calls, 1)
  const image = { path: 'full.jpg', url: 'signed-full', thumbPath: 'thumb.jpg', thumbUrl: 'signed-thumb' }
  const row = { notes: [{ images: [image] }] }
  finish({ entries: [row] })
  await first
  assert.equal(context.ready([row]), true)
  assert.equal(context.ready([{ notes: [{ images: [{ ...image, path: 'replacement.jpg', url: '' }] }] }]), false)
  valid.delete(image.thumbUrl)
  assert.equal(context.ready([row]), false)
  const next = context.load(date)
  assert.equal(calls, 2)
  finish({ entries: [] })
  await next
})

test('local Monday loading uses the same previous-night range as the API', async () => {
  const fixtures = {
    entries: ['2026-10-12', '2026-10-13', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-26'].map(date => model.emptyEntry('pomelo', date)),
    goals: [],
  }
  const context = vm.createContext({ ...model, cloudEnabled: false, fixtures })
  vm.runInContext(storeSource + '\njournalStore = async name => fixtures[name]; globalThis.load = loadWeek;', context)
  const monday = await context.load('2026-10-19')
  assert.deepEqual(Array.from(monday.entries, row => row.date), ['2026-10-12', '2026-10-13', '2026-10-18', '2026-10-19'])
  const tuesday = await context.load('2026-10-20')
  assert.deepEqual(Array.from(tuesday.entries, row => row.date), ['2026-10-19', '2026-10-20', '2026-10-26'])
})

test('journal waits for both parallel uploads before failing or saving', async () => {
  const pending = []
  const saves = []
  const request = (body) => {
    if (body.action === 'save') {
      saves.push(body)
      return Promise.resolve({ entry: body })
    }
    return new Promise((resolve, reject) => pending.push({ body, resolve, reject }))
  }
  const context = vm.createContext({ entryNotes: model.entryNotes, cloudEnabled: true, request })
  vm.runInContext(storeSource + '\njournalRequest = request; globalThis.save = saveEntry;', context)
  const image = { id: '11111111-1111-4111-8111-111111111111', pendingImage: { data: 'full', thumbnail: 'thumb' } }
  const entry = { ...model.emptyEntry('pomelo', '2026-10-14'), notes: [{ id: 'note', text: '', images: [image] }] }
  const saving = context.save(entry)
  let finished = false
  void saving.catch(() => { finished = true })
  assert.deepEqual(pending.map(({ body }) => [body.image, body.variant || 'full']), [['full', 'full'], ['thumb', 'thumb']])
  pending[0].reject(new Error('storage failed'))
  await new Promise(setImmediate)
  assert.equal(finished, false)
  pending[1].resolve({ screenshotPath: 'thumb.jpg' })
  await assert.rejects(saving, /storage failed/)
  assert.equal(saves.length, 0)

  const retry = context.save(entry)
  assert.deepEqual(pending.slice(2).map(({ body }) => body.id), [image.id, image.id])
  pending[3].resolve({ screenshotPath: 'thumb.jpg' })
  await new Promise(setImmediate)
  assert.equal(saves.length, 0)
  pending[2].resolve({ screenshotPath: 'full.jpg' })
  const saved = await retry
  assert.equal(saved.notes[0].images[0].path, 'full.jpg')
  assert.equal(saved.notes[0].images[0].thumbPath, 'thumb.jpg')
  assert.equal(saves.length, 1)
  assert.deepEqual(image.pendingImage, { data: 'full', thumbnail: 'thumb' })
})

test('journal accepts binary and cached JSON JPEG uploads with the same private paths', async () => {
  const h = harness()
  const id = '11111111-1111-4111-8111-111111111111'
  const body = { action: 'image', owner: 'orange', date: '2026-10-14', id, variant: 'thumb', image: 'data:image/jpeg;base64,/9j/2Q==' }
  const packed = await encodePhotoUpload(body)
  const headers = { 'content-type': packed.type }
  const bytes = Buffer.from(await packed.arrayBuffer())
  const binary = await h.run(bytes, 'POST', body.date, headers)
  const legacy = await h.run(body)
  assert.equal(binary.code, 200)
  assert.equal(legacy.code, 200)
  assert.equal(binary.data.screenshotPath, `orange/${body.date}/${id}-thumb.jpg`)
  assert.equal(binary.data.screenshotPath, legacy.data.screenshotPath)
  assert.deepEqual(h.uploads[0].bytes, h.uploads[1].bytes)
  assert.equal((await h.run(bytes.subarray(0, -1), 'POST', body.date, headers)).code, 400)
  assert.equal(h.uploads.length, 2)
})

test('partner messages append separately from unpublished feelings and retries keep one copy', async () => {
  const h = harness()
  const page = model.emptyEntry('orange', '2026-10-14')
  const first = { action: 'comment', owner: page.owner, date: page.date,
    id: 'aaaa1111-1111-4111-8111-111111111111', text: '下午好\n\n晚点见' }
  const second = { ...first, id: 'bbbb2222-2222-4222-8222-222222222222', text: '到家了' }
  assert.equal((await h.run(first)).code, 200)
  assert.equal((await h.run(second)).code, 200)
  assert.equal((await h.run(first)).code, 200)
  assert.equal((await h.run({ ...first, text: '替换原文' })).code, 409)
  assert.equal((await h.run({ ...first, text: '   ' })).code, 400)
  assert.equal((await h.run({ ...first, text: '长'.repeat(10001) })).code, 400)
  assert.equal((await h.run({ ...page, action: 'save', growthNote: '刚保存的感受' })).code, 200)
  const replies = await h.run(null, 'GET', page.date + '&comments=orange')
  assert.deepEqual(Array.from(replies.data.comments, row => row.text), [first.text, second.text])
  assert.equal((await h.run(null, 'GET', page.date + '&comments=pomelo')).data.comments.length, 0)
  assert.equal((await h.run(null, 'GET', '2026-10-15&comments=orange')).data.comments.length, 0)
})

test('weekly metadata can open without storage; date-only media signs both pages in one batch', async () => {
  const h = harness()
  const date = '2026-10-15'
  for (const owner of model.OWNERS) {
    const page = model.emptyEntry(owner, date)
    h.records.push({ _table: 'wwcxrl_journal_entries', owner, date, version: 7, content: {
      ...page, screenshotPath: owner + '/' + date + '/sleep.jpg',
      notes: [{ id: 'n', text: '旧手记', images: [{ id: 'p', path: owner + '/full', thumbPath: owner + '/thumb' }] }],
    } })
  }
  const summary = await h.run(null, 'GET', date + '&summary=1')
  assert.equal(summary.code, 200)
  assert.equal(summary.data.entries[0].notes[0].images[0].url, undefined)
  assert.equal(h.signBatches.length, 0)
  const media = await h.run(null, 'GET', date + '&media=1')
  assert.equal(media.code, 200)
  assert.deepEqual(h.signBatches.map(paths => paths.length), [6])
  for (const entry of media.data.entries) {
    assert.ok(entry.screenshotUrl)
    assert.ok(entry.notes[0].images[0].thumbUrl)
  }
})
test('legacy journal text moves once, with old feelings, draft baselines and image identities intact', () => {
  const photo = { id: 'pic', pendingImage: { data: 'local-bytes' } }
  const old = { ...model.emptyEntry('orange', '2026-10-25'), activities: '被取代的旧版缓存',
    notes: [{id:'a', text:'一'.repeat(850), images:[photo]}, {id:'b', text:'第二段\n换行', images:[]}], growthNote:'原有感受' }
  const migrated = model.mergeJournalFeeling(old)
  assert.equal(migrated.growthNote, old.notes[0].text + '\n\n第二段\n换行\n\n原有感受')
  assert.equal(migrated.notes[0].images[0], photo)
  assert.equal(model.normalizeEntry(migrated).growthNote, migrated.growthNote)
  assert.equal(model.mergeJournalFeeling(migrated), migrated)
  assert.equal(model.mergeJournalFeeling({...migrated, growthNote:''}).growthNote, '')
  assert.equal(model.mergeJournalFeeling({...old, notes:undefined, activities:'最早的记录'}).growthNote, '最早的记录\n\n原有感受')
  const legacyBase = JSON.stringify({ sleepTime:'', studyMinutes:null, growthNote:old.growthNote,
    screenshotPath:'', pendingImage:null, notes:old.notes })
  assert.equal(model.redundantDraft({entry:old, base:legacyBase}, {...migrated, growthNote:'新的云端内容'}), true)
  assert.equal(model.entryFingerprint(old),model.entryFingerprint(migrated))
  assert.ok(old.notes[0].text.length)
})
