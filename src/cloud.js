import { installStorageGuard, safeGetItem, safeSetItem } from './safeStorage'

// 尽早装上存储保护：Safari 阻止 Cookie / 存储写满时，下面这些读写会抛异常，
// 一抛就会把调用它的 React 渲染一起带崩。
installStorageGuard()

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// 已经验证过的线路最多等 10 秒；失败后页面仍可继续使用本地缓存。
const CLOUD_REQUEST_TIMEOUT_MS = 10000
// 读取请求先走首选线路；700ms 还没结果就并发启动备用线路，避免串行超时。
const CLOUD_HEDGE_DELAY_MS = 700
// 线路是会随网络、代理节点和运营商变化的，只短期记住胜出的线路。
const CLOUD_TRANSPORT_TTL_MS = 15 * 60 * 1000
// v3 改为短期自适应 + 并发竞速，主动丢弃旧版永久保存的线路选择。
const CLOUD_TRANSPORT_KEY = 'wwcxrl-cloud-transport-v3'
const CLOUD_PROXY_PREFIX = '/sb'
// 只有幂等的读取才允许自动换线路重试：写请求若在服务端已经落库、只是响应丢了，
// 重试会造成重复插入，宁可让它按原来的方式失败。
const CLOUD_RETRYABLE_METHODS = new Set(['GET', 'HEAD'])

const FIXED_ROLE_IDS = {
  orange: 'wwcxrl-orange-main',
  pomelo: 'wwcxrl-pomelo-main'
}

// 两个人的签到、背包、相册本来就是同一份，所以不再按设备区分「数据归属」。
// 固定使用数据所在的那个身份：网页、手机、换浏览器、清缓存，看到的都是同一份。
// （历史上曾用网址参数 ?user=orange|pomelo 切换设备身份，那正是「换台电脑就看不到记录」的原因。）
const SHARED_ROLE = 'pomelo'
const SHARED_USER_ID = FIXED_ROLE_IDS[SHARED_ROLE]

// 留言/评论的署名仍是可切换的，且属于「这台设备」的偏好，与数据归属无关。
const MESSAGE_SENDER_KEY = 'wwcxrl-message-sender-role'

// 网址里的 ?user= 不再决定数据归属，只用来记住「我发留言时署名是谁」。
// 这样旧书签里的 ?user=orange 从「看到空数据」变成「署名是小琛」，不再有害。
if (typeof window !== 'undefined') {
  try {
    const params = new URLSearchParams(window.location.search)
    const sender = params.get('user') || params.get('role')
    if (sender === 'orange' || sender === 'pomelo') safeSetItem(MESSAGE_SENDER_KEY, sender)
  } catch {}
}

export const cloudEnabled = Boolean(supabaseUrl && supabaseKey)

let supabasePromise = null

// ---- 云端线路：直连 supabase.co，或走站点自己的域名（/sb/* 由 vercel.json 转发） ----
// 站点域名是唯一被证明「一定能访问」的地址：能打开网页就说明它通。
// 因此当 supabase.co 直连不通时，改走同域代理就能把数据救回来。
function canUseSameOriginProxy() {
  if (!cloudEnabled || !supabaseUrl || typeof window === 'undefined') return false
  const host = window.location.hostname
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false
  // 本地 vite dev 没有 vercel.json 的转发规则，走了只会拿到 404。
  return true
}

function readSavedTransport() {
  if (!canUseSameOriginProxy()) return 'direct'
  try {
    const saved = JSON.parse(safeGetItem(CLOUD_TRANSPORT_KEY, 'null'))
    if (saved && (saved.mode === 'direct' || saved.mode === 'proxy') && Number(saved.expiresAt) > Date.now()) {
      return saved.mode
    }
  } catch {}
  return 'direct'
}

let cloudTransport = readSavedTransport()

function useSameOriginProxy(rawUrl) {
  if (typeof rawUrl !== 'string' || !supabaseUrl) return rawUrl
  if (rawUrl.indexOf(supabaseUrl) !== 0) return rawUrl
  return `${window.location.origin}${CLOUD_PROXY_PREFIX}${rawUrl.slice(supabaseUrl.length)}`
}

