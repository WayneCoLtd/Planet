const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

const FIXED_ROLE_IDS = {
  orange: 'miyou-orange-main',
  pomelo: 'miyou-pomelo-main'
}

export const cloudEnabled = Boolean(supabaseUrl && supabaseKey)

let supabasePromise = null

export async function getSupabase() {
  if (!cloudEnabled) return null
  if (!supabasePromise) {
    supabasePromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    }))
  }
  return supabasePromise
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback))
  } catch {
    return fallback
  }
}

function getRoleFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const role = params.get('user') || params.get('role')
  if (role === 'orange' || role === 'pomelo') {
    localStorage.setItem('miyou-cloud-role', role)
    return role
  }
  return localStorage.getItem('miyou-cloud-role') || 'pomelo'
}

function getDisplayName(role) {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('name')
  if (fromUrl) return fromUrl
  if (role === 'orange') return '小陈'
  if (role === 'pomelo') return '小翟'
  return '神秘访客'
}

export function getCloudIdentity() {
  if (typeof window === 'undefined') return null
  const role = getRoleFromUrl()
  const id = FIXED_ROLE_IDS[role] || FIXED_ROLE_IDS.pomelo
  localStorage.setItem('miyou-cloud-role', role)
  localStorage.setItem(`miyou-cloud-user-id-${role}`, id)
  return {
    id,
    role,
    displayName: getDisplayName(role),
    deviceLabel: navigator.platform || 'unknown-device'
  }
}

async function ensureProfile() {
  const supabase = await getSupabase()
  const identity = getCloudIdentity()
  if (!supabase || !identity) return { supabase, identity }
  const payload = {
    id: identity.id,
    display_name: identity.displayName,
    role: identity.role,
    device_label: identity.deviceLabel,
    last_seen_at: new Date().toISOString()
  }
  const { error } = await supabase.from('miyou_profiles').upsert(payload, { onConflict: 'id' })
  if (error) console.warn('[miyou cloud] profile upsert failed', error.message)
  return { supabase, identity }
}

export async function logCloudEvent(eventType, detail = {}, day = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const { error } = await supabase.from('miyou_activity_logs').insert({
      user_id: identity.id,
      display_name: identity.displayName,
      role: identity.role,
      event_type: eventType,
      day,
      detail_json: detail || {},
      page_url: window.location.href,
      user_agent: navigator.userAgent
    })
    if (error) console.warn('[miyou cloud] log failed', error.message)
  } catch (error) {
    console.warn('[miyou cloud] log exception', error)
  }
}

export async function saveCloudDayProgress(day, progress, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const { error } = await supabase.from('miyou_day_progress').upsert({
      user_id: targetUserId || identity.id,
      day,
      progress_json: progress,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[miyou cloud] progress save failed', error.message)
  } catch (error) {
    console.warn('[miyou cloud] progress exception', error)
  }
}

export async function loadCloudDayProgress(day, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { progress: null }
    const userId = targetUserId || identity.id
    const { data, error } = await supabase
      .from('miyou_day_progress')
      .select('progress_json,updated_at')
      .eq('user_id', userId)
      .eq('day', day)
      .maybeSingle()
    if (error) {
      console.warn('[miyou cloud] progress load failed', error.message)
      return { progress: null }
    }
    return { progress: data?.progress_json || null, updatedAt: data?.updated_at || '' }
  } catch (error) {
    console.warn('[miyou cloud] progress load exception', error)
    return { progress: null }
  }
}

export async function markCloudTaskCompleted(day, date) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('miyou_checkins').upsert({
      user_id: identity.id,
      day,
      date,
      task_completed: true,
      task_completed_at: now,
      updated_at: now
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[miyou cloud] task complete save failed', error.message)
  } catch (error) {
    console.warn('[miyou cloud] task complete exception', error)
  }
}

export async function clearCloudDayStatus(day, date) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('miyou_checkins').upsert({
      user_id: identity.id,
      day,
      date,
      signed: false,
      task_completed: false,
      signed_at: null,
      task_completed_at: null,
      updated_at: now
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[miyou cloud] day status clear failed', error.message)
  } catch (error) {
    console.warn('[miyou cloud] day status clear exception', error)
  }
}

export async function loadCloudCheckins(targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { signed: [], completed: [] }
    const userId = targetUserId || identity.id
    const { data, error } = await supabase
      .from('miyou_checkins')
      .select('day,signed,task_completed')
      .eq('user_id', userId)
    if (error) {
      console.warn('[miyou cloud] checkins load failed', error.message)
      return { signed: [], completed: [] }
    }
    return {
      signed: (data || []).filter(row => row.signed).map(row => Number(row.day)).filter(Boolean).sort((a, b) => a - b),
      completed: (data || []).filter(row => row.task_completed).map(row => Number(row.day)).filter(Boolean).sort((a, b) => a - b)
    }
  } catch (error) {
    console.warn('[miyou cloud] checkins load exception', error)
    return { signed: [], completed: [] }
  }
}

export async function markCloudSigned(day, date) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('miyou_checkins').upsert({
      user_id: identity.id,
      day,
      date,
      signed: true,
      signed_at: now,
      updated_at: now
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[miyou cloud] sign save failed', error.message)
  } catch (error) {
    console.warn('[miyou cloud] sign exception', error)
  }
}

export async function loadCloudBackpack(targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return {}
    const userId = targetUserId || identity.id
    const { data, error } = await supabase
      .from('miyou_backpack_items')
      .select('item_id,count')
      .eq('user_id', userId)
    if (error) {
      console.warn('[miyou cloud] backpack load failed', error.message)
      return {}
    }
    return Object.fromEntries((data || []).filter(row => Number(row.count || 0) > 0).map(row => [row.item_id, Number(row.count || 0)]))
  } catch (error) {
    console.warn('[miyou cloud] backpack load exception', error)
    return {}
  }
}

export async function syncCloudBackpack(bag, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const userId = targetUserId || identity.id
    const entries = Object.entries(bag || {}).filter(([, count]) => Number(count || 0) > 0)
    await supabase.from('miyou_backpack_items').delete().eq('user_id', userId)
    if (!entries.length) return
    const { error } = await supabase.from('miyou_backpack_items').insert(entries.map(([itemId, count]) => ({
      user_id: userId,
      item_id: itemId,
      count: Number(count || 0),
      updated_at: new Date().toISOString()
    })))
    if (error) console.warn('[miyou cloud] backpack sync failed', error.message)
  } catch (error) {
    console.warn('[miyou cloud] backpack exception', error)
  }
}

export async function addCloudBackpackItems(items, targetUserId = null) {
  const current = await loadCloudBackpack(targetUserId)
  const next = { ...current }
  ;(items || []).forEach(({ id, count }) => {
    next[id] = Math.max(0, Number(next[id] || 0) + Number(count || 0))
    if (next[id] === 0) delete next[id]
  })
  await syncCloudBackpack(next, targetUserId)
  return next
}

export async function removeCloudBackpackItems(itemIds, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const userId = targetUserId || identity.id
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds]
    const { error } = await supabase.from('miyou_backpack_items').delete().eq('user_id', userId).in('item_id', ids)
    if (error) console.warn('[miyou cloud] backpack item delete failed', error.message)
  } catch (error) {
    console.warn('[miyou cloud] backpack item delete exception', error)
  }
}

export function getLocalJson(key, fallback) {
  return safeJson(localStorage.getItem(key), fallback)
}
