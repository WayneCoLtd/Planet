// 服务端专用的 Supabase 客户端（带 service_role 密钥）。
//
// service_role 会绕过所有 RLS，权限极大，所以：
//   * 只在这里使用，永远不下发到浏览器；
//   * 对应的环境变量名不带 VITE_ 前缀，因此不会被打包进前端；
//   * 音乐桶是私有桶、且没有任何匿名策略，只有这个客户端能读写。
import { createClient } from '@supabase/supabase-js'

// 项目地址本来就是公开的（打包在网页里），这里给个兜底，少一个配置出错的可能。
const FALLBACK_URL = 'https://johtzljxyzcbijlniipc.supabase.co'

export const MUSIC_BUCKET = 'wwcxrl-music'

let cached = null

export function getServiceRoleKey() {
  // WWCXRL_SERVICE_ROLE_KEY 是给「不想去动旧变量」准备的备用名：
  // Vercel 里敏感变量的编辑入口不好找时，直接新增这一条即可，代码会优先用它。
  return String(process.env.WWCXRL_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
}

export function isAdminConfigured() {
  return Boolean(getServiceRoleKey())
}

function resolveSupabaseUrl() {
  // 顺序很关键：优先用 VITE_SUPABASE_URL —— 那是网页端正在用、且已被证明可用的项目地址。
  // 如果把 SUPABASE_URL 放在前面，一个历史遗留的旧项目地址就会把服务端引到不存在的域上
  // （本项目就踩过：旧地址导致服务端所有请求 fetch failed）。
  return String(process.env.VITE_SUPABASE_URL || FALLBACK_URL).replace(/\/+$/, '')
}

// 诊断用：只返回主机名（它本来就公开在网页源码里），用来排查连不上的原因。
// 出问题时能一眼看出是「地址不对」还是「网络不通」。
export function getSupabaseTargetInfo() {
  const raw = resolveSupabaseUrl()
  const source = process.env.VITE_SUPABASE_URL ? 'VITE_SUPABASE_URL' : '(内置默认值)'
  // 如果环境里还躺着一个不一致的 SUPABASE_URL，只回报它的主机名，提示去清理。
  let ignoredHost = null
  const legacy = String(process.env.SUPABASE_URL || '').trim()
  if (legacy && legacy !== String(process.env.VITE_SUPABASE_URL || '').trim()) {
    try {
      ignoredHost = new URL(legacy.replace(/\/+$/, '')).host
    } catch {
      ignoredHost = '(无法解析)'
    }
  }
  try {
    return { host: new URL(raw).host, source, ignoredSupabaseHost: ignoredHost }
  } catch {
    return { host: '(地址无法解析)', source }
  }
}

// 诊断用：只看密钥的「形态」和归属，绝不回显密钥本身。
// Supabase 的服务端密钥是一个 JWT，载荷里带着 ref（项目编号）和 role，都是本来就公开的信息。
export function getServiceKeyInfo() {
  const key = getServiceRoleKey()
  if (!key) return { present: false }
  const envName = String(process.env.WWCXRL_SERVICE_ROLE_KEY || '').trim()
    ? 'WWCXRL_SERVICE_ROLE_KEY'
    : 'SUPABASE_SERVICE_ROLE_KEY'
  const info = { present: true, envName, length: key.length, shape: '未知形式' }
  if (key.startsWith('sb_secret_')) {
    info.shape = 'sb_secret_（新版服务端密钥）'
  } else if (key.startsWith('sb_publishable_')) {
    info.shape = 'sb_publishable_（这是公开密钥，不能当服务端密钥用）'
  } else if (key.startsWith('eyJ')) {
    info.shape = 'JWT'
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8'))
      info.jwtRef = payload.ref || null
      info.jwtRole = payload.role || null
    } catch {
      info.jwtRef = '(载荷无法解析，密钥可能被截断)'
    }
  } else {
    info.shape = '未知形式（开头是：' + key.slice(0, 3) + '***）'
  }
  return info
}

// 配置自检：密钥有没有配、以及它是不是【当前这个项目】的密钥。
// 踩过的坑：环境里留着一套旧项目的 SUPABASE_URL + service_role 密钥，
// 表现是「Invalid API key」，很容易误以为是密钥填错了，其实是配错了项目。
export function checkServiceConfig() {
  if (!getServiceRoleKey()) {
    return { ok: false, reason: 'missing' }
  }
  const { host } = getSupabaseTargetInfo()
  const { jwtRef } = getServiceKeyInfo()
  // JWT 里的 ref 就是项目编号，正常应该等于主机名的第一段。
  if (jwtRef && host && !host.startsWith(`${jwtRef}.`)) {
    return { ok: false, reason: 'mismatch', keyRef: jwtRef, host }
  }
  return { ok: true }
}

export function getAdminClient() {
  const key = getServiceRoleKey()
  if (!key) return null
  if (!cached) {
    cached = createClient(resolveSupabaseUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return cached
}
