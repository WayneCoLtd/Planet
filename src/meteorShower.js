// One short-lived meteor at a time; no frame loop or work in hidden tabs.
export function startMeteorShower({ enabled, visibility, motion, onMeteor, onPause,
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
        // Count the 1.4s visible lifetime toward the 4–5s start-to-start interval.
        if (canAnimate()) schedule(4000 + random() * 1000 - 1400)
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
