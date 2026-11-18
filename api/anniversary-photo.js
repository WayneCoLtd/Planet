import { LEVEL_SITE, isGateEnabled, readLevel } from './_lib/session.js'
import { checkServiceConfig, getAdminClient } from './_lib/supabaseAdmin.js'

const BUCKET = 'wwcxrl-journal'
const PHOTO_PATH = 'anniversary/365.jpg'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!isGateEnabled() || readLevel(req) < LEVEL_SITE) return res.status(401).end()
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).end()
  }
  if (!checkServiceConfig().ok) return res.status(503).end()
  try {
    const { data, error } = await getAdminClient().storage.from(BUCKET).download(PHOTO_PATH)
    if (error || !data) return res.status(502).end()
    const bytes = Buffer.from(await data.arrayBuffer())
    res.setHeader('Content-Type', 'image/jpeg')
    return res.status(200).end(bytes)
  } catch {
    return res.status(502).end()
  }
}
