import { safeGetItem, safeSetItem, safeRemoveItem } from './safeStorage.js'

const PREFERENCE_KEY = 'wwcxrl-appearance-preference'

// An explicit choice on this device takes precedence over hydrated game state.
export function readVoyageAppearance() {
  const preference = safeGetItem(PREFERENCE_KEY)
  if (preference === 'classic' || preference === 'voyage') return preference === 'voyage'
  return safeGetItem('wwcxrl-voyage-theme') === 'yes'
}

export function saveVoyageAppearance(enabled) {
  safeSetItem(PREFERENCE_KEY, enabled ? 'voyage' : 'classic')
}

// Story transitions and explicit game resets still control the theme immediately.
export function clearVoyageAppearance() {
  safeRemoveItem(PREFERENCE_KEY)
}
