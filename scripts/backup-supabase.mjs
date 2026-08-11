#!/usr/bin/env node
// ============================================================
// 备份 Supabase 数据（只读，不影响线上数据）
// 用法：
//   PowerShell: $env:SUPABASE_URL='https://xxx.supabase.co'; $env:SUPABASE_PUBLISHABLE_KEY='eyJ...'; node scripts/backup-supabase.mjs
//   也可以直接复用 Vite 的环境变量名（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY）。
// 输出：./backups/supabase-<日期>-<时间戳>/ 下的 JSON 文件（每张表一个 + 存储桶对象清单）。
// 注意：请勿把 .env 或生成出来的 backups/ 目录提交到 GitHub。
// ============================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('请先设置环境变量 SUPABASE_URL 和 SUPABASE_PUBLISHABLE_KEY（或 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY）')
  process.exit(1)
}

const TABLES = [
  'wwcxrl_profiles',
  'wwcxrl_checkins',
  'wwcxrl_day_progress',
  'wwcxrl_backpack_items',
  'wwcxrl_photo_wall',
  'wwcxrl_energy_events',
  'wwcxrl_activity_logs',
  'wwcxrl_daily_tasks',
  'wwcxrl_wishes',
  'wwcxrl_meeting_dates'
]

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
})

const stamp = `${new Date().toISOString().slice(0, 10)}-${Date.now()}`
const outDir = path.join(process.cwd(), 'backups', `supabase-${stamp}`)
fs.mkdirSync(outDir, { recursive: true })
console.log(`备份目录：${outDir}\n`)

const summary = {}

for (const table of TABLES) {
  try {
    const { data, error } = await supabase.from(table).select('*')
    if (error) {
      console.warn(`[跳过] ${table}：${error.message}`)
      summary[table] = { status: 'skipped', reason: error.message }
      continue
    }
    const rows = data || []
    fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 2))
    console.log(`[OK]   ${table}：${rows.length} 行`)
    summary[table] = { status: 'ok', rows: rows.length }
  } catch (error) {
    console.warn(`[跳过] ${table}：${error.message}`)
    summary[table] = { status: 'error', reason: error.message }
  }
}

// 存储桶对象清单（照片等文件本身请按需在 Dashboard -> Storage 里确认；这里记录元数据）
try {
  const { data: buckets } = await supabase.storage.listBuckets()
  const bucketInfo = []
  for (const bucket of buckets || []) {
    const { data: files, error } = await supabase.storage.from(bucket.name).list('', { limit: 10000 })
    if (error) {
      bucketInfo.push({ bucket: bucket.name, error: error.message })
      continue
    }
    bucketInfo.push({
      bucket: bucket.name,
      fileCount: (files || []).length,
      totalBytes: (files || []).reduce((sum, file) => sum + Number(file.metadata?.size || 0), 0)
    })
  }
  fs.writeFileSync(path.join(outDir, 'storage-buckets.json'), JSON.stringify(bucketInfo, null, 2))
  console.log('\n[OK]   storage-buckets.json（对象数量/体积）')
  summary.storage = bucketInfo
} catch (error) {
  console.warn(`[跳过] storage：${error.message}`)
  summary.storage = { status: 'error', reason: error.message }
}

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('\n完成 ✅ 请保留 backups/ 目录作为本地快照。')
