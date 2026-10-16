import React, { useState, useEffect, useRef } from 'react'
import { cloudEnabled, resolveCloudAssetUrl } from '../cloud'
import AlbumTheater from './AlbumTheater'
import LiteraryQuote from '../LiteraryQuote'
import { literaryQuotes } from '../data/literaryQuotes'
import { albumStore, mergeLifePhotos, prepareLifePhoto } from './lifeAlbumStore'
import './lifeAlbum.css'
import { todayInShanghai } from '../journal/journalModel'

const names = { orange: '小琛', pomelo: '小琳' }
const today = todayInShanghai
async function api(method = 'GET', body, query = '') {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 45000)
  try {
    const response = await fetch(`/api/life-album${query}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '相册暂未同步')
    return result
  } finally {
    clearTimeout(timer)
  }
}
function Photo({ photo, onOpen }) {
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0)
  return failed ? (
    <button
      className="life-image-error"
      onClick={() => {
        setFailed(false)
        setRetry((n) => n + 1)
      }}
    >
      照片未加载 · 点击重试
    </button>
  ) : (
    <button
      className="life-photo-open"
      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
      onClick={onOpen}
      aria-label={`查看 ${names[photo.owner]} ${photo.taken_on} 的照片`}
    >
      <img
        key={retry}
        src={resolveCloudAssetUrl(photo.thumb)}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
        alt={photo.caption || `${names[photo.owner]}的生活照片`}
        onError={() => setFailed(true)}
      />
    </button>
  )
}
function Caption({ text }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (expanded) return
    const measure = () => setOverflowing(ref.current.scrollHeight > ref.current.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [text, expanded])
  return <div className="life-caption-text">
    <p ref={ref} className={expanded ? '' : 'is-clamped'}>{text}</p>
    {(overflowing || expanded) && <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起配文' : '展开配文'}</button>}
  </div>
}
export default function LifeAlbum() {
  const [photos, setPhotos] = useState([]),
    [drafts, setDrafts] = useState([]),
    [more, setMore] = useState(false),
    [cursor, setCursor] = useState(null)
  const [owner, setOwner] = useState('pomelo'),
    [date, setDate] = useState(today),
    [caption, setCaption] = useState('')
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(false),
    [theater, setTheater] = useState(false),
    [position, setPosition] = useState(null)
  const lock = useRef(false),
    alive = useRef(true),
    loadingRef = useRef(false)
  const load = async (append = false) => {
    if (loadingRef.current || lock.current) return
    loadingRef.current = true
    setLoading(true)
    setLoadError(false)
    try {
      if (!cloudEnabled) {
        setPhotos(mergeLifePhotos([], await albumStore('photos', 'getAll')))
        return
      }
      const query =
        append && cursor ? `?before=${cursor.taken_on}&id=${cursor.id}` : ''
      const data = await api('GET', null, query)
      if (!alive.current) return
      setPhotos((previous) =>
        append ? mergeLifePhotos(previous, data.photos) : data.photos,
      )
      setMore(data.more)
      setCursor(data.photos.at(-1) || null)
      setStatus('')
    } catch (error) {
      if (alive.current) { setStatus(error.message); setLoadError(true) }
    } finally {
      loadingRef.current = false
      if (alive.current) setLoading(false)
    }
  }
  useEffect(() => {
    alive.current = true
    albumStore('drafts', 'getAll')
      .then((rows) => {
        if (alive.current) setDrafts(rows)
      })
      .catch(() => setStatus('浏览器无法保存待上传照片，请检查存储空间'))
    void load()
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const warn = (event) => {
      if (lock.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  async function choose(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (lock.current || loadingRef.current || !files.length) return
    lock.current = true
    setBusy(true)
    let count = 0
    try {
      for (const file of files) {
        setStatus(`正在整理照片 ${count + 1}/${files.length}`)
        const draft = await prepareLifePhoto(file, {
          owner,
          taken_on: date,
          caption,
        })
        await albumStore('drafts', 'put', draft)
        setDrafts((rows) => [...rows, draft])
        count++
      }
      setStatus(`已选好 ${count} 张，点击发布。`)
    } catch (error) {
      setStatus(`已保留 ${count} 张；${error.message}`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function publish() {
    if (lock.current || loadingRef.current) return
    lock.current = true
    setBusy(true)
    let count = 0
    try {
      for (const draft of drafts) {
        setStatus(`正在上传 ${count + 1}/${drafts.length}`)
        let photo
        if (cloudEnabled) photo = (await api('POST', draft)).photo
        else {
          photo = {
            ...draft,
            src: draft.image,
            thumb: draft.thumbnail,
            created_at: new Date().toISOString(),
          }
          await albumStore('photos', 'put', photo)
        }
        await albumStore('drafts', 'delete', draft.id)
        setPhotos((rows) => mergeLifePhotos(rows, [photo]))
        setDrafts((rows) => rows.filter((row) => row.id !== draft.id))
        count++
      }
      setStatus(
        cloudEnabled
          ? `已发布 ${count} 张照片`
          : `已保存 ${count} 张照片到此浏览器`,
      )
    } catch (error) {
      setStatus(
        `已完成 ${count} 张；剩余照片已保留，可以重试。${error.message}`,
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const memories = photos.map((photo) => ({
    key: photo.id,
    day: {
      day: Number(photo.taken_on.replaceAll('-', '')),
      date: photo.taken_on,
    },
    owner: { id: photo.owner, label: names[photo.owner] },
    photo: { src: resolveCloudAssetUrl(photo.src), caption: photo.caption },
  }))
  return (
    <div className="life-album">
      <header className="section-heading playful-heading">
        <LiteraryQuote quote={literaryQuotes.nextHome} />
      </header>
      <div className="life-actions">
      <details className="life-composer">
        <summary>＋ 添加照片</summary>
        <div className="life-fields">
          <label>
            署名
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              disabled={busy || loading}
            >
              <option value="orange">小琛</option>
              <option value="pomelo">小琳</option>
            </select>
          </label>
          <label>
            照片日期
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy || loading}
            />
          </label>
          <label className="life-caption">
            配文（选填）
            <textarea
              rows={3}
              maxLength={2000}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={busy || loading}
            />
          </label>
          <label className="life-upload">
            选择照片
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy || loading || !date}
              onChange={choose}
            />
          </label>
          <small>可以一次选多张；相册保存高清压缩版。</small>
        </div>
      </details>
      {!!photos.length && <button className="life-play" onClick={() => {
        setPosition(null)
        setTheater(true)
      }}>慢慢看 ↗</button>}
      </div>
      {!!drafts.length && (
        <div className="life-pending">
          <p>{drafts.length} 张照片待发布</p>
          <div>
            {drafts.map((draft) => (
              <figure key={draft.id}>
                <img src={draft.thumbnail} alt="待发布照片" />
                <figcaption>
                  {names[draft.owner]} · {draft.taken_on}
                </figcaption>
                <textarea aria-label={`待发布照片配文 ${draft.id}`} value={draft.caption} maxLength={2000} disabled={busy || loading} onChange={event => {
                  const next = {...draft, caption: event.target.value}
                  setDrafts(rows => rows.map(row => row.id === next.id ? next : row))
                  void albumStore('drafts', 'put', next).catch(() => setStatus('配文暂未保存，请检查浏览器存储空间'))
                }} />
                <button
                  disabled={busy || loading}
                  onClick={async () => {
                    try {
                      await albumStore('drafts', 'delete', draft.id)
                      setDrafts((rows) =>
                        rows.filter((row) => row.id !== draft.id),
                      )
                    } catch {
                      setStatus('无法移除草稿，请重试')
                    }
                  }}
                >
                  取消这张
                </button>
              </figure>
            ))}
          </div>
          <button disabled={busy || loading} onClick={publish}>
            {busy ? '处理中…' : '发布照片'}
          </button>
        </div>
      )}
      <p role="status" className="life-status">
        {status || (loading ? '正在读取相册…' : '')}
        {loadError && <button disabled={loading || busy} onClick={() => load()}>重新加载</button>}
      </p>
      {!photos.length && !loading && !loadError && (
        <div className="chapter-empty">
          <span aria-hidden="true">✧</span>
          <p>还没有新的照片</p>
        </div>
      )}
      <div className="life-grid">
        {photos.map((photo) => (
          <figure key={photo.id} className="life-photo">
            <Photo
              photo={photo}
              onOpen={() => {
                setPosition({ key: photo.id, delta: 0 })
                setTheater(true)
              }}
            />
            <figcaption>
              <span>
                {photo.taken_on} · {names[photo.owner]}
              </span>
              {photo.caption && <Caption text={photo.caption} />}
            </figcaption>
          </figure>
        ))}
      </div>
      {more && (
        <button
          className="life-more"
          disabled={loading || busy}
          onClick={() => load(true)}
        >
          {loading ? '读取中…' : '再翻一些'}
        </button>
      )}
      {theater && (
        <AlbumTheater
          items={memories}
          lifeMode
          remembered={position}
          onRemember={setPosition}
          onClose={() => setTheater(false)}
        />
      )}
    </div>
  )
}
