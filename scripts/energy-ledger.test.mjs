import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ENERGY_TARGET, createEnergyDraw, normalizeEnergyLedger, readEnergyProgress, writeEnergyProgress } from '../src/energyLedger.js'

const finale = { id: 'test-finale', startEnergy: 1300, target: 1314, gains: [5, 5, 4] }

test('three finale draws add exactly 14 across reloads and preserve the final four points', () => {
  let state = { energy: 1300, energyFinale: finale, draws: [] }
  const totals = []
  for (let index = 0; index < 3; index++) {
    const draw = createEnergyDraw(state, () => { throw new Error('Finale must not use random') })
    state = normalizeEnergyLedger(JSON.parse(JSON.stringify({ ...state, energy: state.energy + draw.gain,
      draws: [...state.draws, {...draw, at: new Date(index * 1000).toISOString()}] })))
    totals.push(state.energy)
  }
  assert.deepEqual(totals, [1305, 1310, 1314])
  assert.deepEqual(state.draws.map(draw => draw.gain), [5, 5, 4])
  assert.equal(createEnergyDraw(state, () => 0).gain, 5)
})

test('failed attempts do not advance the finale and unexpected energy cannot overshoot', () => {
  const state = {energy:1300, energyFinale:finale, draws:[]}
  assert.deepEqual(createEnergyDraw(state), createEnergyDraw(state))
  assert.throws(() => createEnergyDraw({...state,energy:1307}), /进度已改变/)
  assert.throws(() => createEnergyDraw({...state,draws:[{gain:5,finaleId:finale.id,finaleStep:1,at:'2026-01-01'}]}), /记录不一致/)
})

test('four-point exception requires a matching finale entry and is included in baseline recovery', () => {
  const state = normalizeEnergyLedger({energy:0, energyFinale:finale,
    energyLedger:{version:1,baselineEnergy:1300,baselineAt:'2026-01-01'},
    draws:[{gain:4,at:'2026-01-02'}, {gain:4,finaleId:finale.id,finaleStep:2,at:'2026-01-03'}]})
  assert.equal(state.draws.length,1)
  assert.equal(state.energy,1304)
})

test('target does not cap earned points or truncate draw history', () => {
  const draws = Array.from({ length: 150 }, (_, n) => ({ gain: 10, at: new Date(n * 1000).toISOString() }))
  const state = normalizeEnergyLedger({ energy: 1500, draws })
  assert.equal(ENERGY_TARGET, 1314)
  assert.equal(state.energy, 1500)
  assert.equal(state.draws.length, 150)
})

test('recovery baseline survives a stale capped client and is not double-counted', () => {
  const progress = { energy: 669, energyLedger: { version: 1, baselineEnergy: 1024, baselineAt: '2026-09-28T15:00:20.769Z' },
    draws: [{ gain: 8, at: '2026-09-28T15:00:20.769Z' }, { gain: 10, at: '2026-09-29T15:00:00Z' }] }
  const state = normalizeEnergyLedger(progress)
  assert.equal(state.energy, 1034)
  assert.deepEqual(normalizeEnergyLedger(state), state)
})

test('invalid records do not poison the total', () => {
  assert.deepEqual(normalizeEnergyLedger({ energy: 'bad', draws: [null, {gain:100,at:'bad'}] }), {energy:0,draws:[]})
})

function clientFixture({ fail = false } = {}) {
  let row = { progress_json: { energy: 100, drawChances: 1 }, updated_at: '2026-09-01T00:00:00.000Z' }
  return {
    get row() { return row },
    from() {
      let payload = null, expected
      const query = {
        select() { return query },
        eq(key, value) { if (key === 'updated_at') expected = value; return query },
        update(value) { payload = value; return query },
        async maybeSingle() {
          if (fail) return {error:new Error('offline')}
          if (!payload) return {data:row}
          if (row.updated_at !== expected) return {data:null}
          row = {...row, ...payload}
          return {data:{updated_at:row.updated_at}}
        }
      }
      return query
    }
  }
}

test('two devices cannot spend the same version of a draw chance', async () => {
  const client = clientFixture()
  const before = await readEnergyProgress(client, 'test', 1)
  const results = await Promise.allSettled([
    writeEnergyProgress(client, 'test', 1, {energy:110,drawChances:0}, before.updatedAt),
    writeEnergyProgress(client, 'test', 1, {energy:107,drawChances:0}, before.updatedAt)
  ])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(results.filter(r=>r.status==='rejected').length,1)
  assert.equal(client.row.progress_json.energy,110)
})

test('read and write failures are reported rather than treated as success', async () => {
  const client = clientFixture({fail:true})
  await assert.rejects(readEnergyProgress(client,'test',1),/offline/)
  await assert.rejects(writeEnergyProgress(client,'test',1,{energy:110},'2026-09-01'),/offline/)
})
