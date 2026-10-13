import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { layoutMemories, monthLabel, needsImagesAhead, orderedMemories, rowWindow } from './galleryLayout'
import { createImageQueue, getKnownDimensions } from './imageQueue'
import './albumTheater.css'

function MemoryImage({ src, alt, queue, onResult }) {
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setResult(null)
    onResult(src, { pending: true })
    return queue.request(src, value => { setResult(value); onResult(src, value) })
  }, [src, queue, attempt, onResult])
  return <>
    {!result && <span className="mt-image-placeholder" role="status"><span>✧</span>正在展开这一帧…</span>}
    {result?.error ? <span className="mt-image-error">这一帧暂时没能打开<button type="button" onClick={event => { event.stopPropagation(); setAttempt(value => value + 1) }}>重新加载</button></span>
      : result && <img className="mt-photo-image" src={src} alt={alt} decoding="async" draggable="false" width={result.width} height={result.height} />}
  </>
}

function signedBy(item) { return item.owner.id === 'orange' ? '小琛' : item.owner.id === 'pomelo' ? '小琳' : item.owner.label }

export default function AlbumTheater({ items, onClose, remembered, onRemember, loading = false }) {
  const memories = useMemo(() => orderedMemories(items), [items])
  const dialogRef = useRef(null)
  const scrollRef = useRef(null)
  const streamRef = useRef(null)
  const closeRef = useRef(null)
  const detailCloseRef = useRef(null)
  const lastFocusedPhoto = useRef(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [viewport, setViewport] = useState({ top: 0, height: window.innerHeight })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(90)
  const [waiting, setWaiting] = useState(false)
  const [dimensions, setDimensions] = useState(getKnownDimensions)
  const imageStatesRef = useRef(new Map())
  const onImageResult = useCallback((src, result) => {
    imageStatesRef.current.set(src, result)
    if (result.width > 0 && result.height > 0) setDimensions(previous => {
      const known = previous.get(src)
      if (known?.width === result.width && known?.height === result.height) return previous
      return new Map(previous).set(src, result)
    })
  }, [])
  const [selected, setSelected] = useState(null)
  const [unfolded, setUnfolded] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const queue = useMemo(() => createImageQueue(3), [])
  const { rows, height } = useMemo(() => layoutMemories(memories, size.width, dimensions, size.height), [memories, size.width, size.height, dimensions])
  const mountedRows = rowWindow(rows, viewport.top, viewport.height)
  const currentRow = rows.find(row => row.offset + row.height > viewport.top + 80) || rows.at(-1)
  const current = currentRow?.items[0]
  const selectedIndex = memories.findIndex(item => item.key === selected)
  const detail = memories[selectedIndex]
  const months = useMemo(() => [...new Set(memories.map(item => String(item.day.date || '').slice(0, 7)))], [memories])
  const anchorRef = useRef(remembered || null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  function recordViewport() {
    const scroller = scrollRef.current, stream = streamRef.current
    if (!scroller || !stream || !dialogRef.current?.open || !scroller.clientHeight) return
    const top = Math.max(0, scroller.scrollTop - stream.offsetTop)
    const row = rowsRef.current.find(item => item.offset + item.height > top) || rowsRef.current.at(-1)
    anchorRef.current = scroller.scrollTop < stream.offsetTop - 30 ? null : row ? { key: row.key, delta: top - row.offset } : null
    setViewport(previous => Math.abs(previous.top - top) > 90 || previous.height !== scroller.clientHeight
      ? { top, height: scroller.clientHeight } : previous)
  }

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    const root = document.getElementById('root')
    const previouslyInert = root?.hasAttribute('inert')
    root?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus({ preventScroll: true })
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changeMotion = () => { setReduced(media.matches); if (media.matches) setPlaying(false) }
    media.addEventListener?.('change', changeMotion)
    const hide = () => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', hide)
    return () => {
      onRemember(anchorRef.current)
      queue.dispose()
      media.removeEventListener?.('change', changeMotion)
      document.removeEventListener('visibilitychange', hide)
      document.body.style.overflow = previousOverflow
      document.documentElement.style.overflow = previousRootOverflow
      if (!previouslyInert) root?.removeAttribute('inert')
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    const update = () => setSize({ width: element.clientWidth || window.innerWidth, height: element.clientHeight || window.innerHeight })
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])

  // Preserve the photo, not its former pixel offset, across resize or sync.
  useLayoutEffect(() => {
    const scroller = scrollRef.current, stream = streamRef.current
    if (!dialogRef.current?.open || !scroller?.clientHeight) return
    const anchor = anchorRef.current
    if (anchor && stream && scroller) {
      const row = rows.find(item => item.items.some(photo => photo.key === anchor.key))
      if (row) scroller.scrollTop = stream.offsetTop + row.offset + Math.min(anchor.delta, row.height - 1)
    }
    recordViewport()
  }, [rows, size.height])

  useEffect(() => {
    if (!playing || reduced || detail) { setWaiting(false); return }
    const scroller = scrollRef.current
    let frame, previous = 0, position = scroller.scrollTop
    const diagnostics = new URLSearchParams(window.location.search).get('albumDiagnostics') === '1'
    let intervals = [], waitingFrames = 0, sampleStart = position, lastWaiting = null
    const step = now => {
      // Geometry may change as a portrait or long screenshot finishes loading.
      // Follow the restored scroll position instead of jumping to the old one.
      if (Math.abs(scroller.scrollTop - position) > 2) position = scroller.scrollTop
      const top = Math.max(0, scroller.scrollTop - streamRef.current.offsetTop)
      const needsImage = needsImagesAhead(rowsRef.current, top, scroller.clientHeight, imageStatesRef.current)
      if (lastWaiting !== needsImage) { lastWaiting = needsImage; setWaiting(needsImage) }
      // Opt-in read-only QA sample. No visible UI, storage, telemetry or React
      // frame updates; browser checks can inspect the completed DOM sample.
      if (diagnostics && previous) {
        intervals.push(now - previous)
        if (needsImage) waitingFrames++
        if (intervals.length === 120) {
          const sorted = intervals.slice().sort((a, b) => a - b)
          dialogRef.current.dataset.motionSample = JSON.stringify({
            fps: Math.round(120000 / intervals.reduce((sum, value) => sum + value, 0)),
            p95: Math.round(sorted[114]), max: Math.round(sorted[119]),
            over50ms: intervals.filter(value => value > 50).length, waitingFrames, speed, distance: Math.round(scroller.scrollTop - sampleStart)
          })
          intervals = []; waitingFrames = 0; sampleStart = scroller.scrollTop
        }
      }
      if (previous && !needsImage) { position += Math.min(now - previous, 50) * speed / 1000; scroller.scrollTop = position }
      previous = now
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) { setPlaying(false); return }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, reduced, Boolean(detail)])

  useEffect(() => {
    if (detail) { setPlaying(false); setUnfolded(false); detailCloseRef.current?.focus({ preventScroll: true }) }
  }, [selected])

  function jumpTo(index) {
    setPlaying(false)
    const item = memories[index]
    const row = rows.find(row => row.items.some(photo => photo.key === item?.key))
    if (!row) return
    scrollRef.current.scrollTo({ top: streamRef.current.offsetTop + row.offset, behavior: 'auto' })
    recordViewport()
  }
  function closeDetail() {
    setSelected(null)
    requestAnimationFrame(() => (lastFocusedPhoto.current?.isConnected ? lastFocusedPhoto.current : closeRef.current)?.focus({ preventScroll: true }))
  }
  function handleKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); detail ? closeDetail() : onClose(); return }
    if (event.key === 'Tab') {
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled),select,a[href],[tabindex="0"]')]
        .filter(element => !element.closest('[inert]') && element.getClientRects().length)
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) setPlaying(false)
    if (detail && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      const next = selectedIndex + (event.key === 'ArrowLeft' ? -1 : 1)
      if (memories[next]) setSelected(memories[next].key)
    }
  }

  return createPortal(<dialog ref={dialogRef} className="memory-theater" aria-modal="true" aria-labelledby="mt-title" onKeyDown={handleKey}
    onCancel={event => { event.preventDefault(); detail ? closeDetail() : onClose() }}>
    <div className="mt-shell" inert={detail ? '' : undefined}>
      <header className="mt-topbar">
        <div className="mt-mark"><span aria-hidden="true">✳</span><span>我们的每一天<small>A LITTLE COLLECTION OF US</small></span></div>
        <button ref={closeRef} type="button" className="mt-close" onClick={onClose}>合上帷幕 <span aria-hidden="true">×</span></button>
      </header>
      <div ref={scrollRef} className="mt-scroll" tabIndex={0} role="region" aria-label="回忆画廊，向下滚动浏览照片" onScroll={recordViewport}
        onWheel={() => setPlaying(false)} onTouchStart={() => setPlaying(false)} onPointerDown={() => setPlaying(false)}>
        <section className="mt-intro">
          <span className="mt-eyebrow">THE DAYS WE KEPT</span>
          <h2 id="mt-title">把日子，<br className="mt-mobile-break" />再慢慢看一遍。</h2>
          <p>照片替我们收好了，那些平常又珍贵的瞬间。</p>
          <div className="mt-intro-meta"><span>{memories.length ? memories[0].day.date?.replaceAll('-', '.') : '尚待收藏'}</span><i /><span>{memories.length} 帧记忆</span></div>
          <span className="mt-scroll-hint">向下翻阅 <span aria-hidden="true">↓</span></span>
        </section>
        {!memories.length && <div className="mt-empty" role="status"><span>✧</span><h3>{loading ? '正在翻开相册…' : '这一卷，留给接下来的照片。'}</h3><p>{loading ? '照片正在路上，先在这里等一小会儿。' : '暂时没有可显示的照片，可以回到相册查看或上传。'}</p><button type="button" onClick={onClose}>回到相册</button></div>}
        <div ref={streamRef} className="mt-stream" style={{ height }}>
          {mountedRows.map(row => <div key={row.key} className="mt-row is-pair" style={{ top: row.offset, height: row.height }}>
            {row.items.map((item, slotIndex) => <figure className="mt-memory" key={`${item.key}:${item.photo.src}`} style={{ '--mt-media-height': `${row.mediaHeights[slotIndex]}px`, '--mt-card-width': `${row.mediaWidths[slotIndex]}px`, gridColumn: row.mobile ? 1 : item.owner.id === 'pomelo' ? 2 : 1 }}>
              <div className="mt-photo-surface">
                <span className="mt-image-slot"><MemoryImage src={item.photo.src} alt={`${signedBy(item)} · ${item.day.date}`} queue={queue} onResult={onImageResult} /></span>
                <button type="button" className="mt-photo-open" aria-label={`放大查看 ${signedBy(item)} Day ${item.day.day} 的照片`}
                  onClick={event => { lastFocusedPhoto.current = event.currentTarget; setSelected(item.key) }}>
                  <span className="mt-enlarge" aria-hidden="true">↗</span>
                </button>
              </div>
              <figcaption><span className="mt-photo-date">{item.day.date?.replaceAll('-', '.')}<small>DAY {item.day.day}</small></span><span className="mt-photo-owner"><i className={item.owner.id === 'orange' ? 'is-orange' : 'is-pomelo'} />{signedBy(item)}</span></figcaption>
            </figure>)}
          </div>)}
        </div>
        {memories.length > 0 && <footer className="mt-ending"><span>✧</span><h3>这一卷，先看到这里。</h3><p>每一张，都还好好地留在这里。</p><button type="button" onClick={() => { setPlaying(false); scrollRef.current.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }) }}>从头再看 <span aria-hidden="true">↑</span></button></footer>}
      </div>
      <footer className="mt-controls">
        <label className="mt-month-control"><span>翻到</span><select aria-label="跳到月份" onFocus={() => setPlaying(false)} value={String(current?.day.date || '').slice(0, 7)} disabled={!months.length}
          onChange={event => jumpTo(memories.findIndex(item => String(item.day.date || '').startsWith(event.target.value)))}>
          {!months.length && <option value="">这些日子</option>}{months.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}
        </select></label>
        <span className="mt-position">{current ? `DAY ${current.day.day}` : 'MEMORY ALBUM'}</span>
        <div className="mt-playback">
        <select className="mt-speed" aria-label="巡游速度" value={speed} onChange={event => setSpeed(Number(event.target.value))} disabled={reduced}>
          <option value={60}>舒缓</option><option value={90}>适中</option><option value={140}>轻快</option>
        </select>
        <button className={`mt-play ${playing ? 'is-playing' : ''}`} type="button" aria-pressed={playing} disabled={!memories.length || reduced}
          title={reduced ? '已按系统设置减少动态效果，请手动翻阅' : '以慢速自动向下翻阅，触摸或滚动即可暂停'}
          onClick={() => { if (!playing && scrollRef.current.scrollTop + scrollRef.current.clientHeight >= scrollRef.current.scrollHeight - 2) scrollRef.current.scrollTop = 0; setPlaying(value => !value) }}>
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>{reduced ? '手动翻阅' : playing ? waiting ? '等图中 · 暂停' : '暂停巡游' : '慢慢看'}
        </button>
        </div>
      </footer>
    </div>
    <div className="mt-curtain mt-curtain-left" aria-hidden="true" /><div className="mt-curtain mt-curtain-right" aria-hidden="true" />
    {detail && <section className="mt-detail" role="dialog" aria-modal="true" aria-label={`${signedBy(detail)} ${detail.day.date} 照片预览`}>
      <header><span>{detail.day.date} <small>· {signedBy(detail)}</small></span><button type="button" ref={detailCloseRef} onClick={closeDetail}>返回画廊 ×</button></header>
      <div className={`mt-detail-scroll ${unfolded ? 'is-unfolded' : ''}`}><img src={detail.photo.src} alt={`${signedBy(detail)} · ${detail.day.date}`} decoding="async" /></div>
      <footer><button type="button" disabled={selectedIndex <= 0} onClick={() => setSelected(memories[selectedIndex - 1].key)}>← 上一张</button><button type="button" aria-pressed={unfolded} onClick={() => setUnfolded(value => !value)}>{unfolded ? '适合屏幕' : '展开原图'}</button><button type="button" disabled={selectedIndex >= memories.length - 1} onClick={() => setSelected(memories[selectedIndex + 1].key)}>下一张 →</button></footer>
      {detail.photo.caption && <p className="mt-detail-caption">{detail.photo.caption}</p>}
    </section>}
  </dialog>, document.body)
}
