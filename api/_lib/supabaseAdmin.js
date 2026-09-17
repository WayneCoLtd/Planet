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
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
}

export function isAdminConfigured() {
  return Boolean(getServiceRoleKey())
}

export function getAdminClient() {
  const key = getServiceRoleKey()
  if (!key) return null
  if (!cached) {
    const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || FALLBACK_URL).replace(/\/+$/, '')
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return cached
}
