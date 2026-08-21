const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

const FIXED_ROLE_IDS = {
  orange: 'wwcxrl-orange-main',
  pomelo: 'wwcxrl-pomelo-main'
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
    localStorage.setItem('wwcxrl-cloud-role', role)
    return role
  }
  return localStorage.getItem('wwcxrl-cloud-role') || 'pomelo'
}

function getDisplayName(role) {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('name')
  if (fromUrl) return fromUrl
  if (role === 'orange') return '小琛'
  if (role === 'pomelo') return '小琳'
  return '神秘访客'
}

export function getCloudIdentity() {
  if (typeof window === 'undefined') return null
  const role = getRoleFromUrl()
  const id = FIXED_ROLE_IDS[role] || FIXED_ROLE_IDS.pomelo
  localStorage.setItem('wwcxrl-cloud-role', role)
  localStorage.setItem(`wwcxrl-cloud-user-id-${role}`, id)
  return {
    id,
    role,
    displayName: getDisplayName(role),
    deviceLabel: navigator.platform || 'unknown-device'
  }
}

export async function ensureProfile() {
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
  const { error } = await supabase.from('wwcxrl_profiles').upsert(payload, { onConflict: 'id' })
  if (error) console.warn('[wwcxrl cloud] profile upsert failed', error.message)
  return { supabase, identity }
}

export async function logCloudEvent(eventType, detail = {}, day = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const { error } = await supabase.from('wwcxrl_activity_logs').insert({
      user_id: identity.id,
      display_name: identity.displayName,
      role: identity.role,
      event_type: eventType,
      day,
      detail_json: detail || {},
      page_url: window.location.href,
      user_agent: navigator.userAgent
    })
    if (error) console.warn('[wwcxrl cloud] log failed', error.message)
  } catch (error) {
    console.warn('[wwcxrl cloud] log exception', error)
  }
}

export async function saveCloudDayProgress(day, progress, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const { error } = await supabase.from('wwcxrl_day_progress').upsert({
      user_id: targetUserId || identity.id,
      day,
      progress_json: progress,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[wwcxrl cloud] progress save failed', error.message)
  } catch (error) {
    console.warn('[wwcxrl cloud] progress exception', error)
  }
}

export async function loadCloudDayProgress(day, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { progress: null }
    const userId = targetUserId || identity.id
    const { data, error } = await supabase
      .from('wwcxrl_day_progress')
      .select('progress_json,updated_at')
      .eq('user_id', userId)
      .eq('day', day)
      .maybeSingle()
    if (error) {
      console.warn('[wwcxrl cloud] progress load failed', error.message)
      return { progress: null }
    }
    return { progress: data?.progress_json || null, updatedAt: data?.updated_at || '' }
  } catch (error) {
    console.warn('[wwcxrl cloud] progress load exception', error)
    return { progress: null }
  }
}

export async function markCloudTaskCompleted(day, date) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('wwcxrl_checkins').upsert({
      user_id: identity.id,
      day,
      date,
      task_completed: true,
      task_completed_at: now,
      updated_at: now
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[wwcxrl cloud] task complete save failed', error.message)
  } catch (error) {
    console.warn('[wwcxrl cloud] task complete exception', error)
  }
}

export async function clearCloudDayStatus(day, date) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('wwcxrl_checkins').upsert({
      user_id: identity.id,
      day,
      date,
      signed: false,
      task_completed: false,
      signed_at: null,
      task_completed_at: null,
      updated_at: now
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[wwcxrl cloud] day status clear failed', error.message)
  } catch (error) {
    console.warn('[wwcxrl cloud] day status clear exception', error)
  }
}

export async function loadCloudCheckins(targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { signed: [], completed: [] }
    const userId = targetUserId || identity.id
    const { data, error } = await supabase
      .from('wwcxrl_checkins')
      .select('day,signed,task_completed')
      .eq('user_id', userId)
    if (error) {
      console.warn('[wwcxrl cloud] checkins load failed', error.message)
      return { signed: [], completed: [] }
    }
    return {
      signed: (data || []).filter(row => row.signed).map(row => Number(row.day)).filter(Boolean).sort((a, b) => a - b),
      completed: (data || []).filter(row => row.task_completed).map(row => Number(row.day)).filter(Boolean).sort((a, b) => a - b)
    }
  } catch (error) {
    console.warn('[wwcxrl cloud] checkins load exception', error)
    return { signed: [], completed: [] }
  }
}

export async function markCloudSigned(day, date) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('wwcxrl_checkins').upsert({
      user_id: identity.id,
      day,
      date,
      signed: true,
      signed_at: now,
      updated_at: now
    }, { onConflict: 'user_id,day' })
    if (error) console.warn('[wwcxrl cloud] sign save failed', error.message)
  } catch (error) {
    console.warn('[wwcxrl cloud] sign exception', error)
  }
}