function rememberTransport(next) {
  cloudTransport = next
  safeSetItem(CLOUD_TRANSPORT_KEY, JSON.stringify({
    mode: next,
    expiresAt: Date.now() + CLOUD_TRANSPORT_TTL_MS
  }))
}

// 图片是浏览器直接向 supabase.co 取的，不走上面的请求出口。
// 如果数据换了线路、图片还指向原地址，就会出现“数据有了、图全是裂的”，所以一并改写。
export function resolveCloudAssetUrl(url) {
  if (typeof url !== 'string' || !url) return url
  if (!canUseSameOriginProxy() || cloudTransport !== 'proxy') return url
  if (url.indexOf(supabaseUrl) !== 0) return url
  return `${window.location.origin}${CLOUD_PROXY_PREFIX}${url.slice(supabaseUrl.length)}`
}

// 写回数据库前还原成 Supabase 原始地址，避免把站点域名写进数据里。
export function toCanonicalCloudUrl(url) {
  if (typeof url !== 'string' || !url) return url
  if (typeof window === 'undefined' || !supabaseUrl) return url
  const prefix = `${window.location.origin}${CLOUD_PROXY_PREFIX}`
  if (url.indexOf(prefix) !== 0) return url
  return `${supabaseUrl}${url.slice(prefix.length)}`
}

// 夜读的图集藏在 gameConfig 里，一起处理，保证图片和数据走同一条线路。
function mapCloudAssetUrls(gameConfig, mapper) {
  if (!gameConfig || typeof gameConfig !== 'object') return gameConfig
  const blocks = Array.isArray(gameConfig.blocks) ? gameConfig.blocks : null
  const gallery = Array.isArray(gameConfig.gallery) ? gameConfig.gallery : null
  if (!blocks && !gallery) return gameConfig
  const next = { ...gameConfig }
  if (blocks) {
    next.blocks = blocks.map(block => (block && typeof block === 'object' && block.url) ? { ...block, url: mapper(block.url) } : block)
  }
  if (gallery) {
    next.gallery = gallery.map(item => (typeof item === 'string' ? mapper(item) : item))
  }
  return next
}

// ---- 云端连接状态 ----
// 只有连续失败到一定次数才广播“连不上”，避免一次网络抖动就冒提示；
// 任意一次成功立刻恢复。连接正常时不会广播任何东西，页面完全无感。
const CLOUD_DOWN_THRESHOLD = 3

let cloudFailureStreak = 0
let cloudStatus = 'unknown'

function setCloudStatus(next) {
  if (cloudStatus === next) return
  cloudStatus = next
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('wwcxrl-cloud-status', { detail: { state: next, failures: cloudFailureStreak } }))
  } catch {}
}

function noteCloudReachable() {
  cloudFailureStreak = 0
  setCloudStatus('ok')
}

function noteCloudUnreachable() {
  cloudFailureStreak += 1
  if (cloudFailureStreak >= CLOUD_DOWN_THRESHOLD) setCloudStatus('down')
}

// 5xx 说明服务端本身出了问题，对用户来说同样是“数据拿不到”，一并计入。
function noteCloudResponse(response) {
  if (response && Number(response.status) >= 500) noteCloudUnreachable()
  else noteCloudReachable()
  return response
}

export function getCloudStatus() {
  return cloudStatus
}

function fetchOnce(input, init = {}, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS) {
  if (typeof window === 'undefined' || typeof AbortController === 'undefined') {
    return fetch(input, init)
  }
  const controller = new AbortController()
  const externalSignal = init && init.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromExternal()
  else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true })
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const { signal: _signal, ...rest } = init || {}
  return fetch(input, { ...rest, signal: controller.signal })
    .finally(() => {
      window.clearTimeout(timer)
      externalSignal?.removeEventListener?.('abort', abortFromExternal)
    })
}

function requestMethod(init) {
  return String((init || {}).method || 'GET').toUpperCase()
}

// 万一线上还没有 /sb/* 的转发规则（例如客户端先上线、配置还没生效），
// 请求会落到 Vercel 的 404 页而不是 Supabase。这种情况不能把线路记成“代理可用”。
function looksLikeProxyMiss(response) {
  if (!response || Number(response.status) !== 404) return false
  const type = String((response.headers && response.headers.get && response.headers.get('content-type')) || '').toLowerCase()
  return !type.includes('application/json')
}

