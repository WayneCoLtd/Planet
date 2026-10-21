import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { resolveCloudAssetUrl } from '../cloud'
import { invalidateSignedMedia } from '../media/signedUrlCache'
import {
  OWNER_NAMES,
  journalText,
  singleJournalNote,
  bulletAtLine,
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
  onImages,
  onRefresh,
  disabled,
  active,
}) {
  const [removed, setRemoved] = useState([])
  const [viewer, setViewer] = useState(null)
  const input = useRef(null)
  const composing = useRef(false)
  const text = journalText(notes)
  const images = notes.flatMap((note) => note.images)
  function fit() {
    if (!input.current) return
    input.current.style.height = 'auto'
    input.current.style.height = `${Math.max(132, input.current.scrollHeight + 1)}px`
  }
  React.useLayoutEffect(fit, [text, active])
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  function changeText(value) {
    onChange(singleJournalNote(notes, value))
  }
  function putText(value, caret) {
    if (value.length > 10000) return
    changeText(value)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(caret, caret)
    })
  }
  function addBullet() {
    const result = bulletAtLine(text, input.current?.selectionStart || 0)
    putText(result.text, result.caret)
  }
  function keyDown(event) {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      composing.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return
    const start = event.currentTarget.selectionStart,
      end = event.currentTarget.selectionEnd
    const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
    const line = text.slice(lineStart, start)
    if (!line.startsWith('· ')) return
    event.preventDefault()
    if (!line.slice(2).trim())
      putText(text.slice(0, lineStart) + text.slice(end), lineStart)
    else putText(text.slice(0, start) + '\n· ' + text.slice(end), start + 3)
  }
  function removeImage(index) {
    setRemoved((stack) => [...stack, { image: images[index], index }])
    onChange(
      singleJournalNote(
        notes,
        text,
        images.filter((_, i) => i !== index),
      ),
    )
  }
  function undoImage() {
    const action = removed.at(-1),
      next = [...images]
    if (!next.some((image) => image.id === action.image.id))
      next.splice(Math.min(action.index, next.length), 0, action.image)
    onChange(singleJournalNote(notes, text, next))
    setRemoved((stack) => stack.slice(0, -1))
  }
  return (
    <div
      className={`journal-single-editor journal-scrapbook ${images.length ? 'has-images' : ''}`}
    >
      <div className="journal-single-text">
        <div className="journal-editor-hint">
          <span>把今天，慢慢写下来</span>
          <button
            type="button"
            disabled={disabled}
            onClick={addBullet}
            title="当前行加分点符号"
            aria-label={`${OWNER_NAMES[owner]}手记分点`}
          >
            · 分点
          </button>
        </div>
        <textarea
          ref={input}
          rows={3}
          maxLength={10000}
          aria-label={`${OWNER_NAMES[owner]}今日手记`}
          value={text}
          disabled={disabled}
          placeholder={'· 今天做了什么\n· 今天遇见的小事'}
          onChange={(event) => changeText(event.target.value)}
          onKeyDown={keyDown}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
        />
      </div>
      <div className="journal-single-media">
        <div className="journal-media-heading">
          <div className="journal-media-title">
            <span aria-hidden="true">✷</span>
            <strong>今日碎片</strong>
            <small>{images.length ? `${images.length} 张照片` : '留住一个小瞬间'}</small>
          </div>
          <label className="journal-upload">
            ＋ {images.length ? '添加照片' : '放入照片'}
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
                const unified = singleJournalNote(notes, text)
                onChange(unified)
                void onImages(unified[0].id, files)
              }}
            />
          </label>
        </div>
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
                    {String(index + 1).padStart(2, '0')} <span> / 今日碎片</span>
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