export async function loadCloudBackpack(targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return {}
    const userId = targetUserId || identity.id
    const { data, error } = await supabase
      .from('wwcxrl_backpack_items')
      .select('item_id,count')
      .eq('user_id', userId)
    if (error) {
      console.warn('[wwcxrl cloud] backpack load failed', error.message)
      return {}
    }
    return Object.fromEntries((data || []).filter(row => Number(row.count || 0) > 0).map(row => [row.item_id, Number(row.count || 0)]))
  } catch (error) {
    console.warn('[wwcxrl cloud] backpack load exception', error)
    return {}
  }
}

export async function syncCloudBackpack(bag, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const userId = targetUserId || identity.id
    const entries = Object.entries(bag || {}).filter(([, count]) => Number(count || 0) > 0)
    await supabase.from('wwcxrl_backpack_items').delete().eq('user_id', userId)
    if (!entries.length) return
    const { error } = await supabase.from('wwcxrl_backpack_items').insert(entries.map(([itemId, count]) => ({
      user_id: userId,
      item_id: itemId,
      count: Number(count || 0),
      updated_at: new Date().toISOString()
    })))
    if (error) console.warn('[wwcxrl cloud] backpack sync failed', error.message)
  } catch (error) {
    console.warn('[wwcxrl cloud] backpack exception', error)
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
    const { error } = await supabase.from('wwcxrl_backpack_items').delete().eq('user_id', userId).in('item_id', ids)
    if (error) console.warn('[wwcxrl cloud] backpack item delete failed', error.message)
  } catch (error) {
    console.warn('[wwcxrl cloud] backpack item delete exception', error)
  }
}

export function getLocalJson(key, fallback) {
  return safeJson(localStorage.getItem(key), fallback)
}

// ---- 管理页：未来签到任务（wwcxrl_daily_tasks） ----
function normalizeCloudTask(row) {
  return {
    day: Number(row.day),
    date: row.date || '',
    title: row.title || '',
    icon: row.icon || '✨',
    type: row.type || 'memoryPuzzle',
    theme: row.theme || '',
    reward: row.reward || '',
    prompt: row.prompt || '',
    secret: row.secret || '',
    answer: row.answer || '',
    image: row.image || '',
    memoryTitle: row.memory_title || '',
    memoryCaption: row.memory_caption || '',
    chatMessages: Array.isArray(row.chat_messages) ? row.chat_messages : [],
    gameId: row.game_id || '',
    gameConfig: row.game_config || {},
    status: row.status || 'draft',
    updatedAt: row.updated_at || ''
  }
}

export async function loadCloudDailyTasks(status = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return []
    let query = supabase.from('wwcxrl_daily_tasks').select('*')
    if (status) query = query.eq('status', status)
    const { data, error } = await query.order('day', { ascending: true })
    if (error) {
      console.warn('[wwcxrl cloud] daily tasks load failed', error.message)
      return []
    }
    return (data || []).map(normalizeCloudTask)
  } catch (error) {
    console.warn('[wwcxrl cloud] daily tasks load exception', error)
    return []
  }
}

export async function saveCloudDailyTask(task) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return false
    const row = {
      day: Number(task.day),
      date: task.date || '',
      title: task.title || '',
      icon: task.icon || '✨',
      type: task.type || 'memoryPuzzle',
      theme: task.theme || '',
      reward: task.reward || '',
      prompt: task.prompt || '',
      secret: task.secret || '',
      answer: task.answer || '',
      image: task.image || '',
      memory_title: task.memoryTitle || '',
      memory_caption: task.memoryCaption || '',
      chat_messages: Array.isArray(task.chatMessages) ? task.chatMessages : [],
      game_id: task.gameId || '',
      game_config: task.gameConfig || {},
      status: task.status || 'draft',
      created_by: identity.role,
      updated_at: new Date().toISOString()
    }
    const { error } = await supabase.from('wwcxrl_daily_tasks').upsert(row, { onConflict: 'day' })
    if (error) {
      console.warn('[wwcxrl cloud] daily task save failed', error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[wwcxrl cloud] daily task save exception', error)
    return false
  }
}

export async function deleteCloudDailyTask(day) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return false
    const { error } = await supabase.from('wwcxrl_daily_tasks').delete().eq('day', Number(day))
    if (error) {
      console.warn('[wwcxrl cloud] daily task delete failed', error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[wwcxrl cloud] daily task delete exception', error)
    return false
  }
}

