import React, { useEffect, useMemo, useState } from 'react'
import { startMeteorShower } from './meteorShower'
import './nightSky.css'

export default function StarField({ night = false }) {
  const [meteor, setMeteor] = useState(null)
  const [paused, setPaused] = useState(false)
  useEffect(() => startMeteorShower({
    enabled: night,
    visibility: document,
    motion: window.matchMedia('(prefers-reduced-motion: reduce)'),
    compact: window.matchMedia('(max-width: 640px)'),
    onMeteor: setMeteor,
    onPause: setPaused,
  }), [night])
  const stars = useMemo(() => Array.from({ length: 84 }, (_, i) => ({
    id: i,
    '--left': `${Math.random() * 100}%`,
    '--top': `${Math.random() * 100}%`,
    '--delay': `${Math.random() * 5}s`,
    '--size': `${Math.random() * 5 + 3}px`,
    '--night-size': `${i % 9 === 0 ? 2 : 1 + Math.random() * .6}px`,
    '--night-opacity': .22 + Math.random() * .46,
  })), [])

  return <div className={`star-field${paused ? ' is-paused' : ''}`} aria-hidden="true">
    {stars.slice(0, night ? 84 : 56).map(star => <span className="sky-star" key={star.id} style={star} />)}
    {night && meteor && <i className="sky-meteor" style={{ left: `${meteor.left}%`, top: `${meteor.top}%` }} />}
  </div>
}
