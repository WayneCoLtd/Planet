import React from 'react'
import { mediaPreviewUrl } from './previewUrl'

export default function PreviewImage({ src, onError, ...props }) {
  const preview = mediaPreviewUrl(src)
  return (
    <img
      loading="lazy"
      decoding="async"
      {...props}
      src={preview}
      onError={(event) => {
        if (preview !== src && event.currentTarget.getAttribute('src') === preview) {
          event.currentTarget.src = src
        } else {
          onError?.(event)
        }
      }}
    />
  )
}