// ---- 管理页：任务配图上传（复用 wwcxrl-photos 存储桶） ----
function dataUrlToBlob(dataUrl) {
  const [header, base64] = String(dataUrl).split(',')
  const mime = (header.match(/data:(.*?);/) || [])[1] || 'image/jpeg'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function resizeImageFile(file, maxSide = 1200, quality = 0.84) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const image = new Image()
      image.onerror = reject
      image.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadCloudTaskImage(file, day) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return null
    const dataUrl = await resizeImageFile(file)
    const blob = dataUrlToBlob(dataUrl)
    const safeName = String(file.name || 'task.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40)
    const path = `admin-task-images/day-${Number(day) || 0}-${Date.now()}-${safeName}.jpg`
    const { error: uploadError } = await supabase.storage.from('wwcxrl-photos').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true
    })
    if (uploadError) throw uploadError
    const { data: publicData } = supabase.storage.from('wwcxrl-photos').getPublicUrl(path)
    return publicData.publicUrl
  } catch (error) {
    console.warn('[wwcxrl cloud] task image upload failed', error)
    return null
  }
}


// ============ 贴纸心愿：小琳写心愿，双方可见 ============
export async function saveCloudWish(day, wishText) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return null
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('wwcxrl_wishes')
      .upsert({
        day: Number(day),
        user_id: identity.id,
        wish_text: String(wishText || '').trim(),
        updated_at: now
      }, { onConflict: 'day,user_id' })
      .select('*')
      .single()
    if (error) {
      console.warn('[wwcxrl cloud] wish save failed', error.message)
      return null
    }
    await logCloudEvent('daily_wish_written', { day: Number(day) }, Number(day))
    return { day: data.day, userId: data.user_id, wishText: data.wish_text, updatedAt: data.updated_at }
  } catch (error) {
    console.warn('[wwcxrl cloud] wish save exception', error)
    return null
  }
}

export async function loadCloudWish(day) {
  try {
    const { supabase } = await ensureProfile()
    if (!supabase) return null
    const { data, error } = await supabase
      .from('wwcxrl_wishes')
      .select('day,user_id,wish_text,updated_at')
      .eq('day', Number(day))
      .limit(20)
    if (error) {
      console.warn('[wwcxrl cloud] wish load failed', error.message)
      return null
    }
    const rows = data || []
    const preferred = rows.find(row => row.user_id === 'wwcxrl-pomelo-main') || rows[0] || null
    return preferred ? { day: preferred.day, userId: preferred.user_id, wishText: preferred.wish_text, updatedAt: preferred.updated_at } : null
  } catch (error) {
    console.warn('[wwcxrl cloud] wish load exception', error)
    return null
  }
}

// ============ 异地见面日历（wwcxrl_meeting_dates）：下次见面日期 + 已见面的浪漫日子 ============
function normalizeMeetingRow(row) {
  return {
    kind: row.kind === 'next' ? 'next' : 'past',
    date: row.date || '',
    note: row.note || '',
    emoji: row.emoji || '💕',
    endDate: row.end_date || row.date || ''
  }
}

export async function loadCloudMeetingDates() {
  try {
    const { supabase } = await ensureProfile()
    if (!supabase) return null
    const { data, error } = await supabase
      .from('wwcxrl_meeting_dates')
      .select('kind,date,end_date,note,emoji')
    if (error) {
      console.warn('[wwcxrl cloud] meeting dates load failed', error.message)
      return null
    }
    const rows = (data || []).map(normalizeMeetingRow)
    const nextRow = rows.find(row => row.kind === 'next')
    return {
      next: nextRow ? nextRow.date : '',
      past: rows
        .filter(row => row.kind === 'past' && row.date)
        .map(row => ({ start: row.date, end: row.endDate || row.date, note: row.note, emoji: row.emoji }))
        .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    }
  } catch (error) {
    console.warn('[wwcxrl cloud] meeting dates load exception', error)
    return null
  }
}

export async function saveCloudMeetingDates({ next = '', past = [] }) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { ok: false, error: '未连接云端' }
    // 小数据集：整组重写，避免逐行 upsert 的冲突逻辑
    const { error: deleteError } = await supabase
      .from('wwcxrl_meeting_dates')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (deleteError) {
      console.warn('[wwcxrl cloud] meeting dates delete failed', deleteError.message)
      return { ok: false, error: deleteError.message }
    }
    const rows = []
    if (next) {
      rows.push({ kind: 'next', date: String(next), end_date: '', note: '', emoji: '💕', created_by: identity.role })
    }
    ;(past || []).filter(item => item && (item.start || item.date)).forEach(item => {
      rows.push({
        kind: 'past',
        date: String(item.start || item.date || ''),
        end_date: String(item.end || item.start || item.date || ''),
        note: String(item.note || '').trim(),
        emoji: String(item.emoji || '💕').trim() || '💕',
        created_by: identity.role
      })
    })
    if (!rows.length) return { ok: true, error: '' }
    const { error } = await supabase.from('wwcxrl_meeting_dates').insert(rows)
    if (error) {
      console.warn('[wwcxrl cloud] meeting dates save failed', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true, error: '' }
  } catch (error) {
    console.warn('[wwcxrl cloud] meeting dates save exception', error)
    return { ok: false, error: error.message || '未知错误' }
  }
}

