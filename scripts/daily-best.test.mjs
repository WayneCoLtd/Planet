import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.SITE_ACCESS_PASSWORD = 'site-test'
process.env.ADMIN_PASSWORD = 'admin-test'
process.env.SESSION_SECRET = 'daily-best-test-secret'
process.env.WWCXRL_SERVICE_ROLE_KEY = 'sb_secret_test_only'

const { COOKIE_NAME, LEVEL_ADMIN, signToken } = await import('../api/_lib/session.js')
const { default: taskMediaHandler } = await import('../api/task-media.js')

function responseMock() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this }
  }
}

function adminCookie() {
  const token = signToken({ lv: LEVEL_ADMIN, exp: Date.now() + 60_000 })
  return `${COOKIE_NAME}=${encodeURIComponent(token)}`
}

test('task media upload requires an admin session', async () => {
  const response = responseMock()
  await taskMediaHandler({ method: 'POST', headers: {}, body: { action: 'sign-upload', contentType: 'image/jpeg', size: 100 } }, response)
  assert.equal(response.statusCode, 403)
})

test('task media rejects unsupported formats before storage access', async () => {
  const response = responseMock()
  await taskMediaHandler({ method: 'POST', headers: { cookie: adminCookie() }, body: { action: 'sign-upload', contentType: 'application/pdf', size: 100 } }, response)
  assert.equal(response.statusCode, 400)
  assert.match(response.body.error, /仅支持/)
})

test('task media rejects videos over 50MB', async () => {
  const response = responseMock()
  await taskMediaHandler({ method: 'POST', headers: { cookie: adminCookie() }, body: { action: 'sign-upload', contentType: 'video/mp4', size: 51 * 1024 * 1024 } }, response)
  assert.equal(response.statusCode, 400)
  assert.match(response.body.error, /50MB/)
})

test('task media delete rejects paths outside its own folder', async () => {
  const response = responseMock()
  await taskMediaHandler({ method: 'POST', headers: { cookie: adminCookie() }, body: { action: 'delete', paths: ['tracks/not-ours.mp4'] } }, response)
  assert.equal(response.statusCode, 400)
  assert.match(response.body.error, /路径不合法/)
})

test('daily best UI keeps playback user-controlled and mobile-friendly', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  assert.match(source, /function DailyBestCard/)
  assert.match(source, /controls\s+muted\s+playsInline\s+preload="metadata"/)
  assert.doesNotMatch(source.slice(source.indexOf('function DailyBestCard'), source.indexOf('function NightReadingQuest')), /autoPlay/)
})

test('daily best schema and media mapping are present', () => {
  const schema = readFileSync(new URL('../supabase_wwcxrl_schema.sql', import.meta.url), 'utf8')
  const cloud = readFileSync(new URL('../src/cloud.js', import.meta.url), 'utf8')
  assert.match(schema, /'dailyBest'/)
  assert.match(schema, /wwcxrl-task-media/)
  assert.match(cloud, /gameConfig\.mediaUrl/)
  assert.match(cloud, /gameConfig\.posterUrl/)
  assert.match(cloud, /task\.type === 'dailyBest' \? 'nightReading'/)
})
