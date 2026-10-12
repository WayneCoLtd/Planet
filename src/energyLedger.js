export const ENERGY_TARGET = 1314

function normalizeFinale(plan) {
  if (!plan || typeof plan.id !== 'string' || !plan.id || !Number.isInteger(plan.startEnergy) || plan.startEnergy < 0 || plan.target !== ENERGY_TARGET) return null
  if (!Array.isArray(plan.gains) || !plan.gains.length || !plan.gains.every(gain => Number.isInteger(gain) && gain > 0 && gain <= 15)) return null
  if (plan.startEnergy + plan.gains.reduce((sum, gain) => sum + gain, 0) !== plan.target) return null
  return { id: plan.id, startEnergy: plan.startEnergy, target: plan.target, gains: [...plan.gains] }
}

export function createEnergyDraw(progress, random = Math.random) {
  const state = normalizeEnergyLedger(progress)
  const plan = state.energyFinale
  if (plan) {
    const completed = state.draws.filter(draw => draw.finaleId === plan.id)
    if (completed.some((draw, index) => draw.finaleStep !== index || draw.gain !== plan.gains[index])) {
      throw new Error('收官抽奖记录不一致，请刷新同步后再试。')
    }
    if (completed.length < plan.gains.length) {
      const expected = plan.startEnergy + completed.reduce((sum, draw) => sum + draw.gain, 0)
      if (state.energy !== expected) throw new Error('能量进度已改变，请刷新同步后再试。')
      return { gain: plan.gains[completed.length], finaleId: plan.id, finaleStep: completed.length }
    }
  }
  return { gain: Math.floor(random() * 11) + 5 }
}

// Milestones are goals, never a ceiling on earned points.
export function normalizeEnergyLedger(progress = {}) {
  const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
  const finale = normalizeFinale(progress.energyFinale)
  const isFinaleDraw = draw => finale && draw.finaleId === finale.id && Number.isInteger(draw.finaleStep)
    && draw.finaleStep >= 0 && draw.finaleStep < finale.gains.length && Number(draw.gain) === finale.gains[draw.finaleStep]
  const draws = (Array.isArray(progress.draws) ? progress.draws : [])
    .filter(draw => draw && Number.isFinite(Number(draw.gain)) && ((Number(draw.gain) >= 5 && Number(draw.gain) <= 15) || isFinaleDraw(draw)) && Number.isFinite(Date.parse(draw.at)))
    .map(draw => ({ ...draw, gain: Number(draw.gain) }))
  const ledger = progress.energyLedger
  const hasBaseline = ledger?.version === 1 && Number.isFinite(Number(ledger.baselineEnergy)) && Number.isFinite(Date.parse(ledger.baselineAt))
  const recovered = hasBaseline
    ? amount(ledger.baselineEnergy) + draws.filter(draw => Date.parse(draw.at) > Date.parse(ledger.baselineAt)).reduce((sum, draw) => sum + draw.gain, 0)
    : 0
  return {
    energy: Math.max(amount(progress.energy), recovered, draws.reduce((sum, draw) => sum + draw.gain, 0)),
    draws,
    ...(finale ? { energyFinale: finale } : {}),
    ...(hasBaseline ? { energyLedger: { ...ledger } } : {})
  }
}

// Conditional updates keep two devices from spending the same chance. This
// module deliberately has no local-storage side effects before confirmation.
export async function readEnergyProgress(client, userId, day) {
  const { data, error } = await client.from('wwcxrl_day_progress')
    .select('progress_json,updated_at').eq('user_id', userId).eq('day', day).maybeSingle()
  if (error) throw error
  return { progress: data?.progress_json || null, updatedAt: data?.updated_at || null }
}

export async function writeEnergyProgress(client, userId, day, progress, expectedUpdatedAt) {
  const revisionTime = Math.max(Date.now(), (Date.parse(expectedUpdatedAt) || 0) + 1)
  const payload = { progress_json: progress, updated_at: new Date(revisionTime).toISOString() }
  const table = client.from('wwcxrl_day_progress')
  const query = expectedUpdatedAt
    ? table.update(payload).eq('user_id', userId).eq('day', day).eq('updated_at', expectedUpdatedAt)
    : table.insert({ ...payload, user_id: userId, day })
  const { data, error } = await query.select('updated_at').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('能量进度已在另一处更新，请同步后再试。')
  return data.updated_at
}