// ============ 留言板（wwcxrl_messages）：异地想对对方说的话 ============
function normalizeMessageRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
    content: row.content,
    imageUrl: row.image_url,
    createdAt: row.created_at
  }
}

export async function loadCloudMessages() {
  try {
    const { supabase } = await ensureProfile()
    if (!supabase) return null
    const { data, error } = await supabase
      .from('wwcxrl_messages')
      .select('id,user_id,role,display_name,content,image_url,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      console.warn('[wwcxrl cloud] messages load failed', error.message)
      return null
    }
    return (data || []).map(normalizeMessageRow)
  } catch (error) {
    console.warn('[wwcxrl cloud] messages load exception', error)
    return null
  }
}

export async function saveCloudMessage({ content = '', imageUrl = '' }) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { ok: false, error: '未连接云端' }
    const { data, error } = await supabase
      .from('wwcxrl_messages')
      .insert({
        user_id: identity.id,
        role: identity.role,
        display_name: String(identity.displayName || ''),
        content: String(content || '').trim(),
        image_url: String(imageUrl || '')
      })
      .select('id,user_id,role,display_name,content,image_url,created_at')
      .single()
    if (error) {
      console.warn('[wwcxrl cloud] message save failed', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true, message: normalizeMessageRow(data) }
  } catch (error) {
    console.warn('[wwcxrl cloud] message save exception', error)
    return { ok: false, error: error.message || '未知错误' }
  }
}

export async function deleteCloudMessage(id) {
  try {
    const { supabase } = await ensureProfile()
    if (!supabase || !id) return false
    const { error } = await supabase.from('wwcxrl_messages').delete().eq('id', id)
    if (error) {
      console.warn('[wwcxrl cloud] message delete failed', error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[wwcxrl cloud] message delete exception', error)
    return false
  }
}

export async function uploadMessageImage(file) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { ok: false, error: '未连接云端' }
    const dataUrl = await resizeImageFile(file)
    const blob = dataUrlToBlob(dataUrl)
    const safeName = String(file.name || 'message.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40)
    const path = `message-images/${identity.role}-${Date.now()}-${safeName}.jpg`
    const { error: uploadError } = await supabase.storage.from('wwcxrl-photos').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true
    })
    if (uploadError) throw uploadError
    const { data: publicData } = supabase.storage.from('wwcxrl-photos').getPublicUrl(path)
    return { ok: true, url: publicData.publicUrl }
  } catch (error) {
    console.warn('[wwcxrl cloud] message image upload failed', error)
    return { ok: false, error: error.message || '图片上传失败' }
  }
}

// ============ 更新日志（wwcxrl_changelog）：管理端可编辑 ============
function normalizeChangelogRow(row) {
  return {
    id: row.id,
    version: row.version,
    date: row.date || '',
    title: row.title || '',
    notes: Array.isArray(row.notes) ? row.notes.map(String) : [],
    sort: Number(row.sort || 0)
  }
}

export async function loadCloudChangelog() {
  try {
    const { supabase } = await ensureProfile()
    if (!supabase) return null
    const { data, error } = await supabase
      .from('wwcxrl_changelog')
      .select('id,version,date,title,notes,sort')
      .order('sort', { ascending: true })
    if (error) {
      console.warn('[wwcxrl cloud] changelog load failed', error.message)
      return null
    }
    return (data || []).map(normalizeChangelogRow)
  } catch (error) {
    console.warn('[wwcxrl cloud] changelog load exception', error)
    return null
  }
}

export async function saveCloudChangelog(entries) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { ok: false, error: '未连接云端' }
    await supabase.from('wwcxrl_changelog').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    const rows = (entries || []).filter(item => item && String(item.version || '').trim()).map((item, index) => ({
      version: String(item.version || '').trim(),
      date: String(item.date || '').trim(),
      title: String(item.title || '').trim(),
      notes: Array.isArray(item.notes) ? item.notes.map(String).filter(Boolean) : [],
      sort: index
    }))
    if (!rows.length) return { ok: true, error: '' }
    const { error } = await supabase.from('wwcxrl_changelog').insert(rows)
    if (error) {
      console.warn('[wwcxrl cloud] changelog save failed', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true, error: '' }
  } catch (error) {
    console.warn('[wwcxrl cloud] changelog save exception', error)
    return { ok: false, error: error.message || '未知错误' }
  }
}
