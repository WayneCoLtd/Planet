import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { resolveCloudAssetUrl, toCanonicalCloudUrl } from '../cloud'
import { invalidateSignedMedia } from '../media/signedUrlCache'
import {
  OWNER_NAMES,
} from './journalModel'

export const notePhotoUrl = (image, thumb = false) =>
  image.pendingImage
    ? thumb
      ? image.pendingImage.thumbnail
      : image.pendingImage.data
    : resolveCloudAssetUrl((thumb ? image.thumbUrl : image.url) || '')

// Retry a failed site proxy through the same private, signed storage link.
function photoRoutes(url) {
  if (!url) return []
  if (!url.startsWith(window.location.origin + '/sb/storage/v1/object/sign/wwcxrl-journal/')) return [url]
  return [...new Set([url, toCanonicalCloudUrl(url)])]
}
export function useJournalPhoto(primary, preview = '') {
  const [failed, setFailed] = useState([])
  const preferred = photoRoutes(primary)
  const src = [...preferred, ...photoRoutes(preview)].find(url => !failed.includes(url))
  return {
    src,
    usingPreview: Boolean(src && !preferred.includes(src)),
    onError() {
      invalidateSignedMedia(toCanonicalCloudUrl(src))
      setFailed(urls => urls.includes(src) ? urls : [...urls, src])
    },
    retry() { setFailed([]) },
  }
}

function NotePhoto({ image, open, refresh, loading }) {
  const { src, onError, retry } = useJournalPhoto(notePhotoUrl(image, true), notePhotoUrl(image))
  if (!src && loading) return <span className="journal-media-loading" role="status">正在读取照片…</span>
  return !src ? (
    <button
      className="journal-photo-retry"
      onClick={() => {
        retry()
        refresh()
      }}
    >
      图片未加载，点击重试
    </button>
  ) : (
    <button
      className="journal-note-image"
      onClick={open}
      aria-label="放大手记图片"
    >
      <img
        src={src}
        alt="手记附图"
        loading="lazy"
        decoding="async"
        onError={onError}
      />
    </button>
  )
}
function NoteViewer({ images, initial, close, refresh }) {
  const ref = useRef(null)
  const [position, setIndex] = useState(initial)
  const index = Math.min(position, images.length - 1)
  const image = images[index]
  const { src, usingPreview, onError, retry } = useJournalPhoto(notePhotoUrl(image), notePhotoUrl(image, true))
  useEffect(() => {
    const dialog = ref.current,
      focus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      focus?.focus?.()
    }
  }, [])
  return createPortal(
    <dialog
      ref={ref}
      className="journal-image-dialog"
      onCancel={close}
      onClick={(event) => {
        if (event.target === ref.current) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          setIndex((i) => Math.max(0, i - 1))
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          setIndex((i) => Math.min(images.length - 1, i + 1))
        }
      }}
    >
      <header>
        <span>
          手记附图 · {index + 1} / {images.length}
        </span>
        <button onClick={close} aria-label="关闭手记图片">
          关闭 ×
        </button>
      </header>
      {src && <img src={src} alt="手记图片完整预览" onError={onError} />}
      {(!src || usingPreview) && <button onClick={() => { retry(); refresh() }}>
        {src ? '已显示预览图，重试原图' : '照片未加载，点击重试'}
      </button>}
      <footer>
        <button disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          上一张
        </button>
        <button
          disabled={index === images.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          下一张
        </button>
      </footer>
    </dialog>,
    document.body,
  )
}

export default function JournalNotes({
  owner,
  notes,
  onChange,
  onPhotoChange,
  onImages,
  onRefresh,
  disabled,
  photoStatus,
  mediaLoading,
}) {
  const [removed, setRemoved] = useState([])
  const [viewer, setViewer] = useState(null)
  const images = notes.flatMap((note) => note.images)
  function removeImage(index) {
    const image = images[index]
    const parent = notes.find(note => note.images.includes(image))
    setRemoved(stack => [...stack, { parentId: parent.id, index: parent.images.indexOf(image), image }])
    onPhotoChange(notes.map(note => note === parent
      ? { ...note, images: note.images.filter(item => item !== image) } : note))
  }
  function undoImage() {
    const action = removed.at(-1)
    onPhotoChange(notes.map(note => {
      if (note.id !== action.parentId || note.images.some(item => item.id === action.image.id)) return note
      const restored = [...note.images]
      restored.splice(action.index, 0, action.image)
      return { ...note, images: restored }
    }))
    setRemoved(stack => stack.slice(0, -1))
  }
  return (
    <div
      className={`journal-single-editor journal-scrapbook ${images.length ? 'has-images' : ''}`}
    >
      <div className="journal-single-media">
        <div className="journal-media-heading">
          <div className="journal-media-title">
            <span aria-hidden="true">✷</span>
            <strong>今日照片</strong>
            {!!images.length && <small>{images.length} 张</small>}
          </div>
          <label className="journal-upload">
            ＋ 添加照片
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={disabled}
              aria-label={`${OWNER_NAMES[owner]}手记添加照片`}
              onChange={(event) => {
                const files = Array.from(event.target.files || [])
                event.target.value = ''
                if (!files.length) return
                const note = notes.at(-1) || { id: 'journal-body', text: '', images: [] }
                if (!notes.length) onChange([note])
                void onImages(note.id, files)
              }}
            />
          </label>
        </div>
        <p className="journal-photo-status" role="status">{photoStatus}</p>
        {!!images.length && (
          <div className={`journal-note-images journal-photo-grid ${images.length === 1 ? 'is-single' : ''}`}>
            {images.map((image, index) => (
              <figure key={image.id}>
                <NotePhoto
                  image={image}
                  refresh={onRefresh}
                  loading={mediaLoading}
                  open={() => setViewer(index)}
                />
                <figcaption>
                  <span className="journal-photo-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')} <span> / 今日照片</span>
                  </span>
                  <button
                    className="journal-photo-remove"
                    disabled={disabled}
                    aria-label={`移除第 ${index + 1} 张附图`}
                    onClick={() => removeImage(index)}
                  >
                    移除
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {!!removed.length && (
          <button
            className="journal-note-undo"
            disabled={disabled}
            onClick={undoImage}
          >
            撤销移除
          </button>
        )}
      </div>
      {viewer !== null && images.length > 0 && (
        <NoteViewer
          images={images}
          initial={viewer}
          refresh={onRefresh}
          close={() => setViewer(null)}
        />
      )}
    </div>
  )
}
