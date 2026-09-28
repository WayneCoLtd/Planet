export const ENERGY_TARGET = 1314

// Milestones are goals, never a ceiling on earned points.
export function normalizeEnergyLedger(progress = {}) {
  const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
  const draws = (Array.isArray(progress.draws) ? progress.draws : [])
    .filter(draw => draw && Number.isFinite(Number(draw.gain)) && Number(draw.gain) >= 5 && Number(draw.gain) <= 15 && Number.isFinite(Date.parse(draw.at)))
    .map(draw => ({ ...draw, gain: Number(draw.gain) }))
  const ledger = progress.energyLedger
  const hasBaseline = ledger?.version === 1 && Number.isFinite(Number(ledger.baselineEnergy)) && Number.isFinite(Date.parse(ledger.baselineAt))
  const recovered = hasBaseline
    ? amount(ledger.baselineEnergy) + draws.filter(draw => Date.parse(draw.at) > Date.parse(ledger.baselineAt)).reduce((sum, draw) => sum + draw.gain, 0)
    : 0
  return {
    energy: Math.max(amount(progress.energy), recovered, draws.reduce((sum, draw) => sum + draw.gain, 0)),
    draws,
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
