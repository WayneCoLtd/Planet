import React, { useMemo } from 'react'

export default function StarField() {
  const stars = useMemo(() => Array.from({ length: 56 }, (_, i) => ({
    id: i,
    '--left': `${Math.random() * 100}%`,
    '--top': `${Math.random() * 100}%`,
    '--delay': `${Math.random() * 5}s`,
    '--size': `${Math.random() * 5 + 3}px`
  })), [])

  return <div className="star-field" aria-hidden="true">{stars.map(star => <span key={star.id} style={star} />)}</div>
}
