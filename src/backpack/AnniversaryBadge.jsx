import React, { useId, useRef, useState } from 'react'
import './anniversaryBadge.css'

export default function AnniversaryBadge({ days, date, caption, photo }) {
  const dialog = useRef(null)
  const trigger = useRef(null)
  const photoTitleId = useId()
  const [photoStatus, setPhotoStatus] = useState('closed')
  const [year, month, day] = date.split('-').map(Number)
  const title = `${days}天纪念徽章`
  const medallion = <span className="anniversary-medallion" aria-hidden="true"><span>♥</span><b>{days}</b></span>

  function openPhoto() {
    setPhotoStatus('loading')
    dialog.current.showModal()
  }

  function closePhoto() {
    setPhotoStatus('closed')
    trigger.current?.focus()
  }

  return (
    <article className="sticker-card inventory-card is-owned anniversary-badge">
      {photo ? (
        <button
          ref={trigger}
          type="button"
          className="anniversary-badge-icon anniversary-badge-trigger"
          aria-label={`查看${title}照片`}
          aria-haspopup="dialog"
          onClick={openPhoto}
        >
          {medallion}
        </button>
      ) : <span className="anniversary-badge-icon">{medallion}</span>}
      <h3>{title}</h3>
      <p>获得于 <time dateTime={date}>{year}年{month}月{day}日</time></p>
      <p className="anniversary-badge-caption">{caption}</p>

      {photo && <dialog
        ref={dialog}
        className="anniversary-photo-dialog"
        aria-labelledby={photoTitleId}
        onClose={closePhoto}
        onClick={(event) => { if (event.target === event.currentTarget) dialog.current.close() }}
      >
        <div className="anniversary-photo-content">
          <header>
            <h2 id={photoTitleId}>{caption}</h2>
            <button type="button" autoFocus aria-label="关闭照片" onClick={() => dialog.current.close()}>×</button>
          </header>
          {photoStatus === 'loading' && <p role="status">正在加载照片…</p>}
          {photoStatus === 'error' && (
            <p role="status">照片加载失败。<button type="button" onClick={() => setPhotoStatus('loading')}>重试</button></p>
          )}
          {(photoStatus === 'loading' || photoStatus === 'ready') && (
            <img src={photo.src} alt={photo.alt} onLoad={() => setPhotoStatus('ready')} onError={() => setPhotoStatus('error')} />
          )}
        </div>
      </dialog>}
    </article>
  )
}