function cloudCandidateUrl(rawUrl, mode) {
  return mode === 'proxy' ? useSameOriginProxy(rawUrl) : rawUrl
}

async function fetchCloudCandidate(rawUrl, init, mode, controller) {
  const response = await fetchOnce(cloudCandidateUrl(rawUrl, mode), { ...init, signal: controller.signal })
  if (mode === 'proxy' && looksLikeProxyMiss(response)) {
    throw new Error('[wwcxrl cloud] same-origin proxy unavailable')
  }
  // 5xx 表示这条线路暂时没有给出可用结果，让另一条线路继续争胜。
  if (Number(response.status) >= 500) {
    throw new Error(`[wwcxrl cloud] ${mode} returned ${response.status}`)
  }
  return { response, mode }
}

// 幂等读取使用“快乐眼球”式竞速：先发首选线路，700ms 未完成再发备用线路，
// 第一条成功响应胜出并取消另一条。比“等 6 秒再换线”更适合移动网络和代理切换。
async function hedgedCloudRead(rawUrl, init, preferredMode) {
  const secondaryMode = preferredMode === 'proxy' ? 'direct' : 'proxy'
  const primaryController = new AbortController()
  const secondaryController = new AbortController()
  let secondaryStarted = false
  let startSecondary
  let hedgeTimer = null
  let winnerMode = null

  const secondaryPromise = new Promise((resolve, reject) => {
    startSecondary = () => {
      if (secondaryStarted) return
      secondaryStarted = true
      fetchCloudCandidate(rawUrl, init, secondaryMode, secondaryController).then(resolve, reject)
    }
    hedgeTimer = window.setTimeout(startSecondary, CLOUD_HEDGE_DELAY_MS)
  })

  const primaryPromise = fetchCloudCandidate(rawUrl, init, preferredMode, primaryController)
    .catch(error => {
      startSecondary()
      throw error
    })

  try {
    const winner = await Promise.any([primaryPromise, secondaryPromise])
    winnerMode = winner.mode
    rememberTransport(winner.mode)
    return noteCloudResponse(winner.response)
  } catch (error) {
    noteCloudUnreachable()
    throw error
  } finally {
    if (hedgeTimer !== null) window.clearTimeout(hedgeTimer)
    // Response 返回后 Supabase 还要读取 body，不能中止胜出线路，只取消落后者。
    if (!winnerMode || winnerMode !== preferredMode) primaryController.abort()
    if (!winnerMode || winnerMode !== secondaryMode) secondaryController.abort()
  }
}

// 所有云端请求的出口。只对幂等读取做双线路竞速；写请求始终只提交一次，
// 避免服务端已落库但响应丢失时产生重复数据。
async function cloudFetch(input, init = {}) {
  const rawUrl = typeof input === 'string' ? input : String((input && input.url) || '')
  const proxyAvailable = canUseSameOriginProxy() && Boolean(supabaseUrl) && rawUrl.indexOf(supabaseUrl) === 0
  const retryable = proxyAvailable && CLOUD_RETRYABLE_METHODS.has(requestMethod(init))
  if (retryable) return hedgedCloudRead(rawUrl, init, cloudTransport)

  const writeMode = proxyAvailable ? cloudTransport : 'direct'
  try {
    const response = await fetchOnce(cloudCandidateUrl(rawUrl, writeMode), init)
    return noteCloudResponse(response)
  } catch (error) {
    noteCloudUnreachable()
    throw error
  }
}

export function getCloudTransport() {
  return cloudTransport
}

export async function getSupabase() {
  if (!cloudEnabled) return null
  if (!supabasePromise) {
    supabasePromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: cloudFetch }
    }))
  }
  return supabasePromise
}

