// One short-lived meteor at a time; no frame loop or work in hidden tabs.
export function startMeteorShower({ enabled, visibility, motion, compact, onMeteor, onPause,
  setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  let timer = null
  let stopped = false
  const canAnimate = () => !stopped && !visibility.hidden && !motion.matches
  const schedule = delay => {
    timer = setTimer(() => {
      if (!canAnimate()) return
      onMeteor({ left: 58 + random() * 34, top: 6 + random() * 18 })
      timer = setTimer(() => {
        onMeteor(null)
        if (canAnimate()) schedule((compact.matches ? 9000 : 6000) + random() * (compact.matches ? 5000 : 4000) - 1400)
      }, 1400)
    }, delay)
  }
  const refresh = () => {
    clearTimer(timer)
    onMeteor(null)
    onPause(!canAnimate())
    if (enabled && canAnimate()) schedule(2800)
  }
  visibility.addEventListener('visibilitychange', refresh)
  motion.addEventListener('change', refresh)
  refresh()
  return () => {
    stopped = true
    clearTimer(timer)
    visibility.removeEventListener('visibilitychange', refresh)
    motion.removeEventListener('change', refresh)
  }
}
