import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { safeGetItem, safeSetItem, safeRemoveItem } from '../safeStorage'
import { OWNER_NAMES } from './journalModel'
import { readComments, postComment } from './journalStore'

export function GrowingTextarea({ active, value, ...props }) {
  const input = useRef(null)
  useLayoutEffect(() => {
    const element = input.current
    function fit() {
      if (!element.clientWidth) return
      element.style.height = 'auto'
      element.style.height = (element.scrollHeight + element.offsetHeight - element.clientHeight) + 'px'
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [active, value])
  return <textarea {...props} ref={input} value={value} className="journal-full-text" />
}

function mergeComments(previous, incoming) {
  const unique = new Map([...previous, ...incoming].map(row => [row.id, row]))
  return [...unique.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
}
const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export default function JournalComments({ owner, date, active, refreshKey }) {
  const sender = OWNER_NAMES[owner === 'orange' ? 'pomelo' : 'orange']
  const draftKey = 'journal-comment:' + date + ':' + owner
  const [draft, setDraft] = useState(() => {
    try { return JSON.parse(safeGetItem(draftKey, 'null', 'sessionStorage')) } catch { return null }
  })
  const [open, setOpen] = useState(Boolean(draft?.text))
  const [comments, setComments] = useState([])
  const [readError, setReadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const opener = useRef(null)
  useEffect(() => {
    let alive = true
    readComments(owner, date).then(rows => {
      if (!alive) return
      setComments(previous => mergeComments(previous, rows))
      setReadError(false)
    }).catch(() => { if (alive) setReadError(true) })
    return () => { alive = false }
  }, [owner, date, refreshKey, retry])
  function change(text) {
    const next = { id: crypto.randomUUID(), text }
    setDraft(next)
    safeSetItem(draftKey, JSON.stringify(next), 'sessionStorage')
    setNotice('')
  }
  async function send(event) {
    event.preventDefault()
    if (lock.current || !draft?.text.trim()) return
    lock.current = true
    setSending(true)
    try {
      const row = await postComment(owner, date, draft.id, draft.text.trim())
      setComments(previous => mergeComments(previous, [row]))
      if (safeGetItem(draftKey, null, 'sessionStorage') === JSON.stringify(draft))
        safeRemoveItem(draftKey, 'sessionStorage')
      setDraft(null)
      setOpen(false)
      setNotice('留言已送达')
      requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }))
    } catch {
      setNotice('留言还没送到，文字已保留，可以再试一次。')
    } finally {
      lock.current = false
      setSending(false)
    }
  }
  return <section className="journal-comments" aria-label={'给' + OWNER_NAMES[owner] + '的留言'}>
    <header><h4>对方的留言</h4>
      <button ref={opener} aria-expanded={open} disabled={sending} onClick={() => setOpen(!open)}>{open ? '收起输入框' : '留句话'}</button>
    </header>
    {readError && <p role="status">留言暂未读全。<button onClick={() => setRetry(n => n + 1)}>重试</button></p>}
    {comments.map(row => <div className="journal-comment" key={row.id}>
      <div><strong>{sender}</strong><time dateTime={row.created_at}>{time.format(new Date(row.created_at))}</time></div>
      <p>{row.text}</p>
    </div>)}
    {open && <form onSubmit={send}>
      <label htmlFor={'reply-' + owner}>{sender}写给{OWNER_NAMES[owner]}</label>
      <GrowingTextarea active={active} id={'reply-' + owner} rows={2} maxLength={10000} autoFocus
        value={draft?.text || ''} disabled={sending} onChange={event => change(event.target.value)} />
      <button disabled={sending || !draft?.text.trim()}>{sending ? '正在送达…' : '发送留言'}</button>
    </form>}
    {notice && <small role="status">{notice}</small>}
  </section>
}
