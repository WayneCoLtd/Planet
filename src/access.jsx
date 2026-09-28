import React, { useState } from 'react'
import { safeGetItem, safeSetItem } from './safeStorage'
import StarField from './StarField'

// ---- 站点访问密码（服务端校验） ----
// 密码只存在于服务端环境变量里，前端拿不到、也不会被打包进公开的 JS。
const ACCESS_API = '/api/access'
// 这里只是“这个浏览器曾成功通过门禁”的非敏感提示，真正权限仍由
// HttpOnly Cookie 和服务端接口决定。提示存在时可先显示本地缓存，再后台复核。
const ACCESS_HINT_KEY = 'wwcxrl-access-hint-v1'

function isLocalDevHost() {
  if (typeof window === 'undefined') return true
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname)
}

async function callAccessApi(options = {}) {
  // 返回用户已有缓存可先显示，后台校验应容忍冷启动和慢网络。
  const timeoutMs = 12000
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(ACCESS_API, { ...options, signal: controller ? controller.signal : undefined })
    const data = await response.json()
    return { reached: true, status: response.status, data }
  } catch (error) {
    return { reached: false, status: 0, data: {}, error }
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

// 验证管理端密码：线上交给服务端判断，本地开发用 .env.local 里的 VITE_ADMIN_PASSWORD。
async function verifyAdminPassword(password) {
  if (isLocalDevHost()) {
    const local = import.meta.env.VITE_ADMIN_PASSWORD
    if (!local) return { ok: false, error: '本地开发：请在 .env.local 里设置 VITE_ADMIN_PASSWORD' }
    return String(password) === String(local) ? { ok: true } : { ok: false, error: '密码不对哦' }
  }
  const result = await callAccessApi({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, scope: 'admin' })
  })
  if (!result.reached) return { ok: false, error: '连不上服务器，检查一下网络再试' }
  if (result.status === 200) return { ok: true }
  // 把服务端真正的原因显示出来：分清「密码不对」「还没过站点门」「试太多次被限速」，
  // 而不是一律说成密码错误。
  return { ok: false, error: (result.data && result.data.error) || '密码不对哦' }
}

// 密码门：通过之前不渲染站点的任何内容。
// 通过之后靠 HttpOnly Cookie 记住 180 天，平时访问完全无感。
function AccessGate({ children }) {
  const accessHintAtBootRef = React.useRef(!isLocalDevHost() && safeGetItem(ACCESS_HINT_KEY) === '1')
  // 不在启动阶段调用 Serverless GET：返回用户立即打开；首次用户直接看到口令框。
  // 需要保护的服务端接口仍会验证 HttpOnly Cookie。
  const [phase, setPhase] = useState(() => (isLocalDevHost() || accessHintAtBootRef.current ? 'open' : 'locked'))
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    const result = await callAccessApi({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, scope: 'site' })
    })
    setBusy(false)
    if (!result.reached) {
      setMessage('连不上服务器，检查一下网络再试')
      return
    }
    if (result.status === 200 && result.data && result.data.ok) {
      setPassword('')
      safeSetItem(ACCESS_HINT_KEY, '1')
      setPhase('open')
      return
    }
    setMessage((result.data && result.data.error) || '密码不对哦，再想想')
  }

  if (phase === 'open') {
    return children
  }

  return (
    <div className="access-gate">
      <StarField />
      <div className="access-gate-card">
        <span className="access-gate-planet" aria-hidden="true">🪐</span>
        {phase === 'checking' ? (
          <>
            <h1>正在确认身份</h1>
            <p className="access-gate-hint">稍等一下下…</p>
          </>
        ) : (
          <form onSubmit={submit} className="access-gate-form">
            <h1>小星球的门</h1>
            <p className="access-gate-hint">输入我们约定的口令，就能进来</p>
            <label className="access-gate-field">
              <input
                type="password"
                value={password}
                onChange={event => { setPassword(event.target.value); setMessage('') }}
                placeholder="口令"
                aria-label="站点访问口令"
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </label>
            <button type="submit" className="access-gate-submit" disabled={busy || !password}>
              {busy ? '正在核对…' : '进去吧'}
            </button>
            {message && <p className="access-gate-error" role="alert">{message}</p>}
          </form>
        )}
      </div>
    </div>
  )
}

// 渲染兜底：万一还有没预料到的异常，给一个能重试的页面，而不是白屏。
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[wwcxrl] render error', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app-error-fallback" role="alert">
        <div className="app-error-card">
          <span className="app-error-icon">🛠️</span>
          <h1>小星球刚才绊了一下</h1>
          <p>页面没能正常显示，多半是浏览器存储或网络临时出了状况。刷新一下通常就好了，签到记录都存在云端，不会丢。</p>
          <div className="app-error-actions">
            <button type="button" onClick={() => window.location.reload()}>刷新一下</button>
            <button type="button" className="is-ghost" onClick={() => this.setState({ error: null })}>再试一次</button>
          </div>
          <small>{String((this.state.error && this.state.error.message) || this.state.error || '未知错误')}</small>
        </div>
      </div>
    )
  }
}


export { AccessGate, AppErrorBoundary, isLocalDevHost, verifyAdminPassword }