// 只读操作共用的云端上下文：不再像 ensureProfile 那样每次先 upsert 档案，
// 避免慢网络下每个查询都多一次往返（这是“加载很久才出数据”的主要原因之一）。
export async function getCloudContext() {
  const supabase = await getSupabase()
  const identity = getCloudIdentity()
  if (!supabase || !identity) return null
  return { supabase, identity }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback))
  } catch {
    return fallback
  }
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
  // 只在值不对时才写，避免每次读取都产生一次存储写入。
  if (safeGetItem('wwcxrl-cloud-role') !== SHARED_ROLE) safeSetItem('wwcxrl-cloud-role', SHARED_ROLE)
  const userIdKey = `wwcxrl-cloud-user-id-${SHARED_ROLE}`
  if (safeGetItem(userIdKey) !== SHARED_USER_ID) safeSetItem(userIdKey, SHARED_USER_ID)
  return {
    id: SHARED_USER_ID,
    role: SHARED_ROLE,
    displayName: getDisplayName(SHARED_ROLE),
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
    const context = await getCloudContext()
    if (!context) return { progress: null }
    const { supabase, identity } = context
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

export async function clearCloudDayStatus(day, date, targetUserId = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return
    const now = new Date().toISOString()
    const userId = targetUserId || identity.id
    const { error } = await supabase.from('wwcxrl_checkins').upsert({
      user_id: userId,
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
    const context = await getCloudContext()
    if (!context) return { signed: [], completed: [] }
    const { supabase, identity } = context
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
    const context = await getCloudContext()
    if (!context) return {}
    const { supabase, identity } = context
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
  return safeJson(safeGetItem(key), fallback)
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
      image: resolveCloudAssetUrl(row.image),
      memoryTitle: row.memory_title || '',
      memoryCaption: row.memory_caption || '',
      chatMessages: Array.isArray(row.chat_messages) ? row.chat_messages : [],
      gameId: row.game_id || '',
      gameConfig: mapCloudAssetUrls(row.game_config || {}, resolveCloudAssetUrl),
    status: row.status || 'draft',
    updatedAt: row.updated_at || ''
  }
}

export async function loadCloudDailyTasks(status = null) {
  try {
    const supabase = await getSupabase()
    if (!supabase) return []
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
      image: toCanonicalCloudUrl(task.image) || '',
      memory_title: task.memoryTitle || '',
      memory_caption: task.memoryCaption || '',
      chat_messages: Array.isArray(task.chatMessages) ? task.chatMessages : [],
      game_id: task.gameId || '',
      game_config: mapCloudAssetUrls(task.gameConfig || {}, toCanonicalCloudUrl),
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

// 选图时先用同一套规则压一遍：本地模式的数据全存在 localStorage 里，
// 原图直接塞进去很容易把存储写满（之后所有读写都会失败）。
export function compressImageFile(file, maxSide = 1200, quality = 0.84) {
  return resizeImageFile(file, maxSide, quality)
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
    const supabase = await getSupabase()
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
    const supabase = await getSupabase()
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
// 多图存在 image_urls(jsonb)；线上库若还没执行多图 SQL，下面的读写会自动退回 image_url 单图，
// 保证“留言板整块打不开”这种事不会发生。
const MESSAGE_COLUMNS_LEGACY = 'id,user_id,role,display_name,content,image_url,parent_id,created_at'
const MESSAGE_COLUMNS = 'id,user_id,role,display_name,content,image_url,image_urls,parent_id,created_at'
const MESSAGE_MAX_IMAGES = 9
const MESSAGE_MULTI_IMAGE_HINT = '这条带了多张照片，但线上库还没开启多图字段。请在 Supabase SQL Editor 执行 image_urls 那一句 SQL，然后再发一次。'

// null = 还没探测过；true/false = 线上库是否已支持 image_urls
let messageMultiImageSupported = null

export function isMessageMultiImageReady() {
  return messageMultiImageSupported !== false
}

// PostgREST 在“列不存在”时会给 42703 / PGRST204，并把列名写进 message，
// 这里统一识别，避免把可降级的问题报成“留言加载失败”。
function isMissingMessageImageColumn(error) {
  if (!error) return false
  const text = `${error.code || ''} ${error.message || ''} ${error.details || ''} ${error.hint || ''}`
  return text.includes('image_urls') || text.includes('42703') || text.includes('PGRST204')
}

function parseImageUrlList(raw) {
  const list = []
  const push = value => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (text) list.push(text)
  }
  if (Array.isArray(raw)) raw.forEach(push)
  else if (typeof raw === 'string' && raw.trim().charAt(0) === '[') {
    // 兜底形态：有人把数组当字符串存了。解析失败就按单张图处理。
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) parsed.forEach(push)
      else push(raw)
    } catch {
      push(raw)
    }
  } else push(raw)
  return list
}

function uniqueImageUrls(list = []) {
  return list.filter((url, index) => list.indexOf(url) === index)
}

// 读：image_urls 优先，image_url 兜底；两种都归一成 images 数组，渲染层只认 images。
function normalizeMessageRow(row) {
  const canonical = parseImageUrlList(row.image_urls).map(url => toCanonicalCloudUrl(url))
  const legacy = parseImageUrlList(row.image_url).map(url => toCanonicalCloudUrl(url))
  const images = uniqueImageUrls([...canonical, ...legacy])
    .slice(0, MESSAGE_MAX_IMAGES)
    .map(url => resolveCloudAssetUrl(url))
    .filter(Boolean)
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
    content: row.content,
    images,
    imageUrl: images[0] || '',
    parentId: row.parent_id || null,
    createdAt: row.created_at
  }
}

function normalizeOutgoingImageUrls({ imageUrl = '', imageUrls = null }) {
  const raw = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : [])
  return uniqueImageUrls([...raw, imageUrl].map(url => toCanonicalCloudUrl(url)).filter(Boolean))
    .slice(0, MESSAGE_MAX_IMAGES)
}

