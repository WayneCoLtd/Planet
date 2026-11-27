import React, { useEffect, useRef, useState } from 'react'
import './progressivePhoto.css'

// Keep far-away thumbnails off the connection while the visible row is loading.
export default function PhotoThumbnail({ src, ...props }) {
  const ref = useRef(null)
  const [loaded, setLoaded] = useState(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [near])
  return <>
    <img {...props} ref={ref} src={near ? src : undefined} decoding="async"
      loading={typeof IntersectionObserver === 'undefined' ? 'lazy' : undefined}
      onLoad={() => setLoaded(src)} style={near ? undefined : { visibility: 'hidden' }} />
    {near && loaded !== src && <span className="photo-thumb-wait" aria-hidden="true">正在加载照片…</span>}
  </>
}
