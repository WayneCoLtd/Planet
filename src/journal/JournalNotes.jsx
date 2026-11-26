import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { resolveCloudAssetUrl } from '../cloud'
import { invalidateSignedMedia } from '../media/signedUrlCache'
import {
  OWNER_NAMES,
  journalText,
} from './journalModel'

export const notePhotoUrl = (image, thumb = false) =>
  image.pendingImage
    ? thumb
      ? image.pendingImage.thumbnail
      : image.pendingImage.data
    : resolveCloudAssetUrl((thumb ? image.thumbUrl : image.url) || '')

function NotePhoto({ image, open, refresh }) {
  const [failed, setFailed] = useState(false)
  const src = notePhotoUrl(image, true)
  useEffect(() => setFailed(false), [src])
  return failed || !src ? (
    <button
      className="journal-photo-retry"
      onClick={() => {
        setFailed(false)
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
        onError={() => { invalidateSignedMedia(image.thumbUrl || image.url); setFailed(true) }}
      />
    </button>
  )
}
function NoteViewer({ images, initial, close }) {
  const ref = useRef(null)
  const [index, setIndex] = useState(initial)
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
      <img src={notePhotoUrl(images[index])} alt="手记图片完整预览" />
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
}) {
  const [removed, setRemoved] = useState([])
  const [viewer, setViewer] = useState(null)
  const text = journalText(notes)
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
      {text && <details className="journal-old-notes">
        <summary>查看旧手记</summary>
        <p>{text}</p>
      </details>}
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
                  open={() => setViewer({ images, index })}
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
      {viewer && (
        <NoteViewer
          images={viewer.images}
          initial={viewer.index}
          close={() => setViewer(null)}
        />
      )}
    </div>
  )
}
