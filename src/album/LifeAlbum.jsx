import React, { useState, useEffect, useRef } from 'react'
import { cloudEnabled, resolveCloudAssetUrl } from '../cloud'
import PhotoThumbnail from '../media/PhotoThumbnail'
import EditPhotoDialog from './EditPhotoDialog'
import AlbumTheater from './AlbumTheater'
import LiteraryQuote from '../LiteraryQuote'
import { literaryQuotes } from '../data/literaryQuotes'
import { albumStore, editLocalPhoto, mergeLifePhotos, prepareLifePhoto } from './lifeAlbumStore'
import './lifeAlbum.css'
import { todayInShanghai } from '../journal/journalModel'
import { encodePhotoUpload, PHOTO_UPLOAD_TYPE } from '../media/photoUpload'

const names = { orange: '小琛', pomelo: '小琳' }
const today = todayInShanghai
let visiblePhotoCache = []
async function api(method = 'GET', body, query = '') {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 45000)
  try {
    const binary = Boolean(body?.image)
    const response = await fetch(`/api/life-album${query}`, {
      method,
      headers: body ? { 'Content-Type': binary ? PHOTO_UPLOAD_TYPE : 'application/json' } : undefined,
      body: !body ? undefined : binary ? await encodePhotoUpload(body) : JSON.stringify(body),
      signal: controller.signal,
    })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(result.error || '相册暂未同步'), { current: result.current })
    return result
  } finally {
    clearTimeout(timer)
  }
}
function Photo({ photo, onOpen }) {
  const [original, setOriginal] = useState(false)
  useEffect(() => { setOriginal(false); setFailed(false) }, [photo.thumb])
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
      <PhotoThumbnail
        key={retry}
        src={resolveCloudAssetUrl(original ? photo.src : photo.thumb)}
        width={photo.width}
        height={photo.height}
        alt={photo.caption || `${names[photo.owner]}的生活照片`}
        onError={() => original ? setFailed(true) : setOriginal(true)}
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
  const [editing, setEditing] = useState(null)
  const [photos, setPhotos] = useState(() => visiblePhotoCache),
    [drafts, setDrafts] = useState([]),
    [more, setMore] = useState(false),
    [cursor, setCursor] = useState(null)
  const [owner, setOwner] = useState('pomelo'),
    [date, setDate] = useState(today),
    [caption, setCaption] = useState('')
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [restoringDrafts, setRestoringDrafts] = useState(true),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(''),
    [theater, setTheater] = useState(false),
    [position, setPosition] = useState(null)
  const [openedPhoto, setOpenedPhoto] = useState(null)
  useEffect(() => { visiblePhotoCache = photos }, [photos])
  const lock = useRef(false),
    alive = useRef(true),
    loadingRef = useRef(false),
    draftWrites = useRef(Promise.resolve())
  const load = async (append = false) => {
    if (loadingRef.current || lock.current) return
    loadingRef.current = true
    setLoading(true)
    setLoadError('')
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
    } catch (error) {
      if (alive.current) setLoadError(error.message)
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
      .finally(() => { if (alive.current) setRestoringDrafts(false) })
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
    if (lock.current || restoringDrafts || !files.length) return
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
      setStatus(`已选 ${count} 张，确认信息后发布。`)
    } catch (error) {
      setStatus(`已保留 ${count} 张。${error.message}`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function updateDraft(draft, patch) {
    const next = { ...draft, ...patch }
    setDrafts((rows) => rows.map((row) => row.id === next.id ? next : row))
    draftWrites.current = draftWrites.current.catch(() => {}).then(() => albumStore('drafts', 'put', next))
    void draftWrites.current.catch(() => setStatus('照片信息未保存到本机，请检查存储空间'))
  }
  async function removeDraft(id) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      await draftWrites.current.catch(() => {})
      await albumStore('drafts', 'delete', id)
      setDrafts((rows) => rows.filter((row) => row.id !== id))
      setStatus('')
    } catch {
      setStatus('无法移除草稿，请重试')
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
      await draftWrites.current.catch(() => {})
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
        `已发布 ${count} 张，剩余照片已保留。${error.message}`,
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function savePhoto(body) {
    if (lock.current || loadingRef.current) throw new Error('相册正在更新，请稍后再试。')
    lock.current = true
    setBusy(true)
    try {
      const photo = cloudEnabled ? (await api('PATCH', body)).photo : await editLocalPhoto(body)
      setPhotos(rows => mergeLifePhotos(rows, [photo]))
      setStatus('照片已更新')
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
    photo: { src: resolveCloudAssetUrl(photo.src), previewSrc: resolveCloudAssetUrl(photo.thumb), caption: photo.caption },
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
          <label className="life-upload">
            选择照片
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy || restoringDrafts || !date}
              onChange={choose}
            />
          </label>
          <small>可多选。以下设置用于新选的照片。</small>
          <label>
            署名
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              disabled={busy}
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
              disabled={busy}
            />
          </label>
          <label className="life-caption">
            配文（选填）
            <textarea
              rows={3}
              maxLength={2000}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
      </details>
      {!!photos.length && <button className="life-play" onClick={() => {
        setPosition(null)
        setOpenedPhoto(null)
        setTheater(true)
      }}>打开画廊 ↗</button>}
      </div>
      <p role="status" className="life-status">{status}</p>
      {!!drafts.length && (
        <div className="life-pending">
          <p>{drafts.length} 张照片待发布</p>
          <div>
            {drafts.map((draft) => (
              <figure key={draft.id}>
                <img src={draft.thumbnail} alt="待发布照片" />
                <figcaption className="life-draft-fields">
                  <label>署名
                    <select value={draft.owner} disabled={busy} onChange={event => updateDraft(draft, { owner: event.target.value })}>
                      <option value="orange">小琛</option>
                      <option value="pomelo">小琳</option>
                    </select>
                  </label>
                  <label>照片日期
                    <input type="date" value={draft.taken_on} max={today()} disabled={busy}
                      onChange={event => event.target.value && updateDraft(draft, { taken_on: event.target.value })} />
                  </label>
                  <label>配文
                    <textarea value={draft.caption} maxLength={2000} disabled={busy}
                      onChange={event => updateDraft(draft, { caption: event.target.value })} />
                  </label>
                  <button disabled={busy} onClick={() => removeDraft(draft.id)}>移除草稿</button>
                </figcaption>
              </figure>
            ))}
          </div>
          <button disabled={busy || loading} onClick={publish}>
            {busy ? '处理中…' : '发布照片'}
          </button>
        </div>
      )}
      <p role="status" className="life-status">
        {loadError || (loading ? '正在读取相册…' : '')}
        {loadError && <button disabled={loading || busy} onClick={() => load()}>重新加载</button>}
      </p>
      {!photos.length && !loading && !loadError && (
        <div className="chapter-empty">
          <span aria-hidden="true">✧</span>
          <p>相册还没有照片</p>
        </div>
      )}
      <div className="life-grid">
        {photos.map((photo) => (
          <figure key={photo.id} className="life-photo">
            <Photo
              photo={photo}
              onOpen={() => {
                setPosition({ key: photo.id, delta: 0 })
                setOpenedPhoto(photo.id)
                setTheater(true)
              }}
            />
            <figcaption>
              {photo.caption && <Caption text={photo.caption} />}
              <div className="life-photo-meta">
                <time dateTime={photo.taken_on}>{photo.taken_on.replaceAll('-', '.')}</time>
                <span>{names[photo.owner]}</span>
                <button className="life-edit-link" aria-label="编辑照片" disabled={busy || loading} onClick={() => setEditing(photo)}>✎ 编辑</button>
              </div>
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
      {editing && <EditPhotoDialog photo={editing} onSave={savePhoto} onClose={() => setEditing(null)} />}
      {theater && (
        <AlbumTheater
          items={memories}
          lifeMode
          initialPhoto={openedPhoto}
          remembered={position}
          onRemember={setPosition}
          onClose={() => setTheater(false)}
        />
      )}
    </div>
  )
}
