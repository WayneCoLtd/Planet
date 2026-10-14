import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { resolveCloudAssetUrl } from '../cloud'
import { OWNER_NAMES } from './journalModel'

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
        onError={() => setFailed(true)}
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
}) {
  const [editing, setEditing] = useState(null)
  const [removed, setRemoved] = useState([])
  const [viewer, setViewer] = useState(null)
  const fresh = useRef(false)
  const editor = useRef(null)
  useEffect(() => {
    if (fresh.current) {
      editor.current?.focus()
      fresh.current = false
    }
  }, [editing])
  function edit(id) {
    fresh.current = true
    setEditing(id)
  }
  function update(id, patch) {
    onChange(
      notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
    )
  }
  function add() {
    const id = crypto.randomUUID()
    onChange([...notes, { id, text: '', images: [] }])
    edit(id)
  }
  function move(index, direction) {
    const next = [...notes]
    ;[next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ]
    onChange(next)
  }
  function undo() {
    const action = removed.at(-1)
    if (action.type === 'note') {
      const next = [...notes]
      if (!next.some((note) => note.id === action.note.id))
        next.splice(Math.min(action.index, next.length), 0, action.note)
      onChange(next)
    } else {
      onChange(
        notes.map((note) => {
          if (
            note.id !== action.noteId ||
            note.images.some((image) => image.id === action.image.id)
          )
            return note
          const images = [...note.images]
          images.splice(Math.min(action.index, images.length), 0, action.image)
          return { ...note, images }
        }),
      )
    }
    setRemoved((stack) => stack.slice(0, -1))
  }
  return (
    <div className="journal-notes">
      {notes.map((note, index) => (
        <article
          className={`journal-note ${editing === note.id ? 'is-editing' : ''}`}
          key={note.id}
        >
          {editing === note.id ? (
            <textarea
              ref={editor}
              rows={3}
              maxLength={10000}
              aria-label={`${OWNER_NAMES[owner]}第 ${index + 1} 条手记`}
              value={note.text}
              placeholder="记一件今天的事……"
              disabled={disabled}
              onChange={(event) =>
                update(note.id, { text: event.target.value })
              }
            />
          ) : (
            <div className="journal-note-copy">
              <p>{note.text || (note.images.length ? '' : '还没写内容')}</p>
              <button
                className="journal-note-edit"
                aria-label={`编辑${OWNER_NAMES[owner]}第 ${index + 1} 条手记`}
                disabled={disabled}
                onClick={() => edit(note.id)}
              >
                编辑
              </button>
            </div>
          )}
          {!!note.images.length && (
            <div
              className={`journal-note-images ${note.images.length > 1 ? 'has-many' : ''}`}
            >
              {note.images.map((image, imageIndex) => (
                <figure key={image.id}>
                  <NotePhoto
                    image={image}
                    refresh={onRefresh}
                    open={() =>
                      setViewer({ images: note.images, index: imageIndex })
                    }
                  />
                  {editing === note.id && (
                    <button
                      className="journal-photo-remove"
                      disabled={disabled}
                      aria-label={`移除第 ${imageIndex + 1} 张附图`}
                      onClick={() => {
                        setRemoved((stack) => [
                          ...stack,
                          {
                            type: 'image',
                            noteId: note.id,
                            image,
                            index: imageIndex,
                          },
                        ])
                        update(note.id, {
                          images: note.images.filter(
                            (item) => item.id !== image.id,
                          ),
                        })
                      }}
                    >
                      移除
                    </button>
                  )}
                </figure>
              ))}
            </div>
          )}
          {note.images.length > 1 && (
            <small className="journal-note-image-count">
              {note.images.length} 张照片
            </small>
          )}
          {editing === note.id && (
            <div className="journal-note-tools">
              <label className="journal-upload">
                ＋ 照片
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={disabled}
                  aria-label={`${OWNER_NAMES[owner]}第 ${index + 1} 条手记添加照片`}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || [])
                    event.target.value = ''
                    void onImages(note.id, files)
                  }}
                />
              </label>
              <span className="journal-note-order">
                <button
                  aria-label="手记上移"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label="手记下移"
                  disabled={disabled || index === notes.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </span>
              <button
                disabled={disabled}
                onClick={() => {
                  setRemoved((stack) => [
                    ...stack,
                    { type: 'note', note, index },
                  ])
                  onChange(notes.filter((item) => item.id !== note.id))
                  setEditing(null)
                }}
              >
                删除
              </button>
              <button
                className="journal-note-done"
                disabled={disabled}
                onClick={() => setEditing(null)}
              >
                完成
              </button>
            </div>
          )}
        </article>
      ))}
      <button
        className={`journal-note-add ${!notes.length ? 'is-empty' : ''}`}
        disabled={disabled}
        onClick={add}
      >
        {notes.length ? '＋ 记一件事' : '＋ 记一件今天的事……'}
      </button>
      {!!removed.length && (
        <button
          className="journal-note-undo"
          disabled={disabled}
          onClick={undo}
        >
          撤销删除
        </button>
      )}
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
