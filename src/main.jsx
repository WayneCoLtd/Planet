import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { timeline, loveNotes, wishes, dailyAdventures } from './data/loveData'
import { cloudEnabled, getSupabase, getCloudIdentity, ensureProfile, logCloudEvent, loadCloudCheckins, markCloudSigned, markCloudTaskCompleted, clearCloudDayStatus, saveCloudDayProgress, syncCloudBackpack, loadCloudBackpack, addCloudBackpackItems, removeCloudBackpackItems, loadCloudDailyTasks, saveCloudDailyTask, deleteCloudDailyTask, uploadCloudTaskImage, loadCloudWish, saveCloudWish, loadCloudMeetingDates, saveCloudMeetingDates } from './cloud'
import './styles.css'

const PASSWORD = '5201013'
const ANNIVERSARY_VIDEO_SRC = '/videos/wwcxrl-1013-anniversary-v5.mp4'
const ANNIVERSARY_GIFT_PHOTO_SRC = '/images/wwcxrl-1013-gift-photo.jpg'
const TEMPLATE_REFERENCE_VERSION = 'wwcxrl-template-selected-days-direct-maze-v2'
const TEMPLATE_FIRST_DAY = dailyAdventures[0]?.day || 1
const TEMPLATE_LAST_DAY = dailyAdventures[dailyAdventures.length - 1]?.day || 8
const TEMPLATE_THEME_SWITCH_DAY = 5
const START_DATE = new Date(`${dailyAdventures[0]?.date || '2026-05-20'}T00:00:00`)

// 1013 纪念日锚点：2025-10-13 是第 0 天，2026-10-13 是一周年（第 365 天）。
const ANNIVERSARY_START_DATE = '2025-10-13'
const ANNIVERSARY_YEAR_ONE_DATE = '2026-10-13'
const DAY_MS = 24 * 60 * 60 * 1000

function getAnniversaryCounts() {
  const today = new Date(`${getTodayKey()}T00:00:00`)
  const start = new Date(`${ANNIVERSARY_START_DATE}T00:00:00`)
  const yearOne = new Date(`${ANNIVERSARY_YEAR_ONE_DATE}T00:00:00`)
  const dayCount = Math.max(0, Math.round((today.getTime() - start.getTime()) / DAY_MS))
  const daysToYearOne = Math.max(0, Math.ceil((yearOne.getTime() - today.getTime()) / DAY_MS))
  const yearOneReached = today.getTime() >= yearOne.getTime()
  return { dayCount, daysToYearOne, yearOneReached }
}
const END_DATE = new Date(`${dailyAdventures[dailyAdventures.length - 1]?.date || '2026-05-24'}T23:59:59`)

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'wwcxrl-admin-2026'
const ADMIN_TASK_TYPES = [
  { id: 'memoryPuzzle', label: '谜语签到（推荐）', hint: '输入谜底答案，答对后自动亮起签到' },
  { id: 'letter', label: '一封信', hint: '她先拆开信封，读完点“我读完啦”后完成签到' },
  { id: 'fortune', label: '砸金蛋', hint: '点一下金蛋，敲出今日的小奖励（奖品池可自定义），敲完即完成签到' },
  { id: 'sticker', label: '贴纸 / 心愿', hint: '小琳写下当天心愿，写好后自动签到，小琛这边也能看到' },
  { id: 'game', label: '小游戏', hint: '选择一款内置小游戏（迷宫/接爱心/戳泡泡/翻牌/拼图/三消/喂食/打地鼠/樱花拼图，以及鱼了个鱼/人生重开模拟器/五子棋/换装/矿工/气球/馅饼/砌砖/贪吃蛇/笑脸/弹力球等嵌入小游戏），玩完即可签到' }
]

// 云端任务优先、代码 dailyAdventures 兜底的合并任务列表（按 day 去重排序）。
let mergedDailyAdventures = null

function getDailyAdventures() {
  return mergedDailyAdventures || dailyAdventures
}

async function hydrateDailyAdventures() {
  const cloudTasks = await loadCloudDailyTasks('published')
  const merged = new Map()
  dailyAdventures.forEach(item => merged.set(Number(item.day), item))
  cloudTasks.forEach(item => merged.set(Number(item.day), item))
  // 本地模式（未配置 Supabase 环境变量）：把管理页本地发布的任务也并入，
  // 这样在本地验证「管理页发布 → 主签到页可见」的完整流程。
  if (!cloudEnabled) {
    loadLocalAdminTasks()
      .filter(task => task.status === 'published')
      .forEach(item => merged.set(Number(item.day), item))
  }
  const next = Array.from(merged.values()).sort((a, b) => Number(a.day) - Number(b.day))
  mergedDailyAdventures = next
  window.dispatchEvent(new CustomEvent('wwcxrl-tasks-updated'))
  return next
}

function isAdminPageRequested() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('admin') === '1'
}



function getTodayKey() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function dateDiffDays(a, b) {
  const day = 24 * 60 * 60 * 1000
  return Math.floor((a.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0)) / day)
}

function isPreviewMode() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1'
}

function isUnlocked(item) {
  return Boolean(item) && (isPreviewMode() || item.date <= getTodayKey())
}

function isAlbumUploadOpen(item) {
  // 相册照片位跟随已布置的天数开放：日历里出现这一天，双栏照片位即可上传
  return Boolean(item)
}

function filterGateInvalidSignedDays(days = []) {
  const validDays = new Set(getDailyAdventures().map(item => Number(item.day)))
  return Array.from(new Set(days.map(Number).filter(day => validDays.has(day) || isStarMapDay(day)))).sort((a, b) => a - b)
}

// 签到星图覆盖 Day 300 → 365：即使云端任务还没布置，这些天也是有效的签到日
const STAR_MAP_FIRST_DAY = 300
const STAR_MAP_LAST_DAY = 365

function isStarMapDay(day) {
  const number = Number(day)
  return Number.isFinite(number) && number >= STAR_MAP_FIRST_DAY && number <= STAR_MAP_LAST_DAY
}

// 合并本地/云端签到进度：已存本地的天数一律保留，避免任务表尚未合并完成时把管理员新建 Day 的进度误删。
function mergeCheckinDayLists(localList = [], remoteList = []) {
  const localDays = new Set(localList.map(Number))
  const validDays = new Set(getDailyAdventures().map(item => Number(item.day)))
  const union = new Set([...localList, ...remoteList].map(Number))
  return Array.from(union).filter(day => validDays.has(day) || isStarMapDay(day) || localDays.has(day)).sort((a, b) => a - b)
}

function roleStorageKey(key) {
  if (typeof window === 'undefined') return key
  try {
    const identity = getCloudIdentity()
    const role = identity?.role || 'pomelo'
    return `${key}:${role}`
  } catch {
    return key
  }
}

function getRoleJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(roleStorageKey(key)) || JSON.stringify(fallback))
  } catch {
    return fallback
  }
}

function setRoleJson(key, value) {
  localStorage.setItem(roleStorageKey(key), JSON.stringify(value))
}

function applyTemplateFiveDayStateOnce() {
  if (typeof window === 'undefined') return
  const versionKey = roleStorageKey('wwcxrl-template-state-version')
  if (localStorage.getItem(versionKey) === TEMPLATE_REFERENCE_VERSION) return

  const signed = filterGateInvalidSignedDays(getRoleJson('wwcxrl-signed-days', []))
  const completed = filterGateInvalidSignedDays(getRoleJson('wwcxrl-completed-days', []))
  setRoleJson('wwcxrl-signed-days', signed)
  setRoleJson('wwcxrl-completed-days', completed)
  localStorage.setItem(versionKey, TEMPLATE_REFERENCE_VERSION)
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
}

function sameNumberArray(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => Number(value) === Number(b[index]))
}

function getRoleNumber(key, fallback = 0) {
  return Number(localStorage.getItem(roleStorageKey(key)) || fallback)
}

function setRoleValue(key, value) {
  localStorage.setItem(roleStorageKey(key), String(value))
}

function removeRoleValue(key) {
  localStorage.removeItem(roleStorageKey(key))
}

function loadJsonStorage(key, fallback) {
  return getRoleJson(key, fallback)
}

const DAY2_STATE_KEY = 'wwcxrl-day2-firework-state'
const BACKPACK_KEY = 'wwcxrl-backpack-v1'
const GLOBAL_PROGRESS_DAY = 1
const GLOBAL_STATE_KEY = 'wwcxrl-global-cloud-state'
const GLOBAL_EMPTY_STATE = {
  themeMode: 'classic',
  voyageUnlocked: false,
  observatoryNavUnlocked: false,
  observatoryEnteredAt: '',
  invitationOpened: false,
  planetUnlocked: false
}

function normalizeGlobalCloudState(value = {}) {
  const themeMode = value.themeMode === 'voyage' || value.voyageUnlocked ? 'voyage' : 'classic'
  return {
    ...GLOBAL_EMPTY_STATE,
    themeMode,
    voyageUnlocked: Boolean(value.voyageUnlocked || themeMode === 'voyage'),
    observatoryNavUnlocked: Boolean(value.observatoryNavUnlocked),
    observatoryEnteredAt: value.observatoryEnteredAt || '',
    invitationOpened: Boolean(value.invitationOpened),
    planetUnlocked: Boolean(value.planetUnlocked),
    updatedAt: value.updatedAt || ''
  }
}

function loadGlobalLocalState() {
  return normalizeGlobalCloudState(getRoleJson(GLOBAL_STATE_KEY, GLOBAL_EMPTY_STATE))
}

function saveGlobalLocalState(next) {
  const normalized = normalizeGlobalCloudState(next)
  setRoleJson(GLOBAL_STATE_KEY, normalized)
  return normalized
}

async function saveCloudGlobalPatch(patch = {}, eventType = 'global_state_saved') {
  const localBase = loadGlobalLocalState()
  let remoteBase = {}
  try {
    const remote = await loadCloudDayProgress(GLOBAL_PROGRESS_DAY)
    remoteBase = remote?.progress || {}
  } catch (error) {
    console.warn('[wwcxrl cloud] global state load-before-save failed', error.message)
  }
  const next = saveGlobalLocalState({
    ...localBase,
    ...(remoteBase.global || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  })
  const nextRow = { ...remoteBase, global: next }
  saveCloudDayProgress(GLOBAL_PROGRESS_DAY, nextRow).catch(error => console.warn('[wwcxrl cloud] global state save failed', error.message))
  logCloudEvent(eventType, next, GLOBAL_PROGRESS_DAY)
  return next
}

function setVoyageThemeLocal(enabled, source = 'theme-update', { cloud = true } = {}) {
  const themeMode = enabled ? 'voyage' : 'classic'
  localStorage.setItem('wwcxrl-voyage-theme', enabled ? 'yes' : 'classic')
  saveGlobalLocalState({ ...loadGlobalLocalState(), themeMode, voyageUnlocked: Boolean(enabled) })
  window.dispatchEvent(new CustomEvent('wwcxrl-theme-updated', { detail: { theme: themeMode, source } }))
  if (cloud) saveCloudGlobalPatch({ themeMode, voyageUnlocked: Boolean(enabled) }, `global_theme_${themeMode}_${source}`)
}

function returnToInvitationLayer() {
  if (typeof window === 'undefined') return
  // 仅标记“主动回看邀请信”，不清空解锁/主题进度，避免下次访问被强制从邀请信开始。
  try { sessionStorage.setItem('wwcxrl-invitation-view-requested', 'yes') } catch {}
  window.history.replaceState(null, '', '/')
  window.location.reload()
}

async function hydrateGlobalCloudState() {
  try {
    const remote = await loadCloudDayProgress(GLOBAL_PROGRESS_DAY)
    if (!remote?.progress) return loadGlobalLocalState()
    const next = saveGlobalLocalState({ ...loadGlobalLocalState(), ...(remote.progress.global || {}) })
    if (next.voyageUnlocked || next.themeMode === 'voyage') {
      localStorage.setItem('wwcxrl-voyage-theme', 'yes')
      window.dispatchEvent(new CustomEvent('wwcxrl-theme-updated', { detail: { theme: 'voyage', source: 'cloud-hydrate' } }))
    }
    if (next.planetUnlocked || next.invitationOpened) {
      localStorage.setItem('wwcxrl-camouflage-opened', 'yes')
      localStorage.setItem('wwcxrl-planet-unlocked', 'yes')
    }
    return next
  } catch (error) {
    console.warn('[wwcxrl cloud] global state hydrate failed', error.message)
    return loadGlobalLocalState()
  }
}

function loadBackpack() {
  return getRoleJson(BACKPACK_KEY, {})
}

function saveBackpack(next) {
  setRoleJson(BACKPACK_KEY, next || {})
}

const BACKPACK_STAMP_PENDING_KEY = 'wwcxrl-backpack-stamp-pending-v1'

function loadBackpackStampPending() {
  try {
    return new Set(JSON.parse(localStorage.getItem(roleStorageKey(BACKPACK_STAMP_PENDING_KEY)) || '[]'))
  } catch {
    return new Set()
  }
}

function saveBackpackStampPending(ids) {
  try {
    localStorage.setItem(roleStorageKey(BACKPACK_STAMP_PENDING_KEY), JSON.stringify(Array.from(ids || [])))
  } catch {
    try {
      localStorage.removeItem(roleStorageKey(BACKPACK_STAMP_PENDING_KEY))
    } catch {}
  }
}

function addBackpackItems(items = []) {
  const next = { ...loadBackpack() }
  const stampedIds = []
  const pendingStamps = loadBackpackStampPending()
  ;(items || []).forEach(({ id, count }) => {
    const wasAbsent = Number(next[id] || 0) <= 0
    next[id] = Math.max(0, Number(next[id] || 0) + Number(count || 0))
    if (next[id] === 0) delete next[id]
    if (wasAbsent && next[id] > 0) {
      pendingStamps.add(id)
      stampedIds.push(id)
    }
  })
  saveBackpack(next)
  saveBackpackStampPending(pendingStamps)
  window.dispatchEvent(new CustomEvent('wwcxrl-backpack-updated', { detail: { stamped: stampedIds } }))
  return next
}

const DAY2_FORCE_RESET_VERSION = 'day2-reset-to-unanswered-20260521-v10'
const DAY3_FORCE_RESET_VERSION = 'day3-reset-to-first-run-20260526-v34'
const DAY4_FORCE_RESET_VERSION = 'day4-postsign-glitch-animation-copy-20260525-v26'
const TELESCOPE_CHAIN_RESET_VERSION = 'day5-no-postsign-crash-planet2-wrap-bigplanet-20260525-v27'
const TELESCOPE_RESET_ITEM_IDS = ['telescope_lens', 'telescope_tube', 'telescope_tripod', 'telescope_focuser', 'telescope_star_map', 'telescope_ready', 'bare_telescope', 'focusable_telescope', 'observatory_unlocked', 'observatory_building', 'observatory_nav_unlocked']
const SITE_FULL_RESET_VERSION = 'site-reset-to-520-unsigned-v31-20260525'
const DAY8_FORCE_RESET_VERSION = 'day8-story-reset-one-lightyear-v49-20260527'

function removeDayFromLocalArray(key, day) {
  try {
    const next = JSON.parse(localStorage.getItem(roleStorageKey(key)) || '[]').filter(value => value !== day)
    localStorage.setItem(roleStorageKey(key), JSON.stringify(next))
  } catch {
    localStorage.setItem(roleStorageKey(key), '[]')
  }
}

function resetSiteLocalStateToDay1Unsigned() {
  if (typeof window === 'undefined') return
  const roleScopedKeys = [
    'wwcxrl-signed-days',
    'wwcxrl-completed-days',
    'wwcxrl-backpack-v1',
    'wwcxrl-day2-firework-state',
    'wwcxrl-day3-foam-progress',
    'wwcxrl-day4-dark-maze-state',
    'wwcxrl-day4-fake-key-checkin-state',
    'wwcxrl-day5-telescope-run-state',
    'wwcxrl-day6-stargazing-state',
    'wwcxrl-day6-planet2-observatory-state',
    'wwcxrl-day7-stargazing-state',
    'wwcxrl-day8-one-lightyear-signal-state',
    'wwcxrl-capsule-energy-state',
    'wwcxrl-global-cloud-state'
  ]
  roleScopedKeys.forEach(key => localStorage.removeItem(roleStorageKey(key)))
  setRoleJson('wwcxrl-signed-days', [])
  setRoleJson('wwcxrl-completed-days', [])
  setRoleJson('wwcxrl-backpack-v1', {})
  setVoyageThemeLocal(false, 'full-site-reset-v31', { cloud: false })
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
}

function resetSiteLocalStateOnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (params.get('resetSite') === '1') resetSiteLocalStateToDay1Unsigned()
  localStorage.setItem(roleStorageKey('wwcxrl-site-full-reset-version'), SITE_FULL_RESET_VERSION)
}

function resetWholeSampleAndReload() {
  if (typeof window === 'undefined') return
  const accepted = window.confirm('要重置整个五日样品吗？\n\n这会清空 Day 01 / 02 / 03 / 05 / 08 的签到、任务、背包、火柴、钥匙、迷宫与信号进度，并切回经典皮肤；不会删除你的源代码。\n\n重置后会立刻刷新，从 Day 01 重新开始。')
  if (!accepted) return
  resetSiteLocalStateToDay1Unsigned()
  window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '样品已重置，正在回到 Day 01…' }))
  window.setTimeout(() => window.location.reload(), 80)
}

function resetDay2ToUnanswered() {
  if (typeof window === 'undefined') return
  removeRoleValue('wwcxrl-day2-firework-state')
  removeDayFromLocalArray('wwcxrl-completed-days', 2)
  removeDayFromLocalArray('wwcxrl-signed-days', 2)
  try {
    const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
    delete backpack.matchbox
    delete backpack.match
    if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    else localStorage.setItem(roleStorageKey('wwcxrl-backpack-v1'), JSON.stringify(backpack))
  } catch {
    localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
  }
}

function resetDay2OnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const manualReset = params.get('resetDay2') === '1'
  if (manualReset) {
    resetDay2ToUnanswered()
  }
  localStorage.setItem(roleStorageKey('wwcxrl-day2-reset-version'), DAY2_FORCE_RESET_VERSION)
}

function resetDay3ToFirstRun() {
  if (typeof window === 'undefined') return
  removeRoleValue('wwcxrl-day3-foam-progress')
  removeDayFromLocalArray('wwcxrl-completed-days', 3)
  removeDayFromLocalArray('wwcxrl-signed-days', 3)
  try {
    const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
    ;['magic_wand', 'coffee_cup', 'coconut_cup', 'foam_key'].forEach(id => delete backpack[id])
    if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    else localStorage.setItem(roleStorageKey('wwcxrl-backpack-v1'), JSON.stringify(backpack))
  } catch {
    localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
  }
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  try {
    saveCloudDayProgress(3, DAY3_EMPTY_PROGRESS).catch(error => console.warn('[wwcxrl cloud] day3 reset sync failed', error.message))
    removeCloudBackpackItems(['magic_wand', 'coffee_cup', 'coconut_cup', 'foam_key']).catch(error => console.warn('[wwcxrl cloud] day3 backpack reset failed', error.message))
  } catch {}
}

function resetDay3OnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const manualReset = params.get('resetDay3') === '1'
  if (manualReset) {
    resetDay3ToFirstRun()
  }
  localStorage.setItem(roleStorageKey('wwcxrl-day3-reset-version'), DAY3_FORCE_RESET_VERSION)
}

function resetDay4ToPlayableMaze() {
  if (typeof window === 'undefined') return
  removeRoleValue('wwcxrl-day4-dark-maze-state')
  removeRoleValue('wwcxrl-day4-fake-key-checkin-state')
  setVoyageThemeLocal(false, 'day4-reset', { cloud: true })
  removeDayFromLocalArray('wwcxrl-completed-days', 4)
  removeDayFromLocalArray('wwcxrl-signed-days', 4)
  try {
    saveCloudDayProgress(4, DAY4_EMPTY_STATE).catch(error => console.warn('[wwcxrl cloud] day4 reset sync failed', error.message))
    clearCloudDayStatus(4, '2026-05-23').catch(error => console.warn('[wwcxrl cloud] day4 checkin reset failed', error.message))
  } catch {}
}

function resetDay4OnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const manualReset = params.get('resetDay4') === '1'
  if (manualReset) {
    resetDay4ToPlayableMaze()
  }
  localStorage.setItem(roleStorageKey('wwcxrl-day4-reset-version'), DAY4_FORCE_RESET_VERSION)
}

function resetTelescopeChainToFirstRun() {
  if (typeof window === 'undefined') return
  removeRoleValue('wwcxrl-day5-telescope-run-state')
  removeRoleValue('wwcxrl-day4-dark-maze-state')
  removeRoleValue('wwcxrl-day6-stargazing-state')
  removeRoleValue('wwcxrl-day6-planet2-observatory-state')
  removeRoleValue('wwcxrl-day7-stargazing-state')
  removeDayFromLocalArray('wwcxrl-completed-days', 5)
  removeDayFromLocalArray('wwcxrl-signed-days', 5)
  removeDayFromLocalArray('wwcxrl-completed-days', 6)
  removeDayFromLocalArray('wwcxrl-signed-days', 6)
  removeDayFromLocalArray('wwcxrl-completed-days', 7)
  removeDayFromLocalArray('wwcxrl-signed-days', 7)
  try {
    const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
    TELESCOPE_RESET_ITEM_IDS.forEach(id => delete backpack[id])
    if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    else localStorage.setItem(roleStorageKey('wwcxrl-backpack-v1'), JSON.stringify(backpack))
  } catch {
    localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
  }
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  try {
    clearCloudDayStatus(5, '2026-05-24').catch(error => console.warn('[wwcxrl cloud] day5 checkin reset failed', error.message))
    clearCloudDayStatus(6, '2026-05-25').catch(error => console.warn('[wwcxrl cloud] day6 checkin reset failed', error.message))
    clearCloudDayStatus(7, '2026-05-26').catch(error => console.warn('[wwcxrl cloud] day7 checkin reset failed', error.message))
    saveCloudDayProgress(5, DAY4_EMPTY_STATE).catch(error => console.warn('[wwcxrl cloud] day5 maze progress reset failed', error.message))
    saveCloudDayProgress(6, {}).catch(error => console.warn('[wwcxrl cloud] day6 planet2 progress reset failed', error.message))
    saveCloudDayProgress(7, { focus: 0 }).catch(error => console.warn('[wwcxrl cloud] day7 progress reset failed', error.message))
    removeCloudBackpackItems(TELESCOPE_RESET_ITEM_IDS).catch(error => console.warn('[wwcxrl cloud] telescope backpack reset failed', error.message))
  } catch {}
}

function resetTelescopeChainOnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const manualReset = params.get('resetDay5') === '1' || params.get('resetDay6') === '1' || params.get('resetTelescope') === '1'
  if (manualReset) {
    resetTelescopeChainToFirstRun()
  }
  localStorage.setItem(roleStorageKey('wwcxrl-telescope-reset-version'), TELESCOPE_CHAIN_RESET_VERSION)
}

async function resetDay8OneLightYearSignal() {
  if (typeof window === 'undefined') return
  removeRoleValue('wwcxrl-day8-one-lightyear-signal-state')
  removeDayFromLocalArray('wwcxrl-completed-days', 8)
  removeDayFromLocalArray('wwcxrl-signed-days', 8)
  try {
    const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
    delete backpack.one_lightyear_signal
    if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    else localStorage.setItem(roleStorageKey('wwcxrl-backpack-v1'), JSON.stringify(backpack))
  } catch {
    localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
  }
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new Event('wwcxrl-day8-signal-updated'))
  try {
    await Promise.all([
      clearCloudDayStatus(8, '2026-05-27').catch(error => console.warn('[wwcxrl cloud] day8 checkin reset failed', error.message)),
      saveCloudDayProgress(8, {}).catch(error => console.warn('[wwcxrl cloud] day8 progress reset failed', error.message)),
      removeCloudBackpackItems(['one_lightyear_signal']).catch(error => console.warn('[wwcxrl cloud] day8 backpack reset failed', error.message))
    ])
    logCloudEvent('day8_manual_reset', { source: 'day8_corner_button' }, 8)
  } catch {}
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new Event('wwcxrl-day8-signal-updated'))
}

async function resetDay9VacationBreak() {
  if (typeof window === 'undefined') return
  removeRoleValue('wwcxrl-day9-yuzu-vacation-state')
  removeDayFromLocalArray('wwcxrl-completed-days', 9)
  removeDayFromLocalArray('wwcxrl-signed-days', 9)
  try {
    const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
    delete backpack.vacation_half_hour_ticket
    if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    else localStorage.setItem(roleStorageKey('wwcxrl-backpack-v1'), JSON.stringify(backpack))
  } catch {
    localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
  }
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new Event('wwcxrl-day9-vacation-reset'))
  try {
    await Promise.all([
      clearCloudDayStatus(9, '2026-05-28').catch(error => console.warn('[wwcxrl cloud] day9 checkin reset failed', error.message)),
      saveCloudDayProgress(9, {}).catch(error => console.warn('[wwcxrl cloud] day9 progress reset failed', error.message)),
      removeCloudBackpackItems(['vacation_half_hour_ticket']).catch(error => console.warn('[wwcxrl cloud] day9 backpack reset failed', error.message))
    ])
    logCloudEvent('day9_manual_reset', { source: 'day9_corner_button' }, 9)
  } catch {}
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new Event('wwcxrl-day9-vacation-reset'))
}

function resetDay8OnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const manualReset = params.get('resetDay8') === '1' || params.get('reset527') === '1'
  if (manualReset) {
    resetDay8OneLightYearSignal()
  }
  localStorage.setItem(roleStorageKey('wwcxrl-day8-reset-version'), DAY8_FORCE_RESET_VERSION)
}

function resetDay9OnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const manualReset = params.get('resetDay9') === '1' || params.get('reset528') === '1'
  if (manualReset) {
    resetDay9VacationBreak()
  }
}

const CHILDREN_SPECIAL_TYPES = ['yuzuComfortIntro', 'moodShardCollect', 'apologyRepairShop', 'childrenShuttlecockFinale']
const CHILDREN_POSTPONED_DAYS = [10, 11, 12, 13, 14]
const CHILDREN_POSTPONED_MESSAGE = '由于不可抗力,西啵歪规定六一国际儿童节延期, 开放时间另行通知~'
const CHILDREN_REWARD_ITEMS = ['cloud_fluff_trim', 'rainbow_feather_patch', 'reconciliation_star_bell', 'decoratable_shuttlecock', 'best_shuttlecock', 'children_day_note']
const CHILDREN_RESET_CONFIG = {
  10: { label: '重置529', date: '2026-05-29', toast: '529 已重置，可以重新轻轻靠近小柚子啦。', rewards: ['cloud_fluff_trim'] },
  11: { label: '重置530', date: '2026-05-30', toast: '530 已重置，可以重新收集好心情碎片啦。', rewards: ['rainbow_feather_patch'] },
  12: { label: '重置531', date: '2026-05-31', toast: '531 已重置，可以重新认真修好别扭小结啦。', rewards: ['reconciliation_star_bell'] },
  13: { label: '重置601', date: '2026-06-01', toast: '601 已重置，可以重新制作全世界最好看的羽毛球啦。', rewards: ['decoratable_shuttlecock', 'best_shuttlecock', 'children_day_note'] }
}

const SLEEP_LAB_RESET_CONFIG = {
  15: { label: '重置603', date: '2026-06-03', toast: '603 已重置，可以重新帮小动物们找睡觉氛围啦。', rewards: ['good_sleep_night_lamp'] }
}

const GENERIC_DAY_RESET_CONFIG = {
  1: { label: '重置520', date: '2026-05-20', toast: '520 已重置，可以重新回答午夜谜题啦。' },
  2: { label: '重置521', date: '2026-05-21', toast: '521 已重置，可以重新解连续谜题和点烟花啦。', keys: ['wwcxrl-day2-firework-state'], rewards: ['matchbox', 'match'] },
  3: { label: '重置522', date: '2026-05-22', toast: '522 已重置，可以重新画奶泡啦。', keys: ['wwcxrl-day3-foam-progress'], rewards: ['magic_wand', 'coffee_cup', 'coconut_cup', 'foam_key'] },
  4: { label: '重置523', date: '2026-05-23', toast: '523 已重置，可以重新点点点啦。', keys: ['wwcxrl-day4-fake-key-checkin-state'] },
  5: { label: '重置524', date: '2026-05-24', toast: '524 已重置：火柴盒 × 1、火柴 × 2、钥匙 × 1 已恢复，可以立即重玩迷宫。', keys: ['wwcxrl-day4-dark-maze-state'], restore: { matchbox: 1, match: 2, foam_key: 1 } },
  6: { label: '重置525', date: '2026-05-25', toast: '525 已重置，可以重新探索星球2号啦。', keys: ['wwcxrl-day5-telescope-run-state', 'wwcxrl-day6-planet2-observatory-state'], rewards: ['telescope_lens', 'telescope_tube', 'telescope_tripod', 'telescope_focuser', 'telescope_star_map', 'bare_telescope', 'focusable_telescope', 'observatory_building'] },
  7: { label: '重置526', date: '2026-05-26', toast: '526 已重置，可以重新进入星空观测站啦。', keys: ['wwcxrl-day6-stargazing-state', 'wwcxrl-day7-stargazing-state'], rewards: ['telescope_ready', 'observatory_unlocked', 'observatory_nav_unlocked'] },
  14: { label: '重置602', date: '2026-06-02', toast: '602 已重置，但这一天仍然是封存的儿童节延期页。' },
  16: { label: '重置604', date: '2026-06-04', toast: '604 已重置，可以重新给小柚子做花环啦。', keys: ['wwcxrl-flower-crown-day16'], rewards: ['flower_crown'] },
  17: { label: '重置605', date: '2026-06-05', toast: '605 已重置，可以重新打开折纸小狗伴读页啦。' },
  18: { label: '重置606', date: '2026-06-06', toast: '606 已重置，可以重新攒 6 次幸运啦。' },
  19: { label: '重置607', date: '2026-06-07', toast: '607 已重置，可以重新体验彩虹照片任务啦。' },
  20: { label: '重置608', date: '2026-06-08', toast: '608 已重置，可以重新打开说明书啦。' },
  21: { label: '重置609', date: '2026-06-09', toast: '609 已重置，可以重新扫描心动雷达啦。' },
  22: { label: '重置610', date: '2026-06-10', toast: '610 已重置，可以重新收到倒数信啦。' },
  23: { label: '重置1012', date: '2026-10-12', toast: '1012 已重置，可以重新获得预告星贴纸啦。' },
  24: { label: '重置1013', date: '2026-10-13', toast: '1013 已重置，可以重新打开纪念日啦。', keys: ['wwcxrl-day24-anniversary-answer-146-ok'] }
}

async function resetGenericDay(item) {
  if (typeof window === 'undefined' || !item) return
  const config = GENERIC_DAY_RESET_CONFIG[item.day] || { label: `重置${item.date.slice(5).replace('-', '')}`, date: item.date, toast: `${item.date.slice(5).replace('-', '')} 已重置，可以重新体验这一天啦。` }
  ;(config.keys || []).forEach(key => removeRoleValue(key))
  removeDayFromLocalArray('wwcxrl-completed-days', item.day)
  removeDayFromLocalArray('wwcxrl-signed-days', item.day)
  let nextBag = null
  if ((config.rewards && config.rewards.length) || config.restore) {
    try {
      const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
      ;(config.rewards || []).forEach(id => { delete backpack[id] })
      Object.entries(config.restore || {}).forEach(([id, count]) => { backpack[id] = Number(count) })
      nextBag = backpack
      if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
      else saveBackpack(backpack)
    } catch {
      nextBag = config.restore ? { ...config.restore } : null
      if (nextBag) saveBackpack(nextBag)
      else localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    }
  }
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new CustomEvent('wwcxrl-generic-day-reset', { detail: { day: item.day } }))
  try {
    await Promise.all([
      clearCloudDayStatus(item.day, config.date || item.date).catch(error => console.warn(`[wwcxrl cloud] day${item.day} checkin reset failed`, error.message)),
      saveCloudDayProgress(item.day, {}).catch(error => console.warn(`[wwcxrl cloud] day${item.day} progress reset failed`, error.message)),
      config.rewards && config.rewards.length ? removeCloudBackpackItems(config.rewards).catch(error => console.warn(`[wwcxrl cloud] day${item.day} backpack reset failed`, error.message)) : Promise.resolve(),
      nextBag ? syncCloudBackpack(nextBag).catch(error => console.warn(`[wwcxrl cloud] day${item.day} backpack restore sync failed`, error.message)) : Promise.resolve()
    ])
    logCloudEvent('generic_day_manual_reset', { day: item.day, source: 'corner_button' }, item.day)
  } catch {}
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new CustomEvent('wwcxrl-generic-day-reset', { detail: { day: item.day } }))
}

async function resetSleepLabDay(day = 15) {
  if (typeof window === 'undefined') return
  const config = SLEEP_LAB_RESET_CONFIG[day]
  if (!config) return
  removeRoleValue(`wwcxrl-sleep-lab-day${day}`)
  removeDayFromLocalArray('wwcxrl-completed-days', day)
  removeDayFromLocalArray('wwcxrl-signed-days', day)
  try {
    const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
    ;(config.rewards || []).forEach(id => { delete backpack[id] })
    if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    else localStorage.setItem(roleStorageKey('wwcxrl-backpack-v1'), JSON.stringify(backpack))
  } catch {
    localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
  }
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new CustomEvent('wwcxrl-sleep-lab-reset', { detail: { day } }))
  try {
    await Promise.all([
      clearCloudDayStatus(day, config.date).catch(error => console.warn(`[wwcxrl cloud] sleep lab day${day} checkin reset failed`, error.message)),
      saveCloudDayProgress(day, {}).catch(error => console.warn(`[wwcxrl cloud] sleep lab day${day} progress reset failed`, error.message)),
      removeCloudBackpackItems(config.rewards || []).catch(error => console.warn(`[wwcxrl cloud] sleep lab day${day} backpack reset failed`, error.message))
    ])
    logCloudEvent('sleep_lab_manual_reset', { day, source: 'corner_button' }, day)
  } catch {}
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new CustomEvent('wwcxrl-sleep-lab-reset', { detail: { day } }))
}

async function resetChildrenSpecialDay(day) {
  if (typeof window === 'undefined') return
  const config = CHILDREN_RESET_CONFIG[day]
  if (!config) return
  removeRoleValue(`wwcxrl-children-special-day${day}`)
  removeDayFromLocalArray('wwcxrl-completed-days', day)
  removeDayFromLocalArray('wwcxrl-signed-days', day)
  try {
    const backpack = JSON.parse(localStorage.getItem(roleStorageKey('wwcxrl-backpack-v1')) || '{}')
    ;(config.rewards || []).forEach(id => { delete backpack[id] })
    if (Object.keys(backpack).length === 0) localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
    else localStorage.setItem(roleStorageKey('wwcxrl-backpack-v1'), JSON.stringify(backpack))
  } catch {
    localStorage.removeItem(roleStorageKey('wwcxrl-backpack-v1'))
  }
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new CustomEvent('wwcxrl-children-special-reset', { detail: { day } }))
  try {
    await Promise.all([
      clearCloudDayStatus(day, config.date).catch(error => console.warn(`[wwcxrl cloud] children day${day} checkin reset failed`, error.message)),
      saveCloudDayProgress(day, {}).catch(error => console.warn(`[wwcxrl cloud] children day${day} progress reset failed`, error.message)),
      removeCloudBackpackItems(config.rewards || []).catch(error => console.warn(`[wwcxrl cloud] children day${day} backpack reset failed`, error.message))
    ])
    logCloudEvent('children_special_manual_reset', { day, source: 'corner_button' }, day)
  } catch {}
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
  window.dispatchEvent(new Event('wwcxrl-signed-updated'))
  window.dispatchEvent(new CustomEvent('wwcxrl-children-special-reset', { detail: { day } }))
}

function resetChildrenSpecialOnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  Object.keys(CHILDREN_RESET_CONFIG).map(Number).forEach(day => {
    if (params.get(`resetDay${day}`) === '1' || params.get(`reset${CHILDREN_RESET_CONFIG[day].label.replace('重置', '')}`) === '1') {
      resetChildrenSpecialDay(day)
    }
  })
}

function resetSleepLabOnceForCurrentBuild() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (params.get('resetDay15') === '1' || params.get('reset603') === '1') resetSleepLabDay(15)
}

function isLocalWwcxrlDeveloperDevice() {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')
}

function isChildrenSpecialPostponed(item) {
  return Boolean(item && CHILDREN_POSTPONED_DAYS.includes(Number(item.day)) && !isLocalWwcxrlDeveloperDevice())
}

function StarField() {
  const stars = useMemo(() => Array.from({ length: 56 }, (_, i) => ({
    id: i,
    '--left': `${Math.random() * 100}%`,
    '--top': `${Math.random() * 100}%`,
    '--delay': `${Math.random() * 5}s`,
    '--size': `${Math.random() * 5 + 3}px`
  })), [])

  return <div className="star-field" aria-hidden="true">{stars.map(star => <span key={star.id} style={star} />)}</div>
}

function CuteIcon({ children, tone = 'sunny' }) {
  return <span className={`cute-icon ${tone}`}>{children}</span>
}

function DogSprite({ type = 'partner', label, className = '' }) {
  const dogRole = type === 'pomelo' ? 'partner' : type === 'orange' ? 'me' : (type === 'me' || type === 'partner' ? type : 'partner')
  const dogMap = {
    me: '/images/柯基.png',
    partner: '/images/金毛.png'
  }
  const dogSrc = dogMap[dogRole]

  return (
    <img
      className={`dog-sprite ${dogRole} ${className}`}
      src={dogSrc}
      alt={label || (dogRole === 'me' ? '我的小狗形象' : '小琳的小狗形象')}
      aria-label={label || (dogRole === 'me' ? '我的小狗形象' : '小琳的小狗形象')}
    />
  )
}

function InvitationLayer({ onReveal }) {
  const nameTargets = ['name-title', 'name-dear', 'name-invite', 'name-back', 'name-satisfied']
  const [clickedNames, setClickedNames] = useState([])
  const [particles, setParticles] = useState([])
  const [transitioning, setTransitioning] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [flowerStage, setFlowerStage] = useState('hidden')
  const [flowerBloomId, setFlowerBloomId] = useState(() => Date.now())

  function revealPlanet() {
    try { sessionStorage.removeItem('wwcxrl-invitation-view-requested') } catch {}
    localStorage.setItem('wwcxrl-camouflage-opened', 'yes')
    localStorage.setItem('wwcxrl-planet-unlocked', 'yes')
    saveCloudGlobalPatch({ invitationOpened: true, planetUnlocked: true }, 'global_planet_unlocked')
    onReveal()
  }

  function clickName(id, event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const burst = Array.from({ length: 16 }, (_, index) => ({
      id: `${id}-${Date.now()}-${index}`,
      x: `${rect.left + rect.width / 2}px`,
      y: `${rect.top + rect.height / 2}px`,
      dx: `${Math.cos((Math.PI * 2 * index) / 16) * (42 + (index % 4) * 9)}px`,
      dy: `${Math.sin((Math.PI * 2 * index) / 16) * (42 + (index % 5) * 8)}px`,
      glyph: ['✦', '♡', '🍊', '星', '光'][index % 5]
    }))
    setParticles((old) => [...old.slice(-80), ...burst])

    setClickedNames((previous) => {
      if (previous.includes(id)) return previous
      const next = [...previous, id]
      if (next.length === nameTargets.length && !transitioning) {
        setTransitioning(true)
        setTimeout(revealPlanet, 10500)
      }
      return next
    })
  }

  function NameTrigger({ id, children = '小琳' }) {
    const active = clickedNames.includes(id)
    return (
      <button
        type="button"
        className={`name-trigger ${active ? 'is-lit' : ''}`}
        onClick={(event) => clickName(id, event)}
        aria-label={String(children)}
      >
        {children}
      </button>
    )
  }

  const words = ['8月13日', '16:00', '万广场CGV', '《奥德赛》', '300Days', '小琳']

  return (
    <main className={`invitation-shell page-shell ${transitioning ? 'is-transitioning' : ''}`}>
      <div className="cinema-grain" aria-hidden="true" />
      <div className="film-strip film-strip-left" aria-hidden="true" />
      <div className="film-strip film-strip-right" aria-hidden="true" />
      <div className="floating-letter-decor decor-moon" aria-hidden="true">☾</div>
      <div className="floating-letter-decor decor-heart" aria-hidden="true">♡</div>
      <div className="floating-letter-decor decor-spark" aria-hidden="true">✦</div>
      <div className="particle-layer" aria-hidden="true">
        {particles.map((particle) => (
          <span
            key={particle.id}
            className="magic-particle"
            style={{ left: particle.x, top: particle.y, '--dx': particle.dx, '--dy': particle.dy }}
          >
            {particle.glyph}
          </span>
        ))}
      </div>
      <aside className="invitation-newbie-guide" aria-live="polite">
        <strong>今天的出发指令</strong>
        <span>① 点“抽出票根”看电影预约；② 点信里所有发光的“小琳”（{clickedNames.length}/5）；③ 五个名字都亮起后，等小火箭带你进入我们的 300Days 星球。</span>
      </aside>
      {transitioning && (
        <div className="portal-transition" aria-hidden="true">
          <div className="star-road"><span /><span /><span /><span /><span /></div>
          <div className="portal-ring" />
          <div className="countdown-citrus-duo" aria-hidden="true">
            <DogSprite type="pomelo" className="countdown-pomelo" />
            <DogSprite type="orange" className="countdown-orange" />
          </div>
          <div className="launch-countdown">
            <div className="countdown-label">出发倒计时</div>
            <div className="countdown-number">
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((num, index) => (
                <span key={num} style={{ '--count-index': index }}>{num}</span>
              ))}
            </div>
          </div>
          <div className="space-ship">
            <DogSprite type="pomelo" className="space-pomelo" />
            <DogSprite type="orange" className="space-orange" />
            <span className="ship-window" />
          </div>
          <div className="cute-rocket">🚀</div>
          <div className="destination-planet orange-destination"><DogSprite type="pomelo" className="planet-mascot" /></div>
          <div className="destination-planet pomelo-destination"><DogSprite type="orange" className="planet-mascot" /></div>
          <div className="portal-stars">✦ 𖤐 ♡ 🐾 ✧ ✨ ♡ 𖤐 ✦</div>
          <div className="portal-caption">倒计时结束后，两只小狗坐上小火箭，出发去往我们的星球……</div>
        </div>
      )}
      <div className="invitation-stage">
        <button
          type="button"
          className={`ticket-card anime-ticket ${ticketOpen ? 'is-open' : ''}`}
          onClick={() => setTicketOpen((open) => !open)}
          aria-label="展开或收起电影票"
        >
          <div className="ticket-perf" />
          <span className="ticket-label">ADMIT TWO</span>
          <div className="ticket-poster">
            <span>信万广场 CGV</span>
            <strong>《奥德赛》</strong>
            <small>影城约会计划</small>
          </div>
          <div className="ticket-meta">
            <b>2026年8月13日</b>
            <span>16:00 开场 · 18:52 散场</span>
            <span>信万广场 CGV 影城</span>
          </div>
          <div className="ticket-code">300DAYS / MOVIE / LUNCH</div>
          <div className="ticket-hint">点我展开 / 再点收回完整票根</div>
        </button>
        <button
          type="button"
          className="ticket-peek-trigger"
          onClick={() => setTicketOpen((open) => !open)}
          aria-label="抽出或收回电影票"
        >
          {ticketOpen ? '收起票根' : '抽出票根'}
        </button>
        <section className="invitation-letter">
          <div className="letter-glow" aria-hidden="true" />
          <div className="letter-stamp">Aug 09</div>
          <div className="wax-seal" aria-hidden="true">琛</div>
          <div className="letter-ribbon" aria-hidden="true">
            {words.map((word) => <span key={word}>{word}</span>)}
          </div>
          <div className="citrus-duo letter-citrus-duo" aria-hidden="true">
            <DogSprite type="pomelo" className={transitioning ? 'fly-to-corner' : ''} />
            <DogSprite type="orange" className={transitioning ? 'fly-to-corner' : ''} />
            <div className="page-corner" />
          </div>
          <p className="letter-kicker">一封很普通但很认真送达的邀请信</p>
          <h1><span>致</span><NameTrigger id="name-title">小琳</NameTrigger></h1>
          <div className="letter-body">
            <p style={{ '--line': 1 }}>展信佳。</p>
            <p style={{ '--line': 2 }}>
              亲爱的<NameTrigger id="name-dear">小琳</NameTrigger>，你还记得2025年10月13日我们在干什么嘛？好像是我们先去秘密西餐厅吃饭，然后一起去散步，当时还说先来一个月试用期，转眼间三百天就过去啦......真像是昨天才发生的事情，一切都历历在目。我们都会怀念过去，也同样期待未来。想此时你如同我一般，将目光投向远方，也同样期待未来，欢迎来到属于我们的第一个300Days~
            </p>
            <p style={{ '--line': 3 }}>
              让我们言归正传!
            </p>
            <p style={{ '--line': 4 }}>
              这段时间你在郑州准备考驾照，我在商丘，很想念你啦！想你发出一份非常正式的邀请：
            </p>
            <p style={{ '--line': 5 }}>
              我诚挚地邀请<NameTrigger id="name-invite">小琳</NameTrigger>于2026年8月13日共进午餐~
            </p>
            <p style={{ '--line': 6 }}>
              这封信的背后，还有我准备好的电影票，这是一部我非常喜欢的导演上新的佳作，我把它列入了约会计划的一部分，希望你也能喜欢~
            </p>
            <p style={{ '--line': 8 }}>
              当然，还有最重要的，给<NameTrigger id="name-back">小琳</NameTrigger>按按肩膀，练车考驾照这些天辛苦啦！
            </p>
            <p style={{ '--line': 9 }}>
              听说听女朋友的话会发达，这次我就先不邮寄礼物啦，省钱为我们多见面！这个邀请函不花钱，不知道<NameTrigger id="name-satisfied">小琳</NameTrigger>满意不~
            </p>
            <p className="letter-signoff" style={{ '--line': 10 }}>
              小琛<br />
              2026年8月9日
            </p>
            <div className={`flower-gift flower-${flowerStage}`}>
              {flowerStage === 'hidden' && (
                <button
                  type="button"
                  className="flower-gift-button"
                  onClick={() => {
                    setFlowerBloomId(Date.now())
                    setFlowerStage('bloom')
                  }}
                >
                  请查收你的300天纪念日花花
                </button>
              )}
              {flowerStage !== 'hidden' && (
                <button
                  type="button"
                  className="flower-cartoon-card"
                  onClick={() => setFlowerStage(stage => {
                    const nextStage = stage === 'bloom' ? 'pinned' : 'bloom'
                    if (nextStage === 'bloom') setFlowerBloomId(Date.now())
                    return nextStage
                  })}
                  aria-label="300天纪念日花花"
                >
                  <img key={flowerBloomId} src={`/images/flower-cartoon.svg?bloom=${flowerBloomId}`} alt="卡通300天纪念日花花" />
                  <span>{flowerStage === 'bloom' ? '再点一下，把花花收进信里' : '300天纪念日花花已查收'}</span>
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function PasswordGate({ onUnlock }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function submit(event) {
    event.preventDefault()
    if (password.trim() === PASSWORD) {
      localStorage.setItem('wwcxrl-planet-unlocked', 'yes')
      onUnlock()
    } else {
      setError('暗号好像不对哦，小星球还没有开门～')
    }
  }

  return (
    <main className="gate page-shell">
      <StarField />
      <div className="soft-cloud cloud-a">♡</div>
      <div className="soft-cloud cloud-b">520</div>
      <section className="gate-card sticker-card">
        <CuteIcon>🔐</CuteIcon>
        <div className="tiny-label">Our Small Planet Boarding Pass</div>
        <h1>我们的专属入口</h1>
        <p>请输入 520 到 1013 的秘密暗号，登陆这颗每天都会长出一点点新东西的小星球。</p>
        <form onSubmit={submit} className="gate-form">
          <input
            type="password"
            inputMode="numeric"
            placeholder="输入 6 位暗号"
            value={password}
            onChange={(event) => { setPassword(event.target.value); setError('') }}
            aria-label="访问密码"
          />
          <button type="submit">🍊 降落小星球</button>
        </form>
        {error && <p className="error-note">{error}</p>}
        <div className="hint-note">提示：520 + 纪念日。</div>
      </section>
    </main>
  )
}

function Nav({ current, setCurrent }) {
  const [bagVersion, setBagVersion] = useState(0)
  React.useEffect(() => {
    const refresh = () => setBagVersion(value => value + 1)
    window.addEventListener('wwcxrl-backpack-updated', refresh)
    return () => window.removeEventListener('wwcxrl-backpack-updated', refresh)
  }, [])

  const bag = loadBackpack()
  const observatoryNavOpen = Number(bag.observatory_nav_unlocked || 0) > 0
  const items = [
    ['home', '首页', '🏠'],
    ['checkin', '每日签到', '📮'],
    ['album', '相册', '📷'],
    ...(observatoryNavOpen ? [['telescope', '星空观测站', '🔭']] : []),
    ['backpack', '小背包', '🎒'],
    ['capsule', '彩蛋', '🎁']
  ]
  return (
    <nav className="planet-nav" aria-label="300Days 纪念日导航">
      <button
        type="button"
        title="回到可操作的 8月9日邀请信"
        onClick={returnToInvitationLayer}
      ><span>✉️</span>邀请信</button>
      {items.map(([id, label, icon]) => (
        <button key={id} className={current === id ? 'active' : ''} onClick={() => setCurrent(id)} aria-current={current === id ? 'page' : undefined}>
          <span>{icon}</span>{label}
        </button>
      ))}
    </nav>
  )
}

function Hero({ setCurrent }) {
  const computeSignedCount = () => {
    try { return filterGateInvalidSignedDays(getRoleJson('wwcxrl-signed-days', [])).length } catch { return 0 }
  }
  const [signedCount, setSignedCount] = useState(computeSignedCount)

  React.useEffect(() => {
    let alive = true
    const refresh = () => {
      if (!alive) return
      const local = computeSignedCount()
      setSignedCount(local)
      if (cloudEnabled) {
        loadCloudCheckins().then(remote => {
          if (!alive || !remote) return
          const merged = mergeCheckinDayLists(getRoleJson('wwcxrl-signed-days', []), remote.signed || [])
          setSignedCount(merged.length)
        }).catch(() => {})
      }
    }
    refresh()
    const refreshVisible = () => { if (!document.hidden) refresh() }
    window.addEventListener('wwcxrl-signed-updated', refresh)
    window.addEventListener('wwcxrl-tasks-updated', refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshVisible)
    const intervalId = window.setInterval(refresh, 8000)
    return () => {
      alive = false
      window.removeEventListener('wwcxrl-signed-updated', refresh)
      window.removeEventListener('wwcxrl-tasks-updated', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshVisible)
      window.clearInterval(intervalId)
    }
  }, [])

  const progressPercent = Math.max(0, Math.min(100, (signedCount / 65) * 100))
  const { dayCount, daysToYearOne, yearOneReached } = getAnniversaryCounts()
  const orbitAngle = Math.max(0, Math.min(360, (dayCount / 365) * 360 - 90))

  return (
    <section className="hero-section">
      <div className="planet-wrap" aria-hidden="true">
        <div className="orbit orbit-one"><i>💌</i></div>
        <div className="orbit orbit-two"><i>⭐</i></div>
        <div className="wwcxrl-planet">
          <span className="planet-shine" />
          <DogSprite type="me" className="hero-pomelo" />
          <span className="planet-leaf" />
        </div>
        <DogSprite type="partner" className="orbit-orange" />
        <span className="hero-orbit-progress" style={{ '--orbit-angle': `${orbitAngle}deg` }}><b>{dayCount}</b></span>
        <span className="floating-note note-one">第 {dayCount} 天</span>
        <span className="floating-note note-two">{yearOneReached ? '一周年已达成' : `一周年还有 ${daysToYearOne} 天`}</span>
      </div>
      <div className="hero-copy sticker-card doodle-border">
        <CuteIcon>♡</CuteIcon>
        <div className="tiny-label">{dayCount}Days — Our Small Universe</div>
        <h1>300Days</h1>
        <h2>我们已经走过的每一个今天</h2>
        <p>
          这是只属于你的小城堡，一段慢慢翻开的纪念日日记。我们一起走过 {dayCount} 天，第 {dayCount} 天也在认真继续。
        </p>
        <div className="hero-stats">
          <span>✨ 已一起走过 {dayCount} 天</span>
          <span>🌙 一周年：{yearOneReached ? '已达成' : `还有 ${daysToYearOne} 天`}</span>
        </div>
        <div className="hero-progress-card" aria-label={`已经签到 ${signedCount} 天，共 65 天`}>
          <div className="hero-progress-topline">
            <strong>纪念日星图进度</strong>
            <span>{signedCount}/65</span>
          </div>
          <div className="hero-progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
          <small>今天的旅程在 {dayCount} 号星图上，明天也会继续往前走。</small>
        </div>
        <div className="hero-actions">
          <button onClick={() => setCurrent('checkin')}>📮 打开签到星图</button>
        </div>
        <div className="newbie-route" role="note"><strong>今日提醒：</strong><span>{dayCount === 300 ? '今天是我们 300 天纪念日；从这里开始，接下来的每一天都值得被认真打开。' : `今天是第 ${dayCount} 天；从这里开始，接下来的每一天都值得被认真打开。`}</span></div>
      </div>
    </section>
  )
}

function StarVoyageDock({ setCurrent }) {
  const completed = (() => {
    try { return getRoleJson('wwcxrl-completed-days', []).includes(TEMPLATE_THEME_SWITCH_DAY) } catch { return false }
  })()
  if (!completed) return null
  return (
    <div className={`star-voyage-dock ${completed ? 'is-launched' : 'is-locked'}`}>
      <div className="voyage-window" aria-hidden="true">
        <span className="voyage-planet mint" />
        <span className="voyage-planet violet" />
        <span className="voyage-ship">🚀</span>
      </div>
      <div>
        <strong>Day 05 主题切换已演示</strong>
        <p>黑暗迷宫完成后，全站已切换到深空蓝、薄荷青与星云紫的星际旅行皮肤。页脚也可以手动来回切换，方便阅读实现方式。</p>
      </div>
      <button type="button" onClick={() => setCurrent('checkin')}>回到迷宫案例</button>
    </div>
  )
}

function getInitialCheckinDay() {
  try {
    const signedDays = filterGateInvalidSignedDays(getRoleJson('wwcxrl-signed-days', []))
    const completedDays = filterGateInvalidSignedDays(getRoleJson('wwcxrl-completed-days', []))
    if (!signedDays.length && !completedDays.length) return getDailyAdventures()[0]?.day || 300
    const nextUnsignedOpen = getDailyAdventures().find(item => isUnlocked(item) && !signedDays.includes(item.day))
    if (nextUnsignedOpen) return nextUnsignedOpen.day
    const todayItem = getDailyAdventures().find(item => item.date === getTodayKey() && isUnlocked(item))
    if (todayItem) return todayItem.day
  } catch {}
  return getDailyAdventures()[0]?.day || 300
}

function CheckIn() {
  applyTemplateFiveDayStateOnce()
  const todayKey = getTodayKey()
  const todayDay = (() => {
    const anchorMs = START_DATE.getTime()
    const todayMs = new Date(`${todayKey}T00:00:00`).getTime()
    return TEMPLATE_FIRST_DAY + Math.round((todayMs - anchorMs) / 86400000)
  })()
  const [selectedDay, setSelectedDay] = useState(() => getInitialCheckinDay())
  const [signed, setSigned] = useState(() => filterGateInvalidSignedDays(getRoleJson('wwcxrl-signed-days', [])))
  const [completedTasks, setCompletedTasks] = useState(() => filterGateInvalidSignedDays(getRoleJson('wwcxrl-completed-days', [])))
  const [items, setItems] = useState(() => getDailyAdventures())
  const selected = items.find(item => item.day === selectedDay) || items[0]
  const selectedPostponed = isChildrenSpecialPostponed(selected)
  const unlocked = isUnlocked(selected) && !selectedPostponed
  const resetAvailable = isUnlocked(selected)
  const rawTaskCompleted = completedTasks.includes(selected.day)
  const taskCompleted = rawTaskCompleted
    && (selected.type !== 'sleepAtmosphereLab' || isSleepLabTaskActuallyComplete(selected.day))
    && (selected.type !== 'flowerCrown' || isFlowerCrownTaskActuallyComplete(selected.day))
    && (selected.type !== 'photoWallFinale' || isPhotoWallFinaleActuallyComplete(selected.day))
    && (selected.type !== 'anniversary' || getRoleJson(ANNIVERSARY_ANSWER_KEY, false) === true || signed.includes(selected.day))
  const lastRealDay = items.length ? Math.max(...items.map(item => Number(item.day))) : 300
  const futureDaySlots = Array.from({ length: 65 }, (_, index) => ({
    day: lastRealDay + 1 + index,
    date: adminDayToDate(lastRealDay + 1 + index),
    title: `未来第 ${index + 1} 天`,
    icon: '🔒',
    type: 'futureLocked',
    theme: '未来签到等待开启',
    reward: '未来尚未到来',
    prompt: '这一天还没有打开。',
    secret: '尚未签到',
    answer: '',
    image: '',
    memoryTitle: '',
    memoryCaption: ''
  }))
  const visibleDailyItems = [...items, ...futureDaySlots]
  const futureDayTotal = futureDaySlots.length
  const totalTargetDayCount = Math.max(1, items.length)
  const percent = Math.round((Math.max(0, signed.length) / Math.max(1, totalTargetDayCount)) * 100)

  React.useEffect(() => {
    let alive = true
    const refreshCloudCheckins = () => {
      loadCloudCheckins().then(remote => {
        if (!alive || !remote) return
        const remoteSigned = remote.signed || []
        const remoteCompleted = remote.completed || []
        const localSigned = getRoleJson('wwcxrl-signed-days', [])
        const localCompleted = getRoleJson('wwcxrl-completed-days', [])
        const mergedSigned = mergeCheckinDayLists(localSigned, remoteSigned)
        const mergedCompleted = mergeCheckinDayLists(localCompleted, remoteCompleted)
        setSigned(previous => sameNumberArray(previous, mergedSigned) ? previous : mergedSigned)
        setCompletedTasks(previous => sameNumberArray(previous, mergedCompleted) ? previous : mergedCompleted)
        setRoleJson('wwcxrl-signed-days', mergedSigned)
        setRoleJson('wwcxrl-completed-days', mergedCompleted)
      }).catch(error => console.warn('[wwcxrl cloud] checkins refresh failed', error.message))
    }
    refreshCloudCheckins()
    const intervalId = window.setInterval(refreshCloudCheckins, 6000)
    const handleFocus = () => refreshCloudCheckins()
    const handleVisibility = () => { if (!document.hidden) refreshCloudCheckins() }
    const handleSignedUpdate = () => {
      const nextSigned = filterGateInvalidSignedDays(getRoleJson('wwcxrl-signed-days', []))
      setSigned(nextSigned)
      setRoleJson('wwcxrl-signed-days', nextSigned)
      setCompletedTasks(filterGateInvalidSignedDays(getRoleJson('wwcxrl-completed-days', [])))
    }
    window.addEventListener('focus', handleFocus)
    window.addEventListener('wwcxrl-signed-updated', handleSignedUpdate)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      alive = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('wwcxrl-signed-updated', handleSignedUpdate)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  React.useEffect(() => {
    let alive = true
    const refreshTasks = () => {
      hydrateDailyAdventures().then(() => {
        if (!alive) return
        const next = getDailyAdventures()
        setItems(next)
        setSelectedDay(previous => {
          if (next.some(item => item.day === previous)) return previous
          return getInitialCheckinDay()
        })
        // 任务表合并完成后，重新按可见天数过滤本地进度，避免管理员新建的 Day 刷新后“已完成”状态被初始过滤丢掉
        const localSigned = filterGateInvalidSignedDays(getRoleJson('wwcxrl-signed-days', []))
        const localCompleted = filterGateInvalidSignedDays(getRoleJson('wwcxrl-completed-days', []))
        setSigned(previous => sameNumberArray(previous, localSigned) ? previous : localSigned)
        setCompletedTasks(previous => sameNumberArray(previous, localCompleted) ? previous : localCompleted)
      }).catch(error => console.warn('[wwcxrl tasks] hydrate failed', error.message))
    }
    refreshTasks()
    const handleTasksUpdated = () => { if (alive) setItems(getDailyAdventures()) }
    window.addEventListener('wwcxrl-tasks-updated', handleTasksUpdated)
    // 本地模式：管理页在另一个标签页发布/删除任务后，这里自动重新加载并刷新星图；
    // 切回本标签页（focus / visibilitychange）时也会重读一次，避免看到旧数据。
    const handleAdminLocalStorage = (event) => {
      if (!alive || event.key !== ADMIN_LOCAL_TASKS_KEY) return
      refreshTasks()
    }
    const handleFocus = () => refreshTasks()
    const handleVisibility = () => { if (!document.hidden) refreshTasks() }
    window.addEventListener('storage', handleAdminLocalStorage)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      alive = false
      window.removeEventListener('wwcxrl-tasks-updated', handleTasksUpdated)
      window.removeEventListener('storage', handleAdminLocalStorage)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  function completeTask(day) {
    const alreadyCompleted = getRoleJson('wwcxrl-completed-days', []).includes(day)
    setCompletedTasks(previous => {
      if (previous.includes(day)) return previous
      const next = Array.from(new Set([...previous, day])).sort((a, b) => a - b)
      setRoleJson('wwcxrl-completed-days', next)
      window.dispatchEvent(new CustomEvent('wwcxrl-progress-updated', { detail: { completedDays: next, day } }))
      const completedItem = items.find(item => item.day === day)
      logCloudEvent('task_completed', { day }, day)
      return next
    })
    if (!alreadyCompleted && day === 300) {
      const nextBag = addBackpackItems([{ id: 'day300_badge', count: 1 }])
      syncCloudBackpack(nextBag)
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '获得道具：300天纪念徽章，它带着盖章动画去小背包啦。' }))
    }
  }

  function signToday() {
    if (isChildrenSpecialPostponed(selected)) {
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: CHILDREN_POSTPONED_MESSAGE }))
      return
    }
    if (!unlocked || !taskCompleted) return
    const next = Array.from(new Set([...signed, selected.day])).sort((a, b) => a - b)
    setSigned(next)
    setRoleJson('wwcxrl-signed-days', next)
    window.dispatchEvent(new Event('wwcxrl-signed-updated'))
    markCloudSigned(selected.day, selected.date)
    logCloudEvent('signed_day', { day: selected.day, title: selected.title }, selected.day)
    if (selected.day === 300) {
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '300 天纪念日已签到，未来的日子继续温柔铺开。' }))
    }
  }

  function selectDay(item) {
    if (isChildrenSpecialPostponed(item)) {
      setSelectedDay(item.day)
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: CHILDREN_POSTPONED_MESSAGE }))
      logCloudEvent('children_special_postponed_click', { day: item.day, title: item.title }, item.day)
      return
    }
    setSelectedDay(item.day)
  }

  return (
    <section className="content-section checkin-section">
      <header className="section-heading playful-heading">
        <span>300 → 365</span>
        <h2>300→365每日签到星图</h2>
        <p>每天打开一格星图：已经抵达的日子，完成小任务就能点亮签到；还没到来的格子，先保持一点神秘。</p>
        <p className="daily-refresh-note">每日更新次日签到任务</p>
      </header>
      <div className="checkin-layout">
        <aside className="calendar-card sticker-card">
          <div className="calendar-topline">
            <strong>签到进度</strong>
            <span>{signed.length}/65</span>
          </div>
          <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
          <div className="day-grid">
            {visibleDailyItems.map(item => {
              const unlockedDay = isUnlocked(item)
              const done = signed.includes(item.day)
              const completed = completedTasks.includes(item.day)
              const isFutureSlot = item.type === 'futureLocked'
              const today = !isFutureSlot && item.day === todayDay && item.date === todayKey
              const selected = selectedDay === item.day
              const postponed = isChildrenSpecialPostponed(item)
              const statusText = isFutureSlot ? '锁定' : postponed ? '延期' : done ? '已签' : today ? '今日' : !unlockedDay ? '未解锁' : completed ? '待签' : '可做'
              return (
                <button
                  key={item.day}
                  className={`day-dot ${selected ? 'selected' : ''} ${unlockedDay && !postponed ? 'open' : 'locked'} ${postponed ? 'postponed' : ''} ${done ? 'done' : ''} ${completed && !done ? 'completed' : ''} ${today ? 'today' : ''}`}
                  onClick={() => { if (unlockedDay && !isFutureSlot) selectDay(item) }}
                  title={`${item.date} ${item.title} · ${statusText}`}
                  aria-label={`Day ${item.day}，${item.title}，${statusText}`}
                  disabled={isFutureSlot || !unlockedDay}
                >
                  <span className="day-dot-icon">{isFutureSlot ? '🔒' : postponed ? '🔒' : done ? '💖' : unlockedDay ? item.icon : '🔒'}</span>
                  <small>Day {item.day}</small>
                  <em className="day-status-badge">{statusText}</em>
                </button>
              )
            })}
          </div>
        </aside>
        <DailyPanel item={selected} unlocked={unlocked} resetAvailable={resetAvailable} signed={signed.includes(selected.day)} taskCompleted={taskCompleted} onTaskComplete={completeTask} onSign={signToday} />
      </div>
    </section>
  )
}

const NEWBIE_DAY_HINTS = {
  1: '先读题，在输入框写下你的答案；回答正确后，底部“点击签到”会亮起。',
  2: '依次完成两条谜题，打开礼物，再点火柴盒点燃烟花；火柴盒和剩余火柴会进入背包。',
  3: '按卡片提示画出奶泡图案；审核通过后得到奇怪的钥匙，它会在 Day 05 打开木门。',
  5: '先点“划亮火柴”，再用键盘/WASD或方向按钮走迷宫；到门前点“使用钥匙开门”，全站会进入深空。',
  8: '先点进入观测模式，清掉云、找五颗星，再点击小柚子收集 0.09 点光；读完故事即可签到。'
}

function DailyPanel({ item, unlocked, resetAvailable = unlocked, signed, taskCompleted, onTaskComplete, onSign }) {
  const [bagVersion, setBagVersion] = useState(0)
  const [day8Resetting, setDay8Resetting] = useState(false)
  const [day9Resetting, setDay9Resetting] = useState(false)
  const [childrenResetting, setChildrenResetting] = useState(false)
  const [sleepResetting, setSleepResetting] = useState(false)
  const [genericResetting, setGenericResetting] = useState(false)
  React.useEffect(() => {
    const refresh = () => setBagVersion(value => value + 1)
    window.addEventListener('wwcxrl-backpack-updated', refresh)
    return () => window.removeEventListener('wwcxrl-backpack-updated', refresh)
  }, [])
  void bagVersion
  const signBlockedReason = !unlocked
    ? '还没有到这一天，先让小星球继续转一会儿。'
    : signed
      ? '今日签到已经盖章完成。'
      : !taskCompleted
        ? '先完成上面的今日任务，签到按钮就会亮起来。'
        : '任务完成啦，可以点击签到。'
  const panelStatus = signed ? '已签到' : taskCompleted ? '待签到' : unlocked ? '任务进行中' : '未解锁'
  const signDisabled = !unlocked || signed || !taskCompleted
  const signButtonLabel = signed
    ? '💖 已签到'
    : !unlocked
      ? '🔒 还没到这一天'
      : !taskCompleted
        ? item.type === 'vacationBreak'
          ? '🛋️ 完成休息布置后可签到'
          : CHILDREN_SPECIAL_TYPES.includes(item.type)
            ? '🏸 哄好小柚子后可签到'
            : item.type === 'sleepAtmosphereLab'
              ? '💤 小柚子获得道具后可签到'
              : item.type === 'flowerCrown'
                ? '🌸 给小柚子戴上花环后可签到'
                : item.type === 'photoWallFinale'
                  ? '🖼️ 补满照片墙后可签到'
                  : item.type === 'fortune'
                    ? '🥚 砸开金蛋后可签到'
                    : '🍊 完成任务后可签到'
        : '🍊 点击签到'
  const showDay8Reset = item.day === 8 && resetAvailable
  const showDay9Reset = item.day === 9 && resetAvailable
  const childrenResetConfig = CHILDREN_RESET_CONFIG[item.day]
  const sleepResetConfig = SLEEP_LAB_RESET_CONFIG[item.day]
  const genericResetConfig = GENERIC_DAY_RESET_CONFIG[item.day] || { label: `重置${item.date.slice(5).replace('-', '')}`, toast: `${item.date.slice(5).replace('-', '')} 已重置，可以重新体验这一天啦。` }
  const showGenericReset = resetAvailable && item.type !== 'fortune' && !showDay8Reset && !showDay9Reset && !childrenResetConfig && !sleepResetConfig

  async function handleDay8ResetClick() {
    if (day8Resetting) return
    setDay8Resetting(true)
    try {
      await resetDay8OneLightYearSignal()
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '527 已重置，可以重新体验 1 光年信号啦。' }))
    } finally {
      setDay8Resetting(false)
    }
  }

  async function handleDay9ResetClick() {
    if (day9Resetting) return
    setDay9Resetting(true)
    try {
      await resetDay9VacationBreak()
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '528 已重置，可以重新布置小柚子的假期啦。' }))
    } finally {
      setDay9Resetting(false)
    }
  }

  async function handleChildrenResetClick() {
    if (childrenResetting || !childrenResetConfig) return
    setChildrenResetting(true)
    try {
      await resetChildrenSpecialDay(item.day)
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: childrenResetConfig.toast }))
    } finally {
      setChildrenResetting(false)
    }
  }

  async function handleSleepResetClick() {
    if (sleepResetting || !sleepResetConfig) return
    setSleepResetting(true)
    try {
      await resetSleepLabDay(item.day)
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: sleepResetConfig.toast }))
    } finally {
      setSleepResetting(false)
    }
  }

  async function handleGenericResetClick() {
    if (genericResetting) return
    setGenericResetting(true)
    try {
      await resetGenericDay(item)
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: genericResetConfig.toast }))
    } finally {
      setGenericResetting(false)
    }
  }

  return (
    <article className={`daily-panel sticker-card type-${item.type} ${unlocked ? 'is-open' : 'is-locked'} ${signed ? 'is-signed' : ''} ${taskCompleted && !signed ? 'is-ready-to-sign' : ''}`}>
      {showDay8Reset && (
        <button
          type="button"
          className="day8-corner-reset"
          onClick={handleDay8ResetClick}
          disabled={day8Resetting}
          title="重置 527 的观测游戏、任务完成状态和签到"
          aria-label="重置 527 签到和观测游戏进度"
        >
          {day8Resetting ? '重置中…' : '重置527'}
        </button>
      )}
      {showDay9Reset && (
        <button
          type="button"
          className="day8-corner-reset day9-corner-reset"
          onClick={handleDay9ResetClick}
          disabled={day9Resetting}
          title="重置 528 的休息布置、任务完成状态和签到"
          aria-label="重置 528 签到和小柚子的假期进度"
        >
          {day9Resetting ? '重置中…' : '重置528'}
        </button>
      )}
      {childrenResetConfig && resetAvailable && (
        <button
          type="button"
          className="day8-corner-reset children-corner-reset"
          onClick={handleChildrenResetClick}
          disabled={childrenResetting}
          title={`重置 ${childrenResetConfig.label.replace('重置', '')} 的哄哄小柚子进度、任务完成状态和签到`}
          aria-label={`重置 ${childrenResetConfig.label.replace('重置', '')} 签到和儿童节专题进度`}
        >
          {childrenResetting ? '重置中…' : childrenResetConfig.label}
        </button>
      )}
      {sleepResetConfig && resetAvailable && (
        <button
          type="button"
          className="day8-corner-reset children-corner-reset sleep-corner-reset"
          onClick={handleSleepResetClick}
          disabled={sleepResetting}
          title="重置 603 的睡眠氛围研究所、任务完成状态和签到"
          aria-label="重置 603 签到和睡眠氛围研究所进度"
        >
          {sleepResetting ? '重置中…' : sleepResetConfig.label}
        </button>
      )}
      {showGenericReset && (
        <button
          type="button"
          className="day8-corner-reset generic-corner-reset"
          onClick={handleGenericResetClick}
          disabled={genericResetting}
          title={`重置 ${genericResetConfig.label.replace('重置', '')} 的任务完成状态和签到；只清理这一天的配套进度`}
          aria-label={`重置 ${genericResetConfig.label.replace('重置', '')} 当天签到和任务进度`}
        >
          {genericResetting ? '重置中…' : genericResetConfig.label}
        </button>
      )}
      <div className="daily-header">
        <div className="daily-icon">{unlocked ? item.icon : '🔒'}</div>
        <div>
          <div className="daily-meta-row">
            <div className="tiny-label">Day {String(item.day).padStart(2, '0')} · {item.date}</div>
            <span className={`daily-status-pill ${signed ? 'signed' : taskCompleted ? 'ready' : unlocked ? 'working' : 'locked'}`}>{panelStatus}</span>
          </div>
          <h3>{item.title}</h3>
          {item.type !== 'memoryPuzzle' ? <p>{item.theme} / {item.reward}</p> : null}
        </div>
      </div>
      {unlocked && NEWBIE_DAY_HINTS[item.day] && <aside className="daily-newbie-hint" role="note"><strong>现在玩这里：</strong>{NEWBIE_DAY_HINTS[item.day]}</aside>}
      <div className="daily-body">
        {unlocked && item.prompt && item.type !== 'foamDrawingReview' ? <p>{item.prompt}</p> : null}
        {unlocked ? <DailyInteraction item={item} signed={signed} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} /> : <LockedPreview item={item} />}
      </div>
      <div className="daily-actions">
        <button className={`sign-button ${taskCompleted && !signed && unlocked ? 'ready' : ''}`} disabled={signDisabled} onClick={onSign}>{signButtonLabel}</button>
        <p className={`sign-helper ${taskCompleted && !signed && unlocked ? 'ready' : ''}`}>{signBlockedReason}</p>
      </div>
    </article>
  )
}

function LockedPreview({ item }) {
  return (
    <div className="locked-preview">
      <span>{item.icon}</span>
      <strong>{item.theme}</strong>
      <small>未来会解锁：{item.reward}</small>
    </div>
  )
}


function normalizeRiddleText(value) {
  return String(value || '').replace(/[\s·。！？!?,，、：“”"'‘’（）()]/g, '').toLowerCase()
}

function loadDay2State() {
  return loadJsonStorage(DAY2_STATE_KEY, {
    step: 1,
    giftReady: false,
    giftOpened: false,
    hasFirework: false,
    hasMatchbox: false,
    matches: 0,
    selectedMatch: false,
    litMatch: false,
    fireworksStarted: false,
    backpackSaved: false
  })
}

function saveDay2State(next) {
  setRoleJson(DAY2_STATE_KEY, next)
}

function SerialRiddleFirework({ item, taskCompleted, onTaskComplete }) {
  const [state, setState] = useState(loadDay2State)
  const [firstLine, setFirstLine] = useState('')
  const [secondLine, setSecondLine] = useState('')
  const [codeAnswer, setCodeAnswer] = useState('')
  const [poemAnswer, setPoemAnswer] = useState('')
  const [note, setNote] = useState(taskCompleted ? '烟花已经成功燃放，今天的签到按钮可以点击啦。' : '先翻译第一张提示图上的内容。')
  const [showFireworks, setShowFireworks] = useState(false)
  const [rewardPopup, setRewardPopup] = useState(null)

  React.useEffect(() => {
    let alive = true
    loadCloudDayProgress(item.day).then(remote => {
      if (!alive || !remote?.progress) return
      saveDay2State(remote.progress)
      setState(remote.progress)
      if (remote.progress.fireworksStarted) setNote('烟花已经成功燃放，今天的签到按钮可以点击啦。')
    }).catch(error => console.warn('[wwcxrl cloud] day2 progress load failed', error.message))
    return () => { alive = false }
  }, [item.day])

  function update(nextPatch, nextNote, eventType = 'day2_progress') {
    setState(previous => {
      const next = { ...previous, ...nextPatch }
      saveDay2State(next)
      saveCloudDayProgress(item.day, next)
      logCloudEvent(eventType, { patch: nextPatch, state: next, note: nextNote }, item.day)
      return next
    })
    if (nextNote) setNote(nextNote)
  }


  function showRewardPopup(item) {
    setRewardPopup({ id: `${item.title}-${Date.now()}`, ...item })
  }

  function closeRewardPopup() {
    setRewardPopup(null)
  }

  function checkFirst() {
    const ok = normalizeRiddleText(firstLine) === normalizeRiddleText('看不懂吗') && normalizeRiddleText(secondLine) === normalizeRiddleText('我打小不聪明')
    if (!ok) {
      setNote('答案不对哦，再想想吧~')
      logCloudEvent('day2_answer_wrong', { question: 1, firstLine, secondLine }, item.day)
      return
    }
    update({ step: 1, giftReady: true }, '第一题正确！请点击礼物盒，看看里面藏了什么。', 'day2_answer_correct_q1')
  }

  function openGift() {
    if (!state.giftReady || state.giftOpened) return
    update({ giftOpened: true, hasFirework: true, step: 2 }, '你获得一颗专属烟花！烟花先乖乖躺在发射台上。第二题出现啦。', 'day2_gift_opened')
    showRewardPopup({ icon: '🎆', title: '获得一颗专属烟花', text: '它还没有燃放，正在等一根小火柴把天空点亮。' })
  }

  function checkSecond() {
    if (normalizeRiddleText(codeAnswer) !== '962464') {
      setNote('答案不对哦，再想想吧~')
      logCloudEvent('day2_answer_wrong', { question: 2, answer: codeAnswer }, item.day)
      return
    }
    update({ step: 3, hasMatchbox: true }, '第二题正确！你获得空空的火柴盒，似乎可以用来点火柴。', 'day2_answer_correct_q2')
    showRewardPopup({ icon: '🧰', title: '获得空空的火柴盒', text: '盒子里暂时空空的，但它可以擦亮一根火柴。' })
  }

  function checkThird() {
    if (normalizeRiddleText(poemAnswer) !== normalizeRiddleText('执子之手与子偕老')) {
      setNote('答案不对哦，再想想吧~')
      logCloudEvent('day2_answer_wrong', { question: 3, answer: poemAnswer }, item.day)
      return
    }
    update({ matches: 3 }, '第三题正确！你获得三根火柴。先点击一根火柴，再点击火柴盒。', 'day2_answer_correct_q3')
    showRewardPopup({ icon: '🪄', title: '获得三根火柴', text: '先拿起一根，再去火柴盒边轻轻一擦。' })
  }

  function selectMatch() {
    if (state.matches <= 0 || state.litMatch || state.fireworksStarted) return
    update({ selectedMatch: true }, '已拿起一根火柴。现在点击火柴盒，把它擦亮。', 'day2_match_selected')
  }

  function strikeMatchbox() {
    if (!state.hasMatchbox || !state.selectedMatch || state.litMatch || state.fireworksStarted) return
    update({ selectedMatch: false, litMatch: true, matches: Math.max(0, state.matches - 1) }, '火柴点燃啦！用点燃的火柴点击那颗专属烟花。', 'day2_match_lit')
    showRewardPopup({ icon: '🔥', title: '获得点燃的火柴', text: '火光已经准备好啦，现在点击专属烟花。' })
  }

  function launchFirework() {
    if (!state.hasFirework || !state.litMatch || state.fireworksStarted) return
    const nextMatches = Math.max(0, state.matches)
    update({ litMatch: false, fireworksStarted: true, backpackSaved: true }, '烟花燃放成功！小琳521快乐。剩余火柴和火柴盒已经收入小背包。', 'day2_firework_launched')
    setShowFireworks(true)
    window.setTimeout(() => setShowFireworks(false), 26000)
    if (!state.backpackSaved) {
      const nextBag = addBackpackItems([{ id: 'matchbox', count: 1 }, { id: 'match', count: nextMatches }])
      syncCloudBackpack(nextBag)
    }
    showRewardPopup({ icon: '🎒', title: '剩余道具已收入小背包', text: `火柴盒 × 1，剩余火柴 × ${nextMatches}。后面的日子也许会用到它们。` })
    markCloudTaskCompleted(item.day, item.date)
    logCloudEvent('day2_task_completed', { nextMatches }, item.day)
    onTaskComplete(item.day)
  }

  return (
    <div className={`serial-riddle-game ${showFireworks ? 'fireworks-on' : ''}`}>
      {rewardPopup && (
        <div className="reward-popup-backdrop" role="dialog" aria-label={rewardPopup.title} onClick={closeRewardPopup}>
          <div className="reward-popup-card" onClick={event => event.stopPropagation()}>
            <button type="button" className="reward-popup-close" onClick={closeRewardPopup}>×</button>
            <div className="reward-popup-icon">{rewardPopup.icon}</div>
            <div className="tiny-label">道具获得</div>
            <h4>{rewardPopup.title}</h4>
            <p>{rewardPopup.text}</p>
            <button type="button" onClick={closeRewardPopup}>收下啦</button>
          </div>
        </div>
      )}
      <div className="riddle-progress-strip">
        {['翻译谜题', '数字暗号', '长久密语', '点燃烟花'].map((label, index) => (
          <span key={label} className={state.step > index || state.fireworksStarted ? 'done' : state.step === index + 1 ? 'active' : ''}>
            {index + 1}. {label}
          </span>
        ))}
      </div>

      <div className="serial-riddle-layout">
        <section className="riddle-card cartoon-card">
          {state.step === 1 && !state.giftReady && (
            <>
              <div className="tiny-label">第一题 · 翻译以下内容</div>
              <div className="day2-image-card"><img src={item.image} alt="2025年5月21日谜题提示图" /></div>
              <div className="two-answer-grid">
                <label>第一句<input value={firstLine} onChange={event => setFirstLine(event.target.value)} placeholder="输入第一句话" /></label>
                <label>第二句<input value={secondLine} onChange={event => setSecondLine(event.target.value)} placeholder="输入第二句话" /></label>
              </div>
              <button type="button" onClick={checkFirst}>确认翻译</button>
            </>
          )}

          {state.giftReady && !state.giftOpened && (
            <div className="gift-unlock-card">
              <div className="tiny-label">第一题正确</div>
              <h4>礼物盒在轻轻发光</h4>
              <p>请点击右侧礼物盒，领取第一件通关道具。</p>
            </div>
          )}

          {state.step === 2 && state.giftOpened && (
            <>
              <div className="tiny-label">第二题 · 卡通字暗号</div>
              <div className="cartoon-love-words" aria-label="我爱你"><span>我</span><span>爱</span><span>你</span></div>
              <input className="single-riddle-input" value={codeAnswer} onChange={event => setCodeAnswer(event.target.value)} inputMode="numeric" placeholder="输入 6 位数字暗号" />
              <button type="button" onClick={checkSecond}>提交第二题</button>
            </>
          )}

          {state.step === 3 && state.hasMatchbox && state.matches === 0 && (
            <>
              <div className="tiny-label">第三题 · 数字长信</div>
              <div className="number-riddle">9449494474689894943526</div>
              <input className="single-riddle-input" value={poemAnswer} onChange={event => setPoemAnswer(event.target.value)} placeholder="输入最后一句答案" />
              <button type="button" onClick={checkThird}>提交第三题</button>
            </>
          )}

          {state.matches > 0 && !state.fireworksStarted && (
            <div className="final-tool-card">
              <div className="tiny-label">三题全部答对</div>
              <h4>现在可以点燃专属烟花啦</h4>
              <p>操作顺序：点击一根火柴 → 点击火柴盒 → 用点燃的火柴点击烟花。</p>
            </div>
          )}

          {state.fireworksStarted && (
            <div className="firework-success-card">
              <div className="tiny-label">烟花燃放成功</div>
              <h4>小琳521快乐</h4>
              <p>今天的谜题已经通关，签到按钮已经开放啦。</p>
            </div>
          )}
        </section>

        <section className="firework-stage cartoon-card">
          <div className="stage-skyline" aria-hidden="true">
            <span className="stage-star s1">✦</span>
            <span className="stage-star s2">♡</span>
            <span className="stage-star s3">✧</span>
            <span className="stage-moon">☾</span>
            <span className="stage-cloud c1" />
            <span className="stage-cloud c2" />
          </div>

          <div className="prop-stage-title">
            <span>道具发射台</span>
            <strong>{showFireworks ? '烟花正在天空绽放' : state.fireworksStarted ? '烟花已经燃放成功' : state.litMatch ? '用火光唤醒专属烟花' : state.selectedMatch ? '把火柴擦亮' : '收集道具，准备点火'}</strong>
          </div>

          <div className="prop-stage-row">
            <button type="button" className={`gift-box deluxe-gift ${state.giftReady ? 'is-ready' : ''} ${state.giftOpened ? 'is-open' : ''}`} onClick={openGift} disabled={!state.giftReady || state.giftOpened}>
              <span className="gift-sparkle">✦ ♡ ✦</span>
              <span className="gift-bow left" />
              <span className="gift-bow right" />
              <span className="gift-lid" />
              <span className="gift-body" />
              <span className="gift-ribbon horizontal" />
              <span className="gift-tag">521</span>
              <strong>{state.giftOpened ? '烟花已领取' : state.giftReady ? '点我拆礼物' : '神秘礼物盒'}</strong>
            </button>

            {state.hasFirework && (
              <button type="button" className={`cartoon-firework deluxe-firework ${state.litMatch ? 'ready-to-light' : ''} ${state.fireworksStarted ? 'is-launched' : ''}`} onClick={launchFirework} disabled={!state.litMatch || state.fireworksStarted} aria-label="专属烟花">
                <span className="firework-cap" />
                <span className="firework-face"><i /><i /><b /></span>
                <span className="firework-cone" />
                <span className="firework-band band-one" />
                <span className="firework-band band-two" />
                <span className="firework-fuse" />
                <span className="firework-stick" />
                <small>{state.fireworksStarted ? '已燃放' : state.litMatch ? '点击燃放' : '专属烟花待点火'}</small>
              </button>
            )}
          </div>

          <div className="tool-shelf deluxe-tool-shelf">
            <span className="tool-shelf-label">道具托盘</span>
            {state.hasMatchbox && <button type="button" className={`matchbox deluxe-matchbox ${state.selectedMatch ? 'can-strike' : ''}`} onClick={strikeMatchbox}><i />火柴盒</button>}
            {Array.from({ length: state.matches }, (_, index) => (
              <button type="button" key={index} className={`match-stick deluxe-match ${state.selectedMatch && index === 0 ? 'selected' : ''}`} onClick={selectMatch}>火柴</button>
            ))}
            {state.litMatch && <span className="lit-match deluxe-lit-match">点燃的火柴</span>}
          </div>
        </section>
      </div>

      <p className="riddle-status-note">{note}</p>

      {showFireworks && (
        <div className="wwcxrl-celebration-overlay" aria-hidden="true">
          <div className="wwcxrl-night-sky" />
          <div className="wwcxrl-launch-scene">
            <span className="wwcxrl-launch-tube" />
            <span className="wwcxrl-launch-flame" />
            <span className="wwcxrl-launch-smoke" />
          </div>
          {Array.from({ length: 7 }, (_, index) => <i className="wwcxrl-rocket-trail" key={`rocket-${index}`} style={{ '--i': index }} />)}
          {Array.from({ length: 16 }, (_, index) => <span className="wwcxrl-burst" key={`burst-${index}`} style={{ '--i': index }} />)}
          {Array.from({ length: 78 }, (_, index) => <b className="wwcxrl-particle" key={`particle-${index}`} style={{ '--i': index }} />)}
          {Array.from({ length: 32 }, (_, index) => <em className="wwcxrl-heart-spark" key={`heart-${index}`} style={{ '--i': index }}>♡</em>)}
          <div className="wwcxrl-final-title">
            <span>小琳</span>
            <span>521</span>
            <span>快乐</span>
          </div>
        </div>
      )}
    </div>
  )
}



function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
  const binary = atob(base64 || '')
  const array = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) array[index] = binary.charCodeAt(index)
  return new Blob([array], { type: mime })
}

const DAY3_PROGRESS_KEY = 'wwcxrl-day3-foam-progress'
const DAY3_EMPTY_PROGRESS = {
  smile: { status: 'draft', imageUrl: '', imagePath: '', submittedAt: '' },
  heart: { status: 'locked', imageUrl: '', imagePath: '', submittedAt: '' }
}

function normalizeDay3Progress(progress = {}) {
  const smile = { ...DAY3_EMPTY_PROGRESS.smile, ...(progress.smile || {}) }
  if (!['approved', 'submitted'].includes(smile.status)) smile.status = 'draft'
  const heartDefault = smile.status === 'approved' ? { ...DAY3_EMPTY_PROGRESS.heart, status: 'draft' } : DAY3_EMPTY_PROGRESS.heart
  const heart = { ...heartDefault, ...(progress.heart || {}) }
  if (!['approved', 'submitted'].includes(heart.status)) heart.status = smile.status === 'approved' ? 'draft' : 'locked'
  return { ...progress, smile, heart }
}

function loadDay3LocalProgress() {
  return normalizeDay3Progress(loadJsonStorage(DAY3_PROGRESS_KEY, DAY3_EMPTY_PROGRESS))
}

function saveDay3LocalProgress(progress) {
  const normalized = normalizeDay3Progress(progress)
  setRoleJson(DAY3_PROGRESS_KEY, normalized)
  return normalized
}

async function loadCloudDayProgress(day, { reviewMode = false } = {}) {
  const supabase = await getSupabase()
  const identity = getCloudIdentity()
  if (!supabase || !identity) return null
  let query = supabase
    .from('wwcxrl_day_progress')
    .select('user_id, progress_json, updated_at')
    .eq('day', day)

  if (reviewMode) {
    query = query.eq('user_id', 'wwcxrl-pomelo-main').limit(1)
  } else {
    query = query.eq('user_id', identity.id).limit(1)
  }

  const { data, error } = await query
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? { progress: row.progress_json || null, userId: row.user_id || null } : null
}

async function uploadDay3Drawing(stage, dataUrl) {
  await logCloudEvent('day3_drawing_upload_start', { stage }, 3)
  const supabase = await getSupabase()
  const identity = getCloudIdentity()
  if (!supabase || !identity) return null
  const blob = await dataUrlToBlob(dataUrl)
  const path = `${identity.role}/${identity.id}/day3-${stage}-${Date.now()}.png`
  const { error: uploadError } = await supabase.storage.from('wwcxrl-photos').upload(path, blob, {
    contentType: 'image/png',
    upsert: true
  })
  if (uploadError) throw uploadError
  const { data: publicData } = supabase.storage.from('wwcxrl-photos').getPublicUrl(path)
  return { imageUrl: publicData.publicUrl, imagePath: path }
}

function getDay3StageReward(stageName) {
  return stageName === 'heart'
    ? { id: 'coffee_cup', icon: '☕', title: '获得咖啡一杯', text: '它被放进小背包啦。' }
    : { id: 'magic_wand', icon: '🪄', title: '获得魔法棒一根', text: '不知道干什么用的。' }
}

function getNewlyApprovedDay3Stage(previous, next) {
  if (previous?.smile?.status !== 'approved' && next?.smile?.status === 'approved') return 'smile'
  if (previous?.heart?.status !== 'approved' && next?.heart?.status === 'approved') return 'heart'
  return null
}

function FoamDrawingReview({ item, taskCompleted, onTaskComplete }) {
  const canvasRef = React.useRef(null)
  const imageRef = React.useRef(null)
  const isDrawingRef = React.useRef(false)
  const lastPointRef = React.useRef(null)
  const [progress, setProgress] = useState(loadDay3LocalProgress)
  const [activeStage, setActiveStage] = useState(() => loadDay3LocalProgress().smile.status === 'approved' ? 'heart' : 'smile')
  const [note, setNote] = useState('尝试用画笔画一画吧~')
  const [busy, setBusy] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const [brushSize, setBrushSize] = useState(7)
  const [rewardPopup, setRewardPopup] = useState(null)
  const [replayingStages, setReplayingStages] = useState({ smile: false, heart: false })
  const [cloudProgressUserId, setCloudProgressUserId] = useState(null)
  const previousProgressRef = React.useRef(loadDay3LocalProgress())
  const manualStageChoiceRef = React.useRef(false)
  const localSubmissionOwnerRef = React.useRef(null)
  const stage = activeStage === 'heart' ? progress.heart : progress.smile
  const stageApproved = stage.status === 'approved'
  const stageReplaying = !!replayingStages[activeStage]
  const ownerDevice = typeof window !== 'undefined' && localStorage.getItem('wwcxrl-owner-device') === 'yes'
  const stageSubmitted = stage.status === 'submitted'
  const stageLocked = (stageApproved && !stageReplaying) || (stageSubmitted && !ownerDevice)
  const bothApproved = progress.smile.status === 'approved' && progress.heart.status === 'approved'
  const referenceImage = activeStage === 'heart' ? item.heartReference : item.smileReference
  const stageTitle = activeStage === 'heart' ? '第二杯 · 另一个版本' : '第一杯 · 奶泡表情'
  const stageHint = activeStage === 'heart'
    ? '再试着画出小琛后来补上的另一个版本。'
    : '照着奶泡里那团白白的形状，画出你看到的表情。'

  React.useEffect(() => {
    let alive = true
    const refreshCloudProgress = () => {
      loadCloudDayProgress(item.day, { reviewMode: ownerDevice && !localSubmissionOwnerRef.current })
      .then(remote => {
        if (!alive || !remote?.progress) return
        const previous = previousProgressRef.current
        const next = saveDay3LocalProgress(remote.progress)
        const newlyApprovedStage = getNewlyApprovedDay3Stage(previous, next)
        previousProgressRef.current = next
        setProgress(next)
        setCloudProgressUserId(remote.userId || null)
        const shouldShowRecipientReward = !ownerDevice && newlyApprovedStage
        if (shouldShowRecipientReward) {
          const reward = getDay3StageReward(newlyApprovedStage)
          setRewardPopup(reward)
        }
        if (!manualStageChoiceRef.current) {
          if (next.smile.status === 'submitted') setActiveStage('smile')
          else if (newlyApprovedStage === 'smile') setActiveStage('heart')
          else if (next.smile.status !== 'approved') setActiveStage('smile')
        }
      })
      .catch(error => console.warn('[wwcxrl cloud] day3 progress load failed', error.message))
    }
    refreshCloudProgress()
    const intervalId = window.setInterval(refreshCloudProgress, ownerDevice ? 3000 : 5000)
    const handleFocus = () => refreshCloudProgress()
    const handleVisibility = () => { if (!document.hidden) refreshCloudProgress() }
    const handleSignedUpdate = () => setSigned(getRoleJson('wwcxrl-signed-days', []))
    window.addEventListener('focus', handleFocus)
    window.addEventListener('wwcxrl-signed-updated', handleSignedUpdate)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      alive = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('wwcxrl-signed-updated', handleSignedUpdate)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [item.day, ownerDevice])

  React.useEffect(() => {
    const nextBothApproved = progress.smile.status === 'approved' && progress.heart.status === 'approved'
    if (nextBothApproved) {
      setNote('两杯奶泡都通过啦，今天的签到按钮可以点击了。')
      onTaskComplete(item.day)
    }
  }, [progress, activeStage, item.day, onTaskComplete])

  React.useEffect(() => {
    resetCanvas()
  }, [activeStage])

  function getProgressTargetUserId(eventType = '') {
    if (!ownerDevice || !cloudProgressUserId) return null
    if (localSubmissionOwnerRef.current) return localSubmissionOwnerRef.current
    return eventType.includes('owner_device') ? cloudProgressUserId : null
  }

  function syncProgress(next, eventType = 'day3_progress') {
    const normalized = saveDay3LocalProgress(next)
    previousProgressRef.current = normalized
    setProgress(normalized)
    saveCloudDayProgress(item.day, normalized, getProgressTargetUserId(eventType))
    logCloudEvent(eventType, { stage: activeStage, progress: normalized }, item.day)
    return normalized
  }

  function grantDay3StageReward(stageName) {
    const reward = getDay3StageReward(stageName)
    const identity = getCloudIdentity()
    const targetUserId = localSubmissionOwnerRef.current || (ownerDevice && cloudProgressUserId ? cloudProgressUserId : identity?.id)
    const isReviewingOtherUser = ownerDevice && !localSubmissionOwnerRef.current && targetUserId && identity?.id && targetUserId !== identity.id
    if (isReviewingOtherUser) {
      addCloudBackpackItems([{ id: reward.id, count: 1 }], targetUserId)
      logCloudEvent('day3_stage_reward_saved_for_pomelo', { item: reward.id, stage: stageName, targetUserId }, item.day)
      return
    }
    const currentBag = loadBackpack()
    if (Number(currentBag[reward.id] || 0) > 0) {
      setRewardPopup(reward)
      return
    }
    const nextBag = addBackpackItems([{ id: reward.id, count: 1 }])
    syncCloudBackpack(nextBag)
    logCloudEvent('day3_stage_reward_saved', { item: reward.id, stage: stageName }, item.day)
    setRewardPopup(reward)
  }

  function closeRewardPopup() {
    setRewardPopup(null)
  }

  function startRedrawStage(stageName = activeStage) {
    manualStageChoiceRef.current = true
    setActiveStage(stageName)
    setReplayingStages(previous => ({ ...previous, [stageName]: true }))
    setNote('可以重新画一遍啦。提交后道具已经发放咯~')
    window.requestAnimationFrame(resetCanvas)
  }

  function fitCanvas() {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) return
    const rect = image.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const previous = document.createElement('canvas')
    previous.width = canvas.width
    previous.height = canvas.height
    previous.getContext('2d')?.drawImage(canvas, 0, 0)
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (previous.width && previous.height && hasInk) {
      ctx.drawImage(previous, 0, 0, canvas.width / dpr, canvas.height / dpr)
    }
  }

  function getPoint(event) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function beginDraw(event) {
    if (busy || stageLocked) return
    event.preventDefault()
    fitCanvas()
    isDrawingRef.current = true
    lastPointRef.current = getPoint(event)
    const canvas = canvasRef.current
    canvas.setPointerCapture?.(event.pointerId)
  }

  function moveDraw(event) {
    if (!isDrawingRef.current || busy || stageLocked) return
    event.preventDefault()
    const point = getPoint(event)
    const last = lastPointRef.current || point
    const ctx = canvasRef.current.getContext('2d')
    ctx.strokeStyle = '#e2393c'
    ctx.lineWidth = brushSize
    ctx.shadowColor = 'rgba(226, 57, 60, .28)'
    ctx.shadowBlur = 2
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
    setHasInk(true)
  }

  function endDraw(event) {
    isDrawingRef.current = false
    lastPointRef.current = null
    try { canvasRef.current?.releasePointerCapture?.(event.pointerId) } catch {}
  }

  function resetCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    window.requestAnimationFrame(fitCanvas)
  }

  function canvasHasInk() {
    const canvas = canvasRef.current
    if (!canvas || !canvas.width || !canvas.height) return false
    const ctx = canvas.getContext('2d')
    const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 3; index < sample.length; index += 4) {
      if (sample[index] > 0) return true
    }
    return false
  }

  async function exportDrawing() {
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!image || !canvas) return null
    const out = document.createElement('canvas')
    out.width = image.naturalWidth || canvas.width
    out.height = image.naturalHeight || canvas.height
    const ctx = out.getContext('2d')
    await new Promise(resolve => {
      if (image.complete) resolve()
      else image.onload = resolve
    })
    ctx.drawImage(image, 0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  function bboxFromMask(mask, width, height) {
    let minX = width, minY = height, maxX = -1, maxY = -1, count = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) continue
        count += 1
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (!count) return null
    return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, count }
  }

  function normalizeMask(mask, width, height, box, size = 128) {
    const out = new Uint8Array(size * size)
    if (!box || box.width < 2 || box.height < 2) return out
    const padX = Math.max(6, Math.round(box.width * 0.12))
    const padY = Math.max(6, Math.round(box.height * 0.12))
    const minX = Math.max(0, box.minX - padX)
    const minY = Math.max(0, box.minY - padY)
    const maxX = Math.min(width - 1, box.maxX + padX)
    const maxY = Math.min(height - 1, box.maxY + padY)
    const cropW = Math.max(1, maxX - minX + 1)
    const cropH = Math.max(1, maxY - minY + 1)
    for (let y = 0; y < size; y += 1) {
      const sy = Math.min(height - 1, Math.round(minY + (y / (size - 1)) * (cropH - 1)))
      for (let x = 0; x < size; x += 1) {
        const sx = Math.min(width - 1, Math.round(minX + (x / (size - 1)) * (cropW - 1)))
        if (mask[sy * width + sx]) out[y * size + x] = 1
      }
    }
    return out
  }

  function dilateMask(mask, size, radius) {
    const out = new Uint8Array(size * size)
    const r2 = radius * radius
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!mask[y * size + x]) continue
        for (let dy = -radius; dy <= radius; dy += 1) {
          const yy = y + dy
          if (yy < 0 || yy >= size) continue
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (dx * dx + dy * dy > r2) continue
            const xx = x + dx
            if (xx >= 0 && xx < size) out[yy * size + xx] = 1
          }
        }
      }
    }
    return out
  }

  async function buildReferenceMask(size = 128) {
    const image = new Image()
    image.src = referenceImage
    await image.decode()
    const refCanvas = document.createElement('canvas')
    refCanvas.width = image.naturalWidth
    refCanvas.height = image.naturalHeight
    const refCtx = refCanvas.getContext('2d')
    refCtx.drawImage(image, 0, 0)
    const pixels = refCtx.getImageData(0, 0, refCanvas.width, refCanvas.height).data
    const mask = new Uint8Array(refCanvas.width * refCanvas.height)
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
      if (r > 145 && r > g * 1.35 && r > b * 1.35) mask[p] = 1
    }
    const box = bboxFromMask(mask, refCanvas.width, refCanvas.height)
    return normalizeMask(mask, refCanvas.width, refCanvas.height, box, size)
  }

  async function scoreCurrentDrawing() {
    const canvas = canvasRef.current
    if (!canvas) return { percent: 0, detail: {} }
    const width = canvas.width
    const height = canvas.height
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
    const userMask = new Uint8Array(width * height)
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
      if (pixels[i + 3] > 20) userMask[p] = 1
    }
    const userBox = bboxFromMask(userMask, width, height)
    if (!userBox || userBox.count < 120) return { percent: 0, detail: { reason: 'too_few_pixels' } }
    const size = 128
    const userNorm = normalizeMask(userMask, width, height, userBox, size)
    const refNorm = await buildReferenceMask(size)
    const userWide = dilateMask(userNorm, size, 8)
    const refWide = dilateMask(refNorm, size, 10)
    let userCount = 0, refCount = 0, userHit = 0, refHit = 0
    for (let i = 0; i < size * size; i += 1) {
      if (userNorm[i]) {
        userCount += 1
        if (refWide[i]) userHit += 1
      }
      if (refNorm[i]) {
        refCount += 1
        if (userWide[i]) refHit += 1
      }
    }
    const userRate = userCount ? userHit / userCount : 0
    const refRate = refCount ? refHit / refCount : 0
    const aspect = userBox.width / Math.max(1, userBox.height)
    const expectedAspect = 0.85
    const aspectScore = Math.max(0, 1 - Math.abs(Math.log(aspect / expectedAspect)) / 1.15)
    const percent = Math.round(Math.max(0, Math.min(1, userRate * 0.42 + refRate * 0.48 + aspectScore * 0.10)) * 100)
    return { percent, detail: { userRate, refRate, aspectScore, userPixels: userBox.count, aspect } }
  }

  async function submitDrawing() {
    if (!hasInk && !canvasHasInk()) {
      setNote('先在咖啡奶泡上画几笔，再提交看看像不像。')
      return
    }
    setBusy(true)
    try {
      if (stageApproved) {
        setReplayingStages(previous => ({ ...previous, [activeStage]: false }))
        setNote('道具已经发放咯~')
        logCloudEvent('day3_redraw_submitted_no_reward', { stage: activeStage }, item.day)
        resetCanvas()
        return
      }

      const dataUrl = await exportDrawing()
      let uploaded = null
      try {
        uploaded = await uploadDay3Drawing(activeStage, dataUrl)
      } catch (uploadError) {
        console.warn('[wwcxrl day3] drawing upload failed', uploadError.message)
      }
      const localPreview = uploaded?.imageUrl || dataUrl
      const next = {
        ...progress,
        [activeStage]: {
          ...progress[activeStage],
          status: 'submitted',
          imageUrl: localPreview,
          imagePath: uploaded?.imagePath || '',
          submittedAt: new Date().toISOString(),
          approvedAt: '',
          approvedBy: ''
        }
      }
      if (ownerDevice) {
        const identity = getCloudIdentity()
        localSubmissionOwnerRef.current = identity?.id || null
        setCloudProgressUserId(identity?.id || null)
      }
      syncProgress(next, `day3_${activeStage}_submitted_for_check`)
      setNote('已经提交啦，等小琛检查盖章~')
      resetCanvas()
    } catch (error) {
      console.warn('[wwcxrl day3] drawing submit failed', error)
      setNote('提交时出了点小问题，可以先别刷新，再试一次。')
    } finally {
      setBusy(false)
    }
  }

  function approveCurrentStage() {
    if (!ownerDevice || stageApproved) return
    const next = {
      ...progress,
      [activeStage]: {
        ...progress[activeStage],
        status: 'approved',
        approvedAt: new Date().toISOString(),
        approvedBy: 'owner-device'
      }
    }
    syncProgress(next, `day3_${activeStage}_approved_owner_device`)
    grantDay3StageReward(activeStage)
    if (activeStage === 'smile') setActiveStage('heart')
    setNote(activeStage === 'smile' ? '第一杯盖章通过啦，第二杯已经解锁。' : '第二杯盖章通过啦，可以签到啦。')
  }

  function askRetryCurrentStage() {
    if (!ownerDevice || !stageSubmitted || stageApproved) return
    const next = {
      ...progress,
      [activeStage]: {
        ...progress[activeStage],
        status: 'draft',
        imageUrl: '',
        imagePath: '',
        submittedAt: '',
        approvedAt: '',
        approvedBy: ''
      }
    }
    syncProgress(next, `day3_${activeStage}_retry_requested_owner_device`)
    setNote('已经请小琳再试试看啦。')
  }

  return (
    <div className="foam-drawing-game">
      <div className="foam-story-card">
        <img src={item.originalImage} alt="2025年5月22日卡布奇诺原图" />
        <div className="foam-story-copy">
          <strong>{item.prompt}</strong>
          <p>尝试用画笔画一画吧~</p>
        </div>
      </div>

      <div className="foam-stage-tabs" aria-label="奶泡绘画阶段">
        <button type="button" className={activeStage === 'smile' ? 'active' : ''} onClick={() => { manualStageChoiceRef.current = true; setActiveStage('smile') }}>① 第一杯 {progress.smile.status === 'approved' ? '✓' : ''}</button>
        <button type="button" className={activeStage === 'heart' ? 'active' : ''} disabled={progress.smile.status !== 'approved'} onClick={() => { manualStageChoiceRef.current = true; setActiveStage('heart') }}>② 第二杯 {progress.heart.status === 'approved' ? '✓' : ''}</button>
      </div>

      <div className="foam-drawing-layout">
        <div className="foam-canvas-card">
          <div className="foam-canvas-title">
            <strong>{stageTitle}</strong>
            <span>{stageApproved ? (stageReplaying ? '重新体验中' : '已通过') : stageSubmitted ? '待检查' : '可以绘制'}</span>
          </div>
          <p>{stageHint}</p>
          <div className="foam-canvas-wrap">
            <img ref={imageRef} src={item.originalImage} alt="可绘制的卡布奇诺原图" onLoad={fitCanvas} draggable="false" />
            <canvas
              ref={canvasRef}
              aria-label="在卡布奇诺奶泡上绘画"
              onPointerDown={beginDraw}
              onPointerMove={moveDraw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
              onPointerLeave={endDraw}
            />
            {(stageApproved && !stageReplaying) && <div className="foam-approved-stamp">已通过</div>}
          </div>
          <div className="foam-tools">
            <label>画笔粗细 <input type="range" min="4" max="14" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} /></label>
            <button type="button" onClick={resetCanvas} disabled={busy || stageLocked}>清空重画</button>
            <button type="button" className="foam-submit" onClick={submitDrawing} disabled={busy || stageLocked}>{busy ? '提交中…' : '提交给小琛检查'}</button>
            {ownerDevice && stageSubmitted && !stageApproved && <button type="button" className="foam-owner-approve" onClick={approveCurrentStage}>检查盖章通过</button>}
            {ownerDevice && stageSubmitted && !stageApproved && <button type="button" className="foam-owner-retry" onClick={askRetryCurrentStage}>请小琳再试试看</button>}
            {stageApproved && !stageReplaying && <button type="button" className="foam-redraw" onClick={() => startRedrawStage(activeStage)}>我想重画</button>}
          </div>

          <p className="foam-note">{note}</p>
        </div>

        {stage.imageUrl && (
          <aside className="foam-reference-card foam-submission-card">
            <span>刚刚留下的小记录</span>
            <a href={stage.imageUrl} target="_blank" rel="noreferrer">打开通过版本</a>
          </aside>
        )}
      </div>

      {rewardPopup && (
        <div className="foam-reward-pop" role="dialog" aria-modal="true" onClick={closeRewardPopup}>
          <div className="foam-reward-card" onClick={event => event.stopPropagation()}>
            <div className={`foam-reward-icon reward-${rewardPopup.id}`}>{rewardPopup.icon}</div>
            <strong>{rewardPopup.title}</strong>
            <p>{rewardPopup.text}</p>
            <button type="button" onClick={closeRewardPopup}>收进小背包</button>
          </div>
        </div>
      )}

      {bothApproved && (
        <div className="foam-finished-card">
          <strong>原来那天的奶泡，不只是普通奶泡。</strong>
          <p>它已经悄悄变成喜欢的形状了。现在可以点击下面的签到按钮。</p>
          <small>第二杯通过后会多出一杯咖啡，先放进小背包。</small>
        </div>
      )}
    </div>
  )
}

const DAY4_MAZE_KEY = 'wwcxrl-day4-dark-maze-state'
const DAY4_MAZE_MAP = [
  '#####################',
  '#S..#.......#.......#',
  '###.#.#####.#.#####.#',
  '#...#.....#.#.....#.#',
  '#.#####.#.#.###.#.#.#',
  '#.#.....#.#...#.#...#',
  '#.#.#####.###.#.###.#',
  '#.#...#.....#.#...#.#',
  '#.###.#.###.#.###.#.#',
  '#.....#.#...#.....#.#',
  '#####.#.#.#######.#.#',
  '#...#.#.#.......#.#.#',
  '#.#.#.#.#######.#.#.#',
  '#.#...#.....#...#...#',
  '#.#########.#.#####.#',
  '#.....#.....#.....#.#',
  '###.#.#.#########.#.#',
  '#...#.............#D#',
  '#####################'
]
const DAY4_MAZE_COLS = DAY4_MAZE_MAP[0].length
const DAY4_MAZE_ROWS = DAY4_MAZE_MAP.length
const DAY4_START_POS = { x: 1, y: 1 }
const DAY4_DOOR_POS = { x: 19, y: 17 }
const DAY4_SWEET_LINES = [
  '小柚子偷偷说：今天也超级喜欢你。',
  '小柚子蹦了一下：你一来，星星就排好队啦。',
  '小柚子把脸贴近：你是今日份最亮的小行星。',
  '小柚子认真点头：见到你之前，我也在倒计时。',
  '小柚子晃晃叶子：你的名字适合被写进银河。',
  '小柚子小声说：如果迷路，就往喜欢的方向走。',
  '小柚子眨眼：第七下啦，宇宙开始有点不稳定。',
  '小柚子抱住自己：再点两下，好像会发生什么。',
  '小柚子变得透明：信号……正在漂移……',
  '小柚子掉线前说：别怕，我会在入口等你。'
]
const DAY4_EMPTY_STATE = {
  introClicks: 10,
  mazeStarted: true,
  glitchSeen: true,
  litTorch: false,
  matchUsed: 0,
  position: DAY4_START_POS,
  doorReached: false,
  doorOpened: false,
  transitionComplete: false
}

function normalizeDay4MazeState(progress = {}) {
  const rawPosition = progress.position || DAY4_START_POS
  const position = Number.isFinite(rawPosition.x) && Number.isFinite(rawPosition.y)
    ? { x: Math.max(1, Math.min(DAY4_MAZE_COLS - 2, Number(rawPosition.x))), y: Math.max(1, Math.min(DAY4_MAZE_ROWS - 2, Number(rawPosition.y))) }
    : DAY4_START_POS
  return {
    ...DAY4_EMPTY_STATE,
    ...progress,
    introClicks: 10,
    mazeStarted: true,
    glitchSeen: true,
    position,
    matchUsed: Number(progress.matchUsed || 0)
  }
}

function loadDay4MazeLocalState() {
  return normalizeDay4MazeState(getRoleJson(DAY4_MAZE_KEY, DAY4_EMPTY_STATE))
}

function saveDay4MazeLocalState(progress) {
  const normalized = normalizeDay4MazeState(progress)
  setRoleJson(DAY4_MAZE_KEY, normalized)
  return normalized
}

function isDay4Wall(x, y) {
  return DAY4_MAZE_MAP[y]?.[x] === '#'
}

function isDay4CellVisibleFromState(progress, x, y) {
  const state = normalizeDay4MazeState(progress || DAY4_EMPTY_STATE)
  const distance = Math.hypot(x - state.position.x, y - state.position.y)
  if (state.litTorch) return distance <= 3.2 || (x === DAY4_START_POS.x && y === DAY4_START_POS.y)
  return Math.hypot(x - DAY4_START_POS.x, y - DAY4_START_POS.y) <= 1.35
}


function DarkMazeTransition({ item, taskCompleted, onTaskComplete }) {
  const [mazeState, setMazeState] = useState(loadDay4MazeLocalState)
  const [bag, setBag] = useState(loadBackpack)
  const [message, setMessage] = useState(taskCompleted ? '木门已经打开啦，今天的签到按钮可以点击了。' : '你已经站在迷宫入口。先用 521 的火柴点亮火把，再用方向键或按钮前进。')
  const [transitioning, setTransitioning] = useState(false)
  const mazeStateRef = React.useRef(mazeState)
  const localDirtyRef = React.useRef(false)
  const controlTapRef = React.useRef(0)
  const timeoutRefs = React.useRef([])
  const hasMatchbox = Number(bag.matchbox || 0) > 0
  const hasMatch = Number(bag.match || 0) > 0
  const hasKey = Number(bag.foam_key || 0) > 0
  const canMove = mazeState.litTorch && !mazeState.transitionComplete

  function safeTimeout(callback, delay) {
    const id = window.setTimeout(callback, delay)
    timeoutRefs.current.push(id)
    return id
  }

  React.useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(id => window.clearTimeout(id))
      timeoutRefs.current = []
    }
  }, [])

  React.useEffect(() => {
    let alive = true
    const progressScore = progress => {
      const p = normalizeDay4MazeState(progress || {})
      return (p.transitionComplete ? 10000 : 0) + (p.doorOpened ? 5000 : 0) + (p.litTorch ? 1000 : 0) + (p.mazeStarted ? 500 : 0) + Number(p.introClicks || 0) + Math.abs(p.position.x - DAY4_START_POS.x) + Math.abs(p.position.y - DAY4_START_POS.y)
    }
    loadCloudDayProgress(item.day).then(remote => {
      if (!alive || !remote?.progress || localDirtyRef.current) return
      const remoteProgress = normalizeDay4MazeState(remote.progress)
      const localProgress = mazeStateRef.current || loadDay4MazeLocalState()
      if (progressScore(remoteProgress) <= progressScore(localProgress)) return
      const next = saveDay4MazeLocalState(remoteProgress)
      mazeStateRef.current = next
      setMazeState(next)
      if (next.transitionComplete) {
        setMessage('木门已经打开啦，今天的签到按钮可以点击了。')
        onTaskComplete(item.day)
      }
    }).catch(error => console.warn('[wwcxrl cloud] day4 progress load failed', error.message))
    loadCloudBackpack().then(cloudBag => {
      if (!alive || !cloudBag) return
      const nextBag = { ...loadBackpack(), ...cloudBag }
      saveBackpack(nextBag)
      setBag(nextBag)
    }).catch(error => console.warn('[wwcxrl cloud] day4 backpack load failed', error.message))
    return () => { alive = false }
  }, [item.day, onTaskComplete])

  React.useEffect(() => {
    const handleGenericReset = event => {
      if (Number(event.detail?.day) !== item.day) return
      const nextMaze = loadDay4MazeLocalState()
      mazeStateRef.current = nextMaze
      localDirtyRef.current = false
      setMazeState(nextMaze)
      setBag(loadBackpack())
      setTransitioning(false)
      setMessage('迷宫已重置到入口：火柴和钥匙已恢复，先重新点亮火把吧。')
    }
    window.addEventListener('wwcxrl-generic-day-reset', handleGenericReset)
    return () => window.removeEventListener('wwcxrl-generic-day-reset', handleGenericReset)
  }, [item.day])

  function runMazeControl(action) {
    const now = Date.now()
    if (now - controlTapRef.current < 220) return
    controlTapRef.current = now
    action()
  }

  function syncMaze(next, eventType = 'day4_maze_progress') {
    localDirtyRef.current = true
    const normalized = saveDay4MazeLocalState(next)
    mazeStateRef.current = normalized
    setMazeState(normalized)
    saveCloudDayProgress(item.day, normalized)
    logCloudEvent(eventType, { progress: normalized }, item.day)
    return normalized
  }

  function lightTorch() {
    const current = mazeStateRef.current
    if (current.litTorch) {
      setMessage('火把已经亮起来啦，小柚子周围可以看清一点点路。')
      return
    }
    if (!hasMatchbox || !hasMatch) {
      setMessage('迷宫入口太黑了，需要 521 留下的空火柴盒和至少一根火柴。')
      return
    }
    const nextBag = { ...bag, match: Number(bag.match || 0) - 1 }
    if (nextBag.match <= 0) delete nextBag.match
    saveBackpack(nextBag)
    setBag(nextBag)
    syncCloudBackpack(nextBag)
    window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    syncMaze({ ...current, mazeStarted: true, glitchSeen: true, litTorch: true, matchUsed: Number(current.matchUsed || 0) + 1 }, 'day4_torch_lit')
    setMessage('嚓——火柴亮了。小柚子的透明气泡上映出一小圈暖光。')
  }

  function openStarDoor(nextPosition = mazeStateRef.current.position, { bypassKey = false } = {}) {
    const current = mazeStateRef.current
    const latestBag = loadBackpack()
    if (!bypassKey && Number(latestBag.foam_key || 0) <= 0) {
      setBag(latestBag)
      setMessage('这扇木门需要一把奇怪的钥匙。先回到小背包确认钥匙有没有拿到，再来打开门。')
      return
    }
    const opened = syncMaze({ ...current, position: nextPosition, doorReached: true, doorOpened: true }, 'day4_star_door_opened')
    setTransitioning(true)
    setMessage('钥匙自己飞了起来，门缝里漏出一整条银河。')
    safeTimeout(() => {
      const completed = syncMaze({ ...opened, transitionComplete: true }, 'day4_interstellar_transition_complete')
      setVoyageThemeLocal(true, 'day4-stargate', { cloud: true })
      setTransitioning('landing')
      setMessage('小柚子被木门后的光吸进了新的世界。524 迷宫任务完成，今天的签到按钮可以点击啦。')
      onTaskComplete(item.day)
      logCloudEvent('day5_maze_task_completed', completed, item.day)
      safeTimeout(() => setTransitioning(false), 1000)
    }, 9800)
  }

  function movePomelo(dx, dy) {
    const current = mazeStateRef.current
    if (!current.litTorch || current.transitionComplete) {
      setMessage(current.litTorch ? '木门已经打开啦。' : '太黑啦，先划亮一根火柴吧。')
      return
    }
    const nextPosition = { x: current.position.x + dx, y: current.position.y + dy }
    if (isDay4Wall(nextPosition.x, nextPosition.y)) {
      setMessage('咚，小柚子的宇航服轻轻撞到了迷宫墙。')
      return
    }
    if (!isDay4CellVisibleFromState(current, nextPosition.x, nextPosition.y)) {
      setMessage('那里还在火把照不到的黑暗里，先沿着亮起来的路走。')
      return
    }
    if (nextPosition.x === DAY4_DOOR_POS.x && nextPosition.y === DAY4_DOOR_POS.y) {
      syncMaze({ ...current, position: nextPosition, doorReached: true }, 'day4_door_reached')
      setMessage(hasKey ? '你已到达迷宫出口。眼前出现了一扇木门，门缝里透出一整条银河。' : '你已到达迷宫出口，但这扇木门需要一把奇怪的钥匙才能打开。')
      return
    }
    syncMaze({ ...current, position: nextPosition }, 'day4_maze_move')
    setMessage('火把照亮了一小段路，继续往出口走吧。')
  }
  function cellVisible(x, y) {
    return isDay4CellVisibleFromState(mazeState, x, y)
  }

  React.useEffect(() => {
    const isTypingTarget = target => {
      const tag = target?.tagName?.toLowerCase?.()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable
    }
    const onMazeKeyDown = event => {
      if (isTypingTarget(event.target)) return
      const keyMap = {
        ArrowUp: [0, -1],
        w: [0, -1],
        W: [0, -1],
        ArrowLeft: [-1, 0],
        a: [-1, 0],
        A: [-1, 0],
        ArrowRight: [1, 0],
        d: [1, 0],
        D: [1, 0],
        ArrowDown: [0, 1],
        s: [0, 1],
        S: [0, 1]
      }
      const direction = keyMap[event.key]
      if (!direction) return
      event.preventDefault()
      event.stopPropagation()
      runMazeControl(() => movePomelo(direction[0], direction[1]))
    }
    window.addEventListener('keydown', onMazeKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onMazeKeyDown, { capture: true })
  }, [])

  return (
    <div className={`dark-maze-game ${transitioning ? 'is-transitioning' : ''} ${mazeState.transitionComplete ? 'is-complete' : ''}`}>
      <div className="maze-story-strip">
        <button type="button" className={`maze-prop-chip ${hasMatchbox ? 'ready' : 'missing'}`} onPointerDown={event => { event.preventDefault(); runMazeControl(lightTorch) }} onClick={() => runMazeControl(lightTorch)} disabled={mazeState.transitionComplete}>
          <span className="prop-icon">📦</span><strong>火柴盒</strong><em>× {Number(bag.matchbox || 0)}</em>
        </button>
        <button type="button" className={`maze-prop-chip ${hasMatch ? 'ready pulse' : 'missing'}`} onPointerDown={event => { event.preventDefault(); runMazeControl(lightTorch) }} onClick={() => runMazeControl(lightTorch)} disabled={mazeState.transitionComplete}>
          <span className="prop-icon">🔥</span><strong>{mazeState.litTorch ? '火把已点亮' : '点这里划亮火柴'}</strong><em>火柴 × {Number(bag.match || 0)}</em>
        </button>
        <button type="button" className={`maze-prop-chip ${hasKey ? 'ready' : 'missing'}`} onClick={() => setMessage(hasKey ? '奇怪的钥匙在背包里安静发光，走到出口门前它会自己飞起来。' : '还没有从椰奶里找到钥匙，出口门暂时打不开哦。')}>
          <span className="prop-icon">🗝️</span><strong>奇怪的钥匙</strong><em>× {Number(bag.foam_key || 0)}</em>
        </button>
      </div>
      {!mazeState.litTorch && !mazeState.transitionComplete && (
        <div className="maze-start-helper">
          <span className="helper-fire">🔥</span>
          <div>
            <strong>先点亮火把</strong>
            <p>点击上面的“点这里划亮火柴”或右侧大按钮。火把亮起后，再用方向键/上下左右按钮移动小柚子。</p>
          </div>
        </div>
      )}
      <div className="maze-stage-card">
        <div className="maze-board" style={{ '--maze-cols': DAY4_MAZE_COLS, '--maze-rows': DAY4_MAZE_ROWS, '--hero-x': mazeState.position.x, '--hero-y': mazeState.position.y }}>
          {DAY4_MAZE_MAP.flatMap((row, y) => row.split('').map((cell, x) => {
            const visible = cellVisible(x, y)
            const isHero = mazeState.position.x === x && mazeState.position.y === y
            const isDoor = x === DAY4_DOOR_POS.x && y === DAY4_DOOR_POS.y
            const isStart = x === DAY4_START_POS.x && y === DAY4_START_POS.y
            return (
              <span
                key={`${x}-${y}`}
                className={`maze-cell ${cell === '#' ? 'wall' : 'path'} ${visible ? 'visible' : 'dark'} ${isDoor ? 'door' : ''} ${isStart ? 'start' : ''}`}
                style={{ '--x': x, '--y': y }}
              >
                {isDoor && <i className="maze-door-symbol">⌑</i>}
                {isStart && !isHero && <i className="maze-start-symbol">入口</i>}
                {isHero && <span className="maze-hero bubble-yuzu-hero"><DogSprite type="pomelo" className="bubble-yuzu" /></span>}
              </span>
            )
          }))}
          <span className={`torch-aura ${mazeState.litTorch ? 'lit' : ''}`} />
        </div>
        <aside className="maze-control-panel">
          <div className="tiny-label">DAY 524 · DARK MAZE</div>
          <h4>524 小柚子的黑暗迷宫</h4>
          <p>{message}</p>
          <button type="button" className={`maze-light-button ${!mazeState.litTorch ? 'need-light' : ''}`} onPointerDown={event => { event.preventDefault(); runMazeControl(lightTorch) }} onClick={() => runMazeControl(lightTorch)} disabled={mazeState.transitionComplete}>
            {mazeState.litTorch ? '🔥 火把已经亮啦' : '🔥 点这里划亮火柴'}
          </button>
          <button type="button" className="maze-theme-direct-button" onClick={() => runMazeControl(() => openStarDoor(mazeStateRef.current.position, { bypassKey: true }))}>🚀 直接观看主题切换</button>
          <div className={`maze-dpad ${mazeState.litTorch ? 'active' : 'locked'}`} aria-label="移动小琳">
            <button type="button" onPointerDown={event => { event.preventDefault(); runMazeControl(() => movePomelo(0, -1)) }} onClick={() => runMazeControl(() => movePomelo(0, -1))} aria-label="向上移动">↑</button>
            <button type="button" onPointerDown={event => { event.preventDefault(); runMazeControl(() => movePomelo(-1, 0)) }} onClick={() => runMazeControl(() => movePomelo(-1, 0))} aria-label="向左移动">←</button>
            <button type="button" onPointerDown={event => { event.preventDefault(); runMazeControl(() => movePomelo(1, 0)) }} onClick={() => runMazeControl(() => movePomelo(1, 0))} aria-label="向右移动">→</button>
            <button type="button" onPointerDown={event => { event.preventDefault(); runMazeControl(() => movePomelo(0, 1)) }} onClick={() => runMazeControl(() => movePomelo(0, 1))} aria-label="向下移动">↓</button>
          </div>
        </aside>
      </div>
      {transitioning && typeof document !== 'undefined' && createPortal(
        <div className={`day4-world-transition day4-blackhole-transition ${transitioning === 'landing' ? 'is-landing' : ''}`} aria-live="polite" role="status">
          <span className="d4t-sky d4t-sky-a" />
          <span className="d4t-sky d4t-sky-b" />
          <span className="d4t-vignette" aria-hidden="true" />
          <span className="d4t-final-blackout" aria-hidden="true" />
          <span className="d4t-door" aria-hidden="true"><b /><b /><i /></span>
          <span className="d4t-door-light" aria-hidden="true" />
          <span className="d4t-blackhole" aria-hidden="true">
            <b className="d4t-accretion accretion-one" />
            <b className="d4t-accretion accretion-two" />
            <b className="d4t-event-horizon"><i /><i /></b>
            <b className="d4t-blackhole-smile" />
          </span>
          <span className="d4t-vortex d4t-vortex-a" />
          <span className="d4t-vortex d4t-vortex-b" />
          <span className="d4t-vortex d4t-vortex-c" />
          <span className="d4t-galaxy-stream d4t-stream-a" />
          <span className="d4t-galaxy-stream d4t-stream-b" />
          <span className="d4t-galaxy-stream d4t-stream-c" />
          <span className="d4t-key">🗝️</span>
          <span className="d4t-orbit-ring d4t-orbit-ring-a" aria-hidden="true" />
          <span className="d4t-orbit-ring d4t-orbit-ring-b" aria-hidden="true" />
          <span className="d4t-mascot-track d4t-pomelo-track d4t-orbiting-mascot"><DogSprite type="pomelo" className="d4t-original-mascot" /></span>
          <span className="d4t-mascot-track d4t-orange-track d4t-orbiting-mascot"><DogSprite type="orange" className="d4t-original-mascot" /></span>
          {Array.from({ length: 54 }, (_, index) => <i className="d4t-star" key={`d4t-star-${index}`} style={{ '--angle': `${index * 137.5}deg`, '--distance': `${180 + (index % 14) * 42}px`, '--mid-distance': `${58 + (index % 8) * 12}px`, '--size': `${8 + (index % 6) * 2}px`, '--delay': `${(index % 32) * -0.06}s` }}>✦</i>)}
          {Array.from({ length: 30 }, (_, index) => <i className="d4t-dust" key={`d4t-dust-${index}`} style={{ '--angle': `${index * 89}deg`, '--distance': `${145 + (index % 12) * 48}px`, '--size': `${3 + (index % 4)}px`, '--delay': `${(index % 21) * -0.08}s` }} />)}
          {Array.from({ length: 14 }, (_, index) => <i className="d4t-heart" key={`d4t-heart-${index}`} style={{ '--angle': `${index * 73}deg`, '--distance': `${130 + (index % 8) * 50}px`, '--size': `${13 + (index % 4) * 3}px`, '--delay': `${(index % 15) * -0.12}s` }}>♡</i>)}
        </div>,
        document.body
      )}
      {mazeState.doorReached && !mazeState.doorOpened && !transitioning && (
        <div className="maze-door-arrival" role="dialog" aria-modal="true" aria-live="assertive">
          <div className="maze-door-card">
            <div className="door-glow-scene" aria-hidden="true">
              <span className="big-star-door">🚪</span>
              <span className="door-orbit one" />
              <span className="door-orbit two" />
              <DogSprite type="pomelo" className="door-waiting-yuzu" />
            </div>
            <strong>你已到达迷宫出口</strong>
            <p>{hasKey ? '眼前出现了一扇木门，门缝里正在漏出薄荷色的银河光。' : '眼前出现了一扇木门，但它需要一把奇怪的钥匙。先拿到钥匙，再来打开这道门。'}</p>
            {!hasKey && <div className="maze-missing-key-alert" role="alert">🗝️ 需要一把奇怪的钥匙才能打开木门</div>}
            <button type="button" onPointerDown={event => { event.preventDefault(); runMazeControl(() => openStarDoor(mazeStateRef.current.position)) }} onClick={() => runMazeControl(() => openStarDoor(mazeStateRef.current.position))}>🗝️ 使用钥匙开门</button>
            {!hasKey && <small>钥匙来自前面的奶泡任务；拿到后再回到出口，木门就会回应你。</small>}
          </div>
        </div>
      )}
    </div>
  )
}

const DAY8_SIGNAL_KEY = 'wwcxrl-day8-one-lightyear-signal-state'
const DAY8_SIGNAL_TOTAL = 5.09
const DAY8_SIGNAL_CLOUDS = [
  { id: 'slow', label: '慢吞吞云', x: 16, y: 28, hasStar: true, starText: '你已经走了很远。' },
  { id: 'bug', label: '报错云', x: 72, y: 24, hasStar: false, emptyText: '这朵云后面暂时没有星星，但它帮你排除了一个方向。' },
  { id: 'messy', label: '乱糟糟云', x: 30, y: 56, hasStar: true, starText: '乱一点也能慢慢整理。' },
  { id: 'compare', label: '别人好像很顺云', x: 75, y: 56, hasStar: false, emptyText: '没有立刻找到光，也不代表这一步白走了。' },
  { id: 'signal', label: '看不清云', x: 51, y: 20, hasStar: true, starText: '看不清的时候，也可以先靠近一点。' },
  { id: 'tired', label: '有点累了云', x: 13, y: 70, hasStar: false, emptyText: '今天的努力也许还没有回声，但天空确实亮了一点。' },
  { id: 'figure', label: '图还不好看云', x: 63, y: 74, hasStar: true, starText: '慢一点不是失败。' },
  { id: 'direction', label: '方向又要改云', x: 38, y: 38, hasStar: false, emptyText: '有些云吹开以后没有星星，却让路变宽了一些。' },
  { id: 'believe', label: '我是不是太慢了云', x: 78, y: 37, hasStar: true, starText: '你曾经做到过，也还会再做到。' }
]

const DAY8_DECODE_STEPS = [
  {
    eyebrow: 'Signal fragment 01',
    title: '这束光走了一整年。',
    body: '星空观测站算了算：如果它来自 1 光年外，那么它出发的时候，是 2025 年 5 月 27 日。'
  },
  {
    eyebrow: 'Signal fragment 02',
    title: '那一天，有一束很清楚的信号。',
    body: '2025 年 5 月 27 日，小琳在复杂的数据里，完成了一次超过 5σ 的探测。'
  },
  {
    eyebrow: 'Signal fragment 03',
    title: '所以今天不是突然出现的数字。',
    body: '它像一年前的你寄给现在自己的小纸条：你认真看过很暗的地方，也真的在那里找到过光。'
  },
  {
    eyebrow: 'Signal fragment 04',
    title: '五颗星星很重要。',
    body: '但如果只有五颗星星，故事就还差一点点。那最后 0.09 点光，不在云后，也不在远方。'
  },
  {
    eyebrow: 'Signal fragment 05',
    title: '它来自小柚子自己。',
    body: '所以观测站把它们一起装进星光瓶：5 颗云后的星星，和 0.09 点自己身上的光。低谷的时候，也请记得：光没有消失。'
  }
]

function normalizeDay8SignalState(value = {}) {
  const clearedClouds = Array.isArray(value.clearedClouds) ? value.clearedClouds.map(String) : []
  const foundStars = Array.isArray(value.foundStars) ? value.foundStars.map(String) : []
  const selfLightFound = Boolean(value.selfLightFound)
  const storyFinished = Boolean(value.storyFinished || value.completed)
  const rawDecodeStep = Number.isFinite(Number(value.decodeStep)) ? Number(value.decodeStep) : 0
  const decodeStep = Math.max(0, Math.min(DAY8_DECODE_STEPS.length - 1, rawDecodeStep))
  return {
    started: Boolean(value.started),
    clearedClouds: Array.from(new Set(clearedClouds)),
    foundStars: Array.from(new Set(foundStars)),
    selfLightFound,
    storyFinished,
    decodeStep,
    completed: Boolean(storyFinished),
    lastMessage: value.lastMessage || '望远镜正在接收来自 1 光年外的微弱信号。'
  }
}

function loadDay8SignalState() {
  return normalizeDay8SignalState(getRoleJson(DAY8_SIGNAL_KEY, {}))
}

function saveDay8SignalState(next, { cloud = true } = {}) {
  const normalized = normalizeDay8SignalState(next)
  setRoleJson(DAY8_SIGNAL_KEY, normalized)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('wwcxrl-day8-signal-updated'))
  if (cloud) saveCloudDayProgress(8, normalized).catch(error => console.warn('[wwcxrl cloud] day8 signal save failed', error.message))
  return normalized
}

function OneLightYearSignalQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [previewState, setPreviewState] = useState(loadDay8SignalState)
  React.useEffect(() => {
    const refresh = () => setPreviewState(loadDay8SignalState())
    window.addEventListener('wwcxrl-day8-signal-updated', refresh)
    return () => window.removeEventListener('wwcxrl-day8-signal-updated', refresh)
  }, [])
  const foundStarCount = previewState.foundStars.length
  const collectedValue = Math.min(DAY8_SIGNAL_TOTAL, foundStarCount + (previewState.selfLightFound ? 0.09 : 0))
  const percent = Math.min(100, collectedValue / DAY8_SIGNAL_TOTAL * 100)
  return (
    <div className={`day8-entry-card ${previewState.completed ? 'is-complete' : ''}`}>
      <div className="day8-entry-orbit" aria-hidden="true"><span /><span /><span /></div>
      <div className="tiny-label">Starlight Observatory · 1 light-year signal</div>
      <h4>{previewState.completed ? '1 光年信号已经收进星光瓶' : '观测站收到 1 光年外的信号'}</h4>
      <p>如果一束光刚好走了一整年，那么它出发的日子，就是 2025 年 5 月 27 日。进入观测窗口，听听它慢慢说完。</p>
      <div className="day8-entry-meter"><span style={{ width: `${percent}%` }} /></div>
      <small>{previewState.completed ? '信号已经整理成一只温柔的星光瓶。' : previewState.started ? `当前信号完整度 ${percent.toFixed(2)}%，还有一点微光正在靠近。` : '进入观测模式后开始接收。'}</small>
      <button type="button" onClick={() => setModalOpen(true)}>{previewState.completed ? '重新查看观测记录' : '进入观测模式，寻找星光吧~'}</button>
      {modalOpen && createPortal(
        <div className="day8-observation-modal" role="dialog" aria-modal="true" aria-label="527 观测模式：寻找星光">
          <div className="day8-modal-card">
            <button type="button" className="day8-modal-close" onClick={() => { setModalOpen(false); setPreviewState(loadDay8SignalState()) }} aria-label="关闭观测模式">×</button>
            <OneLightYearSignalGame item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function OneLightYearSignalGame({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const [state, setState] = useState(loadDay8SignalState)
  const [rewardPopupOpen, setRewardPopupOpen] = useState(false)
  const stateRef = React.useRef(state)
  React.useEffect(() => { stateRef.current = state }, [state])
  const foundStarCount = state.foundStars.length
  const collectedValue = Math.min(DAY8_SIGNAL_TOTAL, foundStarCount + (state.selfLightFound ? 0.09 : 0))
  const percent = Math.min(100, collectedValue / DAY8_SIGNAL_TOTAL * 100)
  const allFiveStarsFound = foundStarCount >= 5
  const shouldGlowYuzu = allFiveStarsFound && !state.selfLightFound
  const storyActive = state.selfLightFound && !state.storyFinished
  const currentStoryStep = DAY8_DECODE_STEPS[state.decodeStep] || DAY8_DECODE_STEPS[0]

  React.useEffect(() => {
    let alive = true
    loadCloudDayProgress(8).then(remote => {
      if (!alive || !remote?.progress) return
      const merged = normalizeDay8SignalState({ ...state, ...remote.progress })
      setState(saveDay8SignalState(merged, { cloud: false }))
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  React.useEffect(() => {
    if (state.completed && !taskCompleted) onTaskComplete(item.day)
  }, [state.completed, taskCompleted, item.day, onTaskComplete])

  function updateState(next, eventType) {
    const saved = saveDay8SignalState(next)
    stateRef.current = saved
    setState(saved)
    if (eventType) logCloudEvent(eventType, saved, item.day)
    return saved
  }

  function startSignal() {
    const current = stateRef.current
    updateState({ ...current, started: true, lastMessage: '望远镜镜筒里出现了昨天那颗星球。好多烦恼云挡在它周围。' }, 'day8_signal_started')
  }

  function clearCloud(cloud) {
    const current = stateRef.current
    if (current.clearedClouds.includes(cloud.id)) return
    const clearedClouds = [...current.clearedClouds, cloud.id]
    const foundStars = cloud.hasStar ? [...current.foundStars, cloud.id] : current.foundStars
    const starCount = foundStars.length
    const lastMessage = cloud.hasStar
      ? `发现一颗星光：${cloud.starText}`
      : cloud.emptyText
    const next = updateState({ ...current, started: true, clearedClouds, foundStars, lastMessage }, cloud.hasStar ? 'day8_cloud_star_found' : 'day8_cloud_empty_cleared')
    if (starCount >= 5 && !next.selfLightFound) {
      window.setTimeout(() => {
        setState(previous => {
          const saved = saveDay8SignalState({ ...previous, lastMessage: '五颗云后星星都找到了，可读数还差一点点。最后一点星光，似乎藏在最近的星球上。' })
          stateRef.current = saved
          return saved
        })
      }, 450)
    }
  }

  function grantDay8Reward() {
    const bag = loadBackpack()
    const nextBag = { ...bag, one_lightyear_signal: Math.max(1, Number(bag.one_lightyear_signal || 0) + 1) }
    saveBackpack(nextBag)
    syncCloudBackpack(nextBag)
    addCloudBackpackItems([{ id: 'one_lightyear_signal', count: 1 }]).catch(error => console.warn('[wwcxrl cloud] day8 reward failed', error.message))
    window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '获得道具：5.09 星光瓶' }))
    setRewardPopupOpen(true)
  }

  function collectSelfLight() {
    const current = stateRef.current
    if (current.foundStars.length < 5 || current.selfLightFound) return
    return updateState({
      ...current,
      selfLightFound: true,
      storyFinished: false,
      completed: false,
      decodeStep: 0,
      lastMessage: '最后一点微光被接住了。观测站开始慢慢读出这束光的来处。'
    }, 'day8_self_light_collected')
  }

  function advanceDecodeStory() {
    const current = stateRef.current
    if (!current.selfLightFound) return
    if (current.decodeStep < DAY8_DECODE_STEPS.length - 1) {
      updateState({ ...current, decodeStep: current.decodeStep + 1 }, 'day8_decode_story_next')
      return
    }
    const saved = updateState({
      ...current,
      storyFinished: true,
      completed: true,
      lastMessage: '信号已经收好：5 颗云后的星星，加上 0.09 点自己身上的光。'
    }, 'day8_decode_story_finished')
    grantDay8Reward()
    onTaskComplete(item.day)
    return saved
  }

  if (!state.started) {
    return (
      <div className="day8-signal-intro">
        <div className="day8-console-card">
          <div className="tiny-label">Starlight Observatory · Signal Receiver</div>
          <h4>收到来自 1 光年外的信号</h4>
          <p>如果这束光刚好走了一整年，那它出发的日子就是 2025.05.27。</p>
          <p>昨天我们从望远镜里看见第一颗星球。今天，再看看它周围还藏着什么光。</p>
          <button type="button" onClick={startSignal}>进入望远镜镜筒</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`day8-signal-quest ${state.selfLightFound ? 'is-complete' : ''} ${shouldGlowYuzu ? 'needs-self-light' : ''}`}>
      <div className="day8-meter-card">
        <div>
          <div className="tiny-label">1 光年信号完整度</div>
          <strong>{percent.toFixed(2)}%</strong>
        </div>
        <div className="day8-progress-track" aria-label={`信号完整度 ${percent.toFixed(2)}%`}><span style={{ width: `${percent}%` }} /></div>
        <small>{state.storyFinished ? '星光瓶已经收好' : state.selfLightFound ? '正在读出 1 光年信号' : allFiveStarsFound ? '还差一点点微光' : '吹开云朵，继续观测'}</small>
      </div>
      <div className="day8-eyepiece" aria-label="望远镜镜筒里的星球和烦恼云">
        <div className="day8-scope-stars" aria-hidden="true"><i /><i /><i /></div>
        <div className="day8-observed-planet">
          <DogSprite type="pomelo" className={`day8-yuzu-planet ${shouldGlowYuzu ? 'self-glowing' : ''}`} />
          {shouldGlowYuzu && <button type="button" className="day8-self-light" onClick={collectSelfLight} aria-label="收集小柚子自己身上的 0.09 点光">✦</button>}
          <DogSprite type="orange" className="day8-orange-moon" />
        </div>
        {DAY8_SIGNAL_CLOUDS.map(cloud => {
          const cleared = state.clearedClouds.includes(cloud.id)
          const found = state.foundStars.includes(cloud.id)
          return (
            <button
              type="button"
              key={cloud.id}
              className={`day8-cloud ${cleared ? 'cleared' : ''} ${found ? 'found-star' : ''}`}
              style={{ left: `${cloud.x}%`, top: `${cloud.y}%` }}
              onClick={() => clearCloud(cloud)}
              disabled={cleared || state.selfLightFound}
              aria-label={`${cloud.label}${cleared ? found ? '，已发现星光' : '，已吹开' : '，点击吹开'}`}
            >
              <span>{cleared ? found ? '⭐' : '⋯' : '☁️'}</span>
              <small>{cloud.label}</small>
            </button>
          )
        })}
        {state.selfLightFound && <div className="day8-final-signal" aria-label="信号光已经收齐"><span>5颗星</span><b>+</b><span>0.09点自己的光</span></div>}
        {storyActive && currentStoryStep && (
          <div className="day8-story-popup" role="dialog" aria-live="polite" aria-label="1 光年信号解码提示">
            <div className="tiny-label">{currentStoryStep.eyebrow}</div>
            <h4>{currentStoryStep.title}</h4>
            <p>{currentStoryStep.body}</p>
            <button type="button" onClick={advanceDecodeStory}>{state.decodeStep === DAY8_DECODE_STEPS.length - 1 ? '把这束光收进星光瓶' : '继续听这束光说'}</button>
          </div>
        )}
        <div className="day8-message-popup" role="status">{state.lastMessage}</div>
      </div>
      {state.storyFinished && (
        <div className="day8-discovery-card">
          <div className="day8-photo-frame">
            <img src="/images/day8-one-lightyear-signal-20250527.jpg" alt="2025 年 5 月 27 日的纪念照片" />
          </div>
          <div>
            <div className="tiny-label">One light-year letter · 2025.05.27 → 2026.05.27</div>
            <h4>5.09 点星光，已装瓶</h4>
            <p>这不是一个突然冒出来的数字，而是一年前那束光走到今天之后，终于被观测站完整接住。</p>
            <p>2025 年 5 月 27 日，小琳完成了超过 5σ 的探测。那天的数据、坚持和判断，隔着一整年，又轻轻照到了现在。</p>
            <p>5 颗星星来自云后，最后 0.09 点光来自小柚子自己。以后如果课题暂时被云挡住，也请记得：你不是没有光，你只是有时候离自己太近，忘了看见。</p>
          </div>
        </div>
      )}
      {rewardPopupOpen && (
        <div className="day8-reward-modal" role="dialog" aria-modal="true" aria-label="获得 5.09 星光瓶">
          <div className="day8-reward-card">
            <div className="reward-sparkle" aria-hidden="true">✨</div>
            <div className="tiny-label">Backpack reward</div>
            <h4>获得道具：5.09 星光瓶</h4>
            <p>5 颗云后的星星，和 0.09 点自己身上的光，已经一起收进小背包啦。</p>
            <button type="button" onClick={() => setRewardPopupOpen(false)}>收好这只星光瓶</button>
          </div>
        </div>
      )}
    </div>
  )
}


const DAY9_VACATION_KEY = 'wwcxrl-day9-yuzu-vacation-state'
const DAY9_WEATHER_MODES = [
  { id: 'quiet', icon: '🌙', label: '安静', helper: '关掉天气音，只留一点软软的房间声。' },
  { id: 'rain', icon: '🌧️', label: '雨天', helper: '窗外下起小雨，适合窝在被子里。' },
  { id: 'sunny', icon: '☀️', label: '大晴天', helper: '窗外变成大晴天，鸟叫声轻轻路过。' }
]
const DAY9_VACATION_ACTIONS = [
  { id: 'close_window', icon: '🪟', title: '关好窗户', done: '窗户安静了', speaker: '小柚子', message: '真安静呀~外面的事情先小声一点。' },
  { id: 'blanket', icon: '🧺', title: '盖上双人小毯子', done: '小毯子已盖好', speaker: '小橙子', message: '小柚子负责躺好，毯子我来拉平。' },
  { id: 'fan', icon: '🌀', title: '打开小风扇', done: '小风扇转起来', speaker: '小柚子', message: '呼呼的风刚刚好，脑袋也凉快一点了。' },
  { id: 'drinks', icon: '🥤', title: '摆好饮料托盘', done: '三杯饮料到位', speaker: '小橙子', message: '冰柠檬茶、桃桃汽水和温水都在这里，随便喝。' },
  { id: 'pillows', icon: '🛋️', title: '塞好两个懒人抱枕', done: '抱枕到位', speaker: '小柚子', message: '这个角度好舒服，可以暂时不思考宇宙。' },
  { id: 'tv', icon: '📺', title: '打开休假电视', done: '电视播放中', speaker: '小橙子', message: '电视只播放不用动脑的小节目。' },
  { id: 'guard', icon: '🍊', title: '挂上不许内耗牌', done: '门牌已挂好', speaker: '小橙子', message: '本房间今日谢绝内耗入内。' }
]

function normalizeDay9VacationState(value = {}) {
  const finishedActions = Array.isArray(value.finishedActions) ? value.finishedActions.map(String) : []
  const uniqueActions = DAY9_VACATION_ACTIONS.map(action => action.id).filter(id => finishedActions.includes(id))
  const completed = Boolean(value.completed) || uniqueActions.length >= DAY9_VACATION_ACTIONS.length
  const weatherMode = DAY9_WEATHER_MODES.some(mode => mode.id === value.weatherMode) ? value.weatherMode : 'quiet'
  return {
    started: Boolean(value.started || uniqueActions.length),
    finishedActions: uniqueActions,
    completed,
    rewardClaimed: Boolean(value.rewardClaimed || completed),
    weatherMode,
    lastSpeaker: value.lastSpeaker || '小柚子',
    lastMessage: value.lastMessage || '今天不闯关、不解谜、不证明自己。先把小房间布置舒服一点吧。'
  }
}

function loadDay9VacationState() {
  return normalizeDay9VacationState(getRoleJson(DAY9_VACATION_KEY, {}))
}

function saveDay9VacationState(next, { cloud = true } = {}) {
  const normalized = normalizeDay9VacationState(next)
  setRoleJson(DAY9_VACATION_KEY, normalized)
  if (cloud) saveCloudDayProgress(9, normalized).catch(error => console.warn('[wwcxrl cloud] day9 vacation save failed', error.message))
  return normalized
}

function createDay9RainAmbience() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  const ctx = new AudioContext()
  const bufferSize = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i += 1) data[i] = (Math.random() * 2 - 1) * 0.34
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  noise.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 1200
  const gain = ctx.createGain()
  gain.gain.value = 0.055
  noise.connect(filter).connect(gain).connect(ctx.destination)
  noise.start()
  return { ctx, stop: () => { try { noise.stop() } catch {}; ctx.close().catch(() => {}) } }
}

function createDay9SunnyAmbience() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  const ctx = new AudioContext()
  let stopped = false
  const timers = []
  const chirp = () => {
    if (stopped) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1250 + Math.random() * 450, now)
    osc.frequency.exponentialRampToValueAtTime(2100 + Math.random() * 500, now + 0.12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.052, now + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.2)
    timers.push(window.setTimeout(chirp, 1800 + Math.random() * 1800))
  }
  chirp()
  return { ctx, stop: () => { stopped = true; timers.forEach(id => window.clearTimeout(id)); ctx.close().catch(() => {}) } }
}

function VacationBreakQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const [state, setState] = useState(loadDay9VacationState)
  const [rewardPopupOpen, setRewardPopupOpen] = useState(false)
  const audioRef = React.useRef(null)
  const stateRef = React.useRef(state)
  React.useEffect(() => { stateRef.current = state }, [state])

  React.useEffect(() => {
    let alive = true
    loadCloudDayProgress(9).then(remote => {
      if (!alive || !remote?.progress) return
      const merged = normalizeDay9VacationState({ ...stateRef.current, ...remote.progress })
      stateRef.current = saveDay9VacationState(merged, { cloud: false })
      setState(stateRef.current)
    }).catch(() => {})
    const handleReset = () => {
      if (audioRef.current) {
        audioRef.current.stop()
        audioRef.current = null
      }
      const fresh = loadDay9VacationState()
      stateRef.current = fresh
      setState(fresh)
      setRewardPopupOpen(false)
    }
    window.addEventListener('wwcxrl-day9-vacation-reset', handleReset)
    return () => {
      alive = false
      window.removeEventListener('wwcxrl-day9-vacation-reset', handleReset)
    }
  }, [])

  React.useEffect(() => () => {
    if (audioRef.current) audioRef.current.stop()
  }, [])

  React.useEffect(() => {
    if (state.completed && !taskCompleted) onTaskComplete(item.day)
  }, [state.completed, taskCompleted, item.day, onTaskComplete])

  const completedCount = state.finishedActions.length
  const progress = Math.round(completedCount / DAY9_VACATION_ACTIONS.length * 100)
  const isComplete = completedCount >= DAY9_VACATION_ACTIONS.length
  const pendingAction = DAY9_VACATION_ACTIONS.find(action => !state.finishedActions.includes(action.id))

  function grantVacationReward() {
    const bag = loadBackpack()
    if (Number(bag.vacation_half_hour_ticket || 0) > 0) return
    const nextBag = { ...bag, vacation_half_hour_ticket: 1 }
    saveBackpack(nextBag)
    addCloudBackpackItems([{ id: 'vacation_half_hour_ticket', count: 1 }]).catch(error => console.warn('[wwcxrl cloud] day9 reward failed', error.message))
    window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '获得道具：半小时放假券' }))
    setRewardPopupOpen(true)
  }

  function updateVacationState(patch, eventType = 'day9_vacation_update') {
    const next = saveDay9VacationState({ ...stateRef.current, ...patch, started: true })
    stateRef.current = next
    setState(next)
    logCloudEvent(eventType, patch, item.day)
    return next
  }

  function finishAction(action) {
    const current = stateRef.current
    if (current.finishedActions.includes(action.id)) return
    const finishedActions = [...current.finishedActions, action.id]
    const completed = finishedActions.length >= DAY9_VACATION_ACTIONS.length
    const next = updateVacationState({
      finishedActions,
      completed,
      rewardClaimed: completed,
      lastSpeaker: completed ? '小柚子和小橙子' : action.speaker,
      lastMessage: completed ? '充电中……休息不是暂停前进，是给下一次发光留一点电量。' : action.message
    }, completed ? 'day9_vacation_completed' : 'day9_vacation_action')
    if (completed) {
      grantVacationReward()
      onTaskComplete(item.day)
    }
    return next
  }

  function setWeatherMode(modeId) {
    const mode = DAY9_WEATHER_MODES.find(item => item.id === modeId) || DAY9_WEATHER_MODES[0]
    if (audioRef.current) {
      audioRef.current.stop()
      audioRef.current = null
    }
    if (mode.id === 'rain') audioRef.current = createDay9RainAmbience()
    if (mode.id === 'sunny') audioRef.current = createDay9SunnyAmbience()
    updateVacationState({
      weatherMode: mode.id,
      lastSpeaker: mode.id === 'rain' ? '小柚子' : mode.id === 'sunny' ? '小橙子' : '小柚子',
      lastMessage: mode.id === 'rain' ? '雨声好适合躺着呀，今天可以慢一点。' : mode.id === 'sunny' ? '鸟叫声路过窗口，像在说：今天先晒晒太阳。' : '天气遥控器调回安静模式，房间软软地停下来。'
    }, 'day9_weather_changed')
  }

  const has = id => state.finishedActions.includes(id)

  return (
    <div className={`day9-vacation weather-${state.weatherMode} ${isComplete ? 'is-complete' : ''}`}>
      <div className="day9-room-card">
        <div className={`day9-window ${has('close_window') ? 'closed' : ''}`} aria-hidden="true">
          <i /><i /><span>{state.weatherMode === 'rain' ? 'RAIN' : state.weatherMode === 'sunny' ? 'SUN' : has('close_window') ? 'SHH' : 'OPEN'}</span>
          <b className="day9-rain-lines" /><b className="day9-sun-orb" />
        </div>
        <div className="day9-wall-stars" aria-hidden="true"><i>✦</i><i>♡</i><i>✦</i></div>
        <div className={`day9-tv ${has('tv') ? 'on' : ''}`} aria-hidden="true"><span>{has('tv') ? '休假频道' : 'OFF'}</span><i /></div>
        <div className="day9-soft-rug" aria-hidden="true" />
        <div className="day9-double-bed">
          <i className="bed-headboard" aria-hidden="true" />
          <div className="day9-couple-rest">
            <DogSprite type="pomelo" className="day9-resting-yuzu" />
            <DogSprite type="orange" className="day9-resting-orange" />
            <span className="day9-sleep-bubble">{isComplete ? '一起充电中…' : '放假准备中'}</span>
            {has('blanket') && <i className="day9-blanket-layer" aria-hidden="true" />}
            {has('pillows') && <><i className="day9-pillow-layer pillow-yuzu" aria-hidden="true" /><i className="day9-pillow-layer pillow-orange" aria-hidden="true" /></>}
          </div>
        </div>
        <button type="button" className={`day9-room-item item-window ${has('close_window') ? 'placed' : ''}`} onClick={() => finishAction(DAY9_VACATION_ACTIONS[0])} disabled={has('close_window')} aria-label="关好窗户"><span>🪟</span></button>
        <button type="button" className={`day9-room-item item-blanket ${has('blanket') ? 'placed' : ''}`} onClick={() => finishAction(DAY9_VACATION_ACTIONS[1])} disabled={has('blanket')} aria-label="盖上双人小毯子"><span>🧺</span></button>
        <button type="button" className={`day9-room-item item-fan ${has('fan') ? 'placed' : ''}`} onClick={() => finishAction(DAY9_VACATION_ACTIONS[2])} disabled={has('fan')} aria-label="打开小风扇"><span>✽</span></button>
        <button type="button" className={`day9-drink-tray ${has('drinks') ? 'placed' : ''}`} onClick={() => finishAction(DAY9_VACATION_ACTIONS[3])} disabled={has('drinks')} aria-label="摆好饮料托盘"><span className="drink lemon">🍋</span><span className="drink peach">🍑</span><span className="drink water">💧</span></button>
        <button type="button" className={`day9-room-item item-pillow ${has('pillows') ? 'placed' : ''}`} onClick={() => finishAction(DAY9_VACATION_ACTIONS[4])} disabled={has('pillows')} aria-label="塞好两个懒人抱枕"><span>☁️</span></button>
        <button type="button" className={`day9-room-item item-tv ${has('tv') ? 'placed' : ''}`} onClick={() => finishAction(DAY9_VACATION_ACTIONS[5])} disabled={has('tv')} aria-label="打开休假电视"><span>📺</span></button>
        <button type="button" className={`day9-orange-guard ${has('guard') ? 'placed' : ''}`} onClick={() => finishAction(DAY9_VACATION_ACTIONS[6])} disabled={has('guard')} aria-label="挂上不许内耗牌">
          <b>{has('guard') ? '今日不许内耗' : '挂门牌'}</b>
        </button>
        <div className={`day9-speech-bubble speaker-${state.lastSpeaker.includes('橙') ? 'orange' : 'yuzu'}`} role="status"><strong>{state.lastSpeaker}</strong><span>{state.lastMessage}</span></div>
      </div>
      <div className="day9-control-card">
        <div className="tiny-label">528 · 小柚子的假期</div>
        <h4>{isComplete ? '小柚子和小橙子正在维护模式' : '把双人休息房间布置好'}</h4>
        <p>今天不闯关，不解谜，不证明自己。点一点房间里的物品，让小柚子和小橙子一起躺好休息。</p>
        <div className="day9-weather-remote" aria-label="天气遥控器">
          <strong>天气遥控器</strong>
          <div>
            {DAY9_WEATHER_MODES.map(mode => <button type="button" key={mode.id} className={state.weatherMode === mode.id ? 'active' : ''} onClick={() => setWeatherMode(mode.id)} title={mode.helper}>{mode.icon}<span>{mode.label}</span></button>)}
          </div>
          <small>{DAY9_WEATHER_MODES.find(mode => mode.id === state.weatherMode)?.helper}</small>
        </div>
        <div className="day9-rest-meter" aria-label={`放假准备进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
        <small>{completedCount}/{DAY9_VACATION_ACTIONS.length} 项放假设施已就位</small>
        {!isComplete && pendingAction && <div className="day9-next-task">当前待完成：<strong>{pendingAction.title}</strong></div>}
        <div className="day9-action-list">
          {DAY9_VACATION_ACTIONS.map(action => {
            const done = has(action.id)
            return <button type="button" key={action.id} className={done ? 'done' : ''} onClick={() => finishAction(action)} disabled={done}>{done ? '✓' : action.icon}<span>{done ? action.done : action.title}</span></button>
          })}
        </div>
        {isComplete && <div className="day9-complete-note"><strong>休息不是暂停前进。</strong><span>是给下一次发光留一点电量。</span></div>}
      </div>
      {rewardPopupOpen && (
        <div className="day9-reward-modal" role="dialog" aria-modal="true" aria-label="获得半小时放假券">
          <div className="day9-reward-card">
            <div className="reward-sparkle" aria-hidden="true">🎟️</div>
            <div className="tiny-label">Backpack reward</div>
            <h4>获得道具：半小时放假券</h4>
            <p>使用后可以理直气壮地休息半小时。不是偷懒，是小柚子维护模式。</p>
            <button type="button" onClick={() => setRewardPopupOpen(false)}>收好放假券</button>
          </div>
        </div>
      )}
    </div>
  )
}


const CHILDREN_SPECIAL_CONFIG = {
  10: {
    type: 'intro',
    target: 25,
    reward: 'cloud_fluff_trim',
    rewardTitle: '软软的云朵绒边',
    title: '轻轻靠近小柚子',
    subtitle: '先不急着解释，把声音放小，把委屈认真接住。',
    initialMessage: '小柚子背对着坐在云朵角落里：哼。',
    completeMessage: '小柚子：我还没有完全不生气，但是你可以坐近一点点。',
    actions: [
      { id: 'bubble', icon: '🫧', title: '收起误会泡泡', done: '误会泡泡变小了', message: '小橙子：这句话可能不是那个意思，我们先把它轻轻放下。' },
      { id: 'quiet', icon: '🔇', title: '把声音调小', done: '房间安静了', message: '小柚子头上的气鼓鼓云变小了一点。' },
      { id: 'water', icon: '🥛', title: '递一杯温水', done: '温水放好了', message: '小柚子没有回头，但是小小地“嗯”了一声。' },
      { id: 'listen', icon: '👂', title: '写下：我先认真听你说', done: '纸条写好了', message: '小橙子：我先认真听你说，不急着让你不难过。' },
      { id: 'nearby', icon: '🧡', title: '坐在旁边不打扰', done: '坐近一点点', message: '小柚子：那你可以坐这里，但先不要得意。' }
    ]
  },
  11: {
    type: 'mood',
    target: 50,
    reward: 'rainbow_feather_patch',
    rewardTitle: '彩虹羽毛贴片',
    title: '收集好心情碎片',
    subtitle: '把星星、糖果、彩虹、笑脸和羽毛碎片放进小篮子。',
    initialMessage: '小柚子坐在秋千上，愿意抬头看一眼天空。',
    completeMessage: '小柚子：我刚刚好像有一点点想笑。',
    actions: [
      { id: 'star', icon: '⭐', title: '找到星星碎片', done: '星星碎片入篮', message: '小橙子接住一小片亮晶晶：这是第一点好心情。' },
      { id: 'candy', icon: '🍬', title: '拨开云朵糖纸', done: '糖果碎片入篮', message: '小柚子：这个糖纸声音……有点可爱。' },
      { id: 'rainbow', icon: '🌈', title: '调亮彩虹滑杆', done: '彩虹碎片入篮', message: '彩虹变亮，落下一片可以贴到羽毛上的颜色。' },
      { id: 'plane', icon: '✈️', title: '接住绕远路的纸飞机', done: '纸飞机碎片入篮', message: '纸飞机绕了一个弯，还是落进小橙子的篮子。' },
      { id: 'smile', icon: '😊', title: '捡起小笑脸', done: '笑脸碎片入篮', message: '小柚子偷偷弯了一下嘴角。只有一点点。' }
    ]
  },
  12: {
    type: 'repair',
    target: 75,
    reward: 'reconciliation_star_bell',
    rewardTitle: '星星和好铃铛',
    title: '认真道歉修理铺',
    subtitle: '工具要按顺序来：先听完，再修理，再贴上拥抱。',
    initialMessage: '桌上放着打结的彩线、裂缝星星和一张皱皱纸条。',
    completeMessage: '小柚子：我不是想一直生气，我只是想被认真哄一下。',
    actions: [
      { id: 'listen_ear', icon: '👂', title: '用倾听耳朵听完', done: '委屈被听见', message: '小柚子：我不是想吵架，我只是有点难过。' },
      { id: 'brush_note', icon: '🖌️', title: '用认真小刷子抚平纸条', done: '纸条被抚平', message: '纸条变平了，上面的字终于不皱巴巴。' },
      { id: 'sorry_glue', icon: '💧', title: '用道歉胶水修裂缝星星', done: '星星重新发光', message: '小橙子：对不起要慢慢说，不能糊弄过去。' },
      { id: 'screw_light', icon: '🪛', title: '用星星螺丝刀拧亮小灯', done: '小灯亮了', message: '桌面暖起来，别扭小结也没有那么硬了。' },
      { id: 'hug_sticker', icon: '🩹', title: '贴上拥抱贴纸', done: '彩线变蝴蝶结', message: '打结的彩线慢慢松开，变成一枚和好蝴蝶结。' }
    ]
  },
  13: {
    type: 'finale',
    target: 100,
    reward: 'best_shuttlecock',
    rewardTitle: '全世界最好看的羽毛球',
    title: '做一颗全世界最好看的羽毛球',
    subtitle: '先把好感度补到 100%，再把三天收集的装饰装上去。',
    initialMessage: '小柚子抱着手：哼，那我要看看你做得好不好看。',
    completeMessage: '小琳儿童节快乐。今天不用长大，今天只要做一个被好好喜欢的小孩。',
    actions: [
      { id: 'opening', icon: '🎈', title: '说：今天可以当小朋友', done: '开场白通过', message: '小柚子：这句话听起来还不错。好感度悄悄上涨。' },
      { id: 'balloons', icon: '🎈', title: '慢慢吹起三颗气球', done: '气球升起来', message: '气球没有被吓到，小朋友也没有。' },
      { id: 'smooth_note', icon: '💌', title: '抚平六一小纸条', done: '纸条展开', message: '纸条露出第一行：儿童节快乐。' },
      { id: 'shuttlecock', icon: '🏸', title: '获得用来装饰的羽毛球', done: '羽毛球本体到位', message: '小柚子：好吧，现在可以开始装饰了。', reward: 'decoratable_shuttlecock' },
      { id: 'cloud_trim', icon: '☁️', title: '装上云朵绒边', done: '云朵绒边装好了', message: '难过的时候，也可以被软软接住。' },
      { id: 'rainbow_patch', icon: '🌈', title: '贴上彩虹羽毛贴片', done: '彩虹羽毛贴好了', message: '好心情不是一下子回来，是一片一片贴回来。' },
      { id: 'star_bell', icon: '🔔', title: '挂上星星和好铃铛', done: '和好铃铛响了', message: '叮——和好不是忘记，是重新靠近。' },
      { id: 'final_light', icon: '✨', title: '点亮儿童节星光', done: '礼物完成', message: '全世界最好看的羽毛球完成了。小柚子笑得很明显。', reward: 'children_day_note' }
    ]
  }
}

function getChildrenSpecialEmptyState(day) {
  const config = CHILDREN_SPECIAL_CONFIG[day]
  return {
    completedActions: [],
    completed: false,
    rewardClaimed: false,
    lastMessage: config?.initialMessage || '小柚子正在等一个认真一点的哄哄。',
    noteOpened: false
  }
}

function normalizeChildrenSpecialState(day, value = {}) {
  const config = CHILDREN_SPECIAL_CONFIG[day]
  const allowed = (config?.actions || []).map(action => action.id)
  const completedActions = allowed.filter(id => Array.isArray(value.completedActions) && value.completedActions.includes(id))
  const completed = Boolean(value.completed) || Boolean(config && completedActions.length >= config.actions.length)
  return {
    ...getChildrenSpecialEmptyState(day),
    ...value,
    completedActions,
    completed,
    rewardClaimed: Boolean(value.rewardClaimed || completed),
    lastMessage: value.lastMessage || config?.initialMessage || '',
    noteOpened: Boolean(value.noteOpened)
  }
}

function loadChildrenSpecialState(day) {
  return normalizeChildrenSpecialState(day, getRoleJson(`wwcxrl-children-special-day${day}`, {}))
}

function saveChildrenSpecialState(day, next, { cloud = true } = {}) {
  const normalized = normalizeChildrenSpecialState(day, next)
  setRoleJson(`wwcxrl-children-special-day${day}`, normalized)
  if (cloud) saveCloudDayProgress(day, normalized).catch(error => console.warn(`[wwcxrl cloud] children day${day} save failed`, error.message))
  return normalized
}

function grantChildrenReward(itemId, count = 1) {
  if (!itemId) return
  const bag = loadBackpack()
  const nextBag = { ...bag, [itemId]: Math.max(Number(bag[itemId] || 0), count) }
  saveBackpack(nextBag)
  addCloudBackpackItems([{ id: itemId, count }]).catch(error => console.warn('[wwcxrl cloud] children reward failed', error.message))
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
}

function ChildrenComfortQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const config = CHILDREN_SPECIAL_CONFIG[item.day]
  const [state, setState] = useState(() => loadChildrenSpecialState(item.day))
  const [rewardPopup, setRewardPopup] = useState(null)
  const stateRef = React.useRef(state)
  React.useEffect(() => { stateRef.current = state }, [state])

  React.useEffect(() => {
    let alive = true
    loadCloudDayProgress(item.day).then(remote => {
      if (!alive || !remote?.progress) return
      const merged = normalizeChildrenSpecialState(item.day, { ...stateRef.current, ...remote.progress })
      stateRef.current = saveChildrenSpecialState(item.day, merged, { cloud: false })
      setState(stateRef.current)
    }).catch(() => {})
    const handleReset = event => {
      if (event.detail?.day !== item.day) return
      const fresh = loadChildrenSpecialState(item.day)
      stateRef.current = fresh
      setState(fresh)
      setRewardPopup(null)
    }
    window.addEventListener('wwcxrl-children-special-reset', handleReset)
    return () => {
      alive = false
      window.removeEventListener('wwcxrl-children-special-reset', handleReset)
    }
  }, [item.day])

  if (!config) return null

  const completedCount = state.completedActions.length
  const progress = Math.round(completedCount / config.actions.length * 100)
  const affection = state.completed ? config.target : Math.round((config.target - 25) + completedCount / config.actions.length * 25)
  const has = id => state.completedActions.includes(id)
  const pending = config.actions.find(action => !has(action.id))

  function update(patch, eventType = 'children_special_update') {
    const next = saveChildrenSpecialState(item.day, { ...stateRef.current, ...patch })
    stateRef.current = next
    setState(next)
    logCloudEvent(eventType, { day: item.day, patch, state: next }, item.day)
    return next
  }

  function finishAction(action) {
    if (has(action.id)) return
    const completedActions = [...stateRef.current.completedActions, action.id]
    const completed = completedActions.length >= config.actions.length
    if (action.reward) grantChildrenReward(action.reward)
    update({
      completedActions,
      completed,
      rewardClaimed: completed,
      lastMessage: completed ? config.completeMessage : action.message,
      noteOpened: completed && item.day === 13 ? true : stateRef.current.noteOpened
    }, completed ? 'children_special_completed' : 'children_special_action')
    if (completed) {
      grantChildrenReward(config.reward)
      if (item.day === 13) grantChildrenReward('children_day_note')
      setRewardPopup({ icon: item.icon, title: `获得道具：${config.rewardTitle}`, text: completed ? config.completeMessage : action.message })
      onTaskComplete(item.day)
    }
  }

  return (
    <div className={`children-special children-day-${item.day} ${state.completed ? 'is-complete' : ''}`}>
      <div className="children-story-card">
        <div className="children-scene" aria-label={config.title}>
          <div className="children-sky" aria-hidden="true"><i /><i /><i /></div>
          <div className={`children-yuzu ${state.completed ? 'happy' : completedCount > 2 ? 'softened' : 'upset'}`} aria-hidden="true">
            <DogSprite type="pomelo" />
            <span>{state.completed ? '被哄好啦' : completedCount > 2 ? '可以靠近一点' : '哼'}</span>
          </div>
          <div className="children-orange" aria-hidden="true"><DogSprite type="orange" /><span>认真哄哄中</span></div>
          <div className="children-prop-stage" aria-hidden="true">
            {item.day === 10 && <><b className="mood-cloud cloud-a">气鼓鼓云</b><b className="warm-water">温水</b><b className="soft-note">我先认真听你说</b></>}
            {item.day === 11 && <><b className="mood-basket">好心情篮子</b><b className="rainbow-arc">彩虹</b><b className="paper-plane">纸飞机</b></>}
            {item.day === 12 && <><b className="repair-knot">别扭小结</b><b className="repair-star">裂缝星星</b><b className="repair-lamp">小灯</b></>}
            {item.day === 13 && <div className={`children-shuttlecock ${has('cloud_trim') ? 'has-cloud' : ''} ${has('rainbow_patch') ? 'has-rainbow' : ''} ${has('star_bell') ? 'has-bell' : ''} ${state.completed ? 'is-lit' : ''}`}><i /><i /><i /><em /><strong>🏸</strong></div>}
          </div>
          <div className="children-speech" role="status">{state.lastMessage}</div>
        </div>
        <div className="children-control-card">
          <div className="tiny-label">哄哄小柚子儿童节特别篇</div>
          <h4>{config.title}</h4>
          <p>{config.subtitle}</p>
          <div className="children-affection-meter" aria-label={`小柚子好感度 ${Math.min(affection, config.target)}%`}>
            <strong>小柚子好感度</strong>
            <span>{Math.min(affection, config.target)}%</span>
            <div><i style={{ width: `${Math.min(affection, config.target)}%` }} /></div>
          </div>
          <div className="children-progress-row"><span>{completedCount}/{config.actions.length} 个哄哄步骤</span>{pending && <b>当前：{pending.title}</b>}</div>
          <div className="children-action-grid">
            {config.actions.map(action => {
              const done = has(action.id)
              return <button type="button" key={action.id} className={done ? 'done' : ''} onClick={() => finishAction(action)} disabled={done}>{done ? '✓' : action.icon}<span>{done ? action.done : action.title}</span></button>
            })}
          </div>
          {item.day === 13 && state.completed && (
            <div className="children-final-note">
              <strong>小琳儿童节快乐。</strong>
              <span>希望你心里那个会认真开心、也会认真委屈的小朋友，永远都可以被好好接住。今天不用长大。今天只要收下这颗全世界最好看的羽毛球。</span>
            </div>
          )}
        </div>
      </div>
      {rewardPopup && (
        <div className="children-reward-modal" role="dialog" aria-modal="true" aria-label={rewardPopup.title}>
          <div className="children-reward-card">
            <div>{rewardPopup.icon}</div>
            <h4>{rewardPopup.title}</h4>
            <p>{rewardPopup.text}</p>
            <button type="button" onClick={() => setRewardPopup(null)}>收好</button>
          </div>
        </div>
      )}
    </div>
  )
}


const SLEEP_PLACES = [
  { id: 'tree', label: '树枝', icon: '🌳' },
  { id: 'treehole', label: '树洞', icon: '🕳️' },
  { id: 'doorstep', label: '楼房门口', icon: '🏠' },
  { id: 'doghouse', label: '狗窝', icon: '🐾' },
  { id: 'moon', label: '月亮', icon: '🌙' },
  { id: 'bed', label: '云朵', icon: '☁️' },
  { id: 'roof', label: '房顶', icon: '🏘️' }
]

const SLEEP_ATMOSPHERE_OPTIONS = {
  time: [
    { id: 'day', label: '白天' },
    { id: 'dusk', label: '黄昏' },
    { id: 'night', label: '夜晚' }
  ],
  weather: [
    { id: 'sunny', label: '晴天' },
    { id: 'rain', label: '小雨' },
    { id: 'breeze', label: '微风' }
  ],
  light: [
    { id: 'bright', label: '亮亮' },
    { id: 'warm', label: '暖暖' },
    { id: 'dim', label: '暗暗' }
  ]
}

const SLEEP_ANIMALS = [
  { id: 'owl', name: '猫头鹰', icon: '🦉', className: 'owl', place: 'tree', prefs: { time: ['night'], weather: ['breeze'], light: ['dim'] }, success: '猫头鹰把眼睛眯成两弯月牙：好困困，睡觉觉~', fail: '猫头鹰轻轻眨眼：还不想睡。' },
  { id: 'orangeCat', name: '大橘', icon: '🐈', className: 'orange-cat', place: 'doorstep', prefs: { time: ['night'], weather: ['breeze', 'sunny'], light: ['warm', 'dim'] }, success: '大橘在楼房门口盘成一团：好困困，睡觉觉~', fail: '大橘甩甩尾巴：今晚还不是我的门口觉。' },
  { id: 'dog', name: '小狗', icon: '🐶', className: 'dog', place: 'doghouse', prefs: { time: ['day'], weather: ['sunny'], light: ['warm'] }, success: '小狗在白天晴晴暖暖的窝窝里，把鼻子埋进小毯子：好困困，睡觉觉~', fail: '小狗叼着毯子：想要白天、晴天、暖暖的地方。' },
  { id: 'moonRabbit', name: '月亮兔', icon: '🐰', className: 'rabbit', place: 'moon', prefs: { time: ['night'], weather: ['breeze', 'sunny'], light: ['dim', 'warm'] }, success: '月亮兔跳到月亮上，耳朵软软垂下来：好困困，睡觉觉~', fail: '月亮兔抱着耳朵：月亮还没有出来，或者月光还没有刚刚好。' },
  { id: 'hamster', name: '仓鼠团子', icon: '🐹', className: 'hamster', place: 'treehole', prefs: { time: ['day'], weather: ['sunny'], light: ['bright', 'warm'] }, success: '仓鼠团子钻进树洞，抱着瓜子缩成圆圆一颗：好困困，睡觉觉~', fail: '仓鼠团子抱着瓜子：想找一个暖暖的小树洞。' }
]

const SLEEP_YUZU = { id: 'yuzu', name: '小柚子', icon: '柚', className: 'yuzu' }

const SLEEP_YUZU_PLACE_LINES = {
  tree: { sleepy: '树枝晃晃的……也想睡觉……', rested: '树上也好好睡，换个地方试试睡呢?' },
  treehole: { sleepy: '树洞小小暖暖的……想睡觉……', rested: '树洞也好好睡，换个地方试试睡呢?' },
  doorstep: { sleepy: '门口有大橘的味道……想靠一下睡觉……', rested: '楼房门口也好好睡，换个地方试试睡呢?' },
  doghouse: { sleepy: '狗窝软软的……想睡觉……', rested: '狗窝也好好睡，换个地方试试睡呢?' },
  moon: { sleepy: '月亮亮亮软软的……想睡觉……', rested: '月亮也好好睡，换个地方试试睡呢?' },
  bed: { sleepy: '云朵轻飘飘的……想睡觉……', rested: '云朵也好好睡，换个地方试试睡呢?' },
  roof: { sleepy: '房顶风吹吹的……也想睡觉……', rested: '房顶也好好睡，换个地方试试睡呢?' }
}

function getEmptySleepLabState() {
  return {
    atmosphere: { time: 'night', weather: 'breeze', light: 'dim' },
    selectedAnimal: 'owl',
    placed: {},
    asleep: {},
    bubbles: {},
    yuzu: { unlocked: false, placedAt: null, asleep: false, triedPlaces: [], phase: 'locked', bubble: '' },
    finalShown: false,
    message: '选择一只小动物，调好氛围，放到睡觉位置后再点击 Sleep。调节过程中小动物不会剧透哦。'
  }
}

function normalizeSleepLabState(value = {}) {
  const empty = getEmptySleepLabState()
  const validAnimalIds = new Set(SLEEP_ANIMALS.map(animal => animal.id))
  const placed = Object.fromEntries(Object.entries(value.placed || {}).filter(([id]) => validAnimalIds.has(id)))
  const asleep = Object.fromEntries(Object.entries(value.asleep || {}).filter(([id]) => validAnimalIds.has(id)))
  const bubbles = Object.fromEntries(Object.entries(value.bubbles || {}).filter(([id]) => validAnimalIds.has(id) || id === 'yuzu'))
  const selectedAnimal = validAnimalIds.has(value.selectedAnimal) || value.selectedAnimal === 'yuzu' ? value.selectedAnimal : empty.selectedAnimal
  const allRegularAsleep = SLEEP_ANIMALS.every(animal => asleep[animal.id])
  const finalShown = Boolean(value.finalShown)
  const mergedYuzu = { ...empty.yuzu, ...(value.yuzu || {}), unlocked: Boolean(value.yuzu?.unlocked || allRegularAsleep) }
  if (allRegularAsleep && !finalShown && (!mergedYuzu.phase || mergedYuzu.phase === 'locked')) {
    mergedYuzu.phase = 'idle'
    mergedYuzu.bubble = mergedYuzu.bubble || '哪里比较好睡呢?'
    mergedYuzu.asleep = false
  }
  if (allRegularAsleep && finalShown && (!mergedYuzu.phase || mergedYuzu.phase === 'locked')) {
    mergedYuzu.phase = 'final'
    mergedYuzu.bubble = '哪里都好好睡，真舒服~'
    mergedYuzu.asleep = true
  }
  return {
    ...empty,
    ...value,
    atmosphere: { ...empty.atmosphere, ...(value.atmosphere || {}) },
    selectedAnimal,
    placed,
    asleep,
    bubbles,
    yuzu: mergedYuzu,
    finalShown
  }
}

function isFlowerCrownTaskActuallyComplete(day) {
  const state = getRoleJson(`wwcxrl-flower-crown-day${day}`, {})
  const backpack = loadBackpack()
  return Boolean(state.completed && state.worn && state.crafted && (state.craftedPieces?.length || 0) >= FLOWER_CROWN_TARGET && Number(backpack.flower_crown || 0) > 0)
}

function isSleepLabTaskActuallyComplete(day) {
  const sleepState = normalizeSleepLabState(getRoleJson(`wwcxrl-sleep-lab-day${day}`, {}))
  const backpack = loadBackpack()
  return Boolean(sleepState.finalShown && sleepState.yuzu?.asleep && Number(backpack.good_sleep_night_lamp || 0) > 0)
}

function loadSleepLabState(day) {
  return normalizeSleepLabState(getRoleJson(`wwcxrl-sleep-lab-day${day}`, {}))
}

function saveSleepLabState(day, next, { cloud = true } = {}) {
  const normalized = normalizeSleepLabState(next)
  setRoleJson(`wwcxrl-sleep-lab-day${day}`, normalized)
  if (cloud) saveCloudDayProgress(day, normalized).catch(error => console.warn(`[wwcxrl cloud] sleep lab day${day} save failed`, error.message))
  return normalized
}

function SleepAtmosphereLab({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const [state, setState] = useState(() => loadSleepLabState(item.day))
  const [finalOpen, setFinalOpen] = useState(false)
  const [labOpen, setLabOpen] = useState(false)
  const stateRef = React.useRef(state)
  const yuzuTimerRef = React.useRef(null)
  const [yuzuDrag, setYuzuDrag] = useState(null)
  React.useEffect(() => { stateRef.current = state }, [state])

  React.useEffect(() => () => { if (yuzuTimerRef.current) window.clearTimeout(yuzuTimerRef.current) }, [])

  React.useEffect(() => {
    let alive = true
    loadCloudDayProgress(item.day).then(remote => {
      if (!alive || !remote?.progress) return
      const merged = saveSleepLabState(item.day, { ...stateRef.current, ...remote.progress }, { cloud: false })
      stateRef.current = merged
      setState(merged)
      if (merged.finalShown && !taskCompleted) onTaskComplete(item.day)
    }).catch(() => {})
    const reset = event => {
      if (event.detail?.day !== item.day) return
      const fresh = loadSleepLabState(item.day)
      stateRef.current = fresh
      setState(fresh)
      setFinalOpen(false)
      setYuzuDrag(null)
      if (yuzuTimerRef.current) window.clearTimeout(yuzuTimerRef.current)
    }
    window.addEventListener('wwcxrl-sleep-lab-reset', reset)
    return () => { alive = false; window.removeEventListener('wwcxrl-sleep-lab-reset', reset) }
  }, [item.day])

  const allRegularAsleep = SLEEP_ANIMALS.every(animal => state.asleep[animal.id])
  const activeAnimal = SLEEP_ANIMALS.find(animal => animal.id === state.selectedAnimal) || (state.yuzu.unlocked ? SLEEP_YUZU : SLEEP_ANIMALS[0])
  const selectedIsYuzu = activeAnimal.id === 'yuzu'

  function persist(patch, eventType = 'sleep_lab_update') {
    const next = saveSleepLabState(item.day, { ...stateRef.current, ...patch })
    stateRef.current = next
    setState(next)
    logCloudEvent(eventType, { day: item.day, patch, state: next }, item.day)
    return next
  }

  function setAtmosphere(key, value) {
    persist({ atmosphere: { ...stateRef.current.atmosphere, [key]: value } }, 'sleep_lab_atmosphere_changed')
  }

  function selectAnimal(id) {
    if (id === 'yuzu' && !allRegularAsleep) return
    persist({
      selectedAnimal: id,
      ...(id === 'yuzu' ? { message: '拖动小柚子，为她找个睡觉的好地方吧~' } : {})
    }, 'sleep_lab_animal_selected')
  }

  function yuzuSleepAt(placeId, source = 'drop') {
    if (!allRegularAsleep) return
    const currentYuzu = stateRef.current.yuzu || {}
    const tried = Array.from(new Set([...(currentYuzu.triedPlaces || []), placeId]))
    const finalTry = tried.length >= 3
    const line = SLEEP_YUZU_PLACE_LINES[placeId] || { sleepy: '这里好像也很适合睡觉……', rested: '这里也好好睡，换个地方试试睡呢?' }
    if (yuzuTimerRef.current) window.clearTimeout(yuzuTimerRef.current)
    persist({
      selectedAnimal: 'yuzu',
      yuzu: { ...currentYuzu, unlocked: true, placedAt: placeId, triedPlaces: tried, phase: 'dozing', bubble: line.sleepy, asleep: false },
      message: '小柚子眼睛慢慢闭上了……她好像放在哪里都想睡。'
    }, `sleep_lab_yuzu_${source}_sleepy`)
    yuzuTimerRef.current = window.setTimeout(() => {
      const latest = stateRef.current.yuzu || {}
      if (finalTry) {
        const nextYuzu = { ...latest, placedAt: placeId, triedPlaces: tried, phase: 'final', bubble: '哪里都好好睡，真舒服~', asleep: true }
        persist({
          yuzu: nextYuzu,
          finalShown: true,
          bubbles: {},
          message: '603 睡眠研究所最终结论：小柚子在哪里都能睡着。'
        }, 'sleep_lab_completed')
        grantChildrenReward('good_sleep_night_lamp')
        setFinalOpen(true)
        onTaskComplete(item.day)
        return
      }
      persist({
        yuzu: { ...latest, placedAt: placeId, triedPlaces: tried, phase: 'awake', bubble: line.rested, asleep: false },
        message: '小柚子醒来啦：换个地方试试睡呢?'
      }, 'sleep_lab_yuzu_awake_try_more')
    }, 2200)
  }

  function placeAnimal(placeId) {
    if (placeId === 'moon' && stateRef.current.atmosphere.time !== 'night') {
      persist({ message: '月亮只有把时间调到夜晚才会出来，月亮兔才能去月亮上睡觉。' }, 'sleep_lab_moon_not_visible')
      return
    }
    const current = stateRef.current.selectedAnimal
    if (current === 'yuzu') {
      yuzuSleepAt(placeId, 'button')
      return
    }
    if (stateRef.current.asleep[current]) return
    persist({ placed: { ...stateRef.current.placed, [current]: placeId } }, 'sleep_lab_animal_placed')
  }

  function animalMatches(animal) {
    const atmosphere = stateRef.current.atmosphere
    return stateRef.current.placed[animal.id] === animal.place && Object.entries(animal.prefs).every(([key, allowed]) => allowed.includes(atmosphere[key]))
  }

  function handleSleep() {
    const current = stateRef.current.selectedAnimal
    if (current === 'yuzu') {
      if (!allRegularAsleep) return
      if (!stateRef.current.yuzu.placedAt) {
        persist({ yuzu: { ...stateRef.current.yuzu, phase: 'idle', bubble: '哪里比较好睡呢?' }, message: '拖动小柚子，为她找个睡觉的好地方吧~' }, 'sleep_lab_yuzu_sleep_without_place')
        return
      }
      yuzuSleepAt(stateRef.current.yuzu.placedAt, 'sleep_button')
      return
    }
    const animal = SLEEP_ANIMALS.find(a => a.id === current)
    if (!animal || stateRef.current.asleep[current]) return
    const ok = animalMatches(animal)
    const asleep = { ...stateRef.current.asleep, ...(ok ? { [current]: true } : {}) }
    const allDone = SLEEP_ANIMALS.every(a => asleep[a.id])
    persist({
      asleep,
      yuzu: { ...stateRef.current.yuzu, unlocked: allDone || stateRef.current.yuzu.unlocked, phase: allDone ? 'idle' : stateRef.current.yuzu.phase, bubble: allDone ? '哪里比较好睡呢?' : stateRef.current.yuzu.bubble },
      selectedAnimal: allDone ? 'yuzu' : current,
      bubbles: allDone ? {} : { ...stateRef.current.bubbles, [current]: ok ? animal.success : animal.fail },
      message: ok ? `${animal.name} 睡着啦。${allDone ? '拖动小柚子，为她找个睡觉的好地方吧~' : '继续帮下一只小动物调睡眠氛围。'}` : `${animal.name} 还不想睡，换一换氛围或位置再点 Sleep。`
    }, ok ? 'sleep_lab_animal_asleep' : 'sleep_lab_animal_not_sleepy')
  }

  const visibleAnimals = allRegularAsleep ? [...SLEEP_ANIMALS, SLEEP_YUZU] : SLEEP_ANIMALS
  const totalSleepers = SLEEP_ANIMALS.length + 1
  const sleepingCount = Object.values(state.asleep).filter(Boolean).length + (state.yuzu.asleep ? 1 : 0)
  const sceneClass = `sleep-lab-scene time-${state.atmosphere.time} weather-${state.atmosphere.weather} light-${state.atmosphere.light}`

  function beginYuzuDrag(event) {
    if (!allRegularAsleep || stateRef.current.finalShown) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const scene = event.currentTarget.closest('.sleep-lab-scene')
    const sceneRect = scene?.getBoundingClientRect()
    const rect = event.currentTarget.getBoundingClientRect()
    if (!sceneRect || !scene) return
    const sceneLeft = sceneRect.left + scene.clientLeft
    const sceneTop = sceneRect.top + scene.clientTop
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    setYuzuDrag({
      x: rect.left - sceneLeft,
      y: rect.top - sceneTop,
      offsetX,
      offsetY,
      sceneLeft,
      sceneTop
    })
    persist({ yuzu: { ...stateRef.current.yuzu, phase: 'dragging', bubble: '哪里比较好睡呢?', asleep: false }, message: '拖动小柚子，为她找个睡觉的好地方吧~' }, 'sleep_lab_yuzu_drag_start')
  }

  function moveYuzuDrag(event) {
    if (!yuzuDrag) return
    event.preventDefault()
    setYuzuDrag(current => current ? {
      ...current,
      x: event.clientX - current.sceneLeft - current.offsetX,
      y: event.clientY - current.sceneTop - current.offsetY
    } : current)
  }

  function endYuzuDrag(event) {
    if (!yuzuDrag) return
    event.preventDefault()
    const target = (document.elementsFromPoint?.(event.clientX, event.clientY) || [document.elementFromPoint(event.clientX, event.clientY)])
      .find(element => element && !element.classList?.contains('sleep-yuzu-dragger') && element.closest?.('[data-sleep-place]'))
      ?.closest('[data-sleep-place]')
    const placeId = target?.getAttribute('data-sleep-place')
    setYuzuDrag(null)
    if (placeId) {
      yuzuSleepAt(placeId, 'drag_drop')
    } else {
      persist({ yuzu: { ...stateRef.current.yuzu, phase: 'idle', bubble: '哪里比较好睡呢?', asleep: false }, message: '把小柚子拖到一个睡觉位置上试试看~' }, 'sleep_lab_yuzu_drag_missed')
    }
  }

  return (
    <>
      <div className="sleep-lab-entry-card">
        <div className="sleep-entry-illustration" aria-hidden="true">
          <span className="sleep-entry-moon">🌙</span>
          <span className="sleep-entry-house">🏠</span>
          <span className="sleep-entry-cat">🐈</span>
          <span className="sleep-entry-dog">🐶</span>
          <span className="sleep-entry-yuzu"><DogSprite type="pomelo" /></span>
        </div>
        <div>
          <span className="tiny-label">603 Sleep Atmosphere Lab</span>
          <h4>小动物睡眠氛围研究所</h4>
          <p>签到页先保持清爽。点击开始签到，进入一间更大的睡眠研究所，再为猫头鹰、大橘、小狗、月亮兔、仓鼠团子和小柚子调睡觉氛围。</p>
          <div className="sleep-entry-progress"><span style={{ width: `${Math.round(sleepingCount / totalSleepers * 100)}%` }} /></div>
          <small>{state.finalShown ? '大家已经睡着啦，可以签到。' : `已睡着 ${sleepingCount}/${totalSleepers}`}</small>
        </div>
        <button type="button" className="sleep-entry-start" onClick={() => setLabOpen(true)}>开始签到</button>
      </div>
      {labOpen && createPortal(
        <div className="sleep-lab-modal" role="dialog" aria-modal="true" aria-label="603 小动物睡眠氛围研究所">
          <div className="sleep-lab-modal-card">
            <button type="button" className="sleep-lab-modal-close" onClick={() => setLabOpen(false)} aria-label="关闭睡眠研究所">×</button>
            <div className="sleep-lab">
              <div className="sleep-lab-header">
        <div><span className="tiny-label">603 Sleep Atmosphere Lab</span><h4>小动物睡眠氛围研究所</h4><p>每次只照顾一只小动物：选动物、调时间/天气/光线、放位置，然后点击 <b>Sleep</b>。月亮只有夜晚才会出现。</p></div>
        <button type="button" className="sleep-main-button" onClick={handleSleep}>Sleep</button>
      </div>
      <div className="sleep-lab-grid">
        <aside className="sleep-control-panel">
          {Object.entries(SLEEP_ATMOSPHERE_OPTIONS).map(([key, options]) => (
            <div className="sleep-dial" key={key}>
              <strong>{key === 'time' ? '时间' : key === 'weather' ? '天气' : '光线'}</strong>
              <div>
                {options.map(option => <button type="button" key={option.id} className={state.atmosphere[key] === option.id ? 'active' : ''} onClick={() => setAtmosphere(key, option.id)}>{option.label}</button>)}
              </div>
            </div>
          ))}
          <p className="sleep-lab-message">{state.message}</p>
        </aside>
        <section className={sceneClass} aria-label="睡眠研究所场景" onPointerMove={moveYuzuDrag} onPointerUp={endYuzuDrag} onPointerCancel={endYuzuDrag}>
          <div className="sleep-sky"><i /><i /><i /></div>
          <div className="sleep-sun" aria-hidden="true" />
          <div className="sleep-building" data-sleep-place="doorstep"><b>楼房</b><span className="window one" /><span className="window two" /><span className="door">门口</span></div>
          <div className="sleep-tree" data-sleep-place="tree"><b>树</b><i /></div>
          <div className="sleep-treehole" data-sleep-place="treehole">树洞</div>
          <div className="sleep-doghouse" data-sleep-place="doghouse">狗窝</div>
          <div className="sleep-bed" data-sleep-place="bed">云朵</div>
          <div className="sleep-moon-place" data-sleep-place="moon">月亮</div>
          <div className="sleep-roof" data-sleep-place="roof">房顶</div>
          <div className="sleep-place-grid">
            {SLEEP_PLACES.map(place => <button type="button" key={place.id} data-sleep-place={place.id} className={`sleep-place ${allRegularAsleep ? 'yuzu-open' : ''}`} onClick={() => placeAnimal(place.id)}>{place.icon}<span>{place.label}</span></button>)}
          </div>
          {visibleAnimals.map(animal => {
            if (animal.id === 'yuzu') return null
            const placedAt = animal.id === 'yuzu' ? state.yuzu.placedAt : state.placed[animal.id]
            const place = SLEEP_PLACES.find(p => p.id === placedAt)
            const asleep = animal.id === 'yuzu' ? state.yuzu.asleep : state.asleep[animal.id]
            const bubble = allRegularAsleep ? null : state.bubbles[animal.id]
            return <div key={animal.id} className={`sleep-scene-animal ${animal.className} ${placedAt || 'waiting'} ${asleep ? 'asleep' : ''}`}><span>{animal.icon}</span><small>{animal.name}{place ? ` · ${place.label}` : ''}</small>{bubble && <em>{bubble}</em>}</div>
          })}
          {allRegularAsleep && (
            <div
              className={`sleep-yuzu-dragger ${state.yuzu.placedAt || 'waiting'} phase-${state.yuzu.phase || 'idle'} ${state.yuzu.asleep ? 'asleep' : ''} ${yuzuDrag ? 'dragging' : ''}`}
              style={yuzuDrag ? { left: `${yuzuDrag.x}px`, top: `${yuzuDrag.y}px` } : undefined}
              onPointerDown={beginYuzuDrag}
              onPointerMove={moveYuzuDrag}
              onPointerUp={endYuzuDrag}
              onPointerCancel={endYuzuDrag}
              role="button"
              tabIndex={0}
              aria-label="拖动小柚子找睡觉的位置"
            >
              <DogSprite type="pomelo" className="sleep-yuzu-sprite" />
              <small>小柚子{state.yuzu.placedAt ? ` · ${SLEEP_PLACES.find(p => p.id === state.yuzu.placedAt)?.label || ''}` : ''}</small>
              {(state.yuzu.bubble || '哪里比较好睡呢?') && <em>{state.yuzu.bubble || '哪里比较好睡呢?'}</em>}
            </div>
          )}
        </section>
        <aside className="sleep-animal-list">
          {visibleAnimals.map(animal => {
            const asleep = animal.id === 'yuzu' ? state.yuzu.asleep : state.asleep[animal.id]
            return <button type="button" key={animal.id} className={`sleep-animal-card ${animal.id === 'yuzu' ? 'yuzu-card' : ''} ${state.selectedAnimal === animal.id ? 'selected' : ''} ${asleep ? 'asleep' : ''}`} onClick={() => selectAnimal(animal.id)}><span>{animal.id === 'yuzu' ? <DogSprite type="pomelo" /> : animal.icon}</span><strong>{animal.name}</strong><small>{asleep ? '已睡着' : state.selectedAnimal === animal.id ? '当前照顾' : '等待'}</small></button>
          })}
          {allRegularAsleep && (
            <div className="sleep-yuzu-anywhere-tip">
              <strong>小柚子困困模式</strong>
              <p>拖动小柚子，为她找个睡觉的好地方吧~ 试过几个地方后，她会得出最终结论。</p>
              <small>已试过 {state.yuzu.triedPlaces?.length || 0}/3 个地方</small>
            </div>
          )}
        </aside>
      </div>
      {finalOpen && createPortal(
        <div className="sleep-final-modal" role="dialog" aria-modal="true" aria-label="小琳夜夜都好眠">
          <div className="sleep-final-card">
            <div className="sleep-cartoon"><DogSprite type="pomelo" /><span className="sleep-blanket" /><i>💤</i></div>
            <h4>小琳夜夜都好眠~</h4>
            <p>小动物们都睡着啦。小柚子试过树枝、树洞、门口、狗窝、月亮、云朵和房顶后发现：原来哪里都好好睡，真舒服~</p>
            <p><b>获得道具：好眠小夜灯</b></p>
            <button type="button" onClick={() => setFinalOpen(false)}>收好小夜灯</button>
          </div>
        </div>,
        document.body
      )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

const FLOWER_CROWN_MATERIALS = [
  { id: 'pink-petal', label: '粉粉花瓣', kind: 'petal pink', symbol: '花瓣', angle: -18 },
  { id: 'cream-petal', label: '奶油花瓣', kind: 'petal cream', symbol: '花瓣', angle: 16 },
  { id: 'peach-bloom', label: '蜜桃小花', kind: 'bloom peach', symbol: '小花', angle: -6 },
  { id: 'yellow-bloom', label: '暖黄小花', kind: 'bloom yellow', symbol: '小花', angle: 10 },
  { id: 'leaf-sprig', label: '小绿叶', kind: 'leaf', symbol: '叶子', angle: -26 },
  { id: 'star-fluff', label: '亮晶晶', kind: 'spark', symbol: '星星', angle: 8 }
]

const FLOWER_CROWN_TARGET = 18
const FLOWER_CROWN_MAX = 24
const FLOWER_CROWN_SLOT_COUNT = 24

function getEmptyFlowerCrownState() {
  return {
    placed: [],
    crafted: false,
    craftedPieces: [],
    completed: false,
    worn: false,
    message: '把花瓣、小花和叶子贴满透明胶带一整圈。铺满以后，先点“制作成花环”，再戴到小柚子头上。'
  }
}

function normalizeFlowerCrownState(value = {}) {
  const empty = getEmptyFlowerCrownState()
  const validIds = new Set(FLOWER_CROWN_MATERIALS.map(item => item.id))
  const placed = Array.isArray(value.placed)
    ? value.placed.filter(item => item && validIds.has(item.materialId)).slice(0, FLOWER_CROWN_MAX)
    : []
  const craftedPieces = Array.isArray(value.craftedPieces)
    ? value.craftedPieces.filter(item => item && validIds.has(item.materialId)).slice(0, FLOWER_CROWN_MAX)
    : []
  const crafted = Boolean(value.crafted) || Boolean(value.worn && (craftedPieces.length || placed.length) >= FLOWER_CROWN_TARGET)
  return {
    ...empty,
    ...value,
    placed,
    crafted,
    craftedPieces: craftedPieces.length ? craftedPieces : (crafted ? placed : []),
    completed: Boolean(value.completed),
    worn: Boolean(value.worn)
  }
}

function loadFlowerCrownState(day) {
  return normalizeFlowerCrownState(getRoleJson(`wwcxrl-flower-crown-day${day}`, {}))
}

function saveFlowerCrownState(day, next, { cloud = true } = {}) {
  const normalized = normalizeFlowerCrownState(next)
  setRoleJson(`wwcxrl-flower-crown-day${day}`, normalized)
  if (cloud) saveCloudDayProgress(day, normalized).catch(error => console.warn(`[wwcxrl cloud] flower crown day${day} save failed`, error.message))
  return normalized
}

function FlowerCrownQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const [state, setState] = useState(() => loadFlowerCrownState(item.day))
  const [draggingId, setDraggingId] = useState(null)
  const [finalOpen, setFinalOpen] = useState(false)
  const stateRef = React.useRef(state)
  React.useEffect(() => { stateRef.current = state }, [state])

  React.useEffect(() => {
    const handleReset = event => {
      if (event.detail?.day && event.detail.day !== item.day) return
      const fresh = loadFlowerCrownState(item.day)
      stateRef.current = fresh
      setState(fresh)
      setDraggingId(null)
      setFinalOpen(false)
    }
    window.addEventListener('wwcxrl-signed-updated', handleReset)
    return () => window.removeEventListener('wwcxrl-signed-updated', handleReset)
  }, [item.day])

  const placedCount = state.placed.length
  const crownPieces = state.craftedPieces?.length ? state.craftedPieces : (state.crafted ? state.placed : [])
  const readyToCraft = !state.crafted && placedCount >= FLOWER_CROWN_TARGET
  const crownMade = Boolean(state.crafted && crownPieces.length >= FLOWER_CROWN_TARGET)
  const readyToWear = crownMade && !state.worn

  function persist(patch, eventType = 'flower_crown_update') {
    const next = saveFlowerCrownState(item.day, { ...stateRef.current, ...patch })
    stateRef.current = next
    setState(next)
    logCloudEvent(eventType, { day: item.day, state: next }, item.day)
    return next
  }

  function addMaterial(materialId, source = 'click') {
    if (stateRef.current.worn || stateRef.current.crafted || stateRef.current.placed.length >= FLOWER_CROWN_MAX) return
    const material = FLOWER_CROWN_MATERIALS.find(item => item.id === materialId) || FLOWER_CROWN_MATERIALS[0]
    const index = stateRef.current.placed.length
    const nextPlaced = [
      ...stateRef.current.placed,
      {
        id: `${material.id}-${Date.now()}-${index}`,
        materialId: material.id,
        slot: index,
        angle: material.angle + ((index % 5) - 2) * 8
      }
    ]
    const nextMessage = nextPlaced.length >= FLOWER_CROWN_TARGET
      ? '花瓣已经铺满一整圈啦。现在点“制作成花环”，把这圈花瓣固定起来。'
      : `第 ${nextPlaced.length} 朵贴好啦，至少贴满 ${FLOWER_CROWN_TARGET} 朵，才算一整圈花环。`
    persist({ placed: nextPlaced, crafted: false, craftedPieces: [], message: nextMessage }, `flower_crown_${source}_material`)
  }

  function handleDrop(event) {
    event.preventDefault()
    const materialId = event.dataTransfer?.getData('text/plain') || draggingId
    if (materialId) addMaterial(materialId, 'drop')
    setDraggingId(null)
  }

  function craftCrown() {
    if (!readyToCraft || stateRef.current.crafted || stateRef.current.worn) return
    const craftedPieces = stateRef.current.placed.map((piece, index) => ({
      ...piece,
      craftSlot: index,
      slot: index
    }))
    return persist({
      crafted: true,
      craftedPieces,
      message: '花环制作好啦。这一圈就是刚刚亲手贴出来的样子，现在可以戴到小柚子头上。'
    }, 'flower_crown_crafted')
  }

  function renderCrownPiece(piece, index, mode = 'table') {
    const material = FLOWER_CROWN_MATERIALS.find(item => item.id === piece.materialId) || FLOWER_CROWN_MATERIALS[0]
    const slot = Number.isFinite(piece.slot) ? piece.slot : index
    const modeClass = mode === 'wear' ? `worn-piece wear-slot-${slot % FLOWER_CROWN_SLOT_COUNT}` : `slot-${slot % FLOWER_CROWN_SLOT_COUNT}`
    return <i key={`${mode}-${piece.id}-${index}`} className={`crown-piece ${material.kind} ${modeClass}`} style={{ '--piece-rot': `${piece.angle || material.angle || 0}deg` }} aria-hidden="true" />
  }

  function wearCrown() {
    if (!readyToWear || stateRef.current.worn) return
    const next = persist({
      completed: true,
      worn: true,
      message: '花环戴好啦。小柚子头上戴着的，就是刚刚亲手制作好的那一整圈花瓣。'
    }, 'flower_crown_completed')
    grantChildrenReward('flower_crown')
    window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '获得道具：花花小王冠' }))
    setFinalOpen(true)
    onTaskComplete(item.day)
    return next
  }

  return (
    <div className={`flower-crown-game ${state.worn ? 'is-worn' : ''}`}>
      <div className="flower-crown-copy">
        <span className="tiny-label">604 Flower Crown Workshop</span>
        <h4>给小柚子做一顶花花小王冠</h4>
        <p>先把花瓣、小花和叶子铺满透明胶带一整圈；铺满后点击“制作成花环”，系统会把你刚刚摆好的那一圈固定成真正的花环，然后再戴到小柚子头上。</p>
      </div>

      <div className="flower-crown-stage">
        <section className="flower-crown-table" aria-label="花环制作台">
          <div
            className={`flower-crown-ring ${readyToCraft ? 'ready' : ''} ${crownMade ? 'crafted' : ''}`}
            onDragOver={event => event.preventDefault()}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label="把花材拖到这里制作花环"
          >
            <span className="tape-ring" />
            {state.placed.map((piece, index) => renderCrownPiece(piece, index, 'table'))}
            <strong>{crownMade ? '花环已制作' : readyToCraft ? '可以制作啦' : `${placedCount}/${FLOWER_CROWN_TARGET}`}</strong>
            <small>{crownMade ? '保持你刚刚摆好的样子' : readyToCraft ? '下一步：制作成花环' : '把花材铺满一整圈'}</small>
          </div>
          <button type="button" className="flower-craft-button" onClick={craftCrown} disabled={!readyToCraft || state.crafted || state.worn}>
            {state.crafted ? '已制作成花环' : readyToCraft ? '制作成花环' : `还需要 ${Math.max(0, FLOWER_CROWN_TARGET - placedCount)} 朵花材`}
          </button>
          <div className="flower-memory-note">
            <b>去年的今天</b>
            <span>花瓣和透明胶布贴成一圈，临时变成了一枚很可爱的花花戒指。</span>
          </div>
        </section>

        <section className="flower-yuzu-display" aria-label="等待戴花环的小柚子">
          <div className="flower-yuzu-aura" />
          <div className="flower-yuzu-sprite-wrap">
            <div className={`flower-yuzu-crown-on-head ${state.worn ? 'show' : ''}`} aria-hidden="true">
              {crownPieces.map((piece, index) => renderCrownPiece(piece, index, 'wear'))}
            </div>
            <DogSprite type="pomelo" />
          </div>
          <p>{state.worn ? '戴好啦，好像春天在头上开花。' : '小柚子乖乖坐好，等一顶花花小王冠。'}</p>
          <button type="button" className="flower-wear-button" onClick={wearCrown} disabled={!readyToWear || state.worn}>
            {state.worn ? '花环已戴好' : crownMade ? '把这个花环戴到小柚子头上' : readyToCraft ? '先制作成花环' : '花环还需要更多花瓣'}
          </button>
        </section>
      </div>

      <div className="flower-material-tray" aria-label="花材托盘">
        {FLOWER_CROWN_MATERIALS.map(material => (
          <button
            type="button"
            key={material.id}
            className={`flower-material ${material.kind}`}
            draggable={!state.worn && !state.crafted}
            onDragStart={event => { setDraggingId(material.id); event.dataTransfer?.setData('text/plain', material.id) }}
            onDragEnd={() => setDraggingId(null)}
            onClick={() => addMaterial(material.id, 'click')}
            disabled={state.worn || state.crafted || state.placed.length >= FLOWER_CROWN_MAX}
          >
            <i aria-hidden="true" />
            <span>{material.label}</span>
          </button>
        ))}
      </div>
      <p className="flower-crown-message">{state.message}</p>
      {crownMade ? <p className="flower-made-summary">已使用：{crownPieces.length} 朵花材；佩戴时会保持这圈花材的颜色和顺序。</p> : null}
      {taskCompleted || state.worn ? <p className="flower-crown-reward">获得道具：花花小王冠</p> : null}

      {finalOpen && createPortal(
        <div className="flower-final-modal" role="dialog" aria-modal="true" aria-label="花花小王冠完成">
          <div className="flower-final-card">
            <div className="flower-final-yuzu">
              <div className="flower-yuzu-sprite-wrap">
                <div className="flower-yuzu-crown-on-head show" aria-hidden="true">
                  {crownPieces.map((piece, index) => renderCrownPiece(piece, index, 'wear'))}
                </div>
                <DogSprite type="pomelo" />
              </div>
            </div>
            <h4>获得道具：花花小王冠</h4>
            <p>去年是透明胶布和花瓣临时贴成一枚小戒指；今天把你亲手摆好的这一整圈花瓣，轻轻戴在小柚子头上。花环做好啦，可以签到。</p>
            <button type="button" onClick={() => setFinalOpen(false)}>收好花花小王冠</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function OrigamiCompanionQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  React.useEffect(() => {
    if (!taskCompleted) {
      onTaskComplete(item.day)
      logCloudEvent('origami_companion_ready_to_sign', { day: item.day, title: item.title }, item.day)
    }
  }, [item.day, item.title, taskCompleted, onTaskComplete])

  return (
    <div className="origami-companion-card">
      <div className="origami-photo-frame">
        <img src={item.image} alt="2025年6月5日黄色折纸小狗站在电脑键盘上的照片" />
        <span className="origami-photo-date">{item.memoryTitle}</span>
      </div>
      <div className="origami-companion-copy">
        <span className="tiny-label">Reality Craft · 605</span>
        <h4>今天的小伴读：折纸小狗</h4>
        <p>{item.memoryCaption}</p>
        <p>去年的这天，它陪小琳坐在键盘旁边；今年请小琳在现实中找到小琛，和他一起再折一只。</p>
        <div className="origami-direct-sign-note">
          <strong>🐶 现实中一起完成就好</strong>
          <span>网页里不用闯关，小伴读已经开好门啦，可以直接点下面的签到按钮。</span>
        </div>
      </div>
    </div>
  )
}

const FINAL_MATCHBOX_FLAG = 'wwcxrl-final-matchbox-note-unlocked'
const ANNIVERSARY_ANSWER_KEY = 'wwcxrl-day24-anniversary-answer-146-ok'
const FINAL_PLACEHOLDER_PHOTO = '/images/final-sign-placeholder.svg'

function isFinalMatchboxUnlocked() {
  return getRoleJson(FINAL_MATCHBOX_FLAG, false) === true
}

function setFinalMatchboxUnlocked(value = true) {
  setRoleJson(FINAL_MATCHBOX_FLAG, Boolean(value))
  window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
}

function buildAnniversaryRewindFrames(photos = {}) {
  const photoFrames = getPhotoWallRequiredSlots(24)
    .map(slot => ({ ...slot, photo: photos[slot.key] }))
    .filter(slot => slot.photo?.src)
    .map((slot, index) => ({
      id: `photo-${slot.key}`,
      type: 'photo',
      src: slot.photo.src,
      label: `${slot.owner.icon} ${slot.day.date.slice(5)}`,
      caption: slot.day.title,
      delay: `${(index % 18) * 0.18}s`
    }))
  const questFrames = dailyAdventures.slice(0, 23).map((day, index) => ({
    id: `quest-${day.day}`,
    type: 'quest',
    icon: day.icon,
    label: day.date.slice(5),
    caption: day.title,
    delay: `${((index + photoFrames.length) % 18) * 0.18}s`
  }))
  return [...photoFrames, ...questFrames].slice(0, 96)
}

function AnniversaryFinaleQuest({ item, signed = false, taskCompleted = false, onTaskComplete = () => {} }) {
  const [answer, setAnswer] = useState('')
  const [answerConfirmed, setAnswerConfirmed] = useState(taskCompleted)
  const [answerError, setAnswerError] = useState('')
  const [showMovie, setShowMovie] = useState(false)
  const [albumPromptOpen, setAlbumPromptOpen] = useState(false)
  const [albumMaking, setAlbumMaking] = useState(false)
  const [giftOpen, setGiftOpen] = useState(false)
  const [status, setStatus] = useState('今天只需要回答一个小问题。')
  const ready = isPhotoWallFinaleActuallyComplete(24) && getRoleJson('wwcxrl-signed-days', []).includes(23)
  const normalizedAnswer = answer.replace(/[\s·。！？!?,，、：“”"'‘’（）()]/g, '')
  const answerOk = normalizedAnswer === '146'
  const videoRef = React.useRef(null)

  React.useEffect(() => {
    if (taskCompleted) setAnswerConfirmed(true)
  }, [taskCompleted])

  React.useEffect(() => {
    if (signed) {
      setShowMovie(true)
      setStatus('签到完成，电影开始放映。')
      logCloudEvent('anniversary_movie_opened_after_sign', { flow: '146-answer-to-movie' }, item.day)
    }
  }, [signed, item.day])

  React.useEffect(() => {
    if (!showMovie) return
    const timer = window.setTimeout(() => {
      const video = videoRef.current
      if (!video) return
      video.play?.().catch(error => {
        console.warn('[wwcxrl anniversary] autoplay failed', error.message)
      })
    }, 260)
    return () => window.clearTimeout(timer)
  }, [showMovie])

  React.useEffect(() => {
    if (!albumMaking) return
    const timer = window.setTimeout(() => {
      setAlbumMaking(false)
      setGiftOpen(true)
      saveCloudDayProgress(item.day, {
        movieFinished: true,
        albumRequested: true,
        giftRevealed: true,
        finishedAt: new Date().toISOString()
      }).catch(error => console.warn('[wwcxrl cloud] anniversary gift save failed', error.message))
      logCloudEvent('anniversary_album_gift_revealed', { gift: 'self-pickup-photo' }, item.day)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [albumMaking, item.day])

  function confirmAnswer() {
    if (!ready) return
    if (!answerOk) {
      setAnswerConfirmed(false)
      setAnswerError('好像不是这个数字哦。再想想，从朋友到恋人一共走了多少步？')
      return
    }
    setAnswerConfirmed(true)
    setRoleJson(ANNIVERSARY_ANSWER_KEY, true)
    setAnswerError('')
    setStatus('答案正确，可以签到啦。')
    if (!taskCompleted) {
      onTaskComplete(item.day)
      markCloudTaskCompleted(item.day, item.date)
      logCloudEvent('anniversary_answer_146_correct', { answer: normalizedAnswer }, item.day)
    }
  }

  function handleMovieEnded() {
    setAlbumPromptOpen(true)
    logCloudEvent('anniversary_movie_finished_album_prompt', { prompt: 'make_album' }, item.day)
  }

  function startAlbumMaking() {
    setAlbumPromptOpen(false)
    setAlbumMaking(true)
    setStatus('相册制作中。')
    logCloudEvent('anniversary_album_make_yes_clicked', { choice: 'yes' }, item.day)
  }

  return (
    <div className="anniversary-finale-entry anniversary-answer-entry">
      <div className="anniversary-finale-card anniversary-answer-card">
        <span className="tiny-label">1013 · Final Check-in</span>
        <h4>{signed ? '1013 签到已完成' : '1013 纪念日签到'}</h4>
        <p>今天是最后一格签到。回答下面这个问题，答对以后就可以盖上 1013 的章。</p>
        <div className="anniversary-riddle-box">
          <label>
            <span>从朋友到恋人要走多少步？</span>
            <input
              value={answer}
              onChange={event => {
                setAnswer(event.target.value)
                setAnswerError('')
                if (!taskCompleted) setAnswerConfirmed(false)
              }}
              placeholder="输入答案"
              inputMode="numeric"
              disabled={signed}
              aria-label="从朋友到恋人要走多少步"
            />
          </label>
          {!signed && <button type="button" onClick={confirmAnswer} disabled={!ready}>{answerConfirmed ? '答案正确' : '确认答案'}</button>}
        </div>
        {answerError && <p className="answer-error-note">{answerError}</p>}
        <small>{signed ? '最后一格已经盖章完成。' : status}</small>
        {signed && <button type="button" onClick={() => setShowMovie(true)}>重新播放</button>}
      </div>
      {!ready && <p className="answer-error-note">1013 已锁定：请先完成 1012 的 48/48 照片墙并盖章签到。</p>}

      {showMovie && createPortal(
        <div className="anniversary-rewind-modal" role="dialog" aria-modal="true" aria-label="1013 电影放映">
          <div className="anniversary-rewind-stage anniversary-video-stage anniversary-final-movie-stage">
            <button type="button" className="rewind-close" onClick={() => setShowMovie(false)}>×</button>
            <div className="rewind-projector" aria-hidden="true"><span /> <i /> <b /></div>
            <div className="rewind-title anniversary-video-title anniversary-final-movie-title">
              <span>1013</span>
              <h3>正在播放</h3>
            </div>
            <div className="anniversary-video-frame">
              <video
                ref={videoRef}
                className="anniversary-memory-video"
                src={ANNIVERSARY_VIDEO_SRC}
                controls
                autoPlay
                playsInline
                preload="metadata"
                poster="/images/final-sign-placeholder.svg"
                onEnded={handleMovieEnded}
              >
                你的浏览器暂时不能播放这段纪念视频。
              </video>
            </div>

            {albumPromptOpen && (
              <div className="anniversary-album-prompt">
                <strong>是否将电影制作成相册</strong>
                <div>
                  <button type="button" onClick={startAlbumMaking}>是</button>
                  <button type="button" onClick={startAlbumMaking}>是</button>
                </div>
              </div>
            )}

            {albumMaking && (
              <div className="anniversary-album-making" role="status">
                <span>📖</span>
                <strong>相册制作中</strong>
                <small>请等 5 秒钟</small>
                <i />
              </div>
            )}

            {giftOpen && (
              <div className="anniversary-gift-reveal">
                <img src={ANNIVERSARY_GIFT_PHOTO_SRC} alt="1013 礼物照片" />
                <strong>礼物请自提!</strong>
                <button type="button" onClick={() => setShowMovie(false)}>收到啦</button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ===== 通用小游戏：迷宫（管理页 game 类型，gameId=mazeClassic） =====
const MAZE_GAME_PRESETS = {
  easy: {
    label: '轻松迷宫 · 9×9',
    hint: '路比较直，第一次玩也很快到出口',
    map: [
      '#########',
      '#S......#',
      '#.#####.#',
      '#.#...#.#',
      '#.#.#.#.#',
      '#.#.#.#.#',
      '#.#...#.#',
      '#..###..#',
      '#######D#'
    ]
  },
  medium: {
    label: '中等迷宫 · 13×13',
    hint: '稍微有点绕，走一走就能到',
    map: [
      '#############',
      '#S......#...#',
      '#######.###.#',
      '#.....#.....#',
      '#.###.#####.#',
      '#.#.#.......#',
      '#.#.#########',
      '#.#.........#',
      '#.#######.#.#',
      '#.........#.#',
      '###########.#',
      '#..........D#',
      '#############'
    ]
  },
  classic: {
    label: '经典迷宫 · 21×19',
    hint: '原版 524 迷宫的大小，全图可见',
    map: DAY4_MAZE_MAP
  }
}

function findMazeCell(map, target) {
  for (let y = 0; y < map.length; y++) {
    const x = map[y].indexOf(target)
    if (x >= 0) return { x, y }
  }
  return { x: 1, y: 1 }
}

function normalizeMazeGameState(raw = {}, startPos, doorPos) {
  const source = raw || {}
  const position = source.position && Number.isFinite(Number(source.position.x)) && Number.isFinite(Number(source.position.y))
    ? {
        x: Math.max(1, Math.min(doorPos.x, Number(source.position.x))),
        y: Math.max(1, Math.min(doorPos.y, Number(source.position.y)))
      }
    : startPos
  return {
    position,
    doorReached: Boolean(source.doorReached),
    opened: Boolean(source.opened)
  }
}

function MazeGame({ item, taskCompleted, onTaskComplete }) {
  const preset = MAZE_GAME_PRESETS[item.gameConfig?.preset] || MAZE_GAME_PRESETS.medium
  const map = preset.map
  const cols = map[0].length
  const rows = map.length
  const startPos = useMemo(() => findMazeCell(map, 'S'), [map])
  const doorPos = useMemo(() => findMazeCell(map, 'D'), [map])
  const stateKey = `wwcxrl-maze-${item.day}`
  const loadState = () => normalizeMazeGameState(getRoleJson(stateKey, null), startPos, doorPos)
  const [state, setState] = useState(loadState)
  const stateRef = React.useRef(state)
  const controlTapRef = React.useRef(0)
  const localDirtyRef = React.useRef(false)
  const [message, setMessage] = useState(taskCompleted ? '迷宫已经完成啦，今天的签到按钮可以点击了。' : '用方向键 / WASD / 下方按钮移动小琳，走到出口的星星门前。')

  function saveLocalState(next) {
    const normalized = normalizeMazeGameState(next, startPos, doorPos)
    setRoleJson(stateKey, normalized)
    stateRef.current = normalized
    setState(normalized)
    return normalized
  }

  function syncMaze(next) {
    localDirtyRef.current = true
    const normalized = saveLocalState(next)
    saveCloudDayProgress(item.day, { maze: normalized })
    return normalized
  }

  function resetGame() {
    const start = { position: startPos, doorReached: false, opened: false }
    localDirtyRef.current = true
    saveLocalState(start)
    saveCloudDayProgress(item.day, { maze: start })
    setMessage('迷宫已重置，重新出发吧。')
  }

  function moveTo(dx, dy) {
    const now = Date.now()
    if (now - controlTapRef.current < 130) return
    controlTapRef.current = now
    const current = stateRef.current
    if (current.opened) return
    const nextPosition = { x: current.position.x + dx, y: current.position.y + dy }
    const cell = map[nextPosition.y]?.[nextPosition.x]
    if (cell === undefined || cell === '#') {
      setMessage('撞到墙啦，换个方向试试。')
      return
    }
    const atDoor = nextPosition.x === doorPos.x && nextPosition.y === doorPos.y
    syncMaze({ ...current, position: nextPosition, doorReached: current.doorReached || atDoor })
    setMessage(atDoor ? '到出口啦，门缝里透出一点点光，点“开门”吧。' : '小琳往前走了一步，继续找出口吧。')
  }

  function openDoor() {
    const current = stateRef.current
    syncMaze({ ...current, doorReached: true, opened: true })
    setMessage('门打开了，迷宫任务完成，今天的签到按钮亮起来啦。')
    if (!taskCompleted) onTaskComplete(item.day)
  }

  React.useEffect(() => {
    let alive = true
    loadCloudDayProgress(item.day).then(remote => {
      if (!alive || !remote?.progress || localDirtyRef.current) return
      const remoteState = normalizeMazeGameState(remote.progress.maze, startPos, doorPos)
      const local = stateRef.current || loadState()
      const score = s => (s.opened ? 10000 : 0) + (s.doorReached ? 5000 : 0) + Math.abs(s.position.x - startPos.x) + Math.abs(s.position.y - startPos.y)
      if (score(remoteState) <= score(local)) return
      saveLocalState(remoteState)
      if (remoteState.opened && !taskCompleted) onTaskComplete(item.day)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.day, taskCompleted, onTaskComplete])

  React.useEffect(() => {
    const isTypingTarget = target => {
      const tag = target?.tagName?.toLowerCase?.()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable
    }
    const moveKeys = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }
    const handleKey = event => {
      const key = event.key
      const dir = moveKeys[key.length === 1 ? key.toLowerCase() : key]
      if (!dir || isTypingTarget(event.target)) return
      event.preventDefault()
      moveTo(dir[0], dir[1])
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    const handleReset = event => {
      if (Number(event.detail?.day) !== Number(item.day)) return
      resetGame()
    }
    window.addEventListener('wwcxrl-generic-day-reset', handleReset)
    return () => window.removeEventListener('wwcxrl-generic-day-reset', handleReset)
  }, [item.day])

  return (
    <div className={`mini-game maze-classic-game ${state.opened ? 'is-complete' : ''}`}>
      <div className="maze-classic-board" style={{ '--maze-cols': cols, '--maze-rows': rows }}>
        {map.flatMap((row, y) => row.split('').map((cell, x) => {
          const isHero = state.position.x === x && state.position.y === y
          const isDoor = x === doorPos.x && y === doorPos.y
          const isStart = x === startPos.x && y === startPos.y
          return (
            <span
              key={`${x}-${y}`}
              className={`maze-classic-cell ${cell === '#' ? 'wall' : 'path'} ${isDoor ? 'door' : ''} ${isStart ? 'start' : ''}`}
            >
              {isDoor && <i className="maze-classic-door">✦</i>}
              {isStart && !isHero && <i className="maze-classic-start">入口</i>}
              {isHero && <span className="maze-classic-hero"><DogSprite type="pomelo" /></span>}
            </span>
          )
        }))}
      </div>
      <p className="maze-classic-message">{message}</p>
      <div className="maze-classic-dpad" aria-label="移动小琳">
        <button type="button" onPointerDown={event => { event.preventDefault(); moveTo(0, -1) }} onClick={() => moveTo(0, -1)} aria-label="向上移动">↑</button>
        <button type="button" onPointerDown={event => { event.preventDefault(); moveTo(-1, 0) }} onClick={() => moveTo(-1, 0)} aria-label="向左移动">←</button>
        <button type="button" onPointerDown={event => { event.preventDefault(); moveTo(1, 0) }} onClick={() => moveTo(1, 0)} aria-label="向右移动">→</button>
        <button type="button" onPointerDown={event => { event.preventDefault(); moveTo(0, 1) }} onClick={() => moveTo(0, 1)} aria-label="向下移动">↓</button>
      </div>
      {state.doorReached && !state.opened && (
        <div className="maze-classic-door-panel">
          <strong>你已到达出口</strong>
          <p>门口透出一小圈暖光，轻轻推开门吧。</p>
          <button type="button" className="maze-classic-open" onClick={openDoor}>✨ 开门</button>
        </div>
      )}
      {state.opened && (
        <div className="maze-classic-done">
          <p>{item.secret || '迷宫完成啦！'}</p>
        </div>
      )}
      <button type="button" className="maze-classic-restart" onClick={resetGame}>↺ 重新开始</button>
      <small className="maze-classic-preset">{preset.label}</small>
    </div>
  )
}

// ===== 通用小游戏模板注册表（管理页 game 类型可选的参数） =====
const EMBEDDED_SECONDS_FIELD = {
  key: 'seconds',
  label: '需要玩满的秒数',
  type: 'select',
  options: [
    { value: '60', label: '60 秒' },
    { value: '90', label: '90 秒' },
    { value: '120', label: '120 秒' },
    { value: '150', label: '150 秒' },
    { value: '180', label: '180 秒' }
  ]
}

const EMBEDDED_GAME_SOURCES = {
  // aspect 为游戏画布的原生宽高比（宽/高）。带 aspect 的游戏在嵌入框与全屏时按此比例等比显示，
  // 避免被拉伸裁切；不带 aspect 的 DOM 游戏（如 yulegeyu）直接铺满。
  yulegeyu: { source: 'yulegeyu', title: '鱼了个鱼·羊了个羊' },
  lifeRestart: { source: 'life-restart', title: '人生重开模拟器', aspect: 3 / 4 },
  gobang: { source: 'gobang', title: '五子棋·人机对战', aspect: 3 / 2 },
  dressUp: { source: 'dress-up', title: '给小琳换装' },
  goldMiner: { source: 'gold-miner', title: '黄金矿工' },
  balloonParadise: { source: 'balloon-paradise', title: '气球天堂' },
  fruitPie: { source: 'fruit-pie', title: '水果馅饼' },
  brickBreak: { source: 'brick-break', title: '砌砖' },
  fruitSnake: { source: 'fruit-snake', title: '吃水果的蛇' },
  pandaRun: { source: 'panda-run', title: '圣诞熊猫跑步' },
  christmasBalloon: { source: 'christmas-balloon', title: '圣诞气球' },
  smileGame: { source: 'smile-game', title: '笑脸微笑' },
  bouncyBall: { source: 'bouncy-ball', title: '弹力球' }
}

const MINI_GAMES = [
  {
    id: 'mazeClassic',
    label: '迷宫',
    icon: '🗺️',
    hint: '她走迷宫到出口并点“开门”，即可完成签到',
    defaults: { preset: 'medium' },
    fields: [
      { key: 'preset', label: '迷宫地图', type: 'select', options: [
        { value: 'easy', label: '轻松迷宫 · 9×9' },
        { value: 'medium', label: '中等迷宫 · 13×13' },
        { value: 'classic', label: '经典迷宫 · 21×19' }
      ] }
    ]
  },
  {
    id: 'catchHearts',
    label: '接爱心',
    icon: '🧡',
    hint: '移动小篮子接住飘落的爱心，接满即可完成签到',
    defaults: { target: 10, speed: 'normal' },
    fields: [
      { key: 'target', label: '需要接住的数量', type: 'number', min: 3, max: 30 },
      { key: 'speed', label: '下落速度', type: 'select', options: [
        { value: 'slow', label: '慢' },
        { value: 'normal', label: '中' },
        { value: 'fast', label: '快' }
      ] }
    ]
  },
  {
    id: 'popBubbles',
    label: '戳泡泡',
    icon: '🫧',
    hint: '点破飘起来的泡泡，戳够数量即可完成签到',
    defaults: { target: 10 },
    fields: [
      { key: 'target', label: '需要戳破的数量', type: 'number', min: 3, max: 30 }
    ]
  },
  {
    id: 'memoryMatch',
    label: '翻牌记忆',
    icon: '🃏',
    hint: '翻开两张相同的小图案配对，全部配完即可完成签到',
    defaults: { pairs: 4 },
    fields: [
      { key: 'pairs', label: '卡片对数', type: 'select', options: [
        { value: '4', label: '4 对（8 张）' },
        { value: '6', label: '6 对（12 张）' },
        { value: '8', label: '8 对（16 张）' }
      ] }
    ]
  },
  {
    id: 'slidePuzzle',
    label: '滑块拼图',
    icon: '🧩',
    hint: '点击相邻滑块把它滑进空格，按顺序拼好即可完成签到',
    defaults: { size: 3 },
    fields: [
      { key: 'size', label: '拼图大小', type: 'select', options: [
        { value: '3', label: '3×3' },
        { value: '4', label: '4×4' }
      ] }
    ]
  },
  {
    id: 'matchThree',
    label: '爱心/水果三消',
    icon: '🍊',
    hint: '交换相邻图标，三个及以上连成一线即可消除，消够数量即可完成签到',
    defaults: { target: 12 },
    fields: [
      { key: 'target', label: '需要消除的图标数', type: 'number', min: 5, max: 30 }
    ]
  },
  {
    id: 'feedDog',
    label: '给狗狗喂食',
    icon: '🐶',
    hint: '在倒计时内移动狗狗接住落下的食物，接满即可完成签到',
    defaults: { target: 12, speed: 'normal', seconds: 30 },
    fields: [
      { key: 'target', label: '需要接住的数量', type: 'number', min: 5, max: 25 },
      { key: 'speed', label: '下落速度', type: 'select', options: [
        { value: 'slow', label: '慢' },
        { value: 'normal', label: '中' },
        { value: 'fast', label: '快' }
      ] },
      { key: 'seconds', label: '倒计时（秒）', type: 'select', options: [
        { value: '20', label: '20 秒' },
        { value: '30', label: '30 秒' },
        { value: '45', label: '45 秒' },
        { value: '60', label: '60 秒' }
      ] }
    ]
  },
  {
    id: 'whackAMole',
    label: '敲敲打地鼠',
    icon: '🔨',
    hint: '在倒计时内点中冒出的小动物，敲够数量即可完成签到',
    defaults: { target: 15, seconds: 45 },
    fields: [
      { key: 'target', label: '需要敲中的数量', type: 'number', min: 5, max: 30 },
      { key: 'seconds', label: '倒计时（秒）', type: 'select', options: [
        { value: '20', label: '20 秒' },
        { value: '30', label: '30 秒' },
        { value: '45', label: '45 秒' },
        { value: '60', label: '60 秒' }
      ] }
    ]
  },
  {
    id: 'yulegeyu',
    label: '鱼了个鱼·羊了个羊',
    icon: '🐟',
    hint: '点击牌堆把相同的小动物消掉，通关即可，玩满设定秒数也能签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'lifeRestart',
    label: '人生重开模拟器',
    icon: '🎲',
    hint: '分配天赋抽一次全新人生，读一读命运的小剧情，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'gobang',
    label: '五子棋·人机对战',
    icon: '⚫',
    hint: '和电脑下一盘五子棋，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'dressUp',
    label: '给小琳换装',
    icon: '👗',
    hint: '打开女孩换装小游戏，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'goldMiner',
    label: '黄金矿工',
    icon: '⛏️',
    hint: '放下抓钩抓宝贝攒金币，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'balloonParadise',
    label: '气球天堂',
    icon: '🎈',
    hint: '戳破飘起来的气球，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'fruitPie',
    label: '水果馅饼',
    icon: '🥧',
    hint: '收集水果做香喷喷的馅饼，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'brickBreak',
    label: '砌砖',
    icon: '🧱',
    hint: '弹球敲掉砖块，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'fruitSnake',
    label: '吃水果的蛇',
    icon: '🐍',
    hint: '小蛇吃水果越吃越长，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'pandaRun',
    label: '圣诞熊猫跑步',
    icon: '🐼',
    hint: '圣诞熊猫快乐奔跑，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'christmasBalloon',
    label: '圣诞气球',
    icon: '🎄',
    hint: '戳破圣诞气球收礼物，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'smileGame',
    label: '笑脸微笑',
    icon: '😊',
    hint: '把笑脸都点亮，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'bouncyBall',
    label: '弹力球',
    icon: '🏀',
    hint: '小球弹跳闯关，玩满设定秒数即可签到',
    defaults: { seconds: 150 },
    fields: [EMBEDDED_SECONDS_FIELD]
  },
  {
    id: 'sakuraPuzzle',
    label: '樱花拼图',
    icon: '🌸',
    hint: '把打乱的樱花图块滑回原位，拼好即可完成签到',
    defaults: { size: 3 },
    fields: [
      { key: 'size', label: '拼图大小', type: 'select', options: [
        { value: '3', label: '3×3' },
        { value: '4', label: '4×4' }
      ] }
    ]
  }
]

function getMiniGameDefaults(gameId) {
  const game = MINI_GAMES.find(entry => entry.id === gameId)
  return game ? { ...game.defaults } : {}
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback
}

function shuffleArray(array) {
  const next = [...array]
  for (let index = next.length - 1; index > 0; index--) {
    const pick = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[pick]] = [next[pick], next[index]]
  }
  return next
}

// ---- 小游戏 1：接爱心 ----
const CATCH_HEART_POOL = ['❤️', '🧡', '💛', '💖', '💘', '💝']

function CatchHeartsGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const target = clampNumber(config.target, 3, 30, 10)
  const fallSpeed = config.speed === 'fast' ? 3.1 : config.speed === 'slow' ? 1.5 : 2.2
  const stateKey = `wwcxrl-game-catch-${item.day}`
  const loadCaught = () => {
    const saved = getRoleJson(stateKey, 0)
    return Number.isFinite(Number(saved)) ? Math.max(0, Math.min(target, Number(saved))) : 0
  }
  const [caught, setCaught] = useState(loadCaught)
  const [hearts, setHearts] = useState([])
  const [bursts, setBursts] = useState([])
  const [missed, setMissed] = useState([])
  const [basketX, setBasketX] = useState(50)
  const areaRef = React.useRef(null)
  const basketRef = React.useRef(basketX)
  const caughtRef = React.useRef(caught)
  const heartsRef = React.useRef([])
  const burstsRef = React.useRef([])
  const missedRef = React.useRef([])
  const heartIdRef = React.useRef(0)
  const burstIdRef = React.useRef(0)
  const doneRef = React.useRef(taskCompleted || caught >= target)
  const [running, setRunning] = useState(!doneRef.current)

  React.useEffect(() => { basketRef.current = basketX }, [basketX])

  React.useEffect(() => {
    if (!running || doneRef.current) return
    const tick = window.setInterval(() => {
      const basket = basketRef.current
      const now = Date.now()
      const next = []
      let extra = 0
      for (const heart of heartsRef.current) {
        const y = heart.y + heart.vy
        if (y >= 86 && Math.abs(heart.x - basket) <= 13) {
          extra += 1
          burstsRef.current.push({
            id: burstIdRef.current++,
            x: heart.x,
            y: 86,
            born: now,
            dx: (Math.random() - 0.5) * 36,
            char: heart.char
          })
        } else if (y < 102) {
          next.push({ ...heart, y })
        } else {
          missedRef.current.push({ id: heart.id, x: heart.x, y: 100, missedAt: now, char: heart.char })
        }
      }
      if (extra > 0) {
        caughtRef.current += extra
        setCaught(caughtRef.current)
        setRoleJson(stateKey, caughtRef.current)
        if (caughtRef.current >= target && !doneRef.current) {
          doneRef.current = true
          setRunning(false)
          onTaskComplete(item.day)
        }
      }
      if (next.length < 5 && Math.random() < 0.3) {
        next.push({
          id: heartIdRef.current++,
          x: 8 + Math.random() * 84,
          y: -8,
          vy: fallSpeed * (0.75 + Math.random() * 0.5),
          size: 18 + Math.random() * 16,
          sway: 3 + Math.random() * 7,
          swaySpeed: 0.9 + Math.random() * 1.4,
          tilt: (Math.random() - 0.5) * 36,
          char: CATCH_HEART_POOL[Math.floor(Math.random() * CATCH_HEART_POOL.length)]
        })
      }
      heartsRef.current = next
      burstsRef.current = burstsRef.current.filter(burst => now - burst.born < 620)
      missedRef.current = missedRef.current.filter(heart => now - heart.missedAt < 700)
      setHearts(next)
      setBursts(burstsRef.current)
      setMissed(missedRef.current)
    }, 42)
    return () => window.clearInterval(tick)
  }, [running, item.day, onTaskComplete, target, fallSpeed, stateKey])

  function resetGame() {
    doneRef.current = false
    caughtRef.current = 0
    heartsRef.current = []
    burstsRef.current = []
    missedRef.current = []
    heartIdRef.current = 0
    setCaught(0)
    setHearts([])
    setBursts([])
    setMissed([])
    setRoleJson(stateKey, 0)
    setRunning(true)
  }

  function moveBasket(dx) {
    if (doneRef.current) return
    setBasketX(prev => Math.max(6, Math.min(94, prev + dx)))
  }

  const handlePointerMove = event => {
    if (doneRef.current) return
    const rect = areaRef.current?.getBoundingClientRect()
    if (!rect) return
    setBasketX(Math.max(6, Math.min(94, ((event.clientX - rect.left) / rect.width) * 100)))
  }

  const done = doneRef.current || (taskCompleted && !running)

  return (
    <div className="mini-game catch-game">
      <div
        className="catch-area"
        ref={areaRef}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerMove}
        style={{ touchAction: 'none' }}
      >
        {hearts.map(heart => (
          <span
            key={heart.id}
            className="catch-heart"
            style={{
              left: `${heart.x}%`,
              top: `${heart.y}%`,
              '--size': `${heart.size}px`,
              '--sway': `${heart.sway}px`,
              '--sway-speed': `${heart.swaySpeed}s`,
              '--tilt': `${heart.tilt}deg`
            }}
          >{heart.char}</span>
        ))}
        {missed.map(heart => (
          <span key={`missed-${heart.id}`} className="catch-heart is-missed" style={{ left: `${heart.x}%`, top: `${heart.y}%`, '--size': '26px', '--sway': '0px', '--tilt': '0deg' }}>{heart.char}</span>
        ))}
        {bursts.map(burst => (
          <span key={`burst-${burst.id}`} className="catch-heart-burst" style={{ left: `${burst.x}%`, top: `${burst.y}%`, '--dx': `${burst.dx}px` }}>{burst.char}</span>
        ))}
        <span className="catch-basket" style={{ left: `${basketX}%` }}>🧺</span>
      </div>
      <p className="catch-status">已接住 <strong>{Math.min(caught, target)}</strong> / {target}</p>
      <div className="catch-controls">
        <button type="button" onClick={() => moveBasket(-14)} aria-label="向左移动">◀</button>
        <button type="button" onClick={() => moveBasket(14)} aria-label="向右移动">▶</button>
      </div>
      {done && <div className="game-done-panel"><p>{item.secret || '全部接住啦！'}</p></div>}
      <button type="button" className="game-restart" onClick={resetGame}>↺ 重新开始</button>
    </div>
  )
}

// ---- 小游戏 2：戳泡泡 ----
function PopBubblesGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const target = clampNumber(config.target, 3, 30, 10)
  const stateKey = `wwcxrl-game-pop-${item.day}`
  const loadPopped = () => {
    const saved = getRoleJson(stateKey, 0)
    return Number.isFinite(Number(saved)) ? Math.max(0, Math.min(target, Number(saved))) : 0
  }
  const [popped, setPopped] = useState(loadPopped)
  const [bubbles, setBubbles] = useState([])
  const poppedRef = React.useRef(popped)
  const bubblesRef = React.useRef([])
  const bubbleIdRef = React.useRef(0)
  const doneRef = React.useRef(taskCompleted || popped >= target)
  const aliveRef = React.useRef(true)
  const [running, setRunning] = useState(!doneRef.current)

  React.useEffect(() => () => { aliveRef.current = false }, [])

  React.useEffect(() => {
    if (!running || doneRef.current) return
    const tick = window.setInterval(() => {
      const next = bubblesRef.current
        .map(bubble => ({ ...bubble, y: bubble.y - bubble.vy, wobble: bubble.wobble + 0.07 }))
        .filter(bubble => bubble.y > -16 && !bubble.popping)
      if (next.length < 7 && Math.random() < 0.32) {
        next.push({ id: bubbleIdRef.current++, x: 6 + Math.random() * 88, y: 106, vy: 0.55 + Math.random() * 0.75, size: 24 + Math.random() * 26, wobble: 0 })
      }
      bubblesRef.current = next
      setBubbles(next)
    }, 46)
    return () => window.clearInterval(tick)
  }, [running, item.day, target, stateKey])

  function popBubble(id) {
    if (doneRef.current) return
    const bubble = bubblesRef.current.find(entry => entry.id === id)
    if (!bubble || bubble.popping) return
    bubblesRef.current = bubblesRef.current.map(entry => entry.id === id ? { ...entry, popping: true } : entry)
    setBubbles(bubblesRef.current)
    poppedRef.current += 1
    setPopped(poppedRef.current)
    setRoleJson(stateKey, poppedRef.current)
    if (poppedRef.current >= target && !doneRef.current) {
      doneRef.current = true
      setRunning(false)
      onTaskComplete(item.day)
    }
    window.setTimeout(() => {
      if (!aliveRef.current) return
      bubblesRef.current = bubblesRef.current.filter(entry => entry.id !== id)
      setBubbles(bubblesRef.current)
    }, 340)
  }

  function resetGame() {
    doneRef.current = false
    poppedRef.current = 0
    bubblesRef.current = []
    bubbleIdRef.current = 0
    setPopped(0)
    setBubbles([])
    setRoleJson(stateKey, 0)
    setRunning(true)
  }

  const done = doneRef.current || (taskCompleted && !running)

  return (
    <div className="mini-game pop-game">
      <div className="pop-area">
        {bubbles.map(bubble => (
          <button
            key={bubble.id}
            type="button"
            className={`pop-bubble ${bubble.popping ? 'is-popping' : ''}`}
            style={{ left: `${bubble.x}%`, top: `${bubble.y}%`, width: bubble.size, height: bubble.size, '--wobble': bubble.wobble }}
            onClick={() => popBubble(bubble.id)}
            aria-label="戳泡泡"
          >
            <span>🫧</span>
          </button>
        ))}
      </div>
      <p className="pop-status">已戳破 <strong>{Math.min(popped, target)}</strong> / {target}</p>
      {done && <div className="game-done-panel"><p>{item.secret || '泡泡全破啦！'}</p></div>}
      <button type="button" className="game-restart" onClick={resetGame}>↺ 重新开始</button>
    </div>
  )
}

// ---- 小游戏 3：翻牌记忆 ----
const MEMORY_EMOJI_POOL = ['🍊', '🐶', '🌸', '🌙', '⭐', '🍀', '☁️', '🫧', '🍓', '🌷', '🦋', '🌈']

function MemoryMatchGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const pairs = config.pairs === 6 ? 6 : config.pairs === 8 ? 8 : 4
  const [round, setRound] = useState(0)
  const cards = useMemo(() => {
    const picked = shuffleArray(MEMORY_EMOJI_POOL.slice(0, pairs))
    const deck = [...picked, ...picked].map((emoji, index) => ({ id: index, emoji }))
    return shuffleArray(deck)
  }, [pairs, round])
  const [flipped, setFlipped] = useState([])
  const [matchedIds, setMatchedIds] = useState([])
  const lockRef = React.useRef(false)
  const aliveRef = React.useRef(true)

  React.useEffect(() => () => { aliveRef.current = false }, [])

  React.useEffect(() => {
    if (matchedIds.length === cards.length && cards.length > 0 && !taskCompleted) onTaskComplete(item.day)
  }, [matchedIds, cards, taskCompleted, item.day, onTaskComplete])

  function flipCard(card) {
    if (lockRef.current || taskCompleted || flipped.includes(card.id) || matchedIds.includes(card.id)) return
    const next = [...flipped, card.id]
    setFlipped(next)
    if (next.length < 2) return
    lockRef.current = true
    const first = cards.find(entry => entry.id === next[0])
    const second = cards.find(entry => entry.id === next[1])
    const matched = first.emoji === second.emoji
    window.setTimeout(() => {
      if (!aliveRef.current) return
      if (matched) setMatchedIds(prev => Array.from(new Set([...prev, first.id, second.id])))
      setFlipped([])
      lockRef.current = false
    }, matched ? 420 : 820)
  }

  function resetGame() {
    lockRef.current = false
    setFlipped([])
    setMatchedIds([])
    setRound(value => value + 1)
  }

  return (
    <div className="mini-game memory-game">
      <div className="memory-grid" style={{ '--memory-cols': 4 }}>
        {cards.map(card => {
          const isMatched = matchedIds.includes(card.id)
          const isUp = isMatched || flipped.includes(card.id)
          return (
            <button
              key={`${round}-${card.id}`}
              type="button"
              className={`memory-card-item ${isUp ? 'is-up' : ''} ${isMatched ? 'is-matched' : ''}`}
              onClick={() => flipCard(card)}
              disabled={taskCompleted}
              aria-label="翻开记忆卡片"
            >
              <span className="memory-card-back">🎀</span>
              <span className="memory-card-face">{card.emoji}</span>
            </button>
          )
        })}
      </div>
      <p className="memory-status">已配对 <strong>{matchedIds.length / 2}</strong> / {pairs}</p>
      {matchedIds.length === cards.length && cards.length > 0 && <div className="game-done-panel"><p>{item.secret || '全部配对成功啦！'}</p></div>}
      <button type="button" className="game-restart" onClick={resetGame}>↺ 重新洗牌</button>
    </div>
  )
}

// ---- 小游戏 4：滑块拼图 ----
function makeSlidableBoard(size) {
  const count = size * size
  const board = Array.from({ length: count }, (_, index) => (index + 1) % count)
  let empty = count - 1
  for (let step = 0; step < count * 130; step++) {
    const x = empty % size
    const y = Math.floor(empty / size)
    const moves = []
    if (x > 0) moves.push(empty - 1)
    if (x < size - 1) moves.push(empty + 1)
    if (y > 0) moves.push(empty - size)
    if (y < size - 1) moves.push(empty + size)
    const pick = moves[Math.floor(Math.random() * moves.length)]
    ;[board[empty], board[pick]] = [board[pick], board[empty]]
    empty = pick
  }
  return board
}

function SlidePuzzleGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const size = config.size === 4 ? 4 : 3
  const [board, setBoard] = useState(() => makeSlidableBoard(size))
  const [moves, setMoves] = useState(0)
  const solved = board.every((value, index) => value === (index + 1) % (size * size))

  React.useEffect(() => {
    if (solved && !taskCompleted) onTaskComplete(item.day)
  }, [solved, taskCompleted, item.day, onTaskComplete])

  function tapTile(index) {
    if (solved || taskCompleted) return
    const empty = board.indexOf(0)
    const x = index % size
    const y = Math.floor(index / size)
    const ex = empty % size
    const ey = Math.floor(empty / size)
    if (Math.abs(x - ex) + Math.abs(y - ey) !== 1) return
    const next = [...board]
    ;[next[index], next[empty]] = [next[empty], next[index]]
    setBoard(next)
    setMoves(value => value + 1)
  }

  function resetGame() {
    setBoard(makeSlidableBoard(size))
    setMoves(0)
  }

  return (
    <div className="mini-game slide-game">
      <div className="slide-board" style={{ '--slide-size': size }}>
        {board.map((value, index) => (
          <button
            key={index}
            type="button"
            className={`slide-tile ${value === 0 ? 'is-empty' : ''}`}
            onClick={() => tapTile(index)}
            disabled={value === 0 || solved || taskCompleted}
            aria-label={value === 0 ? '空格' : `第 ${value} 块`}
          >
            {value !== 0 ? value : ''}
          </button>
        ))}
      </div>
      <p className="slide-status">已走 <strong>{moves}</strong> 步{solved ? ' · 拼好啦！' : ''}</p>
      {solved && <div className="game-done-panel"><p>{item.secret || '拼图完成啦！'}</p></div>}
      <button type="button" className="game-restart" onClick={resetGame}>↺ 重新开始</button>
    </div>
  )
}

// ---- 小游戏 5：爱心/水果三消 ----
const MATCH3_POOL = ['🍊', '🍓', '🌸', '💛', '💖', '🍀', '🫐', '🍎']

function findMatch3Cells(board) {
  const rows = board.length
  const cols = board[0]?.length || 0
  const matched = new Set()
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const value = board[y][x]
      if (!value) continue
      let run = 1
      while (x + run < cols && board[y][x + run] === value) run += 1
      if (run >= 3) for (let i = 0; i < run; i++) matched.add(`${x + i}-${y}`)
      run = 1
      while (y + run < rows && board[y + run][x] === value) run += 1
      if (run >= 3) for (let i = 0; i < run; i++) matched.add(`${x}-${y + i}`)
    }
  }
  return [...matched].map(key => key.split('-').map(Number))
}

function makeMatch3Board(cols, rows) {
  let board
  do {
    board = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => MATCH3_POOL[Math.floor(Math.random() * MATCH3_POOL.length)])
    )
  } while (findMatch3Cells(board).length > 0)
  return board
}

function applyMatch3Gravity(board, matchedPositions) {
  const rows = board.length
  const cols = board[0].length
  const next = board.map(row => [...row])
  for (const [x, y] of matchedPositions) next[y][x] = null
  for (let x = 0; x < cols; x++) {
    const column = []
    for (let y = rows - 1; y >= 0; y--) {
      if (next[y][x] !== null) column.push(next[y][x])
    }
    for (let y = rows - 1; y >= 0; y--) {
      next[y][x] = column.length ? column.shift() : MATCH3_POOL[Math.floor(Math.random() * MATCH3_POOL.length)]
    }
  }
  return next
}

function MatchThreeGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const target = clampNumber(config.target, 5, 30, 12)
  const cols = 6
  const rows = 6
  const stateKey = `wwcxrl-game-match3-${item.day}`
  const loadMatches = () => {
    const saved = getRoleJson(stateKey, 0)
    return Number.isFinite(Number(saved)) ? Math.max(0, Math.min(target, Number(saved))) : 0
  }
  const [board, setBoard] = useState(() => makeMatch3Board(cols, rows))
  const [matches, setMatches] = useState(loadMatches)
  const [selected, setSelected] = useState(null)
  const [matchedCells, setMatchedCells] = useState([])
  const [deniedCells, setDeniedCells] = useState([])
  const [message, setMessage] = useState('')
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const boardRef = React.useRef(board)
  const matchedRef = React.useRef(loadMatches())
  const selectedRef = React.useRef(null)
  const cursorRef = React.useRef({ x: 0, y: 0 })
  const busyRef = React.useRef(false)
  const aliveRef = React.useRef(true)
  const timerRef = React.useRef(0)
  const doneRef = React.useRef(taskCompleted || loadMatches() >= target)

  React.useEffect(() => () => {
    aliveRef.current = false
    window.clearTimeout(timerRef.current)
  }, [])

  function syncBoard(next) {
    boardRef.current = next
    setBoard(next)
  }

  function resolveCascade(current, depth) {
    syncBoard(current)
    const matched = findMatch3Cells(current)
    if (!matched.length) {
      busyRef.current = false
      return
    }
    setMatchedCells(matched)
    matchedRef.current += matched.length
    setMatches(matchedRef.current)
    setRoleJson(stateKey, matchedRef.current)
    if (matchedRef.current >= target && !doneRef.current) {
      doneRef.current = true
      onTaskComplete(item.day)
    }
    timerRef.current = window.setTimeout(() => {
      if (!aliveRef.current) return
      setMatchedCells([])
      resolveCascade(applyMatch3Gravity(current, matched), depth + 1)
    }, depth > 5 ? 70 : 300)
  }

  function trySwap(from, to) {
    const current = boardRef.current
    const previous = current.map(row => [...row])
    const swapped = current.map(row => [...row])
    ;[swapped[from.y][from.x], swapped[to.y][to.x]] = [swapped[to.y][to.x], swapped[from.y][from.x]]
    busyRef.current = true
    selectedRef.current = null
    setSelected(null)
    if (!findMatch3Cells(swapped).length) {
      setDeniedCells([from, to])
      setMessage('这样消不掉，换一组相邻的试试～')
      syncBoard(swapped)
      timerRef.current = window.setTimeout(() => {
        if (!aliveRef.current) return
        syncBoard(previous)
        setDeniedCells([])
        setMessage('')
        busyRef.current = false
      }, 320)
      return
    }
    setMessage('')
    resolveCascade(swapped, 0)
  }

  function tapCell(x, y) {
    if (busyRef.current || doneRef.current || taskCompleted) return
    const current = selectedRef.current
    if (!current) {
      selectedRef.current = { x, y }
      setSelected({ x, y })
      return
    }
    if (current.x === x && current.y === y) {
      selectedRef.current = null
      setSelected(null)
      return
    }
    if (Math.abs(current.x - x) + Math.abs(current.y - y) !== 1) {
      setMessage('只能交换相邻的两颗哦，点旁边的一颗试试～')
      selectedRef.current = { x, y }
      setSelected({ x, y })
      return
    }
    setMessage('')
    trySwap(current, { x, y })
  }

  function resetGame() {
    busyRef.current = false
    selectedRef.current = null
    setSelected(null)
    setMatchedCells([])
    setDeniedCells([])
    setMessage('')
    matchedRef.current = 0
    setMatches(0)
    setRoleJson(stateKey, 0)
    doneRef.current = taskCompleted
    syncBoard(makeMatch3Board(cols, rows))
  }

  React.useEffect(() => {
    const isTypingTarget = target => {
      const tag = target?.tagName?.toLowerCase?.()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable
    }
    const handleKey = event => {
      if (busyRef.current || doneRef.current || taskCompleted) return
      if (isTypingTarget(event.target)) return
      const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
      const dir = dirs[event.key]
      if (dir) {
        event.preventDefault()
        const next = {
          x: Math.max(0, Math.min(cols - 1, cursorRef.current.x + dir[0])),
          y: Math.max(0, Math.min(rows - 1, cursorRef.current.y + dir[1]))
        }
        cursorRef.current = next
        setCursor(next)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const cur = cursorRef.current
        const sel = selectedRef.current
        if (!sel) {
          selectedRef.current = cur
          setSelected(cur)
          return
        }
        if (sel.x === cur.x && sel.y === cur.y) {
          selectedRef.current = null
          setSelected(null)
          return
        }
    if (Math.abs(sel.x - cur.x) + Math.abs(sel.y - cur.y) === 1) trySwap(sel, cur)
    else {
      setMessage('只能交换相邻的两颗哦，点旁边的一颗试试～')
      selectedRef.current = cur
      setSelected(cur)
    }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows, taskCompleted])

  const done = taskCompleted || matchedRef.current >= target

  return (
    <div className={`mini-game match3-game ${done ? 'is-complete' : ''}`}>
      <p className="match3-hint">先点一颗，再点它旁边的一颗交换；三颗及以上连成一线就会消除。</p>
      <div className="match3-board" style={{ '--match-cols': cols }}>
        {board.map((row, y) => row.map((value, x) => {
          const isSelected = selected && selected.x === x && selected.y === y
          const isMatched = matchedCells.some(([mx, my]) => mx === x && my === y)
          const isCursor = cursor.x === x && cursor.y === y
          const isDenied = deniedCells.some(([dx, dy]) => dx === x && dy === y)
          return (
            <button
              key={`${x}-${y}`}
              type="button"
              className={`match3-tile ${isSelected ? 'is-selected' : ''} ${isMatched ? 'is-matched' : ''} ${isCursor ? 'is-cursor' : ''} ${isDenied ? 'is-denied' : ''}`}
              onClick={() => tapCell(x, y)}
              aria-label={`第 ${y + 1} 行第 ${x + 1} 列 ${value}`}
            >{value}</button>
          )
        }))}
      </div>
      {message && <p className="match3-message" role="status">{message}</p>}
      <p className="match3-status">已消除 <strong>{Math.min(matches, target)}</strong> / {target} 颗</p>
      {done && <div className="game-done-panel"><p>{item.secret || '甜到心里啦，消除目标完成！'}</p></div>}
      <button type="button" className="game-restart" onClick={resetGame}>↺ 重新开局</button>
    </div>
  )
}

// ---- 小游戏 6：给狗狗喂食（接食物） ----
const FEED_FOOD_POOL = ['🍖', '🍰', '🍓', '🥕', '🍩', '🧀', '🍬', '🦴']

function FeedDogGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const target = clampNumber(config.target, 5, 25, 12)
  const fallSpeed = config.speed === 'fast' ? 3.1 : config.speed === 'slow' ? 1.5 : 2.2
  const seconds = clampNumber(config.seconds, 10, 120, 30)
  const stateKey = `wwcxrl-game-feed-${item.day}`
  const loadCaught = () => {
    const saved = getRoleJson(stateKey, 0)
    return Number.isFinite(Number(saved)) ? Math.max(0, Math.min(target, Number(saved))) : 0
  }
  const [caught, setCaught] = useState(loadCaught)
  const [foods, setFoods] = useState([])
  const [yums, setYums] = useState([])
  const [misses, setMisses] = useState([])
  const [dogX, setDogX] = useState(50)
  const [timeLeft, setTimeLeft] = useState(seconds)
  const [failed, setFailed] = useState(false)
  const areaRef = React.useRef(null)
  const dogRef = React.useRef(dogX)
  const deadlineRef = React.useRef(Date.now() + seconds * 1000)
  const timeLeftRef = React.useRef(seconds)
  const failedRef = React.useRef(false)
  const caughtRef = React.useRef(loadCaught())
  const foodsRef = React.useRef([])
  const yumsRef = React.useRef([])
  const missesRef = React.useRef([])
  const foodIdRef = React.useRef(0)
  const burstIdRef = React.useRef(0)
  const doneRef = React.useRef(taskCompleted || loadCaught() >= target)
  const [running, setRunning] = useState(!doneRef.current)

  React.useEffect(() => { dogRef.current = dogX }, [dogX])

  React.useEffect(() => {
    if (!running || doneRef.current) return
    const tick = window.setInterval(() => {
      const dog = dogRef.current
      const now = Date.now()
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - now) / 1000))
      if (remaining !== timeLeftRef.current) {
        timeLeftRef.current = remaining
        setTimeLeft(remaining)
      }
      if (remaining <= 0 && !doneRef.current) {
        failedRef.current = true
        setFailed(true)
        setRunning(false)
        return
      }
      const next = []
      let extra = 0
      for (const food of foodsRef.current) {
        const y = food.y + food.vy
        if (y >= 82 && Math.abs(food.x - dog) <= 12) {
          extra += 1
          yumsRef.current.push({ id: burstIdRef.current++, x: food.x, y: 82, born: now, dx: (Math.random() - 0.5) * 30, char: food.char })
        } else if (y < 98) {
          next.push({ ...food, y })
        } else {
          missesRef.current.push({ id: food.id, x: food.x, y: 96, missedAt: now, char: food.char })
        }
      }
      if (extra > 0) {
        caughtRef.current += extra
        setCaught(caughtRef.current)
        setRoleJson(stateKey, caughtRef.current)
        if (caughtRef.current >= target && !doneRef.current) {
          doneRef.current = true
          setRunning(false)
          onTaskComplete(item.day)
        }
      }
      if (next.length < 5 && Math.random() < 0.3) {
        next.push({
          id: foodIdRef.current++,
          x: 8 + Math.random() * 84,
          y: -8,
          vy: fallSpeed * (0.75 + Math.random() * 0.5),
          size: 19 + Math.random() * 15,
          sway: 3 + Math.random() * 7,
          swaySpeed: 0.9 + Math.random() * 1.4,
          tilt: (Math.random() - 0.5) * 34,
          char: FEED_FOOD_POOL[Math.floor(Math.random() * FEED_FOOD_POOL.length)]
        })
      }
      foodsRef.current = next
      yumsRef.current = yumsRef.current.filter(burst => now - burst.born < 620)
      missesRef.current = missesRef.current.filter(food => now - food.missedAt < 700)
      setFoods(next)
      setYums(yumsRef.current)
      setMisses(missesRef.current)
    }, 42)
    return () => window.clearInterval(tick)
  }, [running, item.day, onTaskComplete, target, fallSpeed, stateKey])

  function resetGame() {
    doneRef.current = false
    failedRef.current = false
    caughtRef.current = 0
    foodsRef.current = []
    yumsRef.current = []
    missesRef.current = []
    foodIdRef.current = 0
    setCaught(0)
    setFoods([])
    setYums([])
    setMisses([])
    setFailed(false)
    deadlineRef.current = Date.now() + seconds * 1000
    timeLeftRef.current = seconds
    setTimeLeft(seconds)
    setRoleJson(stateKey, 0)
    setRunning(true)
  }

  function moveDog(dx) {
    if (doneRef.current || failedRef.current) return
    setDogX(prev => Math.max(6, Math.min(94, prev + dx)))
  }

  const handlePointerMove = event => {
    if (doneRef.current || failedRef.current) return
    const rect = areaRef.current?.getBoundingClientRect()
    if (!rect) return
    setDogX(Math.max(6, Math.min(94, ((event.clientX - rect.left) / rect.width) * 100)))
  }

  React.useEffect(() => {
    const isTypingTarget = target => {
      const tag = target?.tagName?.toLowerCase?.()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable
    }
    const handleKey = event => {
      if (doneRef.current || failedRef.current || isTypingTarget(event.target)) return
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        event.preventDefault()
        moveDog(-12)
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        event.preventDefault()
        moveDog(12)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const done = doneRef.current || (taskCompleted && !running)

  return (
    <div className="mini-game feed-game">
      <p className="feed-hint">在 <strong>{seconds}</strong> 秒内接满 <strong>{target}</strong> 份食物就可以签到啦，快移动狗狗接住好吃的！</p>
      <div
        className="feed-area"
        ref={areaRef}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerMove}
        style={{ touchAction: 'none' }}
      >
        {foods.map(food => (
          <span
            key={food.id}
            className="feed-food"
            style={{
              left: `${food.x}%`,
              top: `${food.y}%`,
              '--size': `${food.size}px`,
              '--sway': `${food.sway}px`,
              '--sway-speed': `${food.swaySpeed}s`,
              '--tilt': `${food.tilt}deg`
            }}
          >{food.char}</span>
        ))}
        {misses.map(food => (
          <span key={`missed-${food.id}`} className="feed-food is-missed" style={{ left: `${food.x}%`, top: `${food.y}%`, '--size': '26px', '--sway': '0px', '--tilt': '0deg' }}>{food.char}</span>
        ))}
        {yums.map(burst => (
          <span key={`yum-${burst.id}`} className="feed-yum" style={{ left: `${burst.x}%`, top: `${burst.y}%`, '--dx': `${burst.dx}px` }}>{burst.char}</span>
        ))}
        <div className="feed-dog" style={{ left: `${dogX}%` }}>
          <DogSprite type="pomelo" className="feed-dog-sprite" />
          <span className="feed-dog-bowl">🍽️</span>
        </div>
      </div>
      <p className="feed-status">已接到 <strong>{Math.min(caught, target)}</strong> / {target} 份食物 · 剩余 <strong className={timeLeft <= 10 ? 'is-urgent' : ''}>{timeLeft}</strong> 秒</p>
      <div className="feed-controls">
        <button type="button" onClick={() => moveDog(-14)} aria-label="向左移动">◀</button>
        <button type="button" onClick={() => moveDog(14)} aria-label="向右移动">▶</button>
      </div>
      {done && <div className="game-done-panel"><p>{item.secret || '狗狗吃饱饱啦！'}</p></div>}
      {failed && (
        <div className="game-fail-panel">
          <p>时间到啦，还差 <strong>{target - Math.min(caught, target)}</strong> 份，再来一次吧！</p>
          <button type="button" className="game-restart" onClick={resetGame}>↺ 再来一次</button>
        </div>
      )}
      <button type="button" className="game-restart" onClick={resetGame}>↺ 重新开始</button>
    </div>
  )
}

// ---- 小游戏 7：敲敲打地鼠 ----
const WHACK_POOL = ['🐶', '🐱', '🐰', '🦊', '🍓', '🐹']

function WhackAMoleGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const target = clampNumber(config.target, 5, 30, 15)
  const seconds = clampNumber(config.seconds, 10, 120, 45)
  const stateKey = `wwcxrl-game-whack-${item.day}`
  const loadHits = () => {
    const saved = getRoleJson(stateKey, 0)
    return Number.isFinite(Number(saved)) ? Math.max(0, Math.min(target, Number(saved))) : 0
  }
  const [hits, setHits] = useState(loadHits)
  const [active, setActive] = useState([])
  const [bonked, setBonked] = useState([])
  const [timeLeft, setTimeLeft] = useState(seconds)
  const [failed, setFailed] = useState(false)
  const hitsRef = React.useRef(loadHits())
  const activeRef = React.useRef([])
  const bonkedRef = React.useRef([])
  const doneRef = React.useRef(taskCompleted || loadHits() >= target)
  const failedRef = React.useRef(false)
  const deadlineRef = React.useRef(Date.now() + seconds * 1000)
  const timeLeftRef = React.useRef(seconds)
  const aliveRef = React.useRef(true)
  const moleIdRef = React.useRef(0)
  const [running, setRunning] = useState(!doneRef.current)

  React.useEffect(() => () => { aliveRef.current = false }, [])

  React.useEffect(() => {
    if (!running || doneRef.current) return
    const tick = window.setInterval(() => {
      const now = Date.now()
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - now) / 1000))
      if (remaining !== timeLeftRef.current) {
        timeLeftRef.current = remaining
        setTimeLeft(remaining)
      }
      if (remaining <= 0 && !doneRef.current) {
        failedRef.current = true
        setFailed(true)
        setRunning(false)
        return
      }
      let next = activeRef.current.filter(mole => mole.expiresAt > now)
      const wanted = next.length < 2 ? 2 - next.length : 0
      for (let i = 0; i < wanted; i++) {
        if (Math.random() >= 0.88) continue
        const hole = Math.floor(Math.random() * 9)
        if (next.some(mole => mole.hole === hole)) continue
        next.push({
          id: moleIdRef.current++,
          hole,
          char: WHACK_POOL[Math.floor(Math.random() * WHACK_POOL.length)],
          expiresAt: now + 900 + Math.random() * 500
        })
      }
      activeRef.current = next
      bonkedRef.current = bonkedRef.current.filter(item => now - item.at < 380)
      setActive(next)
      setBonked(bonkedRef.current)
    }, 120)
    return () => window.clearInterval(tick)
  }, [running, target, seconds, stateKey])

  function bonk(id) {
    if (doneRef.current || failedRef.current) return
    const mole = activeRef.current.find(item => item.id === id)
    if (!mole) return
    activeRef.current = activeRef.current.filter(item => item.id !== id)
    bonkedRef.current.push({ id, hole: mole.hole, char: mole.char, at: Date.now() })
    hitsRef.current += 1
    setHits(hitsRef.current)
    setRoleJson(stateKey, hitsRef.current)
    setActive(activeRef.current)
    setBonked(bonkedRef.current)
    if (hitsRef.current >= target && !doneRef.current) {
      doneRef.current = true
      setRunning(false)
      onTaskComplete(item.day)
    }
  }

  function resetGame() {
    doneRef.current = false
    failedRef.current = false
    hitsRef.current = 0
    activeRef.current = []
    bonkedRef.current = []
    setHits(0)
    setActive([])
    setBonked([])
    setFailed(false)
    deadlineRef.current = Date.now() + seconds * 1000
    timeLeftRef.current = seconds
    setTimeLeft(seconds)
    setRoleJson(stateKey, 0)
    setRunning(true)
  }

  const done = doneRef.current || (taskCompleted && !running)

  return (
    <div className="mini-game whack-game">
      <p className="whack-hint">小动物会从洞里冒出来，在 <strong>{seconds}</strong> 秒内敲中 <strong>{target}</strong> 只就能签到！</p>
      <div className="whack-board">
        {Array.from({ length: 9 }, (_, hole) => {
          const mole = active.find(item => item.hole === hole)
          const bonkedItem = bonked.find(item => item.hole === hole)
          return (
            <button
              key={hole}
              type="button"
              className={`whack-hole ${mole ? 'has-mole' : ''}`}
              onClick={() => mole && bonk(mole.id)}
              disabled={!mole || done || failed}
              aria-label={mole ? `敲中 ${mole.char}` : '空洞口'}
            >
              <span className="whack-hole-mouth" aria-hidden="true" />
              {mole && <span className="whack-mole">{mole.char}</span>}
              {bonkedItem && <span className="whack-bonk">{bonkedItem.char}</span>}
            </button>
          )
        })}
      </div>
      <p className="whack-status">已敲中 <strong>{Math.min(hits, target)}</strong> / {target} 只 · 剩余 <strong className={timeLeft <= 10 ? 'is-urgent' : ''}>{timeLeft}</strong> 秒</p>
      {done && <div className="game-done-panel"><p>{item.secret || '手速超快，小动物都被敲中啦！'}</p></div>}
      {failed && (
        <div className="game-fail-panel">
          <p>时间到啦，还差 <strong>{target - Math.min(hits, target)}</strong> 只，再来一次吧！</p>
          <button type="button" className="game-restart" onClick={resetGame}>↺ 再来一次</button>
        </div>
      )}
      <button type="button" className="game-restart" onClick={resetGame}>↺ 重新开始</button>
    </div>
  )
}

// ---- 小游戏 8：外部嵌入小游戏（玩满秒数即可签到） ----
function EmbeddedGame({ item, taskCompleted, onTaskComplete, source = '', title = '', aspect = 0 }) {
  const seconds = clampNumber(item.gameConfig?.seconds, 10, 300, 150)
  const [elapsed, setElapsed] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [showEscHint, setShowEscHint] = useState(false)
  const [fitStyle, setFitStyle] = useState(null)
  const elapsedRef = React.useRef(0)
  const doneRef = React.useRef(taskCompleted)
  const aliveRef = React.useRef(true)
  const frameWrapRef = React.useRef(null)
  const frameRef = React.useRef(null)
  const escHintTimerRef = React.useRef(0)
  const lastFitRef = React.useRef('')

  React.useEffect(() => () => {
    aliveRef.current = false
    window.clearTimeout(escHintTimerRef.current)
  }, [])

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement)
      setFullscreen(active)
      if (!active) setShowEscHint(false)
      applyFullscreenFit()
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    window.addEventListener('resize', applyFullscreenFit)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      window.removeEventListener('resize', applyFullscreenFit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (!fullscreen || aspect) return
    const timer = window.setInterval(applyFullscreenFit, 900)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, aspect])

  React.useEffect(() => {
    // 文档级 Esc 兜底：保证在任何浏览器（含无头/移动端浏览器）按 Esc 都能退出全屏。
    const handleKey = event => {
      if (event.key !== 'Escape') return
      if (!(document.fullscreenElement || document.webkitFullscreenElement)) return
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {})
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  React.useEffect(() => {
    if (taskCompleted) return
    const tick = window.setInterval(() => {
      elapsedRef.current += 1
      setElapsed(elapsedRef.current)
      if (elapsedRef.current >= seconds && !doneRef.current) {
        doneRef.current = true
        onTaskComplete(item.day)
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [seconds, item.day, onTaskComplete, taskCompleted])

  const ready = elapsed >= seconds || taskCompleted
  const fullscreenSupported = typeof document !== 'undefined'
    && Boolean(document.documentElement?.requestFullscreen || document.documentElement?.webkitRequestFullscreen)

  function toggleFullscreen() {
    const wrap = frameWrapRef.current
    if (!wrap) return
    const active = document.fullscreenElement || document.webkitFullscreenElement
    if (active) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {})
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
      return
    }
    const request = wrap.requestFullscreen || wrap.webkitRequestFullscreen
    if (!request) return
    const result = request.call(wrap)
    if (result?.then) {
      result.then(() => {
        applyFullscreenFit()
        setShowEscHint(true)
        window.clearTimeout(escHintTimerRef.current)
        escHintTimerRef.current = window.setTimeout(() => setShowEscHint(false), 3000)
      }).catch(() => {})
    } else {
      applyFullscreenFit()
      setShowEscHint(true)
      window.clearTimeout(escHintTimerRef.current)
      escHintTimerRef.current = window.setTimeout(() => setShowEscHint(false), 3000)
    }
  }

  function applyFullscreenFit() {
    if (aspect) return
    const frame = frameRef.current
    const fullscreenOn = Boolean(document.fullscreenElement || document.webkitFullscreenElement)
    if (!frame || !fullscreenOn) {
      if (lastFitRef.current) {
        lastFitRef.current = ''
        setFitStyle(null)
      }
      return
    }
    const screenW = Math.max(1, window.innerWidth)
    const screenH = Math.max(1, window.innerHeight)
    let cw = 0
    let ch = 0
    let rx = 0
    let ry = 0
    try {
      const doc = frame.contentDocument
      const canvas = doc?.querySelector('canvas')
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        cw = rect.width || canvas.clientWidth || canvas.width || 0
        ch = rect.height || canvas.clientHeight || canvas.height || 0
        rx = rect.x || 0
        ry = rect.y || 0
      }
    } catch {}
    if (cw <= 0 || ch <= 0) {
      if (lastFitRef.current) {
        lastFitRef.current = ''
        setFitStyle(null)
      }
      return
    }
    // 画布比例与屏幕接近时铺满（cover，无黑边）；差异大时完整显示（contain，居中留柔和渐变背景）。
    const gameAspect = cw / ch
    const screenAspect = screenW / screenH
    const aspectDiff = Math.abs(gameAspect - screenAspect) / Math.max(gameAspect, screenAspect)
    const scale = aspectDiff < 0.25
      ? Math.max(screenW / cw, screenH / ch)
      : Math.min(screenW / cw, screenH / ch)
    const next = {
      position: 'absolute',
      left: screenW / 2 - (rx + cw / 2) * scale,
      top: screenH / 2 - (ry + ch / 2) * scale,
      width: cw * scale,
      height: ch * scale,
      transform: `scale(${scale})`,
      transformOrigin: '0 0'
    }
    const key = JSON.stringify(next)
    if (key !== lastFitRef.current) {
      lastFitRef.current = key
      setFitStyle(next)
    }
  }

  return (
    <div className="mini-game embedded-game">
      <div className="embedded-bar">
        <strong>{title}</strong>
        <span className={ready ? 'is-ready' : ''}>{ready ? '✓ 已玩够时间，可以签到啦' : `已玩 ${Math.min(elapsed, seconds)} / ${seconds} 秒`}</span>
        {fullscreenSupported && (
          <button type="button" className="embedded-fullscreen-button" onClick={toggleFullscreen} aria-label={fullscreen ? '退出全屏' : '进入全屏'}>
            {fullscreen ? '↩ 退出全屏' : '⛶ 全屏'}
          </button>
        )}
      </div>
      <div className="embedded-frame-wrap" ref={frameWrapRef} data-aspect={aspect || undefined} style={aspect ? { '--game-aspect': aspect } : undefined}>
        <iframe
          ref={frameRef}
          src={`/games/${source}/index.html`}
          title={title}
          className="embedded-frame"
          loading="lazy"
          allowFullScreen
          allow="autoplay; fullscreen"
          onLoad={applyFullscreenFit}
          style={fitStyle || undefined}
        />
        {fullscreen && (
          <button type="button" className="embedded-exit-fullscreen" onClick={toggleFullscreen} aria-label="退出全屏">✕ 退出全屏</button>
        )}
        {showEscHint && <div className="embedded-esc-hint" role="status">按 Esc 可退出全屏</div>}
      </div>
      <p className="embedded-note">在下方画面里玩，玩满 {seconds} 秒就会自动点亮签到按钮；点「⛶ 全屏」放大玩，按 Esc 退出全屏。</p>
    </div>
  )
}

// ---- 小游戏 9：樱花拼图（滑动拼图） ----
function buildSakuraArt() {
  const blossoms = []
  const branches = [
    { x: 90, y: 430, angle: 0 },
    { x: 200, y: 470, angle: 22 },
    { x: 300, y: 445, angle: -16 },
    { x: 415, y: 468, angle: 34 }
  ]
  branches.forEach((branch, index) => {
    for (let i = 0; i < 5; i++) {
      const px = branch.x + Math.cos((branch.angle * Math.PI) / 180) * (i * 24)
      const py = branch.y - 26 - Math.abs(Math.sin((branch.angle * Math.PI) / 180)) * (i * 12) - (i % 2) * 18
      blossoms.push(
        `<g transform="translate(${px},${py}) scale(${0.7 + (i % 3) * 0.18})">
          <ellipse cx="-7" cy="-2" rx="6" ry="9" fill="#ffc2d9" opacity=".9"/>
          <ellipse cx="7" cy="-2" rx="6" ry="9" fill="#ffb0cf" opacity=".9"/>
          <ellipse cx="0" cy="-10" rx="6" ry="8" fill="#ffd0e2" opacity=".9"/>
          <ellipse cx="0" cy="6" rx="6" ry="8" fill="#ffb9d4" opacity=".9"/>
          <circle cx="0" cy="0" r="3" fill="#fff1a8"/>
        </g>`
      )
    }
  })
  const petals = Array.from({ length: 8 }, (_, i) =>
    `<g transform="translate(${40 + i * 68},${110 + (i % 3) * 52}) rotate(${i * 41})" opacity="${0.55 + (i % 3) * 0.15}">
      <ellipse cx="0" cy="0" rx="5" ry="9" fill="#ffb9d4"/>
    </g>`
  ).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <defs>
      <linearGradient id="sakura-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe9f3"/>
        <stop offset=".55" stop-color="#f4dcff"/>
        <stop offset="1" stop-color="#dff0ff"/>
      </linearGradient>
    </defs>
    <rect width="600" height="600" fill="url(#sakura-sky)"/>
    <circle cx="516" cy="92" r="56" fill="#fff3b8" opacity=".95"/>
    <circle cx="516" cy="92" r="76" fill="#fff3b8" opacity=".3"/>
    <ellipse cx="140" cy="112" rx="92" ry="26" fill="#ffffff" opacity=".65"/>
    <ellipse cx="228" cy="96" rx="64" ry="20" fill="#ffffff" opacity=".5"/>
    <path d="M0 468 Q 120 398 240 452 T 520 428 L 600 600 L 0 600 Z" fill="#cfe8b8" opacity=".9"/>
    <path d="M-12 468 Q 110 420 200 462 M 120 452 Q 230 415 320 450 M 320 450 Q 420 428 520 452" stroke="#8a5a3a" stroke-width="9" fill="none" stroke-linecap="round"/>
    ${blossoms.join('')}
    ${petals}
    <text x="300" y="556" text-anchor="middle" font-size="27" font-family="serif" fill="#d66a92">桜 · 我们的樱花拼图</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const SAKURA_ART = buildSakuraArt()

function SakuraPuzzleGame({ item, taskCompleted, onTaskComplete }) {
  const config = item.gameConfig || {}
  const size = config.size === 4 ? 4 : 3
  const [board, setBoard] = useState(() => makeSlidableBoard(size))
  const [moves, setMoves] = useState(0)
  const [preview, setPreview] = useState(false)
  const solved = board.every((value, index) => value === (index + 1) % (size * size))
  const previewTimerRef = React.useRef(0)

  React.useEffect(() => () => window.clearTimeout(previewTimerRef.current), [])

  React.useEffect(() => {
    if (solved && !taskCompleted) onTaskComplete(item.day)
  }, [solved, taskCompleted, item.day, onTaskComplete])

  function tapTile(index) {
    if (solved || taskCompleted) return
    const empty = board.indexOf(0)
    const x = index % size
    const y = Math.floor(index / size)
    const ex = empty % size
    const ey = Math.floor(empty / size)
    if (Math.abs(x - ex) + Math.abs(y - ey) !== 1) return
    const next = [...board]
    ;[next[index], next[empty]] = [next[empty], next[index]]
    setBoard(next)
    setMoves(value => value + 1)
  }

  function resetGame() {
    setBoard(makeSlidableBoard(size))
    setMoves(0)
  }

  function showPreview() {
    setPreview(true)
    window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = window.setTimeout(() => setPreview(false), 1800)
  }

  return (
    <div className="mini-game sakura-game">
      <div className="sakura-board" style={{ '--sakura-size': size }}>
        {board.map((value, index) => {
          const empty = value === 0
          const x = value % size
          const y = Math.floor(value / size)
          return (
            <button
              key={index}
              type="button"
              className={`sakura-tile ${empty ? 'is-empty' : ''}`}
              onClick={() => tapTile(index)}
              disabled={empty || solved || taskCompleted}
              aria-label={empty ? '空格' : `第 ${value} 块`}
              style={empty ? undefined : {
                backgroundImage: `url("${SAKURA_ART}")`,
                backgroundSize: `${size * 100}% ${size * 100}%`,
                backgroundPosition: `${(x / (size - 1)) * 100}% ${(y / (size - 1)) * 100}%`
              }}
            >
              {!empty && <span className="sakura-tile-num">{value}</span>}
            </button>
          )
        })}
      </div>
      <p className="sakura-status">已走 <strong>{moves}</strong> 步{solved ? ' · 拼好啦！' : ''}</p>
      {solved && <div className="game-done-panel"><p>{item.secret || '樱花图拼好啦，春天也住进小星球啦！'}</p></div>}
      <div className="sakura-actions">
        <button type="button" className="game-restart" onClick={resetGame}>↺ 重新打乱</button>
        <button type="button" className="sakura-preview-button" onClick={showPreview}>👀 看一眼原图</button>
      </div>
      {preview && (
        <div className="sakura-preview" role="button" tabIndex={0} aria-label="关闭樱花原图预览" onClick={() => setPreview(false)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setPreview(false) }}>
          <img src={SAKURA_ART} alt="樱花原图" />
        </div>
      )}
    </div>
  )
}

// ---- 一封信：拆开信封再读 ----
function LetterQuest({ item, taskCompleted, onTaskComplete }) {
  const [stage, setStage] = useState(taskCompleted ? 'opened' : 'closed')
  const opening = stage === 'opening'
  const opened = stage === 'opened'
  const done = taskCompleted || opened
  const openTimerRef = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(openTimerRef.current), [])

  function startOpen() {
    if (done || opening) return
    setStage('opening')
    openTimerRef.current = window.setTimeout(() => setStage('opened'), 720)
  }

  return (
    <div className={`mini-game letter-quest ${opening ? 'is-opening' : ''} ${done ? 'is-open' : ''}`}>
      <div
        className="letter-envelope"
        role="button"
        tabIndex={0}
        aria-label={done ? '信已经拆开' : '拆开信封'}
        onClick={startOpen}
        onKeyDown={event => {
          if (!done && !opening && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            startOpen()
          }
        }}
      >
        <span className="letter-envelope-flap" aria-hidden="true" />
        <span className="letter-envelope-pocket" aria-hidden="true" />
        <span className="letter-envelope-seal" aria-hidden="true">{item.icon || '✉️'}</span>
        <div className="letter-envelope-copy">
          <strong>一封写给你的信</strong>
          <p>{opening ? '封蜡裂开，信纸正在浮起来……' : '点一下，拆开信封'}</p>
        </div>
      </div>
      <article className="letter-paper" aria-hidden={!done}>
        {item.image && <img className="letter-paper-image" src={item.image} alt="信纸配图" />}
        <div className="letter-paper-greeting">{item.theme || '给我的小琳'}</div>
        <p className="letter-paper-body">{item.secret}</p>
        <div className="letter-paper-meta">
          <span>{item.date}</span>
          <span className="letter-paper-sign">— 爱你的小琛</span>
        </div>
        {!taskCompleted && (
          <button type="button" className="letter-done-button" onClick={() => onTaskComplete(item.day)}>我读完啦，可以签到</button>
        )}
      </article>
    </div>
  )
}

// ---- 砸金蛋：点金蛋敲出今日奖励 ----
const DEFAULT_FORTUNE_POOL = ['🧋 一杯奶茶', '☕ 一杯咖啡', '🍜 点一个好吃的外卖', '🎁 神秘大奖', '🍰 一块小蛋糕']
const FORTUNE_PICKS_KEY = 'wwcxrl-fortune-picks-v1'

function readFortunePick(day) {
  try {
    const saved = JSON.parse(localStorage.getItem(FORTUNE_PICKS_KEY) || '{}')
    return String(saved[String(day)] || '').trim()
  } catch {
    return ''
  }
}

function writeFortunePick(day, prize) {
  try {
    const saved = JSON.parse(localStorage.getItem(FORTUNE_PICKS_KEY) || '{}')
    saved[String(day)] = String(prize || '').trim()
    localStorage.setItem(FORTUNE_PICKS_KEY, JSON.stringify(saved))
  } catch {
    // ignore
  }
}

function FortuneQuest({ item, taskCompleted, onTaskComplete }) {
  const isVoyageBottle = item.day === 5
  const pool = useMemo(() => {
    if (isVoyageBottle) return []
    const raw = String(item.secret || '').trim()
    if (!raw) return DEFAULT_FORTUNE_POOL
    return raw.split(/\n+/).map(line => line.trim()).filter(Boolean)
  }, [item.secret, isVoyageBottle])
  const [rolling, setRolling] = useState(false)
  const [picked, setPicked] = useState(taskCompleted)
  const [spinText, setSpinText] = useState('')
  const [pickText, setPickText] = useState(() => readFortunePick(item.day))
  const timerRef = React.useRef(0)
  const spinTimerRef = React.useRef(0)

  React.useEffect(() => () => { window.clearTimeout(timerRef.current); window.clearInterval(spinTimerRef.current) }, [])

  React.useEffect(() => {
    let alive = true
    loadCloudDayProgress(item.day).then(remote => {
      if (!alive || !remote?.progress?.fortunePick) return
      const prize = String(remote.progress.fortunePick).trim()
      if (prize) {
        writeFortunePick(item.day, prize)
        setPickText(prize)
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [item.day])

  function revealFortune() {
    if (rolling || picked) return
    setRolling(true)
    if (!isVoyageBottle && pool.length > 1) {
      let index = 0
      setSpinText(pool[0])
      spinTimerRef.current = window.setInterval(() => {
        index = (index + 1) % pool.length
        setSpinText(pool[index])
      }, 100)
    } else if (!isVoyageBottle && pool.length === 1) {
      setSpinText(pool[0])
    }
    timerRef.current = window.setTimeout(() => {
      window.clearInterval(spinTimerRef.current)
      const prize = isVoyageBottle ? '' : pool[Math.floor(Math.random() * pool.length)]
      setSpinText('')
      setPickText(prize)
      writeFortunePick(item.day, prize)
      saveCloudDayProgress(item.day, { fortunePick: prize })
      setRolling(false)
      setPicked(true)
      onTaskComplete(item.day)
      if (!isVoyageBottle) markCloudTaskCompleted(item.day, item.date)
      logCloudEvent(isVoyageBottle ? 'day5_star_bottle_opened' : 'daily_fortune_picked', { day: item.day, title: item.title, prize }, item.day)
    }, isVoyageBottle ? 1100 : 1500)
  }

  return (
    <div className={`mini-game fortune-game ${isVoyageBottle ? 'day5-voyage-bottle' : ''} ${picked ? 'is-picked' : ''} ${rolling ? 'is-rolling' : ''}`}>
      {isVoyageBottle && <div className="voyage-bottle-sky" aria-hidden="true"><span /> <span /> <span /></div>}
      {isVoyageBottle ? (
        <button className="big-toy" onClick={revealFortune} disabled={rolling} aria-label="摇一摇 524 星际心情瓶">🫧</button>
      ) : (
        <button
          type="button"
          className={`golden-egg-btn ${rolling ? 'is-cracking' : ''} ${picked ? 'is-smashed' : ''}`}
          onClick={revealFortune}
          disabled={rolling}
          aria-label="砸开金蛋"
        >
          <img className="golden-egg-img" src="/images/capsule-golden-egg.png" alt="小金蛋" />
          <svg className="egg-crack" viewBox="0 0 256 221" aria-hidden="true" focusable="false">
            <path d="M64 18 L92 52 L74 86 L112 112 L96 150 L126 178 L118 204" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M150 26 L168 58 L150 92 L186 124 L168 158 L196 184" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="egg-hammer" aria-hidden="true">🔨</span>
          <span className="egg-shards" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="egg-flash" aria-hidden="true">✨</span>
        </button>
      )}
      {!isVoyageBottle && (
        <div className="fortune-stick" aria-live="polite">
          <span className={`fortune-stick-label ${rolling ? 'is-spinning' : ''} ${picked ? 'is-settled' : ''}`}>
            {rolling ? (spinText || '……') : picked ? pickText : '金蛋里藏着什么？'}
          </span>
          {picked && (
            <span className="fortune-burst" aria-hidden="true"><span>✨</span><span>💗</span><span>⭐</span></span>
          )}
        </div>
      )}
      <p>{rolling ? '金蛋轻轻晃了晃，裂纹慢慢爬上来……' : picked ? (isVoyageBottle ? item.secret : (pickText ? `今天的小确幸：${pickText}` : item.secret || '今天也要开开心心。')) : isVoyageBottle ? '木门后的第一只心情瓶正在慢慢漂过来，轻轻点一下。' : '点一下金蛋，敲出今日的小惊喜。'}</p>
      {isVoyageBottle && <small>{picked ? '瓶口冒出一圈小星星：524 的航线已经亮起一点点。' : '它里面装着一点点薄荷色银河、一颗小橙子星和小柚子的气泡。'}</small>}
    </div>
  )
}

// ---- 贴纸 / 心愿：小琳写下心愿，双方可见 ----
const WISH_LOCAL_KEY = 'wwcxrl-wish-local-v1'

function readLocalWish(day) {
  try {
    const saved = JSON.parse(localStorage.getItem(WISH_LOCAL_KEY) || '{}')
    return String(saved[String(day)] || '').trim()
  } catch (error) {
    return ''
  }
}

function writeLocalWish(day, text) {
  try {
    const saved = JSON.parse(localStorage.getItem(WISH_LOCAL_KEY) || '{}')
    saved[String(day)] = String(text || '').trim()
    localStorage.setItem(WISH_LOCAL_KEY, JSON.stringify(saved))
  } catch (error) {
    // ignore
  }
}

function StickerQuest({ item, taskCompleted, onTaskComplete }) {
  const day = item.day
  const [cloudWish, setCloudWish] = useState(null)
  const [cloudLoaded, setCloudLoaded] = useState(false)
  const [wishText, setWishText] = useState('')
  const [peeled, setPeeled] = useState(taskCompleted)
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState('')

  React.useEffect(() => {
    let alive = true
    loadCloudWish(day).then(result => {
      if (!alive) return
      setCloudWish(result)
      setCloudLoaded(true)
    })
    return () => { alive = false }
  }, [day])

  if (!cloudLoaded) {
    return (
      <div className="mini-game sticker-quest">
        <div className="sticker-board">
          <span className="wish-write-icon" aria-hidden="true">🪄</span>
          <p className="wish-write-title">正在翻开心愿簿……</p>
        </div>
      </div>
    )
  }

  const wish = cloudWish?.wishText || readLocalWish(day)
  const hasWish = Boolean(wish.trim())

  async function saveWish() {
    const text = wishText.trim()
    if (!text || saving) return
    setSaving(true)
    setSaveNote('')
    const saved = await saveCloudWish(day, text)
    setSaving(false)
    if (saved) {
      setCloudWish(saved)
    } else {
      writeLocalWish(day, text)
      setCloudWish({ day, wishText: text })
      setSaveNote(cloudEnabled ? '心愿已经收好啦，网络有点不稳，我会再试着帮你同步。' : '心愿已经记在小本本上啦。')
    }
    setWishText('')
    setPeeled(true)
    onTaskComplete(day)
  }

  function peelSticker() {
    if (peeled) return
    setPeeled(true)
    onTaskComplete(day)
    logCloudEvent('daily_sticker_peeled', { day, title: item.title }, day)
  }

  return (
    <div className={`mini-game sticker-quest ${peeled ? 'is-peeled' : ''}`}>
      {hasWish ? (
        <div className="sticker-board">
          <button type="button" className="sticker-peel" onClick={peelSticker} disabled={peeled} aria-label="揭下心愿贴纸">
            <span className="sticker-peel-front">{item.icon || '🏷️'}</span>
            <span className="sticker-peel-hint">{peeled ? '已揭开' : '揭下我'}</span>
          </button>
          {peeled && (
            <p className="sticker-reveal wish-reveal">
              <strong>小琳的 Day {day} 心愿</strong>
              {wish}
            </p>
          )}
        </div>
      ) : (
        <div className="sticker-board wish-write-board">
          <span className="wish-write-icon" aria-hidden="true">💌</span>
          <p className="wish-write-title">{item.secret || '写下你今天的心愿吧'}</p>
          <textarea
            value={wishText}
            onChange={event => setWishText(event.target.value)}
            rows={3}
            maxLength={200}
            placeholder="把今天想说的话留在这里，我会收进小星球。"
            aria-label="写下心愿"
          />
          <button type="button" className="letter-done-button" onClick={saveWish} disabled={saving || !wishText.trim()}>
            {saving ? '保存中…' : '写好啦，签个到'}
          </button>
          {saveNote && <p className="wish-save-note">{saveNote}</p>}
        </div>
      )}
      {saveNote && <p className="wish-save-note">{saveNote}</p>}
      {!peeled && !hasWish && <p>今天的心愿位还空着，写下想说的话，写好后自动签到。</p>}
    </div>
  )
}

function DailyInteraction({ item, signed = false, taskCompleted = false, onTaskComplete = () => {} }) {
  const [answer, setAnswer] = useState('')
  const [answerConfirmed, setAnswerConfirmed] = useState(false)
  const [answerError, setAnswerError] = useState('')
  const [chatStarted, setChatStarted] = useState(false)
  const normalizedAnswer = answer.replace(/[\s·。！？!?,，、]/g, '')
  const expectedAnswer = (item.answer || (item.day === 8 ? '5201013' : '小星球')).replace(/[\s·。！？!?,，、]/g, '')
  const puzzleOk = normalizedAnswer === expectedAnswer

  if (item.type === 'serialRiddleFirework') {
    return <SerialRiddleFirework item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'foamDrawingReview') {
    return <FoamDrawingReview item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'darkMazeTransition') {
    return <DarkMazeTransition item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'telescopeRunner') {
    return <TelescopeRunnerQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'stargazing') {
    return <StargazingQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'oneLightYearSignal') {
    return <OneLightYearSignalQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'vacationBreak') {
    return <VacationBreakQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (CHILDREN_SPECIAL_TYPES.includes(item.type)) {
    return <ChildrenComfortQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'sleepAtmosphereLab') {
    return <SleepAtmosphereLab item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'flowerCrown') {
    return <FlowerCrownQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'origamiCompanion') {
    return <OrigamiCompanionQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'photoWallFinale') {
    return <PhotoWallFinaleQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'anniversary') {
    return <AnniversaryFinaleQuest item={item} signed={signed} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'childrenDayPostponed') {
    return <div className="daily-letter children-postponed-letter"><p>{CHILDREN_POSTPONED_MESSAGE}</p></div>
  }

  if (item.type === 'game') {
    const gameId = item.gameId || 'mazeClassic'
    if (gameId === 'mazeClassic') return <MazeGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    if (gameId === 'catchHearts') return <CatchHeartsGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    if (gameId === 'popBubbles') return <PopBubblesGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    if (gameId === 'memoryMatch') return <MemoryMatchGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    if (gameId === 'slidePuzzle') return <SlidePuzzleGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    if (gameId === 'matchThree') return <MatchThreeGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    if (gameId === 'feedDog') return <FeedDogGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    if (gameId === 'whackAMole') return <WhackAMoleGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
    const embeddedGame = EMBEDDED_GAME_SOURCES[gameId]
    if (embeddedGame) return <EmbeddedGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} source={embeddedGame.source} title={embeddedGame.title} aspect={embeddedGame.aspect} />
    if (gameId === 'sakuraPuzzle') return <SakuraPuzzleGame key={item.day} item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'memoryPuzzle') {
    return (
      <div className="memory-puzzle">
        <div className={`memory-card ${puzzleOk && answerConfirmed ? 'is-confirmed' : ''}`}>
          <div className="memory-photo-wrap">
            <img src={item.image} alt="谜面图" />
          </div>
          <div className="memory-copy minimal-memory-copy">
            <div className="riddle-minimal-hint">
              <span>{item.date.replace(/-/g, '.')} · 猜谜语签到</span>
              <strong>{item.theme ? `谜底：${item.theme}` : '谜底是我们一起走过的地方'}</strong>
            </div>
            <label className="riddle-answer">
              <input
                value={answer}
                onChange={event => {
                  setAnswer(event.target.value)
                  setAnswerConfirmed(false)
                  setAnswerError('')
                  setChatStarted(false)
                }}
                placeholder="输入谜底答案"
                aria-label="输入第一天谜底答案"
              />
            </label>
            <button
              type="button"
              className="answer-confirm-button"
              onClick={() => {
                if (puzzleOk) {
                  setAnswerConfirmed(true)
                  setAnswerError('')
                  onTaskComplete(item.day)
                } else {
                  setAnswerConfirmed(false)
                  setAnswerError('好像不是这个答案哦，再想想那天我们一起走过的地方。')
                }
              }}
            >
              {answerConfirmed ? '答案已确认' : '你确定是这个答案吗?'}
            </button>
            {answerError && <p className="answer-error-note">{answerError}</p>}
          </div>
        </div>
        {puzzleOk && answerConfirmed && (
          <div
            className={`chat-replay ${chatStarted ? 'is-playing' : 'is-ready'}`}
            aria-label="散步记忆回放"
            role="button"
            tabIndex={0}
            onClick={() => setChatStarted(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setChatStarted(true)
            }}
          >
            <div className="chat-phone-top">
              <span>{item.day === 300 ? '2026年8月9日 · 第一天' : `${item.date} · Day ${item.day}`}</span>
              <strong>{item.day === 300 ? '第一次散步记忆' : (item.memoryTitle || item.title)}</strong>
            </div>
            <div className={`chat-screen ${chatStarted ? 'animated-chat' : 'chat-waiting'}`}>
              {!chatStarted ? (
                <div className="chat-play-prompt">
                  <span>💬</span>
                  <strong>点击聊天框，播放那次散步的回忆</strong>
                </div>
              ) : (
                <>
                  <div className="chat-image-message me" style={{ '--chat-delay': '.45s' }}>
                    <img src={item.image} alt="回忆图" />
                  </div>
                  {item.chatMessages.map((message, index) => {
                    const delay = `${1.55 + index * 1.85}s`
                    const typingDelay = `${0.72 + index * 1.85}s`
                    return (
                      <React.Fragment key={`${message.text}-${index}`}>
                        <div className={`chat-typing ${message.side}`} style={{ '--typing-delay': typingDelay }} aria-hidden="true">
                          <span /><span /><span />
                        </div>
                        <div className={`chat-row ${message.side}`} style={{ '--chat-delay': delay }}>
                          <img className="chat-avatar-img" src={message.side === 'me' ? '/images/柯基.png' : '/images/金毛.png'} alt={message.side === 'me' ? '小琛' : '小琳'} />
                          <p>{message.text}</p>
                        </div>
                      </React.Fragment>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }



  if (item.type === 'puzzle') {
    return (
      <div className="mini-game puzzle-game">
        <input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="输入答案" />
        <p>{puzzleOk ? item.secret : '答对以后会出现隐藏句子。'}</p>
      </div>
    )
  }

  if (item.type === 'fortune') {
    return <FortuneQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'sticker') {
    return <StickerQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'letter') {
    return <LetterQuest item={item} taskCompleted={taskCompleted} onTaskComplete={onTaskComplete} />
  }

  if (item.type === 'album') {
    return (
      <div className="daily-album-page">
        <div className="album-blank"><span>{item.icon}</span><strong>Photo Slot Day {item.day}</strong></div>
        <p>{item.secret}</p>
      </div>
    )
  }

  return (
    <div className="daily-letter">
      <p>{item.secret}</p>
      {!taskCompleted && (
        <button type="button" className="letter-done-button" onClick={() => onTaskComplete(item.day)}>我读完啦，可以签到</button>
      )}
    </div>
  )
}

function Timeline() {
  return (
    <section className="content-section">
      <header className="section-heading playful-heading">
        <span>Our Timeline</span>
        <h2>我们的故事时间线</h2>
        <p>现在时间线也和 520-1013 连载计划连起来：每天都是通往一周年的小节点。</p>
      </header>
      <div className="timeline-list">
        {timeline.map((item, index) => (
          <article className="timeline-card sticker-card" key={item.title}>
            <div className="timeline-index">{String(index + 1).padStart(2, '0')}</div>
            <div>
              <div className="card-meta"><span>{item.date}</span><strong>{item.tag}</strong></div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function LoveBox() {
  const [note, setNote] = useState(loveNotes[0])
  const [count, setCount] = useState(520)

  function randomNote() {
    const next = loveNotes[Math.floor(Math.random() * loveNotes.length)]
    setNote(next)
    setCount(value => value + 12)
  }

  return (
    <section className="content-section love-grid">
      <div className="love-generator sticker-card">
        <CuteIcon>💌</CuteIcon>
        <div className="tiny-label">今日份喜欢</div>
        <h2>爱的仓库</h2>
        <p className="note-display">“{note}”</p>
        <button onClick={randomNote}>🎲 点我领取一句喜欢</button>
        <div className="love-meter" aria-label={`喜欢值 ${count}%`}>
          <span style={{ width: `${Math.min(count / 6, 100)}%` }} />
        </div>
        <small>当前喜欢值：{count}%（还在继续上涨）</small>
      </div>
      <div className="wish-card sticker-card">
        <CuteIcon tone="minty">📝</CuteIcon>
        <div className="tiny-label">想和你一起</div>
        <h2>愿望清单</h2>
        <ul>
          {wishes.map(wish => <li key={wish}>{wish}</li>)}
        </ul>
      </div>
    </section>
  )
}


const PHOTO_WALL_KEY = 'wwcxrl-photo-wall-v1'
// 柯基/金毛等只用作头像和吉祥物，历史测试期若被当成照片传上墙，一律清理，不允许出现在照片墙。
const PHOTO_WALL_TEST_IMAGE_NAMES = new Set(['柯基.png', '金毛.png', 'corgi.png', 'golden.png', 'bichon.png', 'dog-one.png', 'dog-two.png'])
function isPhotoWallTestImage(photo) {
  if (!photo) return false
  const name = String(photo.name || '')
  if (PHOTO_WALL_TEST_IMAGE_NAMES.has(name)) return true
  return /柯基|金毛|比熊|corgi|golden|bichon|dog[-_ ]?(one|two)/i.test(name)
}
const PHOTO_OWNERS = [
  { id: 'orange', label: '小琛这一栏', icon: '/images/柯基.png', hint: '上传这一天的照片：照片、聊天截图、饭饭、路上的云都可以。' },
  { id: 'pomelo', label: '小琳这一栏', icon: '/images/金毛.png', hint: '你也可以每天挑一张，裱好以后一起挂上墙。' }
]
// 照片墙只展示真正上传的照片，不再预置任何参考照片。
const STATIC_PHOTOS = {}

function loadPhotoWallLocal() {
  try {
    const stored = JSON.parse(localStorage.getItem(PHOTO_WALL_KEY) || '{}')
    const next = {}
    let changed = false
    for (const [key, photo] of Object.entries(stored || {})) {
      if (isPhotoWallTestImage(photo)) {
        changed = true
        continue
      }
      next[key] = photo
    }
    if (changed) {
      try { localStorage.setItem(PHOTO_WALL_KEY, JSON.stringify(next)) } catch {}
    }
    return next
  } catch {
    return {}
  }
}

function savePhotoWallLocal(next) {
  localStorage.setItem(PHOTO_WALL_KEY, JSON.stringify(next || {}))
}

async function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const image = new Image()
      image.onerror = reject
      image.onload = () => {
        const maxSide = 1200
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.84))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function normalizeCloudPhoto(row) {
  if (!row) return null
  return {
    src: row.image_url,
    imagePath: row.image_path || '',
    name: row.caption || `${row.day}-${row.owner}.jpg`,
    caption: row.caption || `Day ${row.day} · 这一天`,
    frame: row.frame || 'cream',
    source: row.source || 'cloud',
    cloudId: row.id || null,
    userId: row.user_id || null,
    updatedAt: row.updated_at || ''
  }
}

async function loadCloudPhotoWallRows() {
  const supabase = await getSupabase()
  if (!supabase) return {}
  const identity = getCloudIdentity()
  const userIds = ['wwcxrl-orange-main', 'wwcxrl-pomelo-main']
  const { data, error } = await supabase
    .from('wwcxrl_photo_wall')
    .select('id,user_id,day,owner,image_url,image_path,caption,frame,source,updated_at')
    .in('user_id', userIds)
    .order('updated_at', { ascending: true })
  if (error) throw error
  const next = {}
  ;(data || []).filter(row => row.source !== 'static').forEach(row => {
    const key = `${row.day}-${row.owner}`
    const existing = next[key]
    const preferCurrentIdentity = identity && row.user_id === identity.id && existing?.userId !== identity.id
    if (!existing || preferCurrentIdentity || String(row.updated_at || '') >= String(existing.updatedAt || '')) {
      next[key] = normalizeCloudPhoto(row)
    }
  })
  return next
}

async function loadCloudUploadedPhotoDays(targetUserId = null) {
  const supabase = await getSupabase()
  if (!supabase) return []
  // 上传相册由双方各自进行：按「天-角色」返回，一天里双方各上传一张 => 两个抽能量机会
  const userIds = ['wwcxrl-orange-main', 'wwcxrl-pomelo-main']
  const { data, error } = await supabase
    .from('wwcxrl_photo_wall')
    .select('day,owner,source')
    .in('user_id', userIds)
    .not('image_url', 'is', null)
  if (error) throw error
  return Array.from(new Set((data || [])
    .filter(row => row.source !== 'static' && row.owner)
    .map(row => `${Number(row.day)}-${row.owner}`)
    .filter(key => /^\d+-(orange|pomelo)$/.test(key))
  )).sort()
}

async function grantEnergyChanceForPhotoDay(dayNumber, ownerId = '') {
  const day = Number(dayNumber)
  if (!day) return null
  const { next, newPhotoDays } = await loadLatestEnergyStateWithSignins()
  const grantedNow = (newPhotoDays || []).includes(`${day}-${ownerId}`)
  if (newPhotoDays?.length) {
    const saved = await persistEnergyState(next, 'energy_chance_granted_from_photo_upload')
    return { state: saved, granted: grantedNow }
  }
  const local = saveEnergyLocalState(next)
  return { state: local, granted: false }
}

async function uploadPhotoToCloud(day, owner, dataUrl, fileName, frame, identityOverride = null) {
  const { supabase, identity } = await ensureProfile()
  const activeIdentity = identityOverride || identity
  if (!supabase || !activeIdentity) return null
  const blob = await dataUrlToBlob(dataUrl)
  const safeName = String(fileName || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${activeIdentity.role}/${activeIdentity.id}/${day.day}-${owner.id}-${Date.now()}-${safeName}.jpg`
  const { error: uploadError } = await supabase.storage.from('wwcxrl-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true
  })
  if (uploadError) throw uploadError
  const { data: publicData } = supabase.storage.from('wwcxrl-photos').getPublicUrl(path)
  const now = new Date().toISOString()
  const payload = {
    user_id: activeIdentity.id,
    day: day.day,
    owner: owner.id,
    image_url: publicData.publicUrl,
    image_path: path,
    caption: `${day.date} · 这一天`,
    frame,
    source: 'upload',
    updated_at: now
  }
  const { data, error } = await supabase
    .from('wwcxrl_photo_wall')
    .upsert(payload, { onConflict: 'user_id,day,owner' })
    .select('*')
    .single()
  if (error) throw error
  await logCloudEvent('photo_uploaded_to_wall', { day: day.day, owner: owner.id, frame }, day.day)
  return normalizeCloudPhoto(data)
}

async function updateCloudPhotoFrame(photo, key, frame) {
  const { supabase, identity } = await ensureProfile()
  if (!supabase || !identity || !photo?.src || photo.source === 'static') return null
  const [day, owner] = key.split('-')
  const payload = {
    user_id: photo.userId || identity.id,
    day: Number(day),
    owner,
    image_url: photo.src,
    image_path: photo.imagePath || '',
    caption: photo.caption || `Day ${day} · 这一天`,
    frame,
    source: photo.source || 'upload',
    updated_at: new Date().toISOString()
  }
  const { data, error } = await supabase
    .from('wwcxrl_photo_wall')
    .upsert(payload, { onConflict: 'user_id,day,owner' })
    .select('*')
    .single()
  if (error) throw error
  return normalizeCloudPhoto(data)
}

async function removeCloudPhoto(photo, key) {
  const { supabase, identity } = await ensureProfile()
  if (!supabase || !identity || !photo || photo.source === 'static') return
  const [day, owner] = key.split('-')
  let query = supabase.from('wwcxrl_photo_wall').delete().eq('day', Number(day)).eq('owner', owner)
  query = photo.userId ? query.eq('user_id', photo.userId) : query.eq('user_id', identity.id)
  const { error } = await query
  if (error) throw error
}

// ===== 相册待同步队列：云端失败时照片先留在本机，之后自动/手动补传 =====
const PHOTO_WALL_PENDING_KEY = 'wwcxrl-photo-wall-pending-v1'

function loadPhotoWallPending() {
  try {
    const list = JSON.parse(localStorage.getItem(PHOTO_WALL_PENDING_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function savePhotoWallPending(list) {
  try {
    localStorage.setItem(PHOTO_WALL_PENDING_KEY, JSON.stringify(list || []))
  } catch (error) {
    console.warn('[wwcxrl album] pending queue save failed', error.message)
  }
}

function enqueuePhotoWallPending(item) {
  const list = loadPhotoWallPending()
  const index = list.findIndex(existing => existing.type === item.type && Number(existing.day) === Number(item.day) && existing.owner === item.owner)
  if (index >= 0) {
    list[index] = { ...list[index], ...item, updatedAt: new Date().toISOString() }
  } else {
    list.push({ ...item, id: `pw-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  }
  savePhotoWallPending(list)
  return list
}

function removePhotoWallPending(type, day, owner) {
  const list = loadPhotoWallPending()
  const next = list.filter(item => !(item.type === type && Number(item.day) === Number(day) && item.owner === owner))
  savePhotoWallPending(next)
  return next
}

function isPhotoPendingFor(key) {
  const [day, owner] = key.split('-')
  return loadPhotoWallPending().some(item => item.type === 'upload' && Number(item.day) === Number(day) && item.owner === owner)
}

function mergePhotoWallViews(cloud, local) {
  // 照片位若有在途操作（上传/换框/取下），以本机最新状态为准；否则云端优先、本机兜底。
  // 注意：不能删除同时存在于云端和本机的照片位，否则切换相框后照片会从墙上消失。
  const pendingKeys = new Set(loadPhotoWallPending()
    .filter(item => item.type === 'upload' || item.type === 'frame' || item.type === 'remove')
    .map(item => `${item.day}-${item.owner}`))
  const merged = { ...STATIC_PHOTOS, ...local }
  for (const [key, photo] of Object.entries(cloud)) {
    if (pendingKeys.has(key)) continue
    merged[key] = photo
  }
  return merged
}

async function uploadPendingPhotoItem(item) {
  const owner = PHOTO_OWNERS.find(o => o.id === item.owner)
  const day = dailyAdventures.find(d => Number(d.day) === Number(item.day)) || { day: Number(item.day), date: '' }
  if (!owner || !item.dataUrl) return false
  const identityOverride = item.userId
    ? { id: item.userId, role: item.role || 'pomelo', displayName: item.displayName || (item.role === 'orange' ? '小琛' : '小琳'), deviceLabel: '' }
    : null
  const cloudPhoto = await uploadPhotoToCloud(day, owner, item.dataUrl, item.fileName || 'photo.jpg', item.frame || 'cream', identityOverride)
  return Boolean(cloudPhoto)
}

async function flushPendingPhotoWallSync() {
  if (!cloudEnabled) return { synced: 0, failed: 0 }
  const pending = loadPhotoWallPending()
  if (!pending.length) return { synced: 0, failed: 0 }
  let synced = 0
  let failed = 0
  for (const item of pending) {
    const key = `${item.day}-${item.owner}`
    try {
      if (item.type === 'upload') {
        const ok = await uploadPendingPhotoItem(item)
        if (!ok) { failed += 1; continue }
        removePhotoWallPending('upload', item.day, item.owner)
        const local = loadPhotoWallLocal()
        if (local[key]) {
          delete local[key]
          savePhotoWallLocal(local)
        }
        synced += 1
      } else if (item.type === 'frame') {
        const photo = { src: item.imageUrl, imagePath: item.imagePath || '', caption: item.caption || '', frame: item.frame, source: 'upload', userId: item.userId || null }
        const updated = await updateCloudPhotoFrame(photo, key, item.frame)
        if (!updated) { failed += 1; continue }
        removePhotoWallPending('frame', item.day, item.owner)
        synced += 1
      } else if (item.type === 'remove') {
        await removeCloudPhoto({ userId: item.userId || null, source: 'upload' }, key)
        removePhotoWallPending('remove', item.day, item.owner)
        synced += 1
      }
    } catch (error) {
      console.warn('[wwcxrl album] pending sync retry failed', item.type, item.day, item.owner, error.message)
      failed += 1
    }
  }
  return { synced, failed }
}

function reconcileLocalPhotosToPending(cloudRows) {
  if (!cloudEnabled) return loadPhotoWallPending()
  const local = loadPhotoWallLocal()
  const pending = loadPhotoWallPending()
  const pendingKeys = new Set(pending.filter(item => item.type === 'upload').map(item => `${item.day}-${item.owner}`))
  const identity = getCloudIdentity()
  let changed = false
  for (const [key, photo] of Object.entries(local)) {
    const [dayNum, ownerId] = key.split('-')
    if (!photo?.src || photo.source === 'static' || photo.source === 'cloud') continue
    if (cloudRows?.[key]) continue
    if (pendingKeys.has(key)) continue
    const owner = PHOTO_OWNERS.find(o => o.id === ownerId)
    if (!owner || !Number(dayNum) || !photo.src.startsWith('data:')) continue
    enqueuePhotoWallPending({
      type: 'upload',
      day: Number(dayNum),
      owner: ownerId,
      userId: identity?.id || 'wwcxrl-pomelo-main',
      role: identity?.role || 'pomelo',
      displayName: identity?.displayName || '',
      dataUrl: photo.src,
      fileName: photo.name || 'photo.jpg',
      frame: photo.frame || 'cream'
    })
    changed = true
  }
  return changed ? loadPhotoWallPending() : pending
}

function getPhotoWallRequiredSlots(dayLimit = 24) {
  return dailyAdventures
    .filter(day => day.day <= dayLimit)
    .flatMap(day => PHOTO_OWNERS.map(owner => ({ key: `${day.day}-${owner.id}`, day, owner })))
}

function countFilledPhotoWallSlots(photos, dayLimit = 24) {
  return getPhotoWallRequiredSlots(dayLimit).filter(slot => photos?.[slot.key]?.src).length
}

function isPhotoWallFinaleActuallyComplete(dayLimit = 24) {
  const photos = { ...STATIC_PHOTOS, ...loadPhotoWallLocal() }
  const required = getPhotoWallRequiredSlots(dayLimit)
  return required.length > 0 && countFilledPhotoWallSlots(photos, dayLimit) >= required.length
}

function PhotoWallFinaleQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const requiredDayLimit = 24
  const [localPhotos, setLocalPhotos] = useState(loadPhotoWallLocal)
  const [cloudPhotos, setCloudPhotos] = useState({})
  const [status, setStatus] = useState('正在检查照片墙…')
  const photos = mergePhotoWallViews(cloudPhotos, localPhotos)
  const requiredSlots = getPhotoWallRequiredSlots(requiredDayLimit)
  const missingSlots = requiredSlots.filter(slot => !photos[slot.key]?.src)
  const filledCount = requiredSlots.length - missingSlots.length
  const complete = requiredSlots.length > 0 && missingSlots.length === 0
  const percent = Math.round((filledCount / Math.max(1, requiredSlots.length)) * 100)
  const missingPreview = missingSlots.slice(0, 6)

  React.useEffect(() => {
    let mounted = true
    loadCloudPhotoWallRows().then(rows => {
      if (!mounted) return
      setCloudPhotos(rows)
      const merged = { ...STATIC_PHOTOS, ...rows, ...loadPhotoWallLocal() }
      const remoteFilled = countFilledPhotoWallSlots(merged, requiredDayLimit)
      const remoteRequired = getPhotoWallRequiredSlots(requiredDayLimit).length
      if (remoteFilled >= remoteRequired) {
        savePhotoWallLocal({ ...loadPhotoWallLocal(), ...rows })
        setLocalPhotos(loadPhotoWallLocal())
      }
      setStatus(remoteFilled >= remoteRequired ? '照片墙已经装饰完成，可以签到啦。' : `照片墙已经同步好啦：${remoteFilled}/${remoteRequired}。`)
    }).catch(error => {
      console.warn('[wwcxrl cloud] photo wall finale load failed', error.message)
      if (mounted) setStatus('小星球网络打了个盹，先展示已经收好的照片。')
    })
    return () => { mounted = false }
  }, [])

  React.useEffect(() => {
    if (complete && !taskCompleted) {
      onTaskComplete(item.day)
      markCloudTaskCompleted(item.day, item.date)
      saveCloudDayProgress(item.day, { photoWallFilled: filledCount, required: requiredSlots.length, completedAt: new Date().toISOString() })
        .catch(error => console.warn('[wwcxrl cloud] photo wall finale progress save failed', error.message))
      logCloudEvent('photo_wall_finale_completed', { day: item.day, filledCount, required: requiredSlots.length }, item.day)
      setStatus('照片墙装饰完成啦，1012 可以签到，1013 的大门也开始发光。')
    }
  }, [complete, taskCompleted, item.day, item.date, filledCount, requiredSlots.length, onTaskComplete])

  return (
    <div className={`photo-wall-finale-quest ${complete ? 'is-complete' : ''}`}>
      <div className="photo-wall-finale-hero compact-finale-hero">
        <div className="photo-wall-finale-copy">
          <span className="tiny-label">1012 · 1013 Countdown Bulletin</span>
          <h4>{complete ? '照片墙装饰完成！' : '照片墙紧急征集令'}</h4>
          <p>叮咚叮咚，1013 快到啦！小星球现在征集 520–1013 的照片和聊天截图：小琛一栏、小琳一栏都挂满，才算把一周年背景墙布置好。</p>
          <strong>{filledCount}/{requiredSlots.length} 已挂上墙</strong>
        </div>
        <div className="photo-wall-finale-meter" aria-label={`照片墙完成度 ${percent}%`}>
          <div className="photo-wall-finale-number">{percent}%</div>
          <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
          <small>{complete ? '装饰完成：可以签到' : `还差 ${missingSlots.length} 个照片位`}</small>
        </div>
      </div>

      {status && <p className={`answer-error-note ${complete ? 'ready' : ''}`}>{status}</p>}

      <div className="photo-wall-callout-card">
        <span>📷</span>
        <div>
          <strong>{complete ? '一周年照片墙已经闪闪发光' : '请去顶部「相册」继续补照片墙'}</strong>
          <p>{complete ? '现在可以回到这里点击签到，给 1013 的最终回溯开门。' : '这里不搬整面照片墙，只负责催稿：去相册页把剩下的照片位补齐，再回来签到。'}</p>
        </div>
      </div>

      {!complete && (
        <div className="photo-wall-missing-summary">
          <div className="tiny-label">优先补这几格</div>
          <div className="missing-summary-grid">
            {missingPreview.map(slot => (
              <span key={slot.key}><img className="owner-avatar owner-avatar-sm" src={slot.owner.icon} alt="" /> {slot.day.date.slice(5)} · {slot.owner.id === 'orange' ? '小琛' : '小琳'}</span>
            ))}
          </div>
          {missingSlots.length > missingPreview.length && <small>上面先列 6 个最急缺口；完整还差 {missingSlots.length} 格，请去相册页慢慢贴满。</small>}
        </div>
      )}

      {complete && <div className="photo-wall-finale-done"><span>🖼️</span><p>整面照片墙都装饰好啦。今天的签到按钮已经可以点击，1013 的最终回溯也会跟着开启。</p></div>}
    </div>
  )
}

function PhotoWall() {
  const [curtainOpen, setCurtainOpen] = useState(false)
  const [localPhotos, setLocalPhotos] = useState(loadPhotoWallLocal)
  const [cloudPhotos, setCloudPhotos] = useState({})
  const [status, setStatus] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [albumDays, setAlbumDays] = useState(() => getDailyAdventures())
  const [pendingCount, setPendingCount] = useState(() => loadPhotoWallPending().length)
  const previewMode = isPreviewMode()
  const openedDays = albumDays.filter(item => isAlbumUploadOpen(item))
  const photos = mergePhotoWallViews(cloudPhotos, localPhotos)
  const filledPhotos = albumDays.flatMap(day => PHOTO_OWNERS.map(owner => {
    const key = `${day.day}-${owner.id}`
    return { key, day, owner, photo: photos[key] }
  })).filter(slot => slot.photo?.src)
  const wallCount = Math.max(1, filledPhotos.length)
  const wallColumns = wallCount <= 1 ? 1 : wallCount <= 4 ? 2 : wallCount <= 9 ? 3 : wallCount <= 16 ? 4 : wallCount <= 25 ? 5 : wallCount <= 36 ? 6 : 7
  const wallRows = Math.max(1, Math.ceil(wallCount / wallColumns))
  const wallGap = wallCount <= 4 ? 18 : wallCount <= 16 ? 14 : wallCount <= 36 ? 10 : 8

  React.useEffect(() => {
    let alive = true
    hydrateDailyAdventures().then(() => { if (alive) setAlbumDays(getDailyAdventures()) })
    const handleTasksUpdated = () => { if (alive) setAlbumDays(getDailyAdventures()) }
    window.addEventListener('wwcxrl-tasks-updated', handleTasksUpdated)
    const handleAlbumLocalTasks = (event) => {
      if (!alive || event.key !== ADMIN_LOCAL_TASKS_KEY) return
      hydrateDailyAdventures().then(() => { if (alive) setAlbumDays(getDailyAdventures()) })
    }
    window.addEventListener('storage', handleAlbumLocalTasks)
    return () => {
      alive = false
      window.removeEventListener('wwcxrl-tasks-updated', handleTasksUpdated)
      window.removeEventListener('storage', handleAlbumLocalTasks)
    }
  }, [])

  async function refreshCloudPhotoWall() {
    try {
      const rows = await loadCloudPhotoWallRows()
      setCloudPhotos(rows)
      let flushed = null
      if (cloudEnabled) {
        reconcileLocalPhotosToPending(rows)
        flushed = await flushPendingPhotoWallSync()
        if (flushed.synced) {
          const rowsAfter = await loadCloudPhotoWallRows()
          setCloudPhotos(rowsAfter)
        }
      }
      setLocalPhotos(loadPhotoWallLocal())
      setPendingCount(loadPhotoWallPending().length)
      return { rows, flushed }
    } catch (error) {
      console.warn('[wwcxrl cloud] photo wall refresh failed', error.message)
      setPendingCount(loadPhotoWallPending().length)
      return { rows: null, flushed: null }
    }
  }

  React.useEffect(() => {
    let alive = true
    refreshCloudPhotoWall().then(result => {
      if (!alive) return
      const pending = loadPhotoWallPending()
      if (pending.length) {
        setStatus(pending.length === 1 ? '有 1 张照片还在路上，网络恢复后会自动跟上。' : `有 ${pending.length} 张照片还在路上，网络恢复后会自动跟上。`)
      } else if (result.rows && Object.keys(result.rows).length) {
        setStatus('照片墙已经和两台设备同步好啦。')
      }
    })
    const handleOnline = () => {
      if (!alive) return
      setStatus('网络恢复啦，正在把照片补上去…')
      refreshCloudPhotoWall().then(() => {
        if (!alive) return
        const pending = loadPhotoWallPending()
        setPendingCount(pending.length)
        setStatus(pending.length ? `还有 ${pending.length} 张照片在排队，马上就好。` : '照片墙同步好啦。')
      })
    }
    window.addEventListener('online', handleOnline)
    return () => {
      alive = false
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  function persistLocal(next) {
    setLocalPhotos(next)
    savePhotoWallLocal(next)
  }

  async function handleUpload(day, owner, event) {
    const file = event.target.files?.[0]
    if (!file) return
    const key = `${day.day}-${owner.id}`
    const frame = 'cream'
    setStatus('正在把照片裱进相册…')
    try {
      const dataUrl = await resizeImageFile(file)
      const localPhoto = {
        src: dataUrl,
        name: file.name,
        caption: `${day.date} · 这一天`,
        frame,
        source: 'local',
        updatedAt: new Date().toISOString()
      }
      persistLocal({ ...localPhotos, [key]: localPhoto })
      const uploadIdentity = getCloudIdentity()
      if (cloudEnabled) {
        enqueuePhotoWallPending({
          type: 'upload',
          day: day.day,
          owner: owner.id,
          userId: uploadIdentity?.id || '',
          role: uploadIdentity?.role || 'pomelo',
          displayName: uploadIdentity?.displayName || '',
          dataUrl,
          fileName: file.name,
          frame
        })
        setPendingCount(loadPhotoWallPending().length)
      }
      // 无论云端是否可用，当天上传照片都记一次抽能量机会（本机计数、云端可同步）
      let grantResult = null
      try {
        grantResult = await grantEnergyChanceForPhotoDay(day.day, owner.id)
        window.dispatchEvent(new CustomEvent('wwcxrl-photo-uploaded', { detail: { day: day.day, owner: owner.id, granted: Boolean(grantResult?.granted) } }))
      } catch (energyError) {
        console.warn('[wwcxrl energy] photo chance grant failed', energyError.message)
      }
      const chanceNote = grantResult?.granted ? '新增 1 次抽能量机会。' : '今天的照片抽能量机会已领取过。'
      try {
        const cloudPhoto = await uploadPhotoToCloud(day, owner, dataUrl, file.name, frame)
        if (cloudPhoto) {
          removePhotoWallPending('upload', day.day, owner.id)
          setCloudPhotos(current => ({ ...current, [key]: cloudPhoto }))
          const nextLocal = { ...loadPhotoWallLocal() }
          delete nextLocal[key]
          persistLocal(nextLocal)
          setPendingCount(loadPhotoWallPending().length)
          setStatus(grantResult ? `照片已挂上墙，两台设备都会看到。${chanceNote}` : '照片已挂上墙，两台设备都会看到；抽能量机会稍后打开彩蛋页会自动补发。')
        } else {
          removePhotoWallPending('upload', day.day, owner.id)
          setPendingCount(loadPhotoWallPending().length)
          setStatus(grantResult ? `照片已经挂上墙啦。${chanceNote}` : '照片已经挂上墙啦；抽能量机会稍后打开彩蛋页会自动补发。')
        }
      } catch (cloudError) {
        console.warn('[wwcxrl cloud] photo upload failed', cloudError.message)
        setPendingCount(loadPhotoWallPending().length)
        setStatus(grantResult ? `照片已经收好啦，网络恢复后会自动同步。${chanceNote}` : '照片已经收好啦，网络恢复后会自动同步。')
      }
    } catch (error) {
      console.warn('[wwcxrl album] upload failed', error)
      setStatus('这张照片暂时没贴上去，换一张小一点的试试。')
    } finally {
      event.target.value = ''
    }
  }

  async function handleRemove(key) {
    const currentPhoto = photos[key]
    const nextLocal = { ...localPhotos }
    delete nextLocal[key]
    persistLocal(nextLocal)
    setCloudPhotos(current => {
      const next = { ...current }
      delete next[key]
      return next
    })
    const pendingUpload = loadPhotoWallPending().find(item => item.type === 'upload' && `${item.day}-${item.owner}` === key)
    if (pendingUpload) {
      removePhotoWallPending('upload', Number(key.split('-')[0]), key.split('-')[1])
      setPendingCount(loadPhotoWallPending().length)
      setStatus('这张照片已经从照片墙取下啦。')
      return
    }
    try {
      await removeCloudPhoto(currentPhoto, key)
      setStatus('这张照片已经从照片墙取下。')
    } catch (error) {
      console.warn('[wwcxrl cloud] photo remove failed', error.message)
      const identity = getCloudIdentity()
      enqueuePhotoWallPending({
        type: 'remove',
        day: Number(key.split('-')[0]),
        owner: key.split('-')[1],
        userId: currentPhoto?.userId || identity?.id || '',
        role: identity?.role || 'pomelo'
      })
      setPendingCount(loadPhotoWallPending().length)
      setStatus('这张照片已经从墙上取下，会自动同步到另一边。')
    }
  }

  async function handleRetrySync() {
    setStatus('正在重新同步照片…')
    const { flushed } = await refreshCloudPhotoWall()
    const pending = loadPhotoWallPending().length
    setPendingCount(pending)
    if (flushed?.synced) {
      setStatus(pending ? `已补上 ${flushed.synced} 张，还有 ${pending} 张在路上。` : `已补上 ${flushed.synced} 张，照片墙同步好啦。`)
    } else {
      setStatus(pending ? '网络还没恢复，照片先好好收着，恢复后会自动同步。' : '照片墙已是最新。')
    }
  }

  return (
    <section className="content-section gallery-theater">
      <header className="section-heading playful-heading">
        <span>Memory Wall</span>
        <h2>我们的每一天 · 双栏相册</h2>
        <p>每天两栏上传位：小琛一张，小琳一张。选好照片或聊天记录裱起来，拉开帷幕后就会挂到照片墙上。</p>
      </header>
      <div className={`curtain-upload-stage ${curtainOpen ? 'curtain-open' : ''}`}>
        <div className="curtain-panel curtain-left" aria-hidden="true" />
        <div className="curtain-panel curtain-right" aria-hidden="true" />
        <button type="button" className="curtain-cord" onClick={() => setCurtainOpen(open => !open)}>
          <span className="cord-line" />
          <span className="cord-pull">{curtainOpen ? '合上帷幕' : '拉开帷幕'}</span>
        </button>
        <div className="dual-upload-board sticker-card">
          <div className="album-board-topline">
            <strong>已开放 {openedDays.length} 天照片位 · 每天 2 栏，随天数增加</strong>
            <span>已挂上 {filledPhotos.length} 张</span>
          </div>
          {pendingCount > 0 && (
            <div className="album-pending-bar">
              <span>⏳ 有 {pendingCount} 张照片还在路上，网络恢复后会自动同步</span>
              <button type="button" onClick={handleRetrySync}>立即重试</button>
            </div>
          )}
          {status && <p className="answer-error-note">{status}</p>}
          <div className="daily-upload-list">
            {albumDays.map(day => {
              const open = isAlbumUploadOpen(day)
              return (
                <article key={day.day} className={`upload-day-card ${open ? 'is-open' : 'is-locked'}`}>
                  <div className="upload-day-title">
                    <span>{open ? day.icon : '🔒'}</span>
                    <div><strong>Day {day.day} · 纪念相册</strong><small>{day.date}</small></div>
                  </div>
                  <div className="upload-columns">
                    {PHOTO_OWNERS.map(owner => {
                      const key = `${day.day}-${owner.id}`
                      const photo = photos[key]
                      return (
                        <div key={owner.id} className={`upload-slot owner-${owner.id}`}>
                          <div className="slot-heading"><img className="owner-avatar owner-avatar-lg" src={owner.icon} alt={owner.label} /><strong>{owner.label}</strong></div>
                          {photo?.src ? (
                            <button type="button" className="mini-framed-photo frame-cream" onClick={() => setLightbox({ photo, owner, day })}>
                              <img src={photo.src} alt={`${owner.label} Day ${day.day}`} />
                              <small>{photo.name || photo.caption || owner.hint}</small>
                              {isPhotoPendingFor(key) && <span className="album-pending-chip">排队中</span>}
                            </button>
                          ) : (
                            <div className="empty-upload-slot"><span>{open ? '📷' : '🔒'}</span><p>{open ? owner.hint : '这一天还没解锁，照片位先被小贴纸封好。'}</p></div>
                          )}
                          <div className="slot-controls">
                            <label className={`upload-file-button ${open ? '' : 'disabled'}`}>{photo?.src ? '换一张' : '上传'}<input type="file" accept="image/*" disabled={!open} onChange={event => handleUpload(day, owner, event)} /></label>
                            {photo?.src && photo.source !== 'static' && <button type="button" className="remove-photo-button" onClick={() => handleRemove(key)}>取下</button>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
        <div className="photo-wall-layer" aria-hidden={!curtainOpen}>
          <div className="photo-wall-header"><span>🖼️</span><strong>我们的照片墙</strong><small>每次新增照片都会自动补到这里，每天 2 栏，天数越多照片位越多。</small></div>
          <div className="photo-wall-grid" style={{ '--wall-cols': wallColumns, '--wall-rows': wallRows, '--wall-gap': `${wallGap}px`, '--wall-count': wallCount }}>
            {filledPhotos.length === 0 ? <div className="empty-wall-note">还没有照片被裱起来。先合上帷幕，在上面上传第一张吧。</div> : filledPhotos.map((slot, index) => (
              <button key={slot.key} type="button" className={`wall-photo-card frame-cream owner-${slot.owner.id}`} style={{ '--tilt': `${index % 2 === 0 ? -2 : 2}deg` }} onClick={() => setLightbox(slot)} aria-label={`放大查看 ${slot.owner.label} Day ${slot.day.day} 的照片`}>
                <img src={slot.photo.src} alt={`${slot.owner.label} Day ${slot.day.day}`} />
                <span><img className="owner-avatar owner-avatar-sm" src={slot.owner.icon} alt="" /> Day {slot.day.day}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {lightbox && (
        <button type="button" className="photo-lightbox" onClick={() => setLightbox(null)} aria-label="关闭照片预览">
          <span className="lightbox-frame frame-cream">
            <img src={lightbox.photo.src} alt={`${lightbox.owner.label} Day ${lightbox.day.day}`} />
            <strong><img className="owner-avatar owner-avatar-sm" src={lightbox.owner.icon} alt="" /> Day {lightbox.day.day} · {lightbox.owner.label}</strong>
            <small>{lightbox.photo.caption || lightbox.photo.name || '我们的照片墙'}</small>
          </span>
        </button>
      )}
      {previewMode && <p className="album-preview-note">当前是 preview 模式：未来日期照片位也临时开放，方便开发检查。</p>}
    </section>
  )
}

const BACKPACK_ITEMS = {
  matchbox: { icon: '📦', name: '空火柴盒', desc: '521 烟花任务留下的火柴盒，边缘还有一点点星火味。' },
  match: { icon: '🔥', name: '火柴', desc: '可以点亮黑暗，也可以把普通夜晚变成庆祝。' },
  magic_wand: { icon: '🪄', name: '魔法棒', desc: '522 咖啡泡泡任务里的小魔法，适合轻轻一挥。' },
  coffee_cup: { icon: '☕', name: '咖啡', desc: '一杯被画过记忆的咖啡。' },
  coconut_cup: { icon: '🥥', name: '椰奶', desc: '藏着清甜后劲的小椰奶。' },
  foam_key: { icon: '🗝️', name: '奇怪的钥匙', desc: '打开 523 木门的关键道具。' },
  day300_badge: { icon: '🏅', name: '300天纪念徽章', desc: '从第一次散步那天开始计时，第 300 天收到的小小勋章。' },
  bare_telescope: { icon: '🔭', name: '没有调焦旋钮的望远镜', desc: '在星球2号遇到的望远镜，能看到星光，但画面糊成一团。' },
  telescope_focuser: { icon: '⚙️', name: '调焦旋钮', desc: '把模糊的星光慢慢拧清楚的小旋钮。' },
  focusable_telescope: { icon: '🔭', name: '能调焦的望远镜', desc: '调焦旋钮已经安装好，终于可以认真看星星了。' },
  observatory_building: { icon: '🌌', name: '星空观测站建造中', desc: '望远镜和调焦旋钮已经找齐，观测站正在星光里慢慢搭好。' },
  observatory_unlocked: { icon: '🌌', name: '星空观测站通行证', desc: '526 建造完成后放入顶栏的观测站入口。' },
  observatory_nav_unlocked: { icon: '🔭', name: '顶栏里的星空观测站', desc: '526 点击前往后，星空观测站正式出现在顶部导航。' },
  telescope_ready: { icon: '🔭', name: '能调焦的望远镜', desc: '调焦旋钮已经安装好，终于可以认真看星星了。' },
  one_lightyear_signal: { icon: '✨', name: '5.09 星光瓶', desc: '装着五颗云后星星和 0.09 点自己的光。低谷时摇一摇，会提醒你：光没有消失。' },
  vacation_half_hour_ticket: { icon: '🎟️', name: '半小时放假券', desc: '使用后可以理直气壮地休息半小时。不是偷懒，是小琳需要好好休息。' },
  cloud_fluff_trim: { icon: '☁️', name: '云朵绒边', desc: '529 轻轻靠近小琳之后获得的软软装饰，专门负责接住一点点委屈。' },
  rainbow_feather_patch: { icon: '🌈', name: '彩虹羽毛贴片', desc: '530 把好心情碎片收集回来以后做成的羽毛贴片，颜色很乖。' },
  reconciliation_star_bell: { icon: '🔔', name: '星星和好铃铛', desc: '531 认真修好别扭小结以后留下的小铃铛，响起来像一句“我听见啦”。' },
  decoratable_shuttlecock: { icon: '🏸', name: '待装饰羽毛球本体', desc: '601 儿童节工坊里的羽毛球本体，正在等云朵、彩虹和铃铛。' },
  best_shuttlecock: { icon: '🏸', name: '全世界最好看的羽毛球', desc: '给小琳小朋友的儿童节礼物：轻盈、漂亮、被认真装饰过。' },
  children_day_note: { icon: '💌', name: '六一小纸条', desc: '小琳儿童节快乐。希望心里的小朋友，永远都可以被好好接住。' },
  good_sleep_night_lamp: { icon: '🌙', name: '好眠小夜灯', desc: '603 睡眠氛围研究所发放的小夜灯。它会记住每只小动物喜欢的睡觉方式，也祝小琳夜夜都好眠。' }
}

const BACKPACK_HIDDEN_ITEM_IDS = new Set([
  'bare_telescope',
  'telescope_focuser',
  'focusable_telescope',
  'telescope_ready',
  'observatory_building',
  'observatory_nav_unlocked'
])


const TELESCOPE_PARTS = [
  { id: 'bare_telescope', icon: '🔭', name: '没有调焦旋钮的望远镜' },
  { id: 'telescope_focuser', icon: '⚙️', name: '调焦旋钮' },
  { id: 'observatory_building', icon: '🌌', name: '星空观测站建造中' }
]
const TELESCOPE_PART_IDS = TELESCOPE_PARTS.map(part => part.id)
const TELESCOPE_READY_ID = 'focusable_telescope'
const TELESCOPE_RUN_KEY = 'wwcxrl-day6-planet2-observatory-state'

function hasAllTelescopeParts(bag = loadBackpack()) {
  return Number(bag?.bare_telescope || 0) > 0 && Number(bag?.telescope_focuser || 0) > 0 && Number(bag?.observatory_building || 0) > 0
}

function normalizePlanet2State(value = {}) {
  return {
    position: Math.max(0, Math.min(100, Number(value.position || 0))),
    telescopeMet: Boolean(value.telescopeMet),
    telescopeQuestion: Boolean(value.telescopeQuestion),
    triedObservation: Boolean(value.triedObservation),
    gotBareScope: Boolean(value.gotBareScope),
    gotFocuser: Boolean(value.gotFocuser),
    stationUnlocked: Boolean(value.stationUnlocked),
    mode: value.mode || 'explore'
  }
}

function loadTelescopeRunState() {
  return normalizePlanet2State(getRoleJson(TELESCOPE_RUN_KEY, {}))
}

function saveTelescopeRunState(next, { cloud = true } = {}) {
  const normalized = normalizePlanet2State(next)
  setRoleJson(TELESCOPE_RUN_KEY, normalized)
  if (cloud) saveCloudDayProgress(6, normalized).catch(error => console.warn('[wwcxrl cloud] day6 planet2 save failed', error.message))
  return normalized
}

function TelescopeRunnerQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const [state, setState] = useState(loadTelescopeRunState)
  const [bag, setBag] = useState(loadBackpack)
  const [message, setMessage] = useState('欢迎来到星球2号，找找看你的周围有什么吧~')
  const [focusAttemptNote, setFocusAttemptNote] = useState('')
  const stateRef = React.useRef(state)
  React.useEffect(() => { stateRef.current = state }, [state])
  React.useEffect(() => {
    const refresh = () => setBag(loadBackpack())
    window.addEventListener('wwcxrl-backpack-updated', refresh)
    const onKey = (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
      if (event.key === 'Escape') { setStateAndSave({ ...stateRef.current, mode: 'explore' }, 'day5_exit_mode') }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wwcxrl-backpack-updated', refresh)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const progress = Math.round(state.position)
  const inArc = (start, end) => start <= end ? state.position >= start && state.position < end : state.position >= start || state.position < end
  const nearTelescope = inArc(16, 34)
  const nearFocuser = inArc(47, 64)
  const nearStation = inArc(78, 94)
  const rotation = -state.position * 4.8
  const landmarkStyle = marker => {
    const offset = ((marker - state.position + 50) % 100) - 50
    const visibleWindow = 30
    const clamped = Math.max(-visibleWindow, Math.min(visibleWindow, offset))
    const t = clamped / visibleWindow
    const x = 50 + t * 40
    const y = 58 + Math.abs(t) * 7
    const hidden = Math.abs(offset) > visibleWindow
    return {
      '--landmark-x': `${x}%`,
      '--landmark-y': `${y}%`,
      '--landmark-rot': `${t * 16}deg`,
      '--landmark-scale': hidden ? 0.88 : 1,
      '--landmark-opacity': hidden ? 0 : 1,
      '--landmark-display': hidden ? 'none' : 'grid'
    }
  }

  function setStateAndSave(next, eventType = 'day5_planet2_progress', opts = {}) {
    const normalized = saveTelescopeRunState(next, { cloud: opts.cloud !== false })
    stateRef.current = normalized
    setState(normalized)
    logCloudEvent(eventType, normalized, item.day)
    return normalized
  }

  function mergeBag(items) {
    const nextBag = addBackpackItems(items)
    setBag(nextBag)
    syncCloudBackpack(nextBag)
    return nextBag
  }

  function handlePlanetStep(current, next, eventType = 'day5_planet2_step') {
    const nextPos = next.position
    const isNearTelescope = nextPos >= 16 && nextPos < 34
    const isNearFocuser = nextPos >= 47 && nextPos < 64
    const isNearStation = nextPos >= 78 && nextPos < 94
    if (isNearTelescope && !current.gotBareScope && current.mode !== 'askScope' && current.mode !== 'observe') {
      setMessage('你找到旧望远镜啦。它的目镜雾蒙蒙的，好像正在小声问你：你要看星星吗?')
      setStateAndSave({ ...next, telescopeMet: true, telescopeQuestion: true, mode: 'askScope' }, 'day5_telescope_found')
    } else if (isNearFocuser && !current.gotFocuser && current.gotBareScope) {
      mergeBag([{ id: 'telescope_focuser', count: 1 }])
      setMessage('获得道具：调焦旋钮。小旋钮咔哒一声滚进背包，观测站的方向亮了一下。')
      setStateAndSave({ ...next, gotFocuser: true, mode: 'focuserFound' }, 'day5_focuser_collected')
    } else if (isNearStation && !current.stationUnlocked && current.gotFocuser) {
      setMessage('望远镜和调焦旋钮都收集好了。远处的观测站亮起施工灯，靠近平台看看吧。')
      setStateAndSave({ ...next, mode: 'station' }, 'day5_station_reached')
    } else if (isNearStation && !current.gotFocuser) {
      setMessage('远处好像有一座观测站，但小柚子还没带齐望远镜和调焦旋钮，先继续绕一圈。')
    } else if (nextPos >= 64 && nextPos < 78 && current.gotFocuser) {
      setMessage('调焦旋钮在背包里轻轻发亮。再沿着星球弧面多走一会儿。')
    } else if (eventType === 'day5_planet2_move') {
      setMessage('小柚子绕着星球2号慢慢走，脚下的巨大星球也跟着旋转。')
    }
  }

  React.useEffect(() => {
    handlePlanetStep(stateRef.current, stateRef.current, 'day5_planet2_position_check')
  }, [state.position])

  function move(direction) {
    const current = stateRef.current
    if (current.mode === 'observe') {
      exitObservation()
      return
    }
    const nextPos = (current.position + direction * 5 + 100) % 100
    const next = { ...current, position: nextPos }
    setStateAndSave(next, 'day5_planet2_move', { cloud: Math.floor(nextPos / 10) !== Math.floor(current.position / 10) })
    handlePlanetStep(current, next, 'day5_planet2_move')
  }

  function chooseLook(wants) {
    if (!wants) {
      setMessage('小柚子暂时不看星星，继续在星球表面找找看。')
      setStateAndSave({ ...stateRef.current, mode: 'explore', telescopeQuestion: false }, 'day5_decline_scope')
      return
    }
    setFocusAttemptNote('')
    setMessage('小柚子凑近圆形目镜：画面太模糊了，什么也看不见，试试用调焦旋钮吧~')
    setStateAndSave({ ...stateRef.current, mode: 'observe', triedObservation: true }, 'day5_try_blurry_observation')
  }

  function tryFocuser() {
    if (Number(loadBackpack().telescope_focuser || 0) <= 0) {
      setFocusAttemptNote('没摸到调焦旋钮, 似乎还没得到?')
      setMessage('没摸到调焦旋钮, 似乎还没得到?')
      return
    }
    setMessage('调焦旋钮以后要在星空观测站的平台上安装。先把这架望远镜带走吧。')
  }

  function exitObservation() {
    const nextBag = Number(loadBackpack().bare_telescope || 0) > 0 ? loadBackpack() : mergeBag([{ id: 'bare_telescope', count: 1 }])
    setBag(nextBag)
    setMessage('获得道具：没有调焦旋钮的望远镜。继续往右移动，看看星球另一边还有什么。')
    setStateAndSave({ ...stateRef.current, mode: 'explore', gotBareScope: true }, 'day5_bare_telescope_obtained')
  }

  function unlockStation() {
    const nextBag = { ...loadBackpack(), observatory_building: 1 }
    saveBackpack(nextBag)
    setBag(nextBag)
    syncCloudBackpack(nextBag)
    window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    const next = setStateAndSave({ ...stateRef.current, stationUnlocked: true, mode: 'complete', position: 84 }, 'day5_observatory_building_started')
    setMessage('星空观测站建造中! 望远镜和调焦旋钮都找齐啦，等到 526 那天再来签到页面看看。')
    if (!taskCompleted) {
      onTaskComplete(item.day)
      markCloudTaskCompleted(item.day, item.date)
    }
    window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '星空观测站建造中! 525 可以签到啦。' }))
    return next
  }

  return (
    <div className={`planet2-quest ${state.mode === 'observe' ? 'is-observing' : ''} ${taskCompleted || state.stationUnlocked ? 'is-complete' : ''}`}>
      <div className="planet2-hud">
        <strong>星球2号</strong>
        <span>探索进度 {progress}%</span>
        <span>{state.stationUnlocked ? '观测站已解锁' : '左右绕行探索'}</span>
      </div>
      <div className="planet2-stage" aria-label="星球2号探索游戏">
        <div className="planet2-space" aria-hidden="true"><i /><i /><i /><b /></div>
        <div className="planet2-world" style={{ '--planet-rotation': `${rotation}deg` }}>
          <span className="planet2-orb" />
          <span className="planet2-crater c1" /><span className="planet2-crater c2" /><span className="planet2-crater c3" />
        </div>
        <div className="planet2-landmark-layer" aria-hidden="true">
          {!state.gotBareScope && <span className={`planet2-object planet2-scope ${nearTelescope ? 'near' : ''}`} style={landmarkStyle(24)}>🔭<small>旧望远镜</small></span>}
          {state.gotBareScope && !state.gotFocuser && <span className={`planet2-object planet2-knob ${nearFocuser ? 'near' : ''}`} style={landmarkStyle(55)}>⚙️<small>调焦旋钮</small></span>}
          {state.gotFocuser && !state.stationUnlocked && <span className={`planet2-object planet2-station ${nearStation ? 'near' : ''}`} style={landmarkStyle(86)}><span className="station-dome" /><span className="station-tower" /><span className="station-scope" /><span className="station-lights" /><small>观测站</small></span>}
        </div>
        <div className="planet2-yuzu-anchor"><DogSprite type="pomelo" className="planet2-yuzu" /></div>
        <div className="planet2-compass"><i style={{ width: `${progress}%` }} /></div>
        {state.mode === 'askScope' && (
          <div className="planet2-dialog">
            <strong>你要看星星吗?</strong>
            <div><button type="button" onClick={() => chooseLook(true)}>要要要!</button><button type="button" className="ghost" onClick={() => chooseLook(false)}>不不不!</button></div>
          </div>
        )}
        {state.mode === 'observe' && (
          <div className="planet2-eyepiece">
            <div className="planet2-blurry-view"><span /> <i>?</i></div>
            <p>画面太模糊了，什么也看不见，试试用调焦旋钮吧~</p>
            {focusAttemptNote && <strong className="planet2-focus-warning">{focusAttemptNote}</strong>}
            <button type="button" onClick={tryFocuser}>确定使用调焦旋钮</button>
            <button type="button" className="ghost" onClick={exitObservation}>先退出观测模式</button>
          </div>
        )}
        {state.mode === 'focuserFound' && (
          <div className="planet2-dialog focuser-dialog">
            <strong>获得道具：调焦旋钮</strong>
            <p>小旋钮咔哒一声滚进背包。现在继续绕行，去找星空观测站的平台。</p>
            <button type="button" onClick={() => setStateAndSave({ ...stateRef.current, mode: 'explore' }, 'day5_focuser_dialog_closed')}>收好继续出发</button>
          </div>
        )}
        {state.mode === 'station' && (
          <div className="planet2-dialog station-dialog">
            <strong>星空观测站建造中!</strong>
            <p>望远镜和调焦旋钮都找齐了。526 那天回到签到页面，观测站会正式建造完成。</p>
            <p>观测站就在下方星球弧面上施工中 ↓</p>
            <button type="button" onClick={unlockStation}>确认开始建造</button>
          </div>
        )}
      </div>
      <div className="planet2-controls">
        <button type="button" onClick={() => move(-1)}>← 向左绕行</button>
        <button type="button" onClick={() => move(1)}>向右绕行 →</button>
      </div>
      <p className="planet2-message">{message}</p>
      <div className="planet2-inventory-strip">
        <span className={Number(bag.bare_telescope || 0) ? 'owned' : ''}><b>🔭</b><em>旧望远镜</em><small>未调焦</small></span>
        <span className={Number(bag.telescope_focuser || 0) ? 'owned' : ''}><b>⚙️</b><em>调焦旋钮</em><small>待安装</small></span>
        <span className={Number(bag.observatory_building || 0) || Number(bag.observatory_unlocked || 0) ? 'owned' : ''}><b>🌌</b><em>观测站</em><small>{Number(bag.observatory_unlocked || 0) ? '已放入顶栏' : Number(bag.observatory_building || 0) ? '建造中' : '待建造'}</small></span>
      </div>
    </div>
  )
}

function TelescopeWorkshop() {
  const [bag, setBag] = useState(loadBackpack)
  const [installed, setInstalled] = useState(() => Number(loadBackpack()[TELESCOPE_READY_ID] || 0) > 0)
  const [observing, setObserving] = useState(false)
  const [note, setNote] = useState('把 525 找到的望远镜安放在观测平台，再把调焦旋钮装上去。')
  React.useEffect(() => {
    const refresh = () => { const next = loadBackpack(); setBag(next); setInstalled(Number(next[TELESCOPE_READY_ID] || 0) > 0) }
    window.addEventListener('wwcxrl-backpack-updated', refresh)
    loadCloudBackpack().then(cloudBag => {
      const next = { ...loadBackpack(), ...(cloudBag || {}) }
      saveBackpack(next); setBag(next); setInstalled(Number(next[TELESCOPE_READY_ID] || 0) > 0)
    }).catch(() => {})
    return () => window.removeEventListener('wwcxrl-backpack-updated', refresh)
  }, [])
  const hasStation = Number(bag.observatory_unlocked || 0) > 0
  const navUnlocked = Number(bag.observatory_nav_unlocked || 0) > 0
  const hasBareScope = Number(bag.bare_telescope || 0) > 0
  const hasFocuser = Number(bag.telescope_focuser || 0) > 0
  const hasOneLightyearSignal = Number(bag.one_lightyear_signal || 0) > 0
  if (!navUnlocked) {
    return (
      <section className="content-section telescope-workshop-section observatory-section observatory-locked-section">
        <header className="section-heading playful-heading premium-heading">
          <span>Starlight Observatory</span>
          <h2>星空观测站还在封存中</h2>
          <p>等 526 在签到页面看到“星空观测站建造完成”，点击前往以后，这里才会正式开放。</p>
        </header>
      </section>
    )
  }
  function installFocuser() {
    if (!hasStation) { setNote('525 还没有解锁星空观测站，先去星球2号找到平台。'); return }
    if (!hasBareScope) { setNote('平台还空着：先在 524 找到那架没有调焦旋钮的望远镜。'); return }
    if (!hasFocuser) { setNote('还没有调焦旋钮，先回 524 星球表面把它捡回来。'); return }
    const nextBag = { ...loadBackpack(), [TELESCOPE_READY_ID]: 1, telescope_ready: 1 }
    saveBackpack(nextBag); setBag(nextBag); setInstalled(true); syncCloudBackpack(nextBag)
    window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    setNote('获得道具：能调焦的望远镜。现在可以进入观测模式，看第一颗星球。')
    logCloudEvent('observatory_focuser_installed', { item: TELESCOPE_READY_ID }, 7)
  }
  return (
    <section className="content-section telescope-workshop-section observatory-section">
      <header className="section-heading playful-heading premium-heading">
        <span>Starlight Observatory</span>
        <h2>星空观测站</h2>
        <p>525 找到的平台现在安静停在星球2号表面。把望远镜放上去，装好调焦旋钮，就能看见编号 20260520 的第一颗星球。</p>
      </header>
      <div className={`observatory-workshop ${installed ? 'installed' : ''}`}>
        <aside className="observatory-inventory-panel">
          <strong>观测站道具</strong>
          <button type="button" className={hasStation ? 'owned' : ''} disabled>🌌 星空观测站 <small>{hasStation ? '已解锁' : '未解锁'}</small></button>
          <button type="button" className={hasBareScope ? 'owned' : ''} disabled>🔭 没有调焦旋钮的望远镜 <small>{hasBareScope ? '已获得' : '未获得'}</small></button>
          <button type="button" className={hasFocuser ? 'owned pulse' : ''} onClick={installFocuser}>⚙️ 调焦旋钮 <small>{installed ? '已安装' : hasFocuser ? '点击后再点平台安装' : '未获得'}</small></button>
        </aside>
        <div className="observatory-platform-card observatory-diorama-card">
          <div className="observatory-dome-scene observatory-main-diorama">
            <div className="observatory-glass-dome" aria-hidden="true">
              <span className="dome-star s1" /><span className="dome-star s2" /><span className="dome-star s3" /><span className="dome-star s4" />
              <span className="dome-orbit orbit-a" /><span className="dome-orbit orbit-b" />
              <span className="dome-meteor" />
            </div>
            <span className="observatory-planet-rim" />
            <div className="observatory-surface-station" aria-hidden="true">
              <span className="surface-station-dome" />
              <span className="surface-station-base" />
              <span className="surface-station-window" />
              <span className="surface-station-antenna" />
            </div>
            <button type="button" className={`observatory-telescope-model main-observatory-scope ${installed ? 'ready' : hasBareScope ? 'bare' : 'empty'}`} onClick={installed ? () => setObserving(true) : installFocuser} aria-label="主望远镜，点击进入观测">
              <span className="scope-shadow" />
              <span className="scope-main-tube" />
              <span className="scope-front-rim" />
              <span className="scope-glass" />
              <span className="scope-back-cap" />
              <span className="scope-top-finder" />
              <span className="scope-focus-wheel" />
              <span className="scope-mount-head" />
              <span className="scope-tripod-core" />
              <span className="scope-tripod-leg leg-left" />
              <span className="scope-tripod-leg leg-right" />
              <span className="scope-tripod-leg leg-back" />
            </button>
            <span className="observatory-platform-label">两只小狗联合观测平台</span>
            <div className="observatory-crew orange-crew" aria-label="你记录员">
              <span className="space-helmet" /><DogSprite type="partner" className="observatory-orange crew-citrus" /><small>你 · 记录</small>
            </div>
            <div className="observatory-crew pomelo-crew" aria-label="我调焦员">
              <span className="space-helmet" /><DogSprite type="me" className="observatory-pomelo crew-citrus" /><small>我 · 调焦</small>
            </div>
            <div className="observatory-start-callout">今日观测开始！</div>
          </div>
          <div className="observatory-copy-card observatory-mission-control">
            <div className="tiny-label">Orange–Pomelo Joint Observatory</div>
            <h3>{installed ? '主望远镜已经对准第一颗星球' : hasStation ? '平台已经解锁，等待安装' : '星空观测站还没解锁'}</h3>
            <p>{note}</p>
            <div className="observatory-side-panels" aria-label="观测站功能面板">
              <article className="observatory-mini-panel log-panel"><span>📓</span><strong>观测日志</strong><small>记录 First Light 与每次发现</small></article>
              <article className="observatory-mini-panel map-panel"><span>🗺️</span><strong>星图档案</strong><small>520–1013 的星体逐颗亮起</small></article>
              <article className="observatory-mini-panel signal-panel"><span>📡</span><strong>信号接收器</strong><small>{hasOneLightyearSignal ? '1 光年信号已解码：5.09 / 5.09' : '等待来自 1 光年外的微弱信号'}</small></article>
            </div>
            <button type="button" onClick={installFocuser} disabled={installed}>{installed ? '已获得能调焦的望远镜' : '安装调焦旋钮'}</button>
            <button type="button" className="ghost" onClick={() => setObserving(true)} disabled={!installed}>进入观测模式</button>
          </div>
        </div>
      </div>
      {observing && <OrangePlanetEyepiece onClose={() => setObserving(false)} />}
    </section>
  )
}

const OBSERVATION_STATE_KEY = 'wwcxrl-day7-observatory-observation-state'
const OBSERVATION_PLANET_ID = '20260520'
const OBSERVATION_TARGET = { x: 8, y: -6, focus: 72, id: OBSERVATION_PLANET_ID }
const OBSERVATION_DISCOVERY_THRESHOLD = 0.92

function normalizeObservationState(value = {}) {
  const observedPlanets = Array.isArray(value.observedPlanets) ? value.observedPlanets.map(String) : []
  return {
    x: Math.max(-42, Math.min(42, Number(value.x ?? -22))),
    y: Math.max(-34, Math.min(34, Number(value.y ?? 18))),
    focus: Math.max(0, Math.min(100, Number(value.focus ?? 28))),
    observedPlanet: value.observedPlanet || OBSERVATION_PLANET_ID,
    observedPlanets: Array.from(new Set(observedPlanets)),
    firstObservedAt: value.firstObservedAt || '',
    clearFocusAchievedAt: value.clearFocusAchievedAt || '',
    discoveryUnlocked: Boolean(value.discoveryUnlocked || observedPlanets.includes(OBSERVATION_PLANET_ID))
  }
}

function loadObservationState() {
  return normalizeObservationState(getRoleJson(OBSERVATION_STATE_KEY, {}))
}

function saveObservationLocalState(next) {
  const normalized = normalizeObservationState(next)
  setRoleJson(OBSERVATION_STATE_KEY, normalized)
  return normalized
}

function getObservationQuality(state) {
  const aimDistance = Math.hypot(Number(state.x) - OBSERVATION_TARGET.x, Number(state.y) - OBSERVATION_TARGET.y)
  const focusDistance = Math.abs(Number(state.focus) - OBSERVATION_TARGET.focus)
  const aimScore = Math.max(0, 1 - aimDistance / 48)
  const focusScore = Math.max(0, 1 - focusDistance / 54)
  const clarity = Math.max(0, Math.min(1, aimScore * 0.48 + focusScore * 0.52))
  const discovered = clarity >= OBSERVATION_DISCOVERY_THRESHOLD
  return {
    aimDistance,
    focusDistance,
    aimScore,
    focusScore,
    clarity,
    discovered,
    blur: Math.max(0, 10 - clarity * 10.8),
    glow: 0.25 + clarity * 0.75,
    status: discovered ? '发现编号 20260520 星球! 小柚子把它记录进观测日志啦。' : clarity > 0.86 ? '星球轮廓已经很清楚啦，再把十字准星贴近中心一点。' : clarity > 0.58 ? '快清楚了，继续微调焦距和方向。' : clarity > 0.32 ? '能看到一点影子，但画面还是虚虚的。' : '画面糊成一团，小柚子还没对准。'
  }
}

function OrangePlanetEyepiece({ onClose }) {
  const [scope, setScope] = useState(loadObservationState)
  const quality = getObservationQuality(scope)
  const scopeRef = React.useRef(scope)
  React.useEffect(() => { scopeRef.current = scope }, [scope])
  React.useEffect(() => {
    const onKey = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const step = event.shiftKey ? 2 : 4
      const current = scopeRef.current
      const next = {
        ...current,
        x: current.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
        y: current.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
      }
      updateScope(next, 'observatory_aim_keyboard')
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  function syncObservation(next, eventType = 'observatory_observation_changed') {
    let normalized = normalizeObservationState(next)
    const q = getObservationQuality(normalized)
    const newlyDiscovered = q.discovered && !normalized.observedPlanets.includes(OBSERVATION_PLANET_ID)
    if (q.discovered) {
      const now = new Date().toISOString()
      normalized = normalizeObservationState({
        ...normalized,
        discoveryUnlocked: true,
        observedPlanet: OBSERVATION_PLANET_ID,
        observedPlanets: Array.from(new Set([...(normalized.observedPlanets || []), OBSERVATION_PLANET_ID])),
        firstObservedAt: normalized.firstObservedAt || now,
        clearFocusAchievedAt: normalized.clearFocusAchievedAt || now
      })
    }
    saveObservationLocalState(normalized)
    scopeRef.current = normalized
    setScope(normalized)
    if (newlyDiscovered) {
      window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: '发现编号 20260520 星球!' }))
    }
    loadCloudDayProgress(7).then(remote => {
      const base = remote?.progress || {}
      return saveCloudDayProgress(7, {
        ...base,
        observation: {
          ...normalized,
          clarity: Number(q.clarity.toFixed(3)),
          discovered: q.discovered,
          updatedAt: new Date().toISOString()
        },
        observedPlanets: Array.from(new Set([...(base.observedPlanets || []), ...(normalized.observedPlanets || [])])),
        firstObservedAt: normalized.firstObservedAt || base.firstObservedAt || '',
        clearFocusAchievedAt: normalized.clearFocusAchievedAt || base.clearFocusAchievedAt || ''
      })
    }).catch(error => console.warn('[wwcxrl cloud] observatory observation save failed', error.message))
    logCloudEvent(newlyDiscovered ? 'observatory_planet_20260520_discovered' : eventType, { ...normalized, clarity: Number(q.clarity.toFixed(3)), discovered: q.discovered }, 7)
    return normalized
  }

  function updateScope(next, eventType) {
    return syncObservation(next, eventType)
  }

  function nudge(dx, dy) {
    const current = scopeRef.current
    updateScope({ ...current, x: current.x + dx, y: current.y + dy }, 'observatory_aim_button')
  }

  function setFocusValue(value, eventType = 'observatory_focus_changed') {
    updateScope({ ...scopeRef.current, focus: Number(value) }, eventType)
  }

  const style = {
    '--scope-x': `${scope.x}%`,
    '--scope-y': `${scope.y}%`,
    '--scope-focus': scope.focus,
    '--scope-blur': `${quality.blur}px`,
    '--scope-clarity': quality.clarity,
    '--scope-glow': quality.glow
  }
  const discovered = Boolean(scope.discoveryUnlocked || quality.discovered)

  return (
    <div className="observatory-eyepiece-modal" role="dialog" aria-modal="true">
      <div className="observatory-eyepiece-card interactive-eyepiece-card">
        <div className="observatory-control-header">
          <div>
            <div className="tiny-label">Manual Telescope · 526</div>
            <h3>小柚子正在调望远镜</h3>
            <p>用方向键让望远镜对准星球，再转动调焦旋钮。越接近正确焦距，画面越清晰。</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>收起目镜</button>
        </div>
        <div className="observatory-scope-layout">
          <div className="sweet-orange-planet-view interactive-scope-view" style={style} tabIndex={0} aria-label="望远镜目镜，支持键盘方向键移动">
            <span className="scope-reticle" aria-hidden="true"><i /><b /></span>
            <span className="scope-vignette" aria-hidden="true" />
            <div className="scope-focus-layer">
              <span className="orange-orbit orbit-pink" /><span className="orange-orbit orbit-mint" />
              <span className="observed-orange-planet"><DogSprite type="orange" className="observed-main-orange" /><i /><b /><em /></span>
              <DogSprite type="pomelo" className="observed-pomelo" />
              <DogSprite type="orange" className="observed-orange" />
              <span className="planet-label label-a">520 开始签到</span>
              <span className="planet-label label-b">1013 纪念日</span>
              <span className="planet-label label-c">每日惊喜连载中</span>
              <strong className="planet-code">编号 20260520</strong>
            </div>
            <div className="scope-yuzu-guide" aria-hidden="true"><DogSprite type="pomelo" className="scope-mini-yuzu" /><span>小柚子在看</span></div>
          </div>
          <aside className="observatory-control-panel">
            <strong>望远镜控制台</strong>
            <p className="scope-status">{quality.status}</p>
            {discovered && (
              <div className="observatory-discovery-card" role="status">
                <span>🪐</span>
                <div>
                  <strong>发现星球：编号 {OBSERVATION_PLANET_ID}</strong>
                  <p>小柚子已经把这颗最初的小星球写进观测日志。</p>
                  {scope.firstObservedAt && <small>首次观测：{new Date(scope.firstObservedAt).toLocaleString('zh-CN')}</small>}
                </div>
              </div>
            )}
            <div className="scope-pad" aria-label="方向控制按钮">
              <button type="button" onClick={() => nudge(0, -4)}>↑</button>
              <button type="button" onClick={() => nudge(-4, 0)}>←</button>
              <button type="button" onClick={() => nudge(4, 0)}>→</button>
              <button type="button" onClick={() => nudge(0, 4)}>↓</button>
            </div>
            <label className="focus-knob-control">
              <span>调焦旋钮 <b>{Math.round(scope.focus)}</b></span>
              <input type="range" min="0" max="100" value={scope.focus} onChange={(event) => setFocusValue(event.target.value)} />
            </label>
            <div className="clarity-meter" aria-label={`清晰度 ${Math.round(quality.clarity * 100)}%`}>
              <span><b style={{ width: `${quality.clarity * 100}%` }} /></span>
              <small>清晰度 {Math.round(quality.clarity * 100)}%</small>
            </div>
            <div className="scope-readout">
              <span>水平 {Math.round(scope.x)}</span>
              <span>垂直 {Math.round(scope.y)}</span>
              <span>焦距 {Math.round(scope.focus)}</span>
            </div>
            <button type="button" onClick={() => setFocusValue(OBSERVATION_TARGET.focus, 'observatory_focus_auto_demo')}>轻轻拧到接近清晰</button>
          </aside>
        </div>
      </div>
    </div>
  )
}

function StargazingQuest({ item, taskCompleted = false, onTaskComplete = () => {} }) {
  const [entered, setEntered] = useState(false)
  const [bag, setBag] = useState(loadBackpack)
  React.useEffect(() => {
    loadCloudBackpack().then(cloudBag => { const next = { ...loadBackpack(), ...(cloudBag || {}) }; saveBackpack(next); setBag(next) }).catch(() => {})
  }, [])
  const building = Number(bag.observatory_building || 0) > 0
  const ready = Number(bag.observatory_unlocked || 0) > 0 || building
  const navUnlocked = Number(bag.observatory_nav_unlocked || 0) > 0
  const focusable = Number(bag[TELESCOPE_READY_ID] || 0) > 0 || Number(bag.telescope_ready || 0) > 0
  function enter() {
    if (!ready) return
    const nextBag = { ...loadBackpack(), observatory_building: 1, observatory_unlocked: 1, observatory_nav_unlocked: 1 }
    saveBackpack(nextBag)
    setBag(nextBag)
    syncCloudBackpack(nextBag)
    saveCloudDayProgress(item.day, { observatoryNavUnlocked: true, entered: true, enteredAt: new Date().toISOString() }).catch(error => console.warn('[wwcxrl cloud] day7 observatory progress save failed', error.message))
    saveCloudGlobalPatch({ observatoryNavUnlocked: true, observatoryEnteredAt: new Date().toISOString() }, 'global_observatory_nav_unlocked')
    window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    window.dispatchEvent(new CustomEvent('wwcxrl-open-observatory'))
    setEntered(true)
    if (!taskCompleted) {
      onTaskComplete(item.day)
      markCloudTaskCompleted(item.day, item.date)
      logCloudEvent('day7_observatory_nav_unlocked', { ready: true }, item.day)
    }
  }
  return (
    <div className={`stargazing-quest observatory-day6 ${ready ? 'ready' : 'locked'} ${focusable ? 'focused' : ''}`}>
      {!entered ? (
        <div className="enter-observatory-card">
          <DogSprite type="pomelo" className="enter-observatory-yuzu" />
          <h4>{ready ? '星空观测站建造完成' : '星空观测站建造中'}</h4>
          <p>{ready ? '星空观测站建造完成，点击前往。进入后，星空观测站会正式放入顶栏。' : '先完成 525：找齐旧望远镜和调焦旋钮，让观测站开始建造。'}</p>
          <button type="button" onClick={enter} disabled={!ready}>{navUnlocked ? '前往星空观测站' : '点击前往'}</button>
        </div>
      ) : focusable ? (
        <OrangePlanetEyepiece onClose={() => setEntered(false)} />
      ) : (
        <div className="enter-observatory-card">
          <h4>观测站已进入</h4>
          <p>平台还没有安装好“能调焦的望远镜”。去顶栏「星空观测站」安装调焦旋钮。</p>
          <button type="button" onClick={() => setEntered(false)}>我知道啦</button>
        </div>
      )}
    </div>
  )
}


const ENERGY_PROGRESS_DAY = 1
const ENERGY_SHARED_USER_ID = 'wwcxrl-pomelo-main'
const ENERGY_STATE_KEY = 'wwcxrl-capsule-energy-state'
const ENERGY_AUTO_REFRESH_MS = 7000
const ENERGY_EMPTY_STATE = { energy: 0, drawChances: 0, claimedSignedDays: [], claimedPhotoDays: [], draws: [] }
const ENERGY_MILESTONES = [
  { at: 100, icon: '🥛', name: '第一杯气泡' },
  { at: 260, icon: '🧸', name: '软软的小熊' },
  { at: 520, icon: '🪐', name: '小星球点亮' }
]

function normalizeEnergyState(progress = {}) {
  const claimed = Array.isArray(progress.claimedSignedDays) ? progress.claimedSignedDays.map(Number).filter(Boolean) : []
  const claimedPhotoDays = Array.isArray(progress.claimedPhotoDays)
    ? Array.from(new Set(progress.claimedPhotoDays.map(String).filter(value => /^\d+(-(orange|pomelo))?$/.test(value))))
    : []
  const draws = Array.isArray(progress.draws) ? progress.draws.slice(-80) : []
  return {
    ...ENERGY_EMPTY_STATE,
    energy: Math.max(0, Math.min(520, Number(progress.energy || 0))),
    drawChances: Math.max(0, Number(progress.drawChances || 0)),
    claimedSignedDays: Array.from(new Set(claimed)).sort((a, b) => a - b),
    claimedPhotoDays: Array.from(claimedPhotoDays).sort(),
    draws
  }
}

function getEnergyProgressOnly(progress = {}) {
  return normalizeEnergyState({
    energy: progress?.energy,
    drawChances: progress?.drawChances,
    claimedSignedDays: progress?.claimedSignedDays,
    claimedPhotoDays: progress?.claimedPhotoDays,
    draws: progress?.draws
  })
}

function loadEnergyLocalState() {
  return normalizeEnergyState(getRoleJson(ENERGY_STATE_KEY, ENERGY_EMPTY_STATE))
}

function saveEnergyLocalState(next) {
  const normalized = normalizeEnergyState(next)
  setRoleJson(ENERGY_STATE_KEY, normalized)
  window.dispatchEvent(new CustomEvent('wwcxrl-energy-updated', { detail: normalized }))
  return normalized
}

async function persistEnergyState(next, eventType = 'energy_state_saved') {
  const normalized = saveEnergyLocalState(next)
  let remoteProgress = {}
  try {
    const remote = await loadCloudDayProgress(ENERGY_PROGRESS_DAY, ENERGY_SHARED_USER_ID)
    remoteProgress = remote?.progress || {}
  } catch (error) {
    console.warn('[wwcxrl cloud] energy merge load failed', error.message)
  }
  const merged = {
    ...remoteProgress,
    ...normalized,
    global: remoteProgress.global || loadGlobalLocalState()
  }
  await saveCloudDayProgress(ENERGY_PROGRESS_DAY, merged, ENERGY_SHARED_USER_ID)
  logCloudEvent(eventType, { energy: normalized.energy, drawChances: normalized.drawChances, claimedSignedDays: normalized.claimedSignedDays, claimedPhotoDays: normalized.claimedPhotoDays, draws: normalized.draws?.length || 0 }, ENERGY_PROGRESS_DAY)
  return normalized
}

function syncEnergyState(next, eventType = 'energy_state_saved') {
  const normalized = saveEnergyLocalState(next)
  persistEnergyState(normalized, eventType).catch(error => console.warn('[wwcxrl cloud] energy save failed', error.message))
  return normalized
}

function getLocalUploadedPhotoDays() {
  try {
    const wall = loadPhotoWallLocal()
    // 本地照片墙 key 形如 `${day}-${owner}`：按「天-角色」计数，双方各算一次
    return Object.keys(wall || {})
      .filter(key => /^\d+-(orange|pomelo)$/.test(String(key)))
      .sort()
  } catch {
    return []
  }
}

async function loadLatestEnergyStateWithSignins() {
  const [remoteProgress, orangeCheckins, pomeloCheckins, cloudPhotoDays, legacyOrangeProgress] = await Promise.all([
    loadCloudDayProgress(ENERGY_PROGRESS_DAY, ENERGY_SHARED_USER_ID),
    loadCloudCheckins('wwcxrl-orange-main'),
    loadCloudCheckins('wwcxrl-pomelo-main'),
    loadCloudUploadedPhotoDays(),
    loadCloudDayProgress(ENERGY_PROGRESS_DAY, 'wwcxrl-orange-main')
  ])
  let remoteState = getEnergyProgressOnly(remoteProgress?.progress || loadEnergyLocalState())

  // 旧版能量状态按角色分开保存：把「小琛」的旧状态并入共享状态一次（幂等，合并后清零其抽奖次数/能量）
  // 只在「小琛」的设备上执行，避免两台设备同时合并造成重复计数
  if (cloudEnabled && getCloudIdentity().role === 'orange' && legacyOrangeProgress?.progress) {
    const legacy = getEnergyProgressOnly(legacyOrangeProgress.progress)
    if (legacy.drawChances > 0 || legacy.energy > 0 || legacy.draws.length) {
      remoteState = normalizeEnergyState({
        energy: Math.min(520, Number(remoteState.energy || 0) + Number(legacy.energy || 0)),
        drawChances: Number(remoteState.drawChances || 0) + Number(legacy.drawChances || 0),
        claimedSignedDays: [...remoteState.claimedSignedDays, ...legacy.claimedSignedDays],
        claimedPhotoDays: [...remoteState.claimedPhotoDays, ...legacy.claimedPhotoDays],
        draws: [...remoteState.draws, ...legacy.draws]
      })
      saveCloudDayProgress(ENERGY_PROGRESS_DAY, {
        energy: 0,
        drawChances: 0,
        claimedSignedDays: legacy.claimedSignedDays,
        claimedPhotoDays: legacy.claimedPhotoDays,
        draws: []
      }, 'wwcxrl-orange-main').catch(error => console.warn('[wwcxrl cloud] legacy energy clear failed', error.message))
    }
  }

  const cloudSignedDays = Array.from(new Set([...(orangeCheckins?.signed || []), ...(pomeloCheckins?.signed || [])]))
  const signedDays = Array.from(new Set([...cloudSignedDays, ...getRoleJson('wwcxrl-signed-days', [])].map(Number).filter(Boolean))).sort((a, b) => a - b)
  const claimed = new Set(remoteState.claimedSignedDays)
  const newSignedDays = signedDays.filter(day => !claimed.has(day))
  const uploadedPhotoDays = Array.from(new Set([...(cloudPhotoDays || []), ...getLocalUploadedPhotoDays()])).sort()
  const claimedPhotoDays = new Set(remoteState.claimedPhotoDays)
  const newPhotoDays = uploadedPhotoDays.filter(key => !claimedPhotoDays.has(key))
  const next = normalizeEnergyState({
    ...remoteState,
    drawChances: Number(remoteState.drawChances || 0) + newSignedDays.length + newPhotoDays.length,
    claimedSignedDays: Array.from(new Set([...remoteState.claimedSignedDays, ...newSignedDays])).sort((a, b) => a - b),
    claimedPhotoDays: Array.from(new Set([...(remoteState.claimedPhotoDays || []), ...newPhotoDays])).sort()
  })
  return { next, newSignedDays, newPhotoDays }
}

function BackpackView() {
  const [bag, setBag] = useState(loadBackpack)
  const [casting, setCasting] = useState(false)
  const [matchboxOpen, setMatchboxOpen] = useState(false)
  const stampTimersRef = React.useRef({})
  const [stampingIds, setStampingIds] = useState(() => {
    const pending = loadBackpackStampPending()
    if (!pending.size) return new Set()
    const currentBag = loadBackpack()
    const present = Array.from(pending).filter(id => Number(currentBag[id] || 0) > 0)
    saveBackpackStampPending(new Set())
    return new Set(present)
  })
  const stampingIdsRef = React.useRef(stampingIds)
  stampingIdsRef.current = stampingIds

  React.useEffect(() => {
    function scheduleStampRemoval(ids) {
      ;(ids || []).forEach(id => {
        if (stampTimersRef.current[id]) window.clearTimeout(stampTimersRef.current[id])
        stampTimersRef.current[id] = window.setTimeout(() => {
          setStampingIds(current => {
            const next = new Set(current)
            next.delete(id)
            return next
          })
          delete stampTimersRef.current[id]
        }, 1700)
      })
    }

    function markStamped(ids) {
      if (!ids || !ids.length) return
      const currentBag = loadBackpack()
      const present = Array.from(new Set(ids)).filter(id => Number(currentBag[id] || 0) > 0)
      if (!present.length) return
      const pending = loadBackpackStampPending()
      present.forEach(id => pending.delete(id))
      saveBackpackStampPending(pending)
      setStampingIds(current => {
        const next = new Set(current)
        present.forEach(id => next.add(id))
        return next
      })
      scheduleStampRemoval(present)
    }

    // 挂载时给“上次拿到但还没盖过章”的道具补上动画计时
    scheduleStampRemoval(Array.from(stampingIdsRef.current))

    const refresh = (event) => {
      markStamped(event?.detail?.stamped)
      setBag(loadBackpack())
    }
    window.addEventListener('wwcxrl-backpack-updated', refresh)
    loadCloudBackpack().then(cloudBag => {
      const next = { ...loadBackpack(), ...(cloudBag || {}) }
      saveBackpack(next)
      setBag(next)
    }).catch(() => {})
    return () => {
      window.removeEventListener('wwcxrl-backpack-updated', refresh)
      Object.values(stampTimersRef.current).forEach(handle => window.clearTimeout(handle))
      stampTimersRef.current = {}
    }
  }, [])

  function showPopup(message) {
    window.dispatchEvent(new CustomEvent('wwcxrl-soft-toast', { detail: message }))
  }

  function persistBag(next, eventType, detail = {}) {
    const previous = loadBackpack()
    const stampedIds = Object.keys(next).filter(id => Number(next[id] || 0) > 0 && Number(previous[id] || 0) <= 0)
    if (stampedIds.length) {
      const pending = loadBackpackStampPending()
      stampedIds.forEach(id => pending.add(id))
      saveBackpackStampPending(pending)
    }
    saveBackpack(next)
    setBag(next)
    syncCloudBackpack(next)
    logCloudEvent(eventType, { bag: next, ...detail }, 3)
    window.dispatchEvent(new CustomEvent('wwcxrl-backpack-updated', { detail: { stamped: stampedIds } }))
    return next
  }

  function castCoffeeToCoconut() {
    const current = loadBackpack()
    if (Number(current.magic_wand || 0) <= 0 || Number(current.coffee_cup || 0) <= 0) {
      showPopup('还需要魔法棒和咖啡都在背包里，才可以施法哦。')
      return
    }
    setCasting(true)
    showPopup('魔法棒正在绕着咖啡画圈圈……')
    window.setTimeout(() => {
      const latest = loadBackpack()
      const next = { ...latest }
      next.coffee_cup = Math.max(0, Number(next.coffee_cup || 0) - 1)
      if (next.coffee_cup <= 0) delete next.coffee_cup
      next.coconut_cup = Math.max(0, Number(next.coconut_cup || 0)) + 1
      persistBag(next, 'day3_magic_wand_cast_coffee_to_coconut', { keptMagicWand: true })
      setCasting(false)
      showPopup('咖啡变椰奶啦~')
    }, 1350)
  }

  function drinkCoffee() {
    showPopup('试喝咖啡失败, 小琳不爱喝咖啡哦!')
    logCloudEvent('day3_coffee_taste_failed', { item: 'coffee_cup' }, 3)
  }

  function drinkCoconut() {
    const current = loadBackpack()
    if (Number(current.coconut_cup || 0) <= 0) return
    showPopup('试喝成功!小琳爱喝椰奶!')
    window.setTimeout(() => showPopup('杯子里有什么奇怪的东西?'), 1500)
    window.setTimeout(() => {
      const latest = loadBackpack()
      const next = { ...latest, foam_key: Math.max(1, Number(latest.foam_key || 0)) }
      persistBag(next, 'day3_coconut_found_foam_key', { item: 'foam_key' })
      showPopup('获得道具, 奇怪的钥匙')
    }, 3000)
  }

  function openFinalMatchbox() {
    showPopup('火柴盒现在只是安静躺在背包里的旧道具。')
  }

  function handleItemDoubleClick(id, { isCoffee, isCoconut }) {
    if (id === 'matchbox') return openFinalMatchbox()
    if (isCoffee) return drinkCoffee()
    if (isCoconut) return drinkCoconut()
  }

  function onDragStart(event, id) {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = id === 'magic_wand' ? 'copyMove' : 'none'
  }

  function onDrop(event, id) {
    event.preventDefault()
    const dragged = event.dataTransfer.getData('text/plain')
    if (id === 'coffee_cup' && dragged === 'magic_wand') castCoffeeToCoconut()
  }

  const allEntries = Object.entries(bag || {}).filter(([, count]) => Number(count || 0) > 0)
  const entries = allEntries.filter(([id]) => !BACKPACK_HIDDEN_ITEM_IDS.has(id))
  const placeholders = ['matchbox', 'match', 'magic_wand', 'coffee_cup', 'coconut_cup', 'foam_key'].filter(id => !entries.some(([entryId]) => entryId === id)).slice(0, 4)
  return (
    <section className="content-section backpack-section premium-section">
      <header className="section-heading playful-heading premium-heading">
        <span>Backpack</span>
        <h2>小背包 · 道具收纳室</h2>
        <p>这里保存每天任务留下来的小证据。真正拿到的道具会亮起，暂时没拿到的会安静躺在星尘格子里。</p>
      </header>
      <div className="backpack-hero sticker-card premium-card">
        <div>
          <div className="tiny-label">Inventory Status</div>
          <h3>{entries.length ? `已经收好 ${entries.length} 种小道具` : '背包现在空空的，但已经准备好接住惊喜'}</h3>
          <p>{entries.length ? '每一件小道具都安静躺在这里，偶尔会偷偷发生一点变化。' : '完成每日任务后，小道具会带着盖章动画来到这里。'}</p>
        </div>
        <div className="backpack-orb" aria-hidden="true"><span>🎒</span><i /></div>
      </div>
      <div className={`backpack-grid premium-inventory-grid ${casting ? 'magic-casting-grid' : ''}`}>
        {entries.map(([id, count]) => {
          const item = BACKPACK_ITEMS[id] || { icon: '🎁', name: id, desc: '一件来自小星球的小东西。' }
          const isCoffee = id === 'coffee_cup'
          const isCoconut = id === 'coconut_cup'
          const isWand = id === 'magic_wand'
          const isMatchbox = id === 'matchbox'
          const matchboxGlowing = false
          return (
            <article
              className={`sticker-card inventory-card is-owned item-${id} ${stampingIds.has(id) ? 'stamp-in-card' : ''} ${isCoffee ? 'coffee-drop-target' : ''} ${isWand ? 'wand-draggable' : ''} ${matchboxGlowing ? 'matchbox-glowing' : ''}`}
              key={id}
              draggable={isWand}
              onDragStart={event => onDragStart(event, id)}
              onDragOver={event => { if (isCoffee) event.preventDefault() }}
              onDrop={event => onDrop(event, id)}
              onDoubleClick={() => handleItemDoubleClick(id, { isCoffee, isCoconut })}
              title={isMatchbox ? (matchboxGlowing ? '双击打开发光的火柴盒' : item.name) : isCoffee ? '双击试喝咖啡' : isCoconut ? '双击试喝椰奶' : item.name}
            >
              {stampingIds.has(id) && <span className="backpack-stamp" aria-hidden="true">✦ 新到</span>}
              {casting && isCoffee && <div className="coffee-spell-overlay" aria-hidden="true">
                <em className="spell-ring ring-one" />
                <em className="spell-ring ring-two" />
                <em className="spell-ring ring-three" />
                <span className="spell-wand">🪄</span>
                <span className="spell-cup coffee-before">☕</span>
                <span className="spell-cup coconut-after">🥥</span>
                <b>✦ 变甜咒语 ✦</b>
                <strong>咖啡甜化中</strong>
                <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
              </div>}
              <CuteIcon>{item.icon}</CuteIcon>
              <div className="inventory-count">× {count}</div>
              <h3>{item.name}</h3>
              <p>{item.desc}</p>
              {isCoffee && <small className="inventory-hint">可双击试喝</small>}
              {isCoconut && <small className="inventory-hint">双击试喝看看</small>}
              {matchboxGlowing && <small className="inventory-hint final-hint">正在发光 · 双击打开</small>}
            </article>
          )
        })}
        {!entries.length && <article className="sticker-card inventory-card empty-feature"><CuteIcon>✨</CuteIcon><h3>下一件道具正在路上</h3><p>先去每日签到完成今天的小任务，它就会被小琛送进背包。</p></article>}
        {placeholders.map(id => {
          const item = BACKPACK_ITEMS[id]
          return <article className="sticker-card inventory-card is-locked" key={`placeholder-${id}`}><CuteIcon>{item.icon}</CuteIcon><h3>{item.name}</h3><p>等待被发现</p></article>
        })}
      </div>
      {matchboxOpen && createPortal(
        <div className="final-matchbox-modal" role="dialog" aria-modal="true" aria-label="空空火柴盒里的照片">
          <div className="final-matchbox-card">
            <button type="button" className="rewind-close" onClick={() => setMatchboxOpen(false)}>×</button>
            <div className="final-matchbox-lid">📦</div>
            <h3>空空的火柴盒打开了</h3>
            <div className="final-matchbox-photo">
              <img src={FINAL_PLACEHOLDER_PHOTO} alt="最终签到照片占位" />
            </div>
            <p><b>最终签到：</b>请找到照片里的东西，它就在你的周围哦!</p>
            <small>这张照片目前是占位图，等你给我真正的照片后我会替换进去。</small>
            <button type="button" onClick={() => setMatchboxOpen(false)}>我去找找看</button>
          </div>
        </div>,
        document.body
      )}
    </section>
  )
}

function formatDrawTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

// ---- 彩蛋页：异地见面倒计时 + 可爱小日历 ----
const WEEK_LABELS_CN = ['一', '二', '三', '四', '五', '六', '日']

function MeetingCountdownCalendar() {
  const [data, setData] = React.useState({ next: '', past: [] })
  const [loaded, setLoaded] = React.useState(false)
  const [viewDate, setViewDate] = React.useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  React.useEffect(() => {
    let alive = true
    loadMeetingDates().then(value => {
      if (!alive) return
      setData(value || { next: '', past: [] })
      setLoaded(true)
      // 如果下次见面在别的月份，默认翻到那个月份，让她一眼看到
      if (value?.next) {
        const next = new Date(`${value.next}T00:00:00`)
        if (!Number.isNaN(next.getTime())) {
          setViewDate(new Date(next.getFullYear(), next.getMonth(), 1))
        }
      }
    })
    return () => { alive = false }
  }, [])

  const daysLeft = meetingDaysLeft(data.next)
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  // 把「已见面时间段」展开到每一天：start/end 显示图案，中间日显示 ♡
  const pastDayInfo = new Map()
  ;(data.past || []).forEach(item => {
    const start = item.start || item.date || ''
    const end = item.end || item.start || item.date || start
    if (!start) return
    const s = new Date(`${start}T00:00:00`)
    const e = new Date(`${end}T00:00:00`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return
    const cursor = new Date(s)
    let guard = 0
    while (cursor <= e && guard < 366) {
      const ds = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const isStart = cursor.getTime() === s.getTime()
      const isEnd = cursor.getTime() === e.getTime()
      const edge = isStart && isEnd ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'mid'
      pastDayInfo.set(ds, { emoji: item.emoji || '💗', note: item.note || '', edge })
      cursor.setDate(cursor.getDate() + 1)
      guard += 1
    }
  })

  function formatRange(item) {
    const start = (item.start || item.date || '').replace(/-/g, '.')
    const end = (item.end || item.start || item.date || '').replace(/-/g, '.')
    return start === end ? start : `${start} - ${end}`
  }

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function moveMonth(offset) {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1))
  }

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(null)

  const countdownCopy = !loaded
    ? '正在翻日历…'
    : !data.next
      ? '下一次见面的日子还在路上 💌'
      : daysLeft > 0
        ? `距离下次见面还有`
        : daysLeft === 0
          ? '就是今天！我们要见面啦'
          : '已经见面啦，期待下一次 💕'

  return (
    <section className="meeting-calendar-card sticker-card" aria-label="异地见面倒计时与见面日历">
      <div className="meeting-countdown">
        <span className="meeting-countdown-kicker">♡ 异地也要数着日子 ♡</span>
        <div className="meeting-countdown-main">
          <strong>{countdownCopy}</strong>
          {loaded && data.next && daysLeft !== null && (
            <b className={daysLeft === 0 ? 'is-today' : daysLeft < 0 ? 'is-past' : ''}>
              {daysLeft > 0 ? daysLeft : ''}
              {daysLeft > 0 && <em>天</em>}
            </b>
          )}
        </div>
        {data.next && <p className="meeting-next-date">📅 {data.next.replace(/-/g, '.')} 是我们约定的见面日</p>}
      </div>

      <div className="meeting-calendar">
        <div className="meeting-calendar-head">
          <button type="button" className="meeting-calendar-nav" onClick={() => moveMonth(-1)} aria-label="上个月">‹</button>
          <strong>{year} 年 {month + 1} 月</strong>
          <button type="button" className="meeting-calendar-nav" onClick={() => moveMonth(1)} aria-label="下个月">›</button>
        </div>
        <div className="meeting-calendar-week">
          {WEEK_LABELS_CN.map((label, index) => (
            <span key={label} className={index >= 5 ? 'is-weekend' : ''}>{label}</span>
          ))}
        </div>
        <div className="meeting-calendar-grid">
          {cells.map((day, index) => {
            if (!day) return <span key={`empty-${index}`} className="meeting-calendar-cell is-empty" />
            const ds = dateStr(day)
            const pastInfo = pastDayInfo.get(ds)
            const isPast = !!pastInfo
            const isNext = data.next === ds
            const isToday = ds === todayStr
            return (
              <span
                key={ds}
                className={`meeting-calendar-cell ${isPast ? 'is-past-day' : ''} ${isPast && pastInfo.edge === 'mid' ? 'is-past-mid' : ''} ${isPast && (pastInfo.edge === 'start' || pastInfo.edge === 'single') ? 'is-past-start' : ''} ${isPast && pastInfo.edge === 'end' ? 'is-past-end' : ''} ${isNext ? 'is-next-day' : ''} ${isToday ? 'is-today' : ''}`}
                title={isPast ? `${pastInfo.emoji} ${pastInfo.note || '我们见面的日子'}` : isNext ? '下次见面的日子 💕' : ''}
              >
                {isPast && pastInfo.edge !== 'mid' && <i className="meeting-day-mark" aria-hidden="true">{pastInfo.emoji || '💗'}</i>}
                {isPast && pastInfo.edge === 'mid' && <i className="meeting-day-mark is-mid" aria-hidden="true">♡</i>}
                {isNext && <i className="meeting-day-mark is-next" aria-hidden="true">🎀</i>}
                <b>{day}</b>
              </span>
            )
          })}
        </div>
        <div className="meeting-calendar-legend">
          <span><i className="legend-dot is-past" />已见面的日子</span>
          <span><i className="legend-dot is-next" />下次见面</span>
          <span><i className="legend-dot is-today" />今天</span>
        </div>
      </div>

      {(data.past || []).length > 0 && (
        <div className="meeting-past-chips">
          {data.past.slice().reverse().map(item => (
            <span key={`${item.start || item.date}-${item.end || ''}`} className="meeting-past-chip" title={item.note}>
              <b>{item.emoji || '💗'}</b>
              <em>{formatRange(item)}</em>
              {item.note && <small>{item.note}</small>}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function EnergyCapsule() {
  const [energyState, setEnergyState] = useState(loadEnergyLocalState)
  const [status, setStatus] = useState('正在准备今天的抽奖…')
  const [rolling, setRolling] = useState(false)
  const [burst, setBurst] = useState(null)
  const refreshInFlightRef = React.useRef(false)
  const rollingRef = React.useRef(false)
  const energy = Math.min(520, Number(energyState.energy || 0))
  const percent = Math.round((energy / 520) * 100)
  const drawChances = Math.max(0, Number(energyState.drawChances || 0))
  const signedCount = energyState.claimedSignedDays.length
  const photoCount = energyState.claimedPhotoDays.length
  const reachedCount = ENERGY_MILESTONES.filter(milestone => energy >= milestone.at).length
  const sealCopy = energy >= 520
    ? '小星球已经点亮，封存的内容随时可以开启。'
    : energy >= 260
      ? '第二枚印章亮了，离完全点亮只差最后一段光。'
      : energy >= 100
        ? '第一枚印章亮了，能量还在慢慢积攒。'
        : '能量还在积蓄，封存的内容正在慢慢解冻…'

  React.useEffect(() => {
    rollingRef.current = rolling
  }, [rolling])

  React.useEffect(() => {
    let alive = true
    async function refreshEnergy(reason = 'auto') {
      if (refreshInFlightRef.current || rollingRef.current) return
      refreshInFlightRef.current = true
      try {
        const { next, newSignedDays, newPhotoDays } = await loadLatestEnergyStateWithSignins()
        if (!alive) return
        const grantedCount = newSignedDays.length + newPhotoDays.length
        if (grantedCount) {
          const saved = await persistEnergyState(next, newPhotoDays.length ? 'energy_chances_granted_from_activity' : 'energy_chances_granted_from_signins')
          if (!alive) return
          setEnergyState(saved)
          const parts = []
          if (newSignedDays.length) parts.push(`签到 ${newSignedDays.length} 次`)
          if (newPhotoDays.length) parts.push(`相册上传 ${newPhotoDays.length} 次`)
          setStatus(`新增 ${grantedCount} 次抽能量机会（${parts.join(' + ')}），两台设备都已记下。`)
        } else {
          const local = saveEnergyLocalState(next)
          setEnergyState(local)
          setStatus(previous => {
            if (previous.startsWith('抽取成功')) return previous
            if (reason === 'interval') return '进度已经自动更新啦。'
            return '进度已经同步好啦。'
          })
        }
      } catch (error) {
        console.warn('[wwcxrl cloud] energy refresh failed', error.message)
        if (alive) setStatus('网络打了个盹，进度先记在这里，恢复后会自动同步。')
      } finally {
        refreshInFlightRef.current = false
      }
    }
    refreshEnergy('mount')
    const handleFocus = () => refreshEnergy('focus')
    const handleSigned = () => refreshEnergy('signed')
    const handlePhotoUploaded = () => refreshEnergy('photo')
    const handleVisibility = () => { if (!document.hidden) refreshEnergy('visible') }
    const intervalId = window.setInterval(() => refreshEnergy('interval'), ENERGY_AUTO_REFRESH_MS)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('wwcxrl-signed-updated', handleSigned)
    window.addEventListener('wwcxrl-photo-uploaded', handlePhotoUploaded)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      alive = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('wwcxrl-signed-updated', handleSigned)
      window.removeEventListener('wwcxrl-photo-uploaded', handlePhotoUploaded)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  function drawEnergy() {
    if (rolling || drawChances <= 0) {
      setStatus('暂时没有抽能量次数，完成每日签到就会获得新的机会。')
      return
    }
    setRolling(true)
    setStatus('小星球能量正在摇奖中…')
    window.setTimeout(async () => {
      try {
        const { next: latest } = await loadLatestEnergyStateWithSignins()
        if (Number(latest.drawChances || 0) <= 0) {
          const local = saveEnergyLocalState(latest)
          setEnergyState(local)
          setStatus('暂时没有抽能量次数，先完成每日签到再来抽。')
          setRolling(false)
          return
        }
        const gain = Math.floor(Math.random() * 11) + 5
        const previousEnergy = Number(latest.energy || 0)
        const nextEnergy = Math.min(520, previousEnergy + gain)
        const crossedMilestones = ENERGY_MILESTONES.filter(milestone => previousEnergy < milestone.at && nextEnergy >= milestone.at)
        const next = normalizeEnergyState({
          ...latest,
          energy: Math.min(520, Number(latest.energy || 0) + gain),
          drawChances: Math.max(0, Number(latest.drawChances || 0) - 1),
          draws: [...(latest.draws || []), { gain, at: new Date().toISOString() }]
        })
        const saved = await persistEnergyState(next, 'energy_lottery_drawn')
        setEnergyState(saved)
        const milestoneText = crossedMilestones.length
          ? ` 并点亮${crossedMilestones.map(milestone => `「${milestone.name}」`).join('、')}印章！`
          : ''
        setStatus(`抽取成功! 小星球能量 +${gain}，两台设备都已记下。${milestoneText}`)
        setBurst({ gain, key: Date.now() })
      } catch (error) {
        console.warn('[wwcxrl cloud] energy draw sync failed', error.message)
        setStatus('网络打了个盹，稍后再试一次，别让两台设备的进度不一样哦。')
      } finally {
        setRolling(false)
      }
    }, 900)
  }

  return (
    <section className="content-section capsule-section premium-section">
      <header className="section-heading playful-heading premium-heading">
        <span>Small Planet Energy</span>
        <h2>小星球能量胶囊</h2>
        <p>每天完成签到、或当天至少上传一张相册照片，都会存下一次抽能量机会。来到这里就能真实抽取随机 5-15 点小星球能量。</p>
      </header>
      <MeetingCountdownCalendar />
      <div className={`capsule-vault sticker-card premium-card ${rolling ? 'is-rolling' : ''}`}>
        <div className="capsule-orbit-scene" aria-hidden="true">
          <span className="vault-ring ring-a" />
          <span className="vault-ring ring-b" />
          <span className="vault-core"><img className="vault-core-img" src="/images/capsule-golden-egg.png" alt="小星球能量金蛋" /></span>
          <i className="vault-spark spark-a">✦</i>
          <i className="vault-spark spark-b">♡</i>
          <i className="vault-spark spark-c">✧</i>
          {burst && <span key={burst.key} className="capsule-energy-burst">+{burst.gain}</span>}
        </div>
        <div className="capsule-copy">
          <h3>彩蛋内容暂时封存中</h3>
          <p className="capsule-seal-copy">{sealCopy}</p>
          <p>抽奖次数、抽到的能量和历史记录都会自动同步。下次打开，进度不会丢。</p>
          <div className="capsule-energy-meter" aria-label={`小星球能量 ${energy} / 520`}>
            <div><strong>小星球能量</strong><span>{energy}/520</span></div>
            <b className="capsule-energy-track"><i style={{ width: `${percent}%` }} /><em style={{ left: '19.2%' }} /><em style={{ left: '50%' }} /><em style={{ left: '100%' }} /></b>
            <small>{signedCount || photoCount ? `已有 ${signedCount} 天签到 + ${photoCount} 次相册上传兑换为抽奖机会。剩余 ${drawChances} 次。` : '完成每日签到或上传当天相册照片后，会先获得抽能量次数。'}</small>
          </div>
          <div className="capsule-milestones" aria-label={`能量印章 ${reachedCount} / ${ENERGY_MILESTONES.length}`}>
            {ENERGY_MILESTONES.map(milestone => {
              const lit = energy >= milestone.at
              return (
                <span key={milestone.at} className={`capsule-milestone ${lit ? 'is-lit' : 'is-locked'}`} title={`${milestone.icon} ${milestone.name} · ${milestone.at} 点`}>
                  <b>{milestone.icon}</b>
                  <small>{milestone.name}</small>
                  <em>{milestone.at}</em>
                </span>
              )
            })}
            <i className="capsule-milestone-count">{reachedCount}/{ENERGY_MILESTONES.length} 枚点亮</i>
          </div>
          <div className="capsule-draw-panel">
            <strong>抽能量次数：{drawChances}</strong>
            <button type="button" onClick={drawEnergy} disabled={rolling || drawChances <= 0}>{rolling ? '抽取中…' : '抽取 5-15 点能量'}</button>
            <p aria-live="polite">{status}</p>
            <small className="capsule-auto-refresh-note">已开启自动同步；另一台设备抽完后，这里会自动跟上。</small>
          </div>
          {!!energyState.draws.length && (
            <div className="capsule-draw-history">
              <strong>最近抽取记录</strong>
              <ul>
                {energyState.draws.slice(-5).reverse().map((draw, index) => (
                  <li key={`${draw.at}-${index}`}><span>+{draw.gain} 点</span><time>{formatDrawTime(draw.at)}</time></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function TemplateGuide({ setCurrent }) {
  function startDay5ThemeDemo() {
    const referenceProgress = [1, 2, 3]
    setRoleJson('wwcxrl-signed-days', referenceProgress)
    setRoleJson('wwcxrl-completed-days', referenceProgress)
    saveBackpack({ ...loadBackpack(), matchbox: 1, match: 2, foam_key: 1 })
    removeRoleValue('wwcxrl-day4-dark-maze-state')
    setVoyageThemeLocal(false, 'template-day5-demo-reset', { cloud: false })
    window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    window.dispatchEvent(new Event('wwcxrl-signed-updated'))
    setCurrent('checkin')
  }

  return (
    <section className="content-section template-guide-section">
      <header className="section-heading playful-heading">
        <span>Start here · README in the browser</span>
        <h2>小星球使用说明书</h2>
        <p>先玩完五天样例，再把它改成自己的小星球。这里的每一格都对应仓库中的一个可编辑入口。</p>
      </header>

      <div className="template-guide-hero sticker-card">
        <div className="template-guide-orbit" aria-hidden="true"><span>📘</span><i>✦</i><b>🪐</b></div>
        <div>
          <span className="tiny-label">Five-day runnable reference</span>
          <h3>不用先理解全部 6000 行代码</h3>
          <p>从 <code>src/data/loveData.js</code> 读 Day 01、02、03、05、08 五个参考日；其余日期可以复制一条数据、换成自己的 type 和文案，慢慢长出新的签到格。</p>
          <p className="beginner-ai-note"><strong>完全不会写代码也没关系：</strong>打开 <code>docs/AI_VIBE_CODING.md</code>，把里面“第一条提示”整段交给你常用的 AI；它会先读懂这份项目，再和你讨论你的想法，不必自己先理解代码。</p>
          <div className="template-guide-actions">
            <button type="button" onClick={() => setCurrent('checkin')}>先玩五天样例</button>
            <button type="button" className="ghost" onClick={startDay5ThemeDemo}>⚡ 快速进入 Day 05 演示</button>
            <button type="button" className="ghost" onClick={() => setCurrent('album')}>看看相册模块</button>
          </div>
        </div>
      </div>

      <div className="template-guide-grid">
        <article className="sticker-card template-guide-card">
          <span className="guide-number">01</span>
          <span className="guide-icon">▶️</span>
          <h3>启动样品站</h3>
          <p>macOS 直接双击仓库根目录的 <code>启动本地样品.command</code>。它会安装依赖、打开浏览器并保留终端窗口作为本地服务器。</p>
          <small>命令行替代方式：<code>bash scripts/review-local.sh</code>；它会安装依赖、检查构建并输出可打开的本地链接。</small>
        </article>
        <article className="sticker-card template-guide-card">
          <span className="guide-number">02</span>
          <span className="guide-icon">🗓️</span>
          <h3>从空白日期开始写</h3>
          <p>只需编辑 <code>src/data/loveData.js</code> 的 <code>dailyAdventures</code> 数组。Day 01、02、03、05、08 是参考；其他日期没有预置内容。</p>
          <small>完整步骤在 <code>docs/BUILD_A_NEW_DAY.md</code></small>
        </article>
        <article className="sticker-card template-guide-card">
          <span className="guide-number">03</span>
          <span className="guide-icon">🎨</span>
          <h3>照着 Day 05 学主题切换</h3>
          <p>完成迷宫会播放木门到深空的完整转场；Day 05 页面上的“🚀 直接观看主题切换”按钮可以反复观看同一段转场视频，不需要每次重新走迷宫。</p>
          <small>如果按钮进入完成状态，先点击当天的“重置524”恢复可玩 checkpoint。</small>
        </article>
        <article className="sticker-card template-guide-card">
          <span className="guide-number">04</span>
          <span className="guide-icon">☁️</span>
          <h3>按需开启云端</h3>
          <p>不配置环境变量时，项目只使用浏览器 localStorage。需要多设备同步时，复制 <code>.env.example</code> 为 <code>.env.local</code> 并按 Supabase 文档初始化。</p>
          <small>云端只是可选增强；第一次试玩和本地检查不需要配置它。</small>
        </article>
      </div>

      <section className="template-day1-brief sticker-card" aria-labelledby="template-day1-title">
        <div className="vibe-guide-heading">
          <span className="guide-icon">🕛</span>
          <div>
            <span className="tiny-label">Day 01 · 00:00 午夜谜题</span>
            <h3 id="template-day1-title">用 Day 1 学会做一个完整小闭环</h3>
            <p>目标不是先做复杂动画，而是做出一个能被另一半打开、理解、点击并得到回应的小故事：先显示一段午夜消息，点击聊天小窗中的线索，解开一个文字谜题，成功后出现祝福或下一格入口。</p>
          </div>
        </div>
        <ol className="day1-build-steps">
          <li><strong>故事素材</strong><span>先写清楚这条午夜消息为什么发生、你想让对方先看到什么、哪一句话是只有你们懂的暗号。</span></li>
          <li><strong>交互闭环</strong><span>消息出现 → 点击线索 → 输入或选择答案 → 成功反馈 → 解锁祝福/奖励；失败时也要有温柔提示。</span></li>
          <li><strong>验收标准</strong><span>手机上能点、刷新后状态不乱、答对后只解锁一次、控制台没有错误，第一次打开的人不用看代码也知道下一步。</span></li>
        </ol>
        <div className="vibe-prompt-card">
          <strong>Day 1 可直接复制给 AI 的提示词</strong>
          <pre>{`我想在这个 Vite + React 小星球模板里实现 Day 01“00:00 午夜谜题”。\n故事背景：这是我和另一半之间发生过的真实片段：［在这里写发生了什么、当时的地点/时间、你想保留的原话和只有你们懂的暗号］。\n体验目标：对方打开后先看到一条午夜消息，点击聊天小窗里的线索，完成一个简单文字谜题；答对后显示一段真诚的祝福，并解锁当天签到或下一步。\n请先只读阅读 README.md、docs/、src/data/loveData.js、src/main.jsx、src/styles.css，暂不改文件。\n请用中文输出：1. 当前 Day 01 可复用的组件和状态；2. 2 个不同的交互方案及取舍；3. 需要我补充的故事/文案/素材；4. 最小实现涉及的文件；5. 桌面、手机、刷新、答错和答对的验收清单。\n先和我讨论方案，等我确认后再小步实现。`}</pre>
        </div>
      </section>

      <section className="template-vibe-guide sticker-card" aria-labelledby="vibe-coding-title">
        <div className="vibe-guide-heading">
          <span className="guide-icon">🤖</span>
          <div>
            <span className="tiny-label">Vibe coding · discuss before you ship</span>
            <h3 id="vibe-coding-title">和 AI 一起做出“有灵魂”的小星球</h3>
            <p>不要一上来就让 AI 改整份代码。先让它读项目、复述理解、和你讨论玩法，再让它按已确认的方案小步实现；每一小步都要能运行、可回滚、可验证。</p>
            <p className="storytelling-note"><strong>和 AI 沟通时，准确表达需求很重要；讨论创意时，也不妨像向一个真正的人倾诉故事一样，告诉它创意从哪里来、真实发生在你和另一半之间的什么片段。</strong> 故事本身就是重要素材，可能带来你和 AI 都没有预料到的灵感。真诚才是必杀技。</p>
          </div>
        </div>
        <ol className="vibe-steps">
          <li><strong>① 只读学习</strong><span>让 AI 先阅读 <code>README.md</code>、<code>docs/</code>、<code>src/data/loveData.js</code>、<code>src/main.jsx</code> 与 <code>src/styles.css</code>；先交付功能地图、状态/道具链、可复用组件和风险点，暂不编辑文件。</span></li>
          <li><strong>② 讨论 idea</strong><span>告诉它一个想法，请它给出 2–3 个可选体验方案：用户流程、页面/弹窗、角色动作、状态变化、需要的图片与动画，以及手机端的取舍。你确认一个方案后再继续。</span></li>
          <li><strong>③ 写实施契约</strong><span>要求 AI 列出文件清单、数据结构、组件接口、视觉 token、验收标准与回滚点；复杂改动先写 <code>docs/PLAN.md</code>，不要直接重写 6000 行入口文件。</span></li>
          <li><strong>④ 小步实现与验收</strong><span>一次只完成一个交互闭环：实现 → <code>npm run check</code> → 浏览器自测桌面/手机 → 检查控制台。确认后再进入下一步，最后再审阅 Git diff。</span></li>
        </ol>
        <div className="vibe-prompt-card">
          <strong>可直接复制给 AI 的第一条提示</strong>
          <pre>{`你是这个 Vite + React 小星球项目的协作设计师与工程师。\n第一阶段只读：阅读 README.md、docs/、src/data/loveData.js、src/main.jsx、src/styles.css。\n不要修改文件。请先用中文输出：\n1. 当前功能与五个参考日地图；2. 状态/道具/主题切换链；\n3. 我的 idea 可以放在哪些组件；4. 2–3 个体验方案及取舍；\n5. 最小可验收实现计划、涉及文件、风险和测试方法。\n等我选定方案后，再开始小步实现。`}</pre>
        </div>
      </section>

      <aside className="template-blessing sticker-card">
        <span>✦</span>
        <div>
          <strong>给下一位创作者的小祝福</strong>
          <p>愿你写下的第一格日历，不必完美，但足够真诚；愿这个小星球慢慢长出只属于你的颜色、角色和故事。</p>
        </div>
      </aside>
    </section>
  )
}

function PlanetApp() {
  const [current, setCurrent] = useState('home')
  const [toast, setToast] = useState('')
  const readVoyageTheme = () => {
    try { return localStorage.getItem('wwcxrl-voyage-theme') === 'yes' } catch { return false }
  }
  const [voyageTheme, setVoyageTheme] = useState(readVoyageTheme)
  const setThemeMode = (enabled) => {
    setVoyageThemeLocal(Boolean(enabled), 'manual-toggle', { cloud: true })
    setVoyageTheme(Boolean(enabled))
  }
  React.useEffect(() => {
    let alive = true
    const refresh = () => setVoyageTheme(readVoyageTheme())
    hydrateGlobalCloudState().then(() => { if (alive) refresh() })
    loadCloudBackpack().then(cloudBag => {
      if (!alive || !cloudBag) return
      const next = { ...loadBackpack(), ...(cloudBag || {}) }
      saveBackpack(next)
      window.dispatchEvent(new Event('wwcxrl-backpack-updated'))
    }).catch(error => console.warn('[wwcxrl cloud] app backpack hydrate failed', error.message))
    window.addEventListener('wwcxrl-theme-updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      alive = false
      window.removeEventListener('wwcxrl-theme-updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  React.useEffect(() => {
    let timerId = null
    const showToast = (event) => {
      setToast(event.detail || '小星球收到啦')
      window.clearTimeout(timerId)
      timerId = window.setTimeout(() => setToast(''), 2600)
    }
    const openObservatory = () => {
      setCurrent('telescope')
      setToast('星空观测站已放入顶栏')
      window.clearTimeout(timerId)
      timerId = window.setTimeout(() => setToast(''), 3000)
    }
    window.addEventListener('wwcxrl-soft-toast', showToast)
    window.addEventListener('wwcxrl-open-observatory', openObservatory)
    return () => {
      window.clearTimeout(timerId)
      window.removeEventListener('wwcxrl-soft-toast', showToast)
      window.removeEventListener('wwcxrl-open-observatory', openObservatory)
    }
  }, [])
  const themeSwitchAvailable = (() => {
    try { return voyageTheme || getRoleJson('wwcxrl-completed-days', []).includes(TEMPLATE_THEME_SWITCH_DAY) } catch { return voyageTheme }
  })()
  const [firstGuideOpen, setFirstGuideOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    if (new URLSearchParams(window.location.search).get('showGuide') === '1') return true
    return false
  })
  function dismissFirstGuide() {
    localStorage.setItem('wwcxrl-template-first-guide-seen-v1', 'yes')
    setFirstGuideOpen(false)
  }
  return (
    <main className={voyageTheme ? 'interstellar-voyage-theme' : ''}>
      <StarField />
      <header className="top-bar">
        <button className="brand" onClick={() => setCurrent('home')}><span>🍊</span> 小星球</button>
        <Nav current={current} setCurrent={setCurrent} />
      </header>
      {current === 'home' && <Hero setCurrent={setCurrent} />}
      {current === 'guide' && <TemplateGuide setCurrent={setCurrent} />}
      {current === 'checkin' && <CheckIn />}
      {(current === 'album' || current === 'gallery') && <PhotoWall />}
      {current === 'telescope' && <TelescopeWorkshop />}
      {current === 'backpack' && <BackpackView />}
      {(current === 'capsule' || current === 'secret') && <EnergyCapsule />}
      {firstGuideOpen && <div className="first-run-guide-backdrop" role="presentation">
        <div className="first-run-guide-modal" role="dialog" aria-modal="true" aria-labelledby="first-run-guide-title">
          <button type="button" className="first-run-guide-close" onClick={dismissFirstGuide} aria-label="关闭首次运行说明书">×</button>
          <div className="first-run-guide-welcome"><span>✦</span><div><strong id="first-run-guide-title">欢迎来到小星球</strong><p>这里是我们的纪念日小星球：每天打开一格星图，完成今天的小任务并签到，把 300 天慢慢走到 365 天。</p></div></div>
          <TemplateGuide setCurrent={next => { dismissFirstGuide(); setCurrent(next) }} />
        </div>
      </div>}
      {toast && <div className="wwcxrl-soft-toast" role="status">{toast}</div>}
      <footer className="site-footer">
        {themeSwitchAvailable && <button type="button" className="theme-toggle-button subtle" onClick={() => setThemeMode(!voyageTheme)}>{voyageTheme ? '🍊 切回旧皮肤' : '🚀 切到新皮肤'}</button>}
        <button onClick={returnToInvitationLayer}>回到 8月9日邀请信</button></footer>
    </main>
  )
}

// 管理页本地任务库：未连接云端时也允许完整走“发布→列表可见→编辑/删除”流程。
const ADMIN_LOCAL_TASKS_KEY = 'wwcxrl-admin-local-tasks'

function loadLocalAdminTasks() {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_LOCAL_TASKS_KEY) || '[]')
  } catch {
    return []
  }
}

function saveLocalAdminTasks(list) {
  localStorage.setItem(ADMIN_LOCAL_TASKS_KEY, JSON.stringify(list))
}

// ---- 异地见面日历：下次见面日期 + 已见面的浪漫日子（云端优先，本地兜底） ----
const MEETING_DATES_LOCAL_KEY = 'wwcxrl-meeting-dates'

function loadMeetingDatesLocal() {
  try {
    return JSON.parse(localStorage.getItem(MEETING_DATES_LOCAL_KEY) || 'null')
  } catch {
    return null
  }
}

function saveMeetingDatesLocal(data) {
  localStorage.setItem(MEETING_DATES_LOCAL_KEY, JSON.stringify(data))
}

async function loadMeetingDates() {
  const cloud = cloudEnabled ? await loadCloudMeetingDates() : null
  if (cloud) {
    saveMeetingDatesLocal(cloud)
    return cloud
  }
  return loadMeetingDatesLocal() || { next: '', past: [] }
}

async function saveMeetingDates(data) {
  const normalized = {
    next: String(data.next || ''),
    past: (data.past || [])
      .filter(item => item && (item.start || item.date))
      .map(item => {
        const start = String(item.start || item.date || '')
        const end = String(item.end || item.start || item.date || '')
        return {
          start,
          end: end >= start ? end : start,
          note: String(item.note || '').trim(),
          emoji: String(item.emoji || '💕').trim() || '💕'
        }
      })
  }
  saveMeetingDatesLocal(normalized)
  if (cloudEnabled) {
    const result = await saveCloudMeetingDates(normalized)
    return { ok: Boolean(result?.ok), saved: normalized, error: result?.error || '' }
  }
  return { ok: true, saved: normalized, error: '' }
}

function meetingDaysLeft(dateStr) {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

// 管理端可选的可爱情侣标记图案
const MEETING_EMOJI_PRESETS = ['💗', '💕', '❤️', '🧡', '🌷', '🌸', '🍑', '🦄', '🐻', '🐰', '🍓', '🍰', '🎀', '⭐', '🌈', '🫧', '🥰', '💌']

// 按 Day 自动推算解锁日期：Day 300 = 2026-08-09，之后每天顺延。
function adminDayToDate(day) {
  const base = new Date('2026-08-09T00:00:00')
  base.setDate(base.getDate() + (Number(day) || 300) - 300)
  const yyyy = base.getFullYear()
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// 一键示例：选好类型后点“填入示例”，改一改就能发布。
const ADMIN_TASK_EXAMPLES = {
  memoryPuzzle: {
    title: '第 X 天的小谜语',
    prompt: '还记得我们第一次约会的地方吗？',
    answer: '郑州二砂文化创意园',
    secret: '答对啦，这是属于我们的第 X 天。',
    reward: '打开今天的纪念日签到',
    icon: '🧭'
  },
  letter: {
    title: '第 X 天的一封信',
    prompt: '今天有一封信想给你。',
    secret: '想你的第 X 天，我们慢慢来。',
    reward: '读完这封信，签个到',
    icon: '💌'
  },
  fortune: {
    title: '今日砸金蛋',
    prompt: '点一下金蛋，敲出今天的小惊喜。',
    secret: '🧋 一杯奶茶\n☕ 一杯咖啡\n🍜 点一个好吃的外卖\n🎁 神秘大奖\n🍰 一块小蛋糕',
    reward: '砸开金蛋，签个到',
    icon: '🥚'
  },
  sticker: {
    title: '今日小贴纸',
    prompt: '点一下，揭下今天的贴纸。',
    secret: '留下你今天的心愿吧，我会好好收进小星球。',
    reward: '揭下贴纸，签个到',
    icon: '🏷️'
  },
  game: {
    title: '第 X 天的小游戏',
    prompt: '玩完这个小游戏就能签到啦。',
    secret: '游戏完成！今天也一起加油。',
    reward: '玩完游戏，签个到',
    icon: '🎮'
  }
}

function emptyAdminTask(day = 301) {
  return {
    day,
    date: adminDayToDate(day),
    title: '',
    icon: '✨',
    type: 'memoryPuzzle',
    theme: '',
    reward: '',
    prompt: '',
    secret: '',
    answer: '',
    image: '',
    memoryTitle: '',
    memoryCaption: '',
    chat: '',
    gameId: 'mazeClassic',
    gameConfig: {},
    status: 'published'
  }
}

function parseAdminChatLines(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    let side = 'me'
    let body = line
    if (/^(小琳|她|her)[:：]\s*/.test(line)) {
      side = 'her'
      body = line.replace(/^(小琳|她|her)[:：]\s*/, '')
    } else if (/^(小琛|我|me)[:：]\s*/.test(line)) {
      side = 'me'
      body = line.replace(/^(小琛|我|me)[:：]\s*/, '')
    }
    return { side, text: body }
  })
}

function AdminTaskPage() {
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && sessionStorage.getItem('wwcxrl-admin-ok') === '1')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState(emptyAdminTask)
  const [editingDay, setEditingDay] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [missingFields, setMissingFields] = useState([])
  const [dateAuto, setDateAuto] = useState(true)
  const [toast, setToast] = useState('')
  const [meetingNext, setMeetingNext] = useState('')
  const [meetingPast, setMeetingPast] = useState([])
  const [meetingLoaded, setMeetingLoaded] = useState(false)
  const [meetingSaving, setMeetingSaving] = useState(false)
  const [emojiOpenIndex, setEmojiOpenIndex] = useState(null)
  const todayKey = getTodayKey()

  // 异地见面日历：载入云端/本地已有设置
  React.useEffect(() => {
    let alive = true
    loadMeetingDates().then(value => {
      if (!alive || !value) return
      setMeetingNext(value.next || '')
      setMeetingPast(Array.isArray(value.past) ? value.past : [])
      setMeetingLoaded(true)
    })
    return () => { alive = false }
  }, [])

  // 点击页面其他位置时收起展开中的 emoji 面板
  React.useEffect(() => {
    if (emojiOpenIndex === null) return
    const closeOnOutside = event => {
      if (!event.target.closest('.admin-meeting-emoji-area')) setEmojiOpenIndex(null)
    }
    document.addEventListener('click', closeOnOutside)
    return () => document.removeEventListener('click', closeOnOutside)
  }, [emojiOpenIndex])

  function addMeetingPastRow() {
    setMeetingPast(prev => [...prev, { start: '', end: '', note: '', emoji: '💗' }])
  }

  function updateMeetingPastRow(index, patch) {
    setMeetingPast(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function removeMeetingPastRow(index) {
    setMeetingPast(prev => prev.filter((_, i) => i !== index))
  }

  async function saveMeetingDatesSettings() {
    setMeetingSaving(true)
    const result = await saveMeetingDates({ next: meetingNext, past: meetingPast })
    setMeetingSaving(false)
    setToast(result?.ok
      ? (cloudEnabled ? '见面日历已保存并同步到云端，两台设备都能看到。' : '见面日历已保存（本地模式，未连接云端）。')
      : `保存失败：${result?.error || '请稍后再试。'}（若提示表/列不存在，请在 Supabase 执行见面日历建表 SQL）`)
  }

  const refresh = React.useCallback(async () => {
    setLoading(true)
    const cloud = await loadCloudDailyTasks()
    const cloudRows = (cloud || []).map(task => ({ ...task, source: 'cloud' }))
    const localRows = loadLocalAdminTasks().map(task => ({ ...task, source: 'local' }))
    const merged = new Map()
    cloudRows.forEach(row => merged.set(Number(row.day), row))
    localRows.forEach(row => { if (!merged.has(Number(row.day))) merged.set(Number(row.day), row) })
    setTasks(Array.from(merged.values()).sort((a, b) => Number(a.day) - Number(b.day)))
    setLoading(false)
  }, [])

  React.useEffect(() => {
    if (ok) refresh()
  }, [ok, refresh])

  const codeRows = dailyAdventures.map(item => ({ ...item, source: 'code', status: 'builtin' }))
  const allRowsMap = new Map()
  codeRows.forEach(row => allRowsMap.set(Number(row.day), row))
  tasks.forEach(row => allRowsMap.set(Number(row.day), row))
  const allRows = Array.from(allRowsMap.values()).sort((a, b) => Number(a.day) - Number(b.day))
  const usedDays = new Set(allRows.map(row => Number(row.day)))
  let nextFreeDay = 301
  while (usedDays.has(nextFreeDay)) nextFreeDay += 1
  function nextFreeAdminDay(fromDay) {
    const used = new Set(allRows.map(row => Number(row.day)))
    let day = Math.max(301, Number(fromDay) + 1)
    while (used.has(day)) day += 1
    return day
  }

  React.useEffect(() => {
    if (!toast) return
    const timerId = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timerId)
  }, [toast])

  // 新建模式且表单仍为空时，自动跳到下一个空闲 Day
  React.useEffect(() => {
    if (editingDay) return
    if (draft.title || draft.prompt || draft.answer || draft.secret) return
    if (usedDays.has(Number(draft.day))) {
      setDraft(emptyAdminTask(nextFreeDay))
    }
  }, [tasks, editingDay, draft.day])

  if (!ok) {
    return (
      <main className="admin-page admin-login">
        <form className="admin-login-card sticker-card" onSubmit={event => {
          event.preventDefault()
          if (password === ADMIN_PASSWORD) {
            sessionStorage.setItem('wwcxrl-admin-ok', '1')
            setOk(true)
          } else {
            setPasswordError('密码不对哦')
          }
        }}>
          <h1>🔐 任务管理</h1>
          <p>这里是只有小琛能进的任务布置页。</p>
          <label>管理密码
            <input type="password" value={password} onChange={event => { setPassword(event.target.value); setPasswordError('') }} placeholder="输入管理密码" autoFocus />
          </label>
          {passwordError && <p className="admin-error">{passwordError}</p>}
          <button type="submit" className="admin-save-publish">进入管理页</button>
        </form>
      </main>
    )
  }

  function save(status) {
    const missing = []
    if (!draft.day) missing.push('天数')
    if (!draft.date) missing.push('日期')
    if (!draft.title.trim()) missing.push('标题')
    if (draft.type === 'memoryPuzzle' && !draft.answer.trim()) missing.push('谜底答案')
    if (draft.type === 'letter' && !draft.secret.trim()) missing.push('信的内容')
    if (missing.length) {
      setMissingFields(missing)
      setToast(`还差：${missing.join('、')}，填一下就能发布啦`)
      return
    }
    setMissingFields([])
    const payload = {
      day: Number(draft.day),
      date: draft.date,
      title: draft.title,
      icon: draft.icon || '✨',
      type: draft.type,
      theme: draft.theme,
      reward: draft.reward,
      prompt: draft.prompt,
      secret: draft.secret,
      answer: draft.answer,
      image: draft.image,
      memoryTitle: draft.memoryTitle,
      memoryCaption: draft.memoryCaption,
      chatMessages: parseAdminChatLines(draft.chat),
      gameId: draft.gameId,
      gameConfig: draft.gameConfig || {},
      status
    }
    if (!cloudEnabled) {
      const localList = loadLocalAdminTasks().filter(task => Number(task.day) !== Number(payload.day))
      localList.push(payload)
      saveLocalAdminTasks(localList)
      setToast(status === 'published' ? `Day ${draft.day} 已发布（本地模式，未连接云端）` : `Day ${draft.day} 已存为草稿（本地）`)
      setEditingDay(null)
      setDraft(emptyAdminTask(nextFreeAdminDay(Number(draft.day))))
      refresh()
      return
    }
    setSaving(true)
    saveCloudDailyTask(payload).then(okSave => {
      setSaving(false)
      if (okSave) {
        setToast(status === 'published' ? `Day ${draft.day} 已发布` : `Day ${draft.day} 已存为草稿`)
        setEditingDay(null)
        setDraft(emptyAdminTask(nextFreeAdminDay(Number(draft.day))))
        refresh()
      } else {
        setToast('保存失败：云端写入被拒绝，请查看浏览器控制台')
      }
    })
  }  async function handleImageFile(event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    if (!draft.day) { setToast('请先填写天数 Day，再上传配图'); return }
    setUploadingImage(true)
    setToast('配图上传中…')
    const url = await uploadCloudTaskImage(file, draft.day)
    setUploadingImage(false)
    if (url) {
      setDraft(previous => ({ ...previous, image: url }))
      setToast('配图已上传，发布后她即可看到。')
    } else {
      setToast('配图上传失败：云端未连接或存储不可用，可改用图片链接。')
    }
  }


  function remove(row) {
    if (!window.confirm(`确认删除 Day ${row.day}？删除后不可恢复。`)) return
    if (row.source === 'local') {
      const localList = loadLocalAdminTasks().filter(task => Number(task.day) !== Number(row.day))
      saveLocalAdminTasks(localList)
      setToast(`Day ${row.day} 已删除（本地）`)
      if (editingDay === row.day) {
        setEditingDay(null)
        setDraft(emptyAdminTask(nextFreeAdminDay(Number(draft.day))))
      }
      refresh()
      return
    }
    deleteCloudDailyTask(row.day).then(okDel => {
      setToast(okDel ? `Day ${row.day} 已删除` : '删除失败，请查看控制台')
      if (okDel && editingDay === row.day) {
        setEditingDay(null)
        setDraft(emptyAdminTask(nextFreeAdminDay(Number(draft.day))))
      }
      refresh()
    })
  }

  function editTask(row) {
    setEditingDay(row.day)
    setDraft({
      day: row.day,
      date: row.date || adminDayToDate(row.day),
      title: row.title || '',
      icon: row.icon || '✨',
      type: row.type || 'memoryPuzzle',
      theme: row.theme || '',
      reward: row.reward || '',
      prompt: row.prompt || '',
      secret: row.secret || '',
      answer: row.answer || '',
      image: row.image || '',
      memoryTitle: row.memoryTitle || '',
      memoryCaption: row.memoryCaption || '',
      gameId: row.gameId || 'mazeClassic',
      gameConfig: { ...getMiniGameDefaults(row.gameId || 'mazeClassic'), ...(row.gameConfig || {}) },
      chat: Array.isArray(row.chatMessages)
        ? row.chatMessages.map(msg => `${msg.side === 'her' ? '小琳' : '小琛'}：${msg.text}`).join('\n')
        : '',
      status: row.status === 'draft' ? 'draft' : 'published'
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function statusLabel(row) {
    if (row.source === 'code') return '内置'
    if (row.source === 'local') return row.status === 'draft' ? '本地草稿' : '本地已发布'
    if (row.status === 'draft') return '草稿'
    return row.date < todayKey ? '已过期' : '已发布'
  }

  function fillExample() {
    const example = ADMIN_TASK_EXAMPLES[draft.type]
    if (!example) return
    const day = draft.day || 301
    const withDay = value => String(value || '').replace('X', day)
    setDraft(prev => ({
      ...prev,
      title: withDay(example.title),
      prompt: withDay(example.prompt),
      answer: withDay(example.answer),
      secret: withDay(example.secret),
      reward: withDay(example.reward),
      icon: example.icon
    }))
    setToast('已填入示例，改一改就能发布啦')
  }

  const activeTypeHint = ADMIN_TASK_TYPES.find(type => type.id === draft.type)
  const secretLabel = ({ letter: '信的内容（她拆开后看到）', sticker: '她写心愿时看到的引导语（选填）', fortune: '奖品池（每行一个，不填用默认：奶茶 / 咖啡 / 外卖 / 神秘大奖 / 蛋糕）', game: '完成后的祝贺语（可选）', memoryPuzzle: '答对后显示的话（可选）' })[draft.type] || '完成后显示的内容'
  const secretPlaceholder = draft.type === 'fortune' ? '每行一个奖品，例如：\n🧋 一杯奶茶\n🎁 神秘大奖' : draft.type === 'sticker' ? '写下你今天的心愿吧，我会好好收进小星球。' : '完成后显示的一段话'
  const activeGame = draft.type === 'game' ? MINI_GAMES.find(game => game.id === draft.gameId) || MINI_GAMES[0] : null

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <h1>🍊 小星球任务管理</h1>
          <p>发布后她打开网站即可看到；任务按日期自动解锁，不用重新部署。</p>
        </div>
        {cloudEnabled
          ? <p className="admin-cloud-note is-cloud">☁️ 云端已连接，任务、签到与见面日历会自动同步。</p>
          : <p className="admin-cloud-note">本地预览模式：数据仅保存在本机，配置 Supabase 环境变量后自动切换为云端同步。</p>}
        <button type="button" className="admin-logout" onClick={() => { sessionStorage.removeItem('wwcxrl-admin-ok'); setOk(false) }}>退出管理</button>
      </header>

      <section className="admin-task-form sticker-card">
        <h2>{editingDay ? `编辑 Day ${editingDay}` : '新建任务'}</h2>
        <div className="admin-form-grid">
          <label className={missingFields.includes('天数') || missingFields.includes('日期') ? 'admin-field-missing' : ''}>天数 Day
            <input type="number" min="1" max="999" value={draft.day} onChange={event => {
              const day = Number(event.target.value)
              const next = { ...draft, day }
              if (dateAuto) next.date = adminDayToDate(day)
              setDraft(next)
              setMissingFields([])
            }} />
          </label>
          <label className={missingFields.includes('日期') ? 'admin-field-missing' : ''}>日期（自动解锁日）
            <span className="admin-date-row">
              <input type="date" value={draft.date} onChange={event => { setDateAuto(false); setDraft({ ...draft, date: event.target.value }); setMissingFields([]) }} />
              <button type="button" className="admin-date-auto" title="按 Day 自动推算日期" onClick={() => { setDateAuto(true); setDraft({ ...draft, date: adminDayToDate(draft.day) }); setMissingFields([]) }}>↻ 自动</button>
            </span>
          </label>
          <label className={missingFields.includes('标题') ? 'admin-field-missing' : ''}>标题
            <input value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); setMissingFields([]) }} placeholder="例如：第 301 天的小谜语" />
          </label>
          <label>任务类型
            <span className="admin-type-row">
              <select value={draft.type} onChange={event => {
                const type = event.target.value
                const next = { ...draft, type }
                if (type === 'game' && !draft.gameId) next.gameId = 'mazeClassic'
                if (type === 'game' && !draft.gameConfig) next.gameConfig = { ...getMiniGameDefaults(draft.gameId || 'mazeClassic') }
                setDraft(next)
                setMissingFields([])
              }}>
                {ADMIN_TASK_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
              <button type="button" className="admin-example-btn" onClick={fillExample}>✨ 填入示例</button>
            </span>
          </label>
          {draft.type === 'game' && activeGame && (
            <>
              <label>小游戏
                <select value={draft.gameId} onChange={event => {
                  const gameId = event.target.value
                  setDraft({ ...draft, gameId, gameConfig: { ...getMiniGameDefaults(gameId) } })
                }}>
                  {MINI_GAMES.map(game => <option key={game.id} value={game.id}>{game.icon} {game.label}</option>)}
                </select>
              </label>
              {activeGame.fields.map(field => (
                <label key={field.key}>{field.label}
                  {field.type === 'number' ? (
                    <input type="number" min={field.min} max={field.max} value={draft.gameConfig?.[field.key] ?? activeGame.defaults[field.key]} onChange={event => setDraft({ ...draft, gameConfig: { ...draft.gameConfig, [field.key]: Number(event.target.value) } })} />
                  ) : (
                    <select value={String(draft.gameConfig?.[field.key] ?? activeGame.defaults[field.key])} onChange={event => setDraft({ ...draft, gameConfig: { ...draft.gameConfig, [field.key]: event.target.value } })}>
                      {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  )}
                </label>
              ))}
            </>
          )}
        </div>
        <label className="admin-full">任务说明（她看到的第一段话，选填）
          <textarea value={draft.prompt} onChange={event => { setDraft({ ...draft, prompt: event.target.value }); setMissingFields([]) }} rows={2} placeholder="今天的小任务是什么？" />
        </label>
        {draft.type === 'memoryPuzzle' && (
          <label className={`admin-full${missingFields.includes('谜底答案') ? ' admin-field-missing' : ''}`}>谜底答案（她答对后才能签到）
            <input value={draft.answer} onChange={event => { setDraft({ ...draft, answer: event.target.value }); setMissingFields([]) }} placeholder="例如：郑州二砂文化创意园" />
          </label>
        )}
        <label className={`admin-full${missingFields.includes('完成后显示的内容') ? ' admin-field-missing' : ''}`}>{secretLabel}
          <textarea value={draft.secret} onChange={event => { setDraft({ ...draft, secret: event.target.value }); setMissingFields([]) }} rows={draft.type === 'fortune' ? 4 : 2} placeholder={secretPlaceholder} />
        </label>
        <label className="admin-full">配图（可选：谜语/信/贴纸顶部图片，支持上传）
          <input value={draft.image} onChange={event => setDraft({ ...draft, image: event.target.value })} placeholder="/images/xxx.jpg 或 https://…" />
          <span className="admin-image-upload-row">
            <input type="file" accept="image/*" onChange={handleImageFile} disabled={uploadingImage || !draft.day} />
            <small>{uploadingImage ? '上传中…' : '选择图片后自动上传到云端'}</small>
          </span>
          {draft.image && <img className="admin-image-preview" src={draft.image} alt="配图预览" />}
        </label>
        <details className="admin-advanced">
          <summary>高级选项（选填）</summary>
          <div className="admin-form-grid">
            <label>图标（emoji）
              <input value={draft.icon} onChange={event => setDraft({ ...draft, icon: event.target.value })} placeholder="✨" />
            </label>
            <label>主题（谜底提示 / 副标题）
              <input value={draft.theme} onChange={event => setDraft({ ...draft, theme: event.target.value })} placeholder="例如：我们第一次一起散步的地方" />
            </label>
            <label>奖励（显示在标题下方）
              <input value={draft.reward} onChange={event => setDraft({ ...draft, reward: event.target.value })} placeholder="例如：打开今天的纪念日签到" />
            </label>
          </div>
          {draft.type === 'memoryPuzzle' && (
            <>
              <label className="admin-full">聊天台词（可选，每行一条，前缀“小琛：/小琳：”）
                <textarea value={draft.chat} onChange={event => setDraft({ ...draft, chat: event.target.value })} rows={4} placeholder={'小琛：还记得那天吗？\n小琳：记得呀。'} />
              </label>
              <div className="admin-form-grid">
                <label>回忆标题（聊天框标题）
                  <input value={draft.memoryTitle} onChange={event => setDraft({ ...draft, memoryTitle: event.target.value })} placeholder="例如：第一次散步记忆" />
                </label>
                <label>回忆说明（选填）
                  <input value={draft.memoryCaption} onChange={event => setDraft({ ...draft, memoryCaption: event.target.value })} placeholder="选填" />
                </label>
              </div>
            </>
          )}
        </details>
{activeTypeHint && <p className="admin-type-hint">💡 {activeTypeHint.hint}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-save-draft" disabled={saving} onClick={() => save('draft')}>{saving ? '保存中…' : '存为草稿'}</button>
          <button type="button" className="admin-save-publish" disabled={saving} onClick={() => save('published')}>{saving ? '保存中…' : '发布任务'}</button>
          {editingDay && <button type="button" className="admin-cancel" onClick={() => { setEditingDay(null); setDraft(emptyAdminTask(nextFreeAdminDay(Number(draft.day)))) }}>取消编辑</button>}
        </div>
      </section>

      <section className="admin-task-preview sticker-card">
        <h2>预览卡片</h2>
        <div className="admin-preview-card">
          <div className="admin-preview-icon">{draft.icon || '✨'}</div>
          <div>
            <div className="tiny-label">Day {String(draft.day || '').padStart(2, '0')} · {draft.date || '未设置日期'}</div>
            <h3>{draft.title || '未命名任务'}</h3>
            <p>{draft.type === 'memoryPuzzle' && draft.theme ? `谜底：${draft.theme}` : draft.reward}</p>
            {draft.type === 'game' && activeGame && (
              <p className="admin-preview-prompt">🎮 {activeGame.icon} {activeGame.label} · {activeGame.fields.map(field => `${field.label}：${draft.gameConfig?.[field.key] ?? activeGame.defaults[field.key]}`).join(' · ')}</p>
            )}
            {draft.prompt && <p className="admin-preview-prompt">{draft.prompt}</p>}
          </div>
        </div>
      </section>

      <section className="admin-task-list sticker-card">
        <h2>任务列表（{allRows.length}）</h2>
        {loading ? <p>加载中…</p> : allRows.length === 0 ? <p>还没有任务。</p> : (
          <div className="admin-table-wrap">
            <table className="admin-task-table">
              <thead>
                <tr><th>Day</th><th>日期</th><th>标题</th><th>类型</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                {allRows.map(row => (
                  <tr key={`${row.source}-${row.day}`}>
                    <td>{row.day}</td>
                    <td>{row.date}</td>
                    <td>{row.icon} {row.title}</td>
                    <td>{ADMIN_TASK_TYPES.find(type => type.id === row.type)?.label || row.type}</td>
                    <td><span className={`admin-status admin-status-${row.source === 'code' ? 'builtin' : row.status}`}>{statusLabel(row)}</span></td>
                    <td>
                      <button type="button" className="admin-row-edit" onClick={() => editTask(row)}>编辑</button>
                      {row.source !== 'code' && <button type="button" className="admin-row-delete" onClick={() => remove(row)}>删除</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-meeting-dates sticker-card">
        <h2>💌 异地见面日历</h2>
        <p className="admin-meeting-desc">设置下次见面的日子，以及过去已经见面的浪漫时间段。小琳打开彩蛋页就能看到倒计时和带标记的小日历。</p>

        <div className="admin-meeting-block">
          <h3>📅 下次见面（单日倒计时）</h3>
          <div className="admin-meeting-next">
            <input type="date" value={meetingNext} onChange={event => setMeetingNext(event.target.value)} aria-label="下次见面日期" />
            <small>彩蛋页会显示「距离下次见面还有 X 天」并圈出这一天</small>
          </div>
        </div>

        <div className="admin-meeting-block">
          <h3>💌 已见面的浪漫日子</h3>
          {meetingPast.length === 0 && <p className="admin-meeting-empty">还没有记录，添加一段属于你们的见面时间吧。</p>}
          {meetingPast.map((item, index) => {
            const start = item.start || item.date || ''
            const end = item.end || start
            const previewDate = start === end ? start.replace(/-/g, '.') : `${start.replace(/-/g, '.')} - ${end.replace(/-/g, '.')}`
            return (
              <div className="admin-meeting-past-row" key={`${start || 'new'}-${index}`}>
                <div className="admin-meeting-range">
                  <label>从
                    <input type="date" value={start} onChange={event => updateMeetingPastRow(index, { start: event.target.value })} aria-label="见面开始日期" />
                  </label>
                  <label>到
                    <input type="date" value={end} onChange={event => updateMeetingPastRow(index, { end: event.target.value })} aria-label="见面结束日期" />
                  </label>
                  <button type="button" className="admin-row-delete" onClick={() => removeMeetingPastRow(index)}>删除</button>
                </div>
                <div className="admin-meeting-emoji-area">
                  <div className="admin-meeting-emoji-row">
                    <span className="admin-meeting-emoji-label">标记图案</span>
                    <button
                      type="button"
                      className={`admin-meeting-emoji-trigger ${emojiOpenIndex === index ? 'is-open' : ''}`}
                      onClick={event => { event.stopPropagation(); setEmojiOpenIndex(prev => (prev === index ? null : index)) }}
                      aria-expanded={emojiOpenIndex === index}
                      aria-label="选择标记图案"
                    >
                      <span>{item.emoji || '💗'}</span>
                      <i>▾</i>
                    </button>
                  </div>
                  {emojiOpenIndex === index && (
                    <div className="admin-meeting-emoji-palette">
                      {MEETING_EMOJI_PRESETS.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          className={`admin-meeting-emoji-option ${(item.emoji || '💗') === emoji ? 'is-selected' : ''}`}
                          onClick={() => { updateMeetingPastRow(index, { emoji }); setEmojiOpenIndex(null) }}
                          aria-label={`选择标记 ${emoji}`}
                        >{emoji}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="admin-meeting-note-row">
                  <input className="admin-meeting-note" value={item.note || ''} placeholder="备注，如：郑州·二砂文创园（可选）" onChange={event => updateMeetingPastRow(index, { note: event.target.value })} aria-label="备注" />
                  <span className="admin-meeting-preview">{item.emoji || '💗'} {previewDate}{item.note ? ` · ${item.note}` : ''}</span>
                </div>
              </div>
            )
          })}
          <button type="button" className="admin-meeting-add" onClick={addMeetingPastRow}>＋ 添加一段见面时间</button>
        </div>

        <div className="admin-actions admin-meeting-actions">
          <button type="button" className="admin-save-publish" disabled={meetingSaving} onClick={saveMeetingDatesSettings}>
            {meetingSaving ? '保存中…' : '保存见面日历'}
          </button>
          {meetingLoaded && !meetingSaving && <small>保存后，小琳的设备下次打开彩蛋页即可看到。</small>}
        </div>
      </section>

      {toast && <div className="wwcxrl-soft-toast admin-toast" role="status">{toast}</div>}
    </main>
  )
}


function App() {
  if (isAdminPageRequested()) return <AdminTaskPage />
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    if (params.get('ownerDevice') === '1' || params.get('owner') === '1') {
      localStorage.setItem('wwcxrl-owner-device', 'yes')
      params.delete('ownerDevice')
      params.delete('owner')
      const query = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    }
  }
  resetSiteLocalStateOnceForCurrentBuild()
  resetDay2OnceForCurrentBuild()
  resetDay3OnceForCurrentBuild()
  resetDay4OnceForCurrentBuild()
  resetTelescopeChainOnceForCurrentBuild()
  resetDay8OnceForCurrentBuild()
  resetDay9OnceForCurrentBuild()
  resetChildrenSpecialOnceForCurrentBuild()
  resetSleepLabOnceForCurrentBuild()
  applyTemplateFiveDayStateOnce()
  const localDevBypass = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get('planet') === '1'
  const globalState = typeof window !== 'undefined' ? loadGlobalLocalState() : GLOBAL_EMPTY_STATE
  const invitationViewRequested = typeof window !== 'undefined'
    && sessionStorage.getItem('wwcxrl-invitation-view-requested') === 'yes'
  const initiallyOpen = typeof window !== 'undefined'
    && !invitationViewRequested
    && (localDevBypass || localStorage.getItem('wwcxrl-camouflage-opened') === 'yes' || localStorage.getItem('wwcxrl-planet-unlocked') === 'yes' || globalState.planetUnlocked || globalState.invitationOpened)
  const [open, setOpen] = useState(initiallyOpen)
  React.useEffect(() => {
    if (open) return
    let alive = true
    hydrateGlobalCloudState().then(next => {
      if (!alive) return
      // 用户主动点击「邀请信」回看时，停留在邀请信界面，不自动跳回主页。
      if (sessionStorage.getItem('wwcxrl-invitation-view-requested') === 'yes') return
      if (next?.planetUnlocked || next?.invitationOpened) setOpen(true)
    })
    return () => { alive = false }
  }, [open])
  if (!open) return <InvitationLayer onReveal={() => setOpen(true)} />
  return <PlanetApp />
}

createRoot(document.getElementById('root')).render(<App />)

