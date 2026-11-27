import React, { useEffect, useState } from 'react'
import './progressivePhoto.css'

function PhotoTransfer({ src, alternate, preview, alt, onRetry }) {
  const [attempt, setAttempt] = useState(0)
  const [useAlternate, setUseAlternate] = useState(false)
  const [failed, setFailed] = useState(false)
  const [percent, setPercent] = useState(null)
  const [blobUrl, setBlobUrl] = useState('')
  const [ready, setReady] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const url = useAlternate ? alternate : src
  // Native images also work for local drafts and external hosts without CORS.
  const measure = Boolean(url && url !== preview &&
    (url.startsWith(window.location.origin + '/') || /^\/(?!\/)/.test(url)))
  const full = measure ? blobUrl : url
  function fail() {
    if (!useAlternate && alternate && alternate !== src) setUseAlternate(true)
    else setFailed(true)
    setPercent(null)
    setReady(false)
    setBlobUrl('')
  }
  useEffect(() => {
    if (!measure) return
    const request = new XMLHttpRequest()
    let active = true
    let objectUrl, stallTimer
    const watchConnection = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => { request.abort(); fail() }, 20000)
    }
    request.open('GET', url)
    request.responseType = 'blob'
    request.onprogress = event => {
      if (!active) return
      watchConnection()
      if (event.lengthComputable && event.total > 0) {
        setPercent(Math.min(100, Math.floor(100 * event.loaded / event.total)))
      }
    }
    request.onload = () => {
      clearTimeout(stallTimer)
      if (!active) return
      if (request.status < 200 || request.status >= 300 || !request.response?.size) { fail(); return }
      objectUrl = URL.createObjectURL(request.response)
      setBlobUrl(objectUrl)
    }
    request.onerror = () => { clearTimeout(stallTimer); if (active) fail() }
    watchConnection()
    request.send()
    return () => {
      active = false
      clearTimeout(stallTimer)
      request.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [measure, url, attempt])

  const broken = !url || failed
  const hasPreview = preview && preview !== url && !previewFailed
  function retry() {
    onRetry?.()
    setUseAlternate(false)
    setFailed(false)
    setPreviewFailed(false)
    setReady(false)
    setPercent(null)
    setBlobUrl('')
    setAttempt(n => n + 1)
  }
  return <div className="photo-inspect" data-photo-state={broken ? 'error' : ready ? 'ready' : 'loading'}>
    {hasPreview && !ready && <img className="photo-inspect-preview" src={preview} alt={alt}
      onError={() => setPreviewFailed(true)} />}
    {full && !broken && <img key={url + ':' + attempt} className={ready ? 'photo-inspect-full' : 'photo-inspect-pending'}
      src={full} alt={alt} aria-hidden={hasPreview && !ready || undefined} decoding="async" onLoad={() => setReady(true)} onError={fail} />}
    {!ready && <div className="photo-inspect-feedback">
      {broken ? <button type="button" onClick={retry}>{hasPreview ? '已显示预览图，重试原图' : '照片未加载，点击重试'}</button> : <>
        <span role="status">{blobUrl ? '正在显示原图…' : '正在加载清晰图…'}</span>
        {percent !== null && <span aria-hidden="true">{percent}%</span>}
        <progress aria-label="原图下载进度" max={100} value={percent ?? undefined} />
      </>}
    </div>}
  </div>
}

export default function ProgressivePhoto(props) {
  return <PhotoTransfer key={props.src} {...props} />
}