function messagePayload({ content = '', imageUrls = [] }) {
  const list = imageUrls.slice(0, MESSAGE_MAX_IMAGES)
  return {
    content: String(content || '').trim(),
    // image_url 保留第一张：老客户端、老代码、SQL 直查都还能看到一张图。
    image_url: list[0] || '',
    image_urls: list
  }
}

function messagePayloadLegacy({ content = '', imageUrls = [] }) {
  return {
    content: String(content || '').trim(),
    image_url: imageUrls[0] || ''
  }
}

export async function loadCloudMessages() {
  try {
    const supabase = await getSupabase()
    if (!supabase) return null
    const runQuery = columns => supabase
      .from('wwcxrl_messages')
      .select(columns)
      .order('created_at', { ascending: false })
      .limit(500)
    let { data, error } = await runQuery(MESSAGE_COLUMNS)
    if (error && isMissingMessageImageColumn(error)) {
      messageMultiImageSupported = false
      ;({ data, error } = await runQuery(MESSAGE_COLUMNS_LEGACY))
    } else if (!error) {
      messageMultiImageSupported = true
    }
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

export async function saveCloudMessage({ content = '', imageUrl = '', imageUrls = null, parentId = null }, sender = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { ok: false, error: '未连接云端' }
    const role = sender?.role || identity.role
    const userId = sender?.userId || identity.id
    // name 是调用方常用的写法，这里一并接受：漏传时不能悄悄回退成设备身份的名字，
    // 否则会出现「角色是小琛、署名却写成小琳」的错行。
    const displayName = sender?.displayName || sender?.name || identity.displayName
    const list = normalizeOutgoingImageUrls({ imageUrl, imageUrls })
    if (list.length > 1 && messageMultiImageSupported === false) {
      return { ok: false, error: MESSAGE_MULTI_IMAGE_HINT }
    }
    const base = {
      user_id: userId,
      role,
      display_name: String(displayName || ''),
      parent_id: parentId || null
    }
    let { data, error } = await supabase
      .from('wwcxrl_messages')
      .insert({
        ...base,
        ...messagePayload({ content, imageUrls: list })
      })
      .select(MESSAGE_COLUMNS)
      .single()
    if (error && isMissingMessageImageColumn(error)) {
      messageMultiImageSupported = false
      if (list.length > 1) return { ok: false, error: MESSAGE_MULTI_IMAGE_HINT }
      ;({ data, error } = await supabase
        .from('wwcxrl_messages')
        .insert({
          ...base,
          ...messagePayloadLegacy({ content, imageUrls: list })
        })
        .select(MESSAGE_COLUMNS_LEGACY)
        .single())
    }
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

async function loadCloudMessageById(id) {
  try {
    const supabase = await getSupabase()
    if (!supabase || !id) return null
    let { data, error } = await supabase
      .from('wwcxrl_messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (error && isMissingMessageImageColumn(error)) {
      ;({ data, error } = await supabase
        .from('wwcxrl_messages')
        .select(MESSAGE_COLUMNS_LEGACY)
        .eq('id', id)
        .maybeSingle())
    }
    if (error || !data) return null
    return normalizeMessageRow(data)
  } catch (error) {
    console.warn('[wwcxrl cloud] message load-by-id failed', error.message)
    return null
  }
}

export async function updateCloudMessage(id, { content = '', imageUrl = '', imageUrls = null }) {
  try {
    const supabase = await getSupabase()
    if (!supabase || !id) return { ok: false, error: '未连接云端' }
    const list = normalizeOutgoingImageUrls({ imageUrl, imageUrls })
    if (list.length > 1 && messageMultiImageSupported === false) {
      return { ok: false, error: MESSAGE_MULTI_IMAGE_HINT }
    }
    const runUpdate = (payload, columns) => supabase
      .from('wwcxrl_messages')
      .update(payload)
      .eq('id', id)
      .select(columns)
      .maybeSingle()
    let { data, error } = await runUpdate(messagePayload({ content, imageUrls: list }), MESSAGE_COLUMNS)
    if (error && isMissingMessageImageColumn(error)) {
      messageMultiImageSupported = false
      if (list.length > 1) return { ok: false, error: MESSAGE_MULTI_IMAGE_HINT }
      ;({ data, error } = await runUpdate(messagePayloadLegacy({ content, imageUrls: list }), MESSAGE_COLUMNS_LEGACY))
    }
    if (!error && data) return { ok: true, message: normalizeMessageRow(data) }
    // 老库可能缺少 update 策略：改用“删除旧行 + 原样重插”兜底（保留发送人与时间），
    // 这样即使不改 Supabase 策略，修改也能真正写进云端，而不是刷新后消失。
    console.warn('[wwcxrl cloud] message update blocked, trying replace fallback', error?.message || 'no row matched')
    const original = await loadCloudMessageById(id)
    if (!original) return { ok: false, error: error?.message || '未找到这条留言' }
    const { error: deleteError } = await supabase.from('wwcxrl_messages').delete().eq('id', id)
    if (deleteError) return { ok: false, error: deleteError.message }
    // 重插沿用原 id：这条留言下面的所有回复仍然挂在同一个 parent_id 上，不会掉。
    const fallbackBase = {
      id: original.id,
      user_id: original.userId,
      role: original.role,
      display_name: original.displayName,
      parent_id: original.parentId,
      created_at: original.createdAt
    }
    let { data: inserted, error: insertError } = await supabase
      .from('wwcxrl_messages')
      .insert({
        ...fallbackBase,
        ...messagePayload({ content, imageUrls: list })
      })
      .select(MESSAGE_COLUMNS)
      .single()
    if (insertError && isMissingMessageImageColumn(insertError)) {
      ;({ data: inserted, error: insertError } = await supabase
        .from('wwcxrl_messages')
        .insert({
          ...fallbackBase,
          ...messagePayloadLegacy({ content, imageUrls: list })
        })
        .select(MESSAGE_COLUMNS_LEGACY)
        .single())
    }
    if (insertError) return { ok: false, error: insertError.message }
    return { ok: true, message: normalizeMessageRow(inserted) }
  } catch (error) {
    console.warn('[wwcxrl cloud] message update exception', error)
    return { ok: false, error: error.message || '未知错误' }
  }
}

export async function deleteCloudMessage(id) {
  try {
    const { supabase } = await ensureProfile()
    if (!supabase || !id) return false
    // 楼中楼可以有多级：先把这条以及它下面所有层级的回复收集出来，再一起删除，
    // 否则删掉中间某一层，更深的回复就会变成孤儿。
    let descendantIds = []
    const { data: rows, error: rowsError } = await supabase
      .from('wwcxrl_messages')
      .select('id,parent_id')
      .limit(5000)
    if (!rowsError && Array.isArray(rows)) {
      const childrenByParent = new Map()
      rows.forEach(row => {
        if (!row.parent_id || row.id === id) return
        const list = childrenByParent.get(row.parent_id) || []
        list.push(row.id)
        childrenByParent.set(row.parent_id, list)
      })
      const seen = new Set([id])
      const queue = [id]
      while (queue.length && descendantIds.length < 2000) {
        const current = queue.shift()
        ;(childrenByParent.get(current) || []).forEach(childId => {
          if (seen.has(childId)) return
          seen.add(childId)
          descendantIds.push(childId)
          queue.push(childId)
        })
      }
    } else {
      // 拿不到全量关系时退回「至少删掉直接子级」，比留下孤儿好。
      const { data: direct, error: directError } = await supabase
        .from('wwcxrl_messages')
        .select('id')
        .eq('parent_id', id)
        .limit(1000)
      if (directError) console.warn('[wwcxrl cloud] message children load failed', directError.message)
      descendantIds = (direct || []).map(row => row.id)
    }
    const chunkSize = 100
    for (let index = 0; index < descendantIds.length; index += chunkSize) {
      const chunk = descendantIds.slice(index, index + chunkSize)
      const { error: childDeleteError } = await supabase
        .from('wwcxrl_messages')
        .delete()
        .in('id', chunk)
      if (childDeleteError) console.warn('[wwcxrl cloud] message children delete failed', childDeleteError.message)
    }
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

export async function uploadMessageImage(file, role = null) {
  try {
    const { supabase, identity } = await ensureProfile()
    if (!supabase || !identity) return { ok: false, error: '未连接云端' }
    const dataUrl = await resizeImageFile(file)
    const blob = dataUrlToBlob(dataUrl)
    const safeName = String(file.name || 'message.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40)
    // 多图是连续上传，同一毫秒内可能出现同名文件，这里加随机后缀避免互相覆盖。
    const unique = Math.random().toString(36).slice(2, 8)
    const path = `message-images/${role || identity.role}-${Date.now()}-${unique}-${safeName}.jpg`
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

// 一次上传多张：逐张进行，失败时明确告诉用户是第几张出的问题，
// 已经传成功的图片地址一并返回，方便上层决定是否继续保存文字。
export async function uploadMessageImages(files, role = null) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean)
  if (!list.length) return { ok: true, urls: [] }
  const urls = []
  for (let index = 0; index < list.length; index += 1) {
    const result = await uploadMessageImage(list[index], role)
    if (!result?.ok) {
      return { ok: false, error: `第 ${index + 1} 张照片上传失败：${result?.error || '请稍后再试。'}`, urls }
    }
    urls.push(result.url)
  }
  return { ok: true, urls }
}

// ============ 网站建议箱（wwcxrl_feedback）：给小琳/小琛提网站建设建议 ============
function normalizeFeedbackRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
    content: row.content,
    createdAt: row.created_at
  }
}

export async function loadCloudFeedback() {
  try {
    const supabase = await getSupabase()
    if (!supabase) return null
    const { data, error } = await supabase
      .from('wwcxrl_feedback')
      .select('id,user_id,role,display_name,content,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      console.warn('[wwcxrl cloud] feedback load failed', error.message)
      return null
    }
    return (data || []).map(normalizeFeedbackRow)
  } catch (error) {
    console.warn('[wwcxrl cloud] feedback load exception', error)
    return null
  }
}

export async function saveCloudFeedback({ content = '' }, sender = null) {
  try {
    const context = await getCloudContext()
    if (!context) return { ok: false, error: '未连接云端' }
    const { supabase, identity } = context
    const role = sender?.role || identity.role
    const userId = sender?.userId || identity.id
    const displayName = sender?.displayName || identity.displayName
    const { data, error } = await supabase
      .from('wwcxrl_feedback')
      .insert({
        user_id: userId,
        role,
        display_name: String(displayName || ''),
        content: String(content || '').trim()
      })
      .select('id,user_id,role,display_name,content,created_at')
      .single()
    if (error) {
      console.warn('[wwcxrl cloud] feedback save failed', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true, message: normalizeFeedbackRow(data) }
  } catch (error) {
    console.warn('[wwcxrl cloud] feedback save exception', error)
    return { ok: false, error: error.message || '未知错误' }
  }
}

export async function deleteCloudFeedback(id) {
  try {
    const supabase = await getSupabase()
    if (!supabase || !id) return false
    const { error } = await supabase.from('wwcxrl_feedback').delete().eq('id', id)
    if (error) {
      console.warn('[wwcxrl cloud] feedback delete failed', error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[wwcxrl cloud] feedback delete exception', error)
    return false
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
    const supabase = await getSupabase()
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
